# -*- coding: utf-8 -*-
"""生成 TinyMD 应用图标：灰底圆角方块 + 白色小写 t"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 1024  # 高清画布，最后缩到各尺寸
GRAY = (125, 125, 130, 255)        # 中性灰
OUT_DIR = r"C:\Users\weiwenjie\Desktop\gg2\build"
os.makedirs(OUT_DIR, exist_ok=True)

def rounded(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 灰底圆角方块(半径约 22%)
img.paste(GRAY, (0, 0, SIZE, SIZE), rounded(SIZE, int(SIZE * 0.22)))

# 白色粗体 t
font = None
for cand in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\seguisb.ttf", r"C:\Windows\Fonts\arial.ttf"):
    if os.path.exists(cand):
        font = ImageFont.truetype(cand, int(SIZE * 0.72))
        break
if font is None:
    raise SystemExit("no font found")

bbox = draw.textbbox((0, 0), "t", font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
# 水平居中；小写 t 视觉重心略偏上，垂直方向往下留一点
x = (SIZE - tw) / 2 - bbox[0]
y = (SIZE - th) / 2 - bbox[1] + SIZE * 0.04
draw.text((x, y), "t", font=font, fill=(255, 255, 255, 255))

# 输出 ICO（含多尺寸）和 PNG 预览
ico_path = os.path.join(OUT_DIR, "icon.ico")
img.save(ico_path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT_DIR, "icon.png"))
print("OK", ico_path, os.path.getsize(ico_path))
