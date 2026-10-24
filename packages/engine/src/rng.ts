export interface SeededRng {
  /** Returns float in [0, 1) */
  nextFloat(): number;
  /** Returns integer in [min, max] inclusive */
  nextInt(min: number, max: number): number;
  /** Roll a standard d6 (1..6) */
  rollD6(): number;
  /** Shuffle array in-place (Fisher-Yates) and return it */
  shuffle<T>(arr: T[]): T[];
}

/**
 * Pure TypeScript dual-round FNV-1a 64-bit commitment hash (works in both Browser and Node).
 */
export function hashSeed(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic PRNG based on Mulberry32 seeded from a string hash.
 * Works identically in Node and browser when given the string seed.
 */
export function createSeededRng(seedString: string): SeededRng {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedString.length; i++) {
    h ^= seedString.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;

  function nextFloat(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(min: number, max: number): number {
    return Math.floor(nextFloat() * (max - min + 1)) + min;
  }

  function rollD6(): number {
    return nextInt(1, 6);
  }

  function shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  return { nextFloat, nextInt, rollD6, shuffle };
}
