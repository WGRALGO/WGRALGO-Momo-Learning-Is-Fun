"""One local page with every stand-in voice sample (mp3s embedded, so the single file works anywhere).
.venv/bin/python -I tools/standin_voice/make_page.py SAMPLEDIR OUT.html"""
import base64, glob, html, os, subprocess, sys
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
src, out = sys.argv[1], sys.argv[2]
cards = []
for i, f in enumerate(sorted(glob.glob(os.path.join(src, '*.wav')), key=lambda p: (not os.path.basename(p).startswith('kokoro'), p))):
    name = os.path.basename(f)[:-4]
    eng, voice = name.split('-', 1)
    label = ('Kokoro · ' + voice) if eng == 'kokoro' else ('XTTS · ' + voice.replace('-', ' ').title())
    mp3 = subprocess.run([FF, '-v', 'error', '-i', f, '-ac', '1', '-b:a', '64k', '-f', 'mp3', '-'], check=True, capture_output=True).stdout
    cards.append('<div class="c"><div class="n">%d</div><div class="l">%s</div><audio controls preload="none" src="data:audio/mpeg;base64,%s"></audio></div>'
                 % (i + 1, html.escape(label), base64.b64encode(mp3).decode()))
page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Momo Stand-in Voice Samples</title><style>
body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#2a1145;color:#fff}
main{max-width:980px;margin:0 auto;padding:20px 16px 40px}h1{margin:.2em 0;color:#f7b733}
p{color:#e6d9f5}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:16px}
.c{background:#542282;border-radius:14px;padding:12px 14px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center}
.n{grid-row:span 2;width:34px;height:34px;border-radius:50%;background:#f7b733;color:#2a1145;font-weight:700;display:grid;place-items:center}
.l{font-weight:600}audio{width:100%}</style></head><body><main>
<h1>Stand-in voice samples</h1>
<p>Each sample reads English question 16, then its "right answer" line. Pick the one that sounds right for the stand-in voice
(English 16&ndash;39 and Science 38&ndash;40, 45&ndash;50) and tell Claude its number and name. All are offline voices:
Kokoro is free to use (Apache-2.0); XTTS is free for non-commercial use (Coqui Public Model License).</p>
<div class="g">''' + '\n'.join(cards) + '</div></main></body></html>'
open(out, 'w').write(page)
print(len(cards), 'samples →', out, '%.1f MB' % (os.path.getsize(out) / 1e6))
