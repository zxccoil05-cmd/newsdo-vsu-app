/* ============================================================
   Клиент данных Moodle.
   Работает в двух режимах (см. AUTH_MODE в config.js):

   "session" — вход через веб-форму, cookie-сессия и внутренний
               AJAX-эндпоинт Moodle (/lib/ajax/service.php).
               Если AJAX-функция недоступна, данные берутся
               разбором HTML-страниц.
   "token"   — официальный web-сервис с токеном (moodle_mobile_app).
   ============================================================ */

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

const MoodleApi = (() => {
  const cfg = window.APP_CONFIG;

  const isSession = () => (cfg.AUTH_MODE || "session") === "session";

  /* ===================== Общий HTTP для режима "token" ===================== */

  async function request(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (e) {
      throw new ApiError("network", "Нет связи с сервером. Проверьте подключение.");
    }

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }

    if (data && data.exception) {
      throw new ApiError(data.errorcode || "unknown", data.message || "Ошибка Moodle");
    }
    if (!response.ok) throw new ApiError("http", `Ошибка запроса (${response.status})`);
    return data;
  }

  /* ===================== Режим "token" ===================== */

  const tokenApi = {
    async login(username, password) {
      const data = await request(`${cfg.PROXY_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (data && data.token) return data;
      throw new ApiError(
        (data && data.errorcode) || "unknown",
        (data && data.error) || "Не удалось выполнить вход"
      );
    },

    async call(token, wsfunction, params = {}) {
      return await request(`${cfg.PROXY_URL}/api/ws`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, wsfunction, params }),
      });
    },

    async siteInfo(token) {
      return await tokenApi.call(token, "core_webservice_get_site_info");
    },

    async myCourses(token) {
      const courses = await tokenApi.call(token, "core_enrol_get_users_courses");
      return Array.isArray(courses) ? courses : [];
    },

    async upcomingEvents(token) {
      const now = Math.floor(Date.now() / 1000);
      const result = await tokenApi.call(token, "core_calendar_get_action_events_by_timesort", {
        timesortfrom: now - cfg.CALENDAR_DAYS_BACK * 86400,
        timesortto: now + cfg.CALENDAR_DAYS_AHEAD * 86400,
        limitnum: cfg.CALENDAR_LIMIT,
      });
      return (result && result.events) || [];
    },
  };

  /* ===================== Режим "session" ===================== */

  /* Ошибки, означающие, что сессия Moodle больше не действует */
  function isSessionError(err) {
    return !!err && (
      err.code === "servicerequireslogin" ||
      err.code === "invalidtoken"
    );
  }

  /* Если вместо страницы Moodle вернул форму входа — сессия истекла */
  function ensureLoggedIn(html) {
    if (/name="logintoken"/.test(html)) {
      throw new ApiError("servicerequireslogin", "Сессия истекла");
    }
  }

  const sessionApi = {
    async login(username, password) {
      await MoodleSession.login(username, password);
      return true;
    },

    async restore() {
      return await MoodleSession.restore();
    },

    async logout() {
      await MoodleSession.clear();
    },
    /* Сводка о пользователе + инициализация sesskey */
    async siteInfo() {
      const html = await MoodleSession.page(cfg.PATHS.dashboard);
      const key = MoodleParse.sesskey(html);
      if (key) MoodleSession.setSesskey(key);
      const fullname = MoodleParse.fullname(html);
      const avatar = MoodleParse.userPicture(html);
      const userId = MoodleParse.userId(html);
      const username = MoodleSession.getUsername();
      return {
        fullname: fullname || username || "",
        avatar: avatar || "",
        userid: userId || 0,
      };
    },

    /* Продление сессии: любой авторизованный запрос сбрасывает
       таймер неактивности Moodle (у ВГУ он 30 минут). */
    async ping(userid) {
      if (!userid) return null;
      return await MoodleSession.ajax("core_message_get_unread_conversations_count", {
        useridto: userid,
      });
    },

    /* Курсы: сначала AJAX, при неудаче — разбор страницы */
    async myCourses() {
      try {
        const data = await MoodleSession.ajax(
          "core_course_get_enrolled_courses_by_timeline_classification",
          { offset: 0, limit: 0, classification: "all", sort: "fullname" }
        );
        const courses = (data && data.courses) || [];
        if (courses.length) {
          return courses.map((c) => ({
            id: c.id,
            fullname: c.fullname,
            shortname: c.shortname || "",
          }));
        }
      } catch (e) {
        if (isSessionError(e)) throw e;
        /* уходим на разбор HTML */
      }
      const html = await MoodleSession.page(cfg.PATHS.courses);
      ensureLoggedIn(html);
      let list = MoodleParse.courses(html);
      if (!list.length) {
        /* страница «Мои курсы» может быть недоступна — пробуем дашборд */
        const dashHtml = await MoodleSession.page(cfg.PATHS.dashboard);
        ensureLoggedIn(dashHtml);
        list = MoodleParse.courses(dashHtml);
      }
      return list;
    },

    /* Ближайшие сроки: сначала AJAX, при неудаче — разбор страницы */
    async upcomingEvents() {
      const now = Math.floor(Date.now() / 1000);
      try {
        const data = await MoodleSession.ajax(
          "core_calendar_get_action_events_by_timesort",
          {
            timesortfrom: now - cfg.CALENDAR_DAYS_BACK * 86400,
            timesortto: now + cfg.CALENDAR_DAYS_AHEAD * 86400,
            limitnum: cfg.CALENDAR_LIMIT,
          }
        );
        const events = (data && data.events) || [];
        if (events.length) return events;
      } catch (e) {
        if (isSessionError(e)) throw e;
        /* уходим на разбор HTML */
      }
      const html = await MoodleSession.page(cfg.PATHS.upcoming);
      ensureLoggedIn(html);
      return MoodleParse.events(html);
    },

    /* Элементы курса (задания, тесты, файлы и т.д.) */
    async courseActivities(courseId) {
      const html = await MoodleSession.page(`${cfg.PATHS.course}${courseId}`);
      ensureLoggedIn(html);
      return MoodleParse.activities(html);
    },
  };

  /* ===================== Публичный интерфейс ===================== */

  return {
    mode: () => (isSession() ? "session" : "token"),
    token: tokenApi,
    session: sessionApi,
  };
})();
