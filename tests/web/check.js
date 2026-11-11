// The "learn" folder in real browsers (Playwright Chromium and Firefox), served by tests/web/serve.js:
// no password, the CSP doesn't block anything, nothing from other sites, no cookies, nothing kept but "Mix up",
// the intro and a question really play (byte ranges), the notes and .htaccess are not served.
//   node tests/web/check.js http://127.0.0.1:PORT/learn/
const pw = (() => { const fs = require('fs'), os = require('os'), p = require('path');
  const local = p.join(os.homedir(), '.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
  return require(process.env.PLAYWRIGHT || (fs.existsSync(local) ? local : 'playwright')); })();
const fs = require('fs'), os = require('os'), path = require('path');
const base = process.argv[2];
let bad = 0;
const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); if (!cond) bad++; };
function exe(prefix, sub) {
  const dir = path.join(os.homedir(), '.cache/ms-playwright');
  return fs.readdirSync(dir).filter(d => d.startsWith(prefix)).sort().map(d => path.join(dir, d, sub)).filter(f => fs.existsSync(f)).pop();
}
(async () => {
  for (const [name, type, opts] of [['chromium', pw.chromium, { executablePath: exe('chromium_headless_shell-', 'chrome-headless-shell-linux64/chrome-headless-shell'), args: ['--autoplay-policy=no-user-gesture-required'] }],
                                     ['firefox', pw.firefox, { executablePath: exe('firefox-', 'firefox/firefox'), firefoxUserPrefs: { 'media.autoplay.default': 0 } }]]) {
    const browser = await type.launch(opts);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [], csp = [], foreign = [], statuses = {};
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (/Content.Security.Policy|CSP/i.test(m.text())) csp.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith(base.replace(/learn\/$/, '')) && !/^(data|blob):/.test(r.url())) foreign.push(r.url()); });
    page.on('response', r => { const k = r.url().split('/learn/')[1] || ''; if (/\.(mp3|mp4)$/.test(k)) (statuses[k] = statuses[k] || new Set()).add(r.status()); });
    await page.goto(base + '?test=0');
    await page.waitForFunction(() => window.MOMO && MOMO.state.screen === 'home', null, { timeout: 15000 });
    ok(name + ': opens straight to the app (no password)', await page.evaluate(() => !document.querySelector('#lock, .lock, input[type=password]')));
    await page.mouse.click(640, 400);       // a first tap (browsers let media start after one)
    await page.waitForTimeout(2500);
    const intro = await page.evaluate(() => { const v = document.getElementById('intro'); return [v.currentTime > 0.5 || !v.paused, v.videoWidth]; });
    ok(name + ': the intro plays', intro[1] === 1280, intro);
    await page.evaluate(async () => {
      document.querySelector('.friend[data-char=elephant]').click(); await new Promise(r => setTimeout(r, 300));
      document.querySelector('.mode-btn.hard').click(); await new Promise(r => setTimeout(r, 300));
      document.getElementById('nameInput').value = 'Mia'; document.getElementById('nameGo').click(); await new Promise(r => setTimeout(r, 300));
      document.querySelector('.tile[data-set=science]').click();
    });
    await page.waitForFunction(() => MOMO.phase() === 'asking' && MOMO.playing() && MOMO.playing().time > 0.6, null, { timeout: 15000 });
    const q = await page.evaluate(() => [MOMO.question().id, MOMO.playing().src.split('/').slice(-2).join('/'), document.getElementById('hearAgain').classList.contains('talking')]);
    ok(name + ': a question plays, Momo\'s heart is on', q[0] === 'hard-science-01' && q[1] === 'hard-science-01/a.mp3' && q[2], q);
    await page.evaluate(() => document.querySelector('.ans[data-letter=' + MOMO.question().answer + ']').click());
    await page.waitForFunction(() => MOMO.phase() === 'video' && document.getElementById('fbVideo').currentTime > 0.8, null, { timeout: 15000 });
    ok(name + ': the elephant\'s video plays', await page.evaluate(() => document.getElementById('fbVideo').currentSrc.endsWith('media/elephant-correct.mp4')));
    const store = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) o[localStorage.key(i)] = localStorage.getItem(i); return [Object.keys(o), document.cookie, JSON.stringify(Object.keys(sessionStorage))]; });
    ok(name + ': nothing kept but Mix up; the name is not stored; no cookies', store[0].every(k => k === 'momo.mix') && store[1] === '' && store[2] === '[]' && !(await page.evaluate(() => JSON.stringify(localStorage).includes('Mia'))), store);
    ok(name + ': no cookies in the browser', (await ctx.cookies()).length === 0);
    ok(name + ': nothing loaded from any other site', foreign.length === 0, foreign.slice(0, 3));
    ok(name + ': the Content-Security-Policy blocks nothing; no page errors', csp.length === 0 && errs.length === 0, csp.concat(errs).slice(0, 3));
    ok(name + ': media come with byte ranges (206)', Object.values(statuses).some(s => s.has(206)), Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, [...v]])));
    await browser.close();
  }
  // straight HTTP: headers, deny rules, Range
  const get = async (p, h) => { const r = await fetch(base + p, { headers: h || {} }); return r; };
  const r = await get('');
  ok('headers: nosniff, SAMEORIGIN, no-referrer, CSP, no Set-Cookie', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'SAMEORIGIN'
     && r.headers.get('referrer-policy') === 'no-referrer' && /default-src 'self'/.test(r.headers.get('content-security-policy') || '') && !r.headers.get('set-cookie'));
  ok('README.txt and .htaccess are not served', (await get('README.txt')).status === 403 && (await get('.htaccess')).status === 403);
  ok('a data/ path is a 404', (await get('data/anything')).status === 404);
  const rr = await get('media/intro.mp4', { Range: 'bytes=0-99' });
  ok('a Range request gets 206 and 100 bytes', rr.status === 206 && (await rr.arrayBuffer()).byteLength === 100, rr.status);
  console.log(bad ? `\n${bad} FAILED` : '\nALL PASSED');
  process.exit(bad ? 1 : 0);
})();
