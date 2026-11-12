// The Momma Lewis Momo Learning Is FUN (public app, ages 2-7) — the whole app: splash → Momo's intro (her heart and the
// 8 characters) → pick a character → pick a level (Easy, Normal, Hard, Expert, with bars) → the child's name (optional,
// never kept) → subject → questions (Momo's question, A/B/C or a tap on the answer in the picture, the character's
// video, then Momo's right/wrong line) → stars.
// Momo's small heart in the top bar pulses with her words (every clip's loudness is measured ahead of time, js/voice-env.js);
// a tap on it starts the question over, and when she has finished it turns into the Replay arrow.
// Every level: a missed question comes back once at the end of the round. "Mix up" (remembered) mixes the order.
// Questions come from js/content.js (built by tools/build_content.py). Works the same on Android (WebView), Linux and the web.
(function () {
  'use strict';
  var VERSION = '1.2.0';
  var C = window.MOMO_CONTENT || { levels: [], characters: [] };
  var $ = function (id) { return document.getElementById(id); };
  var TEST = { fast: false };              // tests: media "plays" for a moment instead of its full length
  var state = { screen: 'splash', char: null, mode: null, set: null, round: null, kid: '' };
  var screens = ['splash', 'home', 'mode', 'name', 'subjects', 'quiz', 'done', 'credits'];

  // ───────────── helpers
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, TEST.fast ? Math.min(ms, 30) : ms); }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function icon(name) { return '<svg><use href="#i-' + name + '"/></svg>'; }
  function charById(id) { for (var i = 0; i < C.characters.length; i++) if (C.characters[i].id === id) return C.characters[i]; return null; }
  function setsWith(mode) { return mode.sets.filter(function (s) { return s.questions.length; }); }
  function count(mode) { var n = 0; mode.sets.forEach(function (s) { n += s.questions.length; }); return n; }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // the grown-up's choices, kept on this device (a browser that blocks storage just forgets them)
  function load(key, dflt) { try { var v = window.localStorage.getItem('momo.' + key); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function save(key, v) { try { window.localStorage.setItem('momo.' + key, v); } catch (e) { /* not kept */ } }
  var settings = { mix: load('mix', '0') === '1' };
  function drawMix() {
    Array.prototype.forEach.call(document.querySelectorAll('.mix'), function (b) {
      b.classList.toggle('on', settings.mix); b.setAttribute('aria-pressed', settings.mix ? 'true' : 'false');
    });
  }
  function setMix(on) {
    settings.mix = !!on; save('mix', on ? '1' : '0'); drawMix();
    toast(on ? 'Mixed up: a new order every time!' : 'In order: question 1 first');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.mix'), function (b) { b.addEventListener('click', function () { setMix(!settings.mix); }); });
  drawMix();

  function show(name) {
    screens.forEach(function (s) { $(s).classList.toggle('show', s === name); });
    state.screen = name;
    $('toast').classList.remove('show');
    if (name !== 'home') pauseIntro();
    layout();
  }

  // ───────────── sound and video. One clip at a time; each play resolves when it ends, is skipped or fails.
  var voice = new Audio(); voice.preload = 'auto';
  var current = null;          // { media, done } of what is playing now
  var paused = null;           // what the app pause stopped (resumed when the app comes back)

  function playMedia(media, src) {
    stopMedia();
    return new Promise(function (resolve) {
      var finished = false, guard = null;
      function done(why) {
        if (finished) return; finished = true;
        clearTimeout(guard);
        media.removeEventListener('ended', onEnd); media.removeEventListener('error', onErr);
        if (current && current.media === media) current = null;
        resolve(why || 'ended');
      }
      function onEnd() { done('ended'); }
      function onErr() { done('error'); }
      current = { media: media, done: done, src: src };
      if (TEST.fast) { guard = setTimeout(function () { done('ended'); }, 250); return; }
      var started = Date.now();
      media.addEventListener('ended', onEnd); media.addEventListener('error', onErr);
      if (media.getAttribute('src') !== src) media.src = src;
      try { media.currentTime = 0; } catch (e) { /* not loaded yet */ }
      var p = media.play();
      if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') done('blocked'); });
      // never hang: a clip that stalls ends on its own after its length + a little (or 45 s)
      (function watch() {
        guard = setTimeout(function () {
          if (finished) return;
          var d = media.duration;
          if (isFinite(d) && d > 0 && media.currentTime >= d - 0.05) return done('ended');
          if (!media.paused || paused) return watch();
          if (Date.now() - started > 45000) return done('stalled');
          watch();
        }, 1000);
      })();
    });
  }
  function stopMedia() {
    if (!current) return;
    var c = current; current = null;
    try { c.media.pause(); } catch (e) { /* ignore */ }
    c.done('stopped');
  }
  function skipMedia() { stopMedia(); }

  // In a web browser (the password-gated "momo" web folder), Safari and others let a sound or video start by itself
  // only after it has played once during a tap. The first tap anywhere plays a moment of silence on Momo's voice and
  // on the video player, so the later questions and the characters' videos can play. The apps don't need this
  // (Android loads https://momo.app/, Linux a file:// page, and both allow playback without a tap).
  var IN_BROWSER = /^https?:$/.test(location.protocol) && location.hostname !== 'momo.app';
  var silence = null;
  function silentWav() {
    var n = 800, b = new Uint8Array(44 + n), d = new DataView(b.buffer);
    var str = function (o, t) { for (var i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); d.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); d.setUint32(16, 16, true);
    d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, 8000, true); d.setUint32(28, 8000, true);
    d.setUint16(32, 1, true); d.setUint16(34, 8, true); str(36, 'data'); d.setUint32(40, n, true);
    for (var i = 0; i < n; i++) b[44 + i] = 128;
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function unlockMedia() {
    [voice, $('fbVideo')].forEach(function (m) {
      if (m.unlocked || m.getAttribute('src')) { m.unlocked = true; return; }   // already played for real
      m.unlocked = true;
      try { silence = silence || silentWav(); } catch (e) { return; }
      m.src = silence;
      var p = m.play();
      if (p && p.then) p.then(function () { if (m.getAttribute('src') === silence) m.pause(); }, function () { /* the real clip took over */ });
    });
  }
  if (IN_BROWSER) ['touchend', 'click', 'keydown'].forEach(function (t) { document.addEventListener(t, unlockMedia, true); });

  // ───────────── the app going to the background and back (Android calls these; Linux too when the window hides)
  window.__momoPause = function () {
    var list = [];
    if (current && !current.media.paused) list.push(current.media);
    var iv = $('intro'); if (!iv.paused) list.push(iv);
    list.forEach(function (m) { try { m.pause(); } catch (e) { /* ignore */ } });
    // Android pauses twice (the activity, then the page going hidden): keep what the first one stopped
    if (list.length) paused = (paused || []).concat(list.filter(function (m) { return !paused || paused.indexOf(m) < 0; }));
  };
  window.__momoResume = function () {
    var list = paused; paused = null;
    if (list) list.forEach(function (m) { var p = m.play(); if (p && p.catch) p.catch(function () { /* stays paused */ }); });
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden) window.__momoPause(); else window.__momoResume(); });

  // ───────────── splash
  function splash() {
    var t0 = Date.now(), img = document.querySelector('.splash-badge');
    var ready = img.complete ? Promise.resolve() : new Promise(function (r) { img.onload = img.onerror = r; });
    var font = document.fonts && document.fonts.load ? document.fonts.load('700 20px Fredoka').catch(function () {}) : Promise.resolve();
    Promise.all([ready, font]).then(function () {
      var wait = Math.max(0, (TEST.fast ? 50 : 2400) - (Date.now() - t0));
      setTimeout(function () {
        // home comes up underneath while the logo fades away on top (no empty moment between them)
        var s = $('splash');
        show('home'); s.classList.add('show', 'leaving');
        playIntro(true);
        setTimeout(function () { s.classList.remove('show', 'leaving'); }, TEST.fast ? 10 : 450);
      }, wait);
    });
  }

  // ───────────── home: Momo's intro (plays by itself once per launch).
  // v1.2.0 (owner, 2026-11-11/12): a tap on one of the 8 characters in the ring picks it, once it has popped in (the
  // poster shows all 8, so before the intro starts they all count); a tap on Momo's heart starts the intro over, while it
  // plays or after; a tap anywhere else does nothing. The ring is drawn INTO the video by tools/intro/intro.html, so RING
  // copies its layout: a 1920x1080 frame, 8 cards (250 px + gold frame) on an ellipse 690 x 372 around the heart,
  // clockwise from the top in content_map order, popping in at 0.5 + 2.6 + 1.75 i s (tools/make_intro.py LEAD + pops).
  var RING = { w: 1920, h: 1080, rx: 690, ry: 372, half: 140, heart: 215, pops: [] };
  for (var ri = 0; ri < 8; ri++) RING.pops.push(0.5 + 2.6 + ri * 1.75 + 0.15);
  var introAuto = false, introStarted = false;
  function setIntroBtn(kind) { $('introBtn').innerHTML = icon(kind); }
  function playIntro(auto, fromStart) {
    var v = $('intro');
    if (auto) { if (introAuto) return; introAuto = true; }
    if (TEST.fast && auto) return;
    if (v.ended || fromStart) { try { v.currentTime = 0; } catch (e) { /* ignore */ } }
    var p = v.play();
    if (p && p.catch) p.catch(function () { $('introCard').classList.remove('playing'); setIntroBtn(introStarted ? 'replay' : 'play'); });
  }
  function pauseIntro() { var v = $('intro'); if (!v.paused) v.pause(); }
  // where a tap on the intro lands: 'heart', a character's index (0-7), or null (the sky)
  function introSpot(clientX, clientY) {
    var r = $('intro').getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var s = Math.max(r.width / RING.w, r.height / RING.h);          // the video is object-fit: cover
    var x = (clientX - r.left - (r.width - RING.w * s) / 2) / s, y = (clientY - r.top - (r.height - RING.h * s) / 2) / s;
    var cx = RING.w / 2, cy = RING.h / 2;
    if (Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) <= RING.heart) return 'heart';
    var best = null, bd = 1e9;
    for (var i = 0; i < 8; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 4, sx = cx + Math.cos(a) * RING.rx, sy = cy + Math.sin(a) * RING.ry;
      if (Math.abs(x - sx) <= RING.half && Math.abs(y - sy) <= RING.half) {
        var d = (x - sx) * (x - sx) + (y - sy) * (y - sy); if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
  function ringShown(i) { var v = $('intro'); return !introStarted || v.ended || v.currentTime >= RING.pops[i]; }
  function introTap(e) {
    // the round button over the heart (play/replay) and a keyboard press count as the heart
    var hit = (e.detail === 0 || (e.target.closest && e.target.closest('#introBtn'))) ? 'heart' : introSpot(e.clientX, e.clientY);
    if (hit === 'heart') { playIntro(false, true); return 'heart'; }
    if (hit !== null && ringShown(hit)) { pickChar(C.characters[hit].id); return C.characters[hit].id; }
    return null;
  }
  (function () {
    var v = $('intro'), card = $('introCard');
    v.addEventListener('play', function () { introStarted = true; card.classList.add('playing'); $('friends').classList.remove('invite'); });
    v.addEventListener('pause', function () { card.classList.remove('playing'); setIntroBtn(introStarted ? 'replay' : 'play'); });
    v.addEventListener('ended', function () { card.classList.remove('playing'); setIntroBtn('replay'); $('friends').classList.add('invite'); });
    card.addEventListener('click', introTap);
    // the pointer turns into a hand only over the heart and the characters already showing
    card.addEventListener('mousemove', function (e) {
      var hit = introSpot(e.clientX, e.clientY);
      card.style.cursor = (hit === 'heart' || (hit !== null && ringShown(hit))) ? 'pointer' : '';
    });
    // the 8 characters, pictures only (no names: owner, 2026-11-10)
    var fr = $('friends');
    C.characters.forEach(function (ch, i) {
      var b = el('button', 'friend card');
      b.setAttribute('data-char', ch.id); b.setAttribute('aria-label', 'Pick ' + ch.alt);
      b.style.setProperty('--i', String(i));
      var img = el('img'); img.src = ch.image; img.alt = ch.alt; b.appendChild(img);
      b.addEventListener('click', function () { pickChar(ch.id); });
      fr.appendChild(b);
    });
    $('creditsBtn').addEventListener('click', function () { show('credits'); });
  })();

  // ───────────── the level: Easy, Normal, Hard, Expert. Rising bars show how hard (1 to 4 filled, in gold).
  function bars(n) {
    var h = '<span class="bars" aria-hidden="true">';
    for (var i = 1; i <= 4; i++) h += '<i class="b' + i + (i <= n ? ' on' : '') + '"></i>';
    return h + '</span>';
  }
  function pickChar(id) {
    var ch = charById(id); if (!ch) return;
    state.char = ch; state.mode = null; state.set = null;
    $('modeHero').src = ch.image; $('modeHero').alt = ch.alt;
    var box = $('modeBtns'); box.innerHTML = '';
    C.levels.forEach(function (m) {
      var n = count(m);
      var b = el('button', 'mode-btn ' + m.id + (n ? '' : ' soon'),
        '<span class="big">' + m.label + '</span>' + bars(m.bars) + (n ? '' : '<span class="ribbon">Coming soon</span>'));
      b.setAttribute('data-mode', m.id);
      b.setAttribute('aria-label', m.label + ', ' + m.bars + ' of 4 bars' + (n ? '' : ', coming soon'));
      b.addEventListener('click', function () { pickMode(m); });
      box.appendChild(b);
    });
    show('mode');
  }
  function pickMode(m) {
    if (!count(m)) { toast(m.label + ' is coming soon!'); return; }
    state.mode = m;
    askName();
  }

  // ───────────── the child's name: optional, shown in the quiz and on the stars, never saved (asked fresh each time)
  // letters only (any language), spaces, ' - . ; each word starts with a capital ("ava" → "Ava")
  function cleanName(v) {
    var t = String(v || '').replace(/[^\p{L}\p{M} '\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
    return t.replace(/(^|[\s\-])(\p{Ll})/gu, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function askName() {
    $('nameHero').src = state.char.image; $('nameHero').alt = state.char.alt;
    $('nameInput').value = '';
    show('name');
  }
  function nameDone(name) {
    state.kid = cleanName(name);
    try { $('nameInput').blur(); } catch (e) { /* ignore */ }
    toSubjects();
  }
  $('nameForm').addEventListener('submit', function (e) { e.preventDefault(); nameDone($('nameInput').value); });
  $('nameSkip').addEventListener('click', function () { nameDone(''); });
  function toSubjects() {
    var m = state.mode, sets = setsWith(m);
    if (sets.length === 1) return startRound([sets[0]]);
    $('subjTitle').textContent = m.label;
    var box = $('tiles'); box.innerHTML = '';
    var all = sets.slice();
    sets.forEach(function (s, i) { box.appendChild(tile(s.title, s.icon, s.questions.length, 'c' + (i % 3), function () { startRound([s]); }, s.id)); });
    box.appendChild(tile('All of them', 'mix', count(m), 'c3', function () { startRound(all); }, 'all'));
    box.style.setProperty('--cols', String(sets.length + 1));
    show('subjects');
  }
  function tile(title, ic, n, cls, onTap, id) {
    var glyph = ic === 'abc' ? 'ABC' : ic === '123' ? '123' : icon(ic || 'star');
    var b = el('button', 'tile ' + cls, '<span class="glyph">' + glyph + '</span><span class="name">' + title + '</span><span class="count">' + n + (n === 1 ? ' question' : ' questions') + '</span>');
    b.setAttribute('data-set', id);
    b.addEventListener('click', onTap);
    return b;
  }

  // ───────────── a round of questions
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  var lastFirst = {};          // mixed rounds: the question each kind of round started with last time
  function order(sets) {
    var list = [], longest = 0;
    if (settings.mix) {
      // mixed up: every question of the subject(s) in a new order, never starting where the last round started
      sets.forEach(function (s) { list = list.concat(s.questions); });
      shuffle(list);
      var key = sets.map(function (s) { return state.mode.id + '/' + s.id; }).join('+');
      if (list.length > 1 && list[0].id === lastFirst[key]) { var k = 1 + Math.floor(Math.random() * (list.length - 1)), t = list[0]; list[0] = list[k]; list[k] = t; }
      if (list.length) lastFirst[key] = list[0].id;
      return list;
    }
    // in order: one subject from question 1; "All of them" takes turns (words 1, math 1, science 1, words 2, …)
    sets.forEach(function (s) { longest = Math.max(longest, s.questions.length); });
    for (var i = 0; i < longest; i++) sets.forEach(function (s) { if (s.questions[i]) list.push(s.questions[i]); });
    return list;
  }
  function startRound(sets) {
    var list = order(sets);
    state.set = sets;
    var round = { id: (startRound.n = (startRound.n || 0) + 1), queue: list.map(function (q) { return { q: q, retry: false }; }), pos: 0, first: list.length, firstRight: 0, marks: [] };
    state.round = round;
    var kid = $('kidName'); kid.hidden = !state.kid; kid.querySelector('span').textContent = state.kid;
    show('quiz');
    runRound(round);
  }
  function alive(round) { return state.round === round && state.screen === 'quiz'; }

  function drawDots(round) {
    var box = $('dots'); box.innerHTML = '';
    var n = round.queue.length;
    // dots while they fit in two rows (at most 20); a bar for longer rounds
    var dot = Math.min(22, Math.max(12, Math.min(innerWidth, innerHeight) * 0.024)) + 6;
    var perRow = Math.max(1, Math.floor((box.clientWidth + 6) / dot));
    var long = n > 20 || (box.clientWidth > 0 && n > perRow * 2);
    box.classList.toggle('long', long);
    if (long) {
      // a long round ("All of them", or many missed ones coming back): a bar that fills up, and "7 / 45"
      box.classList.remove('many');
      var bar = el('div', 'prog'), fill = el('i');
      fill.style.width = (100 * (round.pos + (round.marks[round.pos] != null ? 1 : 0)) / n) + '%';
      bar.appendChild(fill); box.appendChild(bar);
      box.appendChild(el('span', 'pcount', String(Math.min(round.pos + 1, n)) + ' / ' + n));
      return;
    }
    box.classList.toggle('many', n > 16);
    round.queue.forEach(function (item, i) {
      var d = el('span', 'dot' + (i === round.pos ? ' now' : '') + (round.marks[i] === true ? ' ok' : round.marks[i] === false ? ' miss' : ''));
      box.appendChild(d);
    });
  }

  function drawQuestion(q) {
    var img = $('qPic'); img.src = q.pic; img.alt = q.say;
    var box = $('answers'); box.innerHTML = ''; box.classList.remove('locked');
    var letters = ['A', 'B', 'C'].slice(0, q.options.length);
    letters.forEach(function (L, i) {
      var b = el('button', 'ans', '<span class="letter">' + L + '</span><span class="opt"></span><span class="tick">' + icon('check') + '</span>');
      var opt = b.querySelector('.opt'); opt.textContent = q.options[i] || '';
      // a choice that is only a punctuation mark ("," "?" ".") is shown big: at the normal size a 5-year-old can't see it
      if (/^[^\w\s]{1,2}$/.test(opt.textContent)) opt.classList.add('mark');
      b.setAttribute('data-letter', L);
      b.setAttribute('aria-label', 'Option ' + L + ': ' + (q.options[i] || ''));
      box.appendChild(b);
    });
    layout();
  }

  function waitAnswer(round) {
    return new Promise(function (resolve) {
      var box = $('answers');
      function onTap(e) {
        var b = e.target.closest ? e.target.closest('.ans') : null;
        if (!b || box.classList.contains('locked') || !alive(round)) return;
        box.classList.add('locked');
        box.removeEventListener('click', onTap);
        resolve(b.getAttribute('data-letter'));
      }
      box.addEventListener('click', onTap);
      round.cancel = function () { box.removeEventListener('click', onTap); resolve(null); };
    });
  }

  function burst() {
    var box = $('burst'); box.innerHTML = '';
    for (var i = 0; i < 14; i++) {
      var a = (Math.PI * 2 * i) / 14, r = 120 + Math.random() * 120;
      var s = el('i', '', icon('star'));
      s.style.setProperty('--x', Math.round(Math.cos(a) * r) + 'px'); s.style.setProperty('--y', Math.round(Math.sin(a) * r) + 'px');
      s.style.color = ['#f7b733', '#f47ec0', '#49b6f5', '#ffffff'][i % 4];
      box.appendChild(s);
    }
  }

  // start loading a feedback video as soon as the answer is tapped (it plays after the button's little animation),
  // so it is ready when the video layer opens instead of showing a dark frame while it loads
  function preloadVideo(src) {
    var v = $('fbVideo');
    if (!src || TEST.fast || (current && current.media === v)) return;
    if (v.getAttribute('src') !== src) { v.src = src; try { v.load(); } catch (e) { /* plays from the start anyway */ } }
  }
  function playVideo(src, round) {
    if (!src) return Promise.resolve('none');
    var layer = $('vidLayer'), v = $('fbVideo');
    layer.classList.add('show'); layer.setAttribute('aria-hidden', 'false');
    return playMedia(v, src).then(function (why) {
      layer.classList.remove('show'); layer.setAttribute('aria-hidden', 'true');
      return why;
    });
  }

  function runRound(round) {
    (async function () {
      while (alive(round) && round.pos < round.queue.length) {
        var item = round.queue[round.pos], q = item.q;
        drawDots(round); drawQuestion(q);
        $('nextBtn').classList.remove('show'); document.querySelector('#quiz .bar').classList.remove('feedback');
        round.phase = 'asking';
        ask(q);
        var pick, right, misses = 0;
        pick = await waitAnswer(round);
        if (!alive(round) || pick == null) return;
        stopMedia();
        right = pick === q.answer;
        round.phase = 'feedback';
        preloadVideo(right ? state.char.correctVideo : state.char.wrongVideo);
        round.lastPick = pick;
        var buttons = $('answers').querySelectorAll('.ans');
        Array.prototype.forEach.call(buttons, function (b) {
          var L = b.getAttribute('data-letter');
          b.classList.remove('hint', 'wrong');
          if (L === pick) b.classList.add(right ? 'right' : 'wrong'); else b.classList.add('dim');
        });
        if (right) burst();
        round.marks[round.pos] = right && misses === 0;          // a gold dot only for right on the first try
        if (!item.retry && right && misses === 0) round.firstRight++;
        drawDots(round);
        await sleep(right ? 700 : 600);
        if (!alive(round)) return;
        // the character's video, then Momo's line (b = correct, c = wrong, which says the right answer)
        round.phase = 'video';
        await playVideo(right ? state.char.correctVideo : state.char.wrongVideo, round);
        if (!alive(round)) return;
        Array.prototype.forEach.call(buttons, function (b) {
          if (b.getAttribute('data-letter') === q.answer) { b.classList.remove('dim', 'wrong'); b.classList.add('right'); }
        });
        round.phase = 'line';
        $('nextBtn').classList.add('show'); document.querySelector('#quiz .bar').classList.add('feedback');
        await speak(right ? q.right : q.wrong);
        if (!alive(round)) return;
        $('nextBtn').classList.remove('show'); document.querySelector('#quiz .bar').classList.remove('feedback');
        // a missed question comes back once at the end of the round
        if (!right && !item.retry) round.queue.push({ q: q, retry: true });
        await sleep(600);
        if (!alive(round)) return;
        round.pos++;
      }
      if (alive(round)) finish(round);
    })().catch(function (e) { console.error(e); });
  }

  function leaveRound() {
    var r = state.round;
    if (r && r.cancel) r.cancel();
    state.round = null;
    stopMedia();
    $('vidLayer').classList.remove('show');
    $('nextBtn').classList.remove('show'); document.querySelector('#quiz .bar').classList.remove('feedback');
  }

  // ───────────── stars
  function finish(round) {
    state.round = null;
    var ch = state.char, n = round.first, got = round.firstRight;
    $('doneHero').src = ch.image; $('doneHero').alt = ch.alt;
    var cheer = got === n ? 'Super star' : got >= n / 2 ? 'Great job' : 'You did it';
    $('doneTitle').textContent = cheer + (state.kid ? ', ' + state.kid + '!' : '!');
    var st = $('stars'); st.innerHTML = ''; st.classList.toggle('many', n > 12);
    for (var i = 0; i < n; i++) {
      var s = el('span', 's' + (i < got ? ' on' : ''), icon('star'));
      if (i < got) s.style.animationDelay = (0.15 + i * Math.min(0.12, 3 / n)) + 's';   // all lit within about 3 s
      st.appendChild(s);
    }
    $('doneScore').textContent = got + ' of ' + n + ' right on the first try';
    $('moreBtn').style.display = state.mode && setsWith(state.mode).length > 1 ? '' : 'none';
    state.lastRound = { first: n, firstRight: got };
    show('done');
    confetti();
  }
  function confetti() {
    var box = $('confetti'); box.innerHTML = '';
    if (TEST.fast) return;
    var colors = ['#f7b733', '#f47ec0', '#49b6f5', '#d81e5b', '#ffffff', '#4cae4f'];
    for (var i = 0; i < 70; i++) {
      var c = el('i');
      c.style.left = (Math.random() * 100) + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.2 + Math.random() * 2.2) + 's';
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      box.appendChild(c);
    }
    setTimeout(function () { box.innerHTML = ''; }, 5500);
  }
  $('againBtn').addEventListener('click', function () { startRound(state.set); });
  $('moreBtn').addEventListener('click', function () { toSubjects(); });
  $('homeBtn').addEventListener('click', function () { show('home'); });

  // ───────────── buttons in the bars, the Next and Skip buttons
  Array.prototype.forEach.call(document.querySelectorAll('.back'), function (b) { b.addEventListener('click', function () { back(); }); });
  // Momo's heart: pulses with every clip she says (the loudness measured ahead of time, 60 values a second).
  var ENV = window.MOMO_ENV || {}, envCache = {};
  function envFor(src) {
    if (envCache[src]) return envCache[src];
    var b64 = ENV[src]; if (!b64) return null;
    try {
      var bin = atob(b64), v = new Array(bin.length);
      for (var i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
      return (envCache[src] = { fps: 60, v: v });
    } catch (e) { return null; }
  }
  var heart = null;
  try {
    if (window.MomoLight) {
      heart = new MomoLight($('heart'), 'heart', { background: 'none', glow: 0.9,
        layout: function (W, H) { return { cx: W / 2, cy: H / 2, R0: Math.min(W, H) * 0.25 }; } });
      heart.off = true;
    }
  } catch (e) { heart = null; }
  // talking: the heart shows and pulses; otherwise the Replay arrow (asking) or nothing to do (feedback)
  function heartTalking(src) {
    var b = $('hearAgain');
    b.classList.add('talking'); b.classList.remove('nudge');
    b.setAttribute('aria-label', 'Momo is talking. Tap to hear it from the start');
    if (heart) { heart.off = false; heart.follow(voice, envFor(src)); }
  }
  function heartQuiet() {
    var b = $('hearAgain');
    b.classList.remove('talking');
    b.setAttribute('aria-label', 'Replay: hear the question again');
    if (heart) { heart.follow(null); heart.off = true; }
  }
  // Momo's right/wrong line after an answer: the heart pulses with it too
  function speak(src) {
    heartTalking(src);
    return playMedia(voice, src).then(function (why) { heartQuiet(); return why; });
  }
  var asking = null;
  function ask(q, clip) {
    var hear = $('hearAgain'), src = clip || q.ask, p, r = state.round;
    heartTalking(src);
    p = playMedia(voice, src);
    asking = p;
    clearTimeout(ask.nudge);
    p.then(function (why) {
      if (asking !== p) return;
      heartQuiet();
      // no answer a while after Momo stops talking: the Replay arrow wiggles twice to say "tap me to hear it again"
      if (why === 'ended') ask.nudge = setTimeout(function () {
        if (state.round === r && r.phase === 'asking' && asking === p && alive(r)) hear.classList.add('nudge');
      }, TEST.fast ? 50 : 7000);
    });
  }
  $('hearAgain').addEventListener('animationend', function () { $('hearAgain').classList.remove('nudge'); });
  // the heart while she asks = start her over; the arrow after = hear it again (also R on the PC)
  function replay() {
    var r = state.round; if (!r || r.phase !== 'asking' || !alive(r)) return false;
    ask(r.queue[r.pos].q);
    return true;
  }
  $('hearAgain').addEventListener('click', replay);

  // v2.0: tapping an answer drawn in the picture. q.spots (tools/picture_spots.json) has, for each letter, boxes
  // [left, top, right, bottom] in percent of the picture. The picture keeps its shape on screen, so a tap's place in the
  // picture is its place in the <img>. A hit "taps" that letter's button, so everything after is the same as a button.
  function spotAt(q, x, y) {
    var sp = q && q.spots; if (!sp) return null;
    for (var L in sp) {
      if (!Object.prototype.hasOwnProperty.call(sp, L)) continue;
      for (var i = 0; i < sp[L].length; i++) {
        var b = sp[L][i];
        if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return { letter: L, box: b };
      }
    }
    return null;
  }
  function picSpot(e) {
    var r = state.round, q = r && r.queue[r.pos] ? r.queue[r.pos].q : null, rc = $('qPic').getBoundingClientRect();
    if (!q || !rc.width || !rc.height) return null;
    return spotAt(q, 100 * (e.clientX - rc.left) / rc.width, 100 * (e.clientY - rc.top) / rc.height);
  }
  // a quick glow on the card that was tapped, so the child sees the picture "felt" it
  function flashSpot(b) {
    var box = document.querySelector('.pic-box'), pr = box.getBoundingClientRect(), ir = $('qPic').getBoundingClientRect();
    var f = el('i', 'spot-flash');
    f.style.left = Math.round(ir.left - pr.left + ir.width * b[0] / 100) + 'px';
    f.style.top = Math.round(ir.top - pr.top + ir.height * b[1] / 100) + 'px';
    f.style.width = Math.round(ir.width * (b[2] - b[0]) / 100) + 'px';
    f.style.height = Math.round(ir.height * (b[3] - b[1]) / 100) + 'px';
    box.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, TEST.fast ? 60 : 800);
  }
  $('qPic').addEventListener('click', function (e) {
    var r = state.round;
    if (!r || r.phase !== 'asking' || !alive(r) || $('answers').classList.contains('locked')) return;
    var hit = picSpot(e); if (!hit) return;          // not on an answer: nothing (Replay is its own button)
    var btn = $('answers').querySelector('.ans[data-letter="' + hit.letter + '"]'); if (!btn) return;
    flashSpot(hit.box);
    btn.click();
  });
  // with a mouse (the Linux app, a web browser): the hand pointer only over the answers in the picture
  $('qPic').addEventListener('mousemove', function (e) {
    var r = state.round, on = r && r.phase === 'asking' && !$('answers').classList.contains('locked') && picSpot(e);
    this.style.cursor = on ? 'pointer' : '';
  });
  $('skipBtn').addEventListener('click', skipMedia);
  $('nextBtn').addEventListener('click', skipMedia);

  // Back: Android's back button, Esc on the PC, and the ‹ buttons. false = already home (Android closes the app).
  function back() {
    var multi = state.mode && setsWith(state.mode).length > 1;
    switch (state.screen) {
      case 'quiz':
        leaveRound();
        if (multi) toSubjects(); else show('mode');
        return true;
      case 'done':
        if (multi) toSubjects(); else show('mode');
        return true;
      case 'subjects': show('mode'); return true;
      case 'name': show('mode'); return true;
      case 'mode': show('home'); return true;
      case 'credits': show('home'); return true;
      default: return false;
    }
  }
  window.__momoBack = back;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'BrowserBack') { back(); e.preventDefault(); }
    if (state.screen === 'name') return;            // typing a name: A, B, C and R are letters here
    if (state.screen === 'quiz' && state.round && state.round.phase === 'asking' && /^[abcABC]$/.test(e.key)) {
      var b = document.querySelector('.ans[data-letter="' + e.key.toUpperCase() + '"]'); if (b) b.click();
    }
    if (state.screen === 'quiz' && (e.key === 'r' || e.key === 'R') && replay()) e.preventDefault();
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ───────────── sizes: everything fits the window, phones and tablets, portrait and landscape
  var VID = 16 / 9;          // the intro's shape; the characters' pictures are square
  // home: the intro and the 8 characters, as big as they can be. Tries the video above or beside the characters, in
  // 8x1, 4x2 or 2x4, and keeps the one that gives the best mix of a big video and big characters.
  function homeLayout(w, h, g) {
    var best = null;
    [[8, 1], [4, 2], [2, 4], [1, 8]].forEach(function (cr) {
      var c = cr[0], r = cr[1];
      [0.36, 0.42, 0.48, 0.54, 0.6, 0.66].forEach(function (f) {
        // above: the video gets a share f of the height
        var vh = Math.min(h * f, w / VID), vw = vh * VID;
        var s1 = Math.min((w - (c - 1) * g) / c, (h - vh - g - (r - 1) * g) / r);
        // beside: the video gets a share f of the width
        var vw2 = Math.min(w * f, h * VID), vh2 = vw2 / VID;
        var s2 = Math.min((w - vw2 - g - (c - 1) * g) / c, (h - (r - 1) * g) / r);
        [[s1, vw, vh, 'above'], [s2, vw2, vh2, 'beside']].forEach(function (o) {
          var s = o[0]; if (!(s > 30)) return;
          var score = Math.log(o[1] * o[2]) + 1.05 * Math.log(8 * s * s);
          if (!best || score > best.score) best = { score: score, s: s, vw: o[1], vh: o[2], cols: c, how: o[3] };
        });
      });
    });
    return best;
  }
  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    var cs = getComputedStyle(document.documentElement);
    var pad = parseFloat(cs.getPropertyValue('--pad')) || 14;
    if (state.screen === 'home') {
      var g = Math.max(10, pad * 0.9) + 7;            // room for the gold frames
      var top = document.querySelector('.home-top');
      var w = W - 2 * pad - 14, h = H - 2 * pad - 14 - (top ? top.offsetHeight + pad * 0.6 : 0);
      var L = homeLayout(w, h, g); if (!L) return;
      var wrap = $('homeWrap'), intro = $('introCard'), fr = $('friends');
      wrap.classList.toggle('beside', L.how === 'beside');
      wrap.style.gap = g + 'px'; fr.style.gap = g + 'px';
      fr.style.gridTemplateColumns = 'repeat(' + L.cols + ', ' + Math.floor(L.s) + 'px)';
      intro.style.width = Math.floor(L.vw) + 'px'; intro.style.height = Math.floor(L.vh) + 'px';
      Array.prototype.forEach.call(fr.children, function (f) { f.style.width = f.style.height = Math.floor(L.s) + 'px'; });
    } else if (state.screen === 'mode') {
      var body = document.querySelector('.mode-body'), btns = $('modeBtns'), hero = document.querySelector('#mode .hero');
      var bw = body.clientWidth, bh = body.clientHeight, wide = W / H > 1.15, gap = pad * 1.4 + 14;
      var hw;
      if (wide) {
        var colW = Math.max(200, Math.min(440, bw * 0.4));
        btns.style.width = Math.floor(colW) + 'px';
        hw = Math.min(bw - colW - gap, bh - 14);
      } else {
        btns.style.width = '';
        hw = Math.min(bw - 14, bh - btns.offsetHeight - gap);
      }
      hw = Math.max(90, hw);
      hero.style.width = hero.style.height = Math.floor(hw) + 'px';
    } else if (state.screen === 'name') {
      var nb = document.querySelector('.name-body'), nh = document.querySelector('.name-hero'), col = document.querySelector('.name-col');
      var wideN = W / H > 1.15;
      var side = wideN ? Math.min(nb.clientHeight - 14, nb.clientWidth * 0.4) : Math.min(nb.clientWidth - 14, nb.clientHeight - col.offsetHeight - pad * 1.4 - 14);
      side = Math.max(0, Math.min(side, 520));
      nh.style.display = side < 70 ? 'none' : '';      // the phone keyboard is up: the picture makes room
      nh.style.width = nh.style.height = Math.floor(side) + 'px';
    } else if (state.screen === 'quiz') {
      var stage = $('stage'), box = document.querySelector('.pic-box'), ans = $('answers');
      var sw = stage.clientWidth, sh = stage.clientHeight;
      // the picture is as big as possible: answers under it, or beside it when that leaves a bigger picture
      var img = $('qPic'), r = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 1;
      var ansH = Math.min(Math.max(96, H * 0.19), 210), ansW = Math.min(Math.max(120, W * 0.21), 260);
      var under = Math.min(sw - 14, (sh - ansH - pad - 14) * r), beside = Math.min(sw - ansW - pad - 14, (sh - 14) * r);
      var wide2 = beside > under * 1.08;
      stage.classList.toggle('wide', wide2);
      stage.classList.toggle('narrow-ans', wide2 && ansW < 190);
      if (wide2) {
        box.style.height = ''; box.style.flex = ''; ans.style.height = ''; stage.style.justifyContent = '';
      } else {
        // picture and answers sit together in the middle; spare height makes the answer buttons bigger
        var picH = under / r + 14, spare = Math.max(0, sh - picH - ansH - pad);
        var ah = Math.min(250, ansH + spare * 0.45);
        box.style.flex = 'none'; box.style.height = Math.floor(picH) + 'px';
        ans.style.height = Math.floor(ah) + 'px'; stage.style.justifyContent = 'center';
      }
    } else if (state.screen === 'done') {
      var hero2 = document.querySelector('.done-hero');
      var wideD = W / H > 1.15;
      var txt = document.querySelector('.done-text');
      var hw2 = wideD ? Math.min(W * 0.42, H - 2 * pad - 14, 620) : Math.min(W - 2 * pad - 14, H - 2 * pad - txt.offsetHeight - pad * 1.2 - 14, 520);
      hw2 = Math.max(110, hw2);
      hero2.style.width = hero2.style.height = Math.floor(hw2) + 'px';
    }
  }
  window.addEventListener('resize', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  $('qPic').addEventListener('load', layout);

  // ───────────── credits
  (function () {
    if (C.standin) {
      $('standinT').hidden = false; $('standinD').hidden = false;
      $('standinD').textContent = (C.standinVoice || 'An offline voice') + ' reads some of the newest questions until Momo records them.';
    }
    $('verLine').textContent = 'Version ' + VERSION + ' \u00b7 \u00a9 2026 The Wealth Gap Resolution Algorithm Inc. All rights reserved.';
  })();

  // ───────────── for the tests (tests/ and the Android checks drive the app through this)
  window.MOMO = {
    version: VERSION, content: C, state: state, test: TEST, layout: layout, back: back, settings: settings, setMix: setMix, replay: replay, spotAt: spotAt, introSpot: introSpot, ringShown: ringShown, heart: function () { return heart; }, envFor: envFor,
    phase: function () { return state.round ? state.round.phase : null; },
    question: function () { var r = state.round; return r && r.queue[r.pos] ? r.queue[r.pos].q : null; },
    playing: function () { return current ? { src: current.src, time: current.media.currentTime, paused: current.media.paused } : null; }
  };

  if (/[?&]test=fast/.test(location.search) || window.__MOMO_FAST) TEST.fast = true;
  splash();
})();
