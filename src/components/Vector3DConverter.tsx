import React, { useCallback, useMemo, useState } from "react";
import Tooltip from "./Tooltip";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { FillMode } from "../utils/svgPath";

export interface Vector3DConverterProps {
  pathD: string;
  fillMode: FillMode;
  strokeWidth: number;
  colorScheme: [string, string, string];
}

type ParseResult =
  | { ok: true; shapes: THREE.Shape[]; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

const SVG_SIZE = 500;
const HALF = SVG_SIZE / 2;

// SVG(0..500) -> local centered coords
const toLocal = (x: number, y: number): [number, number] => [x - HALF, -(y - HALF)];

const isCmd = (t: string) => /^[a-zA-Z]$/.test(t);

const tokenizePath = (d: string): string[] => {
  // commands or numbers, supports scientific notation
  const re = /[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;
  return d.match(re) ?? [];
};

const parseSvgPathToShapes = (d: string): ParseResult => {
  const warnings: string[] = [];

  const tokens = tokenizePath(d);
  if (tokens.length === 0) {
    return { ok: false, error: "Empty path data.", warnings };
  }

  // We will build a ShapePath (supports multiple subpaths),
  // then convert to shapes via toShapes(true).
  const sp = new THREE.ShapePath();

  let cmd = "";
  let i = 0;

  // current point (SVG coords)
  let cx = 0;
  let cy = 0;

  // subpath start
  let sx = 0;
  let sy = 0;

  // whether we started any subpath
  let hasSubpath = false;

  const readNum = (): number | null => {
    if (i >= tokens.length) return null;
    const n = Number(tokens[i]);
    if (!Number.isFinite(n)) return null;
    i++;
    return n;
  };

  const moveToAbs = (x: number, y: number) => {
    const [lx, ly] = toLocal(x, y);
    sp.moveTo(lx, ly);
    cx = x;
    cy = y;
    sx = x;
    sy = y;
    hasSubpath = true;
  };

  const lineToAbs = (x: number, y: number) => {
    const [lx, ly] = toLocal(x, y);
    sp.lineTo(lx, ly);
    cx = x;
    cy = y;
  };

  const bezierToAbs = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const [lx1, ly1] = toLocal(x1, y1);
    const [lx2, ly2] = toLocal(x2, y2);
    const [lx, ly] = toLocal(x, y);
    sp.bezierCurveTo(lx1, ly1, lx2, ly2, lx, ly);
    cx = x;
    cy = y;
  };

  while (i < tokens.length) {
    const t = tokens[i];

    if (isCmd(t)) {
      cmd = t;
      i++;
      continue;
    }

    // If command missing, SVG spec allows repeating previous command,
    // but for safety we require a valid cmd after the first segment.
    if (!cmd) {
      return { ok: false, error: "Path parsing failed: missing command.", warnings };
    }

    // M/m: move (then implicit L/l for subsequent pairs)
    if (cmd === "M" || cmd === "m") {
      const x0 = readNum();
      const y0 = readNum();
      if (x0 === null || y0 === null) return { ok: false, error: "Invalid M command.", warnings };

      const x = cmd === "m" ? cx + x0 : x0;
      const y = cmd === "m" ? cy + y0 : y0;

      moveToAbs(x, y);

      // subsequent pairs are treated as L/l
      cmd = cmd === "m" ? "l" : "L";
      continue;
    }

    // L/l: line
    if (cmd === "L" || cmd === "l") {
      const x0 = readNum();
      const y0 = readNum();
      if (x0 === null || y0 === null) return { ok: false, error: "Invalid L command.", warnings };

      const x = cmd === "l" ? cx + x0 : x0;
      const y = cmd === "l" ? cy + y0 : y0;

      if (!hasSubpath) warnings.push("Line command before moveTo; assuming moveTo(0,0).");
      if (!hasSubpath) moveToAbs(0, 0);

      lineToAbs(x, y);
      continue;
    }

    // C/c: cubic bezier
    if (cmd === "C" || cmd === "c") {
      const x10 = readNum();
      const y10 = readNum();
      const x20 = readNum();
      const y20 = readNum();
      const x30 = readNum();
      const y30 = readNum();

      if (x10 === null || y10 === null || x20 === null || y20 === null || x30 === null || y30 === null) {
        return { ok: false, error: "Invalid C command.", warnings };
      }

      const x1 = cmd === "c" ? cx + x10 : x10;
      const y1 = cmd === "c" ? cy + y10 : y10;
      const x2 = cmd === "c" ? cx + x20 : x20;
      const y2 = cmd === "c" ? cy + y20 : y20;
      const x = cmd === "c" ? cx + x30 : x30;
      const y = cmd === "c" ? cy + y30 : y30;

      if (!hasSubpath) warnings.push("Cubic command before moveTo; assuming moveTo(0,0).");
      if (!hasSubpath) moveToAbs(0, 0);

      bezierToAbs(x1, y1, x2, y2, x, y);
      continue;
    }

    // Z/z: close (note: can appear without numbers)
    if (cmd === "Z" || cmd === "z") {
      if (!hasSubpath) {
        warnings.push("ClosePath without subpath.");
      } else {
        // close by line to start if needed
        if (cx !== sx || cy !== sy) {
          lineToAbs(sx, sy);
        }
      }
      cmd = "";
      continue;
    }

    // If we hit an unsupported command:
    return {
      ok: false,
      error: `Unsupported SVG command: "${cmd}". Supported: M, L, C, Z (and lowercase).`,
      warnings,
    };
  }

  // Convert to shapes (true = treat subpaths as solid shapes where possible)
  const shapes = sp.toShapes(true);

  if (shapes.length === 0) {
    return { ok: false, error: "Could not derive shapes from path (is it closed / filled?).", warnings };
  }

  return { ok: true, shapes, warnings };
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const Vector3DConverter: React.FC<Vector3DConverterProps> = ({ pathD, fillMode, strokeWidth, colorScheme }) => {
  // MVP 3D controls
  const [depth, setDepth] = useState<number>(20);
  const [bevelEnabled, setBevelEnabled] = useState<boolean>(true);
  const [bevelThickness, setBevelThickness] = useState<number>(2);
  const [bevelSize, setBevelSize] = useState<number>(1.5);
  const [bevelSegments, setBevelSegments] = useState<number>(2);
  const [smoothness, setSmoothness] = useState<number>(6);
  const [cornerRoundness, setCornerRoundness] = useState<number>(0);
  const [tubeRadiusMul, setTubeRadiusMul] = useState<number>(1);
  const [tubeRadialSegments, setTubeRadialSegments] = useState<number>(12);
  const [tubeTubularMul, setTubeTubularMul] = useState<number>(6);
  const [renderFill, setRenderFill] = useState<boolean>(true);
  const [renderStroke, setRenderStroke] = useState<boolean>(true);

  const [overrideColor, setOverrideColor] = useState<boolean>(false);
  const [materialColor, setMaterialColor] = useState<string>(colorScheme[0]);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // keep default 3D color in sync when generator changes scheme, unless overridden
  React.useEffect(() => {
    if (!overrideColor) setMaterialColor(colorScheme[0]);
  }, [colorScheme, overrideColor]);

  React.useEffect(() => {
    if (fillMode === "fill") {
      setRenderFill(true);
      setRenderStroke(false);
    } else if (fillMode === "stroke") {
      setRenderFill(false);
      setRenderStroke(true);
    } else {
      setRenderFill(true);
      setRenderStroke(true);
    }
  }, [fillMode]);

  const parse = useMemo(() => parseSvgPathToShapes(pathD), [pathD]);

  const geometries = useMemo(() => {
    if (!parse.ok) return { fillGeos: [] as THREE.BufferGeometry[], strokeGeos: [] as THREE.BufferGeometry[] };

    const wantStroke3D = fillMode === "stroke" || fillMode === "both";
    const wantFill3D = fillMode === "fill" || fillMode === "both";

    const d = clamp(depth, 1, 100);
    const bt = clamp(bevelThickness, 0, 10);
    const bs = clamp(bevelSize, 0, 10);
    const bsegBase = clamp(Math.floor(bevelSegments), 1, 12);
    const bseg = bevelEnabled ? clamp(bsegBase + Math.floor(smoothness / 3), 1, 16) : 1;
    const curveSegments = 8 + smoothness * 2;

    const opts: THREE.ExtrudeGeometryOptions = {
      depth: d,
      bevelEnabled,
      bevelThickness: bt,
      bevelSize: bs,
      bevelSegments: bseg,
      curveSegments,
      steps: 1,
    };

    const fillGeos: THREE.BufferGeometry[] = [];
    if (wantFill3D) {
      const fillShapes = parse.shapes.map((shape) => (cornerRoundness > 0 ? roundShape(shape, cornerRoundness) : shape));
      for (const s of fillShapes) {
        const g = new THREE.ExtrudeGeometry(s, opts);
        g.computeVertexNormals();
        g.computeBoundingBox();
        fillGeos.push(g);
      }
    }

    const strokeGeos: THREE.BufferGeometry[] = [];
    if (wantStroke3D) {
      const curveSamples = 10 + smoothness * 2;
      const subpaths = parsePathToStrokeSubpaths(pathD, curveSamples);

      const radius = Math.max(0.2, strokeWidth * 0.5 * tubeRadiusMul);
      const radialSegments = tubeRadialSegments;

      for (const sp of subpaths) {
        if (sp.points.length < 2) continue;

        const curve = new THREE.CatmullRomCurve3(sp.points, sp.closed, "centripetal", 0.5);
        const tubularSegments = Math.max(40, Math.min(900, sp.points.length * tubeTubularMul));

        const tg = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, sp.closed);
        tg.computeVertexNormals();
        tg.computeBoundingBox();
        strokeGeos.push(tg);
      }
    }

    return { fillGeos, strokeGeos };
  }, [
    parse,
    pathD,
    fillMode,
    strokeWidth,
    depth,
    bevelEnabled,
    bevelThickness,
    bevelSize,
    bevelSegments,
    smoothness,
    cornerRoundness,
    tubeRadiusMul,
    tubeRadialSegments,
    tubeTubularMul,
  ]);

  const wantStroke3D = fillMode === "stroke" || fillMode === "both";
  const wantFill3D = fillMode === "fill" || fillMode === "both";
  const hasGeometry = geometries.fillGeos.length + geometries.strokeGeos.length > 0;

  const fit = useMemo(() => {
    const all = [...geometries.fillGeos, ...geometries.strokeGeos];
    if (all.length === 0) {
      return { position: new THREE.Vector3(0, 0, 0), scale: 1 };
    }

    const box = new THREE.Box3();
    for (const g of all) {
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox);
    }

    const size = new THREE.Vector3();
    box.getSize(size);

    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const target = 90;
    const scale = maxDim > 1e-6 ? target / maxDim : 1;

    return { position: center.multiplyScalar(-1), scale };
  }, [geometries]);

  const buildExportGroup = useCallback(() => {
    const root = new THREE.Group();
    root.name = "VDT_Export";
    root.position.copy(fit.position);
    root.scale.setScalar(fit.scale);

    const fillColor = overrideColor ? materialColor : colorScheme[0];
    const strokeColor = overrideColor ? materialColor : colorScheme[1];

    const fillMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(fillColor),
      roughness: 0.65,
      metalness: 0,
    });

    const strokeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(strokeColor),
      roughness: 0.65,
      metalness: 0,
    });

    const createdGeos: THREE.BufferGeometry[] = [];
    const createdMats: THREE.Material[] = [fillMat, strokeMat];

    const addMeshes = (geos: THREE.BufferGeometry[], mat: THREE.Material, prefix: string) => {
      for (let i = 0; i < geos.length; i++) {
        const g = geos[i].clone();
        createdGeos.push(g);
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `${prefix}_${i}`;
        root.add(mesh);
      }
    };

    if (renderFill && geometries.fillGeos.length > 0) addMeshes(geometries.fillGeos, fillMat, "Fill");
    if (renderStroke && geometries.strokeGeos.length > 0) addMeshes(geometries.strokeGeos, strokeMat, "Stroke");

    const dispose = () => {
      for (const g of createdGeos) g.dispose();
      for (const m of createdMats) m.dispose();
    };

    return { root, dispose };
  }, [fit.position, fit.scale, geometries, renderFill, renderStroke, overrideColor, materialColor, colorScheme]);

  const handleExportGLB = useCallback(() => {
    setExportError(null);

    if (!hasGeometry) {
      setExportError("No geometry to export.");
      return;
    }

    setIsExporting(true);

    const { root, dispose } = buildExportGroup();
    const exporter = new GLTFExporter();

    exporter.parse(
      root,
      (result) => {
        try {
          if (result instanceof ArrayBuffer) {
            const blob = new Blob([result], { type: "model/gltf-binary" });
            const name = `vdt-${fillMode}-${renderFill ? "fill" : "nofill"}-${renderStroke ? "stroke" : "nostroke"}.glb`;
            downloadBlob(blob, name);
          } else {
            const json = JSON.stringify(result, null, 2);
            const blob = new Blob([json], { type: "model/gltf+json" });
            downloadBlob(blob, "vdt-export.gltf");
          }
        } finally {
          dispose();
          setIsExporting(false);
        }
      },
      (err) => {
        dispose();
        setIsExporting(false);
        setExportError(err?.message ? String(err.message) : "Export failed.");
      },
      {
        binary: true,
        trs: true,
      }
    );
  }, [buildExportGroup, fillMode, hasGeometry, renderFill, renderStroke]);

  const handleExportGLTF = useCallback(() => {
    setExportError(null);

    if (!hasGeometry) {
      setExportError("No geometry to export.");
      return;
    }

    setIsExporting(true);

    const { root, dispose } = buildExportGroup();
    const exporter = new GLTFExporter();

    exporter.parse(
      root,
      (result) => {
        try {
          const json = JSON.stringify(result, null, 2);
          const blob = new Blob([json], { type: "model/gltf+json" });
          const name = `vdt-${fillMode}-${renderFill ? "fill" : "nofill"}-${renderStroke ? "stroke" : "nostroke"}.gltf`;
          downloadBlob(blob, name);
        } finally {
          dispose();
          setIsExporting(false);
        }
      },
      (err) => {
        dispose();
        setIsExporting(false);
        setExportError(err?.message ? String(err.message) : "Export failed.");
      },
      {
        binary: false,
        trs: true,
      }
    );
  }, [buildExportGroup, fillMode, hasGeometry, renderFill, renderStroke]);

  const showFillWarning = fillMode === "stroke";

  return (
    <div className="converter">
      <div className="panel">
        <h2>3D-конвертер</h2>

        {showFillWarning && (
          <div className="hint hintWarn">
            Примечание: при режиме «заливка» используется экструзия, при «контур» — 3D-трубка по пути. Если путь открыт, результат может отличаться.
          </div>
        )}

        {!parse.ok ? (
          <div className="hint hintError">
            Parse error: {parse.error}
            {parse.warnings.length > 0 && (
              <div style={{ marginTop: 8 }}>
                Дополнительно:
                <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                  {parse.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          parse.warnings.length > 0 && (
            <div className="hint">
              Warnings:
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {parse.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )
        )}

        {!hasGeometry && (
          <div className="hint hintError">
            Нет 3D-геометрии для этого вектора. Попробуйте другой стиль/seed или измените режим.
          </div>
        )}

        {fillMode === "both" && (
          <>
            <label className="checkRow">
              <input type="checkbox" checked={renderFill} onChange={(e) => setRenderFill(e.target.checked)} />
              <span className="fieldLabel">
                Показать заливку
                <Tooltip text="Скрыть или показать объёмную часть." side="right" />
              </span>
            </label>

            <label className="checkRow">
              <input type="checkbox" checked={renderStroke} onChange={(e) => setRenderStroke(e.target.checked)} />
              <span className="fieldLabel">
                Показать контур
                <Tooltip text="Скрыть или показать 3D-контур." side="right" />
              </span>
            </label>

            <div className="hint">
              Цвет заливки: <code>{colorScheme[0]}</code> · Цвет контура: <code>{colorScheme[1]}</code>
            </div>
          </>
        )}

        <label className="field">
          <span className="fieldLabel">
            Глубина <span className="fieldValue">{depth}</span>
            <Tooltip text="Насколько «толстая» модель по Z." side="right" />
          </span>
          <input
            type="range"
            min={1}
            max={100}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            disabled={!wantFill3D || !hasGeometry}
          />
        </label>

        <label className="checkRow">
          <input
            type="checkbox"
            checked={bevelEnabled}
            onChange={(e) => setBevelEnabled(e.target.checked)}
            disabled={!wantFill3D || !hasGeometry}
          />
          <span className="fieldLabel">
            Скругление граней (bevel)
            <Tooltip text="Сглаживает острые ребра." side="right" />
          </span>
        </label>

        <label className="field">
          <span className="fieldLabel">
            Толщина bevel <span className="fieldValue">{bevelThickness}</span>
            <Tooltip text="Сила скругления по краю." side="right" />
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={bevelThickness}
            onChange={(e) => setBevelThickness(Number(e.target.value))}
            disabled={!bevelEnabled || !wantFill3D || !hasGeometry}
          />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Плавность <span className="fieldValue">{smoothness}</span>
            <Tooltip text="Делает кривые и трубку более гладкими." side="right" />
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={smoothness}
            onChange={(e) => setSmoothness(Number(e.target.value))}
            disabled={!hasGeometry}
          />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Скругление углов <span className="fieldValue">{cornerRoundness}</span>
            <Tooltip text="Смягчает силуэт ещё до 3D." side="right" />
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={cornerRoundness}
            onChange={(e) => setCornerRoundness(Number(e.target.value))}
            disabled={!wantFill3D || !hasGeometry}
          />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Размер bevel <span className="fieldValue">{bevelSize}</span>
            <Tooltip text="Ширина фаски по контуру." side="right" />
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={bevelSize}
            onChange={(e) => setBevelSize(Number(e.target.value))}
            disabled={!bevelEnabled || !wantFill3D || !hasGeometry}
          />
        </label>

        <label className="field">
          <span className="fieldLabel">
            Сегменты bevel <span className="fieldValue">{bevelSegments}</span>
            <Tooltip text="Больше — плавнее, но тяжелее." side="right" />
          </span>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={bevelSegments}
            onChange={(e) => setBevelSegments(Number(e.target.value))}
            disabled={!bevelEnabled || !wantFill3D || !hasGeometry}
          />
        </label>

        {wantStroke3D && (
          <>
            <div className="hint fieldLabel">
              Контур в 3D = объёмная трубка по пути.
              <Tooltip text="При режиме контур создаётся трубка вдоль линии." side="right" />
            </div>

            <label className="field">
              <span className="fieldLabel">
                Множитель радиуса трубки{" "}
                <span className="fieldValue">{tubeRadiusMul.toFixed(1)}</span>
                <Tooltip text="Контур станет толще или тоньше." side="right" />
              </span>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.1}
                value={tubeRadiusMul}
                onChange={(e) => setTubeRadiusMul(Number(e.target.value))}
                disabled={!hasGeometry}
              />
            </label>

            <label className="field">
              <span className="fieldLabel">
                Сегменты по окружности <span className="fieldValue">{tubeRadialSegments}</span>
                <Tooltip text="Круглее трубка (больше — тяжелее)." side="right" />
              </span>
              <input
                type="range"
                min={6}
                max={32}
                step={1}
                value={tubeRadialSegments}
                onChange={(e) => setTubeRadialSegments(Number(e.target.value))}
                disabled={!hasGeometry}
              />
            </label>

            <label className="field">
              <span className="fieldLabel">
                Плотность сегментов по длине <span className="fieldValue">{tubeTubularMul}</span>
                <Tooltip text="Плавнее изгибы (больше — тяжелее)." side="right" />
              </span>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={tubeTubularMul}
                onChange={(e) => setTubeTubularMul(Number(e.target.value))}
                disabled={!hasGeometry}
              />
            </label>
          </>
        )}

        <label className="checkRow">
          <input type="checkbox" checked={overrideColor} onChange={(e) => setOverrideColor(e.target.checked)} />
          <span className="fieldLabel">
            Переопределить цвет
            <Tooltip text="Покрасить модель вручную." side="right" />
          </span>
        </label>

        <label className="checkRow">
          <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
          <span className="fieldLabel">
            Автоповорот
            <Tooltip text="Медленно вращает модель для осмотра." side="right" />
          </span>
        </label>

        <label className="field">
          <span className="fieldLabel">
            Цвет материала
            <Tooltip text="Выберите оттенок для режима Override." side="right" />
          </span>
          <input type="color" value={materialColor} onChange={(e) => setMaterialColor(e.target.value)} />
        </label>

        <div className="hint">
          <span className="fieldLabel">
            Используется: {overrideColor ? "переопределённый" : "генератора"} цвет — <code>{overrideColor ? materialColor : colorScheme[0]}</code>
            <Tooltip text="Показывает, какой оттенок применён сейчас." side="right" />
          </span>
        </div>

        <div className="btnRow">
          <span className="fieldLabel">
            <button type="button" className="btn btnSuccess" onClick={handleExportGLB} disabled={isExporting || !hasGeometry}>
              Скачать GLB
            </button>
            <Tooltip text="Подходит для Blender, Unity и большинства сцен." side="right" />
          </span>
          <span className="fieldLabel">
            <button type="button" className="btn btnAccent" onClick={handleExportGLTF} disabled={isExporting || !hasGeometry}>
              Скачать GLTF
            </button>
            <Tooltip text="Текстовый вариант формата glTF (удобен для диффов)." side="right" />
          </span>
        </div>

        {exportError && (
          <div className="hint hintError">
            Export error: {exportError}
          </div>
        )}
      </div>

      <div className="preview3d">
        <Canvas camera={{ position: [0, 0, 140], fov: 45 }}>
          <color attach="background" args={["#181818"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 10, 10]} intensity={0.8} />
          <pointLight position={[-10, -10, 10]} intensity={0.4} />

          <group position={fit.position} scale={fit.scale}>
            {renderFill &&
              geometries.fillGeos.map((g, idx) => (
                <mesh key={`fill-${idx}`} geometry={g}>
                  <meshPhongMaterial
                    color={overrideColor ? materialColor : colorScheme[0]}
                    emissive={overrideColor ? materialColor : colorScheme[0]}
                    emissiveIntensity={0.08}
                    shininess={110}
                  />
                </mesh>
              ))}

            {renderStroke &&
              geometries.strokeGeos.map((g, idx) => (
                <mesh key={`stroke-${idx}`} geometry={g}>
                  <meshPhongMaterial
                    color={overrideColor ? materialColor : colorScheme[1]}
                    emissive={overrideColor ? materialColor : colorScheme[1]}
                    emissiveIntensity={0.08}
                    shininess={110}
                  />
                </mesh>
              ))}
          </group>

          <OrbitControls enableDamping dampingFactor={0.08} autoRotate={autoRotate} autoRotateSpeed={2} />
        </Canvas>
      </div>
    </div>
  );
};

export default Vector3DConverter;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const ensureClosed = (pts: THREE.Vector2[]): THREE.Vector2[] => {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.x === b.x && a.y === b.y) return pts;
  return [...pts, a.clone()];
};

const chaikinClosed = (ptsIn: THREE.Vector2[], iterations: number): THREE.Vector2[] => {
  let pts = ensureClosed(ptsIn);
  if (pts.length < 4) return pts;

  for (let it = 0; it < iterations; it++) {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];

      const Q = new THREE.Vector2(0.75 * p.x + 0.25 * q.x, 0.75 * p.y + 0.25 * q.y);
      const R = new THREE.Vector2(0.25 * p.x + 0.75 * q.x, 0.25 * p.y + 0.75 * q.y);

      out.push(Q, R);
    }
    out.push(out[0].clone());
    pts = out;
    if (pts.length > 2000) break;
  }

  return pts;
};

const roundShape = (shape: THREE.Shape, roundness0to10: number): THREE.Shape => {
  const iters = Math.max(0, Math.min(4, Math.floor(roundness0to10 / 2)));

  if (iters === 0) return shape;

  const divisions = 64 + iters * 64;
  const outline = shape.getPoints(divisions);

  if (outline.length < 3) return shape;

  const smoothOutline = chaikinClosed(outline, iters);

  const s = new THREE.Shape();
  s.moveTo(smoothOutline[0].x, smoothOutline[0].y);
  for (let i = 1; i < smoothOutline.length; i++) {
    s.lineTo(smoothOutline[i].x, smoothOutline[i].y);
  }

  if (shape.holes && shape.holes.length > 0) {
    for (const hole of shape.holes) {
      const holePts = hole.getPoints(divisions);
      if (holePts.length < 3) continue;

      const smoothHole = chaikinClosed(holePts, iters);
      const p = new THREE.Path();
      p.moveTo(smoothHole[0].x, smoothHole[0].y);
      for (let i = 1; i < smoothHole.length; i++) p.lineTo(smoothHole[i].x, smoothHole[i].y);
      s.holes.push(p);
    }
  }

  return s;
};

type StrokeSubpath = { points: THREE.Vector3[]; closed: boolean };

const tokenizePath2 = (d: string): string[] => {
  const re = /[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;
  return d.match(re) ?? [];
};

const isCmd2 = (t: string) => /^[a-zA-Z]$/.test(t);

const toLocal3 = (x: number, y: number): THREE.Vector3 => {
  const [lx, ly] = [x - HALF, -(y - HALF)];
  return new THREE.Vector3(lx, ly, 0);
};

const cubicAt2 = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};

const parsePathToStrokeSubpaths = (d: string, curveSamples = 10): StrokeSubpath[] => {
  const tokens = tokenizePath2(d);
  if (tokens.length === 0) return [];

  let cmd = "";
  let i = 0;

  let cx = 0;
  let cy = 0;

  let current: THREE.Vector3[] = [];
  let currentClosed = false;
  const out: StrokeSubpath[] = [];

  const flush = () => {
    if (current.length >= 2) out.push({ points: current, closed: currentClosed });
    current = [];
    currentClosed = false;
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

    if (isCmd2(t)) {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        currentClosed = true;
        if (current.length >= 2) {
          const first = current[0];
          const last = current[current.length - 1];
          if (first.distanceToSquared(last) > 1e-9) current.push(first.clone());
        }
        flush();
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
      current.push(toLocal3(x, y));

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
      current.push(toLocal3(x, y));
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
        const x = cubicAt2(p0x, x1, x2, x3, tt);
        const y = cubicAt2(p0y, y1, y2, y3, tt);
        current.push(toLocal3(x, y));
      }

      cx = x3;
      cy = y3;
      continue;
    }

    break;
  }

  flush();
  return out;
};
