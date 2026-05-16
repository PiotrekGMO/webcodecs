'use strict';
import { delay, selectBestCamera, timestampToSlot } from './utils.js';

// ═══════════════════════════════════════════════════════════════════
//  WebCodecs support guard
// ═══════════════════════════════════════════════════════════════════
if (!window.VideoEncoder || !window.VideoDecoder || !window.VideoFrame || !window.EncodedVideoChunk) {
  document.getElementById('support-warn').style.display = 'block';
  document.getElementById('preview').style.display      = 'none';
  document.getElementById('pattern-track').style.display = 'none';
  document.getElementById('progress-wrap').style.display  = 'none';
  document.getElementById('controls').style.display       = 'none';
  throw new Error('WebCodecs not available — Chrome 94+ required.');
}

// ═══════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════
const PATTERN       = '00110011001100110011';   // 0 = black, 1 = white
const TOTAL_FRAMES  = PATTERN.length;            // 20
const DURATION_MS   = 10_000;                   // 10 seconds total
const SLOT_MS       = DURATION_MS / TOTAL_FRAMES; // 500 ms per frame slot
const SETTLE_MS     = 220;                       // ms to wait after colour switch before capturing

// ═══════════════════════════════════════════════════════════════════
//  DOM refs
// ═══════════════════════════════════════════════════════════════════
const previewEl     = /** @type {HTMLVideoElement}  */ (document.getElementById('preview'));
const startBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('startBtn'));
const statusEl      = document.getElementById('status-text');
const codecInfoEl   = document.getElementById('codec-info');
const progressEl    = document.getElementById('progress');
const patternTrack  = document.getElementById('pattern-track');
const outputSec     = document.getElementById('output-section');
const outputHeading = document.getElementById('output-heading');
const framesGrid    = document.getElementById('frames-grid');

// ═══════════════════════════════════════════════════════════════════
//  Build pattern visualiser
// ═══════════════════════════════════════════════════════════════════
const patternBits = PATTERN.split('').map((bit, i) => {
  const el = document.createElement('div');
  el.className = `pbit ${bit === '1' ? 'bit-w' : ''}`;
  el.textContent = bit === '1' ? 'W' : 'B';
  el.title = `Frame ${i + 1}: ${bit === '1' ? 'WHITE' : 'BLACK'} screen`;
  patternTrack.appendChild(el);
  return el;
});

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════
const setStatus   = (t)  => { statusEl.textContent = t; };
const setProgress = (p)  => { progressEl.style.width = `${p}%`; };

/** Toggle the body background between #000 and #fff */
function setScreenColor(isWhite) {
  document.body.classList.toggle('flash-white', isWhite);
}

function markBit(i, state) {
  const el = patternBits[i];
  el.classList.remove('active', 'done');
  if (state === 'active') el.classList.add('active');
  if (state === 'done')   el.classList.add('done');
}

function resetBits() {
  patternBits.forEach((el, i) => {
    el.className = `pbit ${PATTERN[i] === '1' ? 'bit-w' : ''}`;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Camera: select highest-resolution front-facing camera
//  Strategy: open each device temporarily, record (resolution, facingMode),
//  prefer front-facing, then sort by pixel count and keep the winner.
// ═══════════════════════════════════════════════════════════════════
async function getBestCameraStream() {
  // Trigger the permission prompt before enumerating (labels only appear after permission)
  const probe = await navigator.mediaDevices.getUserMedia({ video: true });
  probe.getTracks().forEach((t) => t.stop());

  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'videoinput');

  if (!devices.length) throw new Error('No video input device found.');

  /** @type {{ stream: MediaStream, pixels: number, front: boolean }[]} */
  const candidates = [];

  for (const dev of devices) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: dev.deviceId },
          width:  { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      const settings = s.getVideoTracks()[0].getSettings();
      candidates.push({
        stream: s,
        pixels: (settings.width ?? 0) * (settings.height ?? 0),
        front:  settings.facingMode === 'user',
      });
    } catch (_) {
      // device unavailable or in use — skip
    }
  }

  if (!candidates.length) {
    // Absolute fallback: accept whatever the browser gives us
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  }

  // Prefer front-facing cameras; fall back to all cameras if none found
  const best = selectBestCamera(candidates);
  // Release streams we are not using
  candidates.filter((c) => c !== best).forEach((c) => c.stream.getTracks().forEach((t) => t.stop()));
  return best.stream;
}

// ═══════════════════════════════════════════════════════════════════
//  Codec negotiation — try codecs in order of preference
// ═══════════════════════════════════════════════════════════════════
async function pickEncoderConfig(W, H) {
  const fps  = 1000 / SLOT_MS;  // 2 fps
  const base = { width: W, height: H, bitrate: 2_000_000, framerate: fps };

  for (const codec of ['vp8', 'vp09.00.10.08', 'avc1.42001E', 'av01.0.04M.08']) {
    try {
      const result = await VideoEncoder.isConfigSupported({ codec, ...base });
      if (result.supported) return { codec, ...base };
    } catch (_) { /* codec not recognised */ }
  }
  throw new Error('No supported VideoEncoder codec found in this browser.');
}

// ═══════════════════════════════════════════════════════════════════
//  Capture + encode
//  Returns { encodedChunks, decoderConfig, W, H, codec }
// ═══════════════════════════════════════════════════════════════════
async function captureAndEncode(videoEl) {
  const W = videoEl.videoWidth;
  const H = videoEl.videoHeight;

  /** @type {{ type: string, timestamp: number, duration: number|null, data: Uint8Array }[]} */
  const encodedChunks = [];
  let decoderConfig   = null;

  const cfg = await pickEncoderConfig(W, H);
  codecInfoEl.textContent = `Codec: ${cfg.codec}  |  Resolution: ${W}×${H}`;

  const encoder = new VideoEncoder({
    output(chunk, meta) {
      // Capture the decoder config emitted with the first key frame
      if (meta?.decoderConfig && !decoderConfig) {
        decoderConfig = meta.decoderConfig;
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedChunks.push({
        type:      chunk.type,
        timestamp: chunk.timestamp,   // microseconds
        duration:  chunk.duration,    // may be null
        data,
      });
    },
    error(e) { console.error('VideoEncoder error:', e); },
  });

  encoder.configure(cfg);

  // Reuse a single OffscreenCanvas for all frame captures
  const offscreen = new OffscreenCanvas(W, H);
  const ctx       = offscreen.getContext('2d');

  // ── Frame capture loop ─────────────────────────────────────────
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const isWhite = PATTERN[i] === '1';

    markBit(i, 'active');
    setScreenColor(isWhite);
    setStatus(`Frame ${i + 1} / ${TOTAL_FRAMES}  —  screen: ${isWhite ? '⬜ WHITE' : '⬛ BLACK'}`);
    setProgress(((i + 0.5) / TOTAL_FRAMES) * 100);

    // Give the display time to switch and the camera to expose the new state
    await delay(SETTLE_MS);

    // Snapshot the current video frame
    ctx.drawImage(videoEl, 0, 0, W, H);
    const vf = new VideoFrame(offscreen, {
      timestamp: i * SLOT_MS * 1000,   // µs: frame 0 = 0 µs, frame 1 = 500 000 µs, …
    });

    // Encode; force a key frame every 4 frames (frames 0, 4, 8, 12, 16)
    encoder.encode(vf, { keyFrame: i % 4 === 0 });
    vf.close();

    markBit(i, 'done');

    // Wait out the remainder of this 500 ms slot
    await delay(SLOT_MS - SETTLE_MS);
  }

  // ── Flush and close encoder ────────────────────────────────────
  setStatus('Flushing encoder…');
  await encoder.flush();
  encoder.close();   // ← encoder cleaned up here

  setScreenColor(false);
  setProgress(100);

  return { encodedChunks, decoderConfig, W, H, codec: cfg.codec };
}

// ═══════════════════════════════════════════════════════════════════
//  Decode encoded chunks and render each frame to its own <canvas>
// ═══════════════════════════════════════════════════════════════════
async function decodeAndDisplay({ encodedChunks, decoderConfig, W, H, codec }) {
  setStatus(`Decoding ${encodedChunks.length} encoded chunks for display…`);

  const decodedFrames = [];

  const decoder = new VideoDecoder({
    output(frame) { decodedFrames.push(frame); },
    error(e)      { console.error('VideoDecoder error:', e); },
  });

  // Use the decoder config the encoder advertised; fall back to a sensible default
  decoder.configure(decoderConfig ?? { codec, codedWidth: W, codedHeight: H });

  for (const c of encodedChunks) {
    decoder.decode(new EncodedVideoChunk({
      type:      c.type,
      timestamp: c.timestamp,
      data:      c.data,
      // Only pass duration when it is a valid positive number
      ...(typeof c.duration === 'number' && c.duration > 0 ? { duration: c.duration } : {}),
    }));
  }

  await decoder.flush();
  decoder.close();

  // Sort by timestamp in case output arrived out of order
  decodedFrames.sort((a, b) => a.timestamp - b.timestamp);

  // ── Render ────────────────────────────────────────────────────
  framesGrid.innerHTML = '';

  for (let i = 0; i < decodedFrames.length; i++) {
    const frame    = decodedFrames[i];
    const ts       = frame.timestamp;   // read before close

    const canvas   = document.createElement('canvas');
    canvas.width   = frame.displayWidth;
    canvas.height  = frame.displayHeight;
    canvas.getContext('2d').drawImage(frame, 0, 0);
    frame.close();   // release GPU memory

    // Map timestamp back to the original pattern slot
    const slotIdx  = timestampToSlot(ts, SLOT_MS, TOTAL_FRAMES);
    const isWhite  = PATTERN[slotIdx] === '1';
    const isKey    = slotIdx % 4 === 0;

    const card = document.createElement('div');
    card.className = 'frame-card';

    const meta = document.createElement('div');
    meta.className = 'frame-meta';
    meta.innerHTML =
      `<span class="frame-num">#${i + 1}</span>` +
      (isKey ? `<span class="badge badge-key">KEY</span>` : '') +
      `<span class="badge ${isWhite ? 'badge-w' : 'badge-b'}">${isWhite ? 'WHITE' : 'BLACK'}</span>`;

    card.appendChild(canvas);
    card.appendChild(meta);
    framesGrid.appendChild(card);
  }

  outputHeading.textContent =
    `${decodedFrames.length} decoded frame${decodedFrames.length !== 1 ? 's' : ''} ` +
    `from ${encodedChunks.length} encoded chunk${encodedChunks.length !== 1 ? 's' : ''}`;
  outputSec.style.display = 'block';
}

// ═══════════════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════════════
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  outputSec.style.display = 'none';
  framesGrid.innerHTML    = '';
  codecInfoEl.textContent = '';
  setProgress(0);
  resetBits();

  let stream = null;

  try {
    // ── 1. Acquire best camera ───────────────────────────────────
    setStatus('Finding best camera…');
    stream = await getBestCameraStream();

    previewEl.srcObject = stream;
    await new Promise((resolve) => { previewEl.onloadedmetadata = resolve; });
    await previewEl.play();

    // Brief warm-up so auto-exposure / auto-focus can settle
    setStatus('Camera warming up…');
    await delay(900);

    // ── 2. Capture & encode ──────────────────────────────────────
    const result = await captureAndEncode(previewEl);

    // ── 3. Stop webcam ───────────────────────────────────────────
    stream.getTracks().forEach((t) => t.stop());
    previewEl.srcObject = null;
    stream = null;

    // ── 4. Decode & display frames ───────────────────────────────
    await decodeAndDisplay(result);

    setStatus('Done — encoder closed, webcam stopped.');

  } catch (err) {
    console.error(err);
    setScreenColor(false);
    setStatus('Error: ' + err.message);

    // Clean up camera on failure
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      previewEl.srcObject = null;
    }
  } finally {
    startBtn.disabled = false;
  }
});
