"""Stand-in voice audition, Kokoro-82M (Apache-2.0) American male voices. Run with ~/.local/share/momo-tts/.venv:
python -I tools/standin_voice/kokoro_samples.py OUTDIR am_adam am_michael ...   → OUTDIR/kokoro-<voice>.wav"""
import os, sys
import numpy as np, soundfile as sf, torch
from kokoro import KPipeline
LINES = ["Oink! Which word rhymes with pig? Is it... Option A: Pan, Option B: Wig, or Option C: Dog?",
         "Yes! You got it! Pig, wig! They both end with ig. A pig in a wig, how silly!"]
torch.set_num_threads(int(os.environ.get('THREADS', '2')))
pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
out = sys.argv[1]
for v in sys.argv[2:]:
    parts = []
    for i, t in enumerate(LINES):
        for _, _, audio in pipe(t, voice=v, speed=0.95):
            parts.append(np.asarray(audio, dtype=np.float32))
        if i == 0:
            parts.append(np.zeros(int(24000 * 0.8), dtype=np.float32))
    sf.write(os.path.join(out, 'kokoro-%s.wav' % v), np.concatenate(parts), 24000)
    print('done', v, flush=True)
