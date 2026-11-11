// The public Momo app (ages 2-7). Android checks (after tests/android/setup.sh phone|tablet): drives the app's WebView
// over the Chrome DevTools protocol, with real taps (adb input), real typing (the name), real rotation, the back
// button, and real playback of the intro, the characters' videos and Momo's clips (with her heart).
// Usage: node tests/android/check.js phone|tablet   → screenshots in tests/android/shots/<label>-*.png
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const T = process.env.UPTOP_TOOLS || path.join(process.env.HOME, '.local/share/uptop-build');
const ADB = path.join(T, 'sdk/platform-tools/adb'), PKG = 'com.wgra.momolearning', label = process.argv[2] || 'phone';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (name, cond, info) => { results.push([name, !!cond, info || '']); console.log((cond ? 'PASS ' : 'FAIL ') + label + ' ' + name + (info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };

async function attach() {
  for (let k = 0; k < 60; k++) {
    const socks = adb('shell', 'cat', '/proc/net/unix').split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => x && x.startsWith('@webview_devtools_remote'));
    if (socks.length) {
      adb('forward', 'tcp:9334', 'localabstract:' + socks[socks.length - 1].slice(1));
      try {
        const list = await (await fetch('http://127.0.0.1:9334/json')).json();
        const page = list.find((p) => /momo\.app/.test(p.url) && /"attached":true/.test(p.description || '')) || list.find((p) => /momo\.app/.test(p.url));
        if (page) return page.webSocketDebuggerUrl;
      } catch (e) { /* not ready */ }
    }
    await sleep(1000);
  }
  throw new Error('no WebView to attach to');
}
let ws = null, seq = 0; const waiting = new Map();
async function connect() {
  const url = await attach();
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m); } };
  const mine = ws; ws.onclose = () => { if (ws !== mine) return; ws = null; for (const w of waiting.values()) w({ closed: true }); waiting.clear(); };
}
function cdp(method, params) { const id = ++seq; return new Promise((res) => { waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function js(expr) {
  if (!ws) await connect();
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.closed) throw new Error('page closed');
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function until(expr, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await js(expr)) return Date.now() - t0; } catch (e) { /* reload */ } await sleep(250); }
  throw new Error('timeout: ' + what);
}
function shot(name) { fs.writeFileSync(path.join(SHOTS, label + '-' + name + '.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })); }
function rotate(r) { adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); adb('shell', 'settings', 'put', 'system', 'user_rotation', String(r)); }
// a real finger tap on an element (page CSS pixels → screen pixels)
async function tap(sel) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, devicePixelRatio, innerWidth, innerHeight]; })()`);
  const size = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)\s*$/m);
  // the WebView fills the screen (immersive); in landscape the letterbox for a camera cutout can shift it, so measure it
  const off = await viewOffset();
  adb('shell', 'input', 'tap', String(Math.round(off[0] + r[0] * r[2])), String(Math.round(off[1] + r[1] * r[2])));
  return size;
}
// v2.0: a real finger tap on an answer drawn in the picture (the middle of its first box), or on the picture off them
async function tapXY(expr) {
  const r = await js(`(() => { const xy = ${expr}; return [xy[0], xy[1], devicePixelRatio]; })()`);
  const off = await viewOffset();
  adb('shell', 'input', 'tap', String(Math.round(off[0] + r[0] * r[2])), String(Math.round(off[1] + r[1] * r[2])));
}
const PICXY = `((px, py) => { const r = document.getElementById('qPic').getBoundingClientRect(); return [r.left + r.width * px / 100, r.top + r.height * py / 100]; })`;
const tapPic = (L) => tapXY(`(() => { const b = MOMO.question().spots['${L}'][0]; return ${PICXY}((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); })()`);
const tapOffPic = () => tapXY(`(() => { const q = MOMO.question(); let best = null;
  for (let y = 4; y <= 96; y += 2) for (let x = 4; x <= 96; x += 2) {
    if ([[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].some(([dx, dy]) => MOMO.spotAt(q, x + dx, y + dy))) continue;
    const d = (x - 50) ** 2 + (y - 50) ** 2; if (!best || d < best[2]) best = [x, y, d]; }
  return ${PICXY}(best[0], best[1]); })()`);
// where the WebView sits on the screen (it keeps clear of the camera cutout): from the view tree
async function viewOffset() {
  const dump = adb('shell', 'dumpsys', 'activity', 'top');
  const line = dump.split('\n').find((l) => /android\.webkit\.WebView\{/.test(l)) || '';
  const m = line.match(/ (-?\d+),(-?\d+)-(-?\d+),(-?\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}
const FIT = `(sels) => { const W = innerWidth, H = innerHeight, out = [];
  for (const s of sels) for (const e of document.querySelectorAll(s)) { const r = e.getBoundingClientRect(); if (!r.width) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(s + ' outside'); }
  if (document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1) out.push('page scrolls');
  return out; }`;
const fit = (sels) => js(`(${FIT})(${JSON.stringify(sels)})`);
const media = (id) => js(`(() => { const v = document.getElementById('${id}'); return { src: (v.currentSrc || '').split('/').pop(), t: v.currentTime, paused: v.paused, w: v.videoWidth, ready: v.readyState, err: v.error && v.error.code }; })()`);
const playing = () => js(`(() => { const p = MOMO.playing(); return p && { src: p.src.split('/').slice(-2).join('/'), t: p.time, paused: p.paused }; })()`);
const topActivity = () => { const d = adb('shell', 'dumpsys', 'activity', 'activities'); const m = d.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*\{[^}]*\s(\S+\/\S+)/); return m ? m[1] : ''; };

(async () => {
  try {
    adb('shell', 'am', 'force-stop', PKG); adb('shell', 'pm', 'clear', PKG); rotate(0); await sleep(800);
    // Android's one-time "Viewing full screen" tip (a person taps Got it once); the checks start past it
    adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed');
    // other apps on this shared emulator (the Up Top Prediction Bot) post pop-up notifications that slide over the top
    // of the screen and swallow taps on Replay (2026-11-06); no pop-ups while the checks run
    adb('shell', 'settings', 'put', 'global', 'heads_up_notifications_enabled', '0');
    const t0 = Date.now();
    adb('shell', 'am', 'start', '-n', PKG + '/.MainActivity');
    await sleep(1300); shot('0-splash');
    await connect();
    const sp = await js(`[MOMO.state.screen, (() => { const r = document.querySelector('.splash-badge').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), innerWidth, innerHeight]; })(), MOMO.version,
      document.getElementById('splash').textContent.trim()]`);
    ok('splash: the logo big on purple, no "made by" line', (sp[0] === 'splash' || sp[0] === 'home') && sp[3] === '' && sp[2] === '1.0.0', sp);
    await until(`MOMO.state.screen === 'home'`, 15000, 'home');
    ok('home after the splash', true, ((Date.now() - t0) / 1000).toFixed(1) + ' s from launch');
    await sleep(3000);
    let v = await media('intro');
    ok('the intro (heart + 8 characters) plays by itself', !v.paused && v.t > 1.5 && v.w === 1280, v);
    shot('1-home-portrait');
    const HOME = ['.home-top', '#introCard', '.friend'];
    ok('home fits (portrait): 8 characters', (await fit(HOME)).length === 0 && (await js(`document.querySelectorAll('.friend').length`)) === 8, await fit(HOME));
    rotate(1); await sleep(2500);
    const pageId = await js('window.__pageId = window.__pageId || Math.random()');
    shot('1-home-landscape');
    ok('home fits (landscape)', (await fit(HOME)).length === 0, await fit(HOME));
    v = await media('intro');
    ok('rotating keeps the intro playing (no restart)', !v.paused && v.t > 3, v);
    await tap('.friend[data-char=dove]');
    await until(`MOMO.state.screen === 'mode'`, 5000, 'levels after tapping the dove');
    ok('a real tap on the dove opens the levels', true);
    v = await media('intro');
    ok('the intro stops when a character is picked', v.paused, v);
    await sleep(500); shot('2-levels-landscape');
    ok('levels fit (landscape)', (await fit(['.mode-btn', '#mode .hero', '#mode .mix'])).length === 0, await fit(['.mode-btn', '#mode .hero', '#mode .mix']));
    await tap('.mode-btn.normal'); await sleep(400);
    ok('Normal: coming soon', (await js(`document.getElementById('toast').textContent`)) === 'Normal is coming soon!');
    rotate(0); await sleep(1800);
    shot('2-levels-portrait');
    await tap('.mode-btn.hard');
    await until(`MOMO.state.screen === 'name'`, 5000, 'name');
    await sleep(500); shot('3-name');
    // a real tap in the box: the keyboard comes up, the page makes room, the box stays in sight; real typing
    const h0 = await js('innerHeight');
    await tap('#nameInput'); await sleep(1800);
    adb('shell', 'input', 'text', 'Ava'); await sleep(800);
    const nm = await js(`(() => { const r = document.getElementById('nameInput').getBoundingClientRect(); return [document.getElementById('nameInput').value, innerHeight, Math.round(r.top), Math.round(r.bottom), document.activeElement && document.activeElement.id]; })()`);
    shot('3-name-keyboard');
    ok('name: typed with the keyboard; the page shrinks above it and the box stays in sight', nm[0] === 'Ava' && nm[1] < h0 * 0.85 && nm[2] >= 0 && nm[3] <= nm[1], [h0, nm]);
    adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER');
    await until(`MOMO.state.screen === 'subjects'`, 5000, 'subjects after Enter');
    await sleep(1500);
    const kb = await js('[innerHeight, MOMO.state.kid]');
    ok('Enter = Let\'s go: the keyboard goes away, the name is kept for the round', kb[1] === 'Ava' && kb[0] > h0 * 0.95, [h0, kb]);
    shot('4-subjects');
    await tap('.tile[data-set=math]');
    await until(`MOMO.phase() === 'asking'`, 5000, 'question');
    await sleep(1800);
    let p = await playing();
    const heart = await js(`[document.getElementById('hearAgain').classList.contains('talking'), getComputedStyle(document.getElementById('heart')).display, MOMO.heart() && MOMO.heart().level, document.getElementById('kidName').textContent.trim()]`);
    ok('question 1: Momo reads it, her heart shows in the bar, the name too', p && p.src === 'hard-math-01/a.mp3' && p.t > 0.8 && !p.paused && heart[0] && heart[1] === 'block' && heart[3] === 'Ava', [p, heart]);
    shot('5-question-portrait');
    const QF = ['#qPic', '.ans', '#dots', '#hearAgain', '#quiz .back', '#kidName'];
    ok('question fits (portrait)', (await fit(QF)).length === 0, await fit(QF));
    rotate(1); await sleep(1500);
    p = await playing();
    ok('rotating mid-question keeps the page and the clip', (await js('window.__pageId')) === pageId && (p === null || !p.paused), p);
    shot('5-question-landscape');
    ok('question fits (landscape)', (await fit(QF)).length === 0, await fit(QF));
    const ans = await js('MOMO.question().answer');
    await tap(`.ans[data-letter=${ans}]`);
    await until(`MOMO.phase() === 'video'`, 4000, 'video');
    await sleep(2500);
    v = await media('fbVideo');
    ok('right answer: the dove "correct" video plays', v.src === 'dove-correct.mp4' && v.t > 1.2 && !v.paused && v.w > 0, v);
    shot('6-correct-video');
    await until(`MOMO.phase() === 'line'`, 15000, 'b clip after the video');
    await sleep(1200);
    p = await playing();
    ok('then Momo says the b line (her heart pulses)', p && p.src === 'hard-math-01/b.mp3' && p.t > 0.5 && (await js(`document.getElementById('hearAgain').classList.contains('talking')`)), p);
    await until(`MOMO.phase() === 'asking' && MOMO.question().id === 'hard-math-02'`, 15000, 'question 2');
    ok('then question 2 by itself', true);
    await sleep(1000);
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(2000);
    const pa = await playing();
    await sleep(1500);
    const pb = await playing();
    adb('shell', 'am', 'start', '-n', PKG + '/.MainActivity'); await sleep(2500);
    const pc = await playing();
    ok('Home key pauses the question clip, coming back goes on', pa && pa.paused && pb && Math.abs(pb.t - pa.t) < 0.05 && pc && !pc.paused && pc.t > pb.t, [pa, pb, pc]);
    ok('coming back keeps the same page (no restart)', (await js('window.__pageId')) === pageId && (await js('MOMO.state.screen')) === 'quiz');
    // a real tap on the heart while she talks starts her over; when she is done the Replay arrow plays it again
    await sleep(1200);
    {
      const before = await playing();
      await tap('#hearAgain'); await sleep(450);
      const a = await playing(); await sleep(900); const b = await playing();
      ok('a tap on the heart while Momo talks starts her over', before && before.t > 1.0 && a && /hard-math-02\/a\.mp3$/.test(a.src) && a.t < 0.9 && b && b.t > a.t + 0.4, [before, a, b]);
    }
    await until(`!MOMO.playing()`, 20000, 'question 2 finished');
    await sleep(300);
    const arrow = await js(`[document.getElementById('hearAgain').classList.contains('talking'), getComputedStyle(document.querySelector('#hearAgain .again')).display]`);
    shot('7-replay-arrow');
    await tap('#hearAgain'); await sleep(450);
    {
      const a = await playing(); await sleep(900); const b = await playing();
      ok('when she is done, the heart is the Replay arrow; a tap plays the question again', !arrow[0] && arrow[1] !== 'none' && a && /hard-math-02\/a\.mp3$/.test(a.src) && a.t < 0.9 && b && b.t > a.t + 0.4, [arrow, a, b]);
    }
    await sleep(800);
    {
      const before = await playing();
      await tapOffPic(); await sleep(450);
      const a = await playing(); await sleep(900); const b = await playing();
      const st = await js('[MOMO.phase(), MOMO.state.round.pos, document.querySelectorAll(".ans.right, .ans.wrong").length]');
      ok('a real tap on the picture off its answers: nothing (Momo goes on, no answer)', before && a && b && a.src === before.src && a.t > before.t + 0.2 && b.t > a.t + 0.4 && st[0] === 'asking' && st[1] === 1 && st[2] === 0, [before, a, b, st]);
    }
    const q2 = await js('MOMO.question()');
    const wrong = ['A', 'B', 'C'].find((L) => L !== q2.answer);
    await tapPic(wrong);
    await until(`MOMO.phase() === 'video'`, 4000, 'video 2');
    ok('a real tap on an answer in the picture picks it', (await js('MOMO.state.round.lastPick')) === wrong, wrong);
    await sleep(2500);
    v = await media('fbVideo');
    ok('wrong answer: the dove "incorrect" video plays', v.src === 'dove-incorrect.mp4' && v.t > 1.2 && !v.paused, v);
    shot('8-incorrect-video');
    await tap('#skipBtn');
    await until(`MOMO.phase() === 'line'`, 4000, 'c clip');
    await sleep(1200);
    p = await playing();
    const lit = await js(`[document.querySelector('.ans.right').getAttribute('data-letter'), document.querySelector('.ans.wrong').getAttribute('data-letter')]`);
    ok('Skip works; Momo says the c line; the right answer is lit', p && p.src === 'hard-math-02/c.mp3' && p.t > 0.5 && lit[0] === q2.answer && lit[1] === wrong, [p, lit]);
    shot('9-after-wrong');
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(900);
    const s1 = await js('[MOMO.state.screen, MOMO.playing()]');
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(700);
    const s2 = await js('MOMO.state.screen');
    ok('Back: question → subjects (sound stops) → levels', s1[0] === 'subjects' && s1[1] === null && s2 === 'mode', [s1, s2]);
    // Easy with Mix up (real taps), the name skipped
    await tap('#mode .mix'); await sleep(500);
    const mix = await js(`[MOMO.settings.mix, document.querySelector('#mode .mix').getAttribute('aria-pressed'), document.getElementById('toast').textContent]`);
    ok('Mix up: a real tap switches it on', mix[0] === true && mix[1] === 'true' && /^Mixed up/.test(mix[2]), mix);
    await sleep(1900);
    await tap('.mode-btn.easy');
    await until(`MOMO.state.screen === 'name'`, 5000, 'name (Easy)');
    ok('the name box is empty again (never kept)', (await js(`document.getElementById('nameInput').value`)) === '');
    await sleep(400);
    await tap('#nameSkip');
    await until(`MOMO.phase() === 'asking'`, 5000, 'Easy question');
    await sleep(1800);
    p = await playing();
    const lq = await js(`[MOMO.question().id, document.querySelectorAll('.ans').length, MOMO.state.round.queue.map((i) => i.q.id).join(' '), document.getElementById('kidName').hidden]`);
    ok('Easy: a toddler question with two choices, Momo reads it, no name chip', p && /easy-toddler-\d+\/a\.mp3$/.test(p.src) && p.t > 0.8 && lq[1] === 2 && lq[3] === true, [p, lq[0], lq[1], lq[3]]);
    ok('Mix up: the 8 Easy questions in a mixed order', lq[2].split(' ').length === 8 && lq[2] !== 'easy-toddler-01 easy-toddler-02 easy-toddler-03 easy-toddler-04 easy-toddler-50 easy-toddler-49 easy-toddler-48 easy-toddler-47', lq[2]);
    shot('10-easy-question');
    await tapPic(await js('MOMO.question().answer'));
    await until(`MOMO.phase() === 'video'`, 4000, 'Easy video');
    await sleep(2500);
    v = await media('fbVideo');
    ok('right answer tapped in the picture: the dove "correct" video plays', v.src === 'dove-correct.mp4' && v.t > 1.2 && !v.paused, v);
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(900);
    const l1 = await js('[MOMO.state.screen, MOMO.playing()]');
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(700);
    const l2 = await js('MOMO.state.screen');
    ok('Back: Easy question → levels (video stops) → home', l1[0] === 'mode' && l1[1] === null && l2 === 'home', [l1, l2]);
    await tap('#creditsBtn'); await sleep(800);
    const cr = await js(`[MOMO.state.screen, document.querySelector('.credits-body').textContent.includes('Claude Code Opus 5.5')]`);
    shot('11-credits');
    ok('Credits opens from home', cr[0] === 'credits' && cr[1], cr);
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(700);
    ok('Back from Credits → home', (await js('MOMO.state.screen')) === 'home');
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1500);
    ok('Back at home closes the app', !/momolearning/.test(topActivity()), topActivity());
    ws = null;
    adb('shell', 'am', 'start', '-n', PKG + '/.MainActivity');
    await sleep(2000); await connect();
    await until(`window.MOMO && MOMO.state.screen === 'home'`, 15000, 'home again');
    ok('Mix up is still on after the app is closed and opened', (await js('MOMO.settings.mix')) === true && (await js('MOMO.version')) === '1.0.0');
    const label = adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', PKG).trim().split('\n').pop();
    ok('launcher entry', /com\.wgra\.momolearning\/\.MainActivity/.test(label), label);
  } catch (e) {
    ok('checks ran to the end', false, String(e && e.message || e));
    try { shot('error'); } catch (x) { /* ignore */ }
  }
  rotate(0);
  const bad = results.filter((r) => !r[1]);
  console.log(`\n${label}: ${results.length} checks, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})();
