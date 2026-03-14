import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type OnboardingSplashProps = {
  open: boolean;
  onFinish: () => void;
};

type Slide = {
  title: string;
  body: React.ReactNode;
};

const OnboardingSplash: React.FC<OnboardingSplashProps> = ({ open, onFinish }) => {
  const [step, setStep] = useState<number>(0);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);

  const slides: Slide[] = useMemo(
    () => [
      {
        title: "О проекте",
        body: (
          <>
            <p className="splashText">
              Данное веб-приложение выполнено студентом группы <b>9ИС-205</b> —{" "}
              <b>Федурин Матвей Евгеньевич</b> — для производственной практики <b>ПМ.09</b>.
            </p>
            <div className="splashNote">
              Подсказка: в любой момент можно нажать «Пропустить» и сразу перейти к приложению.
            </div>
          </>
        ),
      },
      {
        title: "Почему я сделал этот инструмент",
        body: (
          <>
            <p className="splashText">
              Я хотел глубже разобраться с <b>Framer Motion</b> и работой с <b>Canvas/3D</b> в браузере.
              При этом я дизайнер, поэтому решил сделать практичный инструмент, который реально пригодится:
            </p>
            <ul className="splashList">
              <li>быстро генерировать формы для макетов и лендингов</li>
              <li>получать вариации и идеи одной кнопкой</li>
              <li>сразу превращать 2D-форму в 3D-объект и экспортировать модель</li>
            </ul>
          </>
        ),
      },
      {
        title: "Как это работает",
        body: (
          <>
            <ul className="splashList">
              <li>Слева — настройки, справа — предпросмотр.</li>
              <li>Генератор создаёт SVG-контур и плавно «морфит» его при обновлении.</li>
              <li>3D-конвертер берёт тот же путь и превращает его в объём (заливка/контур).</li>
              <li>Готовый результат можно экспортировать (SVG / GLB / GLTF).</li>
            </ul>
            <div className="splashNote">Важно: цвет фона сцены не влияет на экспорт — он остаётся прозрачным.</div>
          </>
        ),
      },
      {
        title: "Как пользоваться",
        body: (
          <>
            <ol className="splashList">
              <li>Откройте «Генератор», выберите стиль и параметры.</li>
              <li>Нажмите <b>«Сгенерировать»</b> — форма обновится плавно.</li>
              <li><b>«Случайно»</b> перемешает параметры, чтобы быстро находить идеи.</li>
              <li>Если нужно — скачайте <b>SVG</b>.</li>
              <li>Перейдите в <b>3D-конвертер</b>, настрой глубину/скругление и скачай <b>GLB/GLTF</b>.</li>
            </ol>
          </>
        ),
      },
    ],
    []
  );

  const total = slides.length;
  const isLast = step >= total - 1;

  const close = useCallback(() => {
    onFinish();
  }, [onFinish]);

  const next = useCallback(() => {
    if (isLast) close();
    else setStep((s) => Math.min(total - 1, s + 1));
  }, [close, isLast, total]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  // lock scroll while open
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // focus primary button
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => primaryBtnRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, step]);

  // esc to skip
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, next, prev]);

  // reset step when reopened (на будущее)
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="splashBackdrop"
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="splashPanel"
            initial={{ y: 18, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="splashTop">
              <div className="splashKicker">Vector Design Tool</div>
              <button className="splashSkip" type="button" onClick={close}>
                Пропустить
              </button>
            </div>

            <div className="splashHead">
              <div className="splashTitle">{slides[step]?.title}</div>
              <div className="splashProgress">
                <span className="splashProgressText">
                  {step + 1}/{total}
                </span>
                <div className="splashDots" aria-hidden="true">
                  {slides.map((_, i) => (
                    <span key={i} className={`splashDot ${i === step ? "active" : ""}`} />
                  ))}
                </div>
              </div>
            </div>

            <div className="splashBody">{slides[step]?.body}</div>

            <div className="splashFooter">
              <button
                className="splashBtn"
                type="button"
                onClick={prev}
                disabled={step === 0}
                aria-disabled={step === 0}
              >
                ← Назад
              </button>

              <button
                ref={primaryBtnRef}
                className="splashBtn splashBtnPrimary"
                type="button"
                onClick={next}
              >
                {isLast ? "Начать →" : "Далее →"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OnboardingSplash;
