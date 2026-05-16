'use strict';

/**
 * Pause for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * From an array of camera candidates select the best one.
 * Prefers front-facing cameras; within a group picks the highest pixel count.
 * Does NOT mutate the input array.
 *
 * @param {{ pixels: number, front: boolean }[]} candidates
 * @returns {{ pixels: number, front: boolean } | null}
 */
export function selectBestCamera(candidates) {
  if (!candidates.length) return null;
  const front = candidates.filter((c) => c.front);
  const pool  = front.length ? front : candidates;
  return [...pool].sort((a, b) => b.pixels - a.pixels)[0];
}

/**
 * Map a VideoFrame timestamp (µs) back to a zero-based pattern slot index.
 *
 * @param {number} ts          - timestamp in microseconds
 * @param {number} slotMs      - duration of one slot in milliseconds
 * @param {number} totalFrames - total number of slots
 * @returns {number}
 */
export function timestampToSlot(ts, slotMs, totalFrames) {
  return Math.min(Math.round(ts / (slotMs * 1000)), totalFrames - 1);
}
