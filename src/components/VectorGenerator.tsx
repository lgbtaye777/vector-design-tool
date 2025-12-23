import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, useMotionValue } from "framer-motion";
import * as flubber from "flubber";
import chroma from "chroma-js";
import type { GeneratorParams, VectorStyle, FillMode } from "../utils/svgPath";
import { generatePath, fitPathToViewBox } from "../utils/svgPath";
import Tooltip from "./Tooltip";

export interface VectorGeneratorProps {
  initialPathD: string;
  onVectorChange: (v: { d: string; fillMode: FillMode; strokeWidth: number; colorScheme: [string, string, string] }) => void;
}

interface VectorHistoryItem {
  id: string;
  d: string;
  params: GeneratorParams;
  createdAt: number;
}

const DEFAULT_SCHEME: [string, string, string] = ["#FF6B6B", "#4ECDC4", "#45B7D1"];

const PALETTES: Array<{ id: string; name: string; colors: [string, string, string] }> = [
  { id: "default", name: "Default", colors: ["#FF6B6B", "#4ECDC4", "#45B7D1"] },
  { id: "sunset", name: "Sunset", colors: ["#F94144", "#F3722C", "#F9C74F"] },
  { id: "forest", name: "Forest", colors: ["#2A9D8F", "#264653", "#E9C46A"] },
  { id: "berry", name: "Berry", colors: ["#9B5DE5", "#F15BB5", "#00BBF9"] },
  { id: "mono", name: "Mono", colors: ["#222222", "#666666", "#BBBBBB"] },
];

const deriveSchemeFromBase = (base: string): [string, string, string] => {
  const c = chroma(base);
  let h = Number(c.get("hsl.h"));
  const s = Number(c.get("hsl.s"));
  const l = Number(c.get("hsl.l"));

  if (!Number.isFinite(h)) h = 200; // stable fallback for grayscale inputs

  const c1 = chroma.hsl(h % 360, s, l).hex();
  const c2 = chroma.hsl((h + 120) % 360, s, l).hex();
  const c3 = chroma.hsl((h + 240) % 360, s, l).hex();
  return [c1, c2, c3];
};

const pickRandomPalette = (): { id: string; colors: [string, string, string] } => {
  const i = Math.floor(Math.random() * PALETTES.length);
  return { id: PALETTES[i].id, colors: PALETTES[i].colors };
};

const makeId = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const clampInt = (v: number, min: number, max: number): number => {
  const n = Number.isFinite(v) ? Math.floor(v) : min;
  return Math.max(min, Math.min(max, n));
};

const clampNum = (v: number, min: number, max: number): number => {
  const n = Number.isFinite(v) ? v : min;
  return Math.max(min, Math.min(max, n));
};

function safeInterpolate(interp: (t: number) => string, t: number, fallbackD: string): string {
  try {
    return interp(t);
  } catch {
    return fallbackD;
  }
}

const STYLE_OPTIONS: Array<{ value: VectorStyle; label: string }> = [
  { value: "organic", label: "органический" },
  { value: "geometric", label: "геометрический" },
  { value: "chaotic", label: "хаотичный" },
  { value: "mandala", label: "мандала" },
  { value: "spiro", label: "спирограф" },
  { value: "crystal", label: "кристалл" },
  { value: "ripple", label: "рябь" },
  { value: "cloud", label: "облако" },
];

type CardOption<T extends string> = { value: T; label: string; hint?: string };

function CardPicker<T extends string>({
  value,
  options,
  onChange,
  disabled,
  columns = 2,
}: {
  value: T;
  options: CardOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  columns?: 2 | 3;
}) {
  return (
    <div className={`cardGroup cols${columns}`} role="radiogroup" aria-disabled={disabled ? "true" : "false"}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={`cardOption ${active ? "isActive" : ""}`}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            role="radio"
            aria-checked={active}
          >
            <div className="cardTitle">{o.label}</div>
            {o.hint ? <div className="cardHint">{o.hint}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

const FILL_MODE_CARDS: CardOption<FillMode>[] = [
  { value: "stroke", label: "Контур", hint: "Только линия" },
  { value: "fill", label: "Заливка", hint: "Только форма" },
  { value: "both", label: "Оба", hint: "Форма + линия" },
];

const STYLE_CARDS: CardOption<VectorStyle>[] = STYLE_OPTIONS.map((s) => ({
  value: s.value,
  label: s.label,
}));

const STYLES: VectorStyle[] = STYLE_OPTIONS.map((o) => o.value);

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const VectorGenerator: React.FC<VectorGeneratorProps> = ({ initialPathD, onVectorChange }) => {
  // params (Milestone 3)
  const [seed, setSeed] = useState<number>(1);
  const [complexity, setComplexity] = useState<number>(5);
  const [scale, setScale] = useState<number>(220);
  const [style, setStyle] = useState<VectorStyle>("organic");

  // NEW: stroke/fill/colors (Milestone 5.5)
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fillMode, setFillMode] = useState<FillMode>("stroke");
  const [cornerRoundness, setCornerRoundness] = useState<number>(0);

  const [lockColors, setLockColors] = useState<boolean>(false);
  const [lockSeed, setLockSeed] = useState<boolean>(false);
  const [paletteId, setPaletteId] = useState<string>("default");
  const [baseColor, setBaseColor] = useState<string>(DEFAULT_SCHEME[0]);
  const [colorScheme, setColorScheme] = useState<[string, string, string]>(DEFAULT_SCHEME);

  // history (up to 10)
  const [vectorHistory, setVectorHistory] = useState<VectorHistoryItem[]>([]);

  // UI flags
  const [isMorphing, setIsMorphing] = useState<boolean>(false);

  // motion driver (framer-motion), but NO motion.* DOM
  const progress = useMotionValue(1);
  const animRef = useRef<ReturnType<typeof animate> | null>(null);

  // morph refs
  const nextRef = useRef<string>(initialPathD);
  const interpolatorRef = useRef<((t: number) => string) | null>(null);
  const fallbackRef = useRef<boolean>(false);

  type MorphMode = "flubber-hq" | "flubber-lq" | "points" | "crossfade";

  const morphModeRef = useRef<MorphMode>("flubber-hq");
  const [morphModeUi, setMorphModeUi] = useState<MorphMode>("flubber-hq");
  
  // points morph buffers
  const pointsARef = useRef<Float32Array | null>(null);
  const pointsBRef = useRef<Float32Array | null>(null);
  const pointsOutRef = useRef<Float32Array | null>(null);
  const partsRef = useRef<string[] | null>(null);
  const pointsCountRef = useRef<number>(0);

  // mount guard
  const mountedRef = useRef<boolean>(false);

  // SVG DOM refs (stable nodes)
  const morphedPathEl = useRef<SVGPathElement | null>(null);
  const oldPathEl = useRef<SVGPathElement | null>(null);
  const newPathEl = useRef<SVGPathElement | null>(null);

  // init once per mount instance (StrictMode safe)
  const didInitRef = useRef<boolean>(false);
  const initialDRef = useRef<string>(initialPathD);

  const params: GeneratorParams = useMemo(
    () => ({
      seed: clampInt(seed, 1, 2_000_000_000),
      complexity: clampInt(complexity, 1, 10),
      scale: clampNum(scale, 50, 400),
      style,
      strokeWidth: Math.max(1, Math.min(16, Math.round(strokeWidth))),
      fillMode,
      cornerRoundness: clampInt(cornerRoundness, 0, 10),
      paletteId,
      colorScheme,
    }),
    [seed, complexity, scale, style, strokeWidth, fillMode, cornerRoundness, paletteId, colorScheme]
  );

  const stopRunningAnimation = useCallback(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }
    // если анимацию остановили вручную — не оставляем кнопку заблокированной
    if (mountedRef.current) setIsMorphing(false);
  }, []);

  /**
   * CRITICAL: mount/unmount only
   * - подписка на progress
   * - остановка анимации в cleanup ДО удаления DOM
   */
  useLayoutEffect(() => {
    mountedRef.current = true;

    if (!didInitRef.current) {
      didInitRef.current = true;

      const d0 = initialDRef.current;
      nextRef.current = d0;
      fallbackRef.current = false;

      // init DOM once
      morphedPathEl.current?.setAttribute("d", d0);
      oldPathEl.current?.setAttribute("d", d0);
      newPathEl.current?.setAttribute("d", d0);

      if (morphedPathEl.current) morphedPathEl.current.style.opacity = "1";
      if (oldPathEl.current) oldPathEl.current.style.opacity = "0";
      if (newPathEl.current) newPathEl.current.style.opacity = "0";

      const initialParams: GeneratorParams = {
        seed: 1,
        complexity: 5,
        scale: 220,
        style: "organic",

        strokeWidth: 3,
        fillMode: "stroke",
        cornerRoundness: 0,

        paletteId: "default",
        colorScheme: DEFAULT_SCHEME,
      };

      setVectorHistory([
        {
          id: makeId(),
          d: d0,
          params: initialParams,
          createdAt: Date.now(),
        },
      ]);
    }

    const unsub = progress.on("change", (t) => {
      const mode = morphModeRef.current;

      if (mode === "crossfade") {
        if (morphedPathEl.current) morphedPathEl.current.style.opacity = "0";
        if (oldPathEl.current) oldPathEl.current.style.opacity = String(1 - t);
        if (newPathEl.current) newPathEl.current.style.opacity = String(t);
        return;
      }

      // flubber or points => показываем только morphed path
      if (morphedPathEl.current) morphedPathEl.current.style.opacity = "1";
      if (oldPathEl.current) oldPathEl.current.style.opacity = "0";
      if (newPathEl.current) newPathEl.current.style.opacity = "0";

      if (mode === "points") {
        const a = pointsARef.current;
        const b = pointsBRef.current;
        const out = pointsOutRef.current;
        const parts = partsRef.current;
        const n = pointsCountRef.current;

        if (!a || !b || !out || !parts || n <= 2) return;

        // lerp points into out (reuse buffer)
        const tt = t;
        for (let i = 0; i < out.length; i++) {
          out[i] = a[i] + (b[i] - a[i]) * tt;
        }

        // build d string with preallocated parts
        parts[0] = `M ${r2(out[0])} ${r2(out[1])}`;
        for (let pi = 1; pi < n; pi++) {
          const ix = pi * 2;
          parts[pi] = `L ${r2(out[ix])} ${r2(out[ix + 1])}`;
        }
        parts[n] = "Z";

        const d = parts.join(" ");
        morphedPathEl.current?.setAttribute("d", d);
        return;
      }

      // flubber
      const interp = interpolatorRef.current;
      const d = interp ? safeInterpolate(interp, t, nextRef.current) : nextRef.current;
      morphedPathEl.current?.setAttribute("d", d);
    });

    return () => {
      // sync cleanup
      stopRunningAnimation();
      unsub();
      mountedRef.current = false;
    };
  }, [progress, stopRunningAnimation]);

  const pushHistory = useCallback((d: string, p: GeneratorParams) => {
    const item: VectorHistoryItem = {
      id: makeId(),
      d,
      params: p,
      createdAt: Date.now(),
    };

    setVectorHistory((prev) => {
      const next = [item, ...prev];
      const out: VectorHistoryItem[] = [];
      const seen = new Set<string>();
      for (const it of next) {
        if (out.length >= 10) break;
        if (seen.has(it.d)) continue;
        seen.add(it.d);
        out.push(it);
      }
      return out;
    });
  }, []);

  const startMorph = useCallback(
    (targetD: string, targetParams: GeneratorParams, addToHistory: boolean) => {
      // stop previous animation if any
      if (animRef.current) animRef.current.stop();

      const from = nextRef.current;
      const to = targetD;

      nextRef.current = to;

      // prepare fallback paths
      oldPathEl.current?.setAttribute("d", from);
      newPathEl.current?.setAttribute("d", to);

      // build interpolation engine adaptively
      // prepareMorphEngine will choose between flubber-hq, flubber-lq, points, or crossfade
      const prepared = prepareMorphEngine({ from, to, complexity: targetParams.complexity });

      // fix mode
      morphModeRef.current = prepared.mode;
      setMorphModeUi(prepared.mode);

      if (prepared.mode === "flubber-hq" || prepared.mode === "flubber-lq") {
        interpolatorRef.current = (prepared as any).interp ?? null;
        // clear points buffers
        pointsARef.current = null;
        pointsBRef.current = null;
        pointsOutRef.current = null;
        partsRef.current = null;
        pointsCountRef.current = 0;
      } else if (prepared.mode === "points") {
        interpolatorRef.current = null;

        pointsARef.current = (prepared as any).pointsA ?? null;
        pointsBRef.current = (prepared as any).pointsB ?? null;

        const n = (prepared as any).pointCount ?? 0;
        pointsCountRef.current = n;

        if (n > 0) {
          pointsOutRef.current = new Float32Array(n * 2);
          partsRef.current = new Array(n + 1);
        }
      } else {
        interpolatorRef.current = null;
        // clear points buffers
        pointsARef.current = null;
        pointsBRef.current = null;
        pointsOutRef.current = null;
        partsRef.current = null;
        pointsCountRef.current = 0;
      }

      // crossfade means we use opacity fallback
      const isCrossfade = prepared.mode === "crossfade";
      fallbackRef.current = isCrossfade;

      // notify parent (converter sync). Это вызовет rerender, но React НЕ трогает d, т.к. d не задан в JSX.
      onVectorChange({ d: to, fillMode, strokeWidth, colorScheme });

      setIsMorphing(true);
      progress.set(0);

      animRef.current = animate(progress, 1, {
        duration: 0.8,
        ease: "easeInOut",
        onComplete: () => {
          if (!mountedRef.current) return;
          setIsMorphing(false);
        },
      });

      if (addToHistory) pushHistory(to, targetParams);
    },
    [onVectorChange, progress, pushHistory, fillMode, strokeWidth, colorScheme]
  );

  const handleGenerate = useCallback(() => {
    const nextSeed = lockSeed ? seed : Math.floor(Math.random() * 1_000_000_000) + 1;
    if (!lockSeed) setSeed(nextSeed);

    const nextParams: GeneratorParams = {
      ...params,
      seed: nextSeed,
    };

    const raw = generatePath(nextParams);
    const fitted = fitPathToViewBox(raw);
    startMorph(fitted, nextParams, true);
  }, [lockSeed, seed, params, startMorph]);

  const handleRandomAll = useCallback(() => {
    const nextSeed = Math.floor(Math.random() * 1_000_000_000) + 1;
    const nextStyle = STYLES[randomInt(0, STYLES.length - 1)];
    const nextComplexity = randomInt(1, 10);
    const nextScale = randomInt(80, 320);
    const nextStrokeWidth = randomInt(1, 16);
    const nextCornerRoundness = randomInt(0, 10);

    const fillModes: FillMode[] = ["stroke", "fill", "both"];
    const nextFillMode = fillModes[randomInt(0, fillModes.length - 1)];

    let nextPaletteId = paletteId;
    let nextScheme = colorScheme;
    if (!lockColors) {
      const p = pickRandomPalette();
      nextPaletteId = p.id;
      nextScheme = p.colors;
      setPaletteId(p.id);
      setColorScheme(p.colors);
      setBaseColor(p.colors[0]);
    }

    setSeed(nextSeed);
    setStyle(nextStyle);
    setComplexity(nextComplexity);
    setScale(nextScale);
    setStrokeWidth(nextStrokeWidth);
    setFillMode(nextFillMode);
    setCornerRoundness(nextCornerRoundness);

    const nextParams: GeneratorParams = {
      seed: nextSeed,
      style: nextStyle,
      complexity: nextComplexity,
      scale: nextScale,
      strokeWidth: nextStrokeWidth,
      fillMode: nextFillMode,
      cornerRoundness: nextCornerRoundness,
      paletteId: nextPaletteId,
      colorScheme: nextScheme,
    };

    const raw = generatePath(nextParams);
    const fitted = fitPathToViewBox(raw);
    startMorph(fitted, nextParams, true);
  }, [paletteId, colorScheme, lockColors, setPaletteId, setColorScheme, setBaseColor, setSeed, setStyle, setComplexity, setScale, setStrokeWidth, setFillMode, setCornerRoundness, startMorph]);

  const handleDownloadSvg = useCallback(() => {
    // export target (predictable) or live frame during morph
    const live = morphedPathEl.current?.getAttribute("d");
    const d = live || nextRef.current || initialPathD;

    // compute export attrs
    const expFillColor = colorScheme[0];
    const expStrokeColor = colorScheme[1];
    const expFillAttr = fillMode === "stroke" ? "none" : expFillColor;
    const expStrokeAttr = fillMode === "fill" ? "none" : expStrokeColor;
    const expStrokeW = fillMode === "fill" ? 0 : Math.max(1, Math.min(16, Math.round(strokeWidth)));

    const fileName = `vector-${style}-${paletteId}-seed${seed}-c${complexity}-s${Math.round(
      scale
    )}-w${expStrokeW}.svg`;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">\n  <path d="${escapeXml(
      d
    )}" fill="${expFillAttr}" stroke="${expStrokeAttr}" stroke-width="${expStrokeW}" />\n</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }, [complexity, initialPathD, scale, seed, style, strokeWidth, fillMode, colorScheme, paletteId]);

  const handlePickHistory = useCallback(
    (item: VectorHistoryItem) => {
      setSeed(item.params.seed);
      setComplexity(item.params.complexity);
      setScale(item.params.scale);
      setStyle(item.params.style);
      setStrokeWidth(item.params.strokeWidth);
      setFillMode(item.params.fillMode);
      setPaletteId(item.params.paletteId);
      setColorScheme(item.params.colorScheme);
      setBaseColor(item.params.colorScheme[0]);

      startMorph(item.d, item.params, false);
    },
    [startMorph]
  );

  const applyPalette = useCallback((id: string, colors: [string, string, string]) => {
    setPaletteId(id);
    setColorScheme(colors);
    setBaseColor(colors[0]);
  }, []);

  const handlePaletteChange = useCallback(
    (id: string) => {
      const p = PALETTES.find((x) => x.id === id);
      if (!p) return;
      applyPalette(p.id, p.colors);
    },
    [applyPalette]
  );

  const handleBaseColorChange = useCallback((hex: string) => {
    setPaletteId("custom");
    setBaseColor(hex);
    setColorScheme(deriveSchemeFromBase(hex));
  }, []);

  // Compute fill/stroke attrs based on fillMode and colorScheme
  const fillColor = colorScheme[0];
  const strokeColor = colorScheme[1];
  const fillAttr = fillMode === "stroke" ? "none" : fillColor;
  const strokeAttr = fillMode === "fill" ? "none" : strokeColor;
  const strokeWAttr = fillMode === "fill" ? 0 : strokeWidth;

  return (
    <div className="generator">
      <div className="panel">
        <h2>Генератор</h2>

        <div className="field">
          <div className="fieldHead">
            <span className="fieldLabel">
              Стиль
              <Tooltip text="Выбери характер формы." side="right" />
            </span>
          </div>

          <CardPicker value={style} options={STYLE_CARDS} onChange={(v) => setStyle(v)} disabled={isMorphing} columns={2} />
        </div>

        <div className="field seedField">
          <span className="fieldLabel">
            Seed
            <Tooltip text="Одинаковое значение даёт тот же результат." side="right" />
          </span>
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} step={1} />
        </div>

        <div className="btnRow">
          <span className="fieldLabel">
            <button type="button" className="btn btnPrimary" onClick={handleGenerate} disabled={isMorphing}>
              Сгенерировать
            </button>
            <Tooltip text="Создаёт новый вариант по текущим настройкам." side="right" />
          </span>
          <span className="fieldLabel">
            <button type="button" className="btn btnAccent" onClick={handleRandomAll} disabled={isMorphing}>
              Случайно
            </button>
            <Tooltip text="Перемешивает параметры, чтобы найти идеи." side="right" />
          </span>
          <span className="fieldLabel">
            <button type="button" className="btn btnSuccess" onClick={handleDownloadSvg} disabled={isMorphing}>
              Скачать SVG
            </button>
            <Tooltip text="Сохраняет текущую форму как вектор." side="right" />
          </span>
        </div>

        <label className="field">
          <span className="fieldLabel">
            Сложность <span className="fieldValue">{complexity}</span>
            <Tooltip text="Больше — больше деталей и «неровностей»." side="right" />
          </span>
          <input type="range" min={1} max={10} value={complexity} onChange={(e) => setComplexity(Number(e.target.value))} />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Масштаб <span className="fieldValue">{Math.round(scale)}</span>
            <Tooltip text="Насколько крупно выглядит форма в окне." side="right" />
          </span>
          <input type="range" min={50} max={400} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Толщина линии <span className="fieldValue">{strokeWidth}</span>
            <Tooltip text="Влияет на 2D линию и на 3D «трубку»." side="right" />
          </span>
          <input type="range" min={1} max={16} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Скругление углов <span className="fieldValue">{cornerRoundness}</span>
            <Tooltip text="Делает края мягче и пластичнее." side="right" />
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={cornerRoundness}
            onChange={(e) => setCornerRoundness(Number(e.target.value))}
          />
        </label>

        <div className="field">
          <div className="fieldHead">
            <span className="fieldLabel">
              Режим заливки
              <Tooltip text="Как рисовать: линией, заливкой или вместе." side="right" />
            </span>
          </div>

          <CardPicker value={fillMode} options={FILL_MODE_CARDS} onChange={(v) => setFillMode(v)} disabled={isMorphing} columns={3} />
        </div>

        <label className="field uiHidden">
          <span className="fieldLabel">
            Палитра
            <Tooltip text="Готовые сочетания цветов." side="right" />
          </span>
          <select value={paletteId} onChange={(e) => handlePaletteChange(e.target.value)}>
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="custom">Своя</option>
          </select>
        </label>

        <label className="field">
          <span className="fieldLabel">
            Базовый цвет (свой)
            <Tooltip text="Задаёт основной оттенок вручную." side="right" />
          </span>
          <input type="color" value={baseColor} onChange={(e) => handleBaseColorChange(e.target.value)} />
        </label>

        <label className="checkRow">
          <input type="checkbox" checked={lockColors} onChange={(e) => setLockColors(e.target.checked)} />
          <span className="fieldLabel">
            Зафиксировать цвета (Random не меняет палитру)
            <Tooltip text="Оставит текущие цвета при «Случайно»." side="right" />
          </span>
        </label>

        <label className="checkRow">
          <input type="checkbox" checked={lockSeed} onChange={(e) => setLockSeed(e.target.checked)} />
          <span className="fieldLabel">
            Зафиксировать seed (Generate не меняет seed)
            <Tooltip text="Позволяет менять настройки без смены формы." side="right" />
          </span>
        </label>

        <div className="hint uiHidden">
          <span className="fieldLabel">
            Цвета: {colorScheme[0]} · {colorScheme[1]} · {colorScheme[2]}
            <Tooltip text="Текущее трио оттенков." side="right" />
          </span>
        </div>

        <div className="hint uiHidden">
          <span className="fieldLabel">
            Морфинг <span className="fieldValue">{morphModeUi}</span> {isMorphing ? "· анимация" : ""}
            <Tooltip text="Показывает текущий режим анимации перехода." side="right" />
          </span>
        </div>

        <div className="history">
          <div className="historyTitle fieldLabel">
            История (до 10)
            <Tooltip text="Быстрый доступ к предыдущим вариантам." side="right" />
          </div>
          <div className="historyList">
            {vectorHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                className="historyItem"
                onClick={() => handlePickHistory(item)}
                title={new Date(item.createdAt).toLocaleString()}
                disabled={isMorphing}
              >
                <svg className="thumb" width="56" height="56" viewBox="0 0 500 500">
                  <path
                    d={item.d}
                    fill={item.params.fillMode === "stroke" ? "none" : item.params.colorScheme[0]}
                    stroke={item.params.fillMode === "fill" ? "none" : item.params.colorScheme[1]}
                    strokeWidth={12}
                  />
                </svg>
                <div className="historyMeta">
                  <div className="historyStyle">{item.params.style}</div>
                  <div className="historySmall">
                    seed {item.params.seed} · сложн. {item.params.complexity} · масштаб {Math.round(item.params.scale)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="preview">
        <svg width={500} height={500} viewBox="0 0 500 500">
          <rect x="0" y="0" width="500" height="500" fill="#262626" />

          {/* ВАЖНО: без d={...} — d управляем только через ref */}
          <path ref={morphedPathEl} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWAttr} />
          <path ref={oldPathEl} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWAttr} style={{ opacity: 0 }} />
          <path ref={newPathEl} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWAttr} style={{ opacity: 0 }} />
        </svg>
      </div>
    </div>
  );
};

export default VectorGenerator;

// ===== Morph Engine helpers (top-level) =====

const r2 = (v: number): string => {
  // faster than toFixed in loops
  const x = Math.round(v * 100) / 100;
  return String(x);
};

const isLetter = (t: string) => /^[a-zA-Z]$/.test(t);

const tokenizePath = (d: string): string[] | null => {
  const re = /[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;
  const tokens = d.match(re);
  return tokens && tokens.length ? tokens : null;
};

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
};

/**
 * Parse absolute M/L/C/Z into a polyline (Float32Array [x0,y0,x1,y1...]).
 * For C: sample curve into `curveSamples` segments.
 */
const pathToPolyline = (d: string, curveSamples = 10): Float32Array | null => {
  const tokens = tokenizePath(d);
  if (!tokens) return null;

  let cmd = "";
  let i = 0;

  let x = 0, y = 0;
  let sx = 0, sy = 0;
  const pts: number[] = [];

  while (i < tokens.length) {
    const t = tokens[i];

    if (isLetter(t)) {
      cmd = t;
      i++;

      if (cmd === "Z" || cmd === "z") {
        // close
        if (pts.length >= 2) {
          const lx = pts[pts.length - 2];
          const ly = pts[pts.length - 1];
          if (lx !== sx || ly !== sy) {
            pts.push(sx, sy);
          }
        }
        cmd = "";
      }
      continue;
    }

    // only absolute supported robustly (per spec)
    if (cmd === "M") {
      x = parseFloat(tokens[i]); y = parseFloat(tokens[i + 1]); i += 2;
      sx = x; sy = y;
      pts.push(x, y);
      cmd = "L"; // subsequent pairs are treated as L
      continue;
    }

    if (cmd === "L") {
      x = parseFloat(tokens[i]); y = parseFloat(tokens[i + 1]); i += 2;
      pts.push(x, y);
      continue;
    }

    if (cmd === "C") {
      const x1 = parseFloat(tokens[i]);     const y1 = parseFloat(tokens[i + 1]);
      const x2 = parseFloat(tokens[i + 2]); const y2 = parseFloat(tokens[i + 3]);
      const x3 = parseFloat(tokens[i + 4]); const y3 = parseFloat(tokens[i + 5]);
      i += 6;

      const p0x = x, p0y = y;
      for (let s = 1; s <= curveSamples; s++) {
        const tt = s / curveSamples;
        const cx = cubicAt(p0x, x1, x2, x3, tt);
        const cy = cubicAt(p0y, y1, y2, y3, tt);
        pts.push(cx, cy);
      }

      x = x3; y = y3;
      continue;
    }

    // If unknown command or empty cmd => cannot parse safely
    return null;
  }

  if (pts.length < 6) return null;
  return new Float32Array(pts);
};

const resampleClosedPolyline = (poly: Float32Array, pointCount: number): Float32Array | null => {
  const m = poly.length / 2;
  if (m < 3 || pointCount < 3) return null;

  // ensure closed in distance calculation
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < m; i++) {
    xs.push(poly[i * 2]);
    ys.push(poly[i * 2 + 1]);
  }

  const x0 = xs[0], y0 = ys[0];
  const xl = xs[m - 1], yl = ys[m - 1];
  const closed = xl === x0 && yl === y0;
  if (!closed) {
    xs.push(x0);
    ys.push(y0);
  }

  const segCount = xs.length - 1;
  const segLen = new Float32Array(segCount);
  let perimeter = 0;

  for (let i = 0; i < segCount; i++) {
    const dx = xs[i + 1] - xs[i];
    const dy = ys[i + 1] - ys[i];
    const len = Math.hypot(dx, dy);
    segLen[i] = len;
    perimeter += len;
  }

  if (!Number.isFinite(perimeter) || perimeter < 1e-3) return null;

  const step = perimeter / pointCount;
  const out = new Float32Array(pointCount * 2);

  let segIndex = 0;
  let distInSeg = 0;

  const advanceTo = (targetDist: number) => {
    while (segIndex < segCount && distInSeg + segLen[segIndex] < targetDist) {
      distInSeg += segLen[segIndex];
      segIndex++;
    }
  };

  for (let p = 0; p < pointCount; p++) {
    const target = p * step;
    advanceTo(target);

    const segStartDist = distInSeg;
    const len = segIndex < segCount ? segLen[segIndex] : 0;
    const local = len > 0 ? (target - segStartDist) / len : 0;

    const ax = xs[Math.min(segIndex, xs.length - 2)];
    const ay = ys[Math.min(segIndex, ys.length - 2)];
    const bx = xs[Math.min(segIndex + 1, xs.length - 1)];
    const by = ys[Math.min(segIndex + 1, ys.length - 1)];

    out[p * 2] = ax + (bx - ax) * local;
    out[p * 2 + 1] = ay + (by - ay) * local;
  }

  return out;
};

const benchInterpMs = (interp: (t: number) => string): number => {
  const t0 = performance.now();
  // 3 calls reduces noise
  interp(0.25);
  interp(0.5);
  interp(0.75);
  const t1 = performance.now();
  return (t1 - t0) / 3;
};

const tryFlubber = (from: string, to: string, maxSeg: number) => {
  try {
    const interp = (flubber as any).interpolate(from, to, { maxSegmentLength: maxSeg }) as (t: number) => string;
    const ms = benchInterpMs(interp);
    return { interp, ms };
  } catch {
    return { interp: null as null, ms: Number.POSITIVE_INFINITY };
  }
};

const prepareMorphEngine = (args: { from: string; to: string; complexity: number }) => {
  const { from, to, complexity } = args;

  // adaptive budgets
  const maxLen = Math.max(from.length, to.length);

  // point count based on complexity: 140..260
  const pointCount = Math.max(140, Math.min(260, 110 + complexity * 15));

  // thresholds (под 500x500)
  const HQ_MAXSEG = 1.5;
  const LQ_MAXSEG = 5.0;

  // if very heavy paths => go points first
  if (maxLen > 18000) {
    const pa = pathToPolyline(from);
    const pb = pathToPolyline(to);
    if (pa && pb) {
      const ra = resampleClosedPolyline(pa, pointCount);
      const rb = resampleClosedPolyline(pb, pointCount);
      if (ra && rb) return { mode: "points" as const, pointsA: ra, pointsB: rb, pointCount };
    }
    return { mode: "crossfade" as const };
  }

  // try HQ flubber
  const hq = tryFlubber(from, to, HQ_MAXSEG);
  if (hq.interp && hq.ms <= 6) {
    return { mode: "flubber-hq" as const, interp: hq.interp };
  }

  // try LQ flubber
  const lq = tryFlubber(from, to, LQ_MAXSEG);
  if (lq.interp && lq.ms <= 6) {
    return { mode: "flubber-lq" as const, interp: lq.interp };
  }

  // points morph
  const pa = pathToPolyline(from);
  const pb = pathToPolyline(to);
  if (pa && pb) {
    const ra = resampleClosedPolyline(pa, pointCount);
    const rb = resampleClosedPolyline(pb, pointCount);
    if (ra && rb) return { mode: "points" as const, pointsA: ra, pointsB: rb, pointCount };
  }

  return { mode: "crossfade" as const };
};

// escape XML for attribute/content safety
const escapeXml = (s: string): string => {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
};
