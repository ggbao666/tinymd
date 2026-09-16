# -*- coding: utf-8 -*-
"""圆润扭曲的粗笔 T 图标——手绘感变体，供挑选"""
from PIL import Image, ImageDraw, ImageFont
import math, os

SIZE = 1024
GRAY = (125, 125, 130, 255)
WHITE = (255, 255, 255, 255)
WIN_FONTS = r"C:\Windows\Fonts"
OUT = r"C:\Users\weiwenjie\Desktop\gg2\build"


def base_square():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255)
    img.paste(GRAY, (0, 0, SIZE, SIZE), mask)
    return img


def bezier(p0, p1, p2, p3, n=80):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def stroke(draw, pts, radius_fn):
    """沿路径画粗描边：逐点画圆，自然形成圆头和粗细变化"""
    n = len(pts) - 1
    for i, (x, y) in enumerate(pts):
        r = radius_fn(i / n) * SIZE
        draw.ellipse([x * SIZE - r, y * SIZE - r, x * SIZE + r, y * SIZE + r], fill=WHITE)


def variant_a():
    """微弓横梁 + S 形竖笔，粗细均匀"""
    img = base_square()
    d = ImageDraw.Draw(img)
    bar = bezier((0.15, 0.26), (0.36, 0.19), (0.64, 0.19), (0.85, 0.25))
    stem = bezier((0.49, 0.22), (0.56, 0.42), (0.40, 0.60), (0.47, 0.82))
    stroke(d, bar, lambda t: 0.072)
    stroke(d, stem, lambda t: 0.075)
    return img


def variant_b():
    """横梁带波浪起伏，竖笔向左轻摆，更粗"""
    img = base_square()
    d = ImageDraw.Draw(img)
    bar = bezier((0.14, 0.28), (0.40, 0.16), (0.58, 0.30), (0.86, 0.21))
    stem = bezier((0.50, 0.24), (0.44, 0.44), (0.54, 0.62), (0.44, 0.82))
    stroke(d, bar, lambda t: 0.082)
    stroke(d, stem, lambda t: 0.085)
    return img


def variant_c():
    """两端略鼓、笔尾收细，像粗毛笔写的"""
    img = base_square()
    d = ImageDraw.Draw(img)
    bar = bezier((0.15, 0.26), (0.35, 0.20), (0.65, 0.20), (0.85, 0.26))
    stem = bezier((0.50, 0.23), (0.55, 0.44), (0.44, 0.60), (0.47, 0.80))
    stroke(d, bar, lambda t: 0.088 - 0.014 * math.sin(t * math.pi))
    stroke(d, stem, lambda t: 0.092 - 0.030 * t)
    return img


def variant_d():
    """扭得更明显：横梁倾斜 + 竖笔大 S，墨感足"""
    img = base_square()
    d = ImageDraw.Draw(img)
    bar = bezier((0.13, 0.30), (0.38, 0.17), (0.62, 0.28), (0.87, 0.19))
    stem = bezier((0.51, 0.24), (0.60, 0.42), (0.36, 0.58), (0.46, 0.83))
    stroke(d, bar, lambda t: 0.080 + 0.010 * math.sin(t * math.pi * 2))
    stroke(d, stem, lambda t: 0.084 - 0.022 * t)
    return img


VARIANTS = [
    ("A 微弓S笔", variant_a),
    ("B 波浪摆", variant_b),
    ("C 粗笔收锋", variant_c),
    ("D 大扭曲", variant_d),
]

CELL = 300
LABEL_H = 36
COLS = 4
sheet = Image.new("RGB", (COLS * CELL, CELL + LABEL_H), (245, 245, 247))
draw = ImageDraw.Draw(sheet)
label_font = ImageFont.truetype(os.path.join(WIN_FONTS, "msyh.ttc"), 17)

for i, (name, fn) in enumerate(VARIANTS):
    icon = fn().resize((CELL - 40, CELL - 40), Image.LANCZOS)
    cx = i * CELL
    sheet.paste(icon, (cx + 20, 20), icon)
    lw = draw.textbbox((0, 0), name, font=label_font)[2]
    draw.text((cx + (CELL - lw) / 2, CELL + 4), name, font=label_font, fill=(60, 60, 64))

out_path = os.path.join(OUT, "ink-preview.png")
sheet.save(out_path)
print("OK", out_path)
