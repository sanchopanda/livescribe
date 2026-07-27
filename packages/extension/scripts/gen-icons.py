#!/usr/bin/env python3
"""Generate Skribo extension monogram icons ('S' on #0d9488). One-off; PNGs are committed."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def render(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=(13, 148, 136, 255))
    font = ImageFont.load_default(size=round(size * 0.68))
    bbox = d.textbbox((0, 0), 'S', font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), 'S', font=font, fill=(255, 255, 255, 255))
    return img

base = render(128)
base.save(os.path.join(OUT, 'icon-128.png'))
for s in (48, 16):
    base.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'icon-{s}.png'))
print('wrote icon-16/48/128.png to', os.path.abspath(OUT))
