# -*- coding: utf-8 -*-
"""纯白底 + 单色 teal 小写 t v2：整条竖钩一笔连成(转角圆滑) + 自动居中"""
from PIL import Image, ImageDraw
import os

SIZE = 1024
BODY = (62, 175, 190, 255)          # teal 保留版
BODY_BLACK = (20, 20, 22, 255)      # 黑色版
BODY_BLUE = (47, 124, 246, 255)     # 蓝色版
OUT = r"C:\Users\weiwenjie\Desktop\gg2\build"


def bezier(p0, p1, p2, p3, n=140):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


# 竖笔与弯钩为一条连续曲线(C1 连续)，底部大弧度转弯，内缘不会出尖角
STEM = bezier((0.505, 0.12), (0.535, 0.38), (0.495, 0.58), (0.505, 0.68))
HOOK = bezier((0.505, 0.68), (0.515, 0.80), (0.665, 0.845), (0.715, 0.715))
BAR = bezier((0.245, 0.325), (0.42, 0.29), (0.60, 0.265), (0.775, 0.29))
R_STEM, R_HOOK, R_BAR = 0.085, 0.085, 0.072


def stroke(draw, pts, radius):
    for x, y in pts:
        r = radius * SIZE
        draw.ellipse([x * SIZE - r, y * SIZE - r, x * SIZE + r, y * SIZE + r], fill=BODY)


def render(body):
    # 字形画在透明层上
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for pts, r in [(STEM, R_STEM), (HOOK, R_HOOK), (BAR, R_BAR)]:
        for x, y in pts:
            rr = r * SIZE
            d.ellipse([x * SIZE - rr, y * SIZE - rr, x * SIZE + rr, y * SIZE + rr], fill=body)

    # 按字形包围盒居中
    bbox = layer.getbbox()
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    dx, dy = SIZE / 2 - cx, SIZE / 2 - cy

    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255)
    img.paste((255, 255, 255, 255), (0, 0, SIZE, SIZE), mask)
    img.alpha_composite(layer, (int(round(dx)), int(round(dy))))
    return img


def save(img, tag):
    img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, f"icon{tag}.png"))
    img.resize((256, 256), Image.LANCZOS).save(
        os.path.join(OUT, f"icon{tag}.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f"{tag or 'simple'}-preview.png"))


save(render(BODY), "")          # teal：icon.ico / icon.png（保留）
save(render(BODY_BLACK), "-black")  # 黑色：icon-black.ico / icon-black.png
save(render(BODY_BLUE), "-blue")    # 蓝色：icon-blue.ico / icon-blue.png

# 三色并排对比图
icons = [
    render(BODY).resize((512, 512), Image.LANCZOS),
    render(BODY_BLUE).resize((512, 512), Image.LANCZOS),
    render(BODY_BLACK).resize((512, 512), Image.LANCZOS),
]
sheet = Image.new("RGB", (3 * 524 + 10, 532), (245, 245, 247))
for i, ic in enumerate(icons):
    sheet.paste(ic, (10 + i * 524, 10), ic)
sheet.save(os.path.join(OUT, "simple-preview.png"))
print("OK icon.ico / icon-black.ico / icon-blue.ico / previews")
