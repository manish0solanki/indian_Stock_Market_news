/* Live market insights on Home (the "Latest Market Insights" section).
   While the market is open (09:15-15:30 IST, weekdays) the section shows the newest batch from
   public.live_insights, written every 15 minutes by refresh_live_insights() in Supabase, plus a short
   timeline of earlier Nifty readings. Before the open, after the close and on holidays it shows the
   blog cards (loadLatestBlogSnapshots in index.html), as before. */
(function () {
  const section = document.getElementById('latestBlogSnapshots');
  const grid = document.getElementById('latestBlogGrid');
  if (!section || !grid || typeof supabaseClient === 'undefined') return;

  const ICON = { pulse: '📈', breadth: '⚖️', sectors: '🏭', movers: '🚀', volume: '🔊', highs: '🏔️', results: '📊', signals: '🎯', global: '🌍' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const istNow = () => new Date(Date.now() + 330 * 60e3);
  const istDate = () => istNow().toISOString().slice(0, 10);
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  // 'open' 09:15-15:30 IST on weekdays, 'closed' for the rest of a weekday after 15:30, else 'off'.
  function sessionState() {
    const t = istNow(), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
    if (d === 0 || d === 6 || m < 555) return 'off';
    return m < 930 ? 'open' : 'closed';
  }
  // After the close the day's final insights stay up until today's Daily Wrap is published
  // (the blog job runs a little after 15:30), so the section never falls back to yesterday's posts.
  let wrapCheck = { at: 0, out: false };
  async function todayWrapOut() {
    if (wrapCheck.out || Date.now() - wrapCheck.at < 120e3) return wrapCheck.out;
    try {
      const posts = await (await fetch('/blog/posts.json?ts=' + Date.now(), { cache: 'no-store' })).json();
      const day = istDate();
      wrapCheck = { at: Date.now(), out: Array.isArray(posts) && posts.some((x) => x?.category === 'daily-wrap' && String(x.date || '').slice(0, 10) === day) };
    } catch (_) { wrapCheck = { at: Date.now(), out: false }; }
    return wrapCheck.out;
  }

  const title = section.querySelector('.latest-blog-title');
  const subtitle = section.querySelector('.latest-blog-subtitle');
  const allLink = section.querySelector('.latest-blog-all');
  const blogHead = { title: title?.textContent, subtitle: subtitle?.textContent, link: allLink?.outerHTML };
  const live = document.createElement('div');
  live.className = 'li-wrap';
  live.hidden = true;
  grid.before(live);

  let mode = 'blog', expanded = false, lastRun = '';

  function showBlogs() {
    if (mode === 'blog') return;
    mode = 'blog'; lastRun = '';
    if (speech.state !== 'idle') stopSpeech();
    if (typeof loadLatestBlogSnapshots === 'function') loadLatestBlogSnapshots(); // pick up articles published since the page loaded
    live.hidden = true; grid.hidden = false;
    section.classList.remove('li-live');
    if (title) title.textContent = blogHead.title;
    if (subtitle) subtitle.textContent = blogHead.subtitle;
    if (allLink) { allLink.textContent = 'View all articles →'; allLink.href = '/blog/'; }
  }

  let lastRows = null, lastClosed = false;
  function render(rows, closed) {
    lastRows = rows; lastClosed = closed;
    const runs = [];
    rows.forEach((r) => { let run = runs.find((x) => x.id === r.run_id); if (!run) runs.push(run = { id: r.run_id, at: r.created_at, items: [] }); run.items.push(r); });
    const latest = runs[0];
    latest.items.sort((a, b) => a.sort - b.sort);
    latestBatch = latest;
    mode = 'live';
    section.classList.add('li-live');
    grid.hidden = true; live.hidden = false;
    section.classList.toggle('li-closed', !!closed);
    if (title) title.innerHTML = closed ? "📊 Today's Market Insights" : '<span class="li-dot" aria-hidden="true"></span>Live Market Insights';
    // The job runs at :05, :20, :35 and :50 past each hour.
    const t = istNow(), m = t.getUTCMinutes(), nm = [5, 20, 35, 50].find((x) => x > m);
    const nextTxt = String((t.getUTCHours() + (nm === undefined ? 1 : 0)) % 24).padStart(2, '0') + ':' + String(nm ?? 5).padStart(2, '0');
    if (subtitle) subtitle.textContent = closed
      ? `Market closed · final insights as of ${hhmm(latest.at)} IST · today's articles replace these once published`
      : `Updated ${hhmm(latest.at)} IST · next update around ${nextTxt} · switches to the day's articles after the close`;
    if (allLink) { allLink.textContent = 'Read articles →'; allLink.href = '/blog/'; }

    const phone = matchMedia('(max-width: 560px)').matches;
    const shown = phone && !expanded ? latest.items.slice(0, 4) : latest.items;
    const chips = (r) => r.symbols?.length ? `<div class="li-chips">${r.symbols.slice(0, 8).map((s) => `<a href="/stock-analysis.html?symbol=${encodeURIComponent(s)}">${esc(s)}</a>`).join('')}</div>` : '';
    // The market pulse through the day, oldest to newest (last 12 readings).
    const trail = runs.slice(0, 12).reverse().map((run) => run.items.find((x) => x.kind === 'pulse')).filter(Boolean)
      .map((p) => { const v = Number(p.data?.nifty_pct); return `<span class="li-tick ${v >= 0 ? 'up' : 'down'}"><b>${esc(p.data?.at || hhmm(p.created_at))}</b>${Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%' : '—'}</span>`; });
    live.innerHTML =
      (closed
        ? `<div class="li-asof closed"><span>Market closed · final insights as of <b>${hhmm(latest.at)} IST</b></span><span class="li-next">Today's Daily Wrap will appear here once published</span>${listenControls()}</div>`
        : `<div class="li-asof"><span class="li-dot" aria-hidden="true"></span><span>Insights as of <b>${hhmm(latest.at)} IST</b> <span class="li-age" data-at="${esc(latest.at)}">${ago(latest.at)}</span></span><span class="li-next">Next update around ${nextTxt}</span>${listenControls()}</div>`) +
      `<div class="li-grid">${shown.map((r, i) => `
        <article class="li-card li-${esc(r.tone)} li-k-${esc(r.kind)}${speech.state !== 'idle' && speech.card === i ? ' li-reading' : ''}" data-i="${i}">
          <div class="li-top"><span class="li-ico" aria-hidden="true">${ICON[r.kind] || '•'}</span><h3>${esc(r.title)}</h3></div>
          ${r.body ? `<p>${esc(r.body)}</p>` : ''}${chips(r)}
        </article>`).join('')}</div>` +
      (phone && latest.items.length > 4 ? `<button type="button" class="li-more">${expanded ? 'Show fewer' : `Show all ${latest.items.length} insights`}</button>` : '') +
      (trail.length > 1 ? `<div class="li-trail"><span>Nifty through the day</span>${trail.join('')}</div>` : '') +
      '<div class="li-note">Generated automatically from live prices every 15 minutes. Information only, not investment advice.</div>';
    live.querySelector('.li-more')?.addEventListener('click', () => { expanded = !expanded; render(rows, closed); });
  }

  /* ───────── Read aloud (browser speech engine, same as the blog's Listen button) ───────── */
  const tts = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  let latestBatch = null;
  // queue: [{ text, card }] where card is the insight's index in the batch (-1 for the intro).
  const speech = { state: 'idle', queue: [], idx: 0, token: 0, card: -1 };
  let voice = null;
  const pickVoice = () => { const v = tts ? tts.getVoices() : []; voice = v.find((x) => /en[-_]IN/i.test(x.lang)) || v.find((x) => /^en[-_]GB/i.test(x.lang)) || v.find((x) => /^en/i.test(x.lang)) || null; };
  if (tts) { pickVoice(); tts.addEventListener?.('voiceschanged', pickVoice); }
  const readSpeed = () => { try { return Number(localStorage.getItem('mp-ra-speed')) || 1; } catch (_) { return 1; } };
  // Figures as they should sound: ₹ -> rupees, −0.4% -> minus 0.4%, 3.0× -> 3.0 times, 14:56 IST -> 14:56.
  const speakable = (t) => String(t || '').replace(/\s+/g, ' ').trim()
    .replace(/₹\s?/g, 'rupees ').replace(/\bCr\b\.?/g, 'crore')
    .replace(/(^|[\s(])[−-](?=\d)/g, '$1minus ').replace(/(^|[\s(])\+(?=\d)/g, '$1plus ')
    .replace(/(\d)\s?[x×](?=\W|$)/g, '$1 times').replace(/\bvs\.?\b/gi, 'versus')
    .replace(/advance\/decline/gi, 'advance decline ratio');
  function listenControls() {
    if (!tts) return '';
    const label = speech.state === 'playing' ? '⏸ Pause' : speech.state === 'paused' ? '▶ Resume' : '🔊 Listen';
    return `<span class="li-listen-wrap"><button type="button" class="li-listen" aria-label="Read the insights aloud">${label}</button>` +
      (speech.state !== 'idle' ? '<button type="button" class="li-stop" aria-label="Stop reading">■</button>' : '') + '</span>';
  }
  function paintSpeech() {
    const wrap = live.querySelector('.li-listen-wrap');
    if (wrap) wrap.outerHTML = listenControls();
    live.querySelectorAll('.li-card').forEach((c) => c.classList.toggle('li-reading', speech.state !== 'idle' && Number(c.dataset.i) === speech.card));
  }
  function speakNext(i) {
    const my = ++speech.token;
    if (i >= speech.queue.length) return stopSpeech();
    speech.idx = i; speech.card = speech.queue[i].card;
    paintSpeech();
    const el = live.querySelector(`.li-card[data-i="${speech.card}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const u = new SpeechSynthesisUtterance(speakable(speech.queue[i].text));
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-IN';
    u.rate = readSpeed();
    u.onend = () => { if (my === speech.token && speech.state === 'playing') speakNext(i + 1); };
    u.onerror = (e) => { if (my === speech.token && e.error !== 'interrupted' && e.error !== 'canceled') stopSpeech(); };
    tts.speak(u);
  }
  function stopSpeech() {
    speech.token++;
    if (tts) tts.cancel();
    speech.state = 'idle'; speech.card = -1;
    paintSpeech();
  }
  live.addEventListener('click', (e) => {
    if (e.target.closest('.li-stop')) return stopSpeech();
    if (!e.target.closest('.li-listen') || !latestBatch) return;
    if (speech.state === 'playing') { tts.pause(); speech.state = 'paused'; return paintSpeech(); }
    if (speech.state === 'paused') {
      speech.state = 'playing'; tts.resume(); paintSpeech();
      // Some mobile engines drop a paused utterance; restart the current card if resume does nothing.
      return setTimeout(() => { if (speech.state === 'playing' && !tts.speaking) { tts.cancel(); speakNext(speech.idx); } }, 300);
    }
    // Snapshot of the batch on screen; a new batch arriving mid-read doesn't interrupt it.
    const b = latestBatch;
    speech.queue = [{ text: (lastClosed ? 'Market closed. Final market insights as of ' : 'Live market insights as of ') + hhmm(b.at) + '.', card: -1 }]
      .concat(b.items.map((r, i) => ({ text: r.title + '. ' + (r.body || ''), card: i })));
    tts.cancel();
    speech.state = 'playing';
    // On phones show every card, so the one being read can be highlighted.
    if (matchMedia('(max-width: 560px)').matches && !expanded && b.items.length > 4 && lastRows) { expanded = true; render(lastRows, lastClosed); }
    speakNext(0);
  });
  addEventListener('pagehide', () => { if (tts) tts.cancel(); });

  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3)); return m < 1 ? '(just now)' : `(${m} min ago)`; };
  // Keep the "(n min ago)" text current between batches.
  setInterval(() => live.querySelectorAll('.li-age').forEach((el) => { el.textContent = ago(el.dataset.at); }), 30e3);

  let busy = false;
  async function refresh() {
    if (busy || document.hidden) return;
    const state = sessionState();
    if (state === 'off') return showBlogs();
    busy = true;
    try {
      if (state === 'closed' && await todayWrapOut()) return showBlogs();
      const { data, error } = await supabaseClient.from('live_insights')
        .select('run_id,created_at,sort,kind,tone,title,body,symbols,data')
        .eq('session_date', istDate()).order('created_at', { ascending: false }).limit(150);
      if (error) throw error;
      // Holidays write nothing; a batch older than 45 minutes means the job has stopped, so fall back.
      if (!data?.length || (state === 'open' && Date.now() - Date.parse(data[0].created_at) > 45 * 60e3)) return showBlogs();
      const key = data[0].run_id + state;
      if (key === lastRun && mode === 'live') return;
      lastRun = key;
      render(data, state === 'closed');
    } catch (e) {
      console.warn('[Live insights]', e);
    } finally { busy = false; }
  }
  refresh();
  setInterval(refresh, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (mode === 'live') { lastRun = ''; refresh(); } }, 200); });
})();
