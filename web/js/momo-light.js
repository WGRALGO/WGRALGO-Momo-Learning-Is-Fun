/* Momo's light: a deep purple Momo with white light around it that pulses with Momo's voice, one pulse per syllable.
 * Eight shapes: orb, gem, heart, star, flower, butterfly, crown, ball (a crystal ball).
 *
 * How it follows her voice: every clip's loudness is measured ahead of time (tools/momo_light/make_preview.py,
 * 60 values a second, 0-100, shaped so each syllable is its own pulse). While a clip plays, the light reads the clip's
 * currentTime every frame and looks up the loudness there. No live audio analysis is needed, so it works the same in
 * the Android app, the Linux app and every browser (Safari included) and stays in step with Replay/pause/skip.
 *
 * How it stays smooth: drawing gradients, blurs and long paths every frame is slow (Firefox and phones above all), so
 * each Momo's body is painted twice when first needed — quiet and fully lit — and every frame just blends the two
 * pictures by how loud she is. The glow, halo, rays and rings are soft pictures made once too, stretched and faded
 * each frame. What moves inside (swirls, the crystal ball's mist, the gem's flashes, the butterfly's wings) is
 * still drawn live, from small pictures. A frame is a few dozen canvas calls instead of several hundred.
 *
 *   var light = new MomoLight(canvas, 'orb');
 *   light.follow(audioOrVideoElement, envelope);   // envelope = { fps: 60, v: [0..100, ...] }
 *   light.follow(null);                            // back to resting (slow breathing)
 *   light.setShape('heart');
 *
 * Manual mode (making a video, or a scene with its own background): the caller sizes things and draws each frame.
 *   var light = new MomoLight(canvas, 'heart', { manual: true, background: false, layout: function (W, H) { ... } });
 *   light.setSize(W, H, 1);
 *   light.follow({ currentTime: 0, paused: false, ended: false }, envelope);   // move currentTime along yourself
 *   light.draw(ms);                                                            // one frame at that moment
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var SHAPES = { orb: 1, gem: 1, heart: 1, star: 1, flower: 1, butterfly: 1, crown: 1, ball: 1 };
  // each shape's size at rest (× the card's base size) and how much it swells at full voice
  var BASE = { orb: 1, gem: 1.04, heart: 0.98, star: 1.2, flower: 1.05, butterfly: 1.1, crown: 1.02, ball: 1.1 };
  var SWELL = { orb: 0.22, gem: 0.16, heart: 0.16, star: 0.2, flower: 0.18, butterfly: 0.12, crown: 0.16, ball: 0.14 };
  var SWIRL_COLORS = ['201,168,245', '244,126,192', '255,255,255'];

  function MomoLight(canvas, shape, opts) {
    opts = opts || {};
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.manual = !!opts.manual;            // no animation loop of its own, no measuring the page: see above
    this.layout = opts.layout || null;      // function (W, H) → { cx, cy, R0 } (where Momo sits, and her size)
    this.ownBg = opts.background !== false && opts.background !== 'none';   // false: the caller paints the background
    this.clear = opts.background === 'none';                               // 'none': see-through, on the page itself
    this.glow = opts.glow || 1;             // how strong the white light around her is (less over a bright picture)
    this.shape = SHAPES[shape] ? shape : 'orb';
    this.beat = 0;             // the heart's extra pump on a loud syllable, 1 → 0
    this.flap = 0;             // the butterfly's wing beat
    this.off = false;          // true = not drawn (hidden)
    this.q = 1;                // sharpness: drops (to 0.5 at most) when the device can't draw smoothly
    this.ft = 16.7;            // average time between frames, ms
    this.slowFor = 0;
    this.media = null; this.env = null;
    this.level = 0;            // smoothed voice level, 0..1
    this.slow = 0;             // slower average, used to spot the start of a loud syllable
    this.lastRing = 0;
    this.frozen = null;        // tests only: a fixed level
    this.bg = null;            // this card's background picture
    this.rings = []; this.motes = []; this.sparks = [];
    for (var i = 0; i < 14; i++) {
      this.sparks.push({ a: Math.random() * TAU, r: 1.28 + Math.random() * 0.85,
        s: (0.07 + Math.random() * 0.13) * (i % 2 ? -1 : 1), ph: Math.random() * TAU, sz: 0.45 + Math.random() * 0.75 });
    }
    if (this.manual) { this.W = canvas.width; this.H = canvas.height; this.dpr = 1; this.corner = 0; this.last = null; return; }
    this.last = performance.now();
    var self = this;
    this.resize();
    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    else root.addEventListener('resize', function () { self.resize(); });
    (function frame(now) {
      if (!self.off) { self.pace(now - self.last); self.draw(now); } else self.last = now;
      requestAnimationFrame(frame);
    })(this.last);
  }

  MomoLight.prototype.follow = function (media, env) { this.media = media || null; this.env = env || null; };
  // manual mode: the drawing size in CSS pixels, and the pixel ratio
  MomoLight.prototype.setSize = function (W, H, dpr) { this.W = W; this.H = H; this.dpr = dpr || 1; this.bg = null; };
  MomoLight.prototype.freeze = function (level) { this.frozen = level; };
  MomoLight.prototype.setShape = function (shape) { if (SHAPES[shape]) { this.shape = shape; this.rings = []; } };

  // Keep it smooth: if frames come slower than ~40 a second for a while, draw with fewer pixels. Syllables are only
  // 1/5 s apart, so a smooth light matters more than a razor-sharp one. (Several lights on one page share the cost.)
  MomoLight.prototype.pace = function (gap) {
    if (gap <= 0 || gap > 120) return;                  // a pause or a hidden tab, not slowness
    this.ft += (gap - this.ft) * 0.1;
    if (this.ft > 25 && this.q > 0.5) {
      if ((this.slowFor += gap) > 600) { this.q = Math.max(0.5, this.q * 0.85); this.slowFor = 0; this.ft = 16.7; this.resize(); }
    } else this.slowFor = 0;
  };

  MomoLight.prototype.resize = function () {
    var dpr = Math.min(root.devicePixelRatio || 1, 2) * this.q, r = this.c.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height); this.dpr = dpr;
    this.c.width = Math.round(this.W * dpr); this.c.height = Math.round(this.H * dpr);
    this.bg = null;
    // Rounded card? The light cuts its own corners: letting the page clip a canvas that changes every frame
    // (overflow: hidden + border-radius) halves the frame rate in Firefox. Give the card no overflow: hidden.
    var p = this.c.parentNode;
    this.corner = p && p.nodeType === 1 ? parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0 : 0;
  };

  // the loudness right now (0..1), straight from the measured envelope
  MomoLight.prototype.raw = function () {
    if (this.frozen != null) return this.frozen;
    var m = this.media, env = this.env;
    if (!m || !env || m.paused || m.ended) return 0;
    var x = m.currentTime * env.fps, i = Math.floor(x), v = env.v;
    if (i < 0 || i >= v.length) return 0;
    var a = v[i], b = i + 1 < v.length ? v[i + 1] : a;
    return (a + (b - a) * (x - i)) / 100;
  };

  // ───────────── pictures made once and reused

  function canvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h || w)); return c; }
  // a small cache that forgets the oldest pictures (big ones take memory)
  function Cache(max) { this.max = max; this.m = new Map(); }
  Cache.prototype.get = function (key, make) {
    var v = this.m.get(key);
    if (v) return v;
    v = make();
    this.m.set(key, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
    return v;
  };
  var GLOWS = new Cache(24), BODIES = new Cache(12), RINGS = new Cache(16), SWIRLS = new Cache(24), MISTS = new Cache(6);
  function bucket(px) { return Math.max(16, Math.round(px / 8) * 8); }

  // soft round pictures, the same at every size: the twinkle, the halo (two kinds), the wash and the rays
  var SOFT = {};
  function soft(name) {
    if (SOFT[name]) return SOFT[name];
    var n = name === 'spark' ? 128 : 512, h = n / 2, c = canvas(n), g = c.getContext('2d'), gr;
    if (name === 'spark') {
      var s = h / 1.1;
      gr = g.createRadialGradient(h, h, 0, h, h, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(225,205,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
      g.translate(h, h); g.fillStyle = '#fff'; g.beginPath();
      g.moveTo(0, -s); g.quadraticCurveTo(s * 0.12, -s * 0.12, s, 0); g.quadraticCurveTo(s * 0.12, s * 0.12, 0, s);
      g.quadraticCurveTo(-s * 0.12, s * 0.12, -s, 0); g.quadraticCurveTo(-s * 0.12, -s * 0.12, 0, -s);
      g.fill();
    } else if (name === 'haloOrb' || name === 'halo') {
      // drawn at full voice; quieter moments fade it
      gr = g.createRadialGradient(h, h, h * (name === 'haloOrb' ? 0.43 : 0.12), h, h, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.16, 'rgba(245,235,255,0.52)');
      gr.addColorStop(0.5, 'rgba(201,168,245,0.17)');
      gr.addColorStop(1, 'rgba(201,168,245,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    } else if (name === 'wash') {
      gr = g.createRadialGradient(h, h, 0, h, h, h);
      gr.addColorStop(0, 'rgba(160,110,230,1)'); gr.addColorStop(0.55, 'rgba(160,110,230,0.35)'); gr.addColorStop(1, 'rgba(160,110,230,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    } else {                                                // rays0 / rays1, at full voice
      n = 768; h = n / 2; c = canvas(n); g = c.getContext('2d');
      var set = name === 'rays1' ? 1 : 0, nR = set ? 8 : 12, inner = h * 0.85 / (set ? 2.5 : 3.35);
      gr = g.createRadialGradient(h, h, inner, h, h, h);
      gr.addColorStop(0, 'rgba(255,255,255,' + (set ? 0.22 : 0.33) + ')');
      gr.addColorStop(0.45, 'rgba(232,215,255,' + (set ? 0.10 : 0.11) + ')');
      gr.addColorStop(1, 'rgba(232,215,255,0)');
      g.fillStyle = gr; g.beginPath();
      for (var i = 0; i < nR; i++) {
        var a = i * TAU / nR, half = set ? 0.09 : 0.06, len = h * (0.82 + 0.18 * Math.sin(i * 2.3));
        g.moveTo(h + Math.cos(a - half) * inner, h + Math.sin(a - half) * inner);
        g.lineTo(h + Math.cos(a) * len, h + Math.sin(a) * len);
        g.lineTo(h + Math.cos(a + half) * inner, h + Math.sin(a + half) * inner);
        g.closePath();
      }
      g.fill();
    }
    return (SOFT[name] = c);
  }

  // stamp a picture centred at (x, y), half-size h (wide hx), turned by a, faded by alpha
  function stamp(g, img, x, y, hx, hy, a, alpha, dpr) {
    if (alpha <= 0.005 || hx <= 0) return;
    var c = Math.cos(a) * dpr, s = Math.sin(a) * dpr;
    g.setTransform(c, s, -s, c, x * dpr, y * dpr);
    g.globalAlpha = Math.min(1, alpha);
    g.drawImage(img, -hx, -hy, 2 * hx, 2 * hy);
  }

  // the soft white light around a shape: drawn once (with real blur) per shape and size
  function glowSprite(shape, Rb, dpr) {
    var q = dpr * 0.5, px = bucket(Rb * q);                // half resolution: it's all soft light anyway
    return GLOWS.get(shape + ':' + px, function () {
      var Rs = px / q, ext = 2.0, c = canvas(2 * ext * Rs * q), g = c.getContext('2d');
      g.setTransform(q, 0, 0, q, c.width / 2, c.height / 2);
      g.shadowColor = '#ffffff'; g.fillStyle = '#ffffff';
      PATHS[shape](g, Rs);
      g.shadowBlur = Rs * 0.6 * q; g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.shadowColor = 'rgba(255,255,255,0.45)';
      g.shadowBlur = Rs * 0.18 * q; g.fill();
      return { c: c, ext: ext };
    });
  }

  // a ring of light in the shape's outline (it ripples out on loud syllables)
  function ringSprite(shape, Rb, dpr) {
    var px = bucket(Rb * dpr);
    return RINGS.get(shape + ':' + px, function () {
      var Rs = px / dpr, ext = 1.15, c = canvas(2 * ext * Rs * dpr), g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, c.width / 2, c.height / 2);
      if (shape === 'ball') { g.beginPath(); g.arc(0, 0, BALL_R * Rs, 0, TAU); } else PATHS[shape](g, Rs);
      g.lineJoin = 'round';
      g.lineWidth = Rs * 0.09; g.strokeStyle = 'rgba(220,200,255,0.26)'; g.stroke();
      g.lineWidth = Rs * 0.022; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
      return { c: c, ext: ext, Rs: Rs };
    });
  }

  // the body painted twice — quiet (e = 0) and fully lit (e = 1); the parts that move are drawn live on top
  function bodySprites(shape, Rb, dpr) {
    var px = bucket(Rb * dpr * 1.12);                   // a little bigger than at rest, so swelling stays sharp
    return BODIES.get(shape + ':' + px, function () {
      var Rs = px / dpr, ext = 1.18;
      function bake(e) {
        var c = canvas(2 * ext * Rs * dpr), g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, c.width / 2, c.height / 2);
        PAINT[shape](g, Rs, e);
        return c;
      }
      return { c0: bake(0), c1: bake(1), ext: ext };
    });
  }

  // the slow swirls inside, one picture each (they turn at their own speeds)
  var SWIRL = { orb: [0.58, 0.05], heart: [0.45, 0], star: [0.3, 0.06], flower: [0.4, 0] };   // [size, centre y] in R
  function swirlSprite(shape, k, Rb, dpr) {
    var px = bucket(Rb * dpr);
    return SWIRLS.get(shape + ':' + k + ':' + px, function () {
      var Rs = px / dpr, rad = (SWIRL[shape][0] + 0.1 * k) * Rs, w = Rs * (0.07 - 0.015 * k), half = rad + w * 2;
      var c = canvas(2 * half * dpr), g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, c.width / 2, c.height / 2);
      g.scale(1, 0.34 + 0.12 * k);
      g.beginPath(); g.arc(0, 0, rad, 0.2 * k, 0.2 * k + TAU * 0.72);
      glowLine(g, w, SWIRL_COLORS[k], 1);
      return { c: c, half: half / Rs };
    });
  }

  // the crystal ball's mist (it turns slowly inside the glass)
  function mistSprite(Rb, dpr) {
    var px = bucket(Rb * dpr);
    return MISTS.get('mist:' + px, function () {
      var Rs = px / dpr, br = BALL_R * Rs, c = canvas(2 * br * dpr), g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, c.width / 2, c.height / 2);
      g.beginPath(); g.arc(0, 0, br * 0.99, 0, TAU); g.clip();
      g.globalCompositeOperation = 'lighter';
      var mist = ['201,168,245', '244,126,192', '255,255,255', '160,110,230'];
      for (var k = 0; k < 4; k++) {
        var mx = Math.cos(k * 1.7) * br * 0.38, my = Math.sin(k * 1.9) * br * 0.3;
        var mg = g.createRadialGradient(mx, my, 0, mx, my, br * 0.6);
        mg.addColorStop(0, 'rgba(' + mist[k] + ',' + (k === 2 ? 0.38 : 0.36) + ')');
        mg.addColorStop(1, 'rgba(' + mist[k] + ',0)');
        g.fillStyle = mg; g.fillRect(-br, -br, 2 * br, 2 * br);
      }
      return { c: c, half: BALL_R };
    });
  }

  MomoLight.prototype.background = function () {
    if (this.bg) return this.bg;
    var W = this.W, H = this.H, dpr = this.dpr, c = canvas(W * dpr, H * dpr), g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var wa = 0.13;
    function mix(r, gg, b, k) { return 'rgb(' + Math.round(r + 160 * k) + ',' + Math.round(gg + 110 * k) + ',' + Math.round(b + 230 * k) + ')'; }
    var bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, mix(61, 20, 104, wa)); bg.addColorStop(0.55, mix(44, 13, 82, wa * 0.35)); bg.addColorStop(1, '#170429');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    return (this.bg = c);
  };

  // ───────────── the shapes' outlines (units of R, centred on the shape's middle)

  // the gem, seen from the side like a cut diamond: a flat top (table), the crown, the widest edge (girdle) and the
  // point (culet)
  var GY = -0.165;
  var GT = [-0.42, -0.14, 0.14, 0.42].map(function (x) { return [x, -0.62 + GY]; });
  var GG = [-1, -0.5, 0, 0.5, 1].map(function (x) { return [x, -0.18 + GY]; });
  var GC = [0, 0.95 + GY];
  var GEM_OUT = [GT[0], GT[3], GG[4], GC, GG[0]];
  var GEM_FACETS = (function () {
    var f = [], crown = ['150,98,220', '110,52,180', '132,78,204'], pav = ['84,34,130', '61,20,104', '106,52,168', '72,26,120'];
    [[GG[0], GT[0], GG[1]], [GG[1], GT[0], GT[1]], [GG[1], GT[1], GG[2]], [GG[2], GT[1], GT[2]],
     [GG[2], GT[2], GG[3]], [GG[3], GT[2], GT[3]], [GG[3], GT[3], GG[4]]].forEach(function (p, i) {
      f.push({ pts: p, rgb: crown[i % 3], crown: true });
    });
    for (var i = 0, j = 0; i < 4; i++) {
      var m = [(GG[i][0] + GG[i + 1][0]) / 2 * 0.55, 0.3 + GY];
      [[GG[i], GG[i + 1], m], [GG[i], m, GC], [GG[i + 1], m, GC]].forEach(function (p) { f.push({ pts: p, rgb: pav[j++ % 4], crown: false }); });
    }
    f.forEach(function (q) { q.mx = (q.pts[0][0] + q.pts[1][0] + q.pts[2][0]) / 3; });
    return f;
  })();

  function poly(g, pts, s) {
    g.beginPath();
    for (var i = 0; i < pts.length; i++) { if (i) g.lineTo(pts[i][0] * s, pts[i][1] * s); else g.moveTo(pts[i][0] * s, pts[i][1] * s); }
    g.closePath();
  }

  function heartPath(g, s) {
    var y = 0.03;
    g.beginPath();
    g.moveTo(0, (0.9 + y) * s);
    g.bezierCurveTo(-0.25 * s, (0.65 + y) * s, -1.0 * s, (0.2 + y) * s, -1.0 * s, (-0.3 + y) * s);
    g.bezierCurveTo(-1.0 * s, (-0.72 + y) * s, -0.68 * s, (-0.95 + y) * s, -0.45 * s, (-0.95 + y) * s);
    g.bezierCurveTo(-0.2 * s, (-0.95 + y) * s, -0.05 * s, (-0.8 + y) * s, 0, (-0.62 + y) * s);
    g.bezierCurveTo(0.05 * s, (-0.8 + y) * s, 0.2 * s, (-0.95 + y) * s, 0.45 * s, (-0.95 + y) * s);
    g.bezierCurveTo(0.68 * s, (-0.95 + y) * s, 1.0 * s, (-0.72 + y) * s, 1.0 * s, (-0.3 + y) * s);
    g.bezierCurveTo(1.0 * s, (0.2 + y) * s, 0.25 * s, (0.65 + y) * s, 0, (0.9 + y) * s);
    g.closePath();
  }

  // five puffy, rounded points
  function starPath(g, s) {
    var pts = [], i;
    for (i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, r = (i % 2 ? 0.5 : 1) * s;
      pts.push([Math.cos(a) * r, Math.sin(a) * r + 0.095 * s]);
    }
    g.beginPath();
    g.moveTo((pts[9][0] + pts[0][0]) / 2, (pts[9][1] + pts[0][1]) / 2);
    for (i = 0; i < 10; i++) {
      var p = pts[i], q = pts[(i + 1) % 10];
      g.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (i % 2 ? 0.1 : 0.17) * s);
    }
    g.closePath();
  }

  // five round petals
  function flowerPath(g, s) {
    var n = 200;
    g.beginPath();
    for (var i = 0; i <= n; i++) {
      var th = i / n * TAU, r = s * (0.6 + 0.4 * Math.pow(0.5 + 0.5 * Math.cos(5 * (th + Math.PI / 2)), 0.55));
      if (i) g.lineTo(Math.cos(th) * r, Math.sin(th) * r); else g.moveTo(Math.cos(th) * r, Math.sin(th) * r);
    }
    g.closePath();
  }

  // the butterfly's four wings (sx = how open they are, 1 = flat open)
  function wingsPath(g, s, sx) {
    g.beginPath();
    for (var side = -1; side <= 1; side += 2) {
      var k = side * sx * s;
      g.moveTo(0.06 * k, -0.12 * s);
      g.bezierCurveTo(0.3 * k, -0.98 * s, 1.02 * k, -1.02 * s, 0.98 * k, -0.48 * s);
      g.bezierCurveTo(0.95 * k, -0.12 * s, 0.55 * k, -0.02 * s, 0.06 * k, 0);
      g.closePath();
      g.moveTo(0.06 * k, 0.04 * s);
      g.bezierCurveTo(0.58 * k, 0.0, 0.86 * k, 0.4 * s, 0.7 * k, 0.68 * s);
      g.bezierCurveTo(0.56 * k, 0.94 * s, 0.18 * k, 0.82 * s, 0.06 * k, 0.24 * s);
      g.closePath();
    }
  }

  // five points and a band
  var CROWN_DY = 0.135;
  var CROWN = [[-0.85, 0.55], [-0.97, -0.42], [-0.7, 0.02], [-0.5, -0.72], [-0.25, -0.12], [0, -0.95], [0.25, -0.12],
    [0.5, -0.72], [0.7, 0.02], [0.97, -0.42], [0.85, 0.55]];
  function crownPath(g, s) {
    g.beginPath();
    for (var i = 0; i < CROWN.length; i++) {
      var x = CROWN[i][0] * s, y = (CROWN[i][1] + CROWN_DY) * s;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.quadraticCurveTo(0, (0.7 + CROWN_DY) * s, -0.85 * s, (0.55 + CROWN_DY) * s);
    g.closePath();
  }

  // the crystal ball and its little stand
  var BALL_Y = -0.17, BALL_R = 0.78;
  function standPath(g, s, keep) {
    if (!keep) g.beginPath();
    g.moveTo(-0.4 * s, 0.5 * s); g.lineTo(0.4 * s, 0.5 * s); g.lineTo(0.62 * s, 0.88 * s);
    g.quadraticCurveTo(0, 1.0 * s, -0.62 * s, 0.88 * s); g.closePath();
  }

  var PATHS = {
    orb: function (g, s) { g.beginPath(); g.arc(0, 0, s, 0, TAU); },
    gem: function (g, s) { poly(g, GEM_OUT, s); },
    heart: heartPath,
    star: starPath,
    flower: flowerPath,
    butterfly: function (g, s) { wingsPath(g, s, 1); },
    crown: crownPath,
    ball: function (g, s) { g.beginPath(); g.arc(0, BALL_Y * s, BALL_R * s, 0, TAU); standPath(g, s, true); }
  };

  // ───────────── painting a body, for its two pictures (at the origin, size R, voice level e)

  // a bright line along the current path with a soft fringe
  function glowLine(g, width, rgb, alpha) {
    g.lineJoin = 'round';
    g.lineWidth = width * 2.6; g.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, alpha * 0.28) + ')'; g.stroke();
    g.lineWidth = width; g.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, alpha) + ')'; g.stroke();
  }

  function bodyGradient(g, R, lx, ly) {
    var body = g.createRadialGradient(R * lx, R * ly, R * 0.04, 0, 0, R * 1.05);
    body.addColorStop(0, '#b487ec');
    body.addColorStop(0.2, '#8247c9');
    body.addColorStop(0.52, '#542282');
    body.addColorStop(0.84, '#3d1468');
    body.addColorStop(1, '#2a0b4d');
    return body;
  }

  // a glossy deep purple body in any outline: lit from the top left, a light inside that brightens with each word,
  // light bouncing up from below, a bright white rim and a shine
  function pearlBody(g, path, R, e, o) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = bodyGradient(g, R, o.lx, o.ly); path(R); g.fill();
    g.save(); path(R * 0.995); g.clip();
    g.globalCompositeOperation = 'lighter';
    var core = g.createRadialGradient(0, R * o.cy, 0, 0, R * o.cy, R * 0.95);
    core.addColorStop(0, 'rgba(255,255,255,' + (0.10 + 0.55 * e) + ')');
    core.addColorStop(0.35, 'rgba(214,180,255,' + (0.08 + 0.32 * e) + ')');
    core.addColorStop(1, 'rgba(214,180,255,0)');
    g.fillStyle = core; g.fillRect(-1.2 * R, -1.2 * R, 2.4 * R, 2.4 * R);
    var bounce = g.createRadialGradient(R * 0.2, R * o.by, 0, R * 0.2, R * o.by, R * 0.7);
    bounce.addColorStop(0, 'rgba(230,200,255,' + (0.3 + 0.2 * e) + ')');
    bounce.addColorStop(1, 'rgba(230,200,255,0)');
    g.fillStyle = bounce; g.fillRect(-1.2 * R, -1.2 * R, 2.4 * R, 2.4 * R);
    if (o.inside) o.inside();
    g.restore();
    rim(g, path, R, e);
    shines(g, R, o.shines, o.dot);
  }

  function rim(g, path, R, e) {
    g.globalCompositeOperation = 'lighter';
    path(R * 0.985); glowLine(g, R * (0.028 + 0.018 * e), '255,255,255', 0.6 + 0.4 * e);
  }

  // glossy shines: [x, y, size, strength, turn], and a small bright dot
  function shines(g, R, list, dot) {
    g.globalCompositeOperation = 'source-over';
    (list || []).forEach(function (h) {
      g.save();
      g.translate(R * h[0], R * h[1]); g.rotate(h[4] == null ? -0.6 : h[4]); g.scale(1, 0.55);
      var sh = g.createRadialGradient(0, 0, 0, 0, 0, R * h[2]);
      sh.addColorStop(0, 'rgba(255,255,255,' + h[3] + ')');
      sh.addColorStop(0.55, 'rgba(255,255,255,' + (h[3] * 0.28) + ')');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.beginPath(); g.arc(0, 0, R * h[2], 0, TAU); g.fill();
      g.restore();
    });
    if (dot) { g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(R * dot[0], R * dot[1], R * dot[2], 0, TAU); g.fill(); }
  }

  // a glowing jewel: white in the middle, a colour round it, brighter while she talks
  function jewel(g, x, y, r, rgb, a, R) {
    g.globalCompositeOperation = 'lighter';
    var hr = r + R * 0.12 * (0.5 + a), hg = g.createRadialGradient(x, y, r * 0.5, x, y, hr);
    hg.addColorStop(0, 'rgba(' + rgb + ',' + Math.min(1, 0.3 * (0.5 + a)) + ')'); hg.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = hg; g.beginPath(); g.arc(x, y, hr, 0, TAU); g.fill();
    var jg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    jg.addColorStop(0, 'rgba(255,255,255,' + Math.min(1, 0.55 + 0.45 * a) + ')');
    jg.addColorStop(0.5, 'rgba(' + rgb + ',' + Math.min(1, 0.45 + 0.5 * a) + ')');
    jg.addColorStop(1, 'rgba(' + rgb + ',' + (0.25 + 0.3 * a) + ')');
    g.fillStyle = jg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  }

  var PAINT = {
    // ── the orb: a glossy deep purple pearl
    orb: function (g, R, e) {
      g.globalCompositeOperation = 'source-over';
      var body = g.createRadialGradient(-R * 0.34, -R * 0.4, R * 0.04, 0, 0, R);
      body.addColorStop(0, '#b487ec');
      body.addColorStop(0.2, '#8247c9');
      body.addColorStop(0.52, '#542282');
      body.addColorStop(0.84, '#3d1468');
      body.addColorStop(1, '#2a0b4d');
      g.fillStyle = body; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      g.save();
      g.beginPath(); g.arc(0, 0, R * 0.995, 0, TAU); g.clip();
      g.globalCompositeOperation = 'lighter';
      var core = g.createRadialGradient(0, R * 0.12, 0, 0, R * 0.12, R * 0.95);
      core.addColorStop(0, 'rgba(255,255,255,' + (0.10 + 0.55 * e) + ')');
      core.addColorStop(0.35, 'rgba(214,180,255,' + (0.08 + 0.32 * e) + ')');
      core.addColorStop(1, 'rgba(214,180,255,0)');
      g.fillStyle = core; g.fillRect(-R, -R, 2 * R, 2 * R);
      var bounce = g.createRadialGradient(R * 0.25, R * 0.9, 0, R * 0.25, R * 0.9, R * 0.75);
      bounce.addColorStop(0, 'rgba(230,200,255,' + (0.32 + 0.2 * e) + ')');
      bounce.addColorStop(1, 'rgba(230,200,255,0)');
      g.fillStyle = bounce; g.fillRect(-R, -R, 2 * R, 2 * R);
      g.restore();
      g.globalCompositeOperation = 'lighter';
      g.beginPath(); g.arc(0, 0, R * 0.985, 0, TAU);
      glowLine(g, R * (0.03 + 0.02 * e), '255,255,255', 0.6 + 0.4 * e);
      g.globalCompositeOperation = 'source-over';
      g.save();
      g.translate(-R * 0.32, -R * 0.44); g.rotate(-0.55); g.scale(1, 0.58);
      var shine = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
      shine.addColorStop(0, 'rgba(255,255,255,0.78)');
      shine.addColorStop(0.55, 'rgba(255,255,255,0.22)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = shine; g.beginPath(); g.arc(0, 0, R * 0.42, 0, TAU); g.fill();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath(); g.arc(-R * 0.47, -R * 0.5, R * 0.055, 0, TAU); g.fill();
    },

    // ── the gem: each facet its own shade of purple, flashing white when she talks
    gem: function (g, R, e) {
      g.globalCompositeOperation = 'source-over';
      var i, f;
      for (i = 0; i < GEM_FACETS.length; i++) {
        f = GEM_FACETS[i];
        g.fillStyle = 'rgb(' + f.rgb + ')'; poly(g, f.pts, R); g.fill();
        g.fillStyle = 'rgba(255,255,255,' + ((f.crown ? 0.05 : 0.01) + e * 0.08) + ')';     // (the flashes are live)
        poly(g, f.pts, R); g.fill();
      }
      g.save(); poly(g, GEM_OUT, R * 0.995); g.clip();
      g.globalCompositeOperation = 'lighter';
      var core = g.createRadialGradient(0, -0.05 * R, 0, 0, -0.05 * R, R * 0.9);
      core.addColorStop(0, 'rgba(255,255,255,' + (0.05 + 0.2 * e) + ')');
      core.addColorStop(1, 'rgba(214,180,255,0)');
      g.fillStyle = core; g.fillRect(-R, -R, 2 * R, 2 * R);
      g.restore();
      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      g.lineWidth = Math.max(1, R * 0.012); g.strokeStyle = 'rgba(255,255,255,' + (0.22 + 0.3 * e) + ')';
      for (i = 0; i < GEM_FACETS.length; i++) { poly(g, GEM_FACETS[i].pts, R); g.stroke(); }
      g.lineWidth = R * 0.02; g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.beginPath(); g.moveTo(GT[0][0] * R, GT[0][1] * R); g.lineTo(GT[3][0] * R, GT[3][1] * R); g.stroke();
      poly(g, GEM_OUT, R); glowLine(g, R * (0.022 + 0.015 * e), '255,255,255', 0.65 + 0.35 * e);
      g.globalCompositeOperation = 'source-over';
    },

    // ── the heart: puffy, lit from the top left like the pearl
    heart: function (g, R, e) {
      pearlBody(g, function (s) { heartPath(g, s); }, R, e, {
        lx: -0.42, ly: -0.5, cy: 0.05, by: 0.72, sw: 0.45,
        shines: [[-0.5, -0.56, 0.3, 0.78, -0.7], [0.5, -0.64, 0.15, 0.35, -0.7]], dot: [-0.62, -0.62, 0.045]
      });
    },

    star: function (g, R, e) {
      pearlBody(g, function (s) { starPath(g, s); }, R, e, {
        lx: -0.3, ly: -0.4, cy: 0.12, by: 0.55, sw: 0.3,
        shines: [[-0.12, -0.5, 0.2, 0.75, -1.2], [-0.5, -0.12, 0.16, 0.5, -0.3]], dot: [-0.16, -0.62, 0.04]
      });
    },

    // ── the flower: five petals around a glowing middle
    flower: function (g, R, e) {
      pearlBody(g, function (s) { flowerPath(g, s); }, R, e, {
        lx: -0.35, ly: -0.45, cy: 0, by: 0.7, sw: 0.4,
        inside: function () {
          // the lines between the petals, and a soft light in each petal
          g.lineWidth = R * 0.022; g.strokeStyle = 'rgba(214,180,255,' + (0.3 + 0.2 * e) + ')';
          for (var k = 0; k < 5; k++) {
            var a = -Math.PI / 2 + (k + 0.5) * TAU / 5, b = -Math.PI / 2 + k * TAU / 5;
            g.beginPath(); g.moveTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3); g.lineTo(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62); g.stroke();
            var px = Math.cos(b) * R * 0.66, py = Math.sin(b) * R * 0.66;
            var pg = g.createRadialGradient(px, py, 0, px, py, R * 0.32);
            pg.addColorStop(0, 'rgba(255,255,255,' + (0.05 + 0.13 * e) + ')');
            pg.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = pg; g.fillRect(px - R * 0.32, py - R * 0.32, R * 0.64, R * 0.64);
          }
        },
        shines: [[-0.42, -0.62, 0.18, 0.7, -0.9]], dot: [-0.5, -0.72, 0.035]
      });
      g.globalCompositeOperation = 'lighter';
      var hg = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R * (0.55 + 0.25 * e));
      hg.addColorStop(0, 'rgba(255,255,255,' + (0.45 + 0.4 * e) + ')'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hg; g.beginPath(); g.arc(0, 0, R * (0.55 + 0.25 * e), 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-over';
      var mg = g.createRadialGradient(-R * 0.08, -R * 0.08, 0, 0, 0, R * 0.3);
      mg.addColorStop(0, 'rgba(255,255,255,1)');
      mg.addColorStop(0.45, 'rgba(235,220,255,' + (0.9 + 0.1 * e) + ')');
      mg.addColorStop(1, 'rgba(160,110,230,0.85)');
      g.fillStyle = mg; g.beginPath(); g.arc(0, 0, R * (0.28 + 0.03 * e), 0, TAU); g.fill();
      g.fillStyle = 'rgba(123,63,196,' + (0.55 - 0.25 * e) + ')';
      for (var d = 0; d < 8; d++) {
        var da = d * TAU / 8 + 0.2;
        g.beginPath(); g.arc(Math.cos(da) * R * 0.17, Math.sin(da) * R * 0.17, R * 0.024, 0, TAU); g.fill();
      }
    },

    // ── the butterfly (painted flat open; its wings beat by squeezing the picture)
    butterfly: function (g, R, e) {
      var path = function (s) { wingsPath(g, s, 1); };
      pearlBody(g, path, R, e, {
        lx: -0.55, ly: -0.6, cy: -0.05, by: 0.6, sw: 0,
        inside: function () {
          // veins, and bright spots that light up as she talks
          g.lineWidth = R * 0.012; g.strokeStyle = 'rgba(214,180,255,' + (0.25 + 0.15 * e) + ')';
          [[0.9, -0.62], [0.62, -0.88], [0.92, -0.3], [0.7, 0.5], [0.42, 0.72]].forEach(function (v) {
            for (var side = -1; side <= 1; side += 2) {
              g.beginPath(); g.moveTo(0.06 * side * R, (v[1] < 0 ? -0.06 : 0.12) * R);
              g.quadraticCurveTo(v[0] * 0.5 * side * R, v[1] * 0.4 * R, v[0] * side * R, v[1] * R); g.stroke();
            }
          });
          for (var side2 = -1; side2 <= 1; side2 += 2) {
            jewel(g, 0.6 * side2 * R, -0.52 * R, 0.13 * R, '201,168,245', e, R);
            jewel(g, 0.44 * side2 * R, 0.46 * R, 0.08 * R, '244,126,192', e, R);
          }
        },
        shines: [[-0.55, -0.72, 0.18, 0.6, -0.5]]
      });
      // the body, the head and the feelers
      g.globalCompositeOperation = 'source-over';
      var bg = g.createLinearGradient(-R * 0.08, 0, R * 0.08, 0);
      bg.addColorStop(0, '#2a0b4d'); bg.addColorStop(0.45, '#7b3fc4'); bg.addColorStop(1, '#2a0b4d');
      g.fillStyle = bg;
      g.beginPath(); g.ellipse(0, R * 0.08, R * 0.075, R * 0.5, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(0, -R * 0.48, R * 0.1, 0, TAU); g.fill();
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = R * 0.016; g.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.3 * e) + ')';
      g.beginPath(); g.ellipse(0, R * 0.08, R * 0.075, R * 0.5, 0, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, -R * 0.48, R * 0.1, 0, TAU); g.stroke();
      g.lineWidth = R * 0.02; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.75)';
      for (var side = -1; side <= 1; side += 2) {
        var tx = side * R * 0.3, ty = -R * 0.98;
        g.beginPath(); g.moveTo(side * R * 0.04, -R * 0.56); g.quadraticCurveTo(side * R * 0.06, -R * 0.9, tx, ty); g.stroke();
        jewel(g, tx, ty, R * 0.05, '255,255,255', e, R);
      }
      g.globalCompositeOperation = 'source-over';
    },

    // ── the crown: a pearl on each point and jewels on the band
    crown: function (g, R, e) {
      var path = function (s) { crownPath(g, s); };
      var y0 = (0.22 + CROWN_DY) * R, y1 = (0.5 + CROWN_DY) * R;
      pearlBody(g, path, R, e, {
        lx: -0.45, ly: -0.3, cy: 0.1, by: 0.75, sw: 0,
        inside: function () {
          g.fillStyle = 'rgba(255,255,255,' + (0.07 + 0.08 * e) + ')'; g.fillRect(-R, y0, 2 * R, y1 - y0);
          g.lineWidth = R * 0.018; g.strokeStyle = 'rgba(255,255,255,' + (0.45 + 0.3 * e) + ')';
          g.beginPath(); g.moveTo(-R, y0); g.lineTo(R, y0); g.stroke();
          g.beginPath(); g.moveTo(-R, y1); g.lineTo(R, y1); g.stroke();
        },
        shines: [[-0.62, -0.05, 0.16, 0.55, -1.2], [-0.05, -0.45, 0.12, 0.5, -1.3]]
      });
      var mid = (y0 + y1) / 2;
      [[-0.52, '244,126,192', 0.075], [0, '255,255,255', 0.1], [0.52, '201,168,245', 0.075]].forEach(function (j) {
        jewel(g, j[0] * R, mid, j[2] * R, j[1], e * 0.85 + 0.15, R);
      });
      [1, 3, 5, 7, 9].forEach(function (k) {
        jewel(g, CROWN[k][0] * R * 0.97, (CROWN[k][1] + CROWN_DY) * R - R * 0.04, R * (k === 5 ? 0.095 : 0.075), '232,215,255', e * 0.9 + 0.2, R);
      });
    },

    // ── the crystal ball: glass full of purple mist (the mist is added live), on a little stand
    ball: function (g, R, e) {
      var by = BALL_Y * R, br = BALL_R * R;
      g.globalCompositeOperation = 'source-over';
      var sg = g.createLinearGradient(0, R * 0.5, 0, R * 0.95);
      sg.addColorStop(0, '#6a34a8'); sg.addColorStop(1, '#2a0b4d');
      g.fillStyle = sg; standPath(g, R); g.fill();
      rim(g, function () { standPath(g, R); }, R * 0.6, e);
      g.globalCompositeOperation = 'source-over';
      var glass = g.createRadialGradient(-br * 0.35, by - br * 0.4, br * 0.05, 0, by, br);
      glass.addColorStop(0, '#9a63dc'); glass.addColorStop(0.35, '#6a34a8'); glass.addColorStop(0.75, '#3d1468'); glass.addColorStop(1, '#5a2a92');
      g.fillStyle = glass; g.beginPath(); g.arc(0, by, br, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(0, by, br * 0.995, 0, TAU); g.clip();
      g.globalCompositeOperation = 'lighter';
      var core = g.createRadialGradient(0, by + br * 0.05, 0, 0, by + br * 0.05, br * 0.7);
      core.addColorStop(0, 'rgba(255,255,255,' + (0.08 + 0.5 * e) + ')');
      core.addColorStop(1, 'rgba(214,180,255,0)');
      g.fillStyle = core; g.fillRect(-br, by - br, 2 * br, 2 * br);
      g.beginPath(); g.arc(0, by, br * 0.9, 0.2 * Math.PI, 0.8 * Math.PI);
      glowLine(g, br * 0.09, '230,205,255', 0.25 + 0.25 * e);
      g.restore();
      rim(g, function () { g.beginPath(); g.arc(0, by, br * 0.985, 0, TAU); }, R * 0.95, e);
      shines(g, R, [[-0.3, BALL_Y - 0.4, 0.3, 0.8, -0.6]], [-0.47, BALL_Y - 0.48, 0.05]);
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = br * 0.03; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(0, by, br * 0.8, -0.25 * Math.PI, 0.05 * Math.PI); g.stroke();
      // the front lip of the stand, in front of the ball
      g.globalCompositeOperation = 'source-over';
      var lg = g.createLinearGradient(0, R * 0.44, 0, R * 0.6);
      lg.addColorStop(0, '#7b3fc4'); lg.addColorStop(1, '#3d1468');
      g.fillStyle = lg; g.beginPath(); g.ellipse(0, R * 0.52, R * 0.46, R * 0.075, 0, 0, TAU); g.fill();
      g.globalCompositeOperation = 'lighter';
      g.beginPath(); g.ellipse(0, R * 0.52, R * 0.46, R * 0.075, 0, 0, TAU);
      glowLine(g, R * 0.016, '255,255,255', 0.55 + 0.35 * e);
      g.globalCompositeOperation = 'source-over';
    }
  };

  // ───────────── one frame

  MomoLight.prototype.draw = function (now) {
    var dt = this.last == null ? 0 : Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now;
    var t = now / 1000, g = this.g, W = this.W, H = this.H, dpr = this.dpr;

    // ── how loud she is: quick to rise, quick to fall, so every syllable is its own pulse
    var raw = this.raw();
    var up = 1 - Math.exp(-dt / 0.018), down = 1 - Math.exp(-dt / 0.07);
    this.level += (raw - this.level) * (raw > this.level ? up : down);
    this.slow += (raw - this.slow) * (1 - Math.exp(-dt / 0.3));
    // the start of a loud syllable sends out a ring of light and a few sparkles
    if (raw > 0.4 && raw > this.slow + 0.14 && t - this.lastRing > 0.15) {
      this.lastRing = t; this.rings.push({ t: t, k: Math.min(1, raw) }); this.beat = 1;
      for (var n = 0; n < 4; n++) this.motes.push({ t: t, a: Math.random() * TAU, v: 0.7 + Math.random() * 0.9, sz: 0.5 + Math.random() * 0.6 });
    }
    var speaking = this.media && !this.media.paused && !this.media.ended;
    var breath = 0.07 + 0.07 * Math.sin(t * TAU / 3.4);       // resting: a slow breath
    var e = Math.max(this.level, speaking ? 0.04 : breath);
    this.beat = Math.max(0, this.beat - dt / 0.3);
    this.flap += dt * (1.6 + 9 * e);                          // the butterfly's wings beat faster while she talks

    var shape = this.shape;
    var L = this.layout ? this.layout(W, H) : null;
    var cx = L ? L.cx : W / 2, cy = (L ? L.cy : H / 2) + Math.sin(t * 0.9) * Math.min(W, H) * 0.008;
    var R0 = L ? L.R0 : Math.min(W * 0.25, H * 0.28), Rb = R0 * BASE[shape];
    var R = Rb * (1 + SWELL[shape] * e);
    if (shape === 'heart') R += Rb * 0.08 * Math.sin(Math.PI * Math.pow(this.beat, 0.6));   // the heart's pump
    var sx = shape === 'butterfly' ? 1 - (0.06 + 0.34 * e) * (0.5 + 0.5 * Math.sin(this.flap)) : 1;
    var rock = { gem: 0.035 * Math.sin(t * 0.7), heart: 0.03 * Math.sin(t * 0.8), star: 0.06 * Math.sin(t * 0.6),
      flower: t * 0.08, butterfly: 0.04 * Math.sin(t * 0.5), crown: 0.03 * Math.sin(t * 0.7) }[shape] || 0;

    // ── the night behind her, and a wash of lilac light that fills the card when she talks
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    if (this.ownBg) g.drawImage(this.background(), 0, 0);
    else if (this.clear) g.clearRect(0, 0, this.c.width, this.c.height);
    g.globalCompositeOperation = 'lighter';
    var wr = Math.max(W, H) * 0.75;
    var gk = this.glow;
    stamp(g, soft('wash'), cx, cy, wr, wr, 0, 0.13 * e * gk, dpr);

    // ── rays of white light, two sets turning opposite ways
    var r0 = R * (2.4 + 0.95 * e), r1 = R * (1.9 + 0.6 * e);
    stamp(g, soft('rays0'), cx, cy, r0, r0, t * 0.11, gk * (0.13 + 0.2 * e) / 0.33 * (0.92 + 0.08 * Math.sin(t * 1.3)), dpr);
    stamp(g, soft('rays1'), cx, cy, r1, r1, 0.3 - t * 0.07, gk * (0.10 + 0.12 * e) / 0.22, dpr);

    // ── the white halo around her
    var hr = R * (1.7 + 0.9 * e);
    stamp(g, soft(shape === 'orb' ? 'haloOrb' : 'halo'), cx, cy, hr, hr, 0, gk * (0.62 + 0.33 * e) / 0.95, dpr);

    // ── rings of light that ripple out in her shape on loud syllables
    if (this.rings.length) {
      var rs = ringSprite(shape, Rb, dpr), ry = shape === 'ball' ? BALL_Y * R : 0;
      for (var j = this.rings.length - 1; j >= 0; j--) {
        var ring = this.rings[j], p = (t - ring.t) / 1.25;
        if (p >= 1) { this.rings.splice(j, 1); continue; }
        var ep = 1 - Math.pow(1 - p, 3), scale = (1.03 + 1.45 * ep) * R / rs.Rs, fade = Math.pow(1 - p, 1.6) * ring.k;
        var rh = rs.ext * rs.Rs * scale;
        stamp(g, rs.c, cx - Math.sin(rock) * ry, cy + Math.cos(rock) * ry, rh, rh, rock, fade * 0.9 * Math.min(1, gk * 1.3), dpr);
      }
    }

    // ── Momo: her glow, then her body blended from quiet to fully lit by how loud she is
    var gs = glowSprite(shape, Rb, dpr), gh = gs.ext * R * (1 + 0.22 * e);
    stamp(g, gs.c, cx, cy, gh * sx, gh, rock, gk * (shape === 'orb' ? 0.6 : 1) * (0.48 + 0.34 * e), dpr);
    var bs = bodySprites(shape, Rb, dpr), bh = bs.ext * R;
    g.globalCompositeOperation = 'source-over';
    stamp(g, bs.c0, cx, cy, bh * sx, bh, rock, 1, dpr);
    stamp(g, bs.c1, cx, cy, bh * sx, bh, rock, e, dpr);

    // what moves inside her
    g.globalCompositeOperation = 'lighter';
    var cr = Math.cos(rock), sr = Math.sin(rock);
    if (SWIRL[shape]) {
      var oy = SWIRL[shape][1] * R;
      for (var k = 0; k < 3; k++) {
        var sp = swirlSprite(shape, k, Rb, dpr), sh = sp.half * R;
        stamp(g, sp.c, cx - sr * oy, cy + cr * oy, sh, sh, rock + t * (0.22 + 0.1 * k) * (k % 2 ? -1 : 1) + k * 2.1,
          (k === 2 ? 0.10 : 0.16) + (k === 2 ? 0.32 : 0.26) * e, dpr);
      }
    } else if (shape === 'ball') {
      var ms = mistSprite(Rb, dpr), mh = ms.half * R, my = BALL_Y * R;
      stamp(g, ms.c, cx, cy + my, mh, mh, t * 0.3, 0.35 + 0.65 * e, dpr);
    }
    if (shape === 'gem') this.gemLive(g, cx, cy, R, e, t, rock, dpr);
    if (shape === 'crown' && e > 0.2) {
      var top = (CROWN[5][1] + CROWN_DY) * R - R * 0.04;
      sparkle(g, cx - sr * top, cy + cr * top, R * 0.2 * e, t * 0.8, e, dpr);
    }

    // ── sparkles circling her, faster and brighter when she talks
    for (var s = 0; s < this.sparks.length; s++) {
      var spk = this.sparks[s];
      spk.a += spk.s * dt * (1 + 2.5 * e);
      var tw = 0.5 + 0.5 * Math.sin(t * 2.4 + spk.ph);
      var dist = R * (spk.r + 0.18 * e);
      sparkle(g, cx + Math.cos(spk.a) * dist, cy + Math.sin(spk.a) * dist * 0.92,
        R * 0.075 * spk.sz * (0.6 + 0.7 * tw) * (1 + 0.6 * e), t * 0.6 + spk.ph, (0.25 + 0.75 * tw) * (0.5 + 0.5 * e), dpr);
    }
    // sparkles flung out by a loud syllable
    for (var m = this.motes.length - 1; m >= 0; m--) {
      var mo = this.motes[m], q = (t - mo.t) / 1.0;
      if (q >= 1) { this.motes.splice(m, 1); continue; }
      var d = R * (1.05 + mo.v * 1.3 * (1 - Math.pow(1 - q, 2)));
      sparkle(g, cx + Math.cos(mo.a) * d, cy + Math.sin(mo.a) * d, R * 0.09 * mo.sz * (1 - q * 0.6), q * 3, 1 - q, dpr);
    }
    // the rounded corners
    var cr2 = Math.min(this.corner, W / 2, H / 2);
    if (cr2 > 0) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(cr2, 0); g.arcTo(0, 0, 0, cr2, cr2); g.closePath();
      g.moveTo(W, 0); g.lineTo(W, cr2); g.arcTo(W, 0, W - cr2, 0, cr2); g.closePath();
      g.moveTo(W, H); g.lineTo(W - cr2, H); g.arcTo(W, H, W, H - cr2, cr2); g.closePath();
      g.moveTo(0, H); g.lineTo(0, H - cr2); g.arcTo(0, H, cr2, H, cr2); g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  };

  function sparkle(g, x, y, s, rot, alpha, dpr) {
    stamp(g, soft('spark'), x, y, s * 1.1, s * 1.1, rot, alpha, dpr);
  }

  // the gem's live light: the facets flashing most right now (a few each frame), a glint sweeping across, two flares
  MomoLight.prototype.gemLive = function (g, cx, cy, R, e, t, rock, dpr) {
    var gx = ((t * 0.42) % 2.6) - 1.3, best = [];
    for (var i = 0; i < GEM_FACETS.length; i++) {
      var f = GEM_FACETS[i];
      var v = e * 0.26 * Math.pow(0.5 + 0.5 * Math.sin(t * 5.5 + i * 1.9), 3) + Math.exp(-Math.pow(f.mx - gx, 2) / 0.05) * 0.3;
      if (v > 0.04) best.push([v, f]);
    }
    best.sort(function (a, b) { return b[0] - a[0]; });
    var c = Math.cos(rock), s = Math.sin(rock);
    g.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, cx * dpr, cy * dpr);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    for (var j = 0; j < Math.min(5, best.length); j++) {
      g.fillStyle = 'rgba(255,255,255,' + Math.min(0.55, best[j][0]) + ')';
      poly(g, best[j][1].pts, R); g.fill();
    }
    g.globalCompositeOperation = 'lighter';
    var f1 = 0.5 + 0.5 * Math.sin(t * 2.1), f2 = 0.5 + 0.5 * Math.sin(t * 1.7 + 2);
    function at(p) { return [cx + (p[0] * c - p[1] * s) * R, cy + (p[0] * s + p[1] * c) * R]; }
    var a = at(GT[3]), b = at(GG[0]);
    sparkle(g, a[0], a[1], R * (0.1 + 0.22 * e) * (0.5 + 0.5 * f1), t * 0.5, 0.6 + 0.4 * e, dpr);
    sparkle(g, b[0], b[1], R * (0.07 + 0.16 * e) * (0.5 + 0.5 * f2), -t * 0.4, 0.5 + 0.5 * e, dpr);
  };

  root.MomoLight = MomoLight;
})(window);
