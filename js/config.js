/* ============================================================
   Настройки приложения.
   Единственный файл, который нужно править при развёртывании.
   ============================================================ */

window.APP_CONFIG = {
  // Адрес системы Moodle
  MOODLE_URL: "https://newsdo.vsu.by",

  /* Режим авторизации:
     "session" — вход через веб-форму Moodle + cookie-сессия
                 (работает всегда; используется по умолчанию);
     "token"   — официальный web-сервис moodle_mobile_app
                 (работает только если вуз его включил). */
  AUTH_MODE: "session",

  // Имя сервиса для режима "token"
  SERVICE: "moodle_mobile_app",

  // Адрес прокси. Локальный: node proxy/local-proxy.js -> http://localhost:3000
  // После деплоя Cloudflare Worker: https://<имя>.<субдомен>.workers.dev
  PROXY_URL: "http://localhost:3000",

  // Внутренние страницы Moodle, которые использует сессионный режим
  PATHS: {
    dashboard: "/my/",
    courses: "/my/courses.php",
    upcoming: "/calendar/view.php?view=upcoming",
    course: "/course/view.php?id=",
  },

  // Горизонт «ближайших сроков»: события от суток назад до 30 дней вперёд
  CALENDAR_DAYS_BACK: 1,
  CALENDAR_DAYS_AHEAD: 30,
  CALENDAR_LIMIT: 20,

  // Подписи типов элементов курса
  MOD_LABELS: {
    assign: "Задание",
    quiz: "Тест",
    forum: "Форум",
    resource: "Файл",
    folder: "Папка",
    page: "Страница",
    url: "Ссылка",
    book: "Книга",
    choice: "Опрос",
    feedback: "Анкета",
    questionnaire: "Анкета",
    glossary: "Глоссарий",
    wiki: "Вики",
    lesson: "Лекция",
    workshop: "Практикум",
    chat: "Чат",
    data: "База данных",
    scorm: "SCORM-пакет",
    h5pactivity: "H5P",
    lti: "Внешний инструмент",
    bigbluebuttonbn: "Вебинар",
    attendance: "Посещаемость",
    customcert: "Сертификат",
  },
};
