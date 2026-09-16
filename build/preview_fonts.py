# -*- coding: utf-8 -*-
"""生成大写 T 图标的多字体预览图，供挑选"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 1024
GRAY = (125, 125, 130, 255)
WIN_FONTS = r"C:\Windows\Fonts"
OUT = r"C:\Users\weiwenjie\Desktop\gg2\build"

FONTS = [
    ("Bauhaus 93",        "BAUHS93.TTF"),
    ("Broadway",          "BROADW.TTF"),
    ("Impact",            "impact.ttf"),
    ("Stencil",           "STENCIL.TTF"),
    ("Forte",             "FORTE.TTF"),
    ("Brush Script MT",   "BRUSHSCI.TTF"),
    ("Segoe Script Bold", "segoescb.ttf"),
    ("Lucida Calligraphy","lcallig.ttf"),
    ("Old English Text",  "OLDENGL.TTF"),
    ("Ink Free",          "Inkfree.ttf"),
]

def make_icon(font_path):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255)
    img.paste(GRAY, (0, 0, SIZE, SIZE), mask)
    font = ImageFont.truetype(os.path.join(WIN_FONTS, font_path), int(SIZE * 0.72))
    bbox = draw.textbbox((0, 0), "T", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) / 2 - bbox[0]
    y = (SIZE - th) / 2 - bbox[1]
    draw.text((x, y), "T", font=font, fill=(255, 255, 255, 255))
    return img

CELL = 240
LABEL_H = 34
COLS = 5
rows = (len(FONTS) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL_H)), (245, 245, 247))
draw = ImageDraw.Draw(sheet)
label_font = ImageFont.truetype(os.path.join(WIN_FONTS, "segoeui.ttf"), 17)

ok, missing = [], []
for i, (name, path) in enumerate(FONTS):
    if not os.path.exists(os.path.join(WIN_FONTS, path)):
        missing.append(name)
        continue
    ok.append(name)
    icon = make_icon(path).resize((CELL - 40, CELL - 40), Image.LANCZOS)
    cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL_H)
    sheet.paste(icon, (cx + 20, cy + 20), icon)
    lw = draw.textbbox((0, 0), name, font=label_font)[2]
    draw.text((cx + (CELL - lw) / 2, cy + CELL + 4), name, font=label_font, fill=(60, 60, 64))

out_path = os.path.join(OUT, "font-preview.png")
sheet.save(out_path)
print("OK", out_path)
print("rendered:", ", ".join(ok))
if missing:
    print("missing:", ", ".join(missing))
