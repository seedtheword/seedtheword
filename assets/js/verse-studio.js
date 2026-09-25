/* ============================================================
   verse-studio.js  (v2)
   In-browser "Verse Studio" for Seed the Word.

   Features
   - Look up KJV text (public domain, bible-api.com) OR paste your own.
   - Fully editable attribution line (or hide it) — no forced label.
   - Long passages / whole chapters auto-page into timed slides.
   - Adjustable clip length (drives smooth per-slide timing).
   - Multiple fonts, animation styles, gradient + custom-image backgrounds.
   - Optional soundtrack (upload) muxed into a WebM (video+audio) via
     MediaRecorder from a combined canvas+audio stream.
   - STW transparent logo watermark at the bottom.

   Notes / honest constraints
   - Recording with audio produces WebM (video+audio). Native MP4 from
     MediaRecorder can't carry mixed canvas+audio reliably, so when a
     soundtrack is added we record WebM; without audio we still try MP4.
   - Only same-origin / uploaded images are drawn (avoids tainting the
     canvas, which would block recording).
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('verse-studio');
  if (!root) return;

  var openBtn = root.querySelector('#vs-open');
  if (openBtn) openBtn.addEventListener('click', function () { root.classList.add('is-open'); init(); });

  // Guard so we only wire everything once (on first open).
  var started = false;
  function init() {
    if (started) return; started = true;
    boot();
  }

  function boot() {
  // ── Elements ────────────────────────────────────────────────
  var canvas = root.querySelector('#vs-canvas');
  var ctx = canvas.getContext('2d');
  var refInput = root.querySelector('#vs-ref');
  var fetchBtn = root.querySelector('#vs-fetch');
  var textArea = root.querySelector('#vs-text');
  var attribInput = root.querySelector('#vs-attrib');
  var showAttrib = root.querySelector('#vs-show-attrib');
  var formatSel = root.querySelector('#vs-format');
  var styleSel = root.querySelector('#vs-style');
  var fontSel = root.querySelector('#vs-font');
  var durSel = root.querySelector('#vs-duration');
  var swatches = root.querySelector('#vs-swatches');
  var bgUpload = root.querySelector('#vs-bg-upload');
  var audioUpload = root.querySelector('#vs-audio-upload');
  var audioName = root.querySelector('#vs-audio-name');
  var playBtn = root.querySelector('#vs-play');
  var recBtn = root.querySelector('#vs-record');
  var statusEl = root.querySelector('#vs-status');
  var downloadsEl = root.querySelector('#vs-downloads');

  // ── Config ──────────────────────────────────────────────────
  var FORMATS = {
    story:  { w: 1080, h: 1920 },
    square: { w: 1080, h: 1080 },
    post:   { w: 1080, h: 1350 }
  };
  var BACKGROUNDS = [
    { id: 'dusk',  stops: ['#2C5F2E', '#0f2417'] },
    { id: 'gold',  stops: ['#C9A54D', '#6b5320'] },
    { id: 'night', stops: ['#1a2740', '#0a0f1c'] },
    { id: 'sand',  stops: ['#e6d3a3', '#b98d4c'] },
    { id: 'plum',  stops: ['#4a2a52', '#1c1022'] },
    { id: 'dawn',  stops: ['#c9744d', '#3d2140'] }
  ];

  var state = {
    reference: 'John 3:16',
    text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    attribution: '— John 3:16 (KJV)',
    showAttribution: true,
    bg: BACKGROUNDS[0],
    bgImage: null,       // HTMLImageElement when a custom bg is uploaded
    format: 'story',
    style: 'fade',
    font: 'Georgia, serif',
    durationMs: 8000
  };

  // Load the STW logo (same-origin PNG, safe for canvas recording).
  var logo = new Image();
  var logoReady = false;
  logo.onload = function () { logoReady = true; drawFrame(computeSlides(), 0); };
  logo.src = 'assets/images/stw-logo-transparent.png';

  // Audio (soundtrack) — decoded for muxing during record; also an <audio>
  // element for preview playback.
  var audioEl = null;      // HTMLAudioElement for preview
  var audioObjectUrl = null;

  var rafId = null, animStart = 0, playing = false;

  // ── Backgrounds swatches ────────────────────────────────────
  BACKGROUNDS.forEach(function (b, i) {
    var s = document.createElement('button');
    s.type = 'button';
    s.className = 'vs-swatch' + (i === 0 ? ' is-active' : '');
    s.style.background = 'linear-gradient(160deg,' + b.stops[0] + ',' + b.stops[1] + ')';
    s.setAttribute('aria-label', 'Background ' + b.id);
    s.addEventListener('click', function () {
      state.bg = b; state.bgImage = null;
      markActiveSwatch(s);
      drawFrame(computeSlides(), lastP);
    });
    swatches.appendChild(s);
  });
  function markActiveSwatch(el) {
    swatches.querySelectorAll('.vs-swatch').forEach(function (x) { x.classList.remove('is-active'); });
    if (el) el.classList.add('is-active');
  }

  // ── Sizing ──────────────────────────────────────────────────
  function applyFormat() {
    var f = FORMATS[state.format];
    canvas.width = f.w; canvas.height = f.h;
    drawFrame(computeSlides(), lastP);
  }

  // ── Text paging: split long text into slides that fit the frame ──
  function computeSlides() {
    var W = canvas.width, H = canvas.height;
    var fontSize = Math.round(W * (state.format === 'story' ? 0.060 : 0.055));
    var pad = W * 0.11, maxW = W - pad * 2;
    var lineH = fontSize * 1.34;
    // How many lines fit comfortably (leave room for attribution + logo).
    var usableH = H * 0.62;
    var maxLines = Math.max(2, Math.floor(usableH / lineH));

    ctx.font = '600 ' + fontSize + 'px ' + state.font;
    var allLines = wrapLines(state.text, maxW);

    var slides = [];
    for (var i = 0; i < allLines.length; i += maxLines) {
      slides.push(allLines.slice(i, i + maxLines));
    }
    if (!slides.length) slides.push(['']);
    return { slides: slides, fontSize: fontSize, lineH: lineH, maxW: maxW };
  }

  function wrapLines(text, maxWidth) {
    var paras = String(text).replace(/\r/g, '').split('\n');
    var out = [];
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

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ── Draw one frame. p = 0..1 over the whole clip ─────────────
  var lastP = 0;
  function drawFrame(layout, p) {
    lastP = p;
    var W = canvas.width, H = canvas.height;

    // Background
    if (state.bgImage) {
      // cover-fit the uploaded image
      var img = state.bgImage;
      var ir = img.width / img.height, cr = W / H, dw, dh, dx, dy;
      if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
      else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
      // slow ken-burns zoom
      var z = 1 + 0.06 * p;
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    } else {
      var grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
      grad.addColorStop(0, state.bg.stops[0]);
      grad.addColorStop(1, state.bg.stops[1]);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    // Vignette for legibility
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    var slides = layout.slides, fontSize = layout.fontSize, lineH = layout.lineH;

    // Which slide are we on? Divide the clip evenly, leaving a short
    // fade transition between slides for smoothness.
    var nSlides = slides.length;
    var slideP = p * nSlides;                 // 0..nSlides
    var idx = Math.min(nSlides - 1, Math.floor(slideP));
    var local = slideP - idx;                 // 0..1 within this slide
    var lines = slides[idx];

    // Per-slide envelope: fade in (0-0.18), hold, fade out near end if
    // there's a next slide (0.86-1.0).
    var appear = easeOut(Math.min(1, local / 0.18));
    var disappear = (idx < nSlides - 1) ? (1 - easeInOut(Math.max(0, (local - 0.86) / 0.14))) : 1;
    var envelope = appear * disappear;

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 ' + fontSize + 'px ' + state.font;
    ctx.fillStyle = '#ffffff';

    var totalH = lines.length * lineH;
    var startY = (H - totalH) / 2 + lineH / 2 - H * 0.02;

    ctx.save();
    if (state.style === 'fade') {
      ctx.globalAlpha = envelope;
      var shift = (1 - appear) * (H * 0.025);
      lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, startY + i * lineH + shift); });
    } else if (state.style === 'rise') {
      lines.forEach(function (ln, i) {
        var lp = Math.min(1, Math.max(0, (local - i * 0.05) / 0.28));
        ctx.globalAlpha = easeOut(lp) * disappear;
        var dy = (1 - easeOut(lp)) * (H * 0.045);
        ctx.fillText(ln, W / 2, startY + i * lineH + dy);
      });
    } else if (state.style === 'zoom') {
      var zc = 0.92 + 0.08 * appear;
      ctx.globalAlpha = envelope;
      ctx.translate(W / 2, H / 2); ctx.scale(zc, zc); ctx.translate(-W / 2, -H / 2);
      lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, startY + i * lineH); });
    } else { // word — reveal words across this slide
      var totalWords = 0; lines.forEach(function (l) { totalWords += l.split(' ').length; });
      var shown = Math.floor(easeOut(Math.min(1, local / 0.8)) * totalWords);
      var count = 0; ctx.globalAlpha = disappear;
      lines.forEach(function (ln, i) {
        var lw = ln.split(' '), vis = [];
        for (var w = 0; w < lw.length; w++) { if (count < shown) { vis.push(lw[w]); count++; } }
        if (vis.length) ctx.fillText(vis.join(' '), W / 2, startY + i * lineH);
      });
    }
    ctx.restore();

    // Attribution (editable text; optional)
    if (state.showAttribution && state.attribution) {
      ctx.globalAlpha = envelope * easeOut(Math.min(1, Math.max(0, (local - 0.25) / 0.4)));
      ctx.fillStyle = '#E4CB86';
      ctx.font = '700 ' + Math.round(fontSize * 0.6) + 'px ' + state.font;
      ctx.fillText(state.attribution, W / 2, startY + lines.length * lineH + lineH * 0.4);
    }

    // Logo watermark at the bottom (replaces the old "Seed the Word" text)
    ctx.globalAlpha = 0.92;
    if (logoReady) {
      var lw2 = W * 0.20, lh2 = lw2 * (logo.height / logo.width);
      ctx.drawImage(logo, (W - lw2) / 2, H - lh2 - H * 0.03, lw2, lh2);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 ' + Math.round(W * 0.026) + 'px Inter, system-ui, sans-serif';
      ctx.fillText('Seed the Word', W / 2, H - H * 0.05);
    }
    ctx.globalAlpha = 1;
  }

  // ── Animation loop ──────────────────────────────────────────
  function loop(ts) {
    if (!animStart) animStart = ts;
    var layout = computeSlides();
    var elapsed = ts - animStart;
    var p = Math.min(1, elapsed / state.durationMs);
    drawFrame(layout, p);
    if (elapsed < state.durationMs && playing) {
      rafId = requestAnimationFrame(loop);
    } else {
      playing = false;
      playBtn.textContent = '▶ Preview';
    }
  }
  function play() {
    cancelAnimationFrame(rafId);
    animStart = 0; playing = true;
    playBtn.textContent = '❚❚ Playing…';
    if (audioEl) { try { audioEl.currentTime = 0; audioEl.play(); } catch (e) {} }
    rafId = requestAnimationFrame(loop);
  }

  // ── KJV fetch ───────────────────────────────────────────────
  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'vs-status' + (kind ? ' vs-status--' + kind : '');
  }
  async function fetchVerse() {
    var ref = refInput.value.trim();
    if (!ref) { setStatus('Type a reference like "Psalm 23".', 'err'); return; }
    setStatus('Looking up ' + ref + '…', 'busy');
    fetchBtn.disabled = true;
    try {
      var url = 'https://bible-api.com/' + encodeURIComponent(ref) + '?translation=kjv';
      var data = await fetch(url).then(function (r) { if (!r.ok) throw new Error('nf'); return r.json(); });
      if (!data || !data.text) throw new Error('empty');
      state.reference = data.reference || ref;
      state.text = String(data.text).replace(/\s+/g, ' ').trim();
      textArea.value = state.text;
      // Prefill the editable attribution, but the user can change/remove it.
      state.attribution = '— ' + state.reference + ' (KJV)';
      attribInput.value = state.attribution;
      setStatus('Loaded ' + state.reference + ' (KJV). Edit the text or attribution freely.', 'ok');
      play();
    } catch (err) {
      setStatus('Couldn\'t find that reference. Check spelling, e.g. "John 3:16" or "Psalm 23".', 'err');
    } finally { fetchBtn.disabled = false; }
  }

  // ── Custom background upload (same-origin object URL: safe) ──
  bgUpload.addEventListener('change', function () {
    var file = bgUpload.files && bgUpload.files[0];
    if (!file) return;
    var img = new Image();
    img.onload = function () {
      state.bgImage = img; markActiveSwatch(null);
      drawFrame(computeSlides(), lastP);
    };
    img.onerror = function () { setStatus('Could not load that image.', 'err'); };
    img.src = URL.createObjectURL(file);
  });

  // ── Soundtrack upload ───────────────────────────────────────
  audioUpload.addEventListener('change', function () {
    var file = audioUpload.files && audioUpload.files[0];
    if (!file) { return; }
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = URL.createObjectURL(file);
    audioEl = new Audio(audioObjectUrl);
    audioEl.loop = false;
    audioName.textContent = file.name;
  });

  // ── Recording (WebM w/ audio when a track is added) ─────────
  function pickMimeType(withAudio) {
    var prefs = withAudio
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for (var i = 0; i < prefs.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(prefs[i])) return prefs[i];
    }
    return '';
  }

  function record() {
    if (!window.MediaRecorder || !canvas.captureStream) {
      setStatus('This browser can\'t record here. Try Chrome, Edge, or Safari.', 'err');
      return;
    }
    var haveAudio = !!audioObjectUrl;
    var mime = pickMimeType(haveAudio);
    var isMp4 = mime.indexOf('mp4') !== -1;
    var videoStream = canvas.captureStream(30);

    // Build the combined stream (video track + optional audio track).
    var tracks = videoStream.getVideoTracks();
    var audioCtx = null, srcNode = null, dest = null, playbackEl = null;
    if (haveAudio) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        playbackEl = new Audio(audioObjectUrl);
        srcNode = audioCtx.createMediaElementSource(playbackEl);
        dest = audioCtx.createMediaStreamDestination();
        srcNode.connect(dest);
        srcNode.connect(audioCtx.destination); // also hear it while recording
        tracks = tracks.concat(dest.stream.getAudioTracks());
      } catch (e) { haveAudio = false; }
    }
    var combined = new MediaStream(tracks);

    var chunks = [];
    var rec;
    try {
      rec = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
    } catch (e) { setStatus('Recording isn\'t supported in this browser.', 'err'); return; }

    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
      var ext = isMp4 ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: mime || 'video/webm' });
      var urlObj = URL.createObjectURL(blob);
      var safeRef = (state.reference || 'verse').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'verse';
      downloadsEl.innerHTML = '';
      var a = document.createElement('a');
      a.href = urlObj; a.download = 'seedtheword-' + safeRef + '.' + ext;
      a.textContent = '⬇ Download clip (' + ext.toUpperCase() + (haveAudio ? ' + audio' : '') + ')';
      downloadsEl.appendChild(a);
      var note = document.createElement('p');
      note.className = 'vs-legal';
      note.textContent = (ext === 'webm')
        ? 'WebM plays on most phones and usually uploads to Instagram. If it won\'t, convert free at cloudconvert.com. For copyright-safe Reels, prefer adding music inside Instagram.'
        : 'MP4 ready to share.';
      downloadsEl.appendChild(note);
      recBtn.disabled = false; recBtn.textContent = '● Record clip';
      setStatus('Done! Your clip is ready below.', 'ok');
    };

    recBtn.disabled = true; recBtn.textContent = 'Recording…';
    setStatus('Recording ' + (isMp4 ? 'MP4' : 'WebM') + (haveAudio ? ' with audio' : '') + '…', 'busy');
    downloadsEl.innerHTML = '';
    animStart = 0; playing = true;
    rec.start();
    if (playbackEl) { try { playbackEl.currentTime = 0; playbackEl.play(); } catch (e) {} }
    rafId = requestAnimationFrame(loop);
    setTimeout(function () {
      try { rec.stop(); } catch (e) {}
      if (playbackEl) { try { playbackEl.pause(); } catch (e) {} }
      playing = false;
    }, state.durationMs + 500);
  }

  // ── Wire controls ───────────────────────────────────────────
  fetchBtn.addEventListener('click', fetchVerse);
  refInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fetchVerse(); } });
  textArea.addEventListener('input', function () { state.text = textArea.value; drawFrame(computeSlides(), lastP); });
  attribInput.addEventListener('input', function () { state.attribution = attribInput.value; drawFrame(computeSlides(), lastP); });
  showAttrib.addEventListener('change', function () { state.showAttribution = showAttrib.checked; drawFrame(computeSlides(), lastP); });
  formatSel.addEventListener('change', function () { state.format = formatSel.value; applyFormat(); });
  styleSel.addEventListener('change', function () { state.style = styleSel.value; play(); });
  fontSel.addEventListener('change', function () { state.font = fontSel.value; drawFrame(computeSlides(), lastP); });
  durSel.addEventListener('change', function () { state.durationMs = parseInt(durSel.value, 10) * 1000; });
  playBtn.addEventListener('click', play);
  recBtn.addEventListener('click', record);

  // ── Init ────────────────────────────────────────────────────
  refInput.value = state.reference;
  textArea.value = state.text;
  attribInput.value = state.attribution;
  showAttrib.checked = true;
  applyFormat();
  drawFrame(computeSlides(), 1);
  }
})();
