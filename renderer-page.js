/* Сборка страницы: обзор, авторизация, методы, модели, замечания, навигация. */

const mainEl = document.getElementById("main");
const navEl = document.getElementById("nav");
const INFO = SPEC.info || {};
const SERVERS = Array.isArray(SPEC.servers) && SPEC.servers.length ? SPEC.servers : [{ url: "/" }];
const SCHEMES = COMP.securitySchemes || {};
const SCHEMAS = COMP.schemas || {};
const IN_ORDER = { path: 0, query: 1, header: 2, cookie: 3 };
const sub = (base, ...keys) => (base ? [...base, ...keys.map(String)] : null);

function section(id, title, lead) {
  const s = el("section");
  s.id = id;
  s.innerHTML = `<div class="sec-head"><h2>${esc(title)}</h2>${lead || ""}</div>`;
  mainEl.appendChild(s);
  return s;
}

function lazyDetails(d, render) {
  let done = false;
  const run = () => { if (!done && d.open) { done = true; render(); } };
  d.addEventListener("toggle", run);
  run();
}

const firstLine = t => String(t || "").split("\n")[0].trim();

/* ---------- сбор методов ---------- */
const ops = [];
const unresolvedPaths = [];
const usedIds = new Set();
for (const [path, rawItem] of Object.entries(SPEC.paths || {})) {
  const item = deref(rawItem);
  if (item["x-unresolved-ref"]) { unresolvedPaths.push({ path, ref: item["x-unresolved-ref"], error: item["x-ref-error"] }); continue; }
  const itemBase = editBase(rawItem, ["paths", path]);
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const opBase = sub(itemBase, method);
    const params = [];
    const paramEdits = [];
    const entries = [
      ...(item.parameters || []).map((raw, i) => ({ raw, base: sub(itemBase, "parameters", i) })),
      ...(op.parameters || []).map((raw, i) => ({ raw, base: sub(opBase, "parameters", i) })),
    ];
    entries.forEach(({ raw, base }) => {
      const p = deref(raw);
      const i = params.findIndex(x => x.name === p.name && x.in === p.in);
      const edit = editBase(raw, base);
      if (i >= 0) { params[i] = p; paramEdits[i] = edit; } else { params.push(p); paramEdits.push(edit); }
    });
    const order = params.map((p, i) => i).sort((a, b) => (IN_ORDER[params[a].in] ?? 9) - (IN_ORDER[params[b].in] ?? 9));
    let id = `op-${method}-${path.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}`;
    while (usedIds.has(id)) id += "_";
    usedIds.add(id);
    ops.push({
      path, method, op, id, base: opBase,
      params: order.map(i => params[i]),
      paramEdits: order.map(i => paramEdits[i]),
      tag: op.tags && op.tags.length ? op.tags[0] : null,
    });
  }
}

/* ---------- авторизация ---------- */
function opSecurity(op) { return op.security !== undefined ? op.security : SPEC.security || []; }

function schemeShort(name) {
  const sc = deref(SCHEMES[name] || {});
  if (sc.type === "http") return sc.scheme && sc.scheme.toLowerCase() === "bearer" ? `Bearer${sc.bearerFormat ? " " + sc.bearerFormat : ""}` : `HTTP ${sc.scheme || ""}`.trim();
  if (sc.type === "apiKey") return `API key · ${sc.in}`;
  if (sc.type === "oauth2") return "OAuth 2.0";
  if (sc.type === "openIdConnect") return "OpenID Connect";
  return name;
}

function securityLabel(reqs) {
  if (!Array.isArray(reqs) || !reqs.length) return "";
  const variants = reqs.map(r => Object.keys(r).map(schemeShort).join(" + ") || "без авторизации");
  return variants.join(" или ");
}

function authFor(reqs) {
  const res = { headers: [], query: [], user: null };
  const req = (reqs || []).find(r => Object.keys(r).length);
  if (!req) return res;
  const sc = deref(SCHEMES[Object.keys(req)[0]] || {});
  const scheme = (sc.scheme || "").toLowerCase();
  if (sc.type === "http" && scheme === "basic") res.user = "{login}:{password}";
  else if (sc.type === "http") res.headers.push(`Authorization: ${scheme === "bearer" ? "Bearer" : sc.scheme} {TOKEN}`);
  else if (sc.type === "apiKey" && sc.in === "header") res.headers.push(`${sc.name}: {API_KEY}`);
  else if (sc.type === "apiKey" && sc.in === "query") res.query.push(`${sc.name}={API_KEY}`);
  else if (sc.type === "apiKey" && sc.in === "cookie") res.headers.push(`Cookie: ${sc.name}={API_KEY}`);
  else if (sc.type === "oauth2" || sc.type === "openIdConnect") res.headers.push("Authorization: Bearer {ACCESS_TOKEN}");
  return res;
}

function schemeDetails(sc) {
  const rows = [];
  const add = (k, v) => rows.push(`<div class="cons">${k}: <b>${esc(v)}</b></div>`);
  if (sc.type === "http") { add("схема", sc.scheme); if (sc.bearerFormat) add("формат", sc.bearerFormat); }
  if (sc.type === "apiKey") { add("где", sc.in); add("имя", sc.name); }
  if (sc.type === "openIdConnect") add("discovery", sc.openIdConnectUrl);
  if (sc.type === "oauth2") {
    for (const [flow, f] of Object.entries(sc.flows || {})) {
      rows.push(`<div class="cons"><b>${esc(flow)}</b></div>`);
      if (f.authorizationUrl) add("authorizationUrl", f.authorizationUrl);
      if (f.tokenUrl) add("tokenUrl", f.tokenUrl);
      if (f.refreshUrl) add("refreshUrl", f.refreshUrl);
      const scopes = Object.entries(f.scopes || {});
      if (scopes.length) rows.push(`<div class="enum-list">${scopes.map(([k, v]) => `<div class="enum"><code>${esc(k)}</code><span>${esc(v)}</span></div>`).join("")}</div>`);
    }
  }
  return rows.join("") || DASH;
}

function schemeHeaderExample(sc) {
  const scheme = (sc.scheme || "").toLowerCase();
  if (sc.type === "http" && scheme === "bearer") return `Authorization: Bearer <${sc.bearerFormat || "token"}>`;
  if (sc.type === "http" && scheme === "basic") return "Authorization: Basic <base64(login:password)>";
  if (sc.type === "http") return `Authorization: ${sc.scheme} <credentials>`;
  if (sc.type === "apiKey" && sc.in === "header") return `${sc.name}: <key>`;
  if (sc.type === "apiKey" && sc.in === "query") return `?${sc.name}=<key>`;
  if (sc.type === "apiKey" && sc.in === "cookie") return `Cookie: ${sc.name}=<key>`;
  if (sc.type === "oauth2" || sc.type === "openIdConnect") return "Authorization: Bearer <access_token>";
  return "";
}

/* ---------- вызов (curl + проверка тела) ---------- */
function serverBase() {
  const s = SERVERS[0];
  let url = s.url || "/";
  for (const [k, v] of Object.entries(s.variables || {})) url = url.split(`{${k}}`).join(v.default ?? `{${k}}`);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://{host}" + (url.startsWith("/") ? "" : "/") + url;
  return url.replace(/\/+$/, "");
}

function paramExample(p) {
  if (p.example !== undefined) return p.example;
  if (p.examples && typeof p.examples === "object") {
    const first = Object.values(p.examples)[0];
    if (first) return deref(first).value;
  }
  const s = p.schema ? flatten(p.schema) : {};
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  return undefined;
}

function buildCurl(o, contentType, bodyText, hasBody) {
  let path = o.path;
  const query = [];
  const headers = [];
  o.params.forEach(p => {
    if (p["x-unresolved-ref"]) return;
    const ex = paramExample(p);
    const val = ex !== undefined ? (typeof ex === "string" ? ex : JSON.stringify(ex)) : `{${p.name}}`;
    if (p.in === "path") path = path.split(`{${p.name}}`).join(ex !== undefined ? encodeURIComponent(val) : val);
    else if (p.in === "query" && (p.required || ex !== undefined)) query.push(`${p.name}=${ex !== undefined ? encodeURIComponent(val) : val}`);
    else if (p.in === "header" && p.required) headers.push(`${p.name}: ${val}`);
  });
  const auth = authFor(opSecurity(o.op));
  headers.push(...auth.headers);
  query.push(...auth.query);
  const lines = [`curl -X ${o.method.toUpperCase()} "${serverBase()}${path}${query.length ? "?" + query.join("&") : ""}"`];
  if (auth.user) lines.push(`  -u "${auth.user}"`);
  headers.forEach(h => lines.push(`  -H "${h}"`));
  if (hasBody) {
    if (contentType) lines.push(`  -H "Content-Type: ${contentType}"`);
    lines.push(`  -d '${(bodyText ?? "<тело запроса>").replace(/'/g, "'\\''")}'`);
  }
  return lines.join(" \\\n");
}

async function copyText(btn, text, pre) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Скопировано";
  } catch (e) {
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = "Выделено, нажмите Ctrl+C";
  }
  setTimeout(() => { btn.textContent = "Скопировать"; }, 2000);
}

function builderBlock(o, rb) {
  const b = el("div", "block", '<div class="block-head"><h3>Вызов</h3><span class="tag">curl, без отправки запроса</span></div>');
  const content = rb && !rb["x-unresolved-ref"] ? rb.content || {} : {};
  const types = Object.keys(content);
  const jsonType = types.find(t => /json/i.test(t));
  const mt = jsonType ? content[jsonType] : null;
  const box = el("div", "builder" + (mt && mt.schema ? "" : " single"));
  b.appendChild(box);

  let ta = null;
  let status = null;
  if (mt && mt.schema) {
    const first = mediaExamples(mt, "request").find(e => e.value !== undefined);
    const inId = "bld" + (++uid);
    const inWrap = el("div", "bld-in", `<label for="${inId}">Тело запроса, ${esc(jsonType)}. Можно править</label>`);
    ta = el("textarea");
    ta.id = inId;
    ta.spellcheck = false;
    ta.value = JSON.stringify(first ? first.value : sample(mt.schema, "request"), null, 2);
    status = el("div", "status");
    status.setAttribute("role", "status");
    inWrap.append(ta, status);
    box.appendChild(inWrap);
  }

  const out = el("div", "bld-out");
  const bar = el("div", "bld-bar", '<span class="sub">curl</span>');
  const copy = el("button", "btn", "Скопировать");
  copy.type = "button";
  bar.appendChild(copy);
  const pre = el("pre", "code");
  const note = /\{host\}/.test(serverBase()) ? "Адрес сервера в спецификации относительный: замените {host} на адрес стенда. " : "";
  out.append(bar, pre, el("p", "bld-note", esc(note + "Значения в фигурных скобках - заглушки.")));
  box.appendChild(out);

  const update = () => {
    let bodyText = null;
    if (ta) {
      try {
        const value = JSON.parse(ta.value);
        bodyText = JSON.stringify(value);
        const errs = validate(value, mt.schema, "request");
        status.className = "status " + (errs.length ? "bad" : "ok");
        status.innerHTML = errs.length
          ? `<b>Не соответствует схеме:</b>${errs.slice(0, 8).map(e => `<span>${esc(e)}</span>`).join("")}${errs.length > 8 ? `<span>и ещё ${errs.length - 8}</span>` : ""}`
          : "Тело соответствует схеме.";
      } catch (e) {
        bodyText = ta.value.replace(/\s+/g, " ").trim();
        status.className = "status bad";
        status.textContent = "Невалидный JSON: " + e.message;
      }
    }
    pre.textContent = buildCurl(o, jsonType || types[0], bodyText, types.length > 0);
  };
  if (ta) ta.addEventListener("input", update);
  copy.addEventListener("click", () => copyText(copy, pre.textContent, pre));
  update();
  return b;
}

/* ---------- блоки метода ---------- */
function paramsBlock(params, edits) {
  const rows = params.map((p, i) => {
    if (p["x-unresolved-ref"]) return `<tr><td colspan="4">${descHtml(p)}</td></tr>`;
    const schema = p.schema || (p.content ? (Object.values(p.content)[0] || {}).schema : null) || {};
    let flags = `<span class="f-flag">${esc(p.in)}</span>`;
    if (p.required) flags += '<span class="f-flag req">обязательный</span>';
    if (p.deprecated) flags += '<span class="f-flag">устарел</span>';
    const ex = paramExample(p);
    const exHtml = ex !== undefined ? `<span class="ex">Пример: <code>${esc(typeof ex === "string" ? ex : JSON.stringify(ex))}</code></span>` : "";
    const desc = editableMd(p.description || flatten(schema).description, sub(edits[i], "description"), "Описание параметра", "описание", exHtml ? "" : DASH);
    return `<tr><td class="f-name">${esc(p.name)}${flags}</td><td class="f-type">${typeHtml(schema)}</td><td class="f-cons">${consHtml(schema)}</td><td class="f-desc">${desc}${exHtml}</td></tr>`;
  }).join("");
  return el("div", "block", `<div class="block-head"><h3>Параметры</h3><span class="tag">${params.length}</span></div>`
    + `<div class="tbl-wrap"><table><thead><tr><th>Имя</th><th>Тип</th><th>Значения и ограничения</th><th>Описание</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

// base - путь объекта content в файле
function contentView(content, mode, base) {
  const wrap = el("div", "ex-mount");
  const types = Object.keys(content || {});
  if (!types.length) { wrap.innerHTML = '<p class="muted">Тело не описано.</p>'; return wrap; }
  const panel = el("div", "block");
  const draw = t => {
    const mt = content[t] || {};
    panel.innerHTML = "";
    if (mt.schema) {
      const name = schemaName(mt.schema);
      panel.appendChild(el("div", "block", `<div class="sub">Схема${name ? ` <span style="text-transform:none;letter-spacing:0">· ${mlink(name)}</span>` : ""}</div>${schemaTable(mt.schema, true, sub(base, t, "schema"))}`));
    }
    const exBlock = el("div", "block", '<div class="sub">Примеры</div>');
    const mount = el("div", "ex-mount");
    exBlock.appendChild(mount);
    panel.appendChild(exBlock);
    exampleSwitcher(mediaExamples(mt, mode), mount);
  };
  if (types.length > 1) {
    const seg = el("div", "seg");
    seg.setAttribute("role", "tablist");
    const btns = types.map((t, i) => tabButton(seg, "ct" + (++uid), t, () => {
      btns.forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
      draw(t);
    }));
    btns[0].setAttribute("aria-selected", "true");
    wrap.appendChild(seg);
  }
  wrap.appendChild(panel);
  draw(types[0]);
  return wrap;
}

function requestBlock(rb, base) {
  const types = Object.keys(rb.content || {});
  const b = el("div", "block", `<div class="block-head"><h3>Тело запроса</h3>${rb.required ? '<span class="tag req">обязательно</span>' : '<span class="tag">необязательно</span>'}${types.length ? `<span class="tag">${esc(types.join(", "))}</span>` : ""}</div>`
    + (rb["x-unresolved-ref"] ? descHtml(rb) : editableMd(rb.description, sub(base, "description"), "Описание тела запроса", "описание тела запроса")));
  if (!rb["x-unresolved-ref"]) b.appendChild(contentView(rb.content, "request", sub(base, "content")));
  return b;
}

function headersTable(headers) {
  const rows = Object.entries(headers).map(([name, raw]) => {
    const h = deref(raw);
    return `<tr><td class="f-name">${esc(name)}${h.required ? '<span class="f-flag req">обязательный</span>' : ""}</td><td class="f-type">${typeHtml(h.schema || {})}</td><td class="f-desc">${md(h.description) || DASH}</td></tr>`;
  }).join("");
  return `<div class="sub">Заголовки ответа</div><div class="tbl-wrap"><table><thead><tr><th>Заголовок</th><th>Тип</th><th>Описание</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function responsesBlock(responses, base) {
  const codes = Object.keys(responses || {});
  const b = el("div", "block", `<div class="block-head"><h3>Ответы</h3><span class="tag">${esc(codes.join(" · ") || "не описаны")}</span></div>`);
  const list = el("div", "resps");
  codes.forEach((code, i) => {
    const raw = responses[code];
    const r = deref(raw);
    const rBase = editBase(raw, sub(base, code));
    const types = Object.keys(r.content || {});
    const name = types.length && r.content[types[0]].schema ? schemaName(r.content[types[0]].schema) : null;
    const d = el("details", "resp");
    d.open = i === 0;
    d.innerHTML = `<summary><span class="code-pill ${/^[1-5]/.test(code) ? "c" + code[0] : ""}">${esc(code)}</span>`
      + `<span class="resp-desc"${editAttrs(sub(rBase, "description"), "Описание ответа")}>${esc(firstLine(r.description) || (r["x-unresolved-ref"] ? "не подключено" : ""))}</span>`
      + (types.length ? `<span class="resp-ct">${esc(types.join(", "))}${name ? " · " + esc(name) : ""}</span>` : "")
      + `${CHEV}</summary>`;
    const body = el("div", "resp-body");
    d.appendChild(body);
    lazyDetails(d, () => {
      if (r["x-unresolved-ref"]) { body.innerHTML = descHtml(r); return; }
      if (String(r.description || "").includes("\n")) body.appendChild(el("div", "", md(r.description)));
      if (r.headers && Object.keys(r.headers).length) body.appendChild(el("div", "block", headersTable(r.headers)));
      if (types.length) body.appendChild(contentView(r.content, "response", sub(rBase, "content")));
      else body.appendChild(el("p", "muted", "Ответ без тела."));
    });
    list.appendChild(d);
  });
  b.appendChild(list);
  return b;
}

function renderOp(o, open) {
  const { op, method, path } = o;
  const d = el("details", `op m-${method}${op.deprecated ? " deprecated" : ""}`);
  d.id = o.id;
  d.open = open;
  const sec = securityLabel(opSecurity(op));
  d.innerHTML = `<summary><span class="method">${method.toUpperCase()}</span><span class="op-path">${esc(path)}</span>`
    + (op.summary ? `<span class="op-summary"${editAttrs(sub(o.base, "summary"), "Краткое описание метода")}>${esc(op.summary)}</span>` : "")
    + (op.deprecated ? '<span class="badge warn">устарел</span>' : "")
    + (sec ? `<span class="lock">${LOCK}${esc(sec)}</span>` : "")
    + `${CHEV}</summary>`;
  const body = el("div", "op-body");
  d.appendChild(body);
  lazyDetails(d, () => {
    const meta = [];
    if (op.operationId) meta.push(`operationId: <code>${esc(op.operationId)}</code>`);
    if (op.tags && op.tags.length) meta.push(`Теги: ${op.tags.map(t => `<code>${esc(t)}</code>`).join(" ")}`);
    if (op.externalDocs && op.externalDocs.url) meta.push(`<a href="${esc(op.externalDocs.url)}" target="_blank" rel="noopener">${esc(op.externalDocs.description || "Документация")}</a>`);
    const addSummary = !op.summary && o.base ? editableMd("", sub(o.base, "summary"), "Краткое описание метода", "краткое описание") : "";
    const desc = editableMd(op.description, sub(o.base, "description"), "Описание метода", "описание метода");
    if (desc || addSummary || meta.length) {
      body.appendChild(el("div", "block", addSummary + desc + (meta.length ? `<div class="op-meta">${meta.map(m => `<span>${m}</span>`).join("")}</div>` : "")));
    }
    if (o.params.length) body.appendChild(paramsBlock(o.params, o.paramEdits));
    const rb = op.requestBody ? deref(op.requestBody) : null;
    if (rb) body.appendChild(requestBlock(rb, editBase(op.requestBody, sub(o.base, "requestBody"))));
    body.appendChild(builderBlock(o, rb));
    body.appendChild(responsesBlock(op.responses, sub(o.base, "responses")));
  });
  return d;
}

/* ---------- замечания ---------- */
const issues = (META.refWarnings || []).map(w => ({ where: w.ref, text: `${w.message} (${w.file})` }));
ops.forEach(o => {
  const label = `${o.method.toUpperCase()} ${o.path}`;
  const check = (type, mt, mode, where) => {
    if (!mt || !mt.schema || !(/json/i.test(type) || type === "*/*")) return;
    mediaExamples(mt, mode).forEach(ex => {
      // пример из схемы проверяется один раз, в разделе моделей
      if (ex.generated || ex.unresolved || ex.fromSchema || ex.value === undefined) return;
      checkExample(`${label} · ${where} · пример «${ex.summary}»`, "#" + o.id, ex.value, mt.schema, mode);
    });
  };
  const rb = o.op.requestBody ? deref(o.op.requestBody) : null;
  if (rb && rb.content) Object.entries(rb.content).forEach(([t, mt]) => check(t, mt, "request", "запрос"));
  const responses = o.op.responses || {};
  if (!Object.keys(responses).length) issues.push({ where: label, href: "#" + o.id, text: "не описаны ответы" });
  Object.entries(responses).forEach(([code, raw]) => {
    Object.entries(deref(raw).content || {}).forEach(([t, mt]) => check(t, mt, "response", `ответ ${code}`));
  });
});

function checkExample(where, href, value, schema, mode) {
  const errs = validate(value, schema, mode);
  if (errs.length) {
    issues.push({ where, href, text: "пример не соответствует схеме: " + errs.slice(0, 3).join("; ") + (errs.length > 3 ? `; и ещё ${errs.length - 3}` : "") });
  }
  const extra = undocumentedFields(value, schema);
  if (extra.length) {
    issues.push({ where, href, text: "в примере есть поля, которых нет в схеме: " + extra.slice(0, 5).join(", ") + (extra.length > 5 ? ` и ещё ${extra.length - 5}` : "") });
  }
}

// примеры внутри моделей (components/schemas/*/example) - отдельная копия данных, проверяем её тоже
Object.entries(SCHEMAS).forEach(([name, raw]) => {
  const s = flatten(raw);
  if (s.example === undefined || s["x-unresolved-ref"]) return;
  checkExample(`Модель ${name} · пример`, "#" + modelId(name), s.example, raw);
});

/* ---------- навигация ---------- */
function navLabel(text) {
  const li = el("li", "nav-label", esc(text));
  navEl.appendChild(li);
  return li;
}
function navLink(href, html, cls, search) {
  const li = el("li", "", `<a href="${href}" class="${cls || ""}">${html}</a>`);
  if (search != null) li.dataset.search = search.toLowerCase();
  navEl.appendChild(li);
  return li;
}

/* ---------- обзор ---------- */
const infoBase = editBase(INFO, ["info"]);
const brand = document.getElementById("brand");
brand.innerHTML = `<span class="brand-kicker">OpenAPI ${esc(SPEC.openapi || "")}${INFO.version ? " · v" + esc(INFO.version) : ""}</span><span class="brand-name">${esc(INFO.title || META.source || "API")}</span>`;

const intro = el("section", "intro");
intro.id = "overview";
const facts = [];
facts.push(["Сервер", SERVERS.map(s => `<code>${esc(s.url)}</code>${s.description ? ` <span class="muted">${esc(s.description)}</span>` : ""}`).join("<br>")]);
const schemeNames = Object.keys(SCHEMES);
facts.push(["Авторизация", schemeNames.length ? esc(schemeNames.map(schemeShort).join(", ")) : '<span class="muted">не описана</span>']);
facts.push(["Методов", String(ops.length) + (unresolvedPaths.length ? ` <span class="muted">+ ${unresolvedPaths.length} во внешних файлах</span>` : "")]);
facts.push(["Моделей", String(Object.keys(SCHEMAS).length)]);
const c = INFO.contact || {};
if (c.email || c.url || c.name) {
  facts.push(["Контакт", [c.name && esc(c.name), c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, c.url && `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>`].filter(Boolean).join("<br>")]);
}
if (INFO.license && INFO.license.name) facts.push(["Лицензия", esc(INFO.license.name)]);
const lede = editableMd(INFO.description, sub(infoBase, "description"), "Описание API", "описание API");
intro.innerHTML = `<p class="eyebrow">OpenAPI ${esc(SPEC.openapi || "")}${INFO.version ? " · версия " + esc(INFO.version) : ""}</p>`
  + `<h1${editAttrs(sub(infoBase, "title"), "Название API")}>${esc(INFO.title || META.source || "API")}</h1>`
  + (lede ? `<div class="lede">${lede}</div>` : "")
  + `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`
  + (SPEC.externalDocs && SPEC.externalDocs.url ? `<p><a href="${esc(SPEC.externalDocs.url)}" target="_blank" rel="noopener">${esc(SPEC.externalDocs.description || "Внешняя документация")}</a></p>` : "");
mainEl.appendChild(intro);
navLabel("Документация");
navLink("#overview", "Обзор", "is-active");

if (schemeNames.length) {
  const global = securityLabel(SPEC.security);
  const s = section("auth", "Авторизация", global ? `<p>По умолчанию для всех методов: ${esc(global)}.</p>` : "");
  const rows = schemeNames.map(n => {
    const raw = SCHEMES[n];
    const sc = deref(raw);
    const desc = editableMd(sc.description, sub(editBase(raw, ["components", "securitySchemes", n]), "description"), "Описание схемы авторизации", "описание", DASH);
    return `<tr><td class="f-name">${esc(n)}</td><td class="f-type">${esc(sc.type || "")}</td><td class="f-cons">${schemeDetails(sc)}</td><td class="f-desc">${desc}</td></tr>`;
  }).join("");
  s.appendChild(el("div", "tbl-wrap", `<table><thead><tr><th>Схема</th><th>Тип</th><th>Параметры</th><th>Описание</th></tr></thead><tbody>${rows}</tbody></table>`));
  const examples = [...new Set(schemeNames.map(n => schemeHeaderExample(deref(SCHEMES[n]))).filter(Boolean))];
  if (examples.length) s.appendChild(el("pre", "code", esc(examples.join("\n"))));
  navLink("#auth", "Авторизация");
}

/* ---------- методы ---------- */
const opsSection = section("operations", "Методы", `<p>${ops.length} ${ops.length === 1 ? "метод" : ops.length < 5 ? "метода" : "методов"}${ops.length > 3 ? ". Нажмите на метод, чтобы раскрыть." : "."}</p>`);
const tagIndex = new Map((SPEC.tags || []).map((t, i) => [t.name, i]));
const groups = new Map();
(SPEC.tags || []).forEach(t => groups.set(t.name, []));
ops.forEach(o => { if (!groups.has(o.tag)) groups.set(o.tag, []); groups.get(o.tag).push(o); });
const openAll = ops.length <= 3;
const navGroups = [];

for (const [tag, list] of groups) {
  if (!list.length) continue;
  const ti = tagIndex.get(tag);
  const t = ti !== undefined ? SPEC.tags[ti] : {};
  const tagDesc = editableMd(t.description, ti !== undefined ? editBase(t, ["tags", String(ti), "description"]) : null, "Описание тега", "описание тега");
  const g = el("div", "tag-group", `<div class="sec-head"><h3>${esc(tag ?? "Без тега")}</h3>${tagDesc}</div>`);
  opsSection.appendChild(g);
  const label = navLabel(tag ?? "Без тега");
  const items = list.map(o => {
    const node = renderOp(o, openAll);
    g.appendChild(node);
    const li = navLink(`#${o.id}`, `<span class="mini m-${o.method}">${o.method.toUpperCase()}</span><span class="p">${esc(o.path)}</span>`,
      `path${o.op.deprecated ? " deprecated" : ""}`, `${o.method} ${o.path} ${o.op.summary || ""} ${o.op.operationId || ""} ${tag || ""}`);
    li.title = o.op.summary || "";
    return { li, node };
  });
  navGroups.push({ label, group: g, items });
}

if (unresolvedPaths.length) {
  const rows = unresolvedPaths.map(u => `<tr><td class="f-name">${esc(u.path)}</td><td><code>${esc(u.ref)}</code></td><td class="muted">${esc(u.error || "")}</td></tr>`).join("");
  opsSection.appendChild(el("div", "tag-group", `<div class="sec-head" id="unresolved"><h3>Пути во внешних файлах</h3><p>Файлы не найдены рядом со спецификацией, поэтому методы не показаны.</p></div>`
    + `<div class="tbl-wrap"><table><thead><tr><th>Путь</th><th>Ссылка</th><th>Причина</th></tr></thead><tbody>${rows}</tbody></table></div>`));
  navLabel("Не подключено");
  unresolvedPaths.forEach(u => navLink("#unresolved", `<span class="mini m-head">REF</span><span class="p">${esc(u.path)}</span>`, "path", u.path));
}

/* ---------- модели ---------- */
const modelNames = Object.keys(SCHEMAS);
navLabel("Справочник");
if (modelNames.length) {
  const s = section("models", "Модели данных", "<p>Схемы из <code>components/schemas</code>. Нажмите на модель, чтобы раскрыть поля.</p>");
  const list = el("div", "models");
  modelNames.forEach(name => {
    const raw = SCHEMAS[name];
    const sc = flatten(raw);
    const mBase = editBase(raw, ["components", "schemas", name]);
    const d = el("details", "model");
    d.id = modelId(name);
    const kind = Array.isArray(sc.enum) ? `enum: ${sc.enum.map(v => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")}`
      : sc.properties ? `поля: ${Object.keys(sc.properties).join(", ")}` : typeOf(sc);
    d.innerHTML = `<summary><span class="m-name">${esc(name)}</span><span class="m-type">${esc(kind)}</span>`
      + (sc.description ? `<span class="m-desc"${editAttrs(sub(mBase, "description"), "Описание модели")}>${esc(firstLine(sc.description))}</span>` : "") + `${CHEV}</summary>`;
    const body = el("div", "model-body");
    d.appendChild(body);
    lazyDetails(d, () => {
      if (String(sc.description || "").includes("\n")) body.insertAdjacentHTML("beforeend", editableMd(sc.description, sub(mBase, "description"), "Описание модели"));
      else if (!sc.description && mBase) body.insertAdjacentHTML("beforeend", editableMd("", sub(mBase, "description"), "Описание модели", "описание модели"));
      body.insertAdjacentHTML("beforeend", schemaTable(raw, false, mBase));
      const ex = sc.example;
      if (ex !== undefined && typeof ex === "object" && ex !== null) body.insertAdjacentHTML("beforeend", `<div class="sub">Пример</div><pre class="code">${hl(ex)}</pre>`);
    });
    list.appendChild(d);
  });
  s.appendChild(list);
  navLink("#models", `Модели данных<span class="count">${modelNames.length}</span>`);
}

if (issues.length) {
  const s = section("issues", "Замечания к спецификации", "<p>Найдено автоматически: неразрешённые ссылки и примеры, которые не проходят проверку по своей схеме.</p>");
  s.appendChild(el("ul", "issues", issues.map(i => `<li><span class="where">${i.href ? `<a href="${i.href}">${esc(i.where)}</a>` : esc(i.where)}</span><span>${esc(i.text)}</span></li>`).join("")));
  navLink("#issues", `Замечания<span class="count">${issues.length}</span>`);
}

mainEl.appendChild(el("footer", "", `Собрано из <code>${esc(META.source || "")}</code>${META.generated ? " · " + esc(META.generated) : ""} · openapi2html`));

/* ---------- поиск ---------- */
const search = document.getElementById("nav-search");
const emptyNote = el("li", "nav-empty", "Ничего не найдено");
emptyNote.hidden = true;
navEl.appendChild(emptyNote);
search.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  let visible = 0;
  navGroups.forEach(({ label, group, items }) => {
    let shown = 0;
    items.forEach(({ li, node }) => {
      const hit = !q || li.dataset.search.includes(q);
      li.hidden = !hit;
      node.hidden = !hit;
      if (hit) shown++;
    });
    label.hidden = !shown;
    group.hidden = !shown;
    visible += shown;
  });
  emptyNote.hidden = !q || visible > 0;
});

/* ---------- переходы по якорям и активный пункт ---------- */
function openTarget(hash) {
  if (!hash || hash.length < 2) return;
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (target && target.tagName === "DETAILS") target.open = true;
}
document.addEventListener("click", e => {
  const a = e.target.closest('a[href^="#"]');
  if (a) openTarget(a.getAttribute("href"));
});
window.addEventListener("hashchange", () => openTarget(location.hash));
openTarget(location.hash);

const navLinks = [...navEl.querySelectorAll("a")];
const observer = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    const href = "#" + en.target.id;
    if (!navLinks.some(a => a.getAttribute("href") === href)) return;
    navLinks.forEach(a => a.classList.toggle("is-active", a.getAttribute("href") === href));
  });
}, { rootMargin: "-10% 0px -80% 0px" });
document.querySelectorAll("main > section, details.op").forEach(n => observer.observe(n));

/* ---------- режим правки: включает окно программы ---------- */
function editValue(path) {
  let v = SPEC;
  for (const k of path) {
    if (v == null) return "";
    v = v[k];
  }
  return typeof v === "string" ? v : "";
}

document.addEventListener("click", e => {
  if (!document.documentElement.classList.contains("edit-mode")) return;
  const t = e.target.closest("[data-edit]");
  if (!t || (e.target.closest("a") && !t.classList.contains("edit-add"))) return;
  e.preventDefault();
  e.stopPropagation();
  const host = window.parent !== window ? window.parent.app : null;
  const path = JSON.parse(t.dataset.edit);
  if (host && host.editText) host.editText({ path, value: editValue(path), label: t.dataset.editLabel || "" });
}, true);

window.openapiEditMode = on => document.documentElement.classList.toggle("edit-mode", !!on);

/* ---------- экспорт для HTML-блока Yandex Wiki ---------- */
// Вики не выполняет скрипты и пропускает только часть CSS, поэтому отдаём уже нарисованную страницу:
// все блоки отрисованы, все примеры выложены подряд, кнопки, поля ввода и отметки правки убраны.
function wikiRenderAll() {
  const opened = [];
  for (let pass = 0; pass < 6; pass++) {
    const closed = [...document.querySelectorAll("#main details:not([open])")];
    if (!closed.length) break;
    closed.forEach(d => {
      d.open = true;
      d.dispatchEvent(new Event("toggle"));
      opened.push(d);
    });
  }
  return opened;
}

function wikiToc() {
  // тег и его методы одним блоком, чтобы колонки не разрывали группу
  const html = navGroups.map(({ label, items }) =>
    `<li><div class="toc-tag">${esc(label.textContent)}</div><ul>${items.map(({ li }) => `<li>${li.querySelector("a").outerHTML}</li>`).join("")}</ul></li>`).join("");
  return html ? `<ul class="toc">${html}</ul>` : "";
}

window.openapiWikiHtml = function () {
  const opened = wikiRenderAll();

  // все варианты примеров: переключаем вкладки и забираем содержимое каждой
  const examples = [];
  document.querySelectorAll("#main .ex-bar").forEach(bar => {
    const mount = bar.parentElement;
    const view = mount.querySelector(".seg-view");
    const buttons = [...bar.querySelector(".seg").querySelectorAll("button")];
    const current = buttons.findIndex(b => b.getAttribute("aria-selected") === "true");
    mount.dataset.wikiEx = String(examples.length);
    examples.push(buttons.map(b => {
      b.click();
      return `<div class="ex-title">${esc(b.textContent)}</div>${view.innerHTML}`;
    }).join(""));
    if (buttons[current]) buttons[current].click();
  });

  const root = document.getElementById("main").cloneNode(true);
  document.querySelectorAll("[data-wiki-ex]").forEach(m => m.removeAttribute("data-wiki-ex"));
  opened.forEach(d => { d.open = false; });

  root.querySelectorAll("[data-wiki-ex]").forEach(m => {
    m.innerHTML = examples[Number(m.dataset.wikiEx)];
    m.removeAttribute("data-wiki-ex");
  });
  root.querySelectorAll(".builder").forEach(b => b.replaceWith(...b.querySelectorAll(".bld-out pre.code, .bld-out .bld-note")));
  root.querySelectorAll(".edit-add, svg.chev, .seg, button, textarea, input").forEach(n => n.remove());
  root.querySelectorAll(".no-edit").forEach(n => n.replaceWith(...n.childNodes));
  root.querySelectorAll("[data-edit], [role], [aria-selected], th[style]").forEach(n => {
    ["data-edit", "data-edit-label", "role", "aria-selected"].forEach(a => n.removeAttribute(a));
    if (n.tagName === "TH") n.removeAttribute("style");
  });
  root.querySelectorAll("details").forEach(d => d.removeAttribute("open"));
  root.querySelectorAll("details.resp").forEach(d => { if (!d.previousElementSibling) d.setAttribute("open", ""); });
  const intro = root.querySelector("#overview");
  if (intro) intro.insertAdjacentHTML("beforeend", wikiToc());

  return `<style>\n${META.wikiCss || ""}\n</style>\n<div class="oa">\n${root.innerHTML}\n</div>\n`;
};
