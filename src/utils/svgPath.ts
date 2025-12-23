import { createNoise2D } from "simplex-noise";
import { createSeededRng } from "./seededRandom";

export type VectorStyle =
  | "organic"
  | "geometric"
  | "chaotic"
  | "mandala"
  | "spiro"
  | "crystal"
  | "ripple"
  | "cloud";
export type FillMode = "stroke" | "fill" | "both";

export interface GeneratorParams {
  seed: number;
  complexity: number; // 1..10
  scale: number; // 50..400
  style: VectorStyle;

  // NEW (Milestone 5.5)
  strokeWidth: number; // 1..16 recommended
  fillMode: FillMode;
  cornerRoundness: number; // 0..10 (2D rounded corners)

  // colors
  paletteId: string; // e.g. "default" | "sunset" | "custom"
  colorScheme: [string, string, string]; // always stored for reproducibility
}

export type Point = { x: number; y: number };

const TAU = Math.PI * 2;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const gcdInt = (a: number, b: number): number => {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
};

const toPathFromPoints = (pts: Array<[number, number]>): string => {
  if (pts.length < 3) return "M 250 250 Z";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
  d += " Z";
  return d;
};

export const pointsToClosedPath = (points: Point[]): string => {
  if (points.length < 3) return "M250 250 Z";
  const [first, ...rest] = points;
  const parts: string[] = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  for (const p of rest) {
    parts.push(`L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
};

export const generateOrganic = (params: GeneratorParams): string => {
  const complexity = clamp(params.complexity, 1, 10);
  const scale = clamp(params.scale, 50, 400);

  const rng = createSeededRng(params.seed);
  const noise2D = createNoise2D(rng);

  const center = { x: 250, y: 250 };

  const segments = 50 + complexity * 10; // 60..150
  const k = 1.2 + complexity * 0.15; // frequency
  const off = rng() * 1000;

  const points: Point[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    const nx = Math.cos(angle) * k + off;
    const ny = Math.sin(angle) * k + off;

    const noiseVal = noise2D(nx, ny); // -1..1
    const base = 0.5 + noiseVal * 0.3; // ~0.2..0.8
    const radius = scale * clamp(base, 0.2, 0.9);

    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;

    points.push({ x, y });
  }

  return pointsToClosedPath(points);
};

// Generate a geometric shape (regular polygon)
export const generateGeometric = (params: GeneratorParams): string => {
  const { complexity, scale, seed } = params;
  const rand = createSeededRng(seed);

  const cx = 250;
  const cy = 250;

  const c = Math.max(1, Math.min(10, complexity));
  const sides = 3 + Math.floor((c - 1) * 0.7); // 3..9
  const rot = rand() * Math.PI * 2;

  const baseR = scale * (0.55 + rand() * 0.25);
  const jitter = baseR * (0.02 + 0.1 * (c / 10));

  const modePick = rand();
  const isStar = modePick < 0.45;
  const isJittered = modePick >= 0.45;

  const innerRatio = 0.45 + rand() * 0.3;
  const pointsCount = isStar ? sides * 2 : sides;

  const pts: Array<[number, number]> = [];

  for (let i = 0; i < pointsCount; i++) {
    const aBase = rot + (i / pointsCount) * Math.PI * 2;
    let r = baseR;

    if (isStar) {
      r = i % 2 === 0 ? baseR : baseR * innerRatio;
    }

    if (isJittered) {
      const aJ = (rand() - 0.5) * 0.18 * (c / 10);
      const rJ = (rand() - 0.5) * jitter;
      const aa = aBase + aJ;
      const rr = r + rJ;
      pts.push([cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr]);
    } else {
      pts.push([cx + Math.cos(aBase) * r, cy + Math.sin(aBase) * r]);
    }
  }

  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
  d += " Z";
  return d;
};

// Chaotic generator
export const generateChaotic = (params: GeneratorParams): string => {
  const { complexity, scale, seed } = params;
  const segments = 40 + complexity * 8; // more segments for higher complexity
  const points: Point[] = [];
  
  const rng = createSeededRng(seed);
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    const randomFactor = rng() * 0.5 + 0.5; // random radius factor between 0.5 and 1.0
    const radius = scale * randomFactor;
    points.push({
      x: 250 + Math.cos(angle) * radius,
      y: 250 + Math.sin(angle) * radius,
    });
  }

  return pointsToClosedPath(points);
};

// Mandala generator
export const generateMandala = (params: GeneratorParams): string => {
  const { complexity, scale, seed } = params;
  const rings = 2 + Math.floor(complexity / 3); // 2 to 5 rings
  const petals = 6 + complexity; // 6 to 15 petals
  const points: Point[] = [];

  const angleStep = Math.PI * 2 / petals;
  const rng = createSeededRng(seed);
  const baseRot = rng() * TAU;

  for (let ring = 0; ring < rings; ring++) {
    const radiusJitter = 0.9 + rng() * 0.2;
    const radius = scale * (0.5 + ring * 0.3) * radiusJitter; // larger rings
    for (let i = 0; i < petals; i++) {
      const angleJitter = (rng() - 0.5) * 0.08;
      const angle = baseRot + i * angleStep + angleJitter;
      points.push({
        x: 250 + Math.cos(angle) * radius,
        y: 250 + Math.sin(angle) * radius,
      });
    }
  }

  return pointsToClosedPath(points);
};

const generateSpiro = (params: GeneratorParams): string => {
  const rand = createSeededRng(params.seed);
  const c = clamp(params.complexity, 1, 10);

  const Rn = 6 + Math.floor(rand() * 9);
  const rn = 2 + Math.floor(rand() * Math.max(2, Rn - 3));

  const dRatio = 0.35 + rand() * 0.75;
  const dn = dRatio * rn;

  const g = gcdInt(Rn - rn, rn);
  const tMax = TAU * (rn / g);

  const segments = Math.floor(240 + c * 50);
  const cx = 250;
  const cy = 250;
  const s = (params.scale * 0.62) / Rn;

  const pts: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * tMax;
    const k = (Rn - rn) / rn;
    const x = (Rn - rn) * Math.cos(t) + dn * Math.cos(k * t);
    const y = (Rn - rn) * Math.sin(t) - dn * Math.sin(k * t);
    pts.push([cx + x * s, cy + y * s]);
  }

  return toPathFromPoints(pts);
};

const generateCrystal = (params: GeneratorParams): string => {
  const rand = createSeededRng(params.seed);
  const c = clamp(params.complexity, 1, 10);

  const cx = 250;
  const cy = 250;

  const sides = 4 + Math.floor((c - 1) * 0.6);
  const rot = rand() * TAU;

  const baseR = params.scale * (0.5 + rand() * 0.18);
  const jitter = baseR * (0.04 + 0.1 * (c / 10));

  const pts: Array<[number, number]> = [];

  for (let i = 0; i < sides; i++) {
    const a0 = rot + (i / sides) * TAU;
    const a1 = rot + ((i + 1) / sides) * TAU;

    const rV = baseR + (rand() - 0.5) * jitter;
    const vx = cx + Math.cos(a0) * rV;
    const vy = cy + Math.sin(a0) * rV;

    const mx0 = cx + Math.cos((a0 + a1) * 0.5) * baseR;
    const my0 = cy + Math.sin((a0 + a1) * 0.5) * baseR;

    const push = (rand() - 0.5) * jitter * 1.2;
    const denom = Math.max(1e-6, baseR);
    const mx = cx + (mx0 - cx) * (1 + push / denom);
    const my = cy + (my0 - cy) * (1 + push / denom);

    pts.push([vx, vy], [mx, my]);
  }

  return toPathFromPoints(pts);
};

const generateRipple = (params: GeneratorParams): string => {
  const rand = createSeededRng(params.seed);
  const c = clamp(params.complexity, 1, 10);

  const cx = 250;
  const cy = 250;

  const segments = Math.floor(90 + c * 18);
  const baseR = params.scale * (0.52 + rand() * 0.12);

  const waves = 3 + Math.floor(rand() * 5) + Math.floor(c / 3);
  const amp = baseR * (0.06 + 0.1 * (c / 10));
  const phase1 = rand() * TAU;
  const phase2 = rand() * TAU;

  const pts: Array<[number, number]> = [];

  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * TAU;
    const r =
      baseR +
      amp * Math.sin(waves * t + phase1) +
      amp * 0.45 * Math.sin(waves * 2 * t + phase2);
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }

  return toPathFromPoints(pts);
};

const generateCloud = (params: GeneratorParams): string => {
  const rand = createSeededRng(params.seed);
  const c = clamp(params.complexity, 1, 10);

  const cx = 250;
  const cy = 250;

  const segments = Math.floor(110 + c * 20);
  const baseR = params.scale * (0.5 + rand() * 0.14);

  const f1 = 2 + Math.floor(rand() * 4);
  const f2 = 3 + Math.floor(rand() * 5);
  const f3 = 5 + Math.floor(rand() * 6);

  const a1 = baseR * (0.06 + 0.06 * (c / 10));
  const a2 = baseR * (0.04 + 0.05 * (c / 10));
  const a3 = baseR * (0.02 + 0.04 * (c / 10));

  const p1 = rand() * TAU;
  const p2 = rand() * TAU;
  const p3 = rand() * TAU;

  const pts: Array<[number, number]> = [];

  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * TAU;
    let r =
      baseR +
      a1 * Math.sin(f1 * t + p1) +
      a2 * Math.sin(f2 * t + p2) +
      a3 * Math.sin(f3 * t + p3);
    r = Math.max(baseR * 0.25, r);
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }

  return toPathFromPoints(pts);
};

// Main function to choose the style
export const generatePath = (params: GeneratorParams): string => {
  let raw: string;
  switch (params.style) {
    case "organic":
      raw = generateOrganic(params);
      break;
    case "geometric":
      raw = generateGeometric(params);
      break;
    case "chaotic":
      raw = generateChaotic(params);
      break;
    case "mandala":
      raw = generateMandala(params);
      break;
    case "spiro":
      raw = generateSpiro(params);
      break;
    case "crystal":
      raw = generateCrystal(params);
      break;
    case "ripple":
      raw = generateRipple(params);
      break;
    case "cloud":
      raw = generateCloud(params);
      break;
    default:
      raw = generateOrganic(params);
      break;
  }

  return params.cornerRoundness > 0 ? roundPathCorners(raw, params.cornerRoundness) : raw;
};

const tokenize = (d: string) => d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];

export const fitPathToViewBox = (d: string, size = 500, margin = 20): string => {
  const tokens = tokenize(d);
  if (!tokens.length) return d;

  let cmd = "";
  let i = 0;

  const pts: Array<[number, number]> = [];

  const readNum = () => {
    const n = Number(tokens[i]);
    if (!Number.isFinite(n)) return null;
    i++;
    return n;
  };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      i++;
      continue;
    }

    if (cmd === "M" || cmd === "L") {
      const x = readNum();
      const y = readNum();
      if (x === null || y === null) break;
      pts.push([x, y]);
    } else if (cmd === "C") {
      const x1 = readNum();
      const y1 = readNum();
      const x2 = readNum();
      const y2 = readNum();
      const x = readNum();
      const y = readNum();
      if ([x1, y1, x2, y2, x, y].some((v) => v === null)) break;
      pts.push([x1 as number, y1 as number], [x2 as number, y2 as number], [x as number, y as number]);
    } else {
      i++;
    }
  }

  if (pts.length < 2) return d;

  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const target = size - margin * 2;

  const s = Math.min(target / w, target / h);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const tx = size * 0.5 - cx * s;
  const ty = size * 0.5 - cy * s;

  const xf = (x: number) => x * s + tx;
  const yf = (y: number) => y * s + ty;

  const out: string[] = [];
  cmd = "";
  i = 0;

  const pushNum = (v: number) => out.push(String(Math.round(v * 100) / 100));

  while (i < tokens.length) {
    const t = tokens[i];

    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      out.push(t);
      i++;
      continue;
    }

    if (cmd === "M" || cmd === "L") {
      const x = readNum();
      const y = readNum();
      if (x === null || y === null) break;
      pushNum(xf(x));
      pushNum(yf(y));
    } else if (cmd === "C") {
      const x1 = readNum();
      const y1 = readNum();
      const x2 = readNum();
      const y2 = readNum();
      const x = readNum();
      const y = readNum();
      if ([x1, y1, x2, y2, x, y].some((v) => v === null)) break;
      pushNum(xf(x1 as number));
      pushNum(yf(y1 as number));
      pushNum(xf(x2 as number));
      pushNum(yf(y2 as number));
      pushNum(xf(x as number));
      pushNum(yf(y as number));
    } else {
      out.push(t);
      i++;
    }
  }

  return out.join(" ");
};

type Subpath2D = { pts: Array<[number, number]>; closed: boolean };

const isCmd = (t: string) => /^[a-zA-Z]$/.test(t);

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};

const ensureClosed = (pts: Array<[number, number]>): Array<[number, number]> => {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts;
  return [...pts, [a[0], a[1]]];
};

const chaikinOpen = (ptsIn: Array<[number, number]>, iterations: number): Array<[number, number]> => {
  let pts = ptsIn;
  if (pts.length < 3) return pts;

  for (let it = 0; it < iterations; it++) {
    const out: Array<[number, number]> = [];
    out.push(pts[0]);

    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const Q: [number, number] = [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]];
      const R: [number, number] = [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]];
      out.push(Q, R);
    }

    out.push(pts[pts.length - 1]);
    pts = out;
    if (pts.length > 2500) break;
  }

  return pts;
};

const chaikinClosed = (ptsIn: Array<[number, number]>, iterations: number): Array<[number, number]> => {
  let pts = ensureClosed(ptsIn);
  if (pts.length < 4) return pts;

  for (let it = 0; it < iterations; it++) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const Q: [number, number] = [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]];
      const R: [number, number] = [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]];
      out.push(Q, R);
    }
    if (out.length) {
      const first = out[0];
      out.push([first[0], first[1]]);
    }
    pts = out;
    if (pts.length > 2500) break;
  }

  return pts;
};

const parseToSubpaths = (d: string, curveSamples = 10): Subpath2D[] => {
  const tokens = tokenize(d);
  if (!tokens.length) return [];

  let cmd = "";
  let i = 0;

  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  let current: Array<[number, number]> = [];
  let closed = false;
  const out: Subpath2D[] = [];

  const flush = () => {
    if (current.length >= 2) out.push({ pts: current, closed });
    current = [];
    closed = false;
  };

  const readNum = (): number | null => {
    if (i >= tokens.length) return null;
    const n = Number(tokens[i]);
    if (!Number.isFinite(n)) return null;
    i++;
    return n;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (isCmd(t)) {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        closed = true;
        if (current.length >= 2) {
          const first = current[0];
          const last = current[current.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) current.push([first[0], first[1]]);
        }
        cmd = "";
      }
      continue;
    }

    if (!cmd) break;

    if (cmd === "M" || cmd === "m") {
      const x0 = readNum();
      const y0 = readNum();
      if (x0 === null || y0 === null) break;

      flush();

      const x = cmd === "m" ? cx + x0 : x0;
      const y = cmd === "m" ? cy + y0 : y0;

      cx = x;
      cy = y;
      sx = x;
      sy = y;

      current.push([x, y]);

      cmd = cmd === "m" ? "l" : "L";
      continue;
    }

    if (cmd === "L" || cmd === "l") {
      const x0 = readNum();
      const y0 = readNum();
      if (x0 === null || y0 === null) break;

      const x = cmd === "l" ? cx + x0 : x0;
      const y = cmd === "l" ? cy + y0 : y0;

      cx = x;
      cy = y;
      current.push([x, y]);
      continue;
    }

    if (cmd === "C" || cmd === "c") {
      const x10 = readNum();
      const y10 = readNum();
      const x20 = readNum();
      const y20 = readNum();
      const x30 = readNum();
      const y30 = readNum();
      if ([x10, y10, x20, y20, x30, y30].some((v) => v === null)) break;

      const x1 = cmd === "c" ? cx + (x10 as number) : (x10 as number);
      const y1 = cmd === "c" ? cy + (y10 as number) : (y10 as number);
      const x2 = cmd === "c" ? cx + (x20 as number) : (x20 as number);
      const y2 = cmd === "c" ? cy + (y20 as number) : (y20 as number);
      const x3 = cmd === "c" ? cx + (x30 as number) : (x30 as number);
      const y3 = cmd === "c" ? cy + (y30 as number) : (y30 as number);

      const p0x = cx;
      const p0y = cy;
      for (let s = 1; s <= curveSamples; s++) {
        const tt = s / curveSamples;
        const x = cubicAt(p0x, x1, x2, x3, tt);
        const y = cubicAt(p0y, y1, y2, y3, tt);
        current.push([x, y]);
      }

      cx = x3;
      cy = y3;
      continue;
    }

    if (cmd === "Z" || cmd === "z") {
      current.push([sx, sy]);
      closed = true;
      cmd = "";
      continue;
    }

    break;
  }

  flush();
  return out;
};

const buildPathFromSubpaths = (subs: Subpath2D[]): string => {
  const r2 = (v: number) => String(Math.round(v * 100) / 100);
  const parts: string[] = [];

  for (const sp of subs) {
    if (sp.pts.length < 2) continue;
    parts.push(`M ${r2(sp.pts[0][0])} ${r2(sp.pts[0][1])}`);
    for (let i = 1; i < sp.pts.length; i++) parts.push(`L ${r2(sp.pts[i][0])} ${r2(sp.pts[i][1])}`);
    if (sp.closed) parts.push("Z");
  }

  return parts.join(" ");
};

export const roundPathCorners = (d: string, cornerRoundness0to10: number): string => {
  const iters = Math.max(0, Math.min(4, Math.floor(cornerRoundness0to10 / 2)));
  if (iters === 0) return d;

  const subs = parseToSubpaths(d, 10);
  if (!subs.length) return d;

  const smoothed: Subpath2D[] = subs.map((sp) => {
    const pts = sp.closed ? chaikinClosed(sp.pts, iters) : chaikinOpen(sp.pts, iters);
    return { pts, closed: sp.closed };
  });

  return buildPathFromSubpaths(smoothed);
};
