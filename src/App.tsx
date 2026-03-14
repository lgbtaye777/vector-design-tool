import React, { useEffect, useState } from "react";
import "./App.css";
import VectorGenerator from "./components/VectorGenerator";
import Vector3DConverter from "./components/Vector3DConverter";
import type { FillMode } from "./utils/svgPath";
import OnboardingSplash from "./components/OnboardingSplash";


export type AppMode = "generator" | "converter";

type GeneratedVector = {
  d: string;
  fillMode: FillMode;
  strokeWidth: number;
  colorScheme: [string, string, string];
};

const INITIAL_D = "M250 140 L320 360 L180 360 Z";
const ONBOARDING_KEY = "vdt_onboarding_seen_v2";

const isDomTamperRemoveChildError = (e: unknown): boolean => {
  const msg =
    (e as any)?.message ||
    (e as any)?.reason?.message ||
    (e as any)?.error?.message ||
    String(e ?? "");

  const s = String(msg).toLowerCase();
  return (
    s.includes("removechild") &&
    (s.includes("not a child") || s.includes("не является дочерним") || s.includes("notfounderror"))
  );
};

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>("generator");
  const [generatedVector, setGeneratedVector] = useState<GeneratedVector>({
    d: INITIAL_D,
    fillMode: "stroke",
    strokeWidth: 3,
    colorScheme: ["#FF6B6B", "#4ECDC4", "#45B7D1"],
  });
  const [toast, setToast] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(ONBOARDING_KEY) !== "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    let timer: number | undefined;

    const showToast = () => {
      setToast(
        "Похоже, браузерное расширение меняет DOM (например, Google Translate/Grammarly). Отключите расширения для этого сайта или откройте в режиме инкогнито."
      );
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 6000);
    };

    const onErrorCapture = (event: Event) => {
      // ErrorEvent в большинстве случаев
      const ev = event as any;

      if (isDomTamperRemoveChildError(ev?.error ?? ev)) {
        // Пытаемся не отдавать ошибку дальше (часто убирает overlay в dev)
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
        showToast();
      }
    };

    const onRejectionCapture = (event: PromiseRejectionEvent) => {
      if (isDomTamperRemoveChildError(event?.reason)) {
        event.preventDefault();
        showToast();
      }
    };

    window.addEventListener("error", onErrorCapture, true); // capture
    window.addEventListener("unhandledrejection", onRejectionCapture, true);

    return () => {
      window.removeEventListener("error", onErrorCapture, true);
      window.removeEventListener("unhandledrejection", onRejectionCapture, true);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Инструмент векторного дизайна</div>

        <div className="tabs">
          <button
            type="button"
            className={`tab ${mode === "generator" ? "active" : ""}`}
            onClick={() => setMode("generator")}
          >
            Генератор
          </button>
          <button
            type="button"
            className={`tab ${mode === "converter" ? "active" : ""}`}
            onClick={() => setMode("converter")}
          >
            3D-конвертер
          </button>
        </div>
      </header>

      <main className="main">
        {mode === "generator" ? (
          <VectorGenerator
            initialPathD={generatedVector.d}
            onVectorChange={setGeneratedVector}
          />
        ) : (
          <Vector3DConverter
            pathD={generatedVector.d}
            fillMode={generatedVector.fillMode}
            strokeWidth={generatedVector.strokeWidth}
            colorScheme={generatedVector.colorScheme}
          />
        )}
      </main>

      {toast && (
        <div className="toast">
          <div className="toastTitle">Возможен конфликт с расширением</div>
          <div className="toastBody">{toast}</div>
          <button className="toastBtn" type="button" onClick={() => setToast(null)}>
            Закрыть
          </button>
        </div>
      )}
      <OnboardingSplash
        open={showOnboarding}
        onFinish={() => {
          try {
            window.localStorage.setItem(ONBOARDING_KEY, "1");
          } catch {
            // no-op
          }
          setShowOnboarding(false);
        }}
      />
    </div>
  );
};

export default App;
