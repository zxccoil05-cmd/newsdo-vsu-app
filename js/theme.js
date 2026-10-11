/* ============================================================
   Тема оформления: светлая / тёмная / как в системе.
   Выбор хранится на устройстве и применяется к атрибуту data-theme.
   ============================================================ */

const Theme = (() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  let mode = "system";   /* выбранный режим */
  let listeners = [];

  const COLORS = {
    light: "#e8ecf5",
    dark: "#0b0f18",
  };

  function systemMode() {
    return media.matches ? "dark" : "light";
  }

  function resolved() {
    return mode === "system" ? systemMode() : mode;
  }

  function apply() {
    const value = resolved();
    document.documentElement.setAttribute("data-theme", value);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", COLORS[value]);

    if (tg) {
      try {
        tg.setHeaderColor(COLORS[value]);
        tg.setBackgroundColor(COLORS[value]);
      } catch (e) {
        /* старые версии клиента */
      }
    }

    listeners.forEach((fn) => fn(value, mode));
  }

  async function set(next) {
    mode = next;
    apply();
    try {
      await Storage.setTheme(next);
    } catch (e) {
      /* необязательно */
    }
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  async function init() {
    let saved = null;
    try {
      saved = await Storage.getTheme();
    } catch (e) {
      saved = null;
    }
    mode = saved || "system";
    apply();

    const onSystemChange = () => {
      if (mode === "system") apply();
    };
    if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemChange);
    else if (typeof media.addListener === "function") media.addListener(onSystemChange);
  }

  return { init, set, onChange, resolved, get: () => mode };
})();
