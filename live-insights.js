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
  function sessionOpen() {
    const t = istNow(), d = t.getUTCDay(), m = t.getUTCHours() * 60 + t.getUTCMinutes();
    return d > 0 && d < 6 && m >= 555 && m < 930;
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
    mode = 'blog';
    live.hidden = true; grid.hidden = false;
    section.classList.remove('li-live');
    if (title) title.textContent = blogHead.title;
    if (subtitle) subtitle.textContent = blogHead.subtitle;
    if (allLink) { allLink.textContent = 'View all articles →'; allLink.href = '/blog/'; }
  }

  function render(rows) {
    const runs = [];
    rows.forEach((r) => { let run = runs.find((x) => x.id === r.run_id); if (!run) runs.push(run = { id: r.run_id, at: r.created_at, items: [] }); run.items.push(r); });
    const latest = runs[0];
    latest.items.sort((a, b) => a.sort - b.sort);
    mode = 'live';
    section.classList.add('li-live');
    grid.hidden = true; live.hidden = false;
    if (title) title.innerHTML = '<span class="li-dot" aria-hidden="true"></span>Live Market Insights';
    // The job runs at :05, :20, :35 and :50 past each hour.
    const t = istNow(), m = t.getUTCMinutes(), nm = [5, 20, 35, 50].find((x) => x > m);
    const nextTxt = String((t.getUTCHours() + (nm === undefined ? 1 : 0)) % 24).padStart(2, '0') + ':' + String(nm ?? 5).padStart(2, '0');
    if (subtitle) subtitle.textContent = `Updated ${hhmm(latest.at)} IST · next update around ${nextTxt} · switches to the day's articles after the close`;
    if (allLink) { allLink.textContent = 'Read articles →'; allLink.href = '/blog/'; }

    const phone = matchMedia('(max-width: 560px)').matches;
    const shown = phone && !expanded ? latest.items.slice(0, 4) : latest.items;
    const chips = (r) => r.symbols?.length ? `<div class="li-chips">${r.symbols.slice(0, 8).map((s) => `<a href="/stock-analysis.html?symbol=${encodeURIComponent(s)}">${esc(s)}</a>`).join('')}</div>` : '';
    // The market pulse through the day, oldest to newest (last 12 readings).
    const trail = runs.slice(0, 12).reverse().map((run) => run.items.find((x) => x.kind === 'pulse')).filter(Boolean)
      .map((p) => { const v = Number(p.data?.nifty_pct); return `<span class="li-tick ${v >= 0 ? 'up' : 'down'}"><b>${esc(p.data?.at || hhmm(p.created_at))}</b>${Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%' : '—'}</span>`; });
    live.innerHTML =
      `<div class="li-asof"><span class="li-dot" aria-hidden="true"></span><span>Insights as of <b>${hhmm(latest.at)} IST</b> <span class="li-age" data-at="${esc(latest.at)}">${ago(latest.at)}</span></span><span class="li-next">Next update around ${nextTxt}</span></div>` +
      `<div class="li-grid">${shown.map((r) => `
        <article class="li-card li-${esc(r.tone)} li-k-${esc(r.kind)}">
          <div class="li-top"><span class="li-ico" aria-hidden="true">${ICON[r.kind] || '•'}</span><h3>${esc(r.title)}</h3></div>
          ${r.body ? `<p>${esc(r.body)}</p>` : ''}${chips(r)}
        </article>`).join('')}</div>` +
      (phone && latest.items.length > 4 ? `<button type="button" class="li-more">${expanded ? 'Show fewer' : `Show all ${latest.items.length} insights`}</button>` : '') +
      (trail.length > 1 ? `<div class="li-trail"><span>Nifty through the day</span>${trail.join('')}</div>` : '') +
      '<div class="li-note">Generated automatically from live prices every 15 minutes. Information only, not investment advice.</div>';
    live.querySelector('.li-more')?.addEventListener('click', () => { expanded = !expanded; render(rows); });
  }

  const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3)); return m < 1 ? '(just now)' : `(${m} min ago)`; };
  // Keep the "(n min ago)" text current between batches.
  setInterval(() => live.querySelectorAll('.li-age').forEach((el) => { el.textContent = ago(el.dataset.at); }), 30e3);

  let busy = false;
  async function refresh() {
    if (busy || document.hidden) return;
    if (!sessionOpen()) return showBlogs();
    busy = true;
    try {
      const { data, error } = await supabaseClient.from('live_insights')
        .select('run_id,created_at,sort,kind,tone,title,body,symbols,data')
        .eq('session_date', istDate()).order('created_at', { ascending: false }).limit(150);
      if (error) throw error;
      // Holidays write nothing; a batch older than 45 minutes means the job has stopped, so fall back.
      if (!data?.length || Date.now() - Date.parse(data[0].created_at) > 45 * 60e3) return showBlogs();
      if (data[0].run_id === lastRun && mode === 'live') return;
      lastRun = data[0].run_id;
      render(data);
    } catch (e) {
      console.warn('[Live insights]', e);
    } finally { busy = false; }
  }
  refresh();
  setInterval(refresh, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (mode === 'live') { lastRun = ''; refresh(); } }, 200); });
})();
