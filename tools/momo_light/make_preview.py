#!/usr/bin/env python3
"""Build the Momo's light preview: the app's home screen with a deep purple light in place of the pool photo intro,
pulsing with Momo's intro audio. One self-contained HTML file (audio, pictures, font and code inside).

    .venv/bin/python -I tools/momo_light/make_preview.py [out.html] [--shapes orb,gem,heart] [--template all8.html]

preview.html = the app's home screen (one Momo, or a shape switcher); all8.html = all the Momos side by side.

The loudness envelope is the same one the app would use for every clip: 60 values a second, 0-100.
"""
import base64
import glob
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FPS = 60
RATE = 22050


def ffmpeg():
    hits = glob.glob(os.path.join(ROOT, '.venv/lib/python*/site-packages/imageio_ffmpeg/binaries/ffmpeg*'))
    if not hits:
        sys.exit('ffmpeg not found in .venv (imageio-ffmpeg)')
    return hits[0]


def envelope(path):
    """How loud the clip is, FPS times a second, as whole numbers 0-100, shaped so each syllable is its own pulse.

    Only the voice band (300-3000 Hz) counts, so breaths and hiss don't light Momo up. Each moment is measured
    against the quietest and loudest points in the 1/4 s around it, so the dips between syllables go dark even in
    fast, continuous speech (plain loudness stays half-lit through a whole sentence and looks like one long glow).
    """
    pcm = subprocess.run([ffmpeg(), '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    x = np.frombuffer(pcm, dtype='<f4').astype(np.float64)
    if not len(x):
        return []
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    X[(f < 300) | (f > 3000)] = 0
    y = np.fft.irfft(X, len(x))
    hop, win = RATE / FPS, int(RATE * 0.03)              # a 30 ms window every 1/60 s
    n = int(np.ceil(len(y) / hop))
    rms = np.empty(n)
    for i in range(n):
        mid = int(i * hop + hop / 2)
        seg = y[max(0, mid - win // 2):mid + win // 2]
        rms[i] = np.sqrt(np.mean(seg * seg)) if len(seg) else 0.0
    db = 20 * np.log10(rms + 1e-9)
    voiced = db[db > -60]
    top = np.percentile(voiced, 98) if len(voiced) else -20.0
    level = np.clip((db - (top - 30)) / 30, 0, 1)         # 30 dB of range: quieter than that is a pause
    k = 8                                                 # ±8 frames ≈ ±133 ms
    pad = np.pad(level, k, mode='edge')
    windows = np.lib.stride_tricks.sliding_window_view(pad, 2 * k + 1)
    lo, hi = windows.min(axis=1), windows.max(axis=1)
    contrast = np.clip((level - lo) / np.maximum(hi - lo, 0.15), 0, 1)
    out = level * (0.25 + 0.75 * contrast)
    peak = np.percentile(out, 97)
    out = np.clip(out / peak, 0, 1) ** 1.2 if peak > 0 else out
    return [int(round(v * 100)) for v in out]


def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def main():
    args = sys.argv[1:]
    shapes = ['orb']
    if '--shapes' in args:
        k = args.index('--shapes'); shapes = args[k + 1].split(','); del args[k:k + 2]
    template = 'preview.html'
    if '--template' in args:
        k = args.index('--template'); template = args[k + 1]; del args[k:k + 2]
    out = args[0] if args else os.path.join(ROOT, 'docs/mockups/momo-light-preview.html')
    audio = os.path.join(ROOT, 'source/Audio/Momo Intro.mp3')
    env = envelope(audio)
    with open(os.path.join(HERE, template), encoding='utf-8') as f:
        page = f.read()
    with open(os.path.join(HERE, 'momo-light.js'), encoding='utf-8') as f:
        light_js = f.read()
    parts = {
        '{{ENVELOPE}}': json.dumps({'fps': FPS, 'v': env}, separators=(',', ':')),
        '{{LIGHT_JS}}': light_js,
        '{{SHAPES}}': json.dumps(shapes),
        '{{FONT}}': b64(os.path.join(ROOT, 'web/fonts/Fredoka.ttf')),
        '{{LENNY}}': b64(os.path.join(ROOT, 'web/img/lenny.jpg')),
        '{{NYLA}}': b64(os.path.join(ROOT, 'web/img/nyla.jpg')),
        '{{AUDIO}}': b64(audio),
    }
    for k in ('{{ENVELOPE}}', '{{LIGHT_JS}}', '{{SHAPES}}', '{{AUDIO}}', '{{FONT}}'):
        if k not in page:
            sys.exit('template is missing ' + k)
    for k, v in parts.items():
        page = page.replace(k, v)
    if '{{' in page.replace('{{LIGHT', ''):
        left = page[page.index('{{'):page.index('{{') + 20]
        if left.startswith('{{') and '}}' in left:
            sys.exit('placeholder not filled: ' + left)
    if os.path.exists(out):
        sys.exit(out + ' already exists; not replacing it')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    loud = sum(1 for v in env if v >= 40)
    print('%s  %.1f s of voice, %d values, %d%% loud frames, %.0f KB'
          % (out, len(env) / FPS, len(env), 100 * loud // max(1, len(env)), os.path.getsize(out) / 1024))


if __name__ == '__main__':
    main()
