"""
Renders the LOOPVX app icons from the original web app's public/icon.svg geometry (512 grid):
dark tile, lime ring (r 168, stroke 28, gap at the top, round caps) and "VX". Run from the repo root:

    python3 scripts/render-brand-assets.py

Needs Pillow and the Inter Bold font (/usr/share/fonts/opentype/inter/Inter-Bold.otf).
Outputs into assets/images/: icon.png, android-icon-{foreground,background,monochrome}.png,
splash-icon.png, favicon.png.
"""
import math

from PIL import Image, ImageDraw, ImageFont

BG = (13, 13, 15, 255)  # #0d0d0f, the app background (C.bg)
LIME = (198, 255, 61, 255)  # #c6ff3d
WHITE = (255, 255, 255, 255)
FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
SS = 4  # supersampling factor for smooth edges


def mark(size: int, color, scale: float = 1.0) -> Image.Image:
    """The ring + "VX" on a transparent canvas; `scale` shrinks it around the centre."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 512 * scale  # one unit of the 512 grid
    c = s / 2
    r, w = 168 * u, 28 * u
    # SVG: dasharray 880 176 on a circle rotated -60 deg -> a 300 deg arc from -60 to 240 (y down).
    sweep = 880 / (2 * math.pi * 168) * 360
    start, end = -60, -60 + sweep
    d.arc((c - r - w / 2, c - r - w / 2, c + r + w / 2, c + r + w / 2), start, end, fill=color, width=round(w))
    for a in (start, end):  # round caps
        x, y = c + r * math.cos(math.radians(a)), c + r * math.sin(math.radians(a))
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)
    font = ImageFont.truetype(FONT, round(150 * u))
    # SVG text: x=256, baseline y=300, centred.
    d.text((c, c + (300 - 256) * u), "VX", font=font, fill=color, anchor="ms")
    return img.resize((size, size), Image.LANCZOS)


def tile(size: int, radius: float | None) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if radius is None:
        d.rectangle((0, 0, s, s), fill=BG)
    else:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=radius / 512 * s, fill=BG)
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: str, rgb: bool = False) -> None:
    out = img.convert("RGB") if rgb else img
    out.save(path, optimize=True)
    print(path, out.size, out.mode)


def compose(size: int, radius: float | None, scale: float = 1.0) -> Image.Image:
    base = tile(size, radius)
    base.alpha_composite(mark(size, LIME, scale))
    return base


# App icon (iOS + store): full-bleed square without transparency; the OS rounds the corners.
save(compose(1024, None), "assets/images/icon.png", rgb=True)

# Android adaptive icon: plain background layer + the mark inside the 66 % safe zone.
save(tile(1024, None), "assets/images/android-icon-background.png", rgb=True)
save(mark(1024, LIME, scale=0.72), "assets/images/android-icon-foreground.png")
save(mark(1024, WHITE, scale=0.72), "assets/images/android-icon-monochrome.png")

# Splash: the rounded tile like the original icon (shown small on the dark splash background).
save(compose(512, 112), "assets/images/splash-icon.png")

# Favicon for the web build.
save(compose(64, 112), "assets/images/favicon.png")
