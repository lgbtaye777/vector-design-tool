// src/utils/domTamperGuard.ts
let installed = false;
let toastShown = false;

const TOAST_ID = "__vdt_ext_toast__";

const isRemoveChildDomTamper = (err: unknown): boolean => {
  const anyErr = err as any;
  const msg =
    anyErr?.message ||
    anyErr?.reason?.message ||
    anyErr?.error?.message ||
    String(err ?? "");

  const name = String(anyErr?.name ?? "");
  const s = String(msg).toLowerCase();

  // покрываем EN + RU варианты
  const hasRemoveChild = s.includes("removechild") || s.includes("remove child") || s.includes("удалить дочерний") || s.includes("removechild'");
  const hasNotChild =
    s.includes("not a child") ||
    s.includes("не является дочерним") ||
    s.includes("не является дочерним по отношению") ||
    s.includes("notfounderror") ||
    name.toLowerCase().includes("notfounderror");

  return hasRemoveChild && hasNotChild;
};

const ensureToast = (message: string) => {
  if (toastShown) return;
  toastShown = true;

  const mount = () => {
    if (document.getElementById(TOAST_ID)) return;

    const wrap = document.createElement("div");
    wrap.id = TOAST_ID;
    wrap.setAttribute("role", "alert");
    wrap.style.position = "fixed";
    wrap.style.right = "16px";
    wrap.style.bottom = "16px";
    wrap.style.width = "min(440px, calc(100vw - 32px))";
    wrap.style.background = "#fff";
    wrap.style.border = "1px solid #ff6b6b";
    wrap.style.borderLeftWidth = "6px";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "12px 12px 10px";
    wrap.style.boxShadow = "0 10px 30px rgba(0,0,0,0.12)";
    wrap.style.zIndex = "2147483647";
    wrap.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    wrap.style.color = "#333";

    wrap.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">Возможен конфликт с расширением</div>
      <div style="font-size:13px; line-height:1.35;">
        ${message}
      </div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button id="__vdt_ext_close__" style="padding:8px 10px; border:1px solid #e0e0e0; background:#fff; border-radius:10px; cursor:pointer;">
          Закрыть
        </button>
      </div>
    `;

    document.body.appendChild(wrap);

    const btn = document.getElementById("__vdt_ext_close__");
    btn?.addEventListener("click", () => {
      wrap.remove();
      // позволяем показать снова позже, если опять словим
      toastShown = false;
    });
  };

  if (document.body) mount();
  else window.addEventListener("DOMContentLoaded", mount, { once: true });
};

export const installDomTamperGuard = () => {
  if (installed) return;
  installed = true;

  const message =
    "Похоже, расширение изменяет DOM (Google Translate / Grammarly и т.п.). Отключите расширения для этого сайта или откройте страницу в режиме инкогнито.";

  // 1) Ловим ошибки максимально рано (capture)
  window.addEventListener(
    "error",
    (e: Event) => {
      const ev = e as any;
      const err = ev?.error ?? ev;
      if (isRemoveChildDomTamper(err)) {
        ensureToast(message);
        // пытаемся предотвратить дефолт/оверлей
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
      }
    },
    true
  );

  window.addEventListener(
    "unhandledrejection",
    (e: PromiseRejectionEvent) => {
      if (isRemoveChildDomTamper(e.reason)) {
        ensureToast(message);
        e.preventDefault();
      }
    },
    true
  );

  // 2) Самое важное: гасим конкретно removeChild NotFoundError
  //    Если расширение уже удалило/переместило ноду — для React это "и так удалено".
  const originalRemoveChild = Node.prototype.removeChild;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Node.prototype as any).removeChild = function (child: Node) {
    try {
      return originalRemoveChild.call(this, child);
    } catch (err) {
      if (isRemoveChildDomTamper(err)) {
        ensureToast(message);
        // "удаление" считаем успешным — нода уже не там
        return child;
      }
      throw err;
    }
  };
};
