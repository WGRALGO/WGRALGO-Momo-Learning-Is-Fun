// Renders tools/intro/intro.html frame by frame in headless Chromium and pipes the frames into ffmpeg.
//   node tools/intro/render.js PAGE_URL FPS SECONDS FFMPEG OUT_VIDEO_ONLY.mp4
const pw = (() => { const fs = require('fs'), os = require('os'), p = require('path');
  const local = p.join(os.homedir(), '.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
  return require(process.env.PLAYWRIGHT || (fs.existsSync(local) ? local : 'playwright')); })();
const { spawn } = require('child_process');
const [url, fps, secs, ff, out] = process.argv.slice(2);
(async () => {
  const exe = process.env.CHROME || require('fs').readdirSync(require('os').homedir() + '/.cache/ms-playwright').filter(d => d.startsWith('chromium_headless_shell-')).sort().map(d => require('os').homedir() + '/.cache/ms-playwright/' + d + '/chrome-headless-shell-linux64/chrome-headless-shell').filter(f => require('fs').existsSync(f)).pop();
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url);
  await page.evaluate(() => window.ready);
  if (errs.length) { console.error(errs); process.exit(1); }
  const enc = spawn(ff, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(Number(secs) * Number(fps));
  for (let i = 0; i < n; i++) {
    const b64 = await page.evaluate(t => { window.drawFrame(t); return document.getElementById('c').toDataURL('image/jpeg', 0.95).slice(23); }, i / Number(fps));
    if (!enc.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => enc.stdin.once('drain', r));
    if (i % 60 === 0) process.stdout.write(`frame ${i}/${n}\n`);
  }
  enc.stdin.end();
  await new Promise(r => enc.on('close', r));
  if (errs.length) { console.error(errs); process.exit(1); }
  await browser.close();
})();
