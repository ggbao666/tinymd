# -*- coding: utf-8 -*-
"""楷书风格的 T 图标变体，供挑选"""
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


def font_icon(path, size_ratio=0.74, sw_ratio=0.0):
    img = base_square()
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(os.path.join(WIN_FONTS, path), int(SIZE * size_ratio))
    bbox = d.textbbox((0, 0), "T", font=font, stroke_width=int(SIZE * sw_ratio))
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((SIZE - tw) / 2 - bbox[0], (SIZE - th) / 2 - bbox[1]), "T", font=font,
           fill=WHITE, stroke_width=int(SIZE * sw_ratio), stroke_fill=WHITE)
    return img


def bezier(p0, p1, p2, p3, n=100):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def stroke(draw, pts, radius_fn):
    n = len(pts) - 1
    for i, (x, y) in enumerate(pts):
        r = max(radius_fn(i / n), 0.002) * SIZE
        draw.ellipse([x * SIZE - r, y * SIZE - r, x * SIZE + r, y * SIZE + r], fill=WHITE)


def kai_hand():
    """手绘楷书：横——顿笔起、中锋行、轻提出；竖——悬针收尖"""
    img = base_square()
    d = ImageDraw.Draw(img)
    # 横：左端顿笔(鼓)，行笔略上扬，右端轻提
    bar = bezier((0.18, 0.285), (0.38, 0.26), (0.62, 0.235), (0.82, 0.23))
    stroke(d, bar, lambda t: 0.075 - 0.018 * t + 0.014 * math.exp(-t * 12))
    # 悬针竖：上端承接横画带顿笔，向下渐细收成尖
    stem = bezier((0.50, 0.25), (0.518, 0.45), (0.483, 0.64), (0.49, 0.84))
    stroke(d, stem, lambda t: 0.082 - 0.070 * (t ** 1.4))
    return img


def kai_bold():
    """手绘楷书加粗：整体更敦厚，顿笔更明显"""
    img = base_square()
    d = ImageDraw.Draw(img)
    bar = bezier((0.17, 0.295), (0.38, 0.265), (0.62, 0.24), (0.83, 0.235))
    stroke(d, bar, lambda t: 0.092 - 0.024 * t + 0.016 * math.exp(-t * 11))
    stem = bezier((0.50, 0.26), (0.525, 0.45), (0.475, 0.63), (0.487, 0.83))
    stroke(d, stem, lambda t: 0.100 - 0.084 * (t ** 1.3))
    return img


def kai_cursive():
    """行楷连笔：横尾顺势带弧接竖，笔尾向左出钩，一笔写成的感觉"""
    img = base_square()
    d = ImageDraw.Draw(img)
    # 横：右端上挑
    bar = bezier((0.18, 0.29), (0.38, 0.265), (0.62, 0.235), (0.83, 0.22))
    stroke(d, bar, lambda t: 0.077 - 0.022 * t + 0.014 * math.exp(-t * 12))
    # 回锋带弧入竖，竖末端向左钩出
    stem = bezier((0.505, 0.25), (0.525, 0.44), (0.475, 0.62), (0.495, 0.77))
    stroke(d, stem, lambda t: 0.078 - 0.036 * t)
    hook = bezier((0.495, 0.77), (0.505, 0.815), (0.465, 0.838), (0.43, 0.83))
    stroke(d, hook, lambda t: 0.040 - 0.028 * t)
    return img


def kai_dot():
    """楷书 T + 收笔点：横竖都是楷法，右下补一个顿点呼应"""
    img = base_square()
    d = ImageDraw.Draw(img)
    bar = bezier((0.18, 0.285), (0.38, 0.26), (0.62, 0.235), (0.82, 0.23))
    stroke(d, bar, lambda t: 0.075 - 0.018 * t + 0.014 * math.exp(-t * 12))
    stem = bezier((0.50, 0.25), (0.518, 0.44), (0.483, 0.60), (0.49, 0.72))
    stroke(d, stem, lambda t: 0.082 - 0.052 * (t ** 1.2))
    # 右下顿点：向右下顿按、向左收
    dot = bezier((0.64, 0.68), (0.705, 0.72), (0.705, 0.77), (0.655, 0.785))
    stroke(d, dot, lambda t: 0.062 if t < 0.3 else 0.062 - 0.050 * t)
    return img


VARIANTS = [
    ("楷体字库", lambda: font_icon("simkai.ttf", 0.74)),
    ("楷体描粗", lambda: font_icon("simkai.ttf", 0.72, 0.028)),
    ("楷书顿笔", kai_hand),
    ("楷书加粗", kai_bold),
    ("行楷连笔", kai_cursive),
    ("楷书带点", kai_dot),
]

CELL = 300
LABEL_H = 36
COLS = 3
rows = (len(VARIANTS) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL_H)), (245, 245, 247))
draw = ImageDraw.Draw(sheet)
label_font = ImageFont.truetype(os.path.join(WIN_FONTS, "msyh.ttc"), 17)

for i, (name, fn) in enumerate(VARIANTS):
    icon = fn().resize((CELL - 40, CELL - 40), Image.LANCZOS)
    cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL_H)
    sheet.paste(icon, (cx + 20, cy + 20), icon)
    lw = draw.textbbox((0, 0), name, font=label_font)[2]
    draw.text((cx + (CELL - lw) / 2, cy + CELL + 4), name, font=label_font, fill=(60, 60, 64))

out_path = os.path.join(OUT, "kai-preview.png")
sheet.save(out_path)
print("OK", out_path)
