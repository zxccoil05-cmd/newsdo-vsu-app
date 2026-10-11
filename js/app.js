/* ============================================================
   Логика приложения: вход, кабинет, курсы, материалы, тесты,
   настройки и тема оформления.
   ============================================================ */

(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const AUTHOR_URL = "https://t.me/wch8h";

  /* ---------- Элементы ---------- */
  const elTopbar = $("topbar");
  const elFooter = $("footer");
  const elTopbarUser = $("topbar-user");
  const elAvatar = $("topbar-avatar");
  const elHomeAvatar = $("home-avatar");
  const elBtnSettings = $("btn-settings");

  const viewLogin = $("view-login");
  const viewHome = $("view-home");
  const viewCourse = $("view-course");
  const viewMaterial = $("view-material");

  const loginForm = $("login-form");
  const loginUsername = $("login-username");
  const loginPassword = $("login-password");
  const loginSubmit = $("login-submit");
  const loginError = $("login-error");
  const loginNotice = $("login-notice");
  const loginRemember = $("login-remember");
  const settingsForget = $("settings-forget");
  const loginAuthor = $("login-author");
  const footerAuthor = $("footer-author");

  const homeGreeting = $("home-greeting");
  const homeDate = $("home-date");
  const deadlinesList = $("deadlines-list");
  const deadlinesEmpty = $("deadlines-empty");
  const deadlinesLoader = $("deadlines-loader");
  const deadlinesNote = $("deadlines-note");
  const coursesList = $("courses-list");
  const coursesLoader = $("courses-loader");
  const coursesLoaderPanel = $("courses-loader-panel");
  const coursesCount = $("courses-count");

  const courseBack = $("course-back");
  const courseCode = $("course-code");
  const courseTitle = $("course-title");
  const assignmentsList = $("assignments-list");
  const assignmentsEmpty = $("assignments-empty");
  const assignmentsLoader = $("assignments-loader");
  const assignmentsCount = $("assignments-count");

  const materialBack = $("material-back");
  const materialKicker = $("material-kicker");
  const materialTitle = $("material-title");
  const materialActions = $("material-actions");
  const materialFilesBlock = $("material-files-block");
  const materialFiles = $("material-files");
  const materialFilesCount = $("material-files-count");
  const materialContentBlock = $("material-content-block");
  const materialContentLabel = $("material-content-label");
  const materialContent = $("material-content");
  const materialLoader = $("material-loader");
  const materialLoaderPanel = $("material-loader-panel");
  const materialNotice = $("material-notice");

  const materialQuizBlock = $("material-quiz-block");
  const quizPrev = $("quiz-prev");
  const quizPrevLabel = $("quiz-prev-label");
  const quizNext = $("quiz-next");
  const quizNextLabel = $("quiz-next-label");
  const quizTimerChip = $("quiz-timer-chip");
  const quizProgress = $("quiz-progress");
  const quizGrid = $("quiz-grid");

  const sheet = $("sheet-settings");
  const sheetBackdrop = $("sheet-backdrop");
  const sheetClose = $("sheet-close");
  const themeSwitch = $("theme-switch");
  const settingsAuthor = $("settings-author");
  const settingsLogout = $("settings-logout");

  const toastEl = $("toast");

  /* ---------- Состояние ---------- */
  const state = {
    mode: MoodleApi.mode(),
    token: null,
    user: null,
    courses: [],
    activities: [],
    course: null,
    history: [],          /* стек открытых страниц внутри материала */
    quizTimerId: null,
    heartbeatId: null,
    lastPingAt: 0,
  };

  /* Автовход: ограниченное число попыток, чтобы не уйти в цикл */
  let autoLoginAttempts = 0;
  const AUTO_LOGIN_MAX = 2;
  let lastLoginAt = 0;

  /* Moodle у ВГУ завершает сессию после 30 минут без активности.
     Пока приложение открыто, продлеваем её лёгким запросом. */
  const HEARTBEAT_MS = 5 * 60 * 1000;
  const PING_MIN_GAP_MS = 60 * 1000;

  const AVATAR_CACHE_KEY = "vsu_avatar";

  /* ---------- Telegram ---------- */
  const tg = window.Telegram && window.Telegram.WebApp;

  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
    } catch (e) {
      /* ignore */
    }
  }

  function openExternal(url) {
    if (!url) return;
    if (tg && typeof tg.openLink === "function") tg.openLink(url);
    else window.open(url, "_blank", "noopener");
  }

  /* ---------- Утилиты ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function modLabel(modname) {
    return cfg.MOD_LABELS[modname] || modname;
  }

  function humanSize(bytes) {
    if (bytes === undefined || bytes === null) return "";
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  const fmtDateLong = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const fmtDateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  function relLabel(ts) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = Math.round((ts * 1000 - startOfToday) / 86400000);
    if (diff <= -1) return "просрочено";
    if (diff === 0) return "сегодня";
    if (diff === 1) return "завтра";
    if (diff >= 2 && diff <= 4) return `через ${diff} дня`;
    return `через ${diff} дней`;
  }

  let toastTimer = null;
  function toast(message, tone) {
    if (!message) return;
    toastEl.textContent = message;
    toastEl.className = `toast${tone ? " toast--" + tone : ""}`;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3200);
  }

  /* ---------- Ошибки ---------- */
  function friendlyError(err) {
    if (!err) return "Что-то пошло не так. Попробуйте ещё раз.";
    switch (err.code) {
      case "invalidlogin":
        return err.message || "Неверный логин или пароль.";
      case "invalidtoken":
      case "servicerequireslogin":
        return "Сессия истекла. Войдите заново.";
      case "network":
        return err.message;
      case "servicenotavailable":
        return "Эта функция недоступна: администратор Moodle её не включил.";
      default:
        return err.message || "Что-то пошло не так. Попробуйте ещё раз.";
    }
  }

  function isSessionExpired(err) {
    return err && (err.code === "servicerequireslogin" || err.code === "invalidtoken");
  }

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.remove("hidden");
  }

  function clearLoginError() {
    loginError.classList.add("hidden");
    loginError.textContent = "";
  }

  /* ---------- Экраны ---------- */
  function show(view) {
    [viewLogin, viewHome, viewCourse, viewMaterial].forEach((v) => {
      v.classList.toggle("hidden", v !== view);
    });
    const isLogin = view === viewLogin;
    elTopbar.classList.toggle("hidden", isLogin);
    elFooter.classList.toggle("hidden", isLogin);
    window.scrollTo(0, 0);
  }

  /* ---------- Настройки ---------- */
  function openSheet() {
    sheet.classList.remove("hidden");
    sheetBackdrop.classList.remove("hidden");
    requestAnimationFrame(() => sheet.classList.add("sheet--open"));
  }

  function closeSheet() {
    sheet.classList.remove("sheet--open");
    sheetBackdrop.classList.add("hidden");
    setTimeout(() => sheet.classList.add("hidden"), 180);
  }

  function syncThemeButtons(mode) {
    themeSwitch.querySelectorAll("[data-theme-value]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.themeValue === mode);
    });
  }

  function initSettings() {
    elBtnSettings.addEventListener("click", openSheet);
    sheetClose.addEventListener("click", closeSheet);
    sheetBackdrop.addEventListener("click", closeSheet);

    themeSwitch.querySelectorAll("[data-theme-value]").forEach((btn) => {
      btn.addEventListener("click", () => Theme.set(btn.dataset.themeValue));
    });

    settingsAuthor.addEventListener("click", () => openExternal(AUTHOR_URL));
    settingsForget.addEventListener("click", async () => {
      await Storage.clearCredentials();
      loginRemember.checked = false;
      settingsForget.classList.add("hidden");
      toast("Сохранённый пароль удалён");
      closeSheet();
    });
    settingsLogout.addEventListener("click", () => {
      closeSheet();
      logout();
    });

    loginAuthor.addEventListener("click", () => openExternal(AUTHOR_URL));
    footerAuthor.addEventListener("click", () => openExternal(AUTHOR_URL));

    Theme.onChange((resolvedMode, mode) => syncThemeButtons(mode));
    syncThemeButtons(Theme.get());
  }

  /* ---------- Аватар ---------- */
  function setAvatar(dataUri) {
    if (!dataUri) return;
    [elAvatar, elHomeAvatar].forEach((img) => {
      img.src = dataUri;
      img.classList.remove("hidden");
    });
  }

  async function loadAvatar(url) {
    if (!url) return;
    try {
      const cached = sessionStorage.getItem(AVATAR_CACHE_KEY);
      if (cached && cached.indexOf("data:") === 0) {
        setAvatar(cached);
        return;
      }
    } catch (e) {
      /* нет доступа */
    }
    try {
      const res = await MoodleSession.open(url);
      if (res.kind === "file" && res.base64 && /^image\//i.test(res.contentType || "")) {
        const dataUri = `data:${res.contentType};base64,${res.base64}`;
        setAvatar(dataUri);
        try {
          sessionStorage.setItem(AVATAR_CACHE_KEY, dataUri);
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* аватар необязателен */
    }
  }

  /* ---------- Продление сессии ---------- */

  function stopHeartbeat() {
    if (state.heartbeatId) {
      clearInterval(state.heartbeatId);
      state.heartbeatId = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (state.mode !== "session") return;
    state.heartbeatId = setInterval(() => { pingSession(); }, HEARTBEAT_MS);
  }

  /* Лёгкий авторизованный запрос: сбрасывает таймер неактивности Moodle */
  async function pingSession() {
    if (state.mode !== "session") return;
    const userid = state.user && state.user.userid;
    if (!userid) return;
    if (Date.now() - state.lastPingAt < PING_MIN_GAP_MS) return;
    state.lastPingAt = Date.now();
    try {
      await MoodleApi.session.ping(userid);
    } catch (err) {
      if (isSessionExpired(err)) await expireSession();
    }
  }

  /* Сессия закончилась — показываем понятное сообщение и пробуем автовход */
  async function expireSession(message) {
    stopHeartbeat();
    clearQuizTimer();
    if (state.mode === "session") await MoodleApi.session.clear();
    state.token = null;
    state.user = null;
    state.courses = [];
    state.activities = [];
    state.course = null;
    state.history = [];
    elTopbarUser.textContent = "";
    [elAvatar, elHomeAvatar].forEach((img) => {
      img.removeAttribute("src");
      img.classList.add("hidden");
    });
    const name = await Storage.getUsername();
    if (name) loginUsername.value = name;
    loginNotice.textContent = message ||
      "Сессия истекла: Moodle завершает её после 30 минут без активности. Войдите заново.";
    loginNotice.classList.remove("hidden");
    show(viewLogin);

    /* Пароль сохранён — входим автоматически */
    refreshForgetRow();
    await tryAutoLogin();
  }

  /* ---------- Автовход по сохранённым данным ---------- */

  async function refreshForgetRow() {
    let saved = null;
    try {
      saved = await Storage.getCredentials();
    } catch (e) {
      saved = null;
    }
    const has = !!(saved && saved.username);
    loginRemember.checked = has;
    settingsForget.classList.toggle("hidden", !has);
  }

  async function tryAutoLogin() {
    if (state.mode !== "session") return false;
    if (autoLoginAttempts >= AUTO_LOGIN_MAX) return false;
    /* Только что входили — значит, дело не в пароле, не зацикливаемся */
    if (Date.now() - lastLoginAt < 10000) return false;

    let saved = null;
    try {
      saved = await Storage.getCredentials();
    } catch (e) {
      saved = null;
    }
    if (!saved || !saved.username || !saved.password) return false;

    autoLoginAttempts += 1;
    loginUsername.value = saved.username;
    show(viewLogin);
    setLoginLoading(true);

    try {
      /* Старые cookie мёртвой сессии только мешают — убираем */
      try {
        await MoodleApi.session.clear();
      } catch (e) {
        /* ignore */
      }
      await performLogin(saved.username, saved.password, { remember: true });
      loginNotice.textContent = "Выполнен автоматический вход по сохранённым данным.";
      loginNotice.classList.remove("hidden");
      return true;
    } catch (err) {
      loginPassword.value = "";
      loginNotice.textContent = "Автовход не удался: " + friendlyError(err) +
        " Проверь логин и пароль.";
      loginNotice.classList.remove("hidden");
      return false;
    } finally {
      setLoginLoading(false);
    }
  }

  /* ---------- Главный экран ---------- */
  async function loadHome() {
    /* Сначала убеждаемся, что вход действительно жив.
       Moodle отдаёт форму входа с кодом 200, поэтому исключения
       может и не быть — проверяем сам объект профиля. */
    let info = null;
    try {
      info = state.mode === "session"
        ? await MoodleApi.session.siteInfo()
        : await MoodleApi.token.siteInfo(state.token);
    } catch (err) {
      if (isSessionExpired(err)) return await expireSession();
      /* прочие ошибки не должны мешать показать кабинет */
    }

    const alive = info && (info.userid || (info.fullname && String(info.fullname).trim()));
    if (!alive) {
      return await expireSession("Сессия истекла. Выполняю вход заново…");
    }

    state.user = info;
    const name = info.fullname;
    if (name) {
      homeGreeting.textContent = `Здравствуйте, ${name}`;
      elTopbarUser.textContent = name;
    }
    if (info.avatar) loadAvatar(info.avatar);
    state.lastPingAt = Date.now();
    startHeartbeat();

    show(viewHome);
    homeDate.textContent = fmtDateLong.format(new Date());
    coursesList.innerHTML = "";
    deadlinesList.innerHTML = "";
    deadlinesNote.textContent = "";
    coursesLoaderPanel.classList.remove("hidden");
    deadlinesLoader.classList.remove("hidden");
    deadlinesEmpty.classList.add("hidden");

    try {
      const courses = state.mode === "session"
        ? await MoodleApi.session.myCourses()
        : await MoodleApi.token.myCourses(state.token);
      state.courses = Array.isArray(courses) ? courses : [];
      renderCourses();
    } catch (err) {
      if (isSessionExpired(err)) return await expireSession();
      coursesList.innerHTML = `<div class="notice">${escapeHtml(friendlyError(err))}</div>`;
    } finally {
      coursesLoaderPanel.classList.add("hidden");
    }

    try {
      const events = state.mode === "session"
        ? await MoodleApi.session.upcomingEvents()
        : await MoodleApi.token.upcomingEvents(state.token);
      renderDeadlines(events || []);
    } catch (err) {
      if (isSessionExpired(err)) return await expireSession();
      deadlinesNote.textContent = "недоступно";
      deadlinesList.innerHTML = `<div class="notice">${escapeHtml(friendlyError(err))}</div>`;
    } finally {
      deadlinesLoader.classList.add("hidden");
    }
  }

  function renderCourses() {
    const courses = state.courses;
    coursesCount.textContent = courses.length
      ? `${courses.length} ${plural(courses.length, "курс", "курса", "курсов")}`
      : "";
    if (!courses.length) {
      coursesList.innerHTML = `<div class="panel"><div class="empty">Курсы не найдены</div></div>`;
      return;
    }
    coursesList.innerHTML = courses.map((c) => `
      <button class="course-card" type="button" data-id="${c.id}">
        <span class="course-card__icon">${Icons.svg("i-book")}</span>
        <span class="course-card__body">
          ${c.shortname ? `<span class="course-card__code">${escapeHtml(c.shortname)}</span>` : ""}
          <span class="course-card__name">${escapeHtml(c.fullname || "")}</span>
        </span>
        ${Icons.svg("i-chevron", "icon--muted")}
      </button>
    `).join("");

    coursesList.querySelectorAll(".course-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = Number(card.dataset.id);
        openCourse(state.courses.find((c) => c.id === id));
      });
    });
  }

  function renderDeadlines(events) {
    if (!events.length) {
      deadlinesEmpty.classList.remove("hidden");
      return;
    }
    deadlinesEmpty.classList.add("hidden");
    const now = Math.floor(Date.now() / 1000);
    deadlinesList.innerHTML = events.map((ev) => {
      const late = ev.timesort < now;
      const courseName = ev.course ? (ev.course.shortname || ev.course.fullname || "") : "";
      return `
        <div class="deadline ${late ? "deadline--late" : ""}">
          <span class="deadline__icon">${Icons.svg(late ? "i-clock" : "i-clock")}</span>
          <div class="deadline__main">
            <div class="deadline__name">${escapeHtml(ev.name)}</div>
            <div class="deadline__meta">${escapeHtml(courseName)}</div>
          </div>
          <div class="deadline__when">
            <div class="deadline__date">${fmtDateTime.format(new Date(ev.timesort * 1000))}</div>
            <div class="deadline__rel">${relLabel(ev.timesort)}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  /* ---------- Экран курса ---------- */
  async function openCourse(course) {
    if (!course) return;
    state.course = course;
    state.history = [];
    show(viewCourse);
    courseCode.textContent = course.shortname || "";
    courseTitle.textContent = course.fullname || "Курс";
    assignmentsList.innerHTML = "";
    assignmentsCount.textContent = "";
    assignmentsEmpty.classList.add("hidden");
    assignmentsLoader.classList.remove("hidden");

    try {
      if (state.mode === "session") {
        state.activities = await MoodleApi.session.courseActivities(course.id);
      } else {
        const result = await MoodleApi.token.call(state.token, "mod_assign_get_assignments", {
          "courseids[0]": course.id,
        });
        const assignments = (result && result.courses && result.courses[0]
          && result.courses[0].assignments) || [];
        state.activities = assignments.map((a) => ({
          cmid: a.id,
          modname: "assign",
          name: a.name,
          url: `${cfg.MOODLE_URL}/mod/assign/view.php?id=${a.id}`,
        }));
      }
      renderActivities(state.activities);
    } catch (err) {
      if (isSessionExpired(err)) return await expireSession();
      assignmentsList.innerHTML = `<div class="notice">${escapeHtml(friendlyError(err))}</div>`;
    } finally {
      assignmentsLoader.classList.add("hidden");
    }
  }

  function renderActivities(activities) {
    const n = activities.length;
    assignmentsCount.textContent = n
      ? `${n} ${plural(n, "элемент", "элемента", "элементов")}`
      : "";
    if (!n) {
      assignmentsEmpty.classList.remove("hidden");
      return;
    }
    assignmentsList.innerHTML = activities.map((a, index) => `
      <div class="row row--link" data-index="${index}" role="button" tabindex="0">
        <span class="row__icon row__icon--${a.modname === "quiz" ? "accent" : "plain"}">${Icons.mod(a.modname)}</span>
        <div class="row__main">
          <div class="row__name">${escapeHtml(a.name)}</div>
          <div class="row__meta">${escapeHtml(modLabel(a.modname))}</div>
        </div>
        ${Icons.svg("i-chevron", "icon--muted")}
      </div>
    `).join("");

    assignmentsList.querySelectorAll(".row--link").forEach((row) => {
      const go = () => openMaterial(state.activities[Number(row.dataset.index)], true);
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }

  /* ---------- Экран материала ---------- */
  function setMaterialBusy(busy) {
    materialLoader.classList.toggle("hidden", !busy);
    materialLoaderPanel.classList.toggle("hidden", !busy);
    if (busy) {
      materialNotice.classList.add("hidden");
    }
  }

  function resetMaterial() {
    materialContent.innerHTML = "";
    materialContent.classList.remove("has-quizbar");
    materialFiles.innerHTML = "";
    materialActions.innerHTML = "";
    materialActions.classList.add("hidden");
    materialFilesBlock.classList.add("hidden");
    materialContentBlock.classList.add("hidden");
    materialContentLabel.textContent = "Содержание";
    materialQuizBlock.classList.add("hidden");
    quizGrid.innerHTML = "";
    clearQuizTimer();
    materialNotice.classList.add("hidden");
  }

  /* ---------- Навигация по тесту и таймер ---------- */

  function clearQuizTimer() {
    if (state.quizTimerId) {
      clearInterval(state.quizTimerId);
      state.quizTimerId = null;
    }
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
  }

  function startQuizTimer(timer) {
    clearQuizTimer();
    quizTimerChip.title = "";

    /* Лимита времени нет — Moodle в этом случае оставляет надпись пустой */
    if (!timer || typeof timer.secondsLeft !== "number") {
      quizTimerChip.textContent = "без ограничения";
      quizTimerChip.title = "У этого теста нет ограничения по времени";
      quizTimerChip.className = "quizbar__timer quizbar__timer--none";
      quizTimerChip.classList.remove("hidden");
      return;
    }

    const deadline = Date.now() + timer.secondsLeft * 1000;
    if (timer.preview) {
      quizTimerChip.title = "Предпросмотр: время не влияет на оценку";
    }
    quizTimerChip.classList.remove("hidden");

    const tick = () => {
      const left = Math.round((deadline - Date.now()) / 1000);
      if (left <= 0) {
        quizTimerChip.textContent = "время вышло";
        quizTimerChip.className = "quizbar__timer quizbar__timer--danger";
        clearQuizTimer();
        return;
      }
      quizTimerChip.textContent = `осталось ${formatDuration(left)}`;
      quizTimerChip.className = "quizbar__timer" +
        (left <= 60 ? " quizbar__timer--danger" : left <= 300 ? " quizbar__timer--warn" : "");
    };
    tick();
    state.quizTimerId = setInterval(tick, 1000);
  }

  /* Короткая подпись кнопки по тексту кнопки Moodle */
  function shortQuizLabel(value, fallback) {
    const text = String(value || "").trim();
    if (!text) return fallback;
    if (/законч|заверш|finish|end/i.test(text)) return "Завершить";
    if (/след|next|далее/i.test(text)) return "Далее";
    if (/пред|previous|назад/i.test(text)) return "Назад";
    return fallback;
  }

  function renderQuizBar(info) {
    const form = materialContent.querySelector("form[data-relay-action]");
    if (!form || !info || !info.questions.length) {
      materialQuizBlock.classList.add("hidden");
      materialContent.classList.remove("has-quizbar");
      clearQuizTimer();
      return;
    }

    const nextBtn = form.querySelector("#mod_quiz-next-nav");
    const prevBtn = form.querySelector("#mod_quiz-prev-nav");

    quizNextLabel.textContent = shortQuizLabel(nextBtn && nextBtn.value, "Далее");
    if (nextBtn && nextBtn.value) quizNext.title = nextBtn.value;
    quizPrev.classList.toggle("hidden", !prevBtn);
    quizPrevLabel.textContent = shortQuizLabel(prevBtn && prevBtn.value, "Назад");

    quizProgress.textContent = `Отвечено ${info.answered} из ${info.total}` +
      (info.totalPages > 1 ? ` · страница ${info.currentPage + 1} из ${info.totalPages}` : "");

    quizGrid.innerHTML = info.questions.map((q) => {
      const classes = ["qn"];
      if (q.current) classes.push("qn--current");
      if (q.answered) classes.push("qn--answered");
      if (q.correct) classes.push("qn--correct");
      if (q.incorrect) classes.push("qn--incorrect");
      if (q.flagged) classes.push("qn--flagged");
      return `<button class="${classes.join(" ")}" type="button" data-page="${q.page}"` +
        ` title="${escapeHtml(q.title)}">${escapeHtml(q.number)}</button>`;
    }).join("");

    quizGrid.querySelectorAll(".qn").forEach((btn, index) => {
      btn.addEventListener("click", () => {
        const question = info.questions[index];
        const page = question ? question.page : Number(btn.dataset.page);

        /* Вопрос на текущей странице — просто прокручиваем к нему */
        if (page === info.currentPage) {
          const fragment = question && question.href && question.href.indexOf("#") === 0
            ? question.href.slice(1)
            : "";
          const target = fragment ? document.getElementById(fragment) : null;
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            materialContentBlock.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }

        goToQuizPage(form, page);
      });
    });

    quizNext.onclick = () => { if (nextBtn) nextBtn.click(); };
    quizPrev.onclick = () => { if (prevBtn) prevBtn.click(); };

    materialContent.classList.add("has-quizbar");
    materialQuizBlock.classList.remove("hidden");
    startQuizTimer(info.timer);
  }

  /* Переход к конкретной странице теста: сохраняем ответы текущей страницы
     и просим Moodle открыть нужную (поле nextpage). */
  function goToQuizPage(form, page) {
    const nextPageInput = form.querySelector('input[name="nextpage"]');
    if (nextPageInput) nextPageInput.value = String(page);
    const nextBtn = form.querySelector("#mod_quiz-next-nav");
    if (nextBtn) {
      nextBtn.click();
      return;
    }
    const fields = collectFields(form, null);
    fields.next = "1";
    fields.nextpage = String(page);
    relayForm(form.getAttribute("data-relay-action"), fields);
  }

  async function openMaterial(item, resetHistory) {
    if (!item) return;
    if (resetHistory) {
      state.history = [{ url: item.url, title: item.name, kicker: modLabel(item.modname) }];
    }
    show(viewMaterial);
    resetMaterial();
    materialKicker.textContent = modLabel(item.modname);
    materialTitle.textContent = item.name;
    setMaterialBusy(true);

    try {
      const res = await MoodleSession.open(item.url);
      await renderResponse(res);
    } catch (err) {
      handleMaterialError(err);
    } finally {
      setMaterialBusy(false);
    }
  }

  /* Открытие внутренней ссылки Moodle внутри приложения */
  async function navigateInternal(url) {
    const entry = { url, title: materialTitle.textContent, kicker: materialKicker.textContent };
    state.history.push(entry);
    resetMaterial();
    setMaterialBusy(true);
    try {
      const res = await MoodleSession.open(url);
      await renderResponse(res, true);
    } catch (err) {
      handleMaterialError(err);
    } finally {
      setMaterialBusy(false);
    }
  }

  function handleMaterialError(err) {
    if (isSessionExpired(err)) return void expireSession();
    materialNotice.textContent = friendlyError(err);
    materialNotice.classList.remove("hidden");
  }

  /* Показ ответа Moodle: страница или файл */
  async function renderResponse(res, keepTitle) {
    if (res.kind === "file") {
      renderFileCard(res);
      return;
    }

    const data = MoodleParse.material(res.html);

    if (keepTitle === false && data.title) {
      materialTitle.textContent = data.title;
    } else if (keepTitle && data.title && data.title.length < 120) {
      materialTitle.textContent = data.title;
    }

    const text = (data.html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (text) {
      materialContent.innerHTML = data.html;
      materialContentBlock.classList.remove("hidden");
      bindContentEvents(materialContent);
      loadContentImages(materialContent);
    } else {
      materialNotice.textContent = "Эта страница не содержит текста — откройте её в Moodle.";
      materialNotice.classList.remove("hidden");
    }

    /* Тест: своя навигация по вопросам и таймер */
    renderQuizBar(text ? data.quiz : null);

    if (data.files.length) renderFiles(data.files);

    /* Кнопки действий */
    const actions = [];
    if (data.interactive) {
      actions.push(`<span class="chip chip--ok">${Icons.svg("i-check", "icon--sm")} можно отвечать здесь</span>`);
    }
    actions.push(`<button class="btn btn--ghost btn--sm" id="material-refresh" type="button">${Icons.svg("i-refresh", "icon--sm")} Обновить</button>`);
    actions.push(`<button class="btn btn--ghost btn--sm" id="material-external" type="button">${Icons.svg("i-external", "icon--sm")} В Moodle</button>`);
    materialActions.innerHTML = actions.join("");
    materialActions.classList.remove("hidden");
    $("material-refresh").addEventListener("click", () => {
      const url = state.history[state.history.length - 1].url;
      state.history.pop();
      navigateInternal(url);
    });
    $("material-external").addEventListener("click", () => {
      openExternal(state.history[state.history.length - 1].url);
    });
  }

  /* Карточка файла */
  function renderFileCard(res) {
    const name = res.filename || "Файл";
    const kind = Icons.file(name, res.contentType);
    if (res.tooLarge) {
      materialNotice.innerHTML = `${Icons.svg("i-info", "icon--sm")} Файл слишком большой для показа в приложении (${escapeHtml(humanSize(res.size))}). Откройте его в Moodle.`;
      materialNotice.classList.remove("hidden");
      return;
    }
    materialContentLabel.textContent = "Файл";
    materialContent.innerHTML = `
      <div class="file-card">
        <span class="file-badge file-badge--${kind.tone}">
          ${Icons.svg(kind.icon)}
          <span class="file-badge__label">${escapeHtml(kind.label)}</span>
        </span>
        <div class="file-card__info">
          <div class="file-card__name">${escapeHtml(name)}</div>
          <div class="file-card__meta">${escapeHtml(humanSize(res.size))}</div>
        </div>
        <button class="btn btn--primary" type="button" id="file-open-btn">
          ${Icons.svg("i-download", "icon--sm")} Открыть
        </button>
      </div>
    `;
    materialContentBlock.classList.remove("hidden");
    $("file-open-btn").addEventListener("click", () => {
      openFile(res);
      toast("Файл сохраняется на устройство");
    });
  }

  /* Список приложенных файлов */
  function renderFiles(files) {
    materialFilesCount.textContent = `${files.length} ${plural(files.length, "файл", "файла", "файлов")}`;
    materialFilesBlock.classList.remove("hidden");
    materialFiles.innerHTML = files.map((f, i) => {
      const kind = Icons.file(f.name || f.url);
      return `
        <button class="file-row" type="button" data-index="${i}">
          <span class="file-badge file-badge--${kind.tone} file-badge--sm">
            ${Icons.svg(kind.icon)}
            <span class="file-badge__label">${escapeHtml(kind.label)}</span>
          </span>
          <span class="file-row__name">${escapeHtml(f.name)}</span>
          ${Icons.svg("i-download", "icon--muted icon--sm")}
        </button>
      `;
    }).join("");

    materialFiles.querySelectorAll(".file-row").forEach((row) => {
      row.addEventListener("click", async () => {
        const file = files[Number(row.dataset.index)];
        row.disabled = true;
        try {
          const res = await MoodleSession.open(file.url);
          if (res.tooLarge) {
            toast(`Файл слишком большой (${humanSize(res.size)})`, "warn");
          } else {
            openFile(res);
            toast("Файл сохраняется на устройство");
          }
        } catch (err) {
          if (isSessionExpired(err)) return void expireSession();
          toast(friendlyError(err), "warn");
        } finally {
          row.disabled = false;
        }
      });
    });
  }

  /* Сохранение файла на устройство */
  function openFile(res) {
    if (!res || !res.base64) return;
    const bytes = atob(res.base64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    const blob = new Blob([buffer], { type: res.contentType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = res.filename || "file";
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  /* ---------- События внутри содержимого ---------- */

  function collectFields(form, submitter) {
    const fields = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value !== "string") return;      /* файлы не поддерживаются */
      if (fields[key] === undefined) fields[key] = value;
      else if (Array.isArray(fields[key])) fields[key].push(value);
      else fields[key] = [fields[key], value];
    });
    if (submitter && submitter.name) fields[submitter.name] = submitter.value;
    return fields;
  }

  async function relayForm(action, fields) {
    setMaterialBusy(true);
    window.scrollTo(0, 0);
    try {
      const res = await MoodleSession.submit(action, fields);
      state.history.push({ url: action, title: materialTitle.textContent, kicker: materialKicker.textContent });
      resetMaterial();
      await renderResponse(res, true);
    } catch (err) {
      handleMaterialError(err);
    } finally {
      setMaterialBusy(false);
    }
  }

  function bindContentEvents(root) {
    /* Формы тестов */
    root.querySelectorAll("form[data-relay-action]").forEach((form) => {
      let lastSubmitter = null;
      form.addEventListener("click", (e) => {
        const btn = e.target.closest("button, input[type='submit'], input[type='image'], input[type='button']");
        if (btn && btn.name) lastSubmitter = btn;
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const action = form.getAttribute("data-relay-action");
        /* У тестов ограничено число попыток — предупреждаем перед запуском */
        if (/startattempt\.php/i.test(action)) {
          const ok = window.confirm("Начать попытку? У этого теста ограничено количество попыток.");
          if (!ok) return;
        }
        relayForm(action, collectFields(form, e.submitter || lastSubmitter));
      });
    });

    /* Внутренние ссылки Moodle — открываем внутри приложения */
    root.querySelectorAll("a[data-internal]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        navigateInternal(a.getAttribute("href"));
      });
    });

    /* Внешние ссылки */
    root.querySelectorAll("a[data-external]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openExternal(a.getAttribute("href"));
      });
    });

    /* Ссылки на файлы внутри текста */
    root.querySelectorAll("a[data-file-url]").forEach((a) => {
      a.classList.add("content-file");
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const url = a.getAttribute("data-file-url");
        a.classList.add("content-file--busy");
        try {
          const res = await MoodleSession.open(url);
          if (res.tooLarge) toast(`Файл слишком большой (${humanSize(res.size)})`, "warn");
          else {
            openFile(res);
            toast("Файл сохраняется на устройство");
          }
        } catch (err) {
          if (isSessionExpired(err)) return void expireSession();
          toast(friendlyError(err), "warn");
        } finally {
          a.classList.remove("content-file--busy");
        }
      });
    });
  }

  /* Подгрузка картинок внутри содержимого */
  async function loadContentImages(root) {
    const images = Array.from(root.querySelectorAll("img[data-image-url]"));
    const limit = Math.min(images.length, 12);
    for (let i = 0; i < limit; i++) {
      const img = images[i];
      const url = img.getAttribute("data-image-url");
      if (!url) continue;
      try {
        const res = await MoodleSession.open(url);
        if (res.kind === "file" && res.base64 && /^image\//i.test(res.contentType || "")) {
          img.src = `data:${res.contentType};base64,${res.base64}`;
        } else {
          img.remove();
        }
      } catch (e) {
        img.remove();
      }
    }
    images.slice(limit).forEach((img) => img.remove());
  }

  /* ---------- Вход / выход ---------- */

  /* Общая процедура входа: используется и формой, и автовходом */
  async function performLogin(username, password, options) {
    const opts = options || {};
    const remember = !!opts.remember;

    if (state.mode === "session") {
      await MoodleApi.session.login(username, password);
      await Storage.setUsername(username);
      if (remember) {
        await Storage.setCredentials(username, password);
      } else {
        await Storage.clearCredentials();
      }
      refreshForgetRow();
    } else {
      const result = await MoodleApi.token.login(username, password);
      state.token = result.token;
      await Storage.setToken(result.token);
    }

    lastLoginAt = Date.now();

    try {
      sessionStorage.removeItem(AVATAR_CACHE_KEY);
    } catch (e) {
      /* ignore */
    }

    await loadHome();
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearLoginError();

    const username = loginUsername.value.trim();
    const password = loginPassword.value;
    if (!username || !password) {
      showLoginError("Введите логин и пароль.");
      return;
    }

    setLoginLoading(true);
    try {
      await performLogin(username, password, { remember: loginRemember.checked });
      loginPassword.value = "";
      loginNotice.classList.add("hidden");
    } catch (err) {
      showLoginError(friendlyError(err));
    } finally {
      setLoginLoading(false);
    }
  }

  function setLoginLoading(loading) {
    loginSubmit.disabled = loading;
    loginSubmit.querySelector(".btn__label").classList.toggle("hidden", loading);
    loginSubmit.querySelector(".btn__spinner").classList.toggle("hidden", !loading);
  }

  async function logout() {
    stopHeartbeat();
    if (state.mode === "session") {
      await MoodleApi.session.logout();
    } else {
      await Storage.clearToken();
    }
    /* «Выйти» удаляет и сохранённый пароль, иначе автовход вернул бы всё назад */
    try {
      await Storage.clearCredentials();
    } catch (e) {
      /* ignore */
    }
    loginRemember.checked = false;
    settingsForget.classList.add("hidden");
    state.token = null;
    state.user = null;
    state.courses = [];
    state.activities = [];
    state.course = null;
    state.history = [];
    clearQuizTimer();
    materialQuizBlock.classList.add("hidden");
    elTopbarUser.textContent = "";
    [elAvatar, elHomeAvatar].forEach((img) => {
      img.removeAttribute("src");
      img.classList.add("hidden");
    });
    try {
      sessionStorage.removeItem(AVATAR_CACHE_KEY);
    } catch (e) {
      /* ignore */
    }
    show(viewLogin);
  }

  /* ---------- Навигация назад ---------- */
  function materialGoBack() {
    if (state.history.length > 1) {
      state.history.pop();
      const prev = state.history[state.history.length - 1];
      resetMaterial();
      materialTitle.textContent = prev.title;
      materialKicker.textContent = prev.kicker;
      setMaterialBusy(true);
      MoodleSession.open(prev.url)
        .then((res) => renderResponse(res, true))
        .catch(handleMaterialError)
        .finally(() => setMaterialBusy(false));
      return;
    }
    if (state.course) show(viewCourse);
    else loadHome();
  }

  /* ---------- Запуск ---------- */
  async function boot() {
    initTelegram();
    await Theme.init();
    initSettings();

    loginForm.addEventListener("submit", handleLogin);
    courseBack.addEventListener("click", () => {
      state.history = [];
      if (state.mode === "session" || state.token) loadHome();
      else show(viewLogin);
    });
    materialBack.addEventListener("click", materialGoBack);

    /* Возвращение в приложение: сразу продлеваем сессию, если давно не было запросов */
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) pingSession();
    });

    /* Логин подставляем, чтобы не вводить его заново (пароль не храним) */
    try {
      const savedName = await Storage.getUsername();
      if (savedName) loginUsername.value = savedName;
    } catch (e) {
      /* ignore */
    }
    await refreshForgetRow();

    if (state.mode === "session") {
      const restored = await MoodleApi.session.restore();
      if (restored) {
        /* Если сессии уже нет — expireSession сам предложит автовход */
        await loadHome();
        return;
      }
      /* Сохранённые данные есть — входим автоматически */
      if (await tryAutoLogin()) return;
    } else {
      const token = await Storage.getToken();
      if (token) {
        state.token = token;
        await loadHome();
        return;
      }
    }
    show(viewLogin);
  }

  boot();
})();