"""Builds the app's art and media from source/ (run with the project venv: .venv/bin/python -I tools/make_assets.py).
  web/img/badge.webp         the logo badge cut off its sky background (splash, header)
  web/img/char/<id>.jpg      the 8 characters' pictures (with their backgrounds), cropped square around the character
  web/media/<id>-correct.mp4 / <id>-incorrect.mp4   their videos, re-encoded smaller (long side 960 px), index first
  (the intro video, web/media/intro.mp4 + web/img/intro-poster.jpg, is made by tools/make_intro.py)
  android/res/...            launcher icons (adaptive: badge on deep purple), the pre-Android-12 splash art
  linux/icons/...            desktop icons
The questions are built by tools/build_content.py."""
import os, subprocess, sys
import cv2, numpy as np
from PIL import Image, ImageDraw
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'source')
WEB = os.path.join(ROOT, 'web')
RES = os.path.join(ROOT, 'android', 'res')
FF = imageio_ffmpeg.get_ffmpeg_exe()
PURPLE = (84, 34, 130, 255)          # the logo's deep purple (#542282): icon + splash background
TMP = os.path.join(ROOT, 'build', 'assets-tmp'); os.makedirs(TMP, exist_ok=True)


def run(*a):
    subprocess.run(a, check=True)


def badge():
    raw, clean = os.path.join(TMP, 'badge-raw.png'), os.path.join(TMP, 'badge-clean.png')
    py = sys.executable
    run(py, '-I', os.path.join(ROOT, 'tools', 'cutout_logo.py'), os.path.join(SRC, 'The Momma Lewis Momo Learning Is FUN Logo (Final).jpg'), raw)
    run(py, '-I', os.path.join(ROOT, 'tools', 'clean_badge.py'), raw, clean)
    b = Image.open(clean).convert('RGBA')
    w = 1400
    b.resize((w, round(b.height * w / b.width)), Image.LANCZOS).save(os.path.join(WEB, 'img', 'badge.webp'), quality=90, method=6)
    return b


def jpg(src, dst, maxw, q=86):
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg
    im = im.convert('RGB')
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    im.save(dst, quality=q, optimize=True, progressive=True)


def characters():
    """The 8 characters (source/characters/<id>/, copied from the owner's "Characters (Final)" folder)."""
    import glob, json
    cmap = json.load(open(os.path.join(ROOT, 'tools', 'content_map.json'), encoding='utf-8'))
    os.makedirs(os.path.join(WEB, 'img', 'char'), exist_ok=True)
    for ch in cmap['characters']:
        d = os.path.join(SRC, 'characters', ch['id'])
        im = Image.open(os.path.join(d, ch['picture'])).convert('RGB')
        side = min(im.size)
        x = round(min(max(0, im.width * ch.get('fx', 0.5) - side / 2), im.width - side))
        y = round((im.height - side) / 2)
        im.crop((x, y, x + side, y + side)).resize((720, 720), Image.LANCZOS).save(
            os.path.join(WEB, 'img', 'char', ch['id'] + '.jpg'), quality=86, optimize=True, progressive=True)
        for kind in ('correct', 'incorrect'):
            hits = [f for f in glob.glob(os.path.join(d, '*.mp4')) if f.lower().endswith(' %s.mp4' % kind)]
            if len(hits) != 1:
                sys.exit('%s: need exactly one "... %s.mp4", found %r' % (ch['id'], kind, hits))
            # long side 960 px, even sizes; H.264 High + AAC; the index first so it starts playing at once
            run(FF, '-v', 'error', '-y', '-i', hits[0], '-map', '0:v:0', '-map', '0:a:0',
                '-vf', "scale='if(gt(iw,ih),min(960,iw),-2)':'if(gt(iw,ih),-2,min(960,ih))':flags=lanczos,format=yuv420p",
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '112k',
                '-movflags', '+faststart', os.path.join(WEB, 'media', '%s-%s.mp4' % (ch['id'], kind)))
        print('character', ch['id'])


def place(b, size, scale, bg, radius=0):
    can = Image.new('RGBA', (size, size), bg if radius == 0 else (0, 0, 0, 0))
    if radius:
        ImageDraw.Draw(can).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=bg)
    bw = round(size * scale); bh = round(b.height * bw / b.width)
    can.alpha_composite(b.resize((bw, bh), Image.LANCZOS), ((size - bw) // 2, (size - bh) // 2))
    return can


def icons(b):
    # adaptive icon: 108dp canvas (432 px at xxxhdpi); the launcher shows the middle 72dp. The badge is 70% of the
    # canvas, so it fills the visible circle (Lenny's ear and Nyla's fingertip just touch the edge).
    os.makedirs(os.path.join(RES, 'drawable-nodpi'), exist_ok=True)
    fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
    bw = round(432 * 0.70); bh = round(b.height * bw / b.width)
    fg.alpha_composite(b.resize((bw, bh), Image.LANCZOS), ((432 - bw) // 2, (432 - bh) // 2))
    fg.save(os.path.join(RES, 'drawable-nodpi', 'ic_fg.png'), optimize=True)
    # Android 7 (no adaptive icons): purple rounded square, badge across it
    for d, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        os.makedirs(os.path.join(RES, 'mipmap-' + d), exist_ok=True)
        place(b, px, 0.94, PURPLE, radius=round(px * 0.18)).save(os.path.join(RES, 'mipmap-' + d, 'ic_launcher.png'), optimize=True)
    # before Android 12 the launch window shows this big on purple (sized by @dimen/splash_w / splash_h)
    s = b.resize((1000, round(b.height * 1000 / b.width)), Image.LANCZOS)
    s.save(os.path.join(RES, 'drawable-nodpi', 'splash_big.webp'), quality=90, method=6)
    print('splash aspect', round(s.width / s.height, 4))
    for px in (48, 64, 128, 256, 512):
        d = os.path.join(ROOT, 'linux', 'icons', '%dx%d' % (px, px), 'apps'); os.makedirs(d, exist_ok=True)
        place(b, px, 0.94, PURPLE, radius=round(px * 0.18)).save(os.path.join(d, 'momo-learning.png'), optimize=True)


if __name__ == '__main__':
    for d in ('img', 'media'):
        os.makedirs(os.path.join(WEB, d), exist_ok=True)
    b = badge()
    characters()
    icons(b)
    print('done')
