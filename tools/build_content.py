"""Builds the questions into web/q/ and web/js/content.js from the folders in source/ (see tools/content_map.json).
Each question: the picture (resized), the three voice clips, and the answer + wording from the quiz .md file.
The owner's recording scripts (the "script" .txt files in content_map.json, "# --- QUESTION n ---" blocks) are what
Momo actually says, so their wording, choices and answer win over the quiz .md table; a different answer is reported.
v2.0.0: tools/picture_spots.json says where each answer is drawn in the picture (so the child can tap it there); every
question must be listed in it ({} = no answers drawn), its boxes must fit the picture and not overlap another letter's.
Public app (2026-11-10): four levels (Easy, Normal, Hard, Expert) instead of characters; the 8 characters only bring
the videos. A folder without all 3 clips is skipped (reported), a folder with standin.txt has stand-in voice clips.
web/js/voice-env.js: every clip's loudness, for Momo's heart in the top bar.
Usage: python3 -I tools/build_content.py [--check]   (--check: report only, write nothing)"""
import glob, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'source')
WEB = os.path.join(ROOT, 'web')
CHECK = '--check' in sys.argv


def parse_quiz(path):
    """{number: {'say','options':[...],'answer':'A','why'}} from the markdown tables."""
    out, header = {}, None
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line.startswith('|'):
            header = None if not line else header
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if cells and cells[0] == '#':
            header = [c.lower() for c in cells]
            continue
        if header is None or not cells or not cells[0].isdigit():
            continue
        row = dict(zip(header, cells))
        letters = [h for h in header if h in ('a', 'b', 'c')]
        unq = lambda s: s.replace('\\_', '_').replace('\\[', '[').replace('\\]', ']').strip().strip('"').strip()
        out[int(cells[0])] = {
            'say': unq(row.get('momo says', '')),
            'options': [unq(row[h]) for h in letters],
            'answer': row.get('answer', '').strip().upper(),
            'why': unq(next((v for k, v in row.items() if k.startswith("momo's")), '')),
        }
    return out


def parse_script(path):
    """{number: {'say','options','answer','why'}} from a recording script:
         # --- QUESTION 4 ---
         Momo: Sing along! ... Is it... Option A: C, Option B: B, or Option C: D?      (or "A: 5, B: 6, or C: 7?")
         Correct Feedback: Yes! You got it! A, B, C! B comes right after A.
         Wrong Feedback: Good try! The answer is Option B. A, B, C! ..."""
    text = open(path, encoding='utf-8').read()
    parts = re.split(r'^#\s*-+\s*QUESTION\s+(\d+)\s*-+\s*$', text, flags=re.M)
    out = {}
    for i in range(1, len(parts), 2):
        body = parts[i + 1]
        line = lambda key: (re.search(r'^' + key + r':\s*(.*?)\s*$', body, re.M | re.I) or [None, ''])[1]
        momo, right, wrong = line('Momo'), line('Correct Feedback'), line('Wrong Feedback')
        bits = re.split(r'(?:\bOption\s+|(?<![\w/]))([ABC]):\s*', momo)
        say = re.sub(r'\s*Is it\.*\s*$', '', bits[0].strip()).strip().strip('"').strip()
        # each choice but the last ends with ", " or ", or "; the last with the line's "?". Only that comes off: the
        # punctuation questions' choices are "I like cake." and "?" themselves.
        vals = bits[2::2]
        options = [re.sub(r'\s*,\s*(or\s*)?$', '', v.strip()) for v in vals[:-1]]
        options += [re.sub(r'\s*\?\s*"?\s*$', '', vals[-1].strip())] if vals else []
        letters = bits[1::2]
        m = re.search(r'\bOption\s+([ABC])\b', wrong) or re.search(r'answer is\s+([ABC])\b', wrong)
        if letters != ['A', 'B', 'C'][:len(letters)] or len(options) < 2 or not m:
            out[int(parts[i])] = None          # reported by the caller
            continue
        why = re.sub(r'^\s*(yes|yay)[!,.]?\s*(you got it|you found it)?[!,.]?\s*', '', right, flags=re.I).strip()
        out[int(parts[i])] = {'say': say, 'options': options, 'answer': m.group(1), 'why': why}
    return out


def load_set(st, problems):
    """The quiz table for a set, with the recording script's wording on top (see the module notes)."""
    qpath = os.path.join(SRC, st['quiz'])
    quiz = parse_quiz(qpath) if os.path.exists(qpath) else {}
    if not quiz:
        problems.append('missing or empty quiz file: ' + st['quiz'])
    if st.get('script'):
        spath = os.path.join(SRC, st['script'])
        script = parse_script(spath) if os.path.exists(spath) else {}
        if not script:
            problems.append('missing or empty script: ' + st['script'])
        for n, q in script.items():
            if q is None:
                problems.append('%s: question %d could not be read' % (st['script'], n)); continue
            old = quiz.get(n)
            if old and old['answer'] != q['answer']:
                print('NOTE   %s #%d: the script says %s, the quiz table %s (using the script)' % (st['id'], n, q['answer'], old['answer']))
            quiz[n] = q
    return quiz


def find_folders(prefix):
    """{number: folder} for source/'<prefix> <n>' (case-insensitive, extra spaces ok)."""
    found = {}
    pat = re.compile(r'^' + r'\s+'.join(map(re.escape, prefix.split())) + r'\s+(\d+)$', re.I)
    for d in sorted(os.listdir(SRC)):
        m = pat.match(d.strip())
        if m and os.path.isdir(os.path.join(SRC, d)):
            found[int(m.group(1))] = os.path.join(SRC, d)
    return found


def clip(folder, letter):
    hits = [f for f in glob.glob(os.path.join(folder, '*.mp3')) if os.path.splitext(f)[0].lower().endswith(letter)]
    return hits[0] if len(hits) == 1 else None


def picture(folder):
    hits = [f for f in glob.glob(os.path.join(folder, '*')) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
    return hits[0] if len(hits) == 1 else None


def save_pic(src, dst, maxw=1600):
    from PIL import Image
    im = Image.open(src)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg
    im = im.convert('RGB')
    if max(im.size) > maxw:
        k = maxw / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    im.save(dst, quality=86, optimize=True, progressive=True)
    return im.size


def check_spots(qid, spots, options, problems):
    """The picture's answer boxes for one question: letters it has, inside 0-100, different letters never overlapping."""
    letters = 'ABC'[:len(options)]
    if not isinstance(spots, dict):
        problems.append('%s: picture_spots must be {letter: [[left, top, right, bottom], ...]}' % qid); return
    for L, boxes in spots.items():
        if L not in letters:
            problems.append('%s: picture_spots has %s but the question only has %s' % (qid, L, letters))
        if not isinstance(boxes, list) or not boxes:
            problems.append('%s: picture_spots %s needs at least one box' % (qid, L)); continue
        for b in boxes:
            if not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)
                    and 0 <= b[0] < b[2] <= 100 and 0 <= b[1] < b[3] <= 100):
                problems.append('%s: picture_spots %s box %r is not [left, top, right, bottom] inside 0-100' % (qid, L, b))
    keys = sorted(spots)
    for i, L1 in enumerate(keys):
        for L2 in keys[i + 1:]:
            for a in spots[L1]:
                for b in spots[L2]:
                    if len(a) == 4 and len(b) == 4 and a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                        problems.append('%s: picture_spots %s %r overlaps %s %r' % (qid, L1, a, L2, b))


def envelopes(paths):
    """{web path: base64 of the clip's loudness, 60 bytes a second (0-100)} for Momo's heart; cached by file hash."""
    import base64, hashlib
    sys.path.insert(0, os.path.join(ROOT, 'tools', 'momo_light'))
    from make_preview import envelope
    cache_path = os.path.join(ROOT, 'build', 'envelopes.json')
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    out = {}
    for web_path, src in paths:
        k = hashlib.sha1(open(src, 'rb').read()).hexdigest()
        if k not in cache:
            cache[k] = base64.b64encode(bytes(envelope(src))).decode('ascii')
        out[web_path] = cache[k]
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    json.dump(cache, open(cache_path, 'w'))
    return out


def main():
    cmap = json.load(open(os.path.join(ROOT, 'tools', 'content_map.json'), encoding='utf-8'))
    allspots = json.load(open(os.path.join(ROOT, 'tools', 'picture_spots.json'), encoding='utf-8'))
    allspots.pop('_about', None)
    used = set()
    problems, total, standin = [], 0, 0
    clips = []                                   # (web path, source file) of every voice clip, for the heart
    qroot = os.path.join(WEB, 'q')
    if not CHECK:
        shutil.rmtree(qroot, ignore_errors=True)
    levels = []
    for lv in cmap['levels']:
        sets = []
        for st in lv['sets']:
            quiz = load_set(st, problems)
            qs = []
            remap = {int(k): int(v) for k, v in st.get('numbers', {}).items()}
            for fn, folder in sorted(find_folders(st['folder_prefix']).items()):
                n = remap.get(fn, fn)          # the quiz question this folder holds
                q = quiz.get(n)
                pic, a, b, c = picture(folder), clip(folder, 'a'), clip(folder, 'b'), clip(folder, 'c')
                name = os.path.basename(folder)
                if not q:
                    problems.append('%s: no question #%d in %s' % (name, n, st['quiz'])); continue
                if not (pic and a and b and c):
                    print('skip   %s: picture=%s a=%s b=%s c=%s (a question needs its picture and all 3 clips)' % (name, bool(pic), bool(a), bool(b), bool(c)))
                    continue
                if q['answer'] not in 'ABC'[:len(q['options'])] or not q['answer']:
                    problems.append('%s: bad answer letter %r' % (name, q['answer'])); continue
                qid = '%s-%s-%02d' % (lv['id'], st['id'], n)
                if qid not in allspots:
                    problems.append('%s (%s): not in tools/picture_spots.json; mark where its answers are drawn in the picture ({} if they are not)' % (qid, name)); continue
                spots = allspots[qid]; used.add(qid)
                check_spots(qid, spots, q['options'], problems)
                stand = os.path.exists(os.path.join(folder, 'standin.txt'))
                standin += stand
                rel = 'q/%s/' % qid
                size = [0, 0]
                if not CHECK:
                    os.makedirs(os.path.join(WEB, rel), exist_ok=True)
                    size = list(save_pic(pic, os.path.join(WEB, rel, 'pic.jpg')))
                    for letter, f in (('a', a), ('b', b), ('c', c)):
                        shutil.copyfile(f, os.path.join(WEB, rel, letter + '.mp3'))
                        clips.append((rel + letter + '.mp3', f))
                qs.append({'id': qid, 'n': n, 'pic': rel + 'pic.jpg', 'w': size[0], 'h': size[1],
                           'ask': rel + 'a.mp3', 'right': rel + 'b.mp3', 'wrong': rel + 'c.mp3',
                           'answer': q['answer'], 'options': q['options'], 'say': q['say'], 'why': q['why'],
                           'spots': spots, 'standin': stand})
                total += 1
            sets.append({'id': st['id'], 'title': st['title'], 'icon': st.get('icon', ''), 'questions': qs})
            print('%-6s %-10s %2d question(s)%s' % (lv['id'], st['id'], len(qs), ': quiz #' + ', #'.join(str(x['n']) for x in qs) if qs else ''))
        levels.append({'id': lv['id'], 'label': lv['label'], 'bars': lv['bars'], 'sets': sets})
    chars = [{'id': ch['id'], 'alt': ch['alt'], 'image': 'img/char/%s.jpg' % ch['id'],
              'correctVideo': 'media/%s-correct.mp4' % ch['id'], 'wrongVideo': 'media/%s-incorrect.mp4' % ch['id']}
             for ch in cmap['characters']]
    for ch in chars:
        for f in (ch['image'], ch['correctVideo'], ch['wrongVideo']):
            if not os.path.exists(os.path.join(WEB, f)):
                problems.append('%s is missing: run tools/make_assets.py' % f)
    for k in sorted(set(allspots) - used):
        print('note: tools/picture_spots.json has %s, which is not a question (yet)' % k)
    marked = sum(1 for lv in levels for s in lv['sets'] for q in s['questions'] if q['spots'])
    print('%d question(s) with their answers marked in the picture' % marked)
    print('%d question(s) with the stand-in voice' % standin)
    for p in problems:
        print('PROBLEM:', p)
    print('%d question(s) total' % total)
    if not CHECK:
        with open(os.path.join(WEB, 'js', 'content.js'), 'w', encoding='utf-8') as f:
            f.write('// Built by tools/build_content.py from source/ — do not edit by hand.\nwindow.MOMO_CONTENT = ')
            json.dump({'levels': levels, 'characters': chars, 'standin': standin, 'standinVoice': cmap.get('standin_voice', '')}, f, ensure_ascii=False, indent=1)
            f.write(';\n')
        env = envelopes(clips)
        with open(os.path.join(WEB, 'js', 'voice-env.js'), 'w', encoding='utf-8') as f:
            f.write('// Built by tools/build_content.py: how loud each voice clip is, 60 bytes a second (0-100), so Momo\'s heart\n'
                    '// pulses with her words. Do not edit by hand.\nwindow.MOMO_ENV = ')
            json.dump(env, f, separators=(',', ':'))
            f.write(';\n')
        print('%d clip envelope(s) for the heart' % len(env))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
