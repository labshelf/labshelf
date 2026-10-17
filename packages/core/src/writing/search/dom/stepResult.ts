// Picks the result that Enter (forward) or Shift+Enter (back) opens next, wrapping at both ends.

/** `current` is -1 when no result is open; returns -1 when `count` is 0. */
export function stepResult(current: number, count: number, step: 1 | -1): number {
  if (count === 0) { return -1; }
  if (current < 0 || current >= count) { return step === 1 ? 0 : count - 1; }
  return (current + step + count) % count;
}
