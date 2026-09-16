# -*- coding: utf-8 -*-
"""自设计的艺术感 T 图标方案对比，供挑选"""
from PIL import Image, ImageDraw, ImageFont
import os

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


def font_icon(path, size_ratio=0.72):
    img = base_square()
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(os.path.join(WIN_FONTS, path), int(SIZE * size_ratio))
    bbox = d.textbbox((0, 0), "T", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((SIZE - tw) / 2 - bbox[0], (SIZE - th) / 2 - bbox[1]), "T", font=font, fill=WHITE)
    return img


def r_(v):
    return int(v * SIZE)


# ---------- 自设计方案 ----------

def design_bauhaus():
    """包豪斯几何风：粗横梁 + 圆头竖笔，底部半圆收尾"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rectangle([r_(0.14), r_(0.16), r_(0.86), r_(0.36)], fill=WHITE)
    d.rounded_rectangle([r_(0.41), r_(0.16), r_(0.59), r_(0.78)], radius=r_(0.09), fill=WHITE)
    d.ellipse([r_(0.41), r_(0.60), r_(0.59), r_(0.78)], fill=WHITE)
    # 右上角一个偏离的几何圆点缀
    d.ellipse([r_(0.70), r_(0.66), r_(0.84), r_(0.80)], fill=WHITE)
    return img


def design_brush():
    """毛笔笔触风：粗细渐变的斜切笔画"""
    img = base_square()
    d = ImageDraw.Draw(img)
    # 横梁：左低右高、右端出锋
    d.polygon([
        (r_(0.10), r_(0.28)), (r_(0.86), r_(0.16)),
        (r_(0.90), r_(0.24)), (r_(0.13), r_(0.38)),
    ], fill=WHITE)
    # 竖笔：上宽下窄，末端拖锋
    d.polygon([
        (r_(0.42), r_(0.24)), (r_(0.62), r_(0.22)),
        (r_(0.53), r_(0.86)), (r_(0.44), r_(0.84)),
    ], fill=WHITE)
    return img


def design_stencil():
    """模板镂空风：笔画带断口，工业感"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rectangle([r_(0.12), r_(0.18), r_(0.52), r_(0.32)], fill=WHITE)
    d.rectangle([r_(0.62), r_(0.18), r_(0.88), r_(0.32)], fill=WHITE)
    d.rectangle([r_(0.43), r_(0.18), r_(0.60), r_(0.52)], fill=WHITE)
    d.rectangle([r_(0.43), r_(0.64), r_(0.60), r_(0.84)], fill=WHITE)
    return img


def design_didot():
    """时装杂志风(Didone)：粗横梁 + 极细竖笔 + 底部出脚"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rectangle([r_(0.12), r_(0.18), r_(0.88), r_(0.30)], fill=WHITE)
    d.rectangle([r_(0.465), r_(0.18), r_(0.535), r_(0.80)], fill=WHITE)
    d.polygon([(r_(0.38), r_(0.84)), (r_(0.62), r_(0.84)), (r_(0.535), r_(0.74)), (r_(0.465), r_(0.74))], fill=WHITE)
    return img


def design_round():
    """圆润亲和风：全圆角笔画"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([r_(0.14), r_(0.17), r_(0.86), r_(0.35)], radius=r_(0.09), fill=WHITE)
    d.rounded_rectangle([r_(0.415), r_(0.17), r_(0.585), r_(0.83)], radius=r_(0.085), fill=WHITE)
    return img


def design_dot():
    """T. 句点风：短 T 加一个圆点，类似品牌字标"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([r_(0.13), r_(0.15), r_(0.87), r_(0.33)], radius=r_(0.08), fill=WHITE)
    d.rounded_rectangle([r_(0.42), r_(0.15), r_(0.58), r_(0.68)], radius=r_(0.075), fill=WHITE)
    d.ellipse([r_(0.60), r_(0.66), r_(0.78), r_(0.84)], fill=WHITE)
    return img


def design_slice():
    """斜切风：横梁被一条斜线切开，有动势"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rectangle([r_(0.13), r_(0.18), r_(0.87), r_(0.34)], fill=WHITE)
    d.rectangle([r_(0.42), r_(0.18), r_(0.58), r_(0.84)], fill=WHITE)
    # 用背景色斜切一刀
    d.polygon([(r_(0.58), r_(0.10)), (r_(0.72), r_(0.10)), (r_(0.40), r_(0.46)), (r_(0.26), r_(0.46))], fill=GRAY)
    return img


def design_nordic():
    """北欧极简风：极细线条 + 大留白"""
    img = base_square()
    d = ImageDraw.Draw(img)
    w = r_(0.045)
    d.rectangle([r_(0.18), r_(0.22), r_(0.82), r_(0.22) + w], fill=WHITE)
    d.rectangle([r_(0.478), r_(0.22), r_(0.478) + w, r_(0.80)], fill=WHITE)
    # 底部一个小圆点平衡构图
    d.ellipse([r_(0.478) - r_(0.05), r_(0.84), r_(0.478) + w + r_(0.05), r_(0.84) + r_(0.10)], fill=WHITE)
    return img


def design_serif_ink():
    """墨迹衬线风：粗衬线 + 喇叭状笔脚"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rectangle([r_(0.13), r_(0.17), r_(0.87), r_(0.31)], fill=WHITE)
    d.polygon([
        (r_(0.44), r_(0.17)), (r_(0.56), r_(0.17)),
        (r_(0.58), r_(0.76)), (r_(0.70), r_(0.84)), (r_(0.30), r_(0.84)), (r_(0.42), r_(0.76)),
    ], fill=WHITE)
    return img


def design_arrow():
    """科技感：T 的竖笔化作向下箭头，寓意阅读/向下滚动"""
    img = base_square()
    d = ImageDraw.Draw(img)
    d.rectangle([r_(0.16), r_(0.18), r_(0.84), r_(0.32)], fill=WHITE)
    d.polygon([
        (r_(0.42), r_(0.18)), (r_(0.58), r_(0.18)),
        (r_(0.58), r_(0.62)), (r_(0.70), r_(0.62)),
        (r_(0.50), r_(0.84)), (r_(0.30), r_(0.62)), (r_(0.42), r_(0.62)),
    ], fill=WHITE)
    return img


DESIGNS = [
    ("包豪斯几何", design_bauhaus),
    ("毛笔笔触", design_brush),
    ("模板镂空", design_stencil),
    ("杂志细腰", design_didot),
    ("全圆角", design_round),
    ("T. 句点", design_dot),
    ("斜切", design_slice),
    ("北欧细线", design_nordic),
    ("墨迹衬线", design_serif_ink),
    ("下箭头", design_arrow),
    ("Impact 压缩", lambda: font_icon("impact.ttf", 0.82)),
    ("Ink Free 手写", lambda: font_icon("Inkfree.ttf", 0.78)),
]

CELL = 240
LABEL_H = 34
COLS = 4
rows = (len(DESIGNS) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL_H)), (245, 245, 247))
draw = ImageDraw.Draw(sheet)
label_font = ImageFont.truetype(os.path.join(WIN_FONTS, "msyh.ttc"), 16)

for i, (name, fn) in enumerate(DESIGNS):
    icon = fn().resize((CELL - 40, CELL - 40), Image.LANCZOS)
    cx, cy = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL_H)
    sheet.paste(icon, (cx + 20, cy + 20), icon)
    lw = draw.textbbox((0, 0), name, font=label_font)[2]
    draw.text((cx + (CELL - lw) / 2, cy + CELL + 4), name, font=label_font, fill=(60, 60, 64))

out_path = os.path.join(OUT, "design-preview.png")
sheet.save(out_path)
print("OK", out_path)
