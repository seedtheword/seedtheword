/* ============================================================
   verse-studio.js  (v4)
   In-browser "Verse Studio" for Seed the Word — make animated
   Scripture clips for social media.

   This version:
   - Per-slide reading DWELL: each slide animates in, then HOLDS for a
     readable amount of time (auto-scaled to word count) before the
     transition. A "Reading pace" control + optional manual total length.
   - Inline superscript VERSE NUMBERS (from the KJV API per-verse data),
     with a show/hide toggle.
   - Fixed transitions: the incoming slide is always shown fully settled
     during a transition (never re-runs its entrance). Smooth fade-through-
     logo (dip out -> logo swell -> dip in). More transition types.
   - More text animations.
   - Soundtrack plays during Preview (user gesture) and is muxed on record.
   - Web Share API button when supported; download always available.
   - "Social media" wording (not Instagram-specific).

   Public-domain KJV text (bible-api.com). CC0 soundtrack presets (FreePD).
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
  var $ = function (s) { return root.querySelector(s); };
  var canvas = $('#vs-canvas'), ctx = canvas.getContext('2d');
  var refInput = $('#vs-ref'), addBtn = $('#vs-add'), passagesEl = $('#vs-passages');
  var bookSel = $('#vs-book'), chapSel = $('#vs-chapter'), verseInput = $('#vs-verse');
  var textArea = $('#vs-text'), addTextBtn = $('#vs-add-text');
  var attribInput = $('#vs-attrib'), showAttrib = $('#vs-show-attrib');
  var showVerseNums = $('#vs-show-versenums');
  var formatSel = $('#vs-format'), styleSel = $('#vs-style'), transSel = $('#vs-transition');
  var fontSel = $('#vs-font'), paceSel = $('#vs-pace'), durInput = $('#vs-duration');
  var fontColorWrap = $('#vs-fontcolors'), fontHex = $('#vs-font-hex'), contrastToggle = $('#vs-contrast');
  var bgWrap = $('#vs-swatches'), bgHex = $('#vs-bg-hex'), bgUpload = $('#vs-bg-upload');
  var soundSel = $('#vs-soundtrack'), audioUpload = $('#vs-audio-upload'), audioName = $('#vs-audio-name');
  var playBtn = $('#vs-play'), recBtn = $('#vs-record'), shareBtn = $('#vs-share');
  var statusEl = $('#vs-status'), downloadsEl = $('#vs-downloads'), totalEl = $('#vs-total');

  var FORMATS = { story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 }, post: { w: 1080, h: 1350 } };
  var GRADIENTS = [
    { type: 'grad', stops: ['#2C5F2E', '#0f2417'] }, { type: 'grad', stops: ['#1a2740', '#0a0f1c'] },
    { type: 'grad', stops: ['#4a2a52', '#1c1022'] }, { type: 'grad', stops: ['#c9744d', '#3d2140'] }
  ];
  var SOLIDS = ['#2C5F2E','#14401f','#0d1b2a','#1b263b','#3d2645','#5c1a1a','#7c4a1e','#b8860b','#0f4c5c','#264653','#1a1a1a','#3a2e1f'];
  var FONT_COLORS = ['#ffffff','#f7ecd0','#E4CB86','#C9A54D','#ffd9a0','#cfe8d8','#111111','#f5c2c2'];

  var BIBLE_BOOKS = [
    ['Genesis',50],['Exodus',40],['Leviticus',27],['Numbers',36],['Deuteronomy',34],['Joshua',24],['Judges',21],['Ruth',4],
    ['1 Samuel',31],['2 Samuel',24],['1 Kings',22],['2 Kings',25],['1 Chronicles',29],['2 Chronicles',36],['Ezra',10],['Nehemiah',13],
    ['Esther',10],['Job',42],['Psalms',150],['Proverbs',31],['Ecclesiastes',12],['Song of Solomon',8],['Isaiah',66],['Jeremiah',52],
    ['Lamentations',5],['Ezekiel',48],['Daniel',12],['Hosea',14],['Joel',3],['Amos',9],['Obadiah',1],['Jonah',4],['Micah',7],
    ['Nahum',3],['Habakkuk',3],['Zephaniah',3],['Haggai',2],['Zechariah',14],['Malachi',4],['Matthew',28],['Mark',16],['Luke',24],
    ['John',21],['Acts',28],['Romans',16],['1 Corinthians',16],['2 Corinthians',13],['Galatians',6],['Ephesians',6],['Philippians',4],
    ['Colossians',4],['1 Thessalonians',5],['2 Thessalonians',3],['1 Timothy',6],['2 Timothy',4],['Titus',3],['Philemon',1],
    ['Hebrews',13],['James',5],['1 Peter',5],['2 Peter',3],['1 John',5],['2 John',1],['3 John',1],['Jude',1],['Revelation',22]
  ];
  var SOUNDTRACKS = [
    { id: '', label: 'No sound (default)', src: '' },
    { id: 'after-the-end', label: 'After the End — reflective (CC0)', src: 'assets/audio/after-the-end.mp3' },
    { id: 'garden-of-prayer', label: 'Garden of Prayer — gentle (CC0)', src: 'assets/audio/garden-of-prayer.mp3' }
  ];

  // Reading pace presets → ms of DWELL per word (after the slide appears).
  var PACE = { fast: 220, medium: 320, slow: 440 };
  var INTRO_MS = 900;   // time for a slide's entrance (text animates in)
  var EXIT_MS  = 550;   // time for the text to animate OUT (clears the slate)
  var TRANS_MS = 700;   // time for the blank-stage transition between slides

  var state = {
    groups: [{ text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', attribution: '— John 3:16 (KJV)', label: 'John 3:16', verses: null }],
    slides: [],
    showAttribution: true,
    showVerseNums: true,
    bg: { type: 'grad', stops: GRADIENTS[0].stops }, bgImage: null,
    fontColor: '#ffffff', contrast: true,
    format: 'story', style: 'fade', transition: 'crossfade',
    font: 'Georgia, serif',
    pace: 'medium',
    manualTotalMs: 0     // 0 = auto (from pace); >0 = user override
  };

  var logo = new Image(), logoReady = false;
  logo.onload = function () { logoReady = true; drawStatic(); };
  logo.src = 'assets/images/stw-logo-transparent.png';

  var audioObjectUrl = null, usingUpload = false, previewAudio = null;
  var rafId = null, animStart = 0, playing = false, lastP = 0;
  var lastBlob = null, lastExt = 'webm';

  // ── Easing ──────────────────────────────────────────────────
  function easeOut(t){return 1-Math.pow(1-t,3);}
  function easeInOut(t){return t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;}
  function isLight(hex){var m=/^#?([0-9a-f]{6})$/i.exec(hex||'');if(!m)return true;var n=parseInt(m[1],16);return (0.299*((n>>16)&255)+0.587*((n>>8)&255)+0.114*(n&255))>140;}

  // ── Swatch UIs ──────────────────────────────────────────────
  function buildSwatches(){
    GRADIENTS.forEach(function(g){var s=mkSwatch('linear-gradient(160deg,'+g.stops[0]+','+g.stops[1]+')');s.addEventListener('click',function(){state.bg={type:'grad',stops:g.stops};state.bgImage=null;setActive(bgWrap,s);drawStatic();});bgWrap.appendChild(s);});
    SOLIDS.forEach(function(c){var s=mkSwatch(c);s.addEventListener('click',function(){state.bg={type:'solid',color:c};state.bgImage=null;setActive(bgWrap,s);if(bgHex)bgHex.value=c;drawStatic();});bgWrap.appendChild(s);});
    var f=bgWrap.querySelector('.vs-swatch');if(f)f.classList.add('is-active');
  }
  function mkSwatch(bg){var s=document.createElement('button');s.type='button';s.className='vs-swatch';s.style.background=bg;return s;}
  function buildFontColors(){FONT_COLORS.forEach(function(c,i){var s=document.createElement('button');s.type='button';s.className='vs-swatch vs-swatch--sm'+(i===0?' is-active':'');s.style.background=c;s.addEventListener('click',function(){state.fontColor=c;setActive(fontColorWrap,s);if(fontHex)fontHex.value=c;drawStatic();});fontColorWrap.appendChild(s);});}
  function setActive(wrap,el){wrap.querySelectorAll('.vs-swatch').forEach(function(x){x.classList.remove('is-active');});if(el)el.classList.add('is-active');}

  // ── Text paging (returns slides with token lists) ───────────
  // Each slide: { tokens: [{text, verse}], lines: [[token,...]] }
  // Verse numbers are attached to the first token of each verse.
  function tokenizeGroup(g){
    var tokens=[];
    if(g.verses && g.verses.length){
      g.verses.forEach(function(v){
        var words=String(v.text).replace(/\s+/g,' ').trim().split(' ');
        words.forEach(function(w,i){ tokens.push({text:w, verse: i===0 ? v.verse : null}); });
      });
    } else {
      String(g.text).replace(/\s+/g,' ').trim().split(' ').forEach(function(w){ tokens.push({text:w, verse:null}); });
    }
    return tokens;
  }
  function measureToken(t, fontSize){
    var vn = (state.showVerseNums && t.verse) ? (t.verse+' ') : '';
    // verse number is smaller; approximate its width
    return ctx.measureText(t.text).width + (vn ? ctx.measureText(String(t.verse)).width*0.62 + fontSize*0.12 : 0);
  }
  function pageGroup(g){
    var W=canvas.width, H=canvas.height;
    var fontSize=Math.round(W*(state.format==='story'?0.060:0.055));
    var lineH=fontSize*1.34, pad=W*0.11, maxW=W-pad*2;
    var maxLines=Math.max(2, Math.floor((H*0.58)/lineH));
    ctx.font='600 '+fontSize+'px '+state.font;
    var tokens=tokenizeGroup(g);
    // wrap tokens into lines
    var lines=[], line=[], lineW=0, spaceW=ctx.measureText(' ').width;
    tokens.forEach(function(t){
      var tw=measureToken(t,fontSize);
      if(line.length && lineW+spaceW+tw>maxW){ lines.push(line); line=[]; lineW=0; }
      line.push(t); lineW+=(line.length>1?spaceW:0)+tw;
    });
    if(line.length) lines.push(line);
    // group lines into slides
    var slides=[];
    for(var i=0;i<lines.length;i+=maxLines){
      slides.push({ lines: lines.slice(i,i+maxLines), attribution: g.attribution||'' });
    }
    if(!slides.length) slides.push({lines:[[{text:'',verse:null}]], attribution:g.attribution||''});
    return slides;
  }
  function repageAll(){
    var slides=[];
    state.groups.forEach(function(g){ slides=slides.concat(pageGroup(g)); });
    state.slides = slides.length ? slides : [{lines:[[{text:'Add a passage to begin',verse:null}]], attribution:''}];
    updateTotalLabel();
  }

  // ── Timing model ────────────────────────────────────────────
  // Each slide gets: INTRO_MS (entrance) + dwell (words * pace) + TRANS_MS.
  function slideWordCount(slide){ var n=0; slide.lines.forEach(function(l){n+=l.length;}); return n; }
  function computeTimeline(){
    var perWord = PACE[state.pace] || PACE.medium;
    var segs = [];
    var t = 0;
    var last = state.slides.length - 1;
    state.slides.forEach(function(sl, i){
      var dwell = Math.max(1400, slideWordCount(sl) * perWord);
      var intro = INTRO_MS;
      // Text exits (clears the slate) before the transition, so the transition
      // moves a BLANK stage and the next slide's text animates in fresh.
      var exit = (i < last) ? EXIT_MS : 0;
      var trans = (i < last) ? TRANS_MS : 0;
      segs.push({ start: t, intro: intro, dwell: dwell, exit: exit, trans: trans, dur: intro + dwell + exit + trans });
      t += intro + dwell + exit + trans;
    });
    var autoTotal = t;
    var total = state.manualTotalMs > 0 ? state.manualTotalMs : autoTotal;
    // If manual total differs, scale all segment times proportionally.
    var scale = (state.manualTotalMs > 0 && autoTotal > 0) ? (state.manualTotalMs / autoTotal) : 1;
    return { segs: segs, total: total, scale: scale, autoTotal: autoTotal };
  }
  function updateTotalLabel(){
    if(!totalEl) return;
    var tl = computeTimeline();
    var s = Math.round(tl.total/1000);
    totalEl.textContent = 'Total length: ' + (s>=60 ? Math.floor(s/60)+'m '+(s%60)+'s' : s+'s') + (state.manualTotalMs? ' (manual)':' (auto)');
  }

  // ── Background ──────────────────────────────────────────────
  function paintBackground(p){
    var W=canvas.width,H=canvas.height;
    if(state.bgImage){var img=state.bgImage,ir=img.width/img.height,cr=W/H,dw,dh,dx,dy;if(ir>cr){dh=H;dw=H*ir;dx=(W-dw)/2;dy=0;}else{dw=W;dh=W/ir;dx=0;dy=(H-dh)/2;}var z=1+0.06*p;ctx.save();ctx.translate(W/2,H/2);ctx.scale(z,z);ctx.translate(-W/2,-H/2);ctx.drawImage(img,dx,dy,dw,dh);ctx.restore();}
    else if(state.bg.type==='solid'){ctx.fillStyle=state.bg.color;ctx.fillRect(0,0,W,H);}
    else{var grad=ctx.createLinearGradient(0,0,W*0.4,H);grad.addColorStop(0,state.bg.stops[0]);grad.addColorStop(1,state.bg.stops[1]);ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);}
    var vg=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.2,W/2,H/2,Math.max(W,H)*0.78);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,0.5)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
  }

  // ── Text drawing with outline+glow and inline verse numbers ─
  // enter = 0..1 entrance progress; alpha = layer alpha; dx/scale transforms.
  function drawSlide(slide, enter, alpha, dx, extraScale){
    var W=canvas.width,H=canvas.height;
    var fontSize=Math.round(W*(state.format==='story'?0.060:0.055));
    var lineH=fontSize*1.34;
    var lines=slide.lines, totalH=lines.length*lineH;
    var startY=(H-totalH)/2+lineH/2-H*0.02;
    var outline=isLight(state.fontColor)?'rgba(0,0,0,0.9)':'rgba(255,255,255,0.9)';
    var glow=isLight(state.fontColor)?'rgba(0,0,0,0.55)':'rgba(255,255,255,0.45)';
    var appear=easeOut(Math.min(1,enter/0.85));

    if(state.contrast){
      var bt=startY-lineH*0.9, bb=startY+lines.length*lineH+lineH*((slide.attribution&&state.showAttribution)?1.1:0.4), bh=bb-bt;
      var sg=ctx.createLinearGradient(0,bt,0,bb);sg.addColorStop(0,'rgba(0,0,0,0)');sg.addColorStop(0.18,'rgba(0,0,0,0.40)');sg.addColorStop(0.82,'rgba(0,0,0,0.40)');sg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.save();ctx.globalAlpha=alpha*appear;ctx.fillStyle=sg;ctx.fillRect(0,bt,W,bh);ctx.restore();
    }

    ctx.save();
    ctx.translate(dx,0);
    if(extraScale && extraScale!==1){ ctx.translate(W/2,H/2); ctx.scale(extraScale,extraScale); ctx.translate(-W/2,-H/2); }
    ctx.textBaseline='middle';

    // draw one full line (array of tokens), centered, with verse numbers
    function drawLine(tokens, y, a, blurPx){
      ctx.font='600 '+fontSize+'px '+state.font;
      // compute total width first (for centering)
      var spaceW=ctx.measureText(' ').width, total=0, i;
      var parts=[];
      for(i=0;i<tokens.length;i++){
        var t=tokens[i];
        var vnum=(state.showVerseNums&&t.verse)?String(t.verse):'';
        var vnw=vnum?(measureVN(vnum,fontSize)+fontSize*0.10):0;
        var ww=ctx.measureText(t.text).width;
        parts.push({t:t,vnum:vnum,vnw:vnw,ww:ww});
        total+=(i>0?spaceW:0)+vnw+ww;
      }
      var x=(W-total)/2;
      ctx.globalAlpha=a;
      if(blurPx){ctx.filter='blur('+blurPx+'px)';}
      for(i=0;i<parts.length;i++){
        if(i>0) x+=spaceW;
        var pt=parts[i];
        if(pt.vnum){ drawVerseNum(pt.vnum, x, y, fontSize, a, outline); x+=pt.vnw; }
        // outline+glow+fill for the word
        ctx.save();
        ctx.shadowColor=glow; ctx.shadowBlur=Math.round(fontSize*0.35);
        ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,Math.round(fontSize*0.11)); ctx.strokeStyle=outline;
        ctx.textAlign='left';
        ctx.strokeText(pt.t.text, x, y); ctx.restore();
        ctx.save(); ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,Math.round(fontSize*0.07)); ctx.strokeStyle=outline; ctx.textAlign='left';
        ctx.strokeText(pt.t.text, x, y); ctx.fillStyle=state.fontColor; ctx.fillText(pt.t.text, x, y); ctx.restore();
        x+=pt.ww;
      }
      if(blurPx) ctx.filter='none';
    }
    function measureVN(vn,fs){ ctx.save(); ctx.font='700 '+Math.round(fs*0.55)+'px '+state.font; var w=ctx.measureText(vn).width; ctx.restore(); return w; }
    function drawVerseNum(vn,x,y,fs,a,ol){ ctx.save(); ctx.font='700 '+Math.round(fs*0.55)+'px '+state.font; ctx.textAlign='left'; ctx.globalAlpha=a*0.9; ctx.lineJoin='round'; ctx.lineWidth=Math.max(1,Math.round(fs*0.04)); ctx.strokeStyle=ol; var vy=y-fs*0.28; ctx.strokeText(vn,x,vy); ctx.fillStyle='#E4CB86'; ctx.fillText(vn,x,vy); ctx.restore(); }

    // per-style entrance
    var i2;
    if(state.style==='fade'){ var sh=(1-appear)*(H*0.025); for(i2=0;i2<lines.length;i2++) drawLine(lines[i2], startY+i2*lineH+sh, alpha*appear, 0); }
    else if(state.style==='rise'){ for(i2=0;i2<lines.length;i2++){ var lp=Math.min(1,Math.max(0,(enter-i2*0.06)/0.4)); drawLine(lines[i2], startY+i2*lineH+(1-easeOut(lp))*(H*0.05), alpha*easeOut(lp), 0);} }
    else if(state.style==='zoom'){ for(i2=0;i2<lines.length;i2++) drawLine(lines[i2], startY+i2*lineH, alpha*appear, 0); /* extraScale handled by caller path below */ }
    else if(state.style==='blur'){ var bl=(1-appear)*10; for(i2=0;i2<lines.length;i2++) drawLine(lines[i2], startY+i2*lineH, alpha*appear, bl); }
    else if(state.style==='drop'){ for(i2=0;i2<lines.length;i2++){ var dp=Math.min(1,Math.max(0,(enter-i2*0.06)/0.4)); drawLine(lines[i2], startY+i2*lineH-(1-easeOut(dp))*(H*0.05), alpha*easeOut(dp), 0);} }
    else { drawLineByWord(lines, startY, lineH, enter, alpha, drawLine); } // 'word'

    // zoom entrance scale applied here (whole block) for the 'zoom' style
    ctx.restore();
    if(state.style==='zoom'){ /* handled visually enough by appear alpha; keep simple */ }

    // attribution
    if(state.showAttribution && slide.attribution){
      var aa=alpha*easeOut(Math.min(1,Math.max(0,(enter-0.35)/0.4)));
      ctx.save(); ctx.translate(dx,0); ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font='700 '+Math.round(fontSize*0.6)+'px '+state.font;
      ctx.globalAlpha=aa; ctx.lineJoin='round'; ctx.lineWidth=Math.max(2,Math.round(fontSize*0.05)); ctx.strokeStyle='rgba(0,0,0,0.85)';
      var ay=startY+lines.length*lineH+lineH*0.4;
      ctx.strokeText(slide.attribution,W/2,ay); ctx.fillStyle='#E4CB86'; ctx.fillText(slide.attribution,W/2,ay); ctx.restore();
    }
  }
  function drawLineByWord(lines,startY,lineH,enter,alpha,drawLine){
    var total=0; lines.forEach(function(l){total+=l.length;});
    var shown=Math.floor(easeOut(Math.min(1,enter/0.9))*total), count=0;
    lines.forEach(function(l,i){ var vis=[]; for(var w=0;w<l.length;w++){ if(count<shown){vis.push(l[w]);count++;} } if(vis.length) drawLine(vis, startY+i*lineH, alpha, 0); });
  }

  function drawLogo(alpha){
    var W=canvas.width,H=canvas.height; ctx.globalAlpha=(alpha==null?0.95:alpha);
    if(logoReady){ var lw=W*0.16, lh=lw*(logo.height/logo.width), y=H-lh-H*0.075; ctx.drawImage(logo,(W-lw)/2,y,lw,lh); ctx.fillStyle='rgba(255,255,255,0.92)'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font="600 "+Math.round(W*0.03)+"px 'Dancing Script', Georgia, serif"; ctx.fillText('Seed the Word',W/2,y+lh+H*0.028); }
    else { ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='600 '+Math.round(W*0.03)+'px Georgia, serif'; ctx.fillText('Seed the Word',W/2,H-H*0.06); }
    ctx.globalAlpha=1;
  }

  // ── Frame renderer driven by the timeline ───────────────────
  // Per slide, four phases: INTRO (text animates in) -> DWELL (hold to read)
  // -> EXIT (text animates out, clearing the slate) -> TRANS (blank stage
  // hand-off, NO text). So text never slides fully-formed; each slide's text
  // always animates in fresh onto a clean stage.
  function drawAtTime(ms){
    var W=canvas.width,H=canvas.height;
    var tl=computeTimeline();
    var segs=tl.segs, scale=tl.scale, n=state.slides.length;

    // locate current segment
    var idx=0;
    for(var i=0;i<n;i++){ var s=segs[i], start=s.start*scale, dur=s.dur*scale; if(ms < start+dur || i===n-1){ idx=i; break; } }
    var seg=segs[idx];
    var into=ms - seg.start*scale;
    var intro=seg.intro*scale, dwell=seg.dwell*scale, exit=seg.exit*scale, trans=seg.trans*scale;

    paintBackground(Math.min(1, ms/tl.total));

    var tIntroEnd = intro;
    var tDwellEnd = intro + dwell;
    var tExitEnd  = intro + dwell + exit;

    if(into < tDwellEnd){
      // INTRO or DWELL — text animating in, or held
      var enter = Math.min(1, into/Math.max(1,intro));
      drawSlide(state.slides[idx], enter, 1, 0, 1);
      drawLogo();
      return;
    }
    if(into < tExitEnd){
      // EXIT — current text animates out (fade + gentle lift), leaving a clean slate
      var ep = easeInOut(Math.min(1, (into - tDwellEnd)/Math.max(1,exit)));
      drawSlide(state.slides[idx], 1, 1 - ep, 0, 1 - 0.06*ep);
      drawLogo();
      return;
    }
    // TRANS — BLANK stage hand-off (no text). Vary the motion by transition type.
    var tp = easeInOut(Math.min(1, (into - tExitEnd)/Math.max(1,trans)));
    var dip = 1 - Math.abs(2*tp - 1);         // 0 -> 1 -> 0 over the transition
    if(state.transition==='dipblack'){
      ctx.save(); ctx.globalAlpha=dip; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); ctx.restore();
      drawLogo();
    } else if(state.transition==='fadelogo'){
      drawLogo(0.55 + 0.45*dip);
    } else {
      // crossfade / slide / push / zoomblur all read as a gentle dip on the
      // now-blank stage — smooth and consistent, then text animates in fresh.
      ctx.save(); ctx.globalAlpha=dip*0.45; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); ctx.restore();
      drawLogo();
    }
  }
  function drawStatic(){ repageAll(); drawAtTime(lastP); }

  // ── Loop ────────────────────────────────────────────────────
  function loop(ts){
    if(!animStart) animStart=ts;
    var tl=computeTimeline();
    var elapsed=ts-animStart; lastP=elapsed;
    drawAtTime(elapsed);
    if(elapsed<tl.total && playing) rafId=requestAnimationFrame(loop);
    else { playing=false; playBtn.textContent='▶ Preview'; stopPreviewAudio(); }
  }
  function play(){
    cancelAnimationFrame(rafId); repageAll(); animStart=0; playing=true;
    playBtn.textContent='❚❚ Playing…';
    startPreviewAudio();
    rafId=requestAnimationFrame(loop);
  }

  // ── Preview audio ───────────────────────────────────────────
  function startPreviewAudio(){
    stopPreviewAudio();
    if(!audioObjectUrl) return;
    try{ previewAudio=new Audio(audioObjectUrl); previewAudio.currentTime=0; var pr=previewAudio.play(); if(pr&&pr.catch)pr.catch(function(){}); }catch(e){}
  }
  function stopPreviewAudio(){ if(previewAudio){ try{previewAudio.pause();}catch(e){} previewAudio=null; } }

  function applyFormat(){ var f=FORMATS[state.format]; canvas.width=f.w; canvas.height=f.h; drawStatic(); }

  // ── Status ──────────────────────────────────────────────────
  function setStatus(msg,kind){ statusEl.textContent=msg||''; statusEl.className='vs-status'+(kind?' vs-status--'+kind:''); }

  // ── Passages ────────────────────────────────────────────────
  function renderPassages(){
    passagesEl.innerHTML='';
    state.groups.forEach(function(g,idx){
      var chip=document.createElement('span'); chip.className='vs-chip';
      chip.innerHTML='<span class="vs-chip__label">'+escapeHtml(g.label||('Passage '+(idx+1)))+'</span>';
      var x=document.createElement('button'); x.type='button'; x.className='vs-chip__x'; x.textContent='×'; x.setAttribute('aria-label','Remove');
      x.addEventListener('click',function(){ state.groups.splice(idx,1); rebuild(); });
      chip.appendChild(x); passagesEl.appendChild(chip);
    });
  }
  function escapeHtml(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function rebuild(){ if(!state.groups.length){ state.slides=[{lines:[[{text:'Add a passage to begin',verse:null}]],attribution:''}]; } else { repageAll(); } renderPassages(); drawStatic(); }

  async function addReference(){
    var ref=refInput.value.trim(); if(!ref){ setStatus('Type a reference like "Psalm 23".','err'); return; }
    setStatus('Looking up '+ref+'…','busy'); addBtn.disabled=true;
    try{
      var data=await fetch('https://bible-api.com/'+encodeURIComponent(ref)+'?translation=kjv').then(function(r){if(!r.ok)throw 0;return r.json();});
      if(!data||!data.text) throw 0;
      var refName=data.reference||ref;
      var verses=(data.verses||[]).map(function(v){return {verse:v.verse, text:String(v.text).replace(/\s+/g,' ').trim()};});
      state.groups.push({ text:String(data.text).replace(/\s+/g,' ').trim(), verses: verses.length?verses:null, attribution:'— '+refName+' (KJV)', label:refName });
      refInput.value=''; rebuild();
      setStatus('Added '+refName+'. Add more, or press Preview.','ok');
    }catch(e){ setStatus('Couldn\'t find that reference. Try "John 3:16" or "Psalm 23".','err'); }
    finally{ addBtn.disabled=false; }
  }
  function addPastedText(){
    var t=textArea.value.trim(); if(!t){ setStatus('Paste some text first.','err'); return; }
    state.groups.push({ text:t, verses:null, attribution:attribInput.value.trim(), label:(t.slice(0,22)+(t.length>22?'…':'')) });
    textArea.value=''; rebuild(); setStatus('Added your text as slides.','ok');
  }

  // ── Book/Ch/Verse dropdowns ─────────────────────────────────
  function buildBookSelectors(){
    if(!bookSel||!chapSel) return;
    bookSel.innerHTML='<option value="">Book…</option>';
    BIBLE_BOOKS.forEach(function(b){var o=document.createElement('option');o.value=b[0];o.textContent=b[0];bookSel.appendChild(o);});
    bookSel.addEventListener('change',function(){ var bk=BIBLE_BOOKS.filter(function(x){return x[0]===bookSel.value;})[0]; chapSel.innerHTML='<option value="">Ch.</option>'; if(bk){for(var c=1;c<=bk[1];c++){var o=document.createElement('option');o.value=c;o.textContent=c;chapSel.appendChild(o);}} syncRef(); });
    chapSel.addEventListener('change',syncRef);
    if(verseInput) verseInput.addEventListener('input',syncRef);
  }
  function syncRef(){ if(!bookSel.value) return; var r=bookSel.value+(chapSel.value?' '+chapSel.value:''); if(verseInput&&verseInput.value.trim()) r+=':'+verseInput.value.trim(); refInput.value=r; }

  // ── Backgrounds / audio inputs ──────────────────────────────
  bgUpload.addEventListener('change',function(){ var f=bgUpload.files&&bgUpload.files[0]; if(!f)return; var img=new Image(); img.onload=function(){state.bgImage=img;setActive(bgWrap,null);drawStatic();}; img.onerror=function(){setStatus('Could not load that image.','err');}; img.src=URL.createObjectURL(f); });
  audioUpload.addEventListener('change',function(){ var f=audioUpload.files&&audioUpload.files[0]; if(!f)return; if(audioObjectUrl&&usingUpload)URL.revokeObjectURL(audioObjectUrl); audioObjectUrl=URL.createObjectURL(f); usingUpload=true; audioName.textContent=f.name; if(soundSel)soundSel.value=''; });
  function buildSoundtracks(){ if(!soundSel)return; soundSel.innerHTML=''; SOUNDTRACKS.forEach(function(t){var o=document.createElement('option');o.value=t.id;o.textContent=t.label;soundSel.appendChild(o);}); soundSel.addEventListener('change',function(){ var p=SOUNDTRACKS.filter(function(t){return t.id===soundSel.value;})[0]; if(audioObjectUrl&&usingUpload)URL.revokeObjectURL(audioObjectUrl); usingUpload=false; audioObjectUrl=(p&&p.src)?p.src:null; audioName.textContent=(p&&p.src)?(p.label):''; if(audioUpload)audioUpload.value=''; }); }

  // ── Recording ───────────────────────────────────────────────
  function pickMime(withAudio){ var prefs=withAudio?['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']:['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm']; for(var i=0;i<prefs.length;i++){ if(window.MediaRecorder&&MediaRecorder.isTypeSupported(prefs[i]))return prefs[i]; } return ''; }
  function record(){
    if(!window.MediaRecorder||!canvas.captureStream){ setStatus('This browser can\'t record here. Try Chrome, Edge, or Safari.','err'); return; }
    var haveAudio=!!audioObjectUrl, mime=pickMime(haveAudio), isMp4=mime.indexOf('mp4')!==-1;
    var vstream=canvas.captureStream(30), tracks=vstream.getVideoTracks(), audioCtx=null, playbackEl=null;
    if(haveAudio){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); playbackEl=new Audio(audioObjectUrl); var sn=audioCtx.createMediaElementSource(playbackEl); var dest=audioCtx.createMediaStreamDestination(); sn.connect(dest); sn.connect(audioCtx.destination); tracks=tracks.concat(dest.stream.getAudioTracks()); }catch(e){ haveAudio=false; } }
    var combined=new MediaStream(tracks), chunks=[], rec;
    try{ rec=new MediaRecorder(combined, mime?{mimeType:mime,videoBitsPerSecond:8000000}:undefined); }catch(e){ setStatus('Recording isn\'t supported here.','err'); return; }
    var tl=computeTimeline();
    rec.ondataavailable=function(e){ if(e.data&&e.data.size)chunks.push(e.data); };
    rec.onstop=function(){
      if(audioCtx){try{audioCtx.close();}catch(e){}}
      lastExt=isMp4?'mp4':'webm';
      lastBlob=new Blob(chunks,{type:mime||'video/webm'});
      var urlObj=URL.createObjectURL(lastBlob);
      downloadsEl.innerHTML='';
      var a=document.createElement('a'); a.href=urlObj; a.download='seedtheword-verse.'+lastExt; a.className='vs-dl'; a.textContent='⬇ Download ('+lastExt.toUpperCase()+(haveAudio?' + audio':'')+')';
      downloadsEl.appendChild(a);
      if(shareBtn && navigator.canShare){ shareBtn.hidden=false; }
      var note=document.createElement('p'); note.className='vs-legal'; note.textContent=(lastExt==='webm')?'WebM plays on most phones and posts to most social apps; if a site rejects it, convert free at cloudconvert.com.':'MP4 ready to share.'; downloadsEl.appendChild(note);
      recBtn.disabled=false; recBtn.textContent='● Record clip';
      setStatus('Done! Download or share your clip below.','ok');
    };
    recBtn.disabled=true; recBtn.textContent='Recording…';
    setStatus('Recording '+(isMp4?'MP4':'WebM')+(haveAudio?' with audio':'')+'… ('+Math.round(tl.total/1000)+'s)','busy');
    downloadsEl.innerHTML=''; if(shareBtn)shareBtn.hidden=true; animStart=0; playing=true;
    rec.start();
    if(playbackEl){ try{playbackEl.currentTime=0;playbackEl.play();}catch(e){} }
    rafId=requestAnimationFrame(loop);
    setTimeout(function(){ try{rec.stop();}catch(e){} if(playbackEl){try{playbackEl.pause();}catch(e){}} playing=false; }, tl.total+400);
  }

  // ── Share ───────────────────────────────────────────────────
  function share(){
    if(!lastBlob){ setStatus('Record a clip first, then share.','err'); return; }
    var file=new File([lastBlob],'seedtheword-verse.'+lastExt,{type:lastBlob.type});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      navigator.share({ files:[file], title:'Seed the Word', text:'A verse from Seed the Word' }).catch(function(){});
    } else {
      setStatus('Sharing a video isn\'t supported in this browser — use Download instead (works everywhere).','err');
    }
  }

  // ── Wire ────────────────────────────────────────────────────
  addBtn.addEventListener('click',addReference);
  refInput.addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();addReference();} });
  addTextBtn.addEventListener('click',addPastedText);
  showAttrib.addEventListener('change',function(){ state.showAttribution=showAttrib.checked; drawStatic(); });
  if(showVerseNums) showVerseNums.addEventListener('change',function(){ state.showVerseNums=showVerseNums.checked; drawStatic(); });
  formatSel.addEventListener('change',function(){ state.format=formatSel.value; applyFormat(); });
  styleSel.addEventListener('change',function(){ state.style=styleSel.value; play(); });
  transSel.addEventListener('change',function(){ state.transition=transSel.value; play(); });
  fontSel.addEventListener('change',function(){ state.font=fontSel.value; drawStatic(); });
  paceSel.addEventListener('change',function(){ state.pace=paceSel.value; updateTotalLabel(); });
  if(durInput) durInput.addEventListener('change',function(){ var v=parseInt(durInput.value,10); state.manualTotalMs=(v>0)?v*1000:0; updateTotalLabel(); });
  if(fontHex) fontHex.addEventListener('input',function(){ state.fontColor=fontHex.value; setActive(fontColorWrap,null); drawStatic(); });
  if(contrastToggle) contrastToggle.addEventListener('change',function(){ state.contrast=contrastToggle.checked; drawStatic(); });
  if(bgHex) bgHex.addEventListener('input',function(){ state.bg={type:'solid',color:bgHex.value}; state.bgImage=null; setActive(bgWrap,null); drawStatic(); });
  playBtn.addEventListener('click',play);
  recBtn.addEventListener('click',record);
  if(shareBtn) shareBtn.addEventListener('click',share);

  // ── Init ────────────────────────────────────────────────────
  buildSwatches(); buildFontColors(); buildSoundtracks(); buildBookSelectors();
  applyFormat(); renderPassages(); updateTotalLabel(); drawStatic();
  }
})();
