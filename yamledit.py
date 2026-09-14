"""Точечная правка текстового значения в YAML/JSON по пути.

Окно программы меняет описание на странице, а в файле заменяется только это значение:
комментарии, порядок ключей и форматирование остального текста не трогаются.
"""

import json
import re

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode

PLAIN_START = tuple("&*!|>%@`'\"{[]}-?#,:")
# после какого ключа вставлять новое поле, если его ещё нет
ANCHOR_KEYS = ("in", "summary", "title", "name")


class EditError(ValueError):
    pass


def _entry(mapping, key):
    for k, v in mapping.value:
        if isinstance(k, ScalarNode) and k.value == key:
            return k, v
    return None, None


def _walk(root, path):
    node = root
    for i, seg in enumerate(path):
        if isinstance(node, MappingNode):
            _, node = _entry(node, str(seg))
        elif isinstance(node, SequenceNode):
            try:
                node = node.value[int(seg)]
            except (ValueError, IndexError):
                node = None
        else:
            node = None
        if node is None:
            raise EditError("в файле нет пути " + "/".join(map(str, path[: i + 1])))
    return node


def _line_of(text, index):
    return text.count("\n", 0, index) + 1


def _plain_ok(value):
    if not value or value != value.strip() or value.startswith(PLAIN_START):
        return False
    if ": " in value or " #" in value or value.endswith(":"):
        return False
    try:
        return yaml.safe_load(f"k: {value}") == {"k": value}
    except yaml.YAMLError:
        return False


def _format(value, indent, inline_only):
    value = value.rstrip("\n")
    if inline_only:
        return json.dumps(value, ensure_ascii=False)
    if "\n" in value and not value.startswith((" ", "\t")):
        pad = " " * indent
        return "|-\n" + "\n".join((pad + line) if line.strip() else "" for line in value.split("\n"))
    if _plain_ok(value):
        return value
    return json.dumps(value, ensure_ascii=False)


def _line_start_after(text, index):
    """Начало строки, следующей за значением, которое заканчивается в index."""
    pos = index
    # блочные значения захватывают отступ следующей строки - откатываемся к её началу
    while pos > 0 and text[pos - 1] == " ":
        pos -= 1
    if pos > 0 and text[pos - 1] == "\n":
        return pos, ""
    nl = text.find("\n", index)
    if nl == -1:
        return len(text), "\n"
    return nl + 1, ""


def set_text(text, path, value, is_json=False):
    """Записывает строку value по пути path. Возвращает (новый текст, номер изменённой строки)."""
    if not path:
        raise EditError("пустой путь")
    if not isinstance(value, str):
        raise EditError("можно менять только текст")
    try:
        root = yaml.compose(text)
    except yaml.YAMLError as exc:
        raise EditError("сначала исправьте ошибку в файле") from exc
    if root is None:
        raise EditError("файл пустой")
    parent = _walk(root, path[:-1])
    if not isinstance(parent, MappingNode):
        raise EditError("это место нельзя изменить")
    key = str(path[-1])
    inline_only = is_json or bool(parent.flow_style)
    key_node, val_node = _entry(parent, key)
    if val_node is not None:
        return _replace(text, key_node, val_node, value, inline_only)
    return _insert(text, parent, key, value, inline_only, is_json)


def _replace(text, key_node, val_node, value, inline_only):
    if not isinstance(val_node, ScalarNode):
        raise EditError("это не текстовое поле")
    start, end = val_node.start_mark.index, val_node.end_mark.index
    tail = ""
    if val_node.style in ("|", ">"):
        # переводы строк и отступ после блока относятся к следующему ключу
        m = re.search(r"\n[\n ]*\Z", text[start:end])
        if m:
            tail = m.group(0)
    new = _format(value, key_node.start_mark.column + 2, inline_only)
    if start == end and start > 0 and text[start - 1] == ":":
        new = " " + new
    return text[:start] + new + tail + text[end:], _line_of(text, start)


def _insert(text, mapping, key, value, inline_only, is_json):
    if not mapping.value:
        raise EditError("пустой объект: добавьте поле в редакторе YAML")
    first_key = mapping.value[0][0]

    if inline_only:
        last_val = mapping.value[-1][1]
        pos = last_val.end_mark.index
        name = json.dumps(key, ensure_ascii=False) if is_json else key
        item = f"{name}: {json.dumps(value.rstrip(chr(10)), ensure_ascii=False)}"
        if mapping.start_mark.line == mapping.end_mark.line:
            return text[:pos] + ", " + item + text[pos:], _line_of(text, pos)
        piece = ",\n" + " " * first_key.start_mark.column + item
        return text[:pos] + piece + text[pos:], _line_of(text, pos) + 1

    anchor = None
    for name in ANCHOR_KEYS:
        k, v = _entry(mapping, name)
        if isinstance(v, ScalarNode):
            anchor = v
            break
    last = anchor or mapping.value[-1][1]
    insert_at, prefix = _line_start_after(text, last.end_mark.index)
    col = first_key.start_mark.column
    line = prefix + " " * col + f"{key}: {_format(value, col + 2, False)}\n"
    return text[:insert_at] + line + text[insert_at:], _line_of(text, insert_at + len(prefix))
