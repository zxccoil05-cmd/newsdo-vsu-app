/* ============================================================
   Разбор HTML-страниц Moodle.
   - резервный путь получения данных, если AJAX-функция недоступна;
   - превращение страницы Moodle в содержимое, которое можно
     показать внутри приложения (включая прохождение тестов).
   ============================================================ */

const MoodleParse = (() => {
  function parse(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function cleanText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(".accesshide, .sr-only, .visually-hidden").forEach((n) => n.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function toAbsolute(href) {
    const base = window.APP_CONFIG.MOODLE_URL;
    if (!href) return "";
    if (/^https?:/i.test(href)) return href;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("#") || /^javascript:/i.test(href) || /^mailto:/i.test(href)) return href;
    return base + (href.startsWith("/") ? "" : "/") + href;
  }

  const isMoodleUrl = (url) =>
    url.indexOf(window.APP_CONFIG.MOODLE_URL) === 0;

  /* sesskey текущей сессии — нужен для AJAX-запросов */
  function sesskey(html) {
    const m = /"sesskey":"([^"]+)"/.exec(html) || /name="sesskey"\s+value="([^"]+)"/.exec(html);
    return m ? m[1] : null;
  }

  /* Имя пользователя из шапки страницы */
  function fullname(html) {
    const doc = parse(html);
    const el = doc.querySelector(".usertext") ||
               doc.querySelector("[data-region='user-menu'] .usertext") ||
               doc.querySelector(".usermenu .usertext");
    if (el) {
      const text = cleanText(el);
      if (text) return text;
    }
    const alt = doc.querySelector("a[href*='/user/profile.php'] .usertext");
    return alt ? cleanText(alt) : null;
  }

  /* Аватар пользователя */
  function userPicture(html) {
    const doc = parse(html);
    const img = doc.querySelector("img.userpicture") ||
                doc.querySelector("img[src*='/user/icon/']");
    if (!img) return null;
    return toAbsolute(img.getAttribute("src") || "");
  }

  /* Идентификатор пользователя (из ссылки на профиль в шапке) */
  function userId(html) {
    const doc = parse(html);
    const link = doc.querySelector("[data-region='user-menu'] a[href*='/user/profile.php']") ||
                 doc.querySelector("[data-region='user-menu'] a[href*='/user/view.php']") ||
                 doc.querySelector("a[href*='/user/profile.php?id=']") ||
                 doc.querySelector("a[href*='/user/view.php?id=']");
    if (!link) return 0;
    const m = /[?&]id=(\d+)/.exec(link.getAttribute("href") || "");
    return m ? Number(m[1]) : 0;
  }

  /* Список курсов со страницы «Мои курсы» */
  function courses(html) {
    const doc = parse(html);
    const found = new Map();

    doc.querySelectorAll("a[href*='course/view.php?id=']").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const m = /course\/view\.php\?id=(\d+)/.exec(href);
      if (!m) return;
      const id = Number(m[1]);
      const name = cleanText(a);
      if (!name || name.length < 3) return;

      const card = a.closest("[data-course-id], .card, .course-info-container, li");
      let shortname = "";
      if (card) {
        const codeEl = card.querySelector(".coursecode, .course-shortname, [data-course-shortname]");
        if (codeEl) shortname = cleanText(codeEl);
        if (!shortname && card.dataset && card.dataset.courseShortname) {
          shortname = card.dataset.courseShortname;
        }
      }

      const prev = found.get(id);
      if (!prev || name.length > prev.fullname.length) {
        found.set(id, { id, fullname: name, shortname });
      }
    });

    return Array.from(found.values());
  }

  /* Ближайшие события со страницы календаря */
  function events(html) {
    const doc = parse(html);
    const items = doc.querySelectorAll(
      "[data-region='event-item'], .eventlist .event, li[data-event-id], .calendar-event"
    );
    const out = [];

    items.forEach((item) => {
      const nameEl = item.querySelector(".eventname a, .name a, h3 a, h4 a, a[href*='event']");
      const name = nameEl ? cleanText(nameEl) : "";
      if (!name) return;

      let timesort = 0;
      const timeEl = item.querySelector("time[datetime], [data-timestamp], .date");
      if (timeEl) {
        const stamp = timeEl.getAttribute("data-timestamp") || timeEl.getAttribute("datetime");
        if (stamp && /^\d+$/.test(stamp)) {
          timesort = Number(stamp);
        } else if (stamp) {
          const parsed = Date.parse(stamp);
          if (!Number.isNaN(parsed)) timesort = Math.floor(parsed / 1000);
        }
      }
      if (!timesort) return;

      const courseEl = item.querySelector(".course, .coursename");
      out.push({
        name,
        timesort,
        course: { shortname: courseEl ? cleanText(courseEl) : "", fullname: "" },
      });
    });

    return out.sort((a, b) => a.timesort - b.timesort);
  }

  /* Элементы курса (задания, тесты, файлы и т.д.) */
  function activities(html) {
    const doc = parse(html);
    const found = new Map();

    doc.querySelectorAll("a[href*='/mod/']").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const m = /\/mod\/([a-zA-Z0-9_]+)\/view\.php\?id=(\d+)/.exec(href);
      if (!m) return;
      const cmid = Number(m[2]);
      const modname = m[1].toLowerCase();
      let name = cleanText(a);
      if (!name) {
        const instance = a.querySelector(".instancename");
        if (instance) name = cleanText(instance);
      }
      if (!name) return;

      const prev = found.get(cmid);
      if (!prev || name.length > prev.name.length) {
        found.set(cmid, {
          cmid,
          modname,
          name,
          url: toAbsolute(href),
        });
      }
    });

    return Array.from(found.values());
  }

  /* Остаток времени теста.
     Moodle отдаёт его аргументом вызова таймера в инлайн-скрипте
     (M.mod_quiz.timer.init(секунды, предпросмотр) либо module.init(...)
     внутри require(['mod_quiz/timer'])). Сам текст в разметке пустой —
     его заполняет JavaScript. Если лимита времени нет, вызова не будет. */
  function extractTimer(html) {
    const patterns = [
      /M\.mod_quiz\.timer\.init\s*\(\s*(\d+)\s*(?:,\s*(true|false))?/,
      /timer\.init["']?\s*,\s*\[\s*(\d+)\s*(?:,\s*(true|false))?/,
      /timer["']?\s*,\s*["']init["']\s*,\s*\[\s*(\d+)\s*(?:,\s*(true|false))?/,
      /timer[^;]{0,200}?init\s*\(\s*(\d+)\s*(?:,\s*(true|false))?/,
    ];
    for (const re of patterns) {
      const m = re.exec(html);
      if (m) return { secondsLeft: Number(m[1]), preview: m[2] === "true" };
    }

    /* Если время уже отрисовано в разметке */
    const shown = /id="quiz-time-left"[^>]*>([^<]*)</.exec(html);
    if (shown && shown[1].trim()) {
      const parts = shown[1].trim().split(":").map(Number);
      if (parts.length && parts.every((n) => !Number.isNaN(n))) {
        let seconds = 0;
        parts.forEach((n) => { seconds = seconds * 60 + n; });
        return { secondsLeft: seconds, preview: false };
      }
    }
    return null;
  }

  /* Навигация по тесту: список вопросов, страницы, состояние ответов */
  function quizInfo(html) {
    const doc = parse(html);
    const block = doc.querySelector("#mod_quiz_navblock");
    const timer = extractTimer(html);
    if (!block) return timer ? { questions: [], timer } : null;

    const questions = [];
    block.querySelectorAll(".qnbutton").forEach((el, index) => {
      const pageAttr = el.getAttribute("data-quiz-page");
      const page = pageAttr !== null ? Number(pageAttr) : index;
      const classes = " " + (el.className || "") + " ";
      const numberMatch = /(\d+)/.exec(cleanText(el));
      questions.push({
        page,
        number: numberMatch ? numberMatch[1] : String(index + 1),
        href: el.getAttribute("href") || "",
        current: el.classList.contains("thispage"),
        flagged: el.classList.contains("flagged"),
        answered: / answersaved | complete | correct | partiallycorrect | incorrect /.test(classes),
        correct: / correct /.test(classes),
        incorrect: / incorrect /.test(classes),
        title: el.getAttribute("title") || "",
      });
    });

    if (!questions.length) return timer ? { questions: [], timer } : null;

    const current = questions.find((q) => q.current);
    const pages = questions.map((q) => q.page).filter((p) => !Number.isNaN(p));
    const totalPages = pages.length ? Math.max.apply(null, pages) + 1 : 1;

    return {
      questions,
      total: questions.length,
      answered: questions.filter((q) => q.answered).length,
      currentPage: current ? current.page : 0,
      totalPages,
      timer,
    };
  }

  /* Разбираем страницу, доступную для действий (тест).
     Возвращает элементы, по которым приложение решает, что делать. */
  const DROP_SELECTORS = [
    "script", "style", "link", "nav", "noscript", "iframe",
    ".accesshide", ".sr-only", ".visually-hidden", ".breadcrumb",
    ".activity-navigation", ".tertiary-navigation", ".drawer", ".drawer-toggles",
    ".urlselect", ".moodle-dialogue-base", ".modal", ".popover", ".tooltip",
  ];

  function material(html) {
    const doc = parse(html);
    const main = doc.querySelector("#region-main") ||
                 doc.querySelector("[role='main']") ||
                 doc.body;

    const heading = doc.querySelector("#region-main h1, [role='main'] h1, .page-header-headings h1");
    const title = heading ? cleanText(heading) : (doc.title || "").trim();

    /* Вложения */
    const files = [];
    main.querySelectorAll("a[href*='pluginfile.php']").forEach((a) => {
      const url = toAbsolute(a.getAttribute("href") || "");
      if (!url || !isMoodleUrl(url)) return;
      let name = cleanText(a);
      if (!name) {
        const last = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
        name = last || "файл";
      }
      if (!files.some((f) => f.url === url)) files.push({ url, name });
    });

    const clone = main.cloneNode(true);

    /* Формы: рабочими оставляем только формы тестов (их можно отправлять),
       остальные убираем — приложение работает в режиме просмотра. */
    clone.querySelectorAll("form").forEach((form) => {
      const action = toAbsolute(form.getAttribute("action") || "");
      const isQuiz = /\/mod\/quiz\//.test(action) && isMoodleUrl(action);
      if (isQuiz) {
        form.setAttribute("data-relay-action", action);
        form.removeAttribute("action");
        form.removeAttribute("method");
        form.classList.add("interactive");
      } else {
        form.remove();
      }
    });

    /* Убираем служебные элементы */
    clone.querySelectorAll(DROP_SELECTORS.join(",")).forEach((node) => node.remove());
    clone.querySelectorAll("[role='navigation']").forEach((node) => node.remove());

    /* Поля вне форм тестов не нужны */
    clone.querySelectorAll("input, button, select, textarea").forEach((el) => {
      if (!el.closest("[data-relay-action]")) el.remove();
    });

    /* Ссылки */
    clone.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
        a.removeAttribute("href");
        return;
      }
      const url = toAbsolute(href);
      if (/pluginfile\.php/.test(url)) {
        a.setAttribute("data-file-url", url);
        a.removeAttribute("href");
      } else if (isMoodleUrl(url)) {
        a.setAttribute("href", url);
        a.setAttribute("data-internal", "1");
      } else {
        a.setAttribute("href", url);
        a.setAttribute("data-external", "1");
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      }
    });

    /* Картинки подгрузим через прокси */
    const images = [];
    clone.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (!src || /^data:/i.test(src)) return;
      const url = toAbsolute(src);
      images.push(url);
      img.setAttribute("data-image-url", url);
      img.removeAttribute("src");
    });

    /* Есть ли на странице форма теста — по этому признаку включаем
       интерактивный режим и подпись «можно отвечать». */
    const hasInteractive = !!clone.querySelector("[data-relay-action]");
    const quiz = quizInfo(html);

    return { title, files, images, html: clone.innerHTML, interactive: hasInteractive, quiz };
  }

  return {
    sesskey, fullname, userPicture, userId, courses, events, activities,
    material, toAbsolute, isMoodleUrl, quizInfo, extractTimer,
  };
})();
