"""Проверяет, что wiki.css использует только CSS-свойства, разрешённые в HTML-блоке Yandex Wiki.

Список взят из справки: https://yandex.ru/support/wiki/ru/wysiwyg/html-block
Запуск: python tools/check_wiki_css.py [файл.css или .html]
"""

import re
import sys
from pathlib import Path

ALLOWED = set("""
align-content align-items align-self background background-attachment background-clip background-color
background-image background-origin background-position background-repeat background-size border border-bottom
border-bottom-color border-bottom-left-radius border-bottom-right-radius border-bottom-style border-bottom-width
border-collapse border-color border-image border-image-outset border-image-repeat border-image-slice
border-image-source border-image-width border-left border-left-color border-left-style border-left-width
border-radius border-right border-right-color border-right-style border-right-width border-spacing border-style
border-top border-top-color border-top-left-radius border-top-right-radius border-top-style border-top-width
border-width box-decoration-break box-shadow box-sizing box-snap box-suppress break-after break-before
break-inside color color-interpolation-filters column-count column-fill column-gap column-rule
column-rule-color column-rule-style column-rule-width column-span column-width columns display display-inside
display-list display-outside flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap font
font-family font-feature-settings font-kerning font-language-override font-size font-size-adjust font-stretch
font-style font-synthesis font-variant font-variant-alternates font-variant-caps font-variant-east-asian
font-variant-ligatures font-variant-numeric font-variant-position font-weight grid grid-area grid-auto-columns
grid-auto-flow grid-auto-rows grid-column grid-column-end grid-column-start grid-row grid-row-end
grid-row-start grid-template grid-template-areas grid-template-columns grid-template-rows height
justify-content justify-items justify-self letter-spacing lighting-color list-style list-style-image
list-style-position list-style-type margin margin-bottom margin-left margin-right margin-top max-height
max-width min-height min-width object-fit object-position order orphans padding padding-bottom padding-left
padding-right padding-top row-gap text-align text-align-last text-combine-upright text-decoration
text-decoration-color text-decoration-line text-decoration-skip text-decoration-style text-emphasis
text-emphasis-color text-emphasis-position text-emphasis-style text-height text-indent text-justify
text-orientation text-overflow text-shadow text-space-collapse text-transform text-underline-position
text-wrap width word-break word-spacing word-wrap
""".split())

FORBIDDEN_PATTERNS = ("@import", "javascript:", "expression(", "behavior:", "-moz-binding", "url(data:")


def css_declarations(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for block in re.findall(r"\{([^{}]*)\}", css):
        for decl in block.split(";"):
            if ":" in decl:
                yield decl.split(":", 1)[0].strip().lower()


def check(text):
    problems = []
    styles = re.findall(r"<style[^>]*>(.*?)</style>", text, flags=re.S | re.I) or [text]
    inline = re.findall(r'style="([^"]*)"', text)
    props = [p for s in styles for p in css_declarations(s)]
    props += [d.split(":", 1)[0].strip().lower() for s in inline for d in s.split(";") if ":" in d]
    for prop in sorted(set(props)):
        if prop and not prop.startswith("--") and prop not in ALLOWED:
            problems.append(f"свойство не разрешено: {prop}")
    for pat in FORBIDDEN_PATTERNS:
        if pat in text.lower():
            problems.append(f"запрещённая конструкция: {pat}")
    if re.search(r"<script", text, flags=re.I):
        problems.append("есть <script>")
    return problems


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "wiki.css"
    problems = check(path.read_text(encoding="utf-8"))
    for p in problems:
        print("  !", p)
    print(f"{path.name}: {'ок' if not problems else f'проблем: {len(problems)}'}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
