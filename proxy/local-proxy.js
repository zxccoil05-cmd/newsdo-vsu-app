/* ============================================================
   Локальный прокси для прототипа.
   Запуск:  node proxy/local-proxy.js
   Затем открыть  http://localhost:3000

   Режимы работы:
   - сессионный (основной): вход через веб-форму Moodle, cookie-сессия
     хранится ТОЛЬКО на устройстве пользователя, прокси их не сохраняет;
   - прямой API по токену (если вуз включит сервис moodle_mobile_app).

   Прокси не имеет состояния: в журнал пишутся только метод, путь и код.
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");

const MOODLE_URL = "https://newsdo.vsu.by";
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..");
const TIMEOUT_MS = 25000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const REDIRECT_CODES = [301, 302, 303, 307, 308];

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

async function moodleFetch(url, options, jar) {
  const headers = Object.assign({}, options.headers || {});
  const cookie = jarToString(jar);
  if (cookie) headers.Cookie = cookie;
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined;
  const res = await fetch(url, Object.assign({}, options, { headers, redirect: "manual", signal }));
  absorbCookies(res, jar);
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

/* ---------- Раздача статики ---------- */

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
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
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, buffer) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buffer);
  });
}

/* ---------- Маршруты ---------- */

async function handleSessionLogin(req, res) {
  const { username, password } = await readBody(req);
  if (!username || !password) {
    console.log("POST /api/session/login -> 400");
    return sendJson(res, 400, { error: "Укажите логин и пароль" });
  }

  const jar = {};

  /* 1. Берём форму входа и logintoken */
  const pageRes = await moodleFetch(`${MOODLE_URL}/login/index.php`, { method: "GET" }, jar);
  const pageHtml = await pageRes.text();
  const tokenMatch = /name="logintoken"\s+value="([^"]+)"/.exec(pageHtml);
  if (!tokenMatch) {
    console.log("POST /api/session/login -> 502 (нет logintoken)");
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
    jar
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
    response = await moodleFetch(target, { method: "GET" }, jar);
    hops++;
    if (response.status === 200) html = await response.text();
  }

  /* 4. Проверяем, что сессия действительно авторизована */
  const checkRes = await moodleFetch(`${MOODLE_URL}/my/`, { method: "GET" }, jar);
  const checkHtml = await checkRes.text();
  const loggedIn = !/name="logintoken"/.test(checkHtml) && /"sesskey"/.test(checkHtml);

  if (loggedIn) {
    console.log(`POST /api/session/login -> 200 (вход выполнен, редиректов ${hops})`);
    return sendJson(res, 200, { cookies: jarToString(jar) });
  }

  const message = extractLoginError(html || checkHtml) || "Неверный логин или пароль";
  console.log("POST /api/session/login -> 401");
  return sendJson(res, 401, { error: message });
}

async function handleSessionPage(req, res) {
  const { cookies, path: pagePath } = await readBody(req);
  if (!pagePath || !pagePath.startsWith("/") || pagePath.includes("://")) {
    return sendJson(res, 400, { error: "Некорректный путь" });
  }
  const jar = parseCookieString(cookies);
  const pageRes = await moodleFetch(`${MOODLE_URL}${pagePath}`, { method: "GET" }, jar);
  const html = await pageRes.text();
  console.log(`POST /api/session/page (${pagePath}) -> ${pageRes.status}`);
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
    console.log(`${label} (страница) -> ${response.status}`);
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
    console.log(`${label} (файл слишком велик) -> ${buffer.length} байт`);
    return sendJson(res, 200, {
      kind: "file",
      tooLarge: true,
      size: buffer.length,
      filename,
      contentType,
      cookies: jarToString(jar),
    });
  }

  console.log(`${label} (файл ${buffer.length} байт) -> ${response.status}`);
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
    response = await moodleFetch(target, { method: "GET" }, jar);
    hops++;
  }
  return response;
}

/* Открытие файла или страницы Moodle по абсолютной ссылке */
async function handleSessionOpen(req, res) {
  const { cookies, url } = await readBody(req);
  if (!url || !/^https?:\/\//i.test(url)) {
    return sendJson(res, 400, { error: "Некорректный адрес" });
  }
  /* Разрешаем обращаться только к тому же сайту Moodle */
  if (!url.startsWith(MOODLE_URL)) {
    return sendJson(res, 400, { error: "Адрес вне сайта Moodle" });
  }

  const jar = parseCookieString(cookies);
  const response = await followRedirects(await moodleFetch(url, { method: "GET" }, jar), jar, 5);
  return respondWithPage(res, response, jar, "POST /api/session/open");
}

/* Отправка формы (прохождение тестов): поля пересылаются в Moodle как есть */
async function handleSessionSubmit(req, res) {
  const { cookies, action, fields = {} } = await readBody(req);
  if (!action || !action.startsWith(MOODLE_URL)) {
    return sendJson(res, 400, { error: "Некорректный адрес формы" });
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)));
    else form.append(key, String(value));
  }

  const jar = parseCookieString(cookies);
  let response = await moodleFetch(
    action,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    },
    jar
  );
  response = await followRedirects(response, jar, 6);
  return respondWithPage(res, response, jar, `POST /api/session/submit (${action.split("/").pop()})`);
}

async function handleSessionAjax(req, res) {
  const { cookies, sesskey, methodname, args = {} } = await readBody(req);
  if (!sesskey || !methodname) {
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
    jar
  );
  let data;
  try {
    data = await ajaxRes.json();
  } catch (e) {
    data = { error: `Moodle вернул не-JSON ответ (HTTP ${ajaxRes.status})` };
  }
  console.log(`POST /api/session/ajax (${methodname}) -> ${ajaxRes.status}`);
  return sendJson(res, 200, { data, cookies: jarToString(jar) });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

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
        jar
      );
      const data = await result.json().catch(() => ({ error: "Не-JSON ответ Moodle" }));
      console.log(`POST /api/login -> ${result.status}`);
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
        jar
      );
      const data = await result.json().catch(() => ({ error: "Не-JSON ответ Moodle" }));
      console.log(`POST /api/ws (${wsfunction}) -> ${result.status}`);
      return sendJson(res, result.status, data);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405);
    res.end();
  } catch (err) {
    console.error(`${req.method} ${pathname} -> ошибка:`, err.message);
    sendJson(res, 502, { error: "Не удалось выполнить запрос к Moodle" });
  }
});

server.listen(PORT, () => {
  console.log(`Прототип запущен: http://localhost:${PORT}`);
  console.log("Прокси без состояния: пароли, cookie и токены не сохраняются.");
});
