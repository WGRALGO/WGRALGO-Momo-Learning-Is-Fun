"""Makes Momo's public intro video: her heart pulsing with "Momo Public Facing Intro.mp3" in the middle and the 8
characters (with their backgrounds) popping in around her, all bouncing at "choose your character".
  build/intro/intro-1080p.mp4   full HD (kept for the owner)
  web/media/intro.mp4            1280x720 for the apps and the web folder
  web/img/intro-poster.jpg       a frame with all 8 characters (shown before it plays)
Run: .venv/bin/python -I tools/make_intro.py   (needs Playwright's Chromium, like the tests)"""
import base64, json, os, shutil, subprocess, sys
import imageio_ffmpeg
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'momo_light'))
from make_preview import envelope  # noqa: E402
FF = imageio_ffmpeg.get_ffmpeg_exe()
AUDIO = os.path.join(ROOT, 'source', 'Audio', 'Momo Public Facing Intro.mp3')
OUT = os.path.join(ROOT, 'build', 'intro'); os.makedirs(OUT, exist_ok=True)
FPS, LEAD, TAIL = 30, 0.5, 1.5
# word starts measured with Whisper (medium, word timestamps) on the intro clip
CHOOSE, BEGIN = 17.42, 18.86          # "choose your character", "let's begin"


def main():
    cmap = json.load(open(os.path.join(ROOT, 'tools', 'content_map.json'), encoding='utf-8'))
    env = envelope(AUDIO)
    dur = len(env) / 60
    page = os.path.join(OUT, 'page'); shutil.rmtree(page, ignore_errors=True); os.makedirs(page)
    shutil.copy(os.path.join(ROOT, 'tools', 'intro', 'intro.html'), page)
    shutil.copy(os.path.join(ROOT, 'web', 'js', 'momo-light.js'), page)
    chars = []
    for ch in cmap['characters']:
        # embedded: a file:// picture would "taint" the canvas and the frames could not be read back
        b = open(os.path.join(ROOT, 'web', 'img', 'char', ch['id'] + '.jpg'), 'rb').read()
        chars.append('data:image/jpeg;base64,' + base64.b64encode(b).decode('ascii'))
    intro = {'env': {'fps': 60, 'v': env}, 'lead': LEAD, 'chars': chars,
             'pops': [LEAD + 2.6 + i * 1.75 for i in range(8)], 'choose': LEAD + CHOOSE, 'begin': LEAD + BEGIN}
    html = open(os.path.join(page, 'intro.html')).read().replace('<script src="momo-light.js">',
        '<script>window.INTRO = %s;</script>\n<script src="momo-light.js">' % json.dumps(intro))
    open(os.path.join(page, 'intro.html'), 'w').write(html)
    secs = LEAD + dur + TAIL
    silent = os.path.join(OUT, 'frames.mp4')
    subprocess.run(['node', os.path.join(ROOT, 'tools', 'intro', 'render.js'), 'file://' + os.path.join(page, 'intro.html'),
                    str(FPS), '%.3f' % secs, FF, silent], check=True)
    full = os.path.join(OUT, 'intro-1080p.mp4')
    audio = ['-itsoffset', str(LEAD), '-i', AUDIO, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-af', 'apad', '-shortest']
    subprocess.run([FF, '-v', 'error', '-y', '-i', silent] + audio + ['-c:v', 'copy', '-movflags', '+faststart', full], check=True)
    subprocess.run([FF, '-v', 'error', '-y', '-i', silent] + audio + ['-vf', 'scale=1280:720:flags=lanczos',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart', os.path.join(ROOT, 'web', 'media', 'intro.mp4')], check=True)
    subprocess.run([FF, '-v', 'error', '-y', '-ss', '%.2f' % (LEAD + 16.5), '-i', os.path.join(ROOT, 'web', 'media', 'intro.mp4'),
                    '-frames:v', '1', '-q:v', '3', os.path.join(ROOT, 'web', 'img', 'intro-poster.jpg')], check=True)
    for f in (full, os.path.join(ROOT, 'web', 'media', 'intro.mp4')):
        print(f, '%.1f MB' % (os.path.getsize(f) / 1e6))


if __name__ == '__main__':
    main()
