"use strict";
/* Базовые функции: разбор ссылок, markdown, таблицы схем, примеры, валидация. */

const DATA = JSON.parse(document.getElementById("spec-data").textContent);
const SPEC = DATA.spec;
const META = DATA.meta || {};
const COMP = SPEC.components || {};
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];
const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
const LOCK = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const DASH = '<span class="dash">-</span>';

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const joinPath = (p, k) => (p ? `${p}.${k}` : k);

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function tabButton(parent, id, text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.id = id;
  b.setAttribute("role", "tab");
  b.textContent = text;
  b.addEventListener("click", onClick);
  parent.appendChild(b);
  return b;
}

/* ---------- markdown (минимум: абзацы, списки, `код`, **жирный**, ссылки) ---------- */
function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function md(text) {
  if (text == null || text === "") return "";
  const out = [];
  String(text).replace(/\r/g, "").split(/\n{2,}/).forEach(block => {
    let para = [];
    let list = null;
    let ordered = false;
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`); para = []; } };
    const flushList = () => {
      if (!list) return;
      const t = ordered ? "ol" : "ul";
      out.push(`<${t}>${list.map(i => `<li>${inlineMd(i)}</li>`).join("")}</${t}>`);
      list = null;
    };
    block.split("\n").forEach(line => {
      const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      const head = line.match(/^#{1,6}\s+(.*)$/);
      if (item) {
        flushPara();
        if (!list) { list = []; ordered = /\d/.test(item[1]); }
        list.push(item[2]);
      } else if (list && /^\s{2,}\S/.test(line)) {
        list[list.length - 1] += " " + line.trim();
      } else if (head) {
        flushPara(); flushList();
        out.push(`<p><b>${inlineMd(head[1])}</b></p>`);
      } else {
        flushList();
        if (line.trim()) para.push(line.trim());
      }
    });
    flushPara();
    flushList();
  });
  return `<div class="md">${out.join("")}</div>`;
}

/* ---------- JSON с подсветкой ---------- */
function hl(value) {
  const t = JSON.stringify(value, null, 2);
  if (t === undefined) return DASH;
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g,
      (m, str, colon, lit, num, punc) => {
        if (str) return colon ? `<span class="j-k">${str}</span><span class="j-p">${colon}</span>` : `<span class="j-s">${str}</span>`;
        if (lit || num) return `<span class="j-l">${lit || num}</span>`;
        return `<span class="j-p">${punc}</span>`;
      });
}

/* ---------- ссылки ---------- */
const decodeSeg = s => decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~");

function resolveRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("#")) return null;
  let node = SPEC;
  try {
    for (const raw of ref.slice(1).split("/").filter(Boolean)) {
      node = node[decodeSeg(raw)];
      if (node === undefined) return null;
    }
  } catch (e) {
    return null;
  }
  return node;
}

function deref(node) {
  let cur = node;
  let guard = 0;
  while (cur && typeof cur === "object" && typeof cur.$ref === "string" && guard++ < 20) {
    const target = resolveRef(cur.$ref);
    if (!target) return { "x-unresolved-ref": cur.$ref, "x-ref-error": "ссылка не найдена в спецификации" };
    const extra = { ...cur };
    delete extra.$ref;
    cur = Object.keys(extra).length ? { ...target, ...extra } : target;
  }
  return cur || {};
}

function schemaName(node) {
  const m = node && typeof node.$ref === "string" && node.$ref.match(/^#\/components\/schemas\/(.+)$/);
  return m ? decodeSeg(m[1]) : null;
}

const modelId = name => "model-" + name.replace(/[^\w-]/g, "_");
const mlink = name => `<a class="model-link" href="#${modelId(name)}">${esc(name)}</a>`;

/* ---------- правка из окна программы ---------- */
// Путь узла в редактируемом файле. null - узел пришёл из внешнего файла, его здесь не правим.
function editBase(raw, path) {
  if (!path || !raw || typeof raw !== "object") return null;
  if (typeof raw.$ref === "string") {
    if (!raw.$ref.startsWith("#/")) return null;
    const target = resolveRef(raw.$ref);
    if (!target || target["x-origin-external"]) return null;
    return raw.$ref.slice(2).split("/").map(decodeSeg);
  }
  return raw["x-origin-external"] ? null : path;
}

function editAttrs(path, label) {
  return path ? ` data-edit="${esc(JSON.stringify(path))}" data-edit-label="${esc(label)}"` : "";
}

// Текст, который можно поменять кликом; пустое значение в режиме правки превращается в кнопку «добавить».
function editableMd(text, path, label, addLabel, fallback = "") {
  if (!path) return text ? md(text) : fallback;
  if (text) return `<div class="editable"${editAttrs(path, label)}>${md(text)}</div>`;
  return (fallback ? `<span class="no-edit">${fallback}</span>` : "")
    + `<button type="button" class="edit-add"${editAttrs(path, label)}>+ ${esc(addLabel || label)}</button>`;
}

/* allOf склеиваем в один объект для показа */
function flatten(node, seen = new Set()) {
  const s = deref(node);
  if (!s || typeof s !== "object" || !Array.isArray(s.allOf)) return s || {};
  const out = { ...s };
  delete out.allOf;
  const partProps = {};
  const required = [...(s.required || [])];
  for (const part of s.allOf) {
    if (part && part.$ref && seen.has(part.$ref)) continue;
    const p = flatten(part, part && part.$ref ? new Set([...seen, part.$ref]) : seen);
    Object.assign(partProps, p.properties || {});
    required.push(...(p.required || []));
    for (const k of ["type", "description", "enum", "format", "example", "items", "additionalProperties", "nullable", "x-unresolved-ref", "x-ref-error"]) {
      if (out[k] === undefined && p[k] !== undefined) out[k] = p[k];
    }
  }
  const props = { ...partProps, ...(s.properties || {}) };
  if (Object.keys(props).length) out.properties = props;
  if (required.length) out.required = [...new Set(required)];
  return out;
}

function typeOf(s) {
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type) return s.type;
  if (s.properties || (s.additionalProperties && typeof s.additionalProperties === "object")) return "object";
  if (s.items) return "array";
  if (s.enum && s.enum.length) return s.enum[0] === null ? "" : typeof s.enum[0];
  return "";
}

/* ---------- таблица полей ---------- */
function typeHtml(node, depth = 0) {
  if (!node || typeof node !== "object") return '<span class="dash">any</span>';
  const name = schemaName(node);
  if (name) {
    const t = deref(node);
    if (t["x-unresolved-ref"]) return '<span class="unresolved">не найдено</span>';
    const base = typeOf(flatten(t));
    return (base && base !== "object" && !t.oneOf && !t.anyOf ? `${esc(base)} <span class="sep">·</span> ` : "") + mlink(name);
  }
  const d = deref(node);
  if (d["x-unresolved-ref"]) return '<span class="unresolved">внешняя ссылка</span>';
  for (const k of ["oneOf", "anyOf"]) {
    if (Array.isArray(d[k])) return `${k}(${d[k].map(v => typeHtml(v, depth + 1)).join(' <span class="sep">|</span> ')})`;
  }
  if (Array.isArray(d.allOf) && d.allOf.length === 1 && !d.properties) return typeHtml(d.allOf[0], depth);
  const s = flatten(d);
  let t = typeOf(s) || "any";
  t = t === "array" && depth < 5 ? `array[${typeHtml(s.items || {}, depth + 1)}]` : esc(t);
  if (s.format) t += ` <span class="sep">·</span> ${esc(s.format)}`;
  if (s.nullable) t += ' <span class="sep">|</span> null';
  return t;
}

function consHtml(node) {
  const s = flatten(node);
  const out = [];
  const range = (lo, hi) => `${lo ?? 0}-${hi ?? "∞"}`;
  const push = (label, value) => out.push(`<div class="cons">${label}${value !== undefined ? `: <b>${esc(value)}</b>` : ""}</div>`);

  if (Array.isArray(s.enum)) {
    const d = s["x-enum-descriptions"] || s["x-enumDescriptions"] || s["x-enum-varnames"] || s["x-enumNames"];
    const label = (v, i) => (Array.isArray(d) ? d[i] : d && typeof d === "object" ? d[v] : "");
    out.push(`<div class="enum-list">${s.enum.map((v, i) =>
      `<div class="enum"><code>${esc(typeof v === "string" ? v : JSON.stringify(v))}</code>${label(v, i) ? `<span>${esc(label(v, i))}</span>` : ""}</div>`).join("")}</div>`);
  }
  if (s.const !== undefined) push("всегда", JSON.stringify(s.const));
  if (s.minItems != null || s.maxItems != null) push("элементов", range(s.minItems, s.maxItems));
  if (s.uniqueItems) push("без повторов");
  const it = s.items ? flatten(s.items) : null;
  if (it && (it.minLength != null || it.maxLength != null)) push("длина элемента", range(it.minLength, it.maxLength));
  if (it && it.pattern) push("шаблон элемента", it.pattern);
  if (s.minLength != null || s.maxLength != null) push("длина", range(s.minLength, s.maxLength));
  const min = typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum : s.minimum;
  const max = typeof s.exclusiveMaximum === "number" ? s.exclusiveMaximum : s.maximum;
  if (min != null) push(s.exclusiveMinimum != null && s.exclusiveMinimum !== false ? "больше" : "не меньше", min);
  if (max != null) push(s.exclusiveMaximum != null && s.exclusiveMaximum !== false ? "меньше" : "не больше", max);
  if (s.multipleOf != null) push("кратно", s.multipleOf);
  if (s.pattern) push("шаблон", s.pattern);
  if (s.default !== undefined) push("по умолчанию", JSON.stringify(s.default));
  if (s.additionalProperties === false) push("лишние поля запрещены");
  return out.join("") || DASH;
}

// editPath - путь узла в файле; если задан, описание можно поменять кликом
function descHtml(node, editPath) {
  const s = flatten(node);
  if (s["x-unresolved-ref"]) {
    return `<span class="unresolved">Ссылка <code>${esc(s["x-unresolved-ref"])}</code> не подключена: ${esc(s["x-ref-error"] || "")}</span>`;
  }
  const extra = [];
  const it = s.items ? flatten(s.items) : null;
  if (it && it.description && !schemaName(s.items)) extra.push(`<span class="ex">Элемент: ${esc(it.description)}</span>`);
  const example = s.example !== undefined ? s.example : Array.isArray(s.examples) ? s.examples[0] : undefined;
  if (example !== undefined && (typeof example !== "object" || example === null)) {
    extra.push(`<span class="ex">Пример: <code>${esc(JSON.stringify(example))}</code></span>`);
  } else if (it && it.example !== undefined && typeof it.example !== "object") {
    extra.push(`<span class="ex">Пример элемента: <code>${esc(JSON.stringify(it.example))}</code></span>`);
  }
  const path = editPath ? [...editPath, "description"] : null;
  const desc = editableMd(s.description, path, "Описание", "описание", extra.length ? "" : DASH);
  return desc + extra.join("") || DASH;
}

function fieldRow(label, prefix, node, flags, depth, editPath) {
  return `<tr><td class="f-name" style="padding-left:${12 + depth * 18}px">${prefix ? `<span class="pfx">${esc(prefix)}</span>` : ""}${esc(label)}${flags}</td>`
    + `<td class="f-type">${typeHtml(node)}</td><td class="f-cons">${consHtml(node)}</td><td class="f-desc">${descHtml(node, editPath)}</td></tr>`;
}

// base - путь node в файле или null
function fieldRows(node, expand, prefix, depth, seen, base) {
  const s = flatten(node);
  // у allOf поля собраны из нескольких мест, путь неоднозначен - такие не правим
  const own = base && !deref(node).allOf ? base : null;
  const req = new Set(s.required || []);
  let html = "";
  for (const [name, p] of Object.entries(s.properties || {})) {
    const ps = flatten(p);
    let flags = "";
    if (req.has(name)) flags += '<span class="f-flag req">обязательное</span>';
    if (ps.readOnly) flags += '<span class="f-flag">только в ответе</span>';
    if (ps.writeOnly) flags += '<span class="f-flag">только в запросе</span>';
    if (ps.deprecated) flags += '<span class="f-flag">устарело</span>';
    const pBase = own ? editBase(p, [...own, "properties", name]) : null;
    // у поля-ссылки описание берётся из модели: его правят в разделе моделей
    html += fieldRow(name, prefix, p, flags, depth, pBase && !p.$ref ? pBase : null);
    html += childRows(p, expand, prefix + name, depth, seen, pBase);
  }
  const ap = s.additionalProperties;
  if (ap && typeof ap === "object") {
    const apBase = own ? editBase(ap, [...own, "additionalProperties"]) : null;
    html += fieldRow("{ключ}", prefix, ap, '<span class="f-flag">произвольные ключи</span>', depth, apBase && !ap.$ref ? apBase : null);
    html += childRows(ap, expand, prefix + "{ключ}", depth, seen, apBase);
  }
  return html;
}

function childRows(node, expand, path, depth, seen, base) {
  if (depth >= 5) return "";
  // ссылки на модели раскрываем только в методах (expand), в разделе моделей даём ссылку
  if (node.$ref && (!expand || seen.has(node.$ref))) return "";
  const s = flatten(node);
  let target = node;
  let suffix = ".";
  let targetBase = base;
  if (typeOf(s) === "array" && s.items) {
    target = s.items;
    suffix = "[].";
    if (target.$ref && (!expand || seen.has(target.$ref))) return "";
    targetBase = base && !deref(node).allOf ? editBase(s.items, [...base, "items"]) : null;
  }
  const t = flatten(target);
  if (!t.properties && !(t.additionalProperties && typeof t.additionalProperties === "object")) return "";
  const next = new Set(seen);
  if (node.$ref) next.add(node.$ref);
  if (target.$ref) next.add(target.$ref);
  return fieldRows(target, expand, path + suffix, depth + 1, next, targetBase);
}

// base - путь node в файле (без учёта $ref); null - правка недоступна
function schemaTable(node, expand, base) {
  if (!node) return "";
  const s = flatten(node);
  if (s["x-unresolved-ref"]) {
    return `<p class="note">Схема по ссылке <code>${esc(s["x-unresolved-ref"])}</code> не подключена: ${esc(s["x-ref-error"] || "")}.</p>`;
  }
  const b = base ? editBase(node, base) : null;
  const seen = new Set(node.$ref ? [node.$ref] : []);
  let body;
  if (s.properties || (s.additionalProperties && typeof s.additionalProperties === "object")) {
    body = fieldRows(node, expand, "", 0, seen, b);
  } else {
    body = fieldRow("(значение)", "", node, "", 0, b && !node.$ref ? b : null);
    if (typeOf(s) === "array" && s.items && (expand || !s.items.$ref)) {
      const it = flatten(s.items);
      const itemsBase = b && !deref(node).allOf ? editBase(s.items, [...b, "items"]) : null;
      if (it.properties) body += fieldRows(s.items, expand, "[].", 1, new Set([...seen, s.items.$ref].filter(Boolean)), itemsBase);
    }
  }
  return `<div class="tbl-wrap"><table><thead><tr><th>Поле</th><th>Тип</th><th>Значения и ограничения</th><th>Описание</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ---------- пример по схеме ---------- */
const FORMAT_SAMPLES = {
  "date": "2026-01-31", "date-time": "2026-01-31T12:00:00Z", "time": "12:00:00", "uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "email": "user@example.com", "uri": "https://example.com", "url": "https://example.com", "hostname": "example.com",
  "ipv4": "192.168.0.1", "byte": "U3dhZ2dlcg==", "binary": "<файл>", "password": "********"
};

function sample(node, mode, depth = 0, seen = new Set()) {
  if (!node || depth > 7) return null;
  if (node.$ref) {
    if (seen.has(node.$ref)) return {};
    seen = new Set([...seen, node.$ref]);
  }
  const s = flatten(node);
  if (s["x-unresolved-ref"]) return null;
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const variants = s.oneOf || s.anyOf;
  if (Array.isArray(variants) && variants.length) return sample(variants[0], mode, depth + 1, seen);
  const type = Array.isArray(s.type) ? s.type.find(x => x !== "null") : typeOf(s);
  switch (type) {
    case "object": {
      const o = {};
      for (const [k, p] of Object.entries(s.properties || {})) {
        const ps = flatten(p);
        if ((mode === "request" && ps.readOnly) || (mode === "response" && ps.writeOnly)) continue;
        o[k] = sample(p, mode, depth + 1, seen);
      }
      if (!s.properties && s.additionalProperties && typeof s.additionalProperties === "object") {
        o.key = sample(s.additionalProperties, mode, depth + 1, seen);
      }
      return o;
    }
    case "array": return s.items ? [sample(s.items, mode, depth + 1, seen)] : [];
    case "integer":
    case "number": return s.minimum ?? 0;
    case "boolean": return true;
    case "string": return FORMAT_SAMPLES[s.format] || "string";
    default: return null;
  }
}

/* ---------- проверка значения по схеме ---------- */
function validate(value, node, mode, path = "", errors = [], depth = 0) {
  if (!node || errors.length >= 30 || depth > 40) return errors;
  const s = flatten(node);
  if (s["x-unresolved-ref"]) return errors;
  const at = path || "(корень)";
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];

  if (value === null) {
    const allowed = s.nullable || types.includes("null") || (Array.isArray(s.enum) && s.enum.includes(null));
    if (!allowed && (types.length || s.properties)) errors.push(`${at}: null не допускается`);
    return errors;
  }

  const variants = s.oneOf || s.anyOf;
  if (Array.isArray(variants)) {
    const ok = variants.filter(v => validate(value, v, mode, path, [], depth + 1).length === 0).length;
    if (ok === 0) errors.push(`${at}: не подходит ни под один вариант ${s.oneOf ? "oneOf" : "anyOf"}`);
    else if (s.oneOf && ok > 1) errors.push(`${at}: подходит сразу под несколько вариантов oneOf`);
  }

  const expected = types.filter(t => t !== "null");
  if (!expected.length && s.properties) expected.push("object");
  if (!expected.length && s.items) expected.push("array");
  const actual = Array.isArray(value) ? "array" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
  if (expected.length && !expected.some(t => t === actual || (t === "number" && actual === "integer"))) {
    errors.push(`${at}: ожидался тип ${expected.join(" | ")}, пришёл ${actual}`);
    return errors;
  }

  if (Array.isArray(s.enum) && !s.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: ${JSON.stringify(value)} нет в списке допустимых (${s.enum.map(e => JSON.stringify(e)).join(", ")})`);
  }
  if (typeof value === "string") {
    const len = [...value].length;
    if (s.minLength != null && len < s.minLength) errors.push(`${at}: длина ${len}, минимум ${s.minLength}`);
    if (s.maxLength != null && len > s.maxLength) errors.push(`${at}: длина ${len}, максимум ${s.maxLength}`);
    if (s.pattern) {
      try { if (!new RegExp(s.pattern, "u").test(value)) errors.push(`${at}: не подходит под шаблон ${s.pattern}`); } catch (e) { /* шаблон не для JS */ }
    }
  }
  if (typeof value === "number") {
    if (s.minimum != null && (s.exclusiveMinimum === true ? value <= s.minimum : value < s.minimum)) errors.push(`${at}: меньше минимума ${s.minimum}`);
    if (s.maximum != null && (s.exclusiveMaximum === true ? value >= s.maximum : value > s.maximum)) errors.push(`${at}: больше максимума ${s.maximum}`);
    if (typeof s.exclusiveMinimum === "number" && value <= s.exclusiveMinimum) errors.push(`${at}: должно быть больше ${s.exclusiveMinimum}`);
    if (typeof s.exclusiveMaximum === "number" && value >= s.exclusiveMaximum) errors.push(`${at}: должно быть меньше ${s.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) errors.push(`${at}: элементов ${value.length}, минимум ${s.minItems}`);
    if (s.maxItems != null && value.length > s.maxItems) errors.push(`${at}: элементов ${value.length}, максимум ${s.maxItems}`);
    if (s.items) value.forEach((v, i) => validate(v, s.items, mode, `${path}[${i}]`, errors, depth + 1));
  }
  if (actual === "object") {
    const props = s.properties || {};
    for (const r of s.required || []) {
      const ps = props[r] ? flatten(props[r]) : {};
      const skip = (mode === "request" && ps.readOnly) || (mode === "response" && ps.writeOnly);
      if (!(r in value) && !skip) errors.push(`${joinPath(path, r)}: обязательное поле отсутствует`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validate(v, props[k], mode, joinPath(path, k), errors, depth + 1);
      else if (s.additionalProperties === false) errors.push(`${joinPath(path, k)}: поля нет в схеме`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") validate(v, s.additionalProperties, mode, joinPath(path, k), errors, depth + 1);
    }
  }
  return errors;
}

/* ---------- примеры ---------- */
function mediaExamples(mt, mode) {
  const out = [];
  if (!mt) return out;
  if (mt.examples && typeof mt.examples === "object") {
    for (const [key, raw] of Object.entries(mt.examples)) {
      const ex = deref(raw);
      if (ex["x-unresolved-ref"]) { out.push({ key, summary: key, unresolved: ex["x-unresolved-ref"] }); continue; }
      out.push({ key, summary: ex.summary || key, description: ex.description, value: ex.value, external: ex.externalValue });
    }
  } else if (mt.example !== undefined) {
    out.push({ key: "example", summary: "Пример", value: mt.example });
  }
  if (!out.length && mt.schema) {
    const s = flatten(mt.schema);
    if (s.example !== undefined) out.push({ key: "schema", summary: "Пример из схемы", value: s.example });
    else if (!s["x-unresolved-ref"]) out.push({ key: "generated", summary: "Сгенерирован по схеме", value: sample(mt.schema, mode), generated: true });
  }
  return out;
}

function tableSource(v) {
  const isRows = a => Array.isArray(a) && a.length > 0 && a.every(x => x && typeof x === "object" && !Array.isArray(x));
  if (isRows(v)) return { label: "", rows: v };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) if (isRows(x)) return { label: k, rows: x };
  }
  return null;
}

function renderRowsTable(src) {
  const cols = [];
  src.rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
  const cell = v => v === undefined ? DASH
    : v === null ? '<span class="dash">null</span>'
    : v === true ? '<span class="chip yes">true</span>'
    : v === false ? '<span class="chip no">false</span>'
    : typeof v === "object" ? `<span class="cell-json">${esc(JSON.stringify(v))}</span>`
    : esc(v);
  const thStyle = 'style="text-transform:none;letter-spacing:0;font:500 12px var(--font-mono)"';
  return `${src.label ? `<div class="sub">${esc(src.label)}[]</div>` : ""}<div class="tbl-wrap"><table><thead><tr><th>#</th>${cols.map(c => `<th ${thStyle}>${esc(c)}</th>`).join("")}</tr></thead>`
    + `<tbody>${src.rows.map((r, i) => `<tr><td class="dash">${i + 1}</td>${cols.map(c => `<td>${cell(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

let uid = 0;
function exampleSwitcher(examples, mount) {
  const idBase = "ex" + (++uid);
  if (!examples.length) { mount.innerHTML = '<p class="muted">Примеров нет.</p>'; return; }
  const bar = el("div", "ex-bar");
  const seg = el("div", "seg");
  seg.setAttribute("role", "tablist");
  const viewSeg = el("div", "seg");
  viewSeg.setAttribute("role", "tablist");
  const view = el("div", "seg-view");
  let cur = 0;
  let mode = "json";
  const buttons = examples.map((ex, i) => tabButton(seg, `${idBase}-${i}`, ex.summary, () => { cur = i; draw(); }));
  const bJson = tabButton(viewSeg, `${idBase}-json`, "JSON", () => { mode = "json"; draw(); });
  const bTable = tabButton(viewSeg, `${idBase}-table`, "Таблица", () => { mode = "table"; draw(); });

  function draw() {
    buttons.forEach((b, j) => b.setAttribute("aria-selected", String(j === cur)));
    const ex = examples[cur];
    const src = ex.value !== undefined ? tableSource(ex.value) : null;
    viewSeg.hidden = !src;
    const m = src ? mode : "json";
    bJson.setAttribute("aria-selected", String(m === "json"));
    bTable.setAttribute("aria-selected", String(m === "table"));
    let html = ex.description ? `<div class="ex-desc">${md(ex.description)}</div>` : "";
    if (ex.unresolved) html += `<p class="note">Пример по ссылке <code>${esc(ex.unresolved)}</code> не подключён.</p>`;
    else if (ex.value === undefined && ex.external) html += `<p class="note">Внешний пример: <a href="${esc(ex.external)}" target="_blank" rel="noopener">${esc(ex.external)}</a></p>`;
    else if (m === "table") html += renderRowsTable(src);
    else html += `<pre class="code">${typeof ex.value === "string" ? esc(ex.value) : hl(ex.value)}</pre>`;
    view.innerHTML = html;
  }
  bar.append(seg, viewSeg);
  mount.append(bar, view);
  draw();
}
