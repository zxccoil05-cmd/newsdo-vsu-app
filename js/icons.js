/* ============================================================
   Иконки: единый штриховой набор (спрайт в index.html).
   Здесь — сопоставление типов элементов курса и файлов с иконками.
   ============================================================ */

const Icons = (() => {
  /* Типы элементов Moodle → иконка */
  const MOD_ICONS = {
    assign: "i-clipboard",
    quiz: "i-check-square",
    forum: "i-message",
    resource: "i-file",
    folder: "i-folder",
    url: "i-link",
    page: "i-file-text",
    book: "i-book",
    choice: "i-check-square",
    feedback: "i-message",
    questionnaire: "i-question",
    glossary: "i-book",
    wiki: "i-file-text",
    lesson: "i-book",
    workshop: "i-clipboard",
    chat: "i-message",
    data: "i-table",
    scorm: "i-stack",
    h5pactivity: "i-question",
    lti: "i-external",
    bigbluebuttonbn: "i-video",
    attendance: "i-check",
    customcert: "i-award",
    label: "i-info",
  };

  /* Расширения файлов → подпись, иконка, цветовой тон */
  const FILE_KINDS = {
    pdf: { label: "PDF", icon: "i-file-text", tone: "red" },
    doc: { label: "DOC", icon: "i-file-text", tone: "blue" },
    docx: { label: "DOCX", icon: "i-file-text", tone: "blue" },
    rtf: { label: "RTF", icon: "i-file-text", tone: "blue" },
    odt: { label: "ODT", icon: "i-file-text", tone: "blue" },
    xls: { label: "XLS", icon: "i-table", tone: "green" },
    xlsx: { label: "XLSX", icon: "i-table", tone: "green" },
    csv: { label: "CSV", icon: "i-table", tone: "green" },
    ods: { label: "ODS", icon: "i-table", tone: "green" },
    ppt: { label: "PPT", icon: "i-slides", tone: "orange" },
    pptx: { label: "PPTX", icon: "i-slides", tone: "orange" },
    odp: { label: "ODP", icon: "i-slides", tone: "orange" },
    png: { label: "PNG", icon: "i-image", tone: "violet" },
    jpg: { label: "JPG", icon: "i-image", tone: "violet" },
    jpeg: { label: "JPEG", icon: "i-image", tone: "violet" },
    gif: { label: "GIF", icon: "i-image", tone: "violet" },
    webp: { label: "WEBP", icon: "i-image", tone: "violet" },
    svg: { label: "SVG", icon: "i-image", tone: "violet" },
    bmp: { label: "BMP", icon: "i-image", tone: "violet" },
    zip: { label: "ZIP", icon: "i-archive", tone: "amber" },
    rar: { label: "RAR", icon: "i-archive", tone: "amber" },
    "7z": { label: "7Z", icon: "i-archive", tone: "amber" },
    tar: { label: "TAR", icon: "i-archive", tone: "amber" },
    gz: { label: "GZ", icon: "i-archive", tone: "amber" },
    mp4: { label: "MP4", icon: "i-video", tone: "pink" },
    avi: { label: "AVI", icon: "i-video", tone: "pink" },
    mov: { label: "MOV", icon: "i-video", tone: "pink" },
    mkv: { label: "MKV", icon: "i-video", tone: "pink" },
    webm: { label: "WEBM", icon: "i-video", tone: "pink" },
    mp3: { label: "MP3", icon: "i-audio", tone: "teal" },
    wav: { label: "WAV", icon: "i-audio", tone: "teal" },
    ogg: { label: "OGG", icon: "i-audio", tone: "teal" },
    m4a: { label: "M4A", icon: "i-audio", tone: "teal" },
    txt: { label: "TXT", icon: "i-file-text", tone: "gray" },
    md: { label: "MD", icon: "i-file-text", tone: "gray" },
    html: { label: "HTML", icon: "i-file-text", tone: "indigo" },
    htm: { label: "HTML", icon: "i-file-text", tone: "indigo" },
    json: { label: "JSON", icon: "i-file-text", tone: "indigo" },
    xml: { label: "XML", icon: "i-file-text", tone: "indigo" },
  };

  const CONTENT_KINDS = [
    { test: /pdf/, kind: FILE_KINDS.pdf },
    { test: /word|officedocument\.wordprocessing/, kind: FILE_KINDS.doc },
    { test: /excel|spreadsheet|officedocument\.spreadsheet/, kind: FILE_KINDS.xls },
    { test: /powerpoint|presentation|officedocument\.presentation/, kind: FILE_KINDS.ppt },
    { test: /^image\//, kind: FILE_KINDS.png },
    { test: /^video\//, kind: FILE_KINDS.mp4 },
    { test: /^audio\//, kind: FILE_KINDS.mp3 },
    { test: /zip|compressed|tar/, kind: FILE_KINDS.zip },
    { test: /^text\//, kind: FILE_KINDS.txt },
  ];

  /* Разметка иконки */
  function svg(name, extraClass) {
    return `<svg class="icon${extraClass ? " " + extraClass : ""}" aria-hidden="true"><use href="#${name}"></use></svg>`;
  }

  /* Иконка типа элемента курса */
  function mod(modname) {
    return svg(MOD_ICONS[modname] || "i-file");
  }

  /* Тип файла: расширение из имени или URL, плюс MIME */
  function file(nameOrUrl, contentType) {
    const value = String(nameOrUrl || "");
    const clean = value.split("?")[0].split("#")[0];
    let ext = "";
    const dot = clean.lastIndexOf(".");
    if (dot > -1 && clean.length - dot <= 6) {
      ext = clean.slice(dot + 1).toLowerCase();
    }

    if (FILE_KINDS[ext]) return Object.assign({ ext }, FILE_KINDS[ext]);

    const type = String(contentType || "").toLowerCase();
    for (const entry of CONTENT_KINDS) {
      if (entry.test.test(type)) return Object.assign({ ext }, entry.kind);
    }

    return {
      ext,
      label: ext ? ext.toUpperCase().slice(0, 4) : "FILE",
      icon: "i-file",
      tone: "gray",
    };
  }

  return { svg, mod, file, MOD_ICONS, FILE_KINDS };
})();
