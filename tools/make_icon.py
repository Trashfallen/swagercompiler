"""Рисует иконку приложения assets/app.ico (нужен Pillow)."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
S = 1024
WHITE = (255, 255, 255, 255)


def stroke(draw, points, width):
    draw.line(points, fill=WHITE, width=width, joint="curve")
    r = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=WHITE)


def main():
    # фон: синий квадрат со скруглением и зелёной полосой снизу, обрезанный по маске
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((56, 56, S - 56, S - 56), radius=210, fill=255)
    body = Image.new("RGBA", (S, S), (42, 86, 198, 255))
    ImageDraw.Draw(body).rectangle((0, 720, S, S), fill=(19, 122, 82, 255))
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(body, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    w = 76
    stroke(draw, [(372, 240), (214, 410), (372, 580)], w)
    stroke(draw, [(652, 240), (810, 410), (652, 580)], w)
    stroke(draw, [(566, 204), (458, 616)], w)
    for x in (300, 452, 604):
        draw.rounded_rectangle((x, 818, x + 120, 866), radius=24, fill=WHITE)

    out = ROOT / "assets"
    out.mkdir(exist_ok=True)
    icon = img.resize((256, 256), Image.LANCZOS)
    icon.save(out / "app.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    icon.save(out / "app.png")
    print(f"[готово] {out / 'app.ico'}")


if __name__ == "__main__":
    main()
