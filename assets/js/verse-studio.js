/* ============================================================
   verse-studio.js  (v3)
   In-browser "Verse Studio" for Seed the Word.

   v3 additions
   - Stack MULTIPLE passages: look up several references (or paste text)
     and they queue as slides in order. Manual pasted text also pages.
   - Font color: presets + custom hex / color wheel.
   - Backgrounds: 12 solid-color swatches + custom hex/wheel, the original
     gradients, and custom image upload.
   - Longer durations, including minutes, for whole-chapter passages.
   - Between-slide transitions: crossfade, slide across, fade-through-logo.
   - More entrance animations & fonts.
   - STW logo + "Seed the Word" wordmark at the bottom.
   - Optional soundtrack muxed into a WebM (video+audio).

   Per-slide customization is intentionally deferred to a follow-up.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('verse-studio');
  if (!root) return;

  var openBtn = root.querySelector('#vs-open');
  if (openBtn) openBtn.addEventListener('click', function () { root.classList.add('is-open'); init(); });

  var started = false;
  function init() { if (started) return; started = true; boot(); }

  function boot() {
  // ── Elements ────────────────────────────────────────────────
  var $ = function (sel) { return root.querySelector(sel); };
  var canvas = $('#vs-canvas'); var ctx = canvas.getContext('2d');
  var refInput = $('#vs-ref');
  var addBtn = $('#vs-add');
  var passagesEl = $('#vs-passages');
  var textArea = $('#vs-text');
  var addTextBtn = $('#vs-add-text');
  var attribInput = $('#vs-attrib');
  var showAttrib = $('#vs-show-attrib');
  var formatSel = $('#vs-format');
  var styleSel = $('#vs-style');
  var transSel = $('#vs-transition');
  var fontSel = $('#vs-font');
  var durSel = $('#vs-duration');
  var fontColorWrap = $('#vs-fontcolors');
  var fontHex = $('#vs-font-hex');
  var contrastToggle = $('#vs-contrast');
  var bgWrap = $('#vs-swatches');
  var bgHex = $('#vs-bg-hex');
  var bgUpload = $('#vs-bg-upload');
  var audioUpload = $('#vs-audio-upload');
  var audioName = $('#vs-audio-name');
  var playBtn = $('#vs-play');
  var recBtn = $('#vs-record');
  var statusEl = $('#vs-status');
  var downloadsEl = $('#vs-downloads');

  // ── Config ──────────────────────────────────────────────────
  var FORMATS = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 }, post: { w: 1080, h: 1350 } };

  var GRADIENTS = [
    { type: 'grad', stops: ['#2C5F2E', '#0f2417'] },
    { type: 'grad', stops: ['#1a2740', '#0a0f1c'] },
    { type: 'grad', stops: ['#4a2a52', '#1c1022'] },
    { type: 'grad', stops: ['#c9744d', '#3d2140'] }
  ];
  // 12 solid base colors (reverent, high-contrast-with-white palette)
  var SOLIDS = [
    '#2C5F2E', '#14401f', '#0d1b2a', '#1b263b', '#3d2645', '#5c1a1a',
    '#7c4a1e', '#b8860b', '#0f4c5c', '#264653', '#1a1a1a', '#3a2e1f'
  ];

  // Font color presets
  var FONT_COLORS = ['#ffffff', '#f7ecd0', '#E4CB86', '#C9A54D', '#ffd9a0', '#cfe8d8', '#111111', '#f5c2c2'];

  var state = {
    slides: [],            // [{ text, attribution }]
    attribution: '',       // current editable caption applied to the active add
    showAttribution: true,
    bg: { type: 'grad', stops: GRADIENTS[0].stops },
    bgImage: null,
    fontColor: '#ffffff',
    contrast: true,
    format: 'story',
    style: 'fade',
    transition: 'crossfade',
    font: 'Georgia, serif',
    durationMs: 8000
  };

  // Seed with the default passage so the preview isn't empty.
  state.slides = pageText('For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', '— John 3:16 (KJV)');

  var logo = new Image(); var logoReady = false;
  logo.onload = function () { logoReady = true; drawStatic(); };
  logo.src = 'assets/images/stw-logo-transparent.png';

  var audioObjectUrl = null;
  var rafId = null, animStart = 0, playing = false, lastP = 0;

  // ── Build swatch UIs ────────────────────────────────────────
  function buildSwatches() {
    // gradients
    GRADIENTS.forEach(function (g) {
      var s = document.createElement('button');
      s.type = 'button'; s.className = 'vs-swatch';
      s.style.background = 'linear-gradient(160deg,' + g.stops[0] + ',' + g.stops[1] + ')';
      s.title = 'Gradient';
      s.addEventListener('click', function () {
        state.bg = { type: 'grad', stops: g.stops }; state.bgImage = null;
        setActive(bgWrap, s); drawStatic();
      });
      bgWrap.appendChild(s);
    });
    // solids
    SOLIDS.forEach(function (c) {
      var s = document.createElement('button');
      s.type = 'button'; s.className = 'vs-swatch'; s.style.background = c; s.title = c;
      s.addEventListener('click', function () {
        state.bg = { type: 'solid', color: c }; state.bgImage = null;
        setActive(bgWrap, s); if (bgHex) bgHex.value = c; drawStatic();
      });
      bgWrap.appendChild(s);
    });
    // mark first gradient active
    var first = bgWrap.querySelector('.vs-swatch'); if (first) first.classList.add('is-active');
  }
  function buildFontColors() {
    FONT_COLORS.forEach(function (c, i) {
      var s = document.createElement('button');
      s.type = 'button'; s.className = 'vs-swatch vs-swatch--sm' + (i === 0 ? ' is-active' : '');
      s.style.background = c; s.title = c;
      s.addEventListener('click', function () {
        state.fontColor = c; setActive(fontColorWrap, s); if (fontHex) fontHex.value = c; drawStatic();
      });
      fontColorWrap.appendChild(s);
    });
  }
  function setActive(wrap, el) {
    wrap.querySelectorAll('.vs-swatch').forEach(function (x) { x.classList.remove('is-active'); });
    if (el) el.classList.add('is-active');
  }

  // ── Text paging ─────────────────────────────────────────────
  function pageText(text, attribution) {
    // Returns an array of slide objects for one passage, paging long text.
    var W = canvas.width || 1080, H = canvas.height || 1920;
    var fontSize = Math.round(W * (state.format === 'story' ? 0.060 : 0.055));
    var pad = W * 0.11, maxW = W - pad * 2;
    var lineH = fontSize * 1.34;
    var usableH = H * 0.60;
    var maxLines = Math.max(2, Math.floor(usableH / lineH));
    ctx.font = '600 ' + fontSize + 'px ' + state.font;
    var allLines = wrapLines(text, maxW);
    var out = [];
    for (var i = 0; i < allLines.length; i += maxLines) {
      out.push({ lines: allLines.slice(i, i + maxLines), attribution: attribution || '' });
    }
    if (!out.length) out.push({ lines: [''], attribution: attribution || '' });
    return out;
  }
  function repageAll() {
    // Re-page every stored slide when font/format changes. We keep the raw
    // text per passage group, so rebuild from _raw entries.
    var groups = state._groups || [];
    var slides = [];
    groups.forEach(function (g) { slides = slides.concat(pageText(g.text, g.attribution)); });
    if (slides.length) state.slides = slides;
  }
  function wrapLines(text, maxWidth) {
    var paras = String(text).replace(/\r/g, '').split('\n'); var out = [];
    paras.forEach(function (para) {
      var words = para.replace(/\s+/g, ' ').trim().split(' ');
      if (words.length === 1 && words[0] === '') { out.push(''); return; }
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = words[i]; }
        else line = test;
      }
      if (line) out.push(line);
    });
    return out;
  }

  // ── Passage group management (the "stack") ──────────────────
  state._groups = [{ text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', attribution: '— John 3:16 (KJV)', label: 'John 3:16' }];

  function renderPassages() {
    passagesEl.innerHTML = '';
    state._groups.forEach(function (g, idx) {
      var chip = document.createElement('span');
      chip.className = 'vs-chip';
      chip.innerHTML = '<span class="vs-chip__label">' + escapeHtml(g.label || ('Passage ' + (idx + 1))) + '</span>';
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'vs-chip__x'; x.setAttribute('aria-label', 'Remove'); x.textContent = '×';
      x.addEventListener('click', function () { state._groups.splice(idx, 1); rebuild(); });
      chip.appendChild(x);
      passagesEl.appendChild(chip);
    });
  }
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function rebuild() {
    if (!state._groups.length) {
      state.slides = [{ lines: ['Add a passage to begin'], attribution: '' }];
    } else {
      repageAll();
    }
    renderPassages();
    drawStatic();
  }

  // ── Easing ──────────────────────────────────────────────────
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ── Background painter ──────────────────────────────────────
  function paintBackground(p) {
    var W = canvas.width, H = canvas.height;
    if (state.bgImage) {
      var img = state.bgImage, ir = img.width / img.height, cr = W / H, dw, dh, dx, dy;
      if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
      else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
      var z = 1 + 0.06 * p;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(img, dx, dy, dw, dh); ctx.restore();
    } else if (state.bg.type === 'solid') {
      ctx.fillStyle = state.bg.color; ctx.fillRect(0, 0, W, H);
    } else {
      var grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
      grad.addColorStop(0, state.bg.stops[0]); grad.addColorStop(1, state.bg.stops[1]);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  // ── Draw the text of one slide with entrance animation ──────
  function drawSlideText(slide, local, alpha, dx) {
    var W = canvas.width, H = canvas.height;
    var fontSize = Math.round(W * (state.format === 'story' ? 0.060 : 0.055));
    var lineH = fontSize * 1.34;
    var lines = slide.lines;
    var totalH = lines.length * lineH;
    var startY = (H - totalH) / 2 + lineH / 2 - H * 0.02;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 ' + fontSize + 'px ' + state.font; ctx.fillStyle = state.fontColor;

    var appear = easeOut(Math.min(1, local / 0.20));

    // Legibility scrim: a soft dark panel behind the text block so text pops
    // on busy photo/gradient backgrounds. Skipped if the user turns it off.
    if (state.contrast) {
      var blockTop = startY - lineH * 0.9;
      var blockBottom = startY + lines.length * lineH + lineH * (slide.attribution && state.showAttribution ? 1.1 : 0.4);
      var bh = blockBottom - blockTop;
      var sg = ctx.createLinearGradient(0, blockTop, 0, blockBottom);
      sg.addColorStop(0, 'rgba(0,0,0,0)');
      sg.addColorStop(0.18, 'rgba(0,0,0,0.42)');
      sg.addColorStop(0.82, 'rgba(0,0,0,0.42)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalAlpha = alpha * appear;
      ctx.fillStyle = sg;
      ctx.fillRect(0, blockTop, W, bh);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(dx, 0);

    // Drop shadow so the letters separate from whatever is behind them.
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = Math.round(fontSize * 0.28);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(fontSize * 0.06);
    if (state.style === 'fade') {
      ctx.globalAlpha = alpha * appear;
      var sh = (1 - appear) * (H * 0.025);
      lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, startY + i * lineH + sh); });
    } else if (state.style === 'rise') {
      lines.forEach(function (ln, i) {
        var lp = Math.min(1, Math.max(0, (local - i * 0.05) / 0.3));
        ctx.globalAlpha = alpha * easeOut(lp);
        var dy = (1 - easeOut(lp)) * (H * 0.045);
        ctx.fillText(ln, W / 2, startY + i * lineH + dy);
      });
    } else if (state.style === 'zoom') {
      var zc = 0.92 + 0.08 * appear;
      ctx.globalAlpha = alpha * appear;
      ctx.translate(W / 2, H / 2); ctx.scale(zc, zc); ctx.translate(-W / 2, -H / 2);
      lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, startY + i * lineH); });
    } else if (state.style === 'typewriter') {
      var full = lines.join(' ');
      var chars = Math.floor(easeOut(Math.min(1, local / 0.85)) * full.length);
      var shown = full.slice(0, chars);
      // re-wrap the shown text into the same line count
      ctx.globalAlpha = alpha;
      var reflow = wrapLines(shown, W - W * 0.22);
      reflow.forEach(function (ln, i) { ctx.fillText(ln, W / 2, startY + i * lineH); });
    } else { // word
      var totalWords = 0; lines.forEach(function (l) { totalWords += l.split(' ').length; });
      var sw = Math.floor(easeOut(Math.min(1, local / 0.8)) * totalWords);
      var count = 0; ctx.globalAlpha = alpha;
      lines.forEach(function (ln, i) {
        var lw = ln.split(' '), vis = [];
        for (var w = 0; w < lw.length; w++) { if (count < sw) { vis.push(lw[w]); count++; } }
        if (vis.length) ctx.fillText(vis.join(' '), W / 2, startY + i * lineH);
      });
    }
    // attribution
    if (state.showAttribution && slide.attribution) {
      ctx.globalAlpha = alpha * easeOut(Math.min(1, Math.max(0, (local - 0.25) / 0.4)));
      ctx.fillStyle = '#E4CB86';
      ctx.font = '700 ' + Math.round(fontSize * 0.6) + 'px ' + state.font;
      ctx.fillText(slide.attribution, W / 2, startY + lines.length * lineH + lineH * 0.4);
    }
    ctx.restore();
  }

  function drawLogo(alpha) {
    var W = canvas.width, H = canvas.height;
    ctx.globalAlpha = (alpha == null ? 0.95 : alpha);
    if (logoReady) {
      var lw = W * 0.16, lh = lw * (logo.height / logo.width);
      var y = H - lh - H * 0.075;
      ctx.drawImage(logo, (W - lw) / 2, y, lw, lh);
      // "Seed the Word" text under the logo
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = "600 " + Math.round(W * 0.03) + "px 'Dancing Script', Georgia, serif";
      ctx.fillText('Seed the Word', W / 2, y + lh + H * 0.028);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.round(W * 0.03) + 'px Georgia, serif';
      ctx.fillText('Seed the Word', W / 2, H - H * 0.06);
    }
    ctx.globalAlpha = 1;
  }

  // ── Frame at global progress p (0..1) across all slides ─────
  function drawFrame(p) {
    lastP = p;
    var W = canvas.width, H = canvas.height;
    var n = state.slides.length;
    var slideP = p * n;
    var idx = Math.min(n - 1, Math.floor(slideP));
    var local = slideP - idx;
    var TR = 0.16; // fraction of each slide spent transitioning out

    paintBackground(p);

    var transitioning = (idx < n - 1) && (local > 1 - TR);
    var tp = transitioning ? (local - (1 - TR)) / TR : 0; // 0..1 transition progress

    if (state.transition === 'fadelogo' && transitioning) {
      // Fade current out, flash logo, fade next in — handled across the window
      var half = tp < 0.5 ? tp / 0.5 : 1 - (tp - 0.5) / 0.5;
      drawSlideText(state.slides[idx], local, 1 - tp, 0);
      drawSlideText(state.slides[idx + 1], 0.001, tp, 0);
      drawLogo(0.4 + 0.6 * half); // logo pulses at the seam
      return;
    }
    if (state.transition === 'slide' && transitioning) {
      drawSlideText(state.slides[idx], local, 1, -W * easeInOut(tp));
      drawSlideText(state.slides[idx + 1], easeInOut(tp) * 0.2, 1, W * (1 - easeInOut(tp)));
      drawLogo();
      return;
    }
    // default: crossfade
    if (transitioning) {
      drawSlideText(state.slides[idx], local, 1 - tp, 0);
      drawSlideText(state.slides[idx + 1], tp * 0.2, tp, 0);
    } else {
      drawSlideText(state.slides[idx], local, 1, 0);
    }
    drawLogo();
  }
  function drawStatic() { drawFrame(lastP || 0.06); }

  // ── Animation loop ──────────────────────────────────────────
  function loop(ts) {
    if (!animStart) animStart = ts;
    var elapsed = ts - animStart;
    var p = Math.min(1, elapsed / state.durationMs);
    drawFrame(p);
    if (elapsed < state.durationMs && playing) rafId = requestAnimationFrame(loop);
    else { playing = false; playBtn.textContent = '▶ Preview'; }
  }
  function play() {
    cancelAnimationFrame(rafId); animStart = 0; playing = true;
    playBtn.textContent = '❚❚ Playing…';
    rafId = requestAnimationFrame(loop);
  }

  function applyFormat() { var f = FORMATS[state.format]; canvas.width = f.w; canvas.height = f.h; repageAll(); drawStatic(); }

  // ── Status ──────────────────────────────────────────────────
  function setStatus(msg, kind) { statusEl.textContent = msg || ''; statusEl.className = 'vs-status' + (kind ? ' vs-status--' + kind : ''); }

  // ── Lookup (adds a passage to the stack) ────────────────────
  async function addReference() {
    var ref = refInput.value.trim();
    if (!ref) { setStatus('Type a reference like "Psalm 23".', 'err'); return; }
    setStatus('Looking up ' + ref + '…', 'busy'); addBtn.disabled = true;
    try {
      var url = 'https://bible-api.com/' + encodeURIComponent(ref) + '?translation=kjv';
      var data = await fetch(url).then(function (r) { if (!r.ok) throw new Error('nf'); return r.json(); });
      if (!data || !data.text) throw new Error('empty');
      var refName = data.reference || ref;
      state._groups.push({ text: String(data.text).replace(/\s+/g, ' ').trim(), attribution: '— ' + refName + ' (KJV)', label: refName });
      refInput.value = '';
      rebuild();
      setStatus('Added ' + refName + '. Add more, or press Preview.', 'ok');
    } catch (err) {
      setStatus('Couldn\'t find that reference. Try "John 3:16" or "Psalm 23".', 'err');
    } finally { addBtn.disabled = false; }
  }
  function addPastedText() {
    var t = textArea.value.trim();
    if (!t) { setStatus('Paste some text first.', 'err'); return; }
    var attrib = attribInput.value.trim();
    state._groups.push({ text: t, attribution: attrib, label: (t.slice(0, 22) + (t.length > 22 ? '…' : '')) });
    textArea.value = '';
    rebuild();
    setStatus('Added your text as slides.', 'ok');
  }

  // ── Custom bg image ─────────────────────────────────────────
  bgUpload.addEventListener('change', function () {
    var file = bgUpload.files && bgUpload.files[0]; if (!file) return;
    var img = new Image();
    img.onload = function () { state.bgImage = img; setActive(bgWrap, null); drawStatic(); };
    img.onerror = function () { setStatus('Could not load that image.', 'err'); };
    img.src = URL.createObjectURL(file);
  });

  // ── Soundtrack ──────────────────────────────────────────────
  audioUpload.addEventListener('change', function () {
    var file = audioUpload.files && audioUpload.files[0]; if (!file) return;
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = URL.createObjectURL(file);
    audioName.textContent = file.name;
  });

  // ── Recording ───────────────────────────────────────────────
  function pickMimeType(withAudio) {
    var prefs = withAudio
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for (var i = 0; i < prefs.length; i++) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(prefs[i])) return prefs[i]; }
    return '';
  }
  function record() {
    if (!window.MediaRecorder || !canvas.captureStream) { setStatus('This browser can\'t record here. Try Chrome, Edge, or Safari.', 'err'); return; }
    var haveAudio = !!audioObjectUrl;
    var mime = pickMimeType(haveAudio);
    var isMp4 = mime.indexOf('mp4') !== -1;
    var videoStream = canvas.captureStream(30);
    var tracks = videoStream.getVideoTracks();
    var audioCtx = null, playbackEl = null;
    if (haveAudio) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        playbackEl = new Audio(audioObjectUrl);
        var srcNode = audioCtx.createMediaElementSource(playbackEl);
        var dest = audioCtx.createMediaStreamDestination();
        srcNode.connect(dest); srcNode.connect(audioCtx.destination);
        tracks = tracks.concat(dest.stream.getAudioTracks());
      } catch (e) { haveAudio = false; }
    }
    var combined = new MediaStream(tracks);
    var chunks = []; var rec;
    try { rec = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined); }
    catch (e) { setStatus('Recording isn\'t supported in this browser.', 'err'); return; }

    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
      var ext = isMp4 ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: mime || 'video/webm' });
      var urlObj = URL.createObjectURL(blob);
      downloadsEl.innerHTML = '';
      var a = document.createElement('a');
      a.href = urlObj; a.download = 'seedtheword-verse.' + ext;
      a.textContent = '⬇ Download clip (' + ext.toUpperCase() + (haveAudio ? ' + audio' : '') + ')';
      downloadsEl.appendChild(a);
      var note = document.createElement('p'); note.className = 'vs-legal';
      note.textContent = (ext === 'webm')
        ? 'WebM plays on most phones and usually uploads to Instagram; if not, convert free at cloudconvert.com. For copyright-safe Reels, prefer adding music inside Instagram.'
        : 'MP4 ready to share.';
      downloadsEl.appendChild(note);
      recBtn.disabled = false; recBtn.textContent = '● Record clip';
      setStatus('Done! Your clip is ready below.', 'ok');
    };

    recBtn.disabled = true; recBtn.textContent = 'Recording…';
    setStatus('Recording ' + (isMp4 ? 'MP4' : 'WebM') + (haveAudio ? ' with audio' : '') + '… (' + Math.round(state.durationMs / 1000) + 's)', 'busy');
    downloadsEl.innerHTML = ''; animStart = 0; playing = true;
    rec.start();
    if (playbackEl) { try { playbackEl.currentTime = 0; playbackEl.play(); } catch (e) {} }
    rafId = requestAnimationFrame(loop);
    setTimeout(function () { try { rec.stop(); } catch (e) {} if (playbackEl) { try { playbackEl.pause(); } catch (e) {} } playing = false; }, state.durationMs + 500);
  }

  // ── Wire controls ───────────────────────────────────────────
  addBtn.addEventListener('click', addReference);
  refInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addReference(); } });
  addTextBtn.addEventListener('click', addPastedText);
  attribInput.addEventListener('input', function () { state.attribution = attribInput.value; });
  showAttrib.addEventListener('change', function () { state.showAttribution = showAttrib.checked; drawStatic(); });
  formatSel.addEventListener('change', function () { state.format = formatSel.value; applyFormat(); });
  styleSel.addEventListener('change', function () { state.style = styleSel.value; play(); });
  transSel.addEventListener('change', function () { state.transition = transSel.value; play(); });
  fontSel.addEventListener('change', function () { state.font = fontSel.value; repageAll(); drawStatic(); });
  durSel.addEventListener('change', function () { state.durationMs = parseInt(durSel.value, 10) * 1000; });
  if (fontHex) fontHex.addEventListener('input', function () { state.fontColor = fontHex.value; setActive(fontColorWrap, null); drawStatic(); });
  if (contrastToggle) contrastToggle.addEventListener('change', function () { state.contrast = contrastToggle.checked; drawStatic(); });
  if (bgHex) bgHex.addEventListener('input', function () { state.bg = { type: 'solid', color: bgHex.value }; state.bgImage = null; setActive(bgWrap, null); drawStatic(); });
  playBtn.addEventListener('click', play);
  recBtn.addEventListener('click', record);

  // ── Init ────────────────────────────────────────────────────
  buildSwatches(); buildFontColors();
  applyFormat();
  renderPassages();
  drawStatic();
  }
})();
