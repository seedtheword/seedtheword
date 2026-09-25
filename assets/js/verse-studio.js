/* ============================================================
   verse-studio.js
   In-browser "Verse Studio" for Seed the Word.
   - Enter/select a reference; fetch the KJV text (public domain)
     from bible-api.com.
   - Animate the verse over a chosen background on a <canvas>.
   - Live preview + record to a shareable video clip.
   - Native MP4 when the browser supports it (Safari, recent
     Chrome); falls back to WebM and labels the file accordingly.
   Self-contained; no dependencies. Scoped to #verse-studio.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('verse-studio');
  if (!root) return;

  // Expand the studio from its collapsed teaser
  var openBtn = root.querySelector('#vs-open');
  if (openBtn) openBtn.addEventListener('click', function () { root.classList.add('is-open'); });

  // ── Elements ────────────────────────────────────────────────
  var canvas = root.querySelector('#vs-canvas');
  var ctx = canvas.getContext('2d');
  var refInput = root.querySelector('#vs-ref');
  var fetchBtn = root.querySelector('#vs-fetch');
  var textArea = root.querySelector('#vs-text');
  var formatSel = root.querySelector('#vs-format');
  var styleSel = root.querySelector('#vs-style');
  var fontSel = root.querySelector('#vs-font');
  var swatches = root.querySelector('#vs-swatches');
  var playBtn = root.querySelector('#vs-play');
  var recBtn = root.querySelector('#vs-record');
  var statusEl = root.querySelector('#vs-status');
  var downloadsEl = root.querySelector('#vs-downloads');

  // ── State ───────────────────────────────────────────────────
  var FORMATS = {
    story:  { w: 1080, h: 1920, label: 'Story / Reel 9:16' },
    square: { w: 1080, h: 1080, label: 'Square 1:1' },
    post:   { w: 1080, h: 1350, label: 'Portrait 4:5' }
  };
  // Curated backgrounds (gradient stops). Warm, reverent palettes.
  var BACKGROUNDS = [
    { id: 'dusk',   stops: ['#2C5F2E', '#0f2417'] },
    { id: 'gold',   stops: ['#C9A54D', '#6b5320'] },
    { id: 'night',  stops: ['#1a2740', '#0a0f1c'] },
    { id: 'sand',   stops: ['#e6d3a3', '#b98d4c'] },
    { id: 'plum',   stops: ['#4a2a52', '#1c1022'] },
    { id: 'dawn',   stops: ['#c9744d', '#3d2140'] }
  ];
  var state = {
    reference: 'John 3:16',
    text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    bg: BACKGROUNDS[0],
    format: 'story',
    style: 'fade',       // fade | word | rise
    font: 'Georgia, serif'
  };

  var DURATION = 6000;   // ms of animation per loop
  var animStart = 0;
  var rafId = null;
  var playing = false;

  // ── Backgrounds swatches ────────────────────────────────────
  BACKGROUNDS.forEach(function (b, i) {
    var s = document.createElement('button');
    s.type = 'button';
    s.className = 'vs-swatch' + (i === 0 ? ' is-active' : '');
    s.style.background = 'linear-gradient(160deg, ' + b.stops[0] + ', ' + b.stops[1] + ')';
    s.setAttribute('aria-label', 'Background ' + b.id);
    s.addEventListener('click', function () {
      state.bg = b;
      swatches.querySelectorAll('.vs-swatch').forEach(function (el) { el.classList.remove('is-active'); });
      s.classList.add('is-active');
      drawFrame(1); // repaint static
    });
    swatches.appendChild(s);
  });

  // ── Canvas sizing ───────────────────────────────────────────
  function applyFormat() {
    var f = FORMATS[state.format];
    canvas.width = f.w;
    canvas.height = f.h;
    drawFrame(1);
  }

  // ── Text wrapping ───────────────────────────────────────────
  function wrapLines(text, maxWidth) {
    var words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line); line = words[i];
      } else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
  }

  // ── Draw one frame at progress p (0..1) ─────────────────────
  function drawFrame(p) {
    var W = canvas.width, H = canvas.height;

    // Background gradient (with a slow "Ken Burns" scale for life)
    var grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
    grad.addColorStop(0, state.bg.stops[0]);
    grad.addColorStop(1, state.bg.stops[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle vignette
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Layout
    var pad = W * 0.11;
    var maxW = W - pad * 2;
    var fontSize = Math.round(W * (state.format === 'story' ? 0.062 : 0.058));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + fontSize + 'px ' + state.font;
    ctx.fillStyle = '#ffffff';

    var lines = wrapLines(state.text, maxW);
    var lineH = fontSize * 1.34;
    var refH = Math.round(fontSize * 0.62);
    var totalH = lines.length * lineH + lineH * 1.2; // + reference space
    var startY = (H - totalH) / 2 + lineH / 2;

    // Ease helper
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    ctx.save();
    if (state.style === 'fade') {
      ctx.globalAlpha = easeOut(Math.min(1, p / 0.55));
      var shift = (1 - easeOut(Math.min(1, p / 0.55))) * (H * 0.03);
      lines.forEach(function (ln, i) {
        ctx.fillText(ln, W / 2, startY + i * lineH + shift);
      });
    } else if (state.style === 'rise') {
      lines.forEach(function (ln, i) {
        var lp = Math.min(1, Math.max(0, (p - i * 0.08) / 0.5));
        ctx.globalAlpha = easeOut(lp);
        var dy = (1 - easeOut(lp)) * (H * 0.05);
        ctx.fillText(ln, W / 2, startY + i * lineH + dy);
      });
    } else { // word-by-word
      var totalWords = state.text.split(/\s+/).filter(Boolean).length;
      var shownWords = Math.floor(easeOut(Math.min(1, p / 0.7)) * totalWords);
      var count = 0;
      ctx.globalAlpha = 1;
      lines.forEach(function (ln, i) {
        var lw = ln.split(' ');
        var visible = [];
        for (var w = 0; w < lw.length; w++) { if (count < shownWords) { visible.push(lw[w]); count++; } }
        if (visible.length) ctx.fillText(visible.join(' '), W / 2, startY + i * lineH);
      });
    }
    ctx.restore();

    // Reference (fades in slightly later)
    ctx.globalAlpha = easeOut(Math.min(1, Math.max(0, (p - 0.35) / 0.5)));
    ctx.fillStyle = '#C9A54D';
    ctx.font = '700 ' + refH + 'px ' + state.font;
    ctx.fillText('— ' + state.reference + ' (KJV)', W / 2, startY + lines.length * lineH + lineH * 0.5);

    // Small ministry mark
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 ' + Math.round(W * 0.026) + 'px Inter, system-ui, sans-serif';
    ctx.fillText('Seed the Word', W / 2, H - H * 0.055);
    ctx.globalAlpha = 1;
  }

  // ── Animation loop ──────────────────────────────────────────
  function loop(ts) {
    if (!animStart) animStart = ts;
    var elapsed = ts - animStart;
    var p = Math.min(1, elapsed / DURATION);
    drawFrame(p);
    if (elapsed < DURATION) {
      rafId = requestAnimationFrame(loop);
    } else {
      // Hold the final frame, then loop for preview
      rafId = requestAnimationFrame(function () { animStart = 0; if (playing) rafId = requestAnimationFrame(loop); });
      playing = false;
      playBtn.textContent = '▶ Preview';
    }
  }

  function play() {
    cancelAnimationFrame(rafId);
    animStart = 0; playing = true;
    playBtn.textContent = '❚❚ Playing…';
    rafId = requestAnimationFrame(loop);
  }

  // ── Fetch KJV text ──────────────────────────────────────────
  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'vs-status' + (kind ? ' vs-status--' + kind : '');
  }

  async function fetchVerse() {
    var ref = refInput.value.trim();
    if (!ref) { setStatus('Type a reference like "Psalm 23:1".', 'err'); return; }
    setStatus('Looking up ' + ref + '…', 'busy');
    fetchBtn.disabled = true;
    try {
      var url = 'https://bible-api.com/' + encodeURIComponent(ref) + '?translation=kjv';
      var data = await fetch(url).then(function (r) {
        if (!r.ok) throw new Error('not found');
        return r.json();
      });
      if (!data || !data.text) throw new Error('empty');
      state.reference = data.reference || ref;
      state.text = String(data.text).replace(/\s+/g, ' ').trim();
      textArea.value = state.text;
      setStatus('Loaded ' + state.reference + ' (KJV).', 'ok');
      play();
    } catch (err) {
      setStatus('Couldn\'t find that reference. Check the spelling, e.g. "John 3:16".', 'err');
    } finally {
      fetchBtn.disabled = false;
    }
  }

  // ── Recording (MP4 native, WebM fallback) ───────────────────
  function pickMimeType() {
    var prefs = [
      'video/mp4;codecs=avc1.42E01E',   // H.264 baseline — Instagram-native
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    for (var i = 0; i < prefs.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(prefs[i])) return prefs[i];
    }
    return '';
  }

  function record() {
    if (!window.MediaRecorder || !canvas.captureStream) {
      setStatus('Your browser can\'t record video here. Try Chrome, Edge, or Safari.', 'err');
      return;
    }
    var mime = pickMimeType();
    var isMp4 = mime.indexOf('mp4') !== -1;
    var stream = canvas.captureStream(30);
    var chunks = [];
    var rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined);
    } catch (e) {
      setStatus('Recording isn\'t supported in this browser.', 'err');
      return;
    }

    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var ext = isMp4 ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: mime || 'video/webm' });
      var urlObj = URL.createObjectURL(blob);
      var safeRef = state.reference.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'verse';
      var fname = 'seedtheword-' + safeRef + '.' + ext;

      downloadsEl.innerHTML = '';
      var a = document.createElement('a');
      a.href = urlObj; a.download = fname;
      a.textContent = '⬇ Download clip (' + ext.toUpperCase() + ')';
      downloadsEl.appendChild(a);

      if (!isMp4) {
        var note = document.createElement('p');
        note.className = 'vs-legal';
        note.textContent = 'Your browser recorded WebM (Instagram prefers MP4). It usually still uploads; if not, convert it free at cloudconvert.com, or record in Safari for native MP4.';
        downloadsEl.appendChild(note);
      }
      recBtn.disabled = false;
      recBtn.textContent = '● Record clip';
      setStatus('Done! Your ' + ext.toUpperCase() + ' clip is ready to download.', 'ok');
    };

    // Start recording and play the animation once through.
    recBtn.disabled = true;
    recBtn.textContent = 'Recording…';
    setStatus('Recording ' + (isMp4 ? 'MP4' : 'WebM') + '…', 'busy');
    downloadsEl.innerHTML = '';
    animStart = 0; playing = true;
    rec.start();
    play();
    // Stop a touch after the animation completes so the final frame is captured.
    setTimeout(function () { try { rec.stop(); } catch (e) {} playing = false; }, DURATION + 600);
  }

  // ── Wire controls ───────────────────────────────────────────
  fetchBtn.addEventListener('click', fetchVerse);
  refInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fetchVerse(); } });
  textArea.addEventListener('input', function () { state.text = textArea.value; drawFrame(1); });
  formatSel.addEventListener('change', function () { state.format = formatSel.value; applyFormat(); });
  styleSel.addEventListener('change', function () { state.style = styleSel.value; play(); });
  fontSel.addEventListener('change', function () { state.font = fontSel.value; drawFrame(1); });
  playBtn.addEventListener('click', play);
  recBtn.addEventListener('click', record);

  // ── Init ────────────────────────────────────────────────────
  refInput.value = state.reference;
  textArea.value = state.text;
  applyFormat();
  // Draw a static composed frame right away so it isn't blank.
  drawFrame(1);
})();
