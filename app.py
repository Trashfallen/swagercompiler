"""Swagger Compiler: окно для просмотра OpenAPI-спецификаций.

Запуск:
    python app.py                # стартовый экран
    python app.py spec.yaml      # сразу открыть файл
    python app.py --debug        # с инструментами разработчика
"""

import datetime
import json
import os
import subprocess
import sys
import tempfile
import webbrowser
from pathlib import Path

import webview
import yaml
from webview.dom import DOMEventHandler

from openapi2html import HERE, build_html

APP_NAME = "Swagger Compiler"
DATA_DIR = Path(os.environ.get("APPDATA") or Path.home()) / "SwaggerCompiler"
RECENT_FILE = DATA_DIR / "recent.json"
MAX_RECENT = 12
SPEC_TYPES = ("OpenAPI (*.yaml;*.yml;*.json)", "Все файлы (*.*)")


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def error_text(exc):
    if isinstance(exc, FileNotFoundError):
        return f"Файл не найден: {exc.filename}"
    if isinstance(exc, UnicodeDecodeError):
        return "Файл не в кодировке UTF-8. Пересохраните его в UTF-8."
    if isinstance(exc, yaml.YAMLError):
        return f"Ошибка в YAML:\n{exc}"
    if isinstance(exc, json.JSONDecodeError):
        return f"Ошибка в JSON: {exc}"
    if isinstance(exc, ValueError):
        return str(exc)
    return f"{type(exc).__name__}: {exc}"


def load_recent():
    try:
        items = json.loads(RECENT_FILE.read_text(encoding="utf-8"))
        return [i for i in items if isinstance(i, dict) and i.get("path")]
    except (OSError, ValueError):
        return []


def save_recent(items):
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        RECENT_FILE.write_text(json.dumps(items[:MAX_RECENT], ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def remember(path):
    items = [i for i in load_recent() if i["path"].lower() != path.lower()]
    items.insert(0, {"path": path, "opened": datetime.datetime.now().isoformat(timespec="minutes")})
    save_recent(items)


def human_time(iso):
    try:
        dt = datetime.datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return ""
    today = datetime.date.today()
    if dt.date() == today:
        return "сегодня " + dt.strftime("%H:%M")
    if dt.date() == today - datetime.timedelta(days=1):
        return "вчера " + dt.strftime("%H:%M")
    return dt.strftime("%d.%m.%Y")


def first_path(result):
    if not result:
        return None
    return result[0] if isinstance(result, (list, tuple)) else result


class Api:
    """Методы вызываются из интерфейса через window.pywebview.api."""

    def __init__(self, initial=None):
        self._window = None
        self._initial = initial
        self._path = None
        self._html = None
        self._mtime = None

    def initial_path(self):
        path, self._initial = self._initial, None
        return path

    def load(self, path):
        path = str(Path(path).resolve())
        self._path = path
        self._mtime = mtime(path)
        try:
            html, warnings, title = build_html(Path(path))
        except Exception as exc:
            self._html = None
            self._window.title = APP_NAME
            return {"ok": False, "path": path, "name": Path(path).name, "error": error_text(exc)}
        self._html = html
        remember(path)
        self._window.title = f"{title} - {APP_NAME}"
        return {"ok": True, "path": path, "name": Path(path).name, "title": title, "warnings": warnings, "html": html}

    def open_dialog(self):
        start = str(Path(self._path).parent) if self._path else ""
        result = self._window.create_file_dialog(webview.FileDialog.OPEN, directory=start, file_types=SPEC_TYPES)
        path = first_path(result)
        return self.load(path) if path else None

    def changed(self):
        if not self._path:
            return False
        current = mtime(self._path)
        if current and self._mtime and current != self._mtime:
            self._mtime = current
            return True
        return False

    def save_dialog(self):
        if not self._html:
            return None
        src = Path(self._path)
        result = self._window.create_file_dialog(
            webview.FileDialog.SAVE, directory=str(src.parent), save_filename=src.stem + ".html", file_types=("HTML (*.html)",)
        )
        target = first_path(result)
        if not target:
            return None
        if not target.lower().endswith((".html", ".htm")):
            target += ".html"
        try:
            Path(target).write_text(self._html, encoding="utf-8")
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "path": target}

    def open_in_browser(self):
        if not self._html:
            return False
        folder = Path(tempfile.gettempdir()) / "SwaggerCompiler"
        folder.mkdir(exist_ok=True)
        target = folder / (Path(self._path).stem + ".html")
        target.write_text(self._html, encoding="utf-8")
        webbrowser.open(target.as_uri())
        return True

    def show_in_folder(self, path):
        subprocess.Popen(f'explorer /select,"{Path(path)}"')

    def recent(self):
        return [
            {"path": i["path"], "name": Path(i["path"]).name, "opened": human_time(i.get("opened")), "exists": Path(i["path"]).is_file()}
            for i in load_recent()
        ]

    def clear_recent(self):
        save_recent([])
        return True


def bind_drop(window):
    """Путь к перетащенному файлу pywebview отдаёт только обработчику на стороне Python."""

    def on_drop(event):
        files = (event.get("dataTransfer") or {}).get("files") or []
        paths = [f.get("pywebviewFullPath") for f in files if f.get("pywebviewFullPath")]
        if paths:
            window.evaluate_js(f"app.openPath({json.dumps(paths[0])})")
        else:
            window.evaluate_js("app.dropError('Не удалось получить путь к файлу. Откройте его кнопкой «Открыть».')")

    window.dom.document.events.drop += DOMEventHandler(on_drop, prevent_default=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    initial = str(Path(args[0]).resolve()) if args else None
    api = Api(initial)
    window = webview.create_window(
        APP_NAME,
        url=str(HERE / "app_ui.html"),
        js_api=api,
        width=1320,
        height=880,
        min_size=(860, 560),
        background_color="#F1F4F6",
    )
    api._window = window
    window.events.loaded += lambda: bind_drop(window)
    webview.start(http_server=True, debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
