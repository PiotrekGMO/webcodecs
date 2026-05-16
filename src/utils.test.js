import { delay, selectBestCamera, timestampToSlot } from './utils.js';

// ─── delay ───────────────────────────────────────────────────────────────────

describe('delay', () => {
  test('returns a Promise', () => {
    const p = delay(0);
    expect(p).toBeInstanceOf(Promise);
    return p;
  });

  test('resolves after at least the given duration', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});

// ─── selectBestCamera ─────────────────────────────────────────────────────────

describe('selectBestCamera', () => {
  test('returns null for an empty array', () => {
    expect(selectBestCamera([])).toBeNull();
  });

  test('prefers a lower-res front camera over a higher-res rear camera', () => {
    const candidates = [
      { pixels: 2_073_600, front: false },   // 1920×1080 rear
      { pixels:   921_600, front: true  },   // 1280×720  front
    ];
    expect(selectBestCamera(candidates)).toMatchObject({ front: true });
  });

  test('selects the highest-resolution camera among front candidates', () => {
    const candidates = [
      { pixels:   921_600, front: true },
      { pixels: 8_294_400, front: true },
      { pixels: 2_073_600, front: true },
    ];
    expect(selectBestCamera(candidates)).toMatchObject({ pixels: 8_294_400 });
  });

  test('falls back to all cameras when no front-facing camera is available', () => {
    const candidates = [
      { pixels: 2_073_600, front: false },
      { pixels: 8_294_400, front: false },
    ];
    expect(selectBestCamera(candidates)).toMatchObject({ pixels: 8_294_400 });
  });

  test('returns the exact same object reference (so stream cleanup works)', () => {
    const a = { pixels: 500_000, front: true  };
    const b = { pixels: 900_000, front: false };
    const result = selectBestCamera([a, b]);
    expect(result).toBe(a);   // front wins → same reference as `a`
  });

  test('does not mutate the input array', () => {
    const candidates = [
      { pixels: 8_294_400, front: false },
      { pixels: 2_073_600, front: false },
    ];
    const snapshot = [...candidates];
    selectBestCamera(candidates);
    expect(candidates).toEqual(snapshot);
  });
});

// ─── timestampToSlot ─────────────────────────────────────────────────────────

describe('timestampToSlot', () => {
  const SLOT_MS      = 500;
  const TOTAL_FRAMES = 20;

  test('maps timestamp 0 to slot 0', () => {
    expect(timestampToSlot(0, SLOT_MS, TOTAL_FRAMES)).toBe(0);
  });

  test('maps an exact slot-boundary timestamp to the correct slot', () => {
    // Slot 5 starts at 5 × 500 ms × 1000 µs/ms = 2 500 000 µs
    expect(timestampToSlot(2_500_000, SLOT_MS, TOTAL_FRAMES)).toBe(5);
  });

  test('maps the last valid slot timestamp correctly', () => {
    // Slot 19 starts at 19 × 500 000 µs = 9 500 000 µs
    expect(timestampToSlot(9_500_000, SLOT_MS, TOTAL_FRAMES)).toBe(19);
  });

  test('clamps out-of-range timestamps to the last slot', () => {
    expect(timestampToSlot(100_000_000, SLOT_MS, TOTAL_FRAMES)).toBe(TOTAL_FRAMES - 1);
  });

  test('rounds a mid-slot timestamp to the nearest slot', () => {
    // 750 000 µs = 1.5 slots → Math.round(1.5) = 2
    expect(timestampToSlot(750_000, SLOT_MS, TOTAL_FRAMES)).toBe(2);
  });
});
