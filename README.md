# WebCodecs Frame Capture

A browser-based application for capturing video frames using the **WebCodecs API**. It displays a precisely timed sequence of black and white screens (a defined bit pattern) in front of the camera, encodes the captured video, then decodes and presents each individual frame.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Standalone Version](#standalone-version)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [npm Scripts](#npm-scripts)
6. [Project Structure](#project-structure)
7. [Technical Details](#technical-details)
8. [Tests](#tests)
9. [Build Pipeline](#build-pipeline)

---

## How It Works

### Concept

The application displays a carefully planned sequence of black and white frames in front of the camera (pattern `00110011001100110011` — 20 slots × 500 ms = 10 seconds). The camera records the screen simultaneously. The encoded video frames are then decoded and displayed, allowing you to assess how the camera responds to luminance changes — exposure time, auto-exposure behaviour, hysteresis, etc.

### Step-by-step flow

```
User clicks "Start"
        │
        ▼
1. Best camera selection
   ├─ Enumerates available video devices
   ├─ Opens each one temporarily and measures resolution
   ├─ Prefers front-facing camera (facingMode: user)
   └─ Picks the highest resolution

        │
        ▼
2. Camera warm-up (~900 ms)
   └─ Time for auto-focus and auto-exposure to settle

        │
        ▼
3. Capture loop (20 iterations × 500 ms)
   ├─ Change screen colour (black / white)
   ├─ Wait 220 ms (SETTLE_MS) for the camera to react
   ├─ Snapshot frame from <video> → OffscreenCanvas
   ├─ Encode frame via VideoEncoder
   └─ Every 4 frames: forced keyframe

        │
        ▼
4. Flush and close encoder

        │
        ▼
5. Stop webcam

        │
        ▼
6. Decode all encoded chunks
   └─ VideoDecoder → array of VideoFrame

        │
        ▼
7. Render to canvases
   └─ Each frame → individual <canvas> with metadata
      (frame number, KEY / P-frame, WHITE / BLACK)
```

### Capture pattern

```
Slot:    0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
Pattern: 0  0  1  1  0  0  1  1  0  0  1  1  0  0  1  1  0  0  1  1
Screen:  B  B  W  W  B  B  W  W  B  B  W  W  B  B  W  W  B  B  W  W
```

B = black screen, W = white screen.

---

## Standalone Version

The `standalone_version/` folder contains a **single self-contained `index.html`** file — no npm, no build step, no dependencies whatsoever. Just open the file directly in Chrome (or serve it over any HTTP server) and it works out of the box.

Use this version when you want to run the tool quickly without setting up the Node.js toolchain.

---

## Requirements

| Requirement | Minimum version |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| Browser | **Chrome 94+** (Desktop or Android) |

> The application uses `VideoEncoder`, `VideoDecoder`, `VideoFrame` and `EncodedVideoChunk` — APIs available exclusively in Chromium. Firefox and Safari are not supported.

---

## Installation

```bash
git clone <repo-url>
cd rc
npm install
npx playwright install chromium   # one-time, downloads the browser for E2E tests
```

---

## npm Scripts

| Command | Description |
|---|---|
| `npm start` | Development server with hot-reload at `localhost:3000` |
| `npm test` | Unit tests (Jest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run build` | Production build: tests → minification → obfuscation |
| `npm run build:dev` | Quick build to `build/` without tests (dev helper) |
| `npm run build:test` | Build to `build_test/` used by E2E tests |

### `npm start` — development mode

Runs three processes in parallel:

- **SASS** — compiles `src/style.scss → dev/style.css` in watch mode
- **JS** — esbuild bundles `src/main.js` + `src/utils.js → dev/main.js` in watch mode (unobfuscated, readable code)
- **SRV** — browser-sync serves the `dev/` folder at `http://localhost:3000` and automatically reloads the browser on every change

### `npm run build` — production build

Runs in sequence:

1. `npm test` — unit tests (must pass)
2. `npm run test:e2e` — E2E tests (must pass)
3. SCSS compilation with compression
4. JS bundle via esbuild with minification
5. Obfuscation of `build/main.js` via javascript-obfuscator

---

## Project Structure

```
rc/
├── src/                        # Source code
│   ├── index.html              # Main HTML file
│   ├── main.js                 # Application logic (WebCodecs, camera)
│   ├── utils.js                # Pure, testable helper functions
│   ├── utils.test.js           # Unit tests (Jest)
│   └── style.scss              # Styles (SASS)
│
├── e2e/                        # End-to-end tests
│   ├── page.spec.js            # Page structure tests
│   └── unsupported.spec.js     # "No WebCodecs" fallback path tests
│
├── scripts/
│   └── serve.js                # Minimal HTTP server for E2E tests
│
├── build/                      # Production output (minified + obfuscated)
│   ├── index.html
│   ├── main.js
│   └── style.css
│
├── build_test/                 # E2E test output (never deployed)
│
├── dev/                        # Development output (generated by npm start)
│
├── standalone_version/
│   └── index.html              # Zero-dependency single-file version (no npm required)
│
├── babel.config.js             # Babel config (transpilation for Jest)
├── playwright.config.js        # Playwright config
└── package.json
```

---

## Technical Details

### `src/main.js`

Main ES module. Contains:

| Function | Description |
|---|---|
| `getBestCameraStream()` | Enumerates cameras, opens each temporarily, selects the best one (front + max resolution) using `selectBestCamera()` from utils |
| `pickEncoderConfig(W, H)` | Negotiates codec — tries `vp8`, `vp09`, `avc1`, `av01` in order |
| `captureAndEncode(videoEl)` | 20-iteration loop: change screen colour → wait → snapshot → `VideoEncoder.encode()` |
| `decodeAndDisplay(result)` | Passes chunks to `VideoDecoder`, sorts by timestamp, renders to canvases |

### `src/utils.js`

Pure, side-effect-free functions exported as ES modules:

| Function | Description |
|---|---|
| `delay(ms)` | Promise-based `setTimeout` |
| `selectBestCamera(candidates)` | Picks the best camera from a list of candidates (front preference, max pixels) |
| `timestampToSlot(ts, slotMs, totalFrames)` | Maps a VideoFrame timestamp (µs) to a pattern slot index |

### Codec negotiation

The application tries codecs in order of preference:

1. `vp8` — widest compatibility in Chrome
2. `vp09.00.10.08` — VP9 profile 0
3. `avc1.42001E` — H.264 Baseline
4. `av01.0.04M.08` — AV1

The first codec for which `VideoEncoder.isConfigSupported()` returns `{ supported: true }` is used.

### Frame timing

```
Slot 0:  t=0 ms      → screen B → wait 220ms → snapshot → wait 280ms
Slot 1:  t=500 ms    → screen B → wait 220ms → snapshot → wait 280ms
Slot 2:  t=1000 ms   → screen W → wait 220ms → snapshot → wait 280ms
...
Slot 19: t=9500 ms   → screen W → wait 220ms → snapshot → wait 280ms
```

`SETTLE_MS = 220` ms is the time allowed for the camera to re-expose after a screen colour change. The frame is captured after this delay; the remainder of the 500 ms slot (280 ms) is waited out before moving to the next iteration.

---

## Tests

### Unit tests — Jest (`npm test`)

File: [src/utils.test.js](src/utils.test.js) — 13 tests

| Group | Tests |
|---|---|
| `delay` | Returns a Promise, waits at least the given duration |
| `selectBestCamera` | Empty array, front preference, max resolution, rear fallback, array immutability, object reference identity |
| `timestampToSlot` | Boundary values (0, last slot), rounding, clamping out-of-range values |

### E2E tests — Playwright (`npm run test:e2e`)

Files: `e2e/page.spec.js`, `e2e/unsupported.spec.js` — 14 tests in Chromium

**Page structure (`page.spec.js`):**
- Correct page title
- Start button visible and enabled
- 20 pattern bits rendered in `#pattern-track`
- Correct B/W labels and `bit-w` class on white bits
- Output section hidden on load
- WebCodecs warning hidden when API is available
- Status text contains the word "Start"
- `<video>` element present in the DOM

**No WebCodecs (`unsupported.spec.js`):**  
Uses `page.addInitScript()` to remove `VideoEncoder`, `VideoDecoder`, `VideoFrame`, `EncodedVideoChunk` before the script loads. Verifies that:
- `#support-warn` is visible
- `#preview`, `#pattern-track`, `#progress-wrap`, `#controls` are hidden

### Test server

Playwright cannot open files via `file://` (CORS block for ES modules). [scripts/serve.js](scripts/serve.js) is a minimal HTTP server (plain Node.js, zero dependencies) that serves the `build_test/` folder on port `4321`. It is started automatically by the `webServer` setting in `playwright.config.js`.

---

## Build Pipeline

```
npm run build
      │
      ├─ 1. npm test ──────────────────── Jest (src/utils.test.js)
      │         └─ FAIL → abort build
      │
      ├─ 2. npm run test:e2e
      │         ├─ build:test → build_test/ (unminified)
      │         ├─ node scripts/serve.js (port 4321)
      │         └─ playwright test (14 tests)
      │                   └─ FAIL → abort build
      │
      ├─ 3. sass --style=compressed → build/style.css
      ├─ 4. cp src/index.html → build/index.html
      ├─ 5. esbuild --bundle --minify → build/main.js
      └─ 6. javascript-obfuscator → build/main.js (obfuscation)
```

Every step is conditional on the previous one — a test failure stops the build before anything reaches `build/`.


It is I leAI :-P