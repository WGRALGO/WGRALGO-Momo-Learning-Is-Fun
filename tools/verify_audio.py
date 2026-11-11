"""Checks that each question folder's voice clips are the quiz question the app will use (tools/content_map.json):
transcribes every a.mp3 / b.mp3 / c.mp3 with Whisper (Yip Yappers Pro's faster-whisper, on this PC) and compares them
with the quiz wording (the .md table, with the owner's recording script on top). Prints, per folder, the best-matching quiz question and the "numbers" fix if it differs.
Also checks that b sounds like the correct line ("Yes...") and c like the wrong line ("Good try... the answer is X").
Usage: tools/verify_audio.py            (transcripts are cached in build/transcripts.json)"""
import difflib, hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'source')
PY = os.path.expanduser('~/YipYappersPro/app/.venv/bin/python')
MODEL = os.path.expanduser('~/YipYappersPro/models/voxtts/models/whisper-small')
CACHE = os.path.join(ROOT, 'build', 'transcripts.json')
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from build_content import load_set, find_folders, clip  # noqa: E402

WORDS = {'1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten'}


def norm(s):
    s = re.sub(r'/([a-z]+)/', r'\1', s.lower())
    toks = re.findall(r"[a-z0-9']+", s)
    return ' '.join(WORDS.get(t, t) for t in toks if t not in ('option', 'is', 'it', 'or'))


def sim(a, b):
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def transcribe(files):
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    todo = []
    keys = {}
    for f in files:
        k = hashlib.sha1(open(f, 'rb').read()).hexdigest(); keys[f] = k
        if k not in cache:
            todo.append(f)
    if todo:
        if not (os.path.exists(PY) and os.path.isdir(MODEL)):
            sys.exit('Whisper not found (%s, %s)' % (PY, MODEL))
        code = ('import sys,json\nfrom faster_whisper import WhisperModel\nm=WhisperModel(sys.argv[1],device="cpu",compute_type="int8")\n'
                'for f in sys.argv[2:]:\n segs,_=m.transcribe(f,language="en",beam_size=5)\n print(json.dumps([f," ".join(s.text.strip() for s in segs)]),flush=True)\n')
        out = subprocess.run([PY, '-I', '-c', code, MODEL] + todo, capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            if line.startswith('['):
                f, t = json.loads(line); cache[keys[f]] = t
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(cache, open(CACHE, 'w'), indent=1)
    return {f: cache[keys[f]] for f in files}


def main():
    cmap = json.load(open(os.path.join(ROOT, 'tools', 'content_map.json'), encoding='utf-8'))
    jobs = []
    for lv in cmap['levels']:
        for st in lv['sets']:
            quiz = {k: v for k, v in load_set(st, []).items() if v}     # the quiz table + the recording script
            if not quiz:
                continue
            remap = {int(k): int(v) for k, v in st.get('numbers', {}).items()}
            for fn, folder in sorted(find_folders(st['folder_prefix']).items()):
                if not any(clip(folder, x) for x in 'abc'):
                    print('wait %-12s picture only (no voice clips yet)' % os.path.basename(folder)); continue
                jobs.append(('', lv['id'], st['id'], quiz, fn, remap.get(fn, fn), folder))
    files = [c for j in jobs for c in (clip(j[6], 'a'), clip(j[6], 'b'), clip(j[6], 'c')) if c]
    text = transcribe(files)
    bad = 0
    for cid, mid, sid, quiz, fn, n, folder in jobs:
        a, b, c = clip(folder, 'a'), clip(folder, 'b'), clip(folder, 'c')
        if not (a and b and c):
            print('FAIL %-20s missing a/b/c clip' % os.path.basename(folder)); bad += 1; continue
        ask = text[a]
        best = max(quiz, key=lambda k: sim(ask, quiz[k]['say'] + ' ' + ' '.join(quiz[k]['options'])))
        score = sim(ask, quiz[best]['say'] + ' ' + ' '.join(quiz[best]['options']))
        q = quiz.get(n)
        notes = []
        if best != n:
            notes.append('question clip matches quiz #%d, not #%d -> set "numbers": {"%d": %d}' % (best, n, fn, best))
        if q:
            if not re.match(r'\s*yes|\s*yay', text[b], re.I):
                notes.append('b clip does not start with "Yes": %r' % text[b][:60])
            if not re.match(r'\s*(good try|oops)', text[c], re.I):
                notes.append('c clip does not start with "Good try": %r' % text[c][:60])
            if sim(text[b], q['why']) < 0.45:
                notes.append('b clip does not sound like the why line (%.2f)' % sim(text[b], q['why']))
            m = re.search(r'answer is (?:option )?([abc])\b', text[c], re.I)
            if m and m.group(1).upper() != q['answer']:
                notes.append('c clip says the answer is %s, quiz says %s' % (m.group(1).upper(), q['answer']))
        status = 'FAIL' if notes else 'ok  '
        bad += bool(notes)
        print('%s %-12s -> %s %s #%d (match %.2f)%s' % (status, os.path.basename(folder), mid, sid, n, score, ''.join('\n       ' + x for x in notes)))
    print('%d folder(s), %d problem(s)' % (len(jobs), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
