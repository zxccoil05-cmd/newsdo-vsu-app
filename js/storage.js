/* ============================================================
   Хранение данных на устройстве пользователя.
   Внутри Telegram — CloudStorage (личное зашифрованное хранилище
   Mini App), вне Telegram — localStorage.
   На сервере ничего не хранится.
   ============================================================ */

const Storage = (() => {
  const TOKEN_KEY = "vsu_moodle_token";
  const SESSION_KEY = "vsu_moodle_session";
  const THEME_KEY = "vsu_theme";
  const USERNAME_KEY = "vsu_username";
  const CREDENTIALS_KEY = "vsu_credentials";

  const tg = window.Telegram && window.Telegram.WebApp;
  const cloud = tg && tg.CloudStorage;

  function cloudGet(key) {
    return new Promise((resolve) => {
      cloud.getItem(key, (err, value) => resolve(err ? null : value || null));
    });
  }

  function cloudSet(key, value) {
    return new Promise((resolve) => {
      cloud.setItem(key, value, (err) => resolve(!err));
    });
  }

  function cloudRemove(key) {
    return new Promise((resolve) => {
      cloud.removeItem(key, () => resolve());
    });
  }

  async function rawGet(key) {
    if (cloud) {
      try {
        const value = await cloudGet(key);
        if (value !== null) return value;
      } catch (e) {
        /* переходим на localStorage */
      }
    }
    return localStorage.getItem(key);
  }

  async function rawSet(key, value) {
    localStorage.setItem(key, value);
    if (cloud) {
      try {
        await cloudSet(key, value);
      } catch (e) {
        /* остаёмся на localStorage */
      }
    }
  }

  async function rawRemove(key) {
    localStorage.removeItem(key);
    if (cloud) {
      try {
        await cloudRemove(key);
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* --- токен (режим "token") --- */

  async function getToken() {
    return await rawGet(TOKEN_KEY);
  }

  async function setToken(token) {
    await rawSet(TOKEN_KEY, token);
  }

  async function clearToken() {
    await rawRemove(TOKEN_KEY);
  }

  /* --- сессия (режим "session"): cookie Moodle + sesskey --- */

  async function getSession() {
    const raw = await rawGet(SESSION_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data && data.cookies ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function setSession(session) {
    await rawSet(SESSION_KEY, JSON.stringify(session));
  }

  async function clearSession() {
    await rawRemove(SESSION_KEY);
  }

  /* --- тема оформления --- */

  async function getTheme() {
    return await rawGet(THEME_KEY);
  }

  async function setTheme(value) {
    await rawSet(THEME_KEY, value);
  }

  /* --- имя пользователя (чтобы не вводить логин заново).
         Пароль не сохраняется никогда. --- */

  async function getUsername() {
    return await rawGet(USERNAME_KEY);
  }

  async function setUsername(value) {
    if (value) await rawSet(USERNAME_KEY, value);
  }

  /* --- сохранённые данные входа для автовхода.
         Сохраняются ТОЛЬКО если пользователь поставил галочку. --- */

  async function getCredentials() {
    const raw = await rawGet(CREDENTIALS_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data && data.username && data.password ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function setCredentials(username, password) {
    try {
      await rawSet(CREDENTIALS_KEY, JSON.stringify({ username, password }));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function clearCredentials() {
    await rawRemove(CREDENTIALS_KEY);
  }

  return {
    getToken, setToken, clearToken,
    getSession, setSession, clearSession,
    getTheme, setTheme,
    getUsername, setUsername,
    getCredentials, setCredentials, clearCredentials,
  };
})();
