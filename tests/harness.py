#!/usr/bin/python3
"""The public Momo app (ages 2-7). UI tests in WebKitGTK (the engine of the Linux app), at phone and tablet sizes, portrait and landscape.
Usage: python3 tests/harness.py [--sizes all|phone] [--media] [--web DIR]
  default: every size, fast media (clips "play" for a moment), screenshots in tests/shots/<w>x<h>-*.png
  --media: one run with real playback (the intro, the characters' videos, Momo's clips, her heart and Replay)
Inside the Claude sandbox set WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1."""
import json
import os
import re
import sys
import time

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
args = sys.argv[1:]
WEB = os.path.realpath(args[args.index('--web') + 1]) if '--web' in args else os.path.join(ROOT, 'web')
SHOTS = os.path.join(HERE, 'shots')
os.makedirs(SHOTS, exist_ok=True)
SIZES = [(360, 640), (412, 915), (740, 360), (915, 412), (600, 960), (800, 1280), (1280, 800), (1024, 600), (1920, 1080)]
if '--sizes' in args and args[args.index('--sizes') + 1] == 'phone':
    SIZES = [(412, 915)]

results = []


def ring_layout():
    """v1.2: the 8 characters and the heart as the intro video draws them (tools/intro/intro.html + tools/make_intro.py),
    read from those files so the tap checks follow the video, not the app's copy of the numbers."""
    h = open(os.path.join(ROOT, 'tools', 'intro', 'intro.html'), encoding='utf-8').read()
    mi = open(os.path.join(ROOT, 'tools', 'make_intro.py'), encoding='utf-8').read()
    W, H = map(int, re.search(r'<canvas id="c" width="(\d+)" height="(\d+)"', h).groups())
    m = re.search(r"'pops': \[LEAD \+ ([\d.]+) \+ i \* ([\d.]+) for i in range\(8\)\]", mi)
    return {'w': W, 'h': H, 'rx': float(re.search(r'Math\.cos\(a\) \* (\d+)', h).group(1)),
            'ry': float(re.search(r'Math\.sin\(a\) \* (\d+)', h).group(1)), 'card': int(re.search(r'var S = (\d+)', h).group(1)),
            'heartR0': int(re.search(r'R0: (\d+)', h).group(1)),
            'lead': float(re.search(r'FPS, LEAD, TAIL = \d+, ([\d.]+),', mi).group(1)), 'first': float(m.group(1)), 'step': float(m.group(2))}


RING = ring_layout()
# ringXY(i): where character i sits on the screen (i = -1: the heart); skyXY(k): spots on the video that are neither
RING_JS = """const L = %s;
  const vr = () => document.getElementById('intro').getBoundingClientRect();
  const toScreen = (x, y) => { const r = vr(), s = Math.max(r.width / L.w, r.height / L.h); return [r.left + (r.width - L.w * s) / 2 + x * s, r.top + (r.height - L.h * s) / 2 + y * s]; };
  const ringXY = (i) => { if (i < 0) return toScreen(L.w / 2, L.h / 2); const a = -Math.PI / 2 + i * Math.PI / 4; return toScreen(L.w / 2 + Math.cos(a) * L.rx, L.h / 2 + Math.sin(a) * L.ry); };
  const skyXY = (k) => toScreen(...[[L.w * 0.1, L.h * 0.92], [L.w * 0.68, L.h / 2], [L.w * 0.9, L.h * 0.08]][k]);
  const tapAt = (xy) => { const el = document.elementFromPoint(xy[0], xy[1]);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: xy[0], clientY: xy[1], detail: 1 })); return el.id; };
""" % json.dumps(RING)


def intro_layout_check():
    app = open(os.path.join(WEB, 'js', 'app.js'), encoding='utf-8').read()
    m = re.search(r'var RING = \{ w: (\d+), h: (\d+), rx: (\d+), ry: (\d+), half: (\d+), heart: (\d+), pops: \[\] \};\s*'
                  r'for \(var ri = 0; ri < 8; ri\+\+\) RING\.pops\.push\(([\d.]+) \+ ([\d.]+) \+ ri \* ([\d.]+) \+ ([\d.]+)\);', app)
    got = m and [int(m.group(k)) for k in range(1, 7)] + [float(m.group(k)) for k in range(7, 11)]
    ok('intro taps: the app\'s ring follows the video (frame, ellipse, card size, heart, pop times)',
       got and got[:4] == [RING['w'], RING['h'], RING['rx'], RING['ry']] and RING['card'] / 2 + 7 <= got[4] <= RING['card'] / 2 + 25
       and RING['heartR0'] < got[5] < RING['ry'] - got[4] and got[6:9] == [RING['lead'], RING['first'], RING['step']] and 0 < got[9] <= 0.3,
       {'app': got, 'video': RING})


def ok(name, cond, info=''):
    results.append((name, bool(cond), info))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(info) if info else ''), flush=True)


HELPERS = r"""
window.T = {
  wait: async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { try { if (fn()) return Date.now() - t0; } catch (e) {} await new Promise(r => setTimeout(r, 40)); } throw new Error('timeout: ' + (what || fn)); },
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  click: (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) throw new Error('no ' + sel); e.click(); return true; },
  // every visible thing on the screen: inside the window, not overlapping each other
  fit: (sels) => {
    const W = innerWidth, H = innerHeight, out = [], boxes = [];
    for (const s of sels) for (const e of document.querySelectorAll(s)) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) { out.push(s + ' has no size'); continue; }
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(s + ' outside ' + JSON.stringify([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]) + ' of ' + W + 'x' + H);
      boxes.push([s, r]);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i][1], b = boxes[j][1];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2 && !(boxes[i][0] === '.tick' || boxes[j][0] === '.tick')) out.push(boxes[i][0] + ' overlaps ' + boxes[j][0]);
    }
    if (document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1) out.push('page scrolls ' + document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight);
    return out;
  },
  area: (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return Math.round(r.width * r.height); },
  // v2.0, the answers drawn in the picture: a place on the picture (percent of it) → [x, y] on the screen
  picXY: (px, py) => { const r = document.getElementById('qPic').getBoundingClientRect(); return [r.left + r.width * px / 100, r.top + r.height * py / 100]; },
  // the middle of one of an answer's boxes (tools/picture_spots.json) for the question on screen
  spotXY: (L, i) => { const b = MOMO.question().spots[L][i || 0]; return T.picXY((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); },
  // a place on the picture that is no answer, as near the middle as there is one
  offSpotXY: () => {
    const q = MOMO.question(); let best = null;
    for (let y = 4; y <= 96; y += 2) for (let x = 4; x <= 96; x += 2) {
      if (MOMO.spotAt(q, x, y) || MOMO.spotAt(q, x - 2, y) || MOMO.spotAt(q, x + 2, y) || MOMO.spotAt(q, x, y - 2) || MOMO.spotAt(q, x, y + 2)) continue;
      const d = (x - 50) ** 2 + (y - 50) ** 2; if (!best || d < best[2]) best = [x, y, d];
    }
    return T.picXY(best[0], best[1]);
  },
  // a tap where a finger lands: the click goes to whatever is on top at that point, with its place on the screen
  tapAt: (xy) => {
    const e = document.elementFromPoint(xy[0], xy[1]); if (!e) throw new Error('nothing at ' + xy);
    e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: xy[0], clientY: xy[1], view: window }));
    return e.id || e.className;
  },
  rect: (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; },
};
"""


class HiddenWindow(Gtk.Window):
    """A real window that can't be seen: WebKit only starts media in a page that is really on screen (an offscreen
    window never is), so the real-playback checks use this. Its sound goes to a silent test device."""
    def __init__(self):
        super().__init__()
        self.set_opacity(0.0); self.set_skip_taskbar_hint(True); self.set_skip_pager_hint(True)
        self.set_keep_below(True); self.set_accept_focus(False); self.set_decorated(False)


class SilentSink:
    """A temporary PulseAudio/PipeWire null sink, so the media checks make no sound (removed afterwards)."""
    def __enter__(self):
        import subprocess
        self.mod = None
        try:
            self.mod = subprocess.run(['pactl', 'load-module', 'module-null-sink', 'sink_name=momo_test', 'sink_properties=device.description=MomoTest'],
                                      capture_output=True, text=True, check=True).stdout.strip()
            os.environ['PULSE_SINK'] = 'momo_test'
        except (OSError, subprocess.CalledProcessError):
            print('note: no pactl, the media checks will be audible')
        return self

    def __exit__(self, *a):
        import subprocess
        os.environ.pop('PULSE_SINK', None)
        if self.mod:
            subprocess.run(['pactl', 'unload-module', self.mod], check=False)


class Page:
    def __init__(self, w, h, fast=True, real=False):
        self.w, self.h = w, h
        ucm = WebKit2.UserContentManager()
        pre = ('window.__MOMO_FAST = true;' if fast else '') + HELPERS
        ucm.add_script(WebKit2.UserScript.new(pre, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
        policies = WebKit2.WebsitePolicies(autoplay=WebKit2.AutoplayPolicy.ALLOW)
        dm = WebKit2.WebsiteDataManager.new_ephemeral()
        ctx = WebKit2.WebContext.new_with_website_data_manager(dm)
        self.view = WebKit2.WebView(web_context=ctx, user_content_manager=ucm, website_policies=policies)
        s = self.view.get_settings()
        s.set_enable_media(True); s.set_media_playback_requires_user_gesture(False); s.set_allow_file_access_from_file_urls(True)
        self.win = HiddenWindow() if real else Gtk.OffscreenWindow()
        self.win.add(self.view)
        self.view.set_size_request(w, h)
        self.win.resize(w, h)
        self.win.show_all()
        self.view.load_uri('file://' + os.path.join(WEB, 'index.html'))
        self.spin(lambda: not self.view.is_loading(), 15)

    def spin(self, done=None, seconds=0.5):
        t0 = time.time()
        while time.time() - t0 < seconds:
            while Gtk.events_pending():
                Gtk.main_iteration_do(False)
            if done and done():
                return True
            time.sleep(0.01)
        return False

    def js(self, body, timeout=30):
        """Runs an async function body; returns its value (JSON) or raises."""
        box = {}

        def cb(v, res, _):
            try:
                val = v.call_async_javascript_function_finish(res)
                box['v'] = json.loads(val.to_json(0) or 'null') if not val.is_undefined() else None
            except GLib.Error as e:
                box['e'] = e.message
        self.view.call_async_javascript_function(body, -1, None, None, None, None, cb, None)
        if not self.spin(lambda: box, timeout):
            raise RuntimeError('js timeout: ' + body[:80])
        if 'e' in box:
            raise RuntimeError(box['e'])
        return box.get('v')

    def resize(self, w, h):
        self.w, self.h = w, h
        self.view.set_size_request(w, h); self.win.resize(w, h); self.spin(None, 0.4)

    def shot(self, name):
        box = {}

        def cb(v, res, _):
            box['s'] = v.get_snapshot_finish(res)
        self.view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, cb, None)
        self.spin(lambda: box, 10)
        if 's' in box:
            box['s'].write_to_png(os.path.join(SHOTS, '%dx%d-%s.png' % (self.w, self.h, name)))

    def close(self):
        self.win.destroy()
        self.spin(None, 0.1)


# what the content holds now (update when questions are added: tools/build_content.py prints the counts)
EXPECT = {'easy': 8, 'hard': {'words': 50, 'math': 32, 'science': 50}}
STANDIN = 64          # questions with the stand-in voice (credits line)
HARD_ALL = sum(EXPECT['hard'].values())

SCREEN_PARTS = {
    'home': ['.home-top', '#introCard', '.friend'],
    'mode': ['#mode .back', '#modeTitle', '#mode .mix', '#mode .hero', '.mode-btn'],
    'name': ['#name .back', '.name-hero', '#nameInput', '#nameGo', '#nameSkip'],
    'subjects': ['#subjects .back', '#subjTitle', '#subjects .mix', '.tile'],
    'quiz': ['#quiz .back', '#dots', '#hearAgain', '#qPic', '.ans'],
    'done': ['.done-hero', '#doneTitle', '#stars', '#doneScore', '#done .pill'],
}


def check_fit(p, screen, label, parts=None):
    bad = p.js('return T.fit(%s);' % json.dumps([s for s in (parts or SCREEN_PARTS[screen]) if s]))
    ok('%dx%d %s fits' % (p.w, p.h, label), not bad, '; '.join(bad[:4]))


def flow(w, h):
    p = Page(w, h)
    tag = '%dx%d' % (w, h)
    try:
        p.js("await T.wait(() => MOMO.state.screen === 'home', 8000, 'home'); await T.sleep(400); return true;")
        check_fit(p, 'home', 'home')
        hm = p.js("""return { n: document.querySelectorAll('.friend').length, ids: [...document.querySelectorAll('.friend')].map(b => b.getAttribute('data-char')),
                    text: [...document.querySelectorAll('.friend')].map(b => b.textContent.trim()).join(''), alts: [...document.querySelectorAll('.friend img')].every(i => i.alt.length > 3),
                    ages: document.getElementById('ages').textContent, credits: getComputedStyle(document.getElementById('creditsBtn')).display !== 'none',
                    intro: T.area('#introCard') / (innerWidth * innerHeight), pic: T.area('.friend') / (innerWidth * innerHeight),
                    square: [...document.querySelectorAll('.friend')].every(b => Math.abs(b.offsetWidth - b.offsetHeight) <= 1) };""")
        ok(tag + ' home: the 8 characters, pictures only (no names)', hm['n'] == 8 and hm['text'] == '' and hm['alts'] and hm['square'] and hm['ids'] == ['dove', 'elephant', 'dog', 'sphinx', 'cane', 'ivy', 'duck', 'lion'], hm)
        ok(tag + ' home: "For ages 2-7" and Credits', hm['ages'] == 'For ages 2–7' and hm['credits'], hm['ages'])
        ok(tag + ' home: the intro and the characters are big', hm['intro'] > 0.08 and hm['pic'] > 0.012, 'intro %.0f%%, each character %.1f%% of the window' % (100 * hm['intro'], 100 * hm['pic']))
        # v1.2: the intro's ring (the poster shows all 8 before it plays): a tap on a character picks it, the heart is the heart
        it = p.js(RING_JS + """
          const hits = [...Array(8)].map((_, i) => MOMO.introSpot(...ringXY(i))), heart = MOMO.introSpot(...ringXY(-1));
          const sky = [0, 1, 2].map((k) => MOMO.introSpot(...skyXY(k)));
          const el = tapAt(ringXY(3)); await T.wait(() => MOMO.state.screen === 'mode', 3000, 'levels after the ring tap');
          const ch = MOMO.state.char.id; MOMO.back(); await T.wait(() => MOMO.state.screen === 'home'); await T.sleep(250);
          const skyEl = tapAt(skyXY(1)); await T.sleep(250);
          return { hits, heart, sky, el, ch, after: MOMO.state.screen, skyEl };""")
        ok(tag + ' intro: a tap on each of the 8 in the ring picks it (sphinx → levels), the middle is the heart, the sky does nothing',
           it['hits'] == list(range(8)) and it['heart'] == 'heart' and it['sky'] == [None, None, None] and it['el'] == 'intro'
           and it['ch'] == 'sphinx' and it['after'] == 'home' and it['skyEl'] == 'intro', it)
        p.shot('1-home')
        # the dove → the 4 levels with their bars
        p.js("T.click('.friend[data-char=dove]'); await T.wait(() => MOMO.state.screen === 'mode'); await T.sleep(300); return true;")
        check_fit(p, 'mode', 'levels')
        lv = p.js("""return [...document.querySelectorAll('.mode-btn')].map(b => [b.querySelector('.big').textContent, b.querySelectorAll('.bars i.on').length, b.querySelectorAll('.bars i').length, !!b.querySelector('.ribbon')]);""")
        ok(tag + ' levels: Easy, Normal, Hard, Expert with 1-4 bars; Normal and Expert coming soon', lv == [['Easy', 1, 4, False], ['Normal', 2, 4, True], ['Hard', 3, 4, False], ['Expert', 4, 4, True]], lv)
        bars = p.js("return [...document.querySelectorAll('.mode-btn.expert .bars i')].map(i => Math.round(i.getBoundingClientRect().height));")
        ok(tag + ' the bars rise (each taller than the last)', all(bars[i] < bars[i + 1] for i in range(3)) and bars[0] > 4, bars)
        hero = p.js("return [document.getElementById('modeHero').getAttribute('src'), document.getElementById('modeTitle').scrollWidth <= document.getElementById('modeTitle').clientWidth + 1];")
        ok(tag + ' levels: the dove is shown, the title is not cut', hero == ['img/char/dove.jpg', True], hero)
        m = p.js("const b = document.querySelector('#mode .mix'); return [MOMO.settings.mix, b.getAttribute('aria-pressed'), b.classList.contains('on')];")
        ok(tag + ' Mix up starts off (questions in order)', m == [False, 'false', False], m)
        p.shot('2-levels')
        for lvl in ('normal', 'expert'):
            t = p.js("T.click('.mode-btn.%s'); await T.sleep(100); return [MOMO.state.screen, document.getElementById('toast').textContent, document.getElementById('toast').classList.contains('show')];" % lvl)
            ok(tag + ' %s says coming soon' % lvl, t == ['mode', lvl.title() + ' is coming soon!', True], t)
        # Easy → the name (typed) → straight to the toddler questions (one pack)
        p.js("T.click('.mode-btn.easy'); await T.wait(() => MOMO.state.screen === 'name'); await T.sleep(300); return true;")
        check_fit(p, 'name', 'name')
        nm = p.js("return [document.getElementById('nameInput').value, document.getElementById('nameHero').getAttribute('src')];")
        ok(tag + ' name: an empty box, the dove beside it', nm == ['', 'img/char/dove.jpg'], nm)
        p.shot('3-name')
        p.js("const i = document.getElementById('nameInput'); i.value = '  ava-mae 2 <b> '; i.dispatchEvent(new Event('input')); T.click('#nameGo'); await T.wait(() => MOMO.phase() === 'asking'); await T.sleep(250); return true;")
        k = p.js("const k = document.getElementById('kidName'); return [MOMO.state.kid, k.hidden, k.textContent.trim(), MOMO.question().id, document.querySelectorAll('.ans').length];")
        ok(tag + ' name: cleaned, capitalized and shown in the quiz bar; Easy goes straight to toddler question 1 (A, B)', k == ['Ava-Mae B', False, 'Ava-Mae B', 'easy-toddler-01', 2], k)
        check_fit(p, 'quiz', 'question', SCREEN_PARTS['quiz'] + ['#kidName'])
        # the heart: pulses while Momo asks; then the Replay arrow; a tap = the question again (also R)
        hb = p.js("""
          const b = document.getElementById('hearAgain'), out = {};
          await T.wait(() => !MOMO.playing(), 3000, 'clip ended'); b.click(); await T.sleep(5);
          out.talking = b.classList.contains('talking'); out.canvas = getComputedStyle(document.getElementById('heart')).display;
          out.heartOn = MOMO.heart() ? !MOMO.heart().off : null;
          await T.wait(() => !MOMO.playing(), 3000, 'clip ended'); await T.sleep(30);
          out.quiet = [b.classList.contains('talking'), getComputedStyle(b.querySelector('.again')).display, MOMO.heart() ? MOMO.heart().off : null, b.getAttribute('aria-label')];
          const seen = [];
          for (let i = 0; i < 3; i++) { await T.wait(() => !MOMO.playing(), 3000); b.click(); await T.sleep(10); seen.push([b.classList.contains('talking'), MOMO.playing() && MOMO.playing().src.split('/').slice(-2).join('/')]); }
          // a tap while she talks starts her over
          b.click(); const p1 = MOMO.playing(); b.click(); await T.sleep(5); const p2 = MOMO.playing();
          seen.push(['restart', p1 && p2 && p1.src === p2.src]);
          await T.wait(() => !MOMO.playing(), 3000); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })); await T.sleep(10);
          seen.push(['R', MOMO.playing() && MOMO.playing().src.split('/').pop()]);
          out.seen = seen; out.h = Math.round(b.getBoundingClientRect().height); return out;
        """)
        ok(tag + ' the heart shows and pulses while Momo asks', hb['talking'] and hb['canvas'] == 'block' and hb['heartOn'] is True, hb)
        ok(tag + ' when she finishes, the heart turns into the Replay arrow', hb['quiet'][0] is False and hb['quiet'][1] != 'none' and hb['quiet'][2] is True and hb['quiet'][3].startswith('Replay'), hb['quiet'])
        ok(tag + ' Replay (x3), a tap on the heart while she talks, and R: the question again', hb['seen'] == [[True, 'easy-toddler-01/a.mp3']] * 3 + [['restart', True], ['R', 'a.mp3']] and hb['h'] >= 44, hb['seen'])
        nud = p.js("await T.wait(() => !MOMO.playing(), 3000); await T.wait(() => document.getElementById('hearAgain').classList.contains('nudge'), 2000, 'nudge'); return true;")
        ok(tag + ' the Replay arrow wiggles when no answer comes', nud)
        off = p.js("""
          await T.wait(() => !MOMO.playing(), 3000, 'clip ended');
          const on = T.tapAt(T.offSpotXY()); await T.sleep(60);
          return [on, MOMO.phase(), MOMO.playing(), document.querySelectorAll('.ans.right, .ans.wrong, .ans.dim').length];
        """)
        ok(tag + ' a tap on the picture off its answers does nothing', off == ['qPic', 'asking', None, 0], off)
        p.shot('4-question')

        def answer(right, pic=False):
            return p.js("""
              const q = MOMO.question(); const pick = %s ? q.answer : ['A','B','C'].slice(0, q.options.length).find(L => L !== q.answer);
              const seen = [];
              const via = %s ? T.tapAt(T.spotXY(pick, 0)) : (T.click('.ans[data-letter=' + pick + ']'), 'button');
              const flash = document.querySelectorAll('.spot-flash').length;
              await T.wait(() => MOMO.phase() === 'video' || MOMO.phase() === 'line', 4000, 'feedback');
              await T.wait(() => MOMO.playing() && /mp4$/.test(MOMO.playing().src), 4000, 'video'); seen.push(MOMO.playing().src.split('/').pop());
              await T.wait(() => MOMO.playing() && /[bc]\\.mp3$/.test(MOMO.playing().src), 4000, 'line'); seen.push(MOMO.playing().src.split('/').pop());
              const talk = document.getElementById('hearAgain').classList.contains('talking');
              return { id: q.id, pick, answer: q.answer, seen, right: document.querySelector('.ans.right').getAttribute('data-letter'), n: q.options.length, via, flash, picked: MOMO.state.round.lastPick, talk };
            """ % ('true' if right else 'false', 'true' if pic else 'false'))

        def every(prefix, count):
            ids = []
            for k in range(count):
                info = p.js("""
                  await T.wait(() => MOMO.phase() === 'asking', 5000, 'asking'); const q = MOMO.question(); const img = document.getElementById('qPic');
                  await T.wait(() => img.complete && img.naturalWidth > 0 && img.getAttribute('src') === q.pic, 5000, 'picture');
                  await T.sleep(30);
                  const bad = T.fit(['#qPic', '.ans', '#dots', '#hearAgain', '#quiz .back']);
                  const prog = document.getElementById('dots').classList.contains('long') ? document.querySelector('.pcount').textContent : null;
                  const boxes = [], wrongBoxes = [], r = img.getBoundingClientRect();
                  for (const L of Object.keys(q.spots || {})) q.spots[L].forEach((b, i) => {
                    const xy = T.spotXY(L, i), e = document.elementFromPoint(xy[0], xy[1]);
                    const hit = MOMO.spotAt(q, 100 * (xy[0] - r.left) / r.width, 100 * (xy[1] - r.top) / r.height);
                    boxes.push(L);
                    if (!e || e.id !== 'qPic' || !hit || hit.letter !== L) wrongBoxes.push(L + (i + 1) + ' → ' + (e ? e.id || e.className : 'nothing') + '/' + (hit && hit.letter));
                  });
                  const letters = [...new Set(boxes)].sort().join('');
                  const via = q.spots && q.spots[q.answer] ? T.tapAt(T.spotXY(q.answer, 0)) : (T.click('.ans[data-letter=' + q.answer + ']'), 'button');
                  const flash = document.querySelectorAll('.spot-flash').length;
                  await T.wait(() => MOMO.phase() !== 'asking', 3000, 'answered');
                  return { id: q.id, w: img.naturalWidth, h: img.naturalHeight, bad, prog, marks: [...document.querySelectorAll('.ans .opt.mark')].map(o => parseFloat(getComputedStyle(o).fontSize)),
                           letters, n: q.options.length, wrongBoxes, via, flash, picked: MOMO.state.round.lastPick, answer: q.answer, right: document.querySelector('.ans.right') && document.querySelector('.ans.right').getAttribute('data-letter') };
                """)
                ok('%s %s%s picture loads and fits' % (tag, info['id'], ' (%s)' % info['prog'] if info['prog'] else ''), info['w'] > 0 and not info['bad'] and info['id'].startswith(prefix), [info['w'], info['h']] + info['bad'][:3])
                ok('%s %s: every answer in the picture can be tapped (%s); tapping %s there answers it' % (tag, info['id'], info['letters'], info['answer']),
                   (info['letters'] == 'ABC'[:info['n']] and not info['wrongBoxes'] and info['via'] == 'qPic' and info['flash'] == 1 and info['picked'] == info['answer'] and info['right'] == info['answer'])
                   or (info['letters'] == '' and info['via'] == 'button' and info['picked'] == info['answer']),
                   {k2: info[k2] for k2 in ('letters', 'wrongBoxes', 'via', 'flash', 'picked', 'right')})
                if info['id'].endswith('-words-44'):
                    ok(tag + ' words #44: the , ? . choices are shown big', len(info['marks']) == 3 and min(info['marks']) >= 26, info['marks'])
                ids.append(info['id'])
            return ids
        # Easy: "Tap the doggy!" tapped in the picture (right), question 2 missed, the rest right, then question 2 again
        e1 = answer(True, pic=True)
        ok(tag + ' right: the dove "correct" video, then Momo b line (her heart pulses)', e1['seen'] == ['dove-correct.mp4', 'b.mp3'] and e1['right'] == e1['answer'] and e1['talk'], e1)
        ok(tag + ' "Tap the doggy!": the dog tapped in the picture answers A', e1['id'] == 'easy-toddler-01' and e1['via'] == 'qPic' and e1['flash'] == 1 and e1['picked'] == 'A' == e1['answer'], e1)
        p.js("await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === 'easy-toddler-02', 4000, 'q2'); return true;")
        e2 = answer(False)
        ok(tag + ' wrong: the dove "incorrect" video, then the c line; no retry, the right answer is shown', e2['seen'] == ['dove-incorrect.mp4', 'c.mp3'] and e2['right'] == e2['answer'], e2)
        p.shot('5-after-wrong')
        rest = every('easy-toddler-', EXPECT['easy'] - 2)
        ok(tag + ' Easy: the rest in folder order (two 5-8 = #50, #49, #48, #47)', rest == ['easy-toddler-%02d' % n for n in (3, 4, 50, 49, 48, 47)], rest)
        p.js("await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === 'easy-toddler-02', 4000, 'q2 again'); return true;")
        e3 = answer(True)
        ok(tag + ' the missed question comes back once at the end (Easy too)', e3['id'] == 'easy-toddler-02' and e3['seen'] == ['dove-correct.mp4', 'b.mp3'], e3['id'])
        p.js("await T.wait(() => MOMO.state.screen === 'done', 5000, 'done'); await T.sleep(700); return true;")
        check_fit(p, 'done', 'stars (Easy)', ['.done-hero', '#doneTitle', '#stars', '#doneScore', '#againBtn', '#homeBtn'])
        d = p.js("return [document.getElementById('doneScore').textContent, document.getElementById('doneTitle').textContent, getComputedStyle(document.getElementById('moreBtn')).display, document.getElementById('doneHero').getAttribute('src')];")
        ok(tag + ' stars: 7 of 8, with the name, no Pick more (one pack)', d[0] == '%d of %d right on the first try' % (EXPECT['easy'] - 1, EXPECT['easy']) and d[1].endswith(', Ava-Mae B!') and d[2] == 'none' and d[3] == 'img/char/dove.jpg', d)
        p.shot('6-stars-easy')
        # Play again keeps the name; back: stars → levels → home
        a = p.js("T.click('#againBtn'); await T.wait(() => MOMO.phase() === 'asking'); const r = [MOMO.state.kid, document.getElementById('kidName').hidden]; MOMO.back(); return r.concat([MOMO.state.screen, MOMO.back(), MOMO.state.screen]);")
        ok(tag + ' Play again keeps the name; back: question → levels → home', a == ['Ava-Mae B', False, 'mode', True, 'home'], a)
        # the lion → Hard → Skip the name → subjects
        p.js("T.click('.friend[data-char=lion]'); await T.wait(() => MOMO.state.screen === 'mode'); T.click('.mode-btn.hard'); await T.wait(() => MOMO.state.screen === 'name'); return true;")
        nm = p.js("return document.getElementById('nameInput').value;")
        ok(tag + ' the name is asked fresh (never kept)', nm == '', nm)
        p.js("T.click('#nameSkip'); await T.wait(() => MOMO.state.screen === 'subjects'); await T.sleep(300); return true;")
        check_fit(p, 'subjects', 'subjects')
        tiles = p.js("return [document.getElementById('subjTitle').textContent].concat([...document.querySelectorAll('.tile')].map(b => b.getAttribute('data-set') + ':' + b.querySelector('.count').textContent));")
        want = ['Hard'] + ['%s:%d questions' % (k2, v) for k2, v in EXPECT['hard'].items()] + ['all:%d questions' % HARD_ALL]
        ok(tag + ' Hard subjects: ' + ', '.join(want[1:]), tiles == want, tiles)
        p.shot('7-subjects')
        p.js("T.click('.tile[data-set=words]'); await T.wait(() => MOMO.phase() === 'asking'); await T.sleep(250); return true;")
        k = p.js("return [MOMO.state.kid, document.getElementById('kidName').hidden, MOMO.question().id];")
        ok(tag + ' skipped name: no name chip; Words starts at question 1', k == ['', True, 'hard-words-01'], k)
        WORDS = p.js("return MOMO.content.levels[2].sets[0].questions.map(q => q.id);")
        h1 = answer(True)
        p.js("await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === '%s', 4000, 'q2'); return true;" % WORDS[1])
        h2 = answer(False)
        ok(tag + ' Hard with the lion: right = lion "correct" + b, wrong = lion "incorrect" + c', h1['seen'] == ['lion-correct.mp4', 'b.mp3'] and h2['seen'] == ['lion-incorrect.mp4', 'c.mp3'], [h1['seen'], h2['seen']])
        rest = every('hard-words-', len(WORDS) - 2)
        ok(tag + ' in order: the rest of Words follow', rest == WORDS[2:], rest[:3])
        p.js("await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === '%s', 4000, 'q2 again'); return true;" % WORDS[1])
        h4 = answer(True)
        ok(tag + ' the missed one comes back at the end', h4['id'] == WORDS[1], h4['id'])
        p.js("await T.wait(() => MOMO.state.screen === 'done', 5000, 'done'); await T.sleep(700); return true;")
        check_fit(p, 'done', 'stars (Words)')
        d = p.js("return [document.getElementById('doneScore').textContent, document.getElementById('doneTitle').textContent, document.querySelectorAll('.stars .s.on').length];")
        n = len(WORDS)
        ok(tag + ' stars: %d of %d, no name in the title' % (n - 1, n), d[0] == '%d of %d right on the first try' % (n - 1, n) and ',' not in d[1] and d[2] == n - 1, d)
        # Mix up (on the subjects screen)
        p.js("T.click('#moreBtn'); await T.wait(() => MOMO.state.screen === 'subjects'); await T.sleep(200); T.click('#subjects .mix'); await T.sleep(120); return true;")
        m = p.js("const b = document.querySelector('#subjects .mix'); return [MOMO.settings.mix, b.getAttribute('aria-pressed'), b.classList.contains('on'), document.getElementById('toast').textContent];")
        ok(tag + ' Mix up switches on (and says so)', m[:3] == [True, 'true', True] and m[3].startswith('Mixed up'), m)
        firsts, orders = [], []
        for _ in range(6):
            o = p.js("T.click('.tile[data-set=words]'); await T.wait(() => MOMO.phase() === 'asking'); const o = MOMO.state.round.queue.map(i => i.q.id); MOMO.back(); await T.wait(() => MOMO.state.screen === 'subjects'); return o;")
            orders.append(o); firsts.append(o[0])
        ok(tag + ' mixed: every question, a new order each time, never the same first one twice', all(sorted(o) == sorted(WORDS) for o in orders) and all(o != WORDS for o in orders)
           and len(set(map(tuple, orders))) == 6 and all(firsts[i] != firsts[i + 1] for i in range(5)), firsts)
        p.js("location.reload(); return true;")
        p.spin(None, 0.5)
        m = p.js("await T.wait(() => window.MOMO && MOMO.state.screen === 'home', 8000, 'home'); T.click('.friend[data-char=sphinx]'); await T.wait(() => MOMO.state.screen === 'mode'); const b = document.querySelector('#mode .mix'); return [MOMO.settings.mix, b.classList.contains('on')];")
        ok(tag + ' Mix up is remembered after a restart', m == [True, True], m)
        p.js("T.click('#mode .mix'); await T.sleep(50); T.click('.mode-btn.hard'); await T.wait(() => MOMO.state.screen === 'name'); T.click('#nameSkip'); await T.wait(() => MOMO.state.screen === 'subjects'); return true;")
        # All of them, in order: the subjects take turns; a long round shows a filling bar
        p.js("T.click('.tile[data-set=all]'); await T.wait(() => MOMO.phase() === 'asking'); await T.sleep(200); return true;")
        order = p.js("return MOMO.state.round.queue.map(i => i.q.id);")
        sets = p.js("return MOMO.content.levels[2].sets.map(s => s.questions.map(q => q.id));")
        ok(tag + ' All of them: the subjects take turns', len(order) == HARD_ALL and order == [st[i] for i in range(max(map(len, sets))) for st in sets if i < len(st)], order[:4])
        pr = p.js("return [document.getElementById('dots').classList.contains('long'), document.querySelector('.pcount') && document.querySelector('.pcount').textContent, T.fit(['.prog', '.pcount', '#hearAgain', '#quiz .back'])];")
        ok(tag + ' long round: a progress bar, "1 / %d", fits' % HARD_ALL, pr[0] and pr[1] == '1 / %d' % HARD_ALL and not pr[2], pr)
        ids = every('hard-', HARD_ALL)
        ok(tag + ' All of them: every question once', sorted(ids) == sorted(order), len(ids))
        p.js("await T.wait(() => MOMO.state.screen === 'done', 6000, 'done'); await T.sleep(600); return true;")
        d = p.js("return [document.getElementById('doneScore').textContent, document.getElementById('doneHero').getAttribute('src')];")
        ok(tag + ' All of them: %d of %d (the sphinx on the stars)' % (HARD_ALL, HARD_ALL), d == ['%d of %d right on the first try' % (HARD_ALL, HARD_ALL), 'img/char/sphinx.jpg'], d)
        p.shot('8-stars-all')
        # back during a video stops it; back walks home; Credits
        p.js("T.click('#againBtn'); await T.wait(() => MOMO.phase() === 'asking'); T.click('.ans[data-letter=A]'); await T.wait(() => MOMO.phase() === 'video' || MOMO.phase() === 'line', 3000); return true;")
        b = p.js("const r = MOMO.back(); await T.sleep(150); return [r, MOMO.state.screen, MOMO.playing(), document.getElementById('vidLayer').classList.contains('show')];")
        ok(tag + ' back during a video stops it and goes to the subjects', b == [True, 'subjects', None, False], b)
        b = p.js("return [MOMO.back(), MOMO.state.screen, MOMO.back(), MOMO.state.screen, MOMO.back()];")
        ok(tag + ' back: subjects → levels → home → (app closes)', b == [True, 'mode', True, 'home', False], b)
        c = p.js("""T.click('#creditsBtn'); await T.wait(() => MOMO.state.screen === 'credits'); await T.sleep(250);
          const t = document.querySelector('.credits-body').textContent.replace(/\\s+/g, ' ');
          return [t, T.fit(['#credits .back', '.credits-badge']), MOMO.back(), MOMO.state.screen];""")
        ok(tag + ' Credits: ages 2-7, created by Rich BlackMan, built by Claude Code Opus 5.5, content generated by …; back → home',
           'ages 2–7' in c[0] and 'CreatedbyRichBlackManBuiltbyClaudeCodeOpus5.5ContentgeneratedbyGemini' in re.sub(r'\s', '', c[0]) and 'Gemini Plus Flash 3.6, Canva Pro, Grok Premium Expert 4.7, ChatGPT-6, and ElevenLabs Multilingual v2' in c[0]
           and not c[1] and c[2:] == [True, 'home'] and (not STANDIN or 'Kokoro-82M (voice am_michael, Apache-2.0) reads some of the newest questions' in c[0]), c[1:])
        p.js("T.click('#creditsBtn'); await T.sleep(300); return true;")
        p.shot('9-credits')
    except Exception as e:  # noqa: BLE001
        ok(tag + ' flow ran to the end', False, e)
        p.shot('error')
    p.close()


def splash_check():
    """The real splash (not fast): the logo big on purple, no "made by" line, then home."""
    p = Page(412, 915, fast=False)
    try:
        p.spin(None, 0.6)
        s = p.js("return [MOMO.state.screen, T.rect('.splash-badge'), document.getElementById('splash').textContent.trim(), document.querySelectorAll('#splash .credit').length];")
        ok('splash: the logo is big', s[0] == 'splash' and s[1][2] >= 412 * 0.85, s)
        ok('splash: no "made by" line', s[2] == '' and s[3] == 0, s[2:])
        p.shot('0-splash')
        p.js("const st = document.createElement('style'); st.id = 'holdSplash'; st.textContent = '.splash-badge { animation: none !important; } #splash.show { z-index: 50; }'; document.head.appendChild(st); return true;")
        for (w, h) in ((412, 915), (915, 412), (740, 360), (360, 640), (1280, 800), (1920, 1080)):
            p.resize(w, h)
            p.spin(None, 0.3)
            c = p.js("document.getElementById('splash').classList.add('show'); await T.sleep(60); return [T.rect('.splash-badge'), T.fit(['.splash-badge'])];")
            ok('%dx%d splash: the logo fits and is big' % (w, h), not c[1] and (c[0][2] >= w * 0.8 or c[0][3] >= h * 0.75), c)
        p.resize(412, 915)
        p.js("await T.wait(() => MOMO.state.screen === 'home', 6000, 'home'); document.getElementById('holdSplash').remove(); document.getElementById('splash').classList.remove('show'); return true;")
        ok('splash → home after the logo', True)
    except Exception as e:  # noqa: BLE001
        ok('splash', False, e)
    p.close()


def media_check():
    """Real playback in WebKitGTK: the intro, the character's videos, Momo's clips and her heart pulsing."""
    with SilentSink():
        _media_check()


def _media_check():
    p = Page(1280, 800, fast=False, real=True)
    try:
        p.js("await T.wait(() => MOMO.state.screen === 'home', 8000, 'home'); return true;")
        t = p.js("const v = document.getElementById('intro'); await T.sleep(2500); return [v.paused, v.currentTime, v.videoWidth, v.muted, v.duration];")
        ok('intro video (heart + 8 characters) plays by itself with sound', t[0] is False and t[1] > 1.0 and t[2] == 1280 and t[3] is False and 20 < t[4] < 24, t)
        p.shot('9-intro-playing')
        # v1.2: the heart starts the intro over; a character can be picked only once it has popped into the ring
        t = p.js(RING_JS + """
          const v = document.getElementById('intro'), out = {};
          await T.wait(() => v.currentTime > 2.0, 8000, 'intro at 2 s'); const before = v.currentTime;
          out.heartEl = tapAt(ringXY(-1)); await T.sleep(400); out.heart = [Math.round(before * 10) / 10, Math.round(v.currentTime * 10) / 10, v.paused];
          v.pause(); v.currentTime = L.lead + L.first - 0.5; await T.sleep(300);
          out.early = [tapAt(ringXY(0)), (await T.sleep(300), MOMO.state.screen)];
          v.currentTime = L.lead + L.first + 0.5; await T.sleep(300);
          out.next = [tapAt(ringXY(1)), (await T.sleep(300), MOMO.state.screen)];      // the elephant pops 1.75 s later
          out.shown = [0, 1, 7].map((i) => MOMO.ringShown(i));
          tapAt(ringXY(0)); await T.wait(() => MOMO.state.screen === 'mode', 3000, 'levels after the dove');
          out.picked = [MOMO.state.char.id, v.paused];
          MOMO.back(); await T.wait(() => MOMO.state.screen === 'home'); await T.sleep(300);
          return out;""", 30)
        ok('intro: a tap on the heart while it plays starts it over', t['heart'][0] > 1.8 and t['heart'][1] < 1.0 and t['heart'][2] is False, t['heart'])
        ok('intro: a character that has not popped in yet cannot be picked; one that has can (and the intro stops)',
           t['early'][1] == 'home' and t['next'][1] == 'home' and t['shown'] == [True, False, False] and t['picked'] == ['dove', True], t)
        t = p.js("""
          T.click('.friend[data-char=duck]'); await T.sleep(200); T.click('.mode-btn.hard'); await T.sleep(200); T.click('#nameSkip'); await T.sleep(200); T.click('.tile[data-set=math]');
          await T.wait(() => MOMO.phase() === 'asking'); const intro = document.getElementById('intro').paused;
          // the heart follows her voice: its level goes up and down while she asks
          const lv = []; for (let i = 0; i < 30; i++) { await T.sleep(60); lv.push(MOMO.heart() ? MOMO.heart().level : -1); }
          const a = MOMO.playing();
          T.click('.ans[data-letter=' + MOMO.question().answer + ']');
          await T.wait(() => MOMO.phase() === 'video', 3000, 'video'); await T.sleep(2000);
          const v = document.getElementById('fbVideo'); const vid = [v.currentSrc.split('/').pop(), v.currentTime, v.videoWidth, v.paused];
          return { intro, a: a && [a.src.split('/').slice(-2).join('/'), a.time], vid, hi: Math.max(...lv), lo: Math.min(...lv.slice(5)) };
        """, 60)
        ok('intro stops when a character is picked', t['intro'] is True, t['intro'])
        ok('question clip plays', t['a'] and t['a'][0] == 'hard-math-01/a.mp3' and t['a'][1] > 0.5, t['a'])
        ok("Momos heart pulses with her words (up and down)", t['hi'] > 0.35 and t['lo'] < t['hi'] - 0.2, [round(t['hi'], 2), round(t['lo'], 2)])
        ok('the duck "correct" video plays', t['vid'][0] == 'duck-correct.mp4' and t['vid'][1] > 1.0 and t['vid'][2] > 0 and not t['vid'][3], t['vid'])
        p.shot('9-video-playing')
        t = p.js("""
          await T.wait(() => MOMO.phase() === 'line', 15000, 'line after the video'); await T.sleep(1200); const b = MOMO.playing();
          return [b && b.src.split('/').slice(-2).join('/'), b && b.time, document.getElementById('hearAgain').classList.contains('talking')];
        """, 60)
        ok('after the video, the b clip plays (the heart pulses with it)', t[0] == 'hard-math-01/b.mp3' and t[1] > 0.5 and t[2], t)
        t = p.js("await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === 'hard-math-02', 15000, 'next question'); return MOMO.question().id;", 60)
        ok('then the next question by itself', t == 'hard-math-02', t)
        t = p.js("""
          window.__momoPause(); window.__momoPause(); await T.sleep(600); const a = MOMO.playing(); const t1 = a && a.time; await T.sleep(800); const t2 = MOMO.playing() && MOMO.playing().time;
          window.__momoResume(); await T.sleep(900); const t3 = MOMO.playing() && MOMO.playing().time;
          return [t1, t2, t3];
        """, 30)
        ok('pause / resume (app in the background) holds the clip and goes on', t[0] is not None and abs(t[1] - t[0]) < 0.05 and t[2] > t[1] + 0.3, t)
        t = p.js("""
          await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === 'hard-math-02', 20000, 'math 2 asking');
          const q = MOMO.question(); const wrong = ['A','B','C'].find(L => L !== q.answer);
          T.click('.ans[data-letter=' + wrong + ']');
          await T.wait(() => MOMO.phase() === 'video', 3000, 'video'); await T.sleep(1200);
          const v = document.getElementById('fbVideo'); const vid = [v.currentSrc.split('/').pop(), v.currentTime > 0.5];
          T.click('#skipBtn');
          await T.wait(() => MOMO.phase() === 'line', 3000, 'line'); await T.sleep(900);
          const right = document.querySelector('.ans[data-letter=' + q.answer + ']'), picked = document.querySelector('.ans[data-letter=' + wrong + ']');
          return { vid, rightCls: right.className, picked: picked.className, clip: MOMO.playing() && MOMO.playing().src.split('/').slice(-2).join('/'),
                   next: getComputedStyle(document.getElementById('nextBtn')).display };
        """, 60)
        ok('wrong answer: the duck "incorrect" video plays, Skip works', t['vid'] == ['duck-incorrect.mp4', True], t['vid'])
        ok('then the right answer lights up and the c clip plays', 'right' in t['rightCls'] and 'wrong' in t['picked'] and t['clip'] == 'hard-math-02/c.mp3' and t['next'] == 'flex', t)
        # the Replay arrow (after she finishes) and the heart (while she talks) both start the question from the beginning
        t = p.js("""
          await T.wait(() => MOMO.phase() === 'asking' && MOMO.question().id === 'hard-math-03', 30000, 'math 3 asking');
          const b = document.getElementById('hearAgain'), out = [];
          await T.wait(() => !MOMO.playing(), 20000, 'question ended');
          out.push(['arrow', b.classList.contains('talking')]);
          b.click(); await T.sleep(350); let a = MOMO.playing(); await T.sleep(700); let c = MOMO.playing();
          out.push([a && a.src.split('/').slice(-2).join('/'), a && Math.round(a.time * 10) / 10, c && Math.round(c.time * 10) / 10, b.classList.contains('talking')]);
          await T.sleep(800); const before = MOMO.playing() && MOMO.playing().time;
          b.click(); await T.sleep(300); a = MOMO.playing();
          out.push(['heart tap', Math.round(before * 10) / 10, a && Math.round(a.time * 10) / 10]);
          return out;
        """, 90)
        ok('Replay arrow after she finishes: the question again from the start, the heart pulses again', t[0] == ['arrow', False] and t[1][0] == 'hard-math-03/a.mp3' and t[1][1] < 0.6 and t[1][2] > t[1][1] + 0.3 and t[1][3], t)
        ok('a tap on the heart while she talks starts her over', t[2][1] > 1.0 and t[2][2] < 0.6, t[2])
    except Exception as e:  # noqa: BLE001
        ok('media', False, e)
    p.close()


if __name__ == '__main__':
    intro_layout_check()
    splash_check()
    for w, h in SIZES:
        flow(w, h)
    if '--media' in args:
        media_check()
    bad = [r for r in results if not r[1]]
    print('\n%d checks, %d failed' % (len(results), len(bad)))
    for r in bad:
        print('  FAIL', r[0], '—', r[2])
    sys.exit(1 if bad else 0)
