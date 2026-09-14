"""Собирает из OpenAPI-спецификации (YAML или JSON) читаемую HTML-страницу.

Использование:
    python openapi2html.py spec.yaml                 # создаст spec.html рядом
    python openapi2html.py spec.yaml -o docs.html    # свой путь
    python openapi2html.py a.yaml b.yaml --open      # несколько файлов, открыть в браузере

Внешние $ref (./common.yaml#/components/schemas/Error) подтягиваются из файлов рядом со спецификацией.
Если файла нет, страница всё равно соберётся, а ссылка попадёт в раздел «Замечания».
"""

import argparse
import copy
import datetime
import json
import re
import sys
import webbrowser
from pathlib import Path
from urllib.parse import unquote

import yaml

FROZEN = getattr(sys, "frozen", False)
# в собранном exe шаблон и JS лежат во временной папке PyInstaller
HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
COMPONENT_RE = re.compile(
    r"^/components/(schemas|responses|parameters|examples|requestBodies|headers|securitySchemes|links|callbacks)/([^/]+)$"
)


def parse_text(text: str, path: Path):
    if path.suffix.lower() == ".json":
        return json.loads(text)
    return yaml.safe_load(text)


def load_file(path: Path):
    return parse_text(path.read_text(encoding="utf-8-sig"), path)


def normalize(node):
    """YAML может отдать ключи-числа (200:) и даты - приводим к JSON-совместимому виду."""
    if isinstance(node, dict):
        return {str(k): normalize(v) for k, v in node.items()}
    if isinstance(node, list):
        return [normalize(v) for v in node]
    if isinstance(node, (datetime.date, datetime.datetime)):
        return node.isoformat()
    return node


def pointer_get(doc, pointer: str):
    if pointer in ("", "/"):
        return doc
    node = doc
    for raw in pointer.lstrip("/").split("/"):
        key = unquote(raw).replace("~1", "/").replace("~0", "~")
        if isinstance(node, list):
            node = node[int(key)]
        else:
            node = node[key]
    return node


class Resolver:
    """Разрешает $ref. Всё, что пришло не из основного файла, помечается x-origin-external:
    такие места нельзя править из окна программы, их нет в редактируемом файле."""

    def __init__(self, main_path: Path, text=None):
        self.main_path = main_path.resolve()
        self.docs = {}
        self.warnings = []
        self.hoisted = {}  # (file, pointer) -> (kind, name)
        self.extra = {}  # компоненты из внешних файлов: kind -> {name: value}
        raw = load_file(self.main_path) if text is None else parse_text(text, self.main_path)
        self.root = normalize(raw)
        self.docs[self.main_path] = self.root

    def doc(self, path: Path):
        path = path.resolve()
        if path not in self.docs:
            self.docs[path] = normalize(load_file(path))
        return self.docs[path]

    def warn(self, ref, base, message):
        where = base.name if base != self.main_path else "основной файл"
        self.warnings.append({"ref": ref, "file": where, "message": message})

    def run(self):
        root = self.walk(self.root, self.main_path, ())
        if isinstance(root, dict):
            for kind, items in self.extra.items():
                root.setdefault("components", {}).setdefault(kind, {}).update(items)
        self.root = root
        return root

    def walk(self, node, base: Path, stack):
        if isinstance(node, list):
            return [self.walk(v, base, stack) for v in node]
        if not isinstance(node, dict):
            return node
        ref = node.get("$ref")
        if isinstance(ref, str):
            return self.resolve_ref(ref, node, base, stack)
        return {k: self.walk(v, base, stack) for k, v in node.items()}

    def resolve_ref(self, ref, node, base: Path, stack):
        file_part, _, pointer = ref.partition("#")
        target = (base.parent / file_part).resolve() if file_part else base
        key = (target, pointer)

        # внутренняя ссылка основного файла на components - оставляем, рендерер разрешит её сам
        if target == self.main_path and COMPONENT_RE.match(pointer):
            return {"$ref": "#" + pointer}

        if key in self.hoisted:
            kind, name = self.hoisted[key]
            return {"$ref": f"#/components/{kind}/{name}"}

        try:
            doc = self.doc(target)
        except FileNotFoundError:
            self.warn(ref, base, f"файл не найден: {file_part}")
            return {"x-unresolved-ref": ref, "x-ref-error": f"файл {file_part} не найден"}
        except Exception as exc:  # битый YAML и т.п.
            self.warn(ref, base, f"не удалось прочитать {file_part}: {exc}")
            return {"x-unresolved-ref": ref, "x-ref-error": f"не удалось прочитать {file_part}"}

        try:
            value = copy.deepcopy(pointer_get(doc, pointer))
        except (KeyError, IndexError, ValueError, TypeError):
            self.warn(ref, base, f"в {file_part or 'файле'} нет пути #{pointer}")
            return {"x-unresolved-ref": ref, "x-ref-error": f"путь #{pointer} не найден"}

        match = COMPONENT_RE.match(pointer)
        if match:
            # компонент из внешнего файла переносим в components основного, чтобы сохранить имя
            kind, name = match.group(1), unquote(match.group(2))
            existing = (self.root.get("components") or {}).get(kind) or {}
            extra = self.extra.setdefault(kind, {})
            unique, n = name, 2
            while unique in existing or unique in extra:
                unique, n = f"{name}_{n}", n + 1
            self.hoisted[key] = (kind, unique)
            extra[unique] = {}
            hoisted = self.walk(value, target, stack + (key,))
            if isinstance(hoisted, dict):
                hoisted["x-origin-external"] = ref
            extra[unique] = hoisted
            return {"$ref": f"#/components/{kind}/{unique}"}

        if key in stack:
            self.warn(ref, base, "циклическая ссылка")
            return {"x-unresolved-ref": ref, "x-ref-error": "циклическая ссылка"}

        resolved = self.walk(value, target, stack + (key,))
        if isinstance(resolved, dict):
            # соседние ключи рядом с $ref (description и т.п.) имеют приоритет
            extra = {k: self.walk(v, base, stack) for k, v in node.items() if k != "$ref"}
            resolved = {**resolved, **extra}
            resolved.setdefault("x-origin-external", ref)
        return resolved


def build_html(src: Path, text=None):
    """Собирает страницу в памяти. text - несохранённое содержимое файла из редактора.
    Возвращает (html, warnings, title)."""
    src = Path(src).resolve()
    resolver = Resolver(src, text)
    spec = resolver.run()
    if isinstance(spec, dict) and "swagger" in spec:
        raise ValueError("Swagger 2.0 не поддерживается, нужен OpenAPI 3.x (конвертер: https://converter.swagger.io)")
    if not isinstance(spec, dict) or "openapi" not in spec:
        raise ValueError("это не похоже на OpenAPI: нет поля openapi")

    payload = {
        "spec": spec,
        "meta": {
            "source": src.name,
            "generated": datetime.datetime.now().strftime("%d.%m.%Y %H:%M"),
            "refWarnings": resolver.warnings,
        },
    }
    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    title = str(spec.get("info", {}).get("title") or src.stem)

    template = (HERE / "template.html").read_text(encoding="utf-8")
    renderer = "\n".join(
        (HERE / name).read_text(encoding="utf-8") for name in ("renderer-core.js", "renderer-page.js")
    )
    html = (
        template.replace("__TITLE__", title.replace("&", "&amp;").replace("<", "&lt;"))
        .replace("/*__RENDERER__*/", renderer)
        .replace("__SPEC_JSON__", data)
    )
    return html, resolver.warnings, title


def build(src: Path, out: Path):
    html, warnings, _ = build_html(src)
    out.write_text(html, encoding="utf-8")
    return warnings


def pause():
    # держим окно exe открытым, чтобы было видно сообщение; в скриптах и пайпах не ждём
    if FROZEN and sys.stdin is not None and sys.stdin.isatty():
        try:
            input("\nНажмите Enter, чтобы закрыть...")
        except EOFError:
            pass


def main():
    if FROZEN and len(sys.argv) == 1:
        # exe запустили двойным щелчком, без файла
        print("openapi2html: перетащите файл спецификации (.yaml, .yml, .json) на openapi2html.exe")
        print("или запустите из консоли: openapi2html.exe spec.yaml [-o out.html]")
        pause()
        return

    parser = argparse.ArgumentParser(description="OpenAPI (YAML/JSON) -> читаемая HTML-страница")
    parser.add_argument("specs", nargs="+", type=Path, help="файлы спецификации")
    parser.add_argument("-o", "--output", type=Path, help="куда сохранить HTML (только для одного файла)")
    parser.add_argument("--open", action="store_true", help="открыть результат в браузере")
    parser.add_argument("--no-open", action="store_true", help="не открывать браузер (для exe)")
    args = parser.parse_args()
    if FROZEN:
        args.open = True
    if args.no_open:
        args.open = False

    if args.output and len(args.specs) > 1:
        parser.error("-o можно указать только для одного входного файла")

    failed = False
    for src in args.specs:
        src = src.resolve()
        out = args.output.resolve() if args.output else src.with_suffix(".html")
        try:
            warnings = build(src, out)
        except Exception as exc:
            failed = True
            print(f"[ошибка] {src.name}: {exc}", file=sys.stderr)
            continue
        print(f"[готово] {out}")
        for w in warnings:
            print(f"  ! {w['ref']} ({w['file']}): {w['message']}")
        if args.open:
            webbrowser.open(out.as_uri())
    if failed:
        pause()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
