"""Stand-in voice clips for the questions that have a picture but no voice yet (until Momo records them).
Reads the owner's recording scripts ("Momo:", "Correct Feedback:", "Wrong Feedback:" of each "# --- QUESTION n ---")
and writes, into each source/"<prefix> N"/ folder: "<prefix> Na.mp3" (question), "…b.mp3" (right), "…c.mp3" (wrong)
and standin.txt (which voice; delete the clips + standin.txt when Momo's clips arrive).
Run it with the engine's own Python:
  Kokoro:  ~/.local/share/momo-tts/.venv/bin/python -I tools/standin_voice/make_standin.py kokoro am_xxx [--only "english 16"] [--redo]
  XTTS:    ~/YipYappersPro/app/.venv/bin/python -I tools/standin_voice/make_standin.py xtts "Speaker Name"
Clips are matched to Momo's loudness (about -21 LUFS), 44.1 kHz mono MP3 like hers. It refuses to replace clips that
are not its own (a folder without standin.txt that already has a/b/c clips). A folder it has already voiced (standin.txt +
all 3 clips) is skipped unless --redo is given (since 2026-11-12: only the new questions get voiced)."""
import glob, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'source')
FF = os.environ.get('FFMPEG') or glob.glob(os.path.join(ROOT, '.venv/lib/python*/site-packages/imageio_ffmpeg/binaries/ffmpeg*'))[0]
TARGETS = [('english', 'english 5 year old.txt', list(range(16, 40))),
           ('math', 'math 5 year old.txt', list(range(16, 23))),
           ('science', 'science 5 year old.txt', list(range(16, 36)) + list(range(38, 51)))]
# how the phonics marks are said (a voice engine reads "/d/" as "slash d slash")
SOUNDS = {'ig': 'ig', 'ed': 'ed', 'ing': 'ing', 'oat': 'oat', 'd': 'duh', 'o': 'ah', 'g': 'guh', 's': 'sss', 'u': 'uh',
          'n': 'nnn', 'ks': 'ks', 'b': 'buh', 'm': 'mmm', 'r': 'rrr', 'kahh': 'kah', 'sss': 'sss', 'mmm': 'mmm'}


def speakable(t):
    t = re.sub(r'/([a-z]+)/', lambda m: SOUNDS.get(m.group(1), m.group(1)), t)
    t = re.sub(r'\b([A-Z])-([A-Z])(?:-([A-Z]))?(?:-([A-Z]))?\b', lambda m: ', '.join(x for x in m.groups() if x) + ',', t)   # D-O-G → D, O, G,
    # a choice that is one small letter ("Option A: a") is said as the letter's name, not the word "a"
    t = re.sub(r'(Option [ABC]:\s*)([a-z])(?=\s*[,?])', lambda m: m.group(1) + m.group(2).upper(), t)
    # "1 + 1 = 2" is said as words (the engine drops the + and = signs)
    t = re.sub(r'(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)', r'\1 plus \2 equals \3', t)
    t = t.replace('...', ',').replace('…', ',')
    return re.sub(r'\s+', ' ', t).strip()


def lines(script, n):
    text = open(os.path.join(SRC, script), encoding='utf-8').read()
    parts = re.split(r'^#\s*-+\s*QUESTION\s+(\d+)\s*-+\s*$', text, flags=re.M)
    body = {int(parts[i]): parts[i + 1] for i in range(1, len(parts), 2)}[n]
    get = lambda key: re.search(r'^' + key + r':\s*(.*?)\s*$', body, re.M | re.I).group(1)
    return get('Momo'), get('Correct Feedback'), get('Wrong Feedback')


def engine(kind, voice):
    import numpy as np, torch
    torch.set_num_threads(int(os.environ.get('THREADS', '4')))
    if kind == 'kokoro':
        from kokoro import KPipeline
        pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')
        def say(t):
            return np.concatenate([np.asarray(a, dtype=np.float32) for _, _, a in pipe(t, voice=voice, speed=float(os.environ.get('SPEED', '0.95')))]), 24000
        return say
    os.environ.setdefault('COQUI_TOS_AGREED', '1'); os.environ.setdefault('HF_HUB_OFFLINE', '1')
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    d = os.path.expanduser('~/YipYappersPro/models/tts/tts_models--multilingual--multi-dataset--xtts_v2')
    cfg = XttsConfig(); cfg.load_json(os.path.join(d, 'config.json'))
    m = Xtts.init_from_config(cfg)
    m.load_checkpoint(cfg, checkpoint_dir=d, vocab_path=os.path.join(d, 'vocab.json'), speaker_file_path=os.path.join(d, 'speakers_xtts.pth'), eval=True)
    lat, emb = m.speaker_manager.speakers[voice].values()
    def say(t):
        torch.manual_seed(1)
        r = m.inference(t, 'en', lat, emb, temperature=0.7, length_penalty=cfg.length_penalty, repetition_penalty=cfg.repetition_penalty,
                        top_k=cfg.top_k, top_p=cfg.top_p)
        return np.asarray(r['wav'], dtype=np.float32), 24000
    return say


def main():
    a = sys.argv[1:]
    if len(a) < 2 or a[0] not in ('kokoro', 'xtts'):
        sys.exit(__doc__)
    kind, voice = a[0], a[1]
    only = a[a.index('--only') + 1] if '--only' in a else None
    redo = '--redo' in a
    import soundfile as sf
    say = engine(kind, voice)
    label = ('Kokoro-82M (Apache-2.0), voice %s' % voice) if kind == 'kokoro' else ('XTTS-v2 (Coqui Public Model License), voice %s' % voice)
    done = 0
    for prefix, script, nums in TARGETS:
        for n in nums:
            name = '%s %d' % (prefix, n)
            if only and name != only:
                continue
            folder = os.path.join(SRC, name)
            if not os.path.isdir(folder):
                print('skip', name, '(no folder)'); continue
            mine = os.path.exists(os.path.join(folder, 'standin.txt'))
            have = [f for f in glob.glob(os.path.join(folder, '*.mp3'))]
            if have and not mine:
                print('skip', name, '(has real clips)'); continue
            if mine and len(have) == 3 and not redo:
                print('skip', name, '(already voiced; --redo to make it again)'); continue
            for f in have:
                os.remove(f)
            for letter, text in zip('abc', lines(script, n)):
                wav, sr = say(speakable(text))
                with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
                    sf.write(tmp.name, wav, sr)
                    # a little air before and after, Momo's loudness, 44.1 kHz mono MP3 128k like her clips
                    subprocess.run([FF, '-v', 'error', '-y', '-i', tmp.name, '-af',
                                    'adelay=150:all=1,apad=pad_dur=0.35,loudnorm=I=-21:TP=-2:LRA=11,aresample=44100',
                                    '-ac', '1', '-b:a', '128k', os.path.join(folder, '%s%s.mp3' % (name, letter))], check=True)
            open(os.path.join(folder, 'standin.txt'), 'w').write(
                'Stand-in voice: %s.\nMade by tools/standin_voice/make_standin.py until Momo records this question.\n'
                'When her clips arrive: delete these three .mp3 files and this note, put hers here, rebuild.\n' % label)
            done += 1
            print('voiced', name, flush=True)
    print(done, 'question(s) voiced with', label)


if __name__ == '__main__':
    main()
