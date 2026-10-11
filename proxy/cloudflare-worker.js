/* ============================================================
   Прокси для Cloudflare Workers (бесплатный тариф).
   Те же маршруты, что и у локального прокси, но без раздачи статики
   (статику хостит Cloudflare Pages или Render Static).

   Развёртывание:
   1. Дашборд Cloudflare -> Workers & Pages -> Create -> Worker.
   2. Вставить этот файл целиком.
   3. Скопировать URL вида https://<имя>.<субдомен>.workers.dev
      в js/config.js в поле PROXY_URL.

   Прокси без состояния: пароли, cookie и токены не сохраняются.
   ============================================================ */

const MOODLE_URL = "https://newsdo.vsu.by";
const TIMEOUT_MS = 25000;
const REDIRECT_CODES = [301, 302, 303, 307, 308];

/* Для личного использования можно оставить "*".
   Если Mini App станет публичным — укажите домен фронтенда. */
const ALLOWED_ORIGIN = "*";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

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

async function moodleFetch(url, options, jar) {
  const headers = Object.assign({}, options.headers || {});
  const cookie = jarToString(jar);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, Object.assign({}, options, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
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

async function sessionLogin(payload) {
  const { username, password } = payload;
  if (!username || !password) return json({ error: "Укажите логин и пароль" }, 400);

  const jar = {};

  const pageRes = await moodleFetch(`${MOODLE_URL}/login/index.php`, { method: "GET" }, jar);
  const pageHtml = await pageRes.text();
  const tokenMatch = /name="logintoken"\s+value="([^"]+)"/.exec(pageHtml);
  if (!tokenMatch) return json({ error: "Moodle не вернул форму входа" }, 502);

  let response = await moodleFetch(
    `${MOODLE_URL}/login/index.php`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        anchor: "",
        logintoken: tokenMatch[1],
        username,
        password,
      }),
    },
    jar
  );
  let html = response.status === 200 ? await response.text() : "";

  /* Moodle после входа делает шаг testsession (проверка cookie) —
     проходим всю цепочку редиректов */
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

  /* Проверяем, что сессия авторизована */
  const checkRes = await moodleFetch(`${MOODLE_URL}/my/`, { method: "GET" }, jar);
  const checkHtml = await checkRes.text();
  const loggedIn = !/name="logintoken"/.test(checkHtml) && /"sesskey"/.test(checkHtml);

  if (loggedIn) {
    return json({ cookies: jarToString(jar) });
  }

  return json({ error: extractLoginError(html || checkHtml) || "Неверный логин или пароль" }, 401);
}

async function sessionPage(payload) {
  const { cookies, path: pagePath } = payload;
  if (!pagePath || !pagePath.startsWith("/") || pagePath.includes("://")) {
    return json({ error: "Некорректный путь" }, 400);
  }
  const jar = parseCookieString(cookies);
  const res = await moodleFetch(`${MOODLE_URL}${pagePath}`, { method: "GET" }, jar);
  const html = await res.text();
  return json({ html, cookies: jarToString(jar), status: res.status });
}

async function sessionAjax(payload) {
  const { cookies, sesskey, methodname, args = {} } = payload;
  if (!sesskey || !methodname) return json({ error: "Нужны sesskey и methodname" }, 400);

  const jar = parseCookieString(cookies);
  const url = `${MOODLE_URL}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`;
  const res = await moodleFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    },
    jar
  );
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { error: `Moodle вернул не-JSON ответ (HTTP ${res.status})` };
  }
  return json({ data, cookies: jarToString(jar) });
}

/* Имя файла из Content-Disposition (заголовки приходят в latin-1) */
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
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return raw;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* Отдаём результат: HTML-страницу или файл в base64 */
async function respondWithPage(response, jar, label) {
  const contentType = response.headers.get("content-type") || "";
  const filename = decodeFilename(response.headers.get("content-disposition"));

  if (contentType.includes("text/html")) {
    const html = await response.text();
    return json({ kind: "html", html, filename, status: response.status, cookies: jarToString(jar) });
  }

  const buffer = await response.arrayBuffer();
  const limit = 15 * 1024 * 1024;
  if (buffer.byteLength > limit) {
    return json({
      kind: "file",
      tooLarge: true,
      size: buffer.byteLength,
      filename,
      contentType,
      cookies: jarToString(jar),
    });
  }

  return json({
    kind: "file",
    filename,
    contentType,
    size: buffer.byteLength,
    base64: arrayBufferToBase64(buffer),
    status: response.status,
    cookies: jarToString(jar),
  });
}

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
async function sessionOpen(payload) {
  const { cookies, url } = payload;
  if (!url || !/^https?:\/\//i.test(url)) return json({ error: "Некорректный адрес" }, 400);
  if (!url.startsWith(MOODLE_URL)) return json({ error: "Адрес вне сайта Moodle" }, 400);

  const jar = parseCookieString(cookies);
  const response = await followRedirects(await moodleFetch(url, { method: "GET" }, jar), jar, 5);
  return await respondWithPage(response, jar);
}

/* Отправка формы (прохождение тестов) */
async function sessionSubmit(payload) {
  const { cookies, action, fields = {} } = payload;
  if (!action || !action.startsWith(MOODLE_URL)) {
    return json({ error: "Некорректный адрес формы" }, 400);
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
  return await respondWithPage(response, jar);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch (e) {
      payload = {};
    }

    try {
      switch (url.pathname) {
        case "/api/session/login":
          return await sessionLogin(payload);
        case "/api/session/page":
          return await sessionPage(payload);
        case "/api/session/ajax":
          return await sessionAjax(payload);
        case "/api/session/open":
          return await sessionOpen(payload);
        case "/api/session/submit":
          return await sessionSubmit(payload);
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      return json({ error: "Не удалось выполнить запрос к Moodle" }, 502);
    }
  },
};
