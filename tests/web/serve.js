// A small static server for testing the "learn" folder the way LiteSpeed will serve it: byte ranges for media, the
// headers and the deny rules of its .htaccess (read from the file), no PHP, no cookies.
//   node tests/web/serve.js FOLDER_PARENT PORT      → http://127.0.0.1:PORT/learn/
const http = require('http'), fs = require('fs'), path = require('path');
const [root, port] = [path.resolve(process.argv[2]), Number(process.argv[3] || 8490)];
const ht = fs.readFileSync(path.join(root, 'learn', '.htaccess'), 'utf8');
const headers = {};
for (const m of ht.matchAll(/^\s*Header always set ([\w-]+) "(.*)"\s*$/gm)) headers[m[1]] = m[2];
const deny = /(^|\/)(\.|README)|\.(md|txt|bak|json|php|py|sh)$/;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.ttf': 'font/ttf' };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  let rel = u.replace(/^\/+/, '');
  if (rel.endsWith('/') || rel === '') rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || /(^|\/)data\//.test(rel) || deny.test(rel)) { res.writeHead(rel.includes('data/') ? 404 : 403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = types[path.extname(file)] || 'application/octet-stream';
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', type);
    if (range) {
      let s = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
      let e = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (s > e || s >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
      return fs.createReadStream(file, { start: s, end: e }).pipe(res);
    }
    res.writeHead(200, { 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, '127.0.0.1', () => console.log('serving ' + root + ' on ' + port));
