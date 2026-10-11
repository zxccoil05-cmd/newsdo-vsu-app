/* ============================================================
   Локальный прокси для прототипа.
   Запуск:  node proxy/local-proxy.js
   Затем открыть  http://localhost:3000

   Режимы работы:
   - сессионный (основной): вход через веб-форму Moodle, cookie-сессия
     хранится ТОЛЬКО на устройстве пользователя, прокси их не сохраняет;
   - прямой API по токену (если вуз включит сервис moodle_mobile_app).

   Логи: только метаданные — метод, путь, код, время, размер, IP.
   Пароли, cookie и тела запросов НЕ логируются.

   Переменные окружения:
   - PORT            порт (Render подставляет сам)
   - LOG_LEVEL       debug | info | warn | error (по умолчанию info)
   - HEARTBEAT_MS    период пульса в журнал, мс (по умолчанию 600000)
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");

const MOODLE_URL = "https://newsdo.vsu.by";
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..");
const TIMEOUT_MS = 25000;

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 600000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* CORS: авторизация передаётся в теле запроса, а не в cookie,
   поэтому Access-Control-Allow-Credentials не нужен. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const REDIRECT_CODES = [301, 302, 303, 307, 308];

/* ---------- Журнал ---------- */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[LOG_LEVEL] || LEVELS.info;

function log(level, tag, message) {
  if ((LEVELS[level] || 0) < MIN_LEVEL) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} [${tag}] ${message}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

const stats = {
  started: Date.now(),
  requests: 0,
  errors: 0,
  moodleCalls: 0,
  logins: 0,
  loginsFailed: 0,
};

let reqSeq = 0;
function nextReqId() {
  reqSeq += 1;
  return reqSeq.toString(36).padStart(3, "0") + Math.random().toString(36).slice(2, 5);
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket.remoteAddress || "-";
}

function shortUrl(url) {
  return String(url).startsWith(MOODLE_URL) ? String(url).slice(MOODLE_URL.length) || "/" : String(url);
}

/* ---------- Работа с cookie ---------- */

function parseCookieString(str) {
  const jar = {};
  String(str || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return jar;
}

function jarToString(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbCookies(res, jar) {
  let list = [];
  if (typeof res.headers.getSetCookie === "function") {
    list = res.headers.getSetCookie();
  } else {
    const single = res.headers.get("set-cookie");
    if (single) list = single.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  }
  for (const raw of list) {
    const pair = String(raw).split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}

/* ---------- Запросы к Moodle ---------- */

async function moodleFetch(url, options, jar, label) {
  const method = options.method || "GET";
  const started = Date.now();
  const headers = Object.assign({}, options.headers || {});
  const cookie = jarToString(jar);
  if (cookie) headers.Cookie = cookie;
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined;

  log("debug", "moodle", `→ ${method} ${shortUrl(url)}`);

  let res;
  try {
    res = await fetch(url, Object.assign({}, options, { headers, redirect: "manual", signal }));
  } catch (err) {
    stats.errors += 1;
    const reason = err.name === "TimeoutError" || err.name === "AbortError"
      ? `таймаут ${TIMEOUT_MS}мс`
      : err.message;
    log("warn", "moodle", `✗ ${method} ${shortUrl(url)} — ${reason} (${Date.now() - started}мс)`);
    throw err;
  }

  absorbCookies(res, jar);
  stats.moodleCalls += 1;
  const ms = Date.now() - started;

  log(ms > 5000 ? "warn" : "debug", "moodle",
    `← ${res.status} ${method} ${shortUrl(url)} ${ms}мс cookie=${Object.keys(jar).length}` +
    (ms > 5000 ? " (медленно)" : ""));

  return res;
}

function extractLoginError(html) {
  const patterns = [
    /id="loginerrormessage"[^>]*>([\s\S]*?)<\/(?:div|span)>/i,
    /<div[^>]*class="[^"]*alert[^"]*danger[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*loginerrors[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return null;
}

/* ---------- Ответы и статика ---------- */

function sendJson(res, code, obj) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS));
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {};
  }
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  filePath = path.normalize(path.join(ROOT, filePath));
  if (!filePath.startsWith(ROOT)) {
    log("warn", "static", `#${req.id} отказ: путь вне каталога (${pathname})`);
    res.writeHead(403, CORS);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, buffer) => {
    if (err) {
      log("warn", "static", `#${req.id} 404 ${pathname}`);
      res.writeHead(404, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, CORS));
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, Object.assign({ "Content-Type": MIME[ext] || "application/octet-stream" }, CORS));
    res.end(buffer);
  });
}

/* ---------- Маршруты ---------- */

async function handleSessionLogin(req, res) {
  const { username, password } = await readBody(req);
  stats.logins += 1;

  if (!username || !password) {
    req.note("warn", "логин: не переданы логин или пароль");
    return sendJson(res, 400, { error: "Укажите логин и пароль" });
  }

  req.note("info", `логин: попытка, пользователь «${username}»`);
  const jar = {};

  /* 1. Берём форму входа и logintoken */
  const pageRes = await moodleFetch(`${MOODLE_URL}/login/index.php`, { method: "GET" }, jar, "форма входа");
  const pageHtml = await pageRes.text();
  const tokenMatch = /name="logintoken"\s+value="([^"]+)"/.exec(pageHtml);
  if (!tokenMatch) {
    stats.errors += 1;
    req.note("error", "логин: Moodle не вернул форму входа (нет logintoken)");
    return sendJson(res, 502, { error: "Moodle не вернул форму входа" });
  }

  /* 2. Отправляем данные формы */
  const form = new URLSearchParams({
    anchor: "",
    logintoken: tokenMatch[1],
    username,
    password,
  });
  let response = await moodleFetch(
    `${MOODLE_URL}/login/index.php`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    },
    jar,
    "отправка формы"
  );
  let html = response.status === 200 ? await response.text() : "";

  /* 3. Проходим цепочку редиректов: после входа Moodle сначала
     отправляет на /login/index.php?testsession=... (проверка cookie),
     и только затем — на главную страницу. */
  let hops = 0;
  while (REDIRECT_CODES.includes(response.status) && hops < 6) {
    const location = response.headers.get("location") || "";
    const target = /^https?:/i.test(location)
      ? location
      : MOODLE_URL + (location.startsWith("/") ? "" : "/") + location;
    req.note("debug", `логин: редирект ${hops + 1} → ${shortUrl(target)}`);
    response = await moodleFetch(target, { method: "GET" }, jar, "редирект");
    hops++;
    if (response.status === 200) html = await response.text();
  }

  /* 4. Проверяем, что сессия действительно авторизована */
  const checkRes = await moodleFetch(`${MOODLE_URL}/my/`, { method: "GET" }, jar, "проверка сессии");
  const checkHtml = await checkRes.text();
  const loggedIn = !/name="logintoken"/.test(checkHtml) && /"sesskey"/.test(checkHtml);

  if (loggedIn) {
    req.note("info", `логин: успех, пользователь «${username}», редиректов ${hops}, cookie ${Object.keys(jar).length}`);
    return sendJson(res, 200, { cookies: jarToString(jar) });
  }

  stats.loginsFailed += 1;
  const message = extractLoginError(html || checkHtml) || "Неверный логин или пароль";
  req.note("warn", `логин: отказ для «${username}» — ${message}`);
  return sendJson(res, 401, { error: message });
}

async function handleSessionPage(req, res) {
  const { cookies, path: pagePath } = await readBody(req);
  if (!pagePath || !pagePath.startsWith("/") || pagePath.includes("://")) {
    req.note("warn", `страница: некорректный путь «${pagePath}»`);
    return sendJson(res, 400, { error: "Некорректный путь" });
  }
  const jar = parseCookieString(cookies);
  req.note("debug", `страница: cookie ${Object.keys(jar).length}`);
  const pageRes = await moodleFetch(`${MOODLE_URL}${pagePath}`, { method: "GET" }, jar, "страница");
  const html = await pageRes.text();
  req.note("info", `страница ${pagePath} → ${pageRes.status}, ${html.length} символов`);
  return sendJson(res, 200, { html, cookies: jarToString(jar), status: pageRes.status });
}

/* Имя файла из заголовка Content-Disposition.
   Moodle отдаёт имя в UTF-8, но заголовки декодируются как latin-1,
   поэтому при необходимости переводим байты обратно в UTF-8. */
function decodeFilename(disposition) {
  if (!disposition) return "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch (e) {
      /* пробуем другой вариант */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  if (!plain) return "";
  const raw = plain[1].trim();
  try {
    const fixed = Buffer.from(raw, "latin1").toString("utf8");
    return fixed.includes("\uFFFD") ? raw : fixed;
  } catch (e) {
    return raw;
  }
}

/* Отдаём результат запроса: HTML-страницу или файл в base64 */
async function respondWithPage(res, response, jar, label) {
  const contentType = response.headers.get("content-type") || "";
  const filename = decodeFilename(response.headers.get("content-disposition"));

  if (contentType.includes("text/html")) {
    const html = await response.text();
    log("info", "app", `${label}: страница → ${response.status}, ${html.length} символов`);
    return sendJson(res, 200, {
      kind: "html",
      html,
      filename,
      status: response.status,
      cookies: jarToString(jar),
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const limit = 15 * 1024 * 1024;
  if (buffer.length > limit) {
    log("warn", "app", `${label}: файл слишком велик — ${(buffer.length / 1048576).toFixed(1)} МБ`);
    return sendJson(res, 200, {
      kind: "file",
      tooLarge: true,
      size: buffer.length,
      filename,
      contentType,
      cookies: jarToString(jar),
    });
  }

  log("info", "app", `${label}: файл «${filename || "без имени"}», ${(buffer.length / 1024).toFixed(1)} КБ, ${contentType || "тип неизвестен"}`);
  return sendJson(res, 200, {
    kind: "file",
    filename,
    contentType,
    size: buffer.length,
    base64: buffer.toString("base64"),
    status: response.status,
    cookies: jarToString(jar),
  });
}

/* Переходы по редиректам Moodle */
async function followRedirects(response, jar, maxHops) {
  let hops = 0;
  while (REDIRECT_CODES.includes(response.status) && hops < maxHops) {
    const location = response.headers.get("location") || "";
    const target = /^https?:/i.test(location)
      ? location
      : MOODLE_URL + (location.startsWith("/") ? "" : "/") + location;
    response = await moodleFetch(target, { method: "GET" }, jar, "редирект");
    hops++;
  }
  if (hops >= maxHops && REDIRECT_CODES.includes(response.status)) {
    log("warn", "moodle", `цепочка редиректов не закончилась за ${maxHops} шагов`);
  }
  return response;
}

/* Открытие файла или страницы Moodle по абсолютной ссылке */
async function handleSessionOpen(req, res) {
  const { cookies, url } = await readBody(req);
  if (!url || !/^https?:\/\//i.test(url)) {
    req.note("warn", `открытие: некорректный адрес «${url}»`);
    return sendJson(res, 400, { error: "Некорректный адрес" });
  }
  /* Разрешаем обращаться только к тому же сайту Moodle */
  if (!url.startsWith(MOODLE_URL)) {
    req.note("warn", `открытие: адрес вне сайта Moodle — ${url}`);
    return sendJson(res, 400, { error: "Адрес вне сайта Moodle" });
  }

  req.note("info", `открытие: ${shortUrl(url)}`);
  const jar = parseCookieString(cookies);
  const response = await followRedirects(await moodleFetch(url, { method: "GET" }, jar, "открытие"), jar, 5);
  return respondWithPage(res, response, jar, `открытие ${shortUrl(url)}`);
}

/* Отправка формы (прохождение тестов): поля пересылаются в Moodle как есть */
async function handleSessionSubmit(req, res) {
  const { cookies, action, fields = {} } = await readBody(req);
  if (!action || !action.startsWith(MOODLE_URL)) {
    req.note("warn", `отправка формы: некорректный адрес «${action}»`);
    return sendJson(res, 400, { error: "Некорректный адрес формы" });
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)));
    else form.append(key, String(value));
  }

  req.note("info", `отправка формы: ${shortUrl(action)}, полей ${Object.keys(fields).length}`);

  const jar = parseCookieString(cookies);
  let response = await moodleFetch(
    action,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    },
    jar,
    "отправка формы"
  );
  response = await followRedirects(response, jar, 6);
  return respondWithPage(res, response, jar, `отправка ${shortUrl(action)}`);
}

async function handleSessionAjax(req, res) {
  const { cookies, sesskey, methodname, args = {} } = await readBody(req);
  if (!sesskey || !methodname) {
    req.note("warn", "ajax: не переданы sesskey или methodname");
    return sendJson(res, 400, { error: "Нужны sesskey и methodname" });
  }
  const jar = parseCookieString(cookies);
  const url = `${MOODLE_URL}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`;
  const body = JSON.stringify([{ index: 0, methodname, args }]);
  const ajaxRes = await moodleFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
    jar,
    `ajax ${methodname}`
  );
  let data;
  try {
    data = await ajaxRes.json();
  } catch (e) {
    data = { error: `Moodle вернул не-JSON ответ (HTTP ${ajaxRes.status})` };
  }
  req.note("info", `ajax ${methodname} → ${ajaxRes.status}`);
  return sendJson(res, 200, { data, cookies: jarToString(jar) });
}

/* ---------- Сервер ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  req.id = nextReqId();
  req.ip = clientIp(req);
  req.note = (level, message) => log(level, "app", `#${req.id} ${message}`);

  const started = Date.now();
  let bytes = 0;
  const originalEnd = res.end.bind(res);
  res.end = function (chunk, ...rest) {
    if (chunk) bytes += Buffer.byteLength(chunk);
    return originalEnd(chunk, ...rest);
  };

  stats.requests += 1;
  res.setHeader("X-Request-Id", req.id);

  res.on("finish", () => {
    const ms = Date.now() - started;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log(level, "http",
      `#${req.id} ${req.method} ${pathname} → ${res.statusCode} ${ms}мс ${bytes}б ip=${req.ip}`);
  });

  res.on("close", () => {
    if (!res.writableFinished) {
      log("warn", "http", `#${req.id} ${req.method} ${pathname} — соединение оборвано клиентом`);
    }
  });

  /* Предварительный запрос браузера перед POST с JSON.
     Без него запрос к прокси с другого домена блокируется. */
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    if (req.method === "POST" && pathname === "/api/session/login") {
      return await handleSessionLogin(req, res);
    }
    if (req.method === "POST" && pathname === "/api/session/page") {
      return await handleSessionPage(req, res);
    }
    if (req.method === "POST" && pathname === "/api/session/ajax") {
      return await handleSessionAjax(req, res);
    }
    if (req.method === "POST" && pathname === "/api/session/open") {
      return await handleSessionOpen(req, res);
    }
    if (req.method === "POST" && pathname === "/api/session/submit") {
      return await handleSessionSubmit(req, res);
    }
    if (req.method === "POST" && pathname === "/api/login") {
      /* Резервный режим: токен через официальный сервис Moodle */
      const { username, password } = await readBody(req);
      const jar = {};
      const result = await moodleFetch(
        `${MOODLE_URL}/login/token.php`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username, password, service: "moodle_mobile_app" }),
        },
        jar,
        "получение токена"
      );
      const data = await result.json().catch(() => ({ error: "Не-JSON ответ Moodle" }));
      req.note("info", `токен: ${result.status}`);
      return sendJson(res, result.status, data);
    }
    if (req.method === "POST" && pathname === "/api/ws") {
      const { token, wsfunction, params = {} } = await readBody(req);
      const form = { wstoken: token, wsfunction, moodlewsrestformat: "json" };
      for (const [key, value] of Object.entries(params)) form[`args[${key}]`] = String(value);
      const jar = {};
      const result = await moodleFetch(
        `${MOODLE_URL}/webservice/rest/server.php`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(form),
        },
        jar,
        `ws ${wsfunction}`
      );
      const data = await result.json().catch(() => ({ error: "Не-JSON ответ Moodle" }));
      req.note("info", `ws ${wsfunction} → ${result.status}`);
      return sendJson(res, result.status, data);
    }

    if (req.method === "GET" && pathname === "/__health") {
      return sendJson(res, 200, {
        ok: true,
        uptime: Math.round((Date.now() - stats.started) / 1000),
        requests: stats.requests,
        moodleCalls: stats.moodleCalls,
        errors: stats.errors,
        logins: stats.logins,
        loginsFailed: stats.loginsFailed,
        rss: Math.round(process.memoryUsage().rss / 1048576),
      });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, pathname);
    }

    req.note("warn", `метод ${req.method} не поддерживается`);
    res.writeHead(405, CORS);
    res.end();
  } catch (err) {
    stats.errors += 1;
    log("error", "app", `#${req.id} ${req.method} ${pathname} — ${err.message}`);
    if (err.stack) log("debug", "app", err.stack.split("\n").slice(1, 4).join(" | "));
    sendJson(res, 502, { error: "Не удалось выполнить запрос к Moodle" });
  }
});

/* Пульс: раз в 10 минут пишем, что сервис жив */
const heartbeat = setInterval(() => {
  const rss = Math.round(process.memoryUsage().rss / 1048576);
  log("info", "heartbeat",
    `uptime=${fmtDuration(Date.now() - stats.started)} запросов=${stats.requests} ` +
    `moodle=${stats.moodleCalls} ошибок=${stats.errors} память=${rss}МБ`);
}, HEARTBEAT_MS);
if (typeof heartbeat.unref === "function") heartbeat.unref();

process.on("unhandledRejection", (reason) => {
  stats.errors += 1;
  log("error", "process", `необработанный отказ промиса: ${reason}`);
});

process.on("uncaughtException", (err) => {
  stats.errors += 1;
  log("error", "process", `непойманное исключение: ${err.message}`);
});

process.on("SIGTERM", () => {
  log("info", "process", "получен SIGTERM — Render перезапускает сервис, завершаюсь");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
});

server.listen(PORT, () => {
  log("info", "start", `сервис запущен на порту ${PORT}`);
  log("info", "start", `Node ${process.version}, каталог статики ${ROOT}`);
  log("info", "start", `Moodle: ${MOODLE_URL}, уровень журнала ${LOG_LEVEL}, пульс ${HEARTBEAT_MS / 1000}с`);
});