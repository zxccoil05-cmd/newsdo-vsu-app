/* ============================================================
   Сессионный транспорт: вход через веб-форму Moodle и запросы
   с cookie-сессией. Cookie и sesskey живут только на устройстве
   пользователя, прокси их не сохраняет.
   ============================================================ */

const MoodleSession = (() => {
  const cfg = window.APP_CONFIG;

  let cookies = "";
  let sesskey = null;
  let username = "";

  async function post(url, payload) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new ApiError("network", "Нет связи с прокси. Запущен ли он?");
    }

    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      data = null;
    }
    if (!data) throw new ApiError("proxy", `Прокси вернул некорректный ответ (${response.status})`);
    return data;
  }

  /* Вход. Возвращает cookie-сессию. */
  async function login(login, password) {
    const data = await post(`${cfg.PROXY_URL}/api/session/login`, {
      username: login,
      password,
    });
    if (data.error) throw new ApiError("invalidlogin", data.error);
    cookies = data.cookies || "";
    sesskey = null;
    username = login;
    await Storage.setSession({ cookies, username, savedAt: Date.now() });
    return cookies;
  }

  /* Загрузка внутренней страницы Moodle (HTML). */
  async function page(path) {
    const data = await post(`${cfg.PROXY_URL}/api/session/page`, { cookies, path });
    if (data.cookies) cookies = data.cookies;
    if (data.error) throw new ApiError("session", data.error);
    return data.html || "";
  }

  /* Вызов AJAX-функции Moodle. Возвращает распакованные data. */
  async function ajax(methodname, args) {
    if (!sesskey) throw new ApiError("session", "Сессия не инициализирована");
    const data = await post(`${cfg.PROXY_URL}/api/session/ajax`, {
      cookies,
      sesskey,
      methodname,
      args,
    });
    if (data.cookies) cookies = data.cookies;
    if (data.error) throw new ApiError("session", data.error);

    const result = Array.isArray(data.data) ? data.data[0] : data.data;
    if (!result) throw new ApiError("session", "Пустой ответ Moodle");
    if (result.error) {
      const exception = result.exception || {};
      throw new ApiError(exception.errorcode || "error", exception.message || "Ошибка Moodle");
    }
    return result.data;
  }

  /* Открытие файла или страницы по абсолютной ссылке Moodle.
     Возвращает { kind: "html" | "file", ... } */
  async function open(url) {
    const data = await post(`${cfg.PROXY_URL}/api/session/open`, { cookies, url });
    if (data.cookies) cookies = data.cookies;
    if (data.error) throw new ApiError("session", data.error);
    if (data.kind === "html" && /name="logintoken"/.test(data.html || "")) {
      throw new ApiError("servicerequireslogin", "Сессия истекла");
    }
    return data;
  }

  /* Отправка формы Moodle (прохождение тестов).
     action — адрес формы, fields — все её поля, включая скрытые. */
  async function submit(action, fields) {
    const data = await post(`${cfg.PROXY_URL}/api/session/submit`, { cookies, action, fields });
    if (data.cookies) cookies = data.cookies;
    if (data.error) throw new ApiError("session", data.error);
    if (data.kind === "html" && /name="logintoken"/.test(data.html || "")) {
      throw new ApiError("servicerequireslogin", "Сессия истекла");
    }
    return data;
  }

  /* Восстановление сессии с устройства. */
  async function restore() {
    const saved = await Storage.getSession();
    if (!saved) return false;
    cookies = saved.cookies;
    username = saved.username || "";
    sesskey = null;
    return true;
  }

  async function clear() {
    cookies = "";
    sesskey = null;
    username = "";
    await Storage.clearSession();
  }

  function setSesskey(value) {
    sesskey = value;
  }

  function getSesskey() {
    return sesskey;
  }

  function getUsername() {
    return username;
  }

  return { login, page, ajax, open, submit, restore, clear, setSesskey, getSesskey, getUsername };
})();
