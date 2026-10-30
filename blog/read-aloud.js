/* "Listen" button on blog articles: reads the article text aloud with the browser's own speech engine
   (free, works offline, nothing sent anywhere). Reads the title, summary and article paragraphs only;
   breadcrumbs, key-number tiles, tables, the dashboard box and the disclaimer are skipped.
   Works on both post layouts: main.post (current generator) and article.aw (older posts).
   Loaded by /site-header.js on /blog/<category>/<post>/ pages. */
(function () {
  if (document.readyState === 'loading') return document.addEventListener('DOMContentLoaded', init);
  init();
function init() {
  if (window.mpReadAloud || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  const root = document.querySelector('main.post, article.aw');
  if (!root) return;
  window.mpReadAloud = true;
  const synth = window.speechSynthesis;

  const SKIP = '.crumbs, .bc, .meta, .am, .kpis, .ks, table, .tw, .dw, .track, .cb, .disclaimer, .cta, nav, script, style, .mp-ra';
  const isSkipped = (el) => !!el.closest(SKIP);
  // Title, then paragraphs and list items in page order.
  const blocks = [root.querySelector('h1')].concat([...root.querySelectorAll('p, li')])
    .filter((el) => el && !isSkipped(el))
    .filter((el) => !/not investment advice|compiled automatically/i.test(el.textContent))
    .filter((el) => el.textContent.trim().length > 2);
  if (blocks.length < 2) return;

  // Make figures sound natural: ₹1,185 Cr -> "rupees 1,185 crore", −0.41% -> "minus 0.41%", 14.8x -> "14.8 times".
  const speakable = (t) => t.replace(/\s+/g, ' ').trim()
    .replace(/MarketPulse summary:/i, 'Summary.')
    .replace(/₹\s?/g, 'rupees ')
    .replace(/\bCr\b\.?/g, 'crore')
    .replace(/(^|\s)[−-](?=\d)/g, '$1minus ')
    .replace(/(\d)\s?[x×](?=\W|$)/g, '$1 times')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\bNSE\b/g, 'N S E').replace(/\bFII\b/g, 'F I I').replace(/\bDII\b/g, 'D I I');

  const css = document.createElement('style');
  css.textContent =
    '.mp-ra{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0 18px}' +
    '.mp-ra button{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:0 14px;border-radius:999px;border:1px solid var(--border,rgba(148,163,184,.35));background:var(--surface,transparent);color:var(--text,inherit);font:600 13.5px/1 inherit;cursor:pointer}' +
    '.mp-ra button.main{background:var(--accent,#6366f1);border-color:transparent;color:#fff}' +
    '.mp-ra button[hidden]{display:none}' +
    '.mp-ra small{font-size:12px;opacity:.7}' +
    '.mp-ra-now{background:color-mix(in srgb,var(--accent,#6366f1) 16%,transparent);border-radius:6px;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent,#6366f1) 16%,transparent);transition:background .2s}';
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.className = 'mp-ra';
  bar.innerHTML = '<button type="button" class="main" data-a="play" aria-label="Listen to this article">🔊 <span>Listen</span></button>' +
    '<button type="button" data-a="stop" hidden aria-label="Stop reading">■ Stop</button>' +
    '<button type="button" data-a="speed" aria-label="Reading speed">1×</button>' +
    '<small></small>';
  const anchor = root.querySelector('.meta, .am') || root.querySelector('h1');
  anchor.after(bar);
  const playBtn = bar.querySelector('[data-a=play]'), stopBtn = bar.querySelector('[data-a=stop]'), speedBtn = bar.querySelector('[data-a=speed]'), note = bar.querySelector('small');

  const SPEEDS = [1, 1.25, 1.5, 0.85];
  let speed = 1;
  try { speed = Number(localStorage.getItem('mp-ra-speed')) || 1; } catch (_) {}
  speedBtn.textContent = speed + '×';
  const words = blocks.reduce((n, el) => n + el.textContent.split(/\s+/).length, 0);
  note.textContent = '~' + Math.max(1, Math.round(words / 160 / speed)) + ' min listen';

  // Prefer an Indian English voice, then any English voice.
  let voice = null;
  const pickVoice = () => {
    const v = synth.getVoices();
    voice = v.find((x) => /en[-_]IN/i.test(x.lang)) || v.find((x) => /^en[-_]GB/i.test(x.lang)) || v.find((x) => /^en/i.test(x.lang)) || null;
  };
  pickVoice();
  if (synth.onvoiceschanged !== undefined) synth.addEventListener('voiceschanged', pickVoice);

  let idx = 0, state = 'idle', token = 0;
  const mark = (i) => { blocks.forEach((b) => b.classList.remove('mp-ra-now')); if (blocks[i]) blocks[i].classList.add('mp-ra-now'); };
  function ui() {
    playBtn.querySelector('span').textContent = state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Listen';
    playBtn.firstChild.textContent = state === 'playing' ? '⏸ ' : '🔊 ';
    stopBtn.hidden = state === 'idle';
  }
  // One utterance per paragraph: avoids the Chrome cut-off on long text and lets us highlight as we go.
  function speakFrom(i) {
    const my = ++token;
    if (i >= blocks.length) return stop();
    idx = i;
    mark(i);
    if (i > 0) blocks[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
    const u = new SpeechSynthesisUtterance(speakable(blocks[i].textContent));
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-IN';
    u.rate = speed;
    u.onend = () => { if (my === token && state === 'playing') speakFrom(i + 1); };
    u.onerror = (e) => { if (my === token && e.error !== 'interrupted' && e.error !== 'canceled') stop(); };
    synth.speak(u);
  }
  function stop() {
    token++;
    synth.cancel();
    state = 'idle'; idx = 0;
    mark(-1); ui();
  }
  playBtn.addEventListener('click', () => {
    if (state === 'playing') { synth.pause(); state = 'paused'; }
    else if (state === 'paused') {
      // Some mobile engines lose a paused utterance; restart the current paragraph if resume does nothing.
      state = 'playing';
      synth.resume();
      setTimeout(() => { if (state === 'playing' && !synth.speaking) { synth.cancel(); speakFrom(idx); } }, 300);
    } else { synth.cancel(); state = 'playing'; speakFrom(0); }
    ui();
  });
  stopBtn.addEventListener('click', stop);
  speedBtn.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedBtn.textContent = speed + '×';
    try { localStorage.setItem('mp-ra-speed', String(speed)); } catch (_) {}
    note.textContent = '~' + Math.max(1, Math.round(words / 160 / speed)) + ' min listen';
    if (state === 'playing') { synth.cancel(); speakFrom(idx); } // apply the new speed from this paragraph
  });
  // Stop when leaving the page (otherwise some browsers keep talking).
  addEventListener('pagehide', () => synth.cancel());
  ui();
}
})();
