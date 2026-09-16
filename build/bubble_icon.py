# -*- coding: utf-8 -*-
"""泡泡风 teal 小写 t 图标(按用户参考图)——生成 icon.ico / icon.png"""
from PIL import Image, ImageDraw, ImageFont
import math, os

SIZE = 1024
BODY = (62, 175, 190, 255)        # 泡泡主体 teal
OUTLINE = (26, 96, 108, 255)      # 深色描边
HILITE = (222, 248, 250, 255)     # 高光
BG = (255, 255, 255, 255)         # 白底
WIN_FONTS = r"C:\Windows\Fonts"
OUT = r"C:\Users\weiwenjie\Desktop\gg2\build"


def base_square():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255)
    img.paste(BG, (0, 0, SIZE, SIZE), mask)
    return img


def bezier(p0, p1, p2, p3, n=120):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def stroke(draw, pts, radius, color):
    """沿路径画圆头粗描边"""
    for x, y in pts:
        r = radius * SIZE
        draw.ellipse([x * SIZE - r, y * SIZE - r, x * SIZE + r, y * SIZE + r], fill=color)


STEM = bezier((0.52, 0.13), (0.545, 0.42), (0.44, 0.62), (0.53, 0.73))
HOOK = bezier((0.53, 0.73), (0.615, 0.805), (0.71, 0.775), (0.715, 0.665))
BAR = bezier((0.25, 0.325), (0.42, 0.29), (0.60, 0.265), (0.76, 0.285))
R_STEM, R_HOOK, R_BAR = 0.088, 0.078, 0.072


def render():
    img = base_square()
    d = ImageDraw.Draw(img)
    # 底层：横笔画(自带描边)，被竖笔压在后面
    stroke(d, BAR, R_BAR + 0.020, OUTLINE)
    stroke(d, BAR, R_BAR, BODY)
    # 顶层：竖笔 + 弯钩(描边完整保留，与横笔交界处有分隔线)
    for pts, r in [(STEM, R_STEM + 0.020), (HOOK, R_HOOK + 0.020)]:
        stroke(d, pts, r, OUTLINE)
    for pts, r in [(STEM, R_STEM), (HOOK, R_HOOK)]:
        stroke(d, pts, r, BODY)
    # 高光：竖笔左上 + 横笔左端
    d.ellipse([0.435 * SIZE, 0.20 * SIZE, 0.505 * SIZE, 0.33 * SIZE], fill=HILITE)
    d.ellipse([0.255 * SIZE, 0.285 * SIZE, 0.315 * SIZE, 0.345 * SIZE], fill=HILITE)
    return img


img = render()
img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "icon.png"))
img.resize((256, 256), Image.LANCZOS).save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
# 大图预览
img.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "bubble-preview.png"))
print("OK icon.ico / icon.png / bubble-preview.png")
