// Screenshots of every screen at a few sizes (Playwright Chromium, the app in fast test mode).
//   node tests/ui-shots.js [outdir]
const pw = (() => { const fs = require('fs'), os = require('os'), p = require('path');
  const local = p.join(os.homedir(), '.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
  return require(process.env.PLAYWRIGHT || (fs.existsSync(local) ? local : 'playwright')); })();
const fs = require('fs'), path = require('path'), os = require('os');
const out = process.argv[2] || path.join(__dirname, 'shots');
const url = 'file://' + path.join(__dirname, '..', 'web', 'index.html') + '?test=fast';
const sizes = [['phone', 390, 844], ['phone-wide', 844, 390], ['tablet', 1280, 800], ['tablet-tall', 800, 1280], ['pc', 1920, 1080]];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dir = path.join(os.homedir(), '.cache/ms-playwright');
  const exe = fs.readdirSync(dir).filter(d => d.startsWith('chromium_headless_shell-')).sort()
    .map(d => path.join(dir, d, 'chrome-headless-shell-linux64/chrome-headless-shell')).filter(f => fs.existsSync(f)).pop();
  const browser = await pw.chromium.launch({ executablePath: exe });
  const errs = [];
  for (const [name, w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errs.push(name + ': ' + e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.MOMO && MOMO.state.screen === 'home');
    await page.waitForTimeout(500);
    const shot = async s => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, `${name}-${s}.png`) }); };
    await shot('1-home');
    await page.click('.friend[data-char="dove"]'); await shot('2-level');
    await page.click('.mode-btn[data-mode="hard"]'); await page.fill('#nameInput', 'Ava'); await shot('3-name');
    await page.click('#nameGo'); await shot('4-subjects');
    await page.click('.tile[data-set="math"]'); await page.waitForTimeout(600);
    await shot('6-quiz-replay');
    // the heart as it looks while Momo talks (frozen half-loud: fast mode plays no real sound)
    await page.evaluate(() => { const h = MOMO.heart(); document.getElementById('hearAgain').classList.add('talking'); if (h) { h.off = false; h.freeze(0.6); } });
    await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${name}-5-quiz-talking.png`) });
    await page.evaluate(() => { const h = MOMO.heart(); document.getElementById('hearAgain').classList.remove('talking'); if (h) { h.freeze(null); h.off = true; } });
    // answer every question right (fast mode) until the stars
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const st = await page.evaluate(() => ({ s: MOMO.state.screen, p: MOMO.phase(), a: MOMO.question() && MOMO.question().answer }));
      if (st.s === 'done') break;
      if (st.p === 'asking') await page.click(`.ans[data-letter="${st.a}"]`).catch(() => {});
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(600); await shot('7-done');
    await page.click('#homeBtn'); await page.click('#creditsBtn'); await shot('8-credits');
    await page.close();
  }
  await browser.close();
  if (errs.length) { console.error('PAGE ERRORS:\n' + errs.join('\n')); process.exit(1); }
  console.log('shots in', out);
})();
