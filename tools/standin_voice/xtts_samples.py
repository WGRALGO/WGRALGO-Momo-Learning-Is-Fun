"""Stand-in voice audition, XTTS-v2 studio speakers (male). Run with Yip Yappers Pro's venv:
~/YipYappersPro/app/.venv/bin/python -I tools/standin_voice/xtts_samples.py OUTDIR "Name 1" "Name 2" ...
Writes OUTDIR/xtts-<name>.wav (the question line, a pause, then the right-answer line)."""
import os, sys
os.environ.setdefault("COQUI_TOS_AGREED", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
import numpy as np, torch, soundfile as sf
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

D = os.path.expanduser('~/YipYappersPro/models/tts/tts_models--multilingual--multi-dataset--xtts_v2')
LINES = ["Oink! Which word rhymes with pig? Is it... Option A: Pan, Option B: Wig, or Option C: Dog?",
         "Yes! You got it! Pig, wig! They both end with ig. A pig in a wig, how silly!"]
torch.set_num_threads(int(os.environ.get('THREADS', '4')))
cfg = XttsConfig(); cfg.load_json(os.path.join(D, 'config.json'))
m = Xtts.init_from_config(cfg)
m.load_checkpoint(cfg, checkpoint_dir=D, vocab_path=os.path.join(D, 'vocab.json'),
                  speaker_file_path=os.path.join(D, 'speakers_xtts.pth'), eval=True)
out = sys.argv[1]
for name in sys.argv[2:]:
    path = os.path.join(out, 'xtts-%s.wav' % name.lower().replace(' ', '-'))
    if os.path.exists(path):
        continue
    lat, emb = m.speaker_manager.speakers[name].values()
    parts = []
    for i, t in enumerate(LINES):
        torch.manual_seed(1)
        r = m.inference(t, 'en', lat, emb, temperature=0.7, length_penalty=cfg.length_penalty,
                        repetition_penalty=cfg.repetition_penalty, top_k=cfg.top_k, top_p=cfg.top_p)
        parts.append(np.asarray(r['wav'], dtype=np.float32))
        if i == 0:
            parts.append(np.zeros(int(24000 * 0.8), dtype=np.float32))
    sf.write(path, np.concatenate(parts), 24000)
    print('done', name, flush=True)
