export type SeededRng = () => number;

export const createSeededRng = (initialSeed: number): SeededRng => {
  // normalize to safe int32 range
  let seed = Number.isFinite(initialSeed) ? Math.floor(initialSeed) : 1;
  if (seed === 0) seed = 1;

  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
};

export const randRange = (rng: SeededRng, min: number, max: number): number => {
  return min + (max - min) * rng();
};

export const randInt = (rng: SeededRng, min: number, max: number): number => {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(lo + (hi - lo + 1) * rng());
};
