/* Data health dashboard for the Admin Panel (admin-news.html, "Data health" tab). Admins only:
   data_health() refuses anyone else. Database checks come from data_health()
   (supabase/data-health.sql); live checks call each backend function from this browser and read the
   published blog posts. window.mpAdminHealth.mount(host, supabaseClient, { onCount }) */
(function () {
  const SB_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co', KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let root = null, sb = null, onCount = null, timer = null;
  const css = document.createElement('style');
  css.textContent = `
.ah{--ok:#2fd27f;--warn:#f3c969;--fail:#ff5d6c;--idle:#8b8fa3;--okbg:rgba(47,210,127,.12);--warnbg:rgba(243,201,105,.14);--failbg:rgba(255,93,108,.13);--ah-surface:var(--surface,#1A1A2E);--ah-border:var(--border,#2A2A4A);--ah-text:var(--text,#E8E8F0);--ah-muted:var(--muted,#A0A0B8);--ah-dim:var(--dim,#6B6B8A)}
.ah-hero{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.ah-card{background:var(--ah-surface);border:1px solid var(--ah-border);border-radius:12px;padding:12px 14px;min-width:0}
.ah-overall{border-left:4px solid var(--ok)}.ah-overall.warn{border-left-color:var(--warn)}.ah-overall.fail{border-left-color:var(--fail)}
.ah-l{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ah-dim)}
.ah-v{font-size:22px;font-weight:800;letter-spacing:-.3px;line-height:1.2;margin-top:2px}
.ah-s{font-size:12px;color:var(--ah-muted);margin-top:2px}
.ah-num.ok .ah-v{color:var(--ok)}.ah-num.warn .ah-v{color:var(--warn)}.ah-num.fail .ah-v{color:var(--fail)}.ah-num.idle .ah-v{color:var(--idle)}
.ah-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.ah-seg{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--ah-border);border-radius:10px;background:var(--ah-surface)}
.ah-seg button{border:0;background:none;color:var(--ah-muted);font-weight:700;font-size:12.5px;font-family:inherit;padding:6px 12px;border-radius:7px;cursor:pointer}
.ah-seg button.on{background:#4f46e5;color:#fff}
.ah-btn{border:1px solid var(--ah-border);background:var(--ah-surface);color:var(--ah-text);border-radius:9px;padding:7px 12px;font-weight:700;font-size:12.5px;font-family:inherit;cursor:pointer}
.ah-btn:disabled{opacity:.5}
.ah-stamp{margin-left:auto;font-size:12px;color:var(--ah-dim)}
.ah-grp{margin-bottom:14px}
.ah-grp h2{margin:0 0 7px;font-size:14.5px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ah-grp h2 span{font-size:12px;color:var(--ah-dim);font-weight:600}
.ah-rows{background:var(--ah-surface);border:1px solid var(--ah-border);border-radius:12px;overflow:hidden}
.ah-row{display:grid;grid-template-columns:88px minmax(0,1.2fr) minmax(0,2fr) 150px;gap:12px;align-items:center;padding:10px 14px;border-top:1px solid var(--ah-border)}
.ah-row:first-child{border-top:0}
.ah-row.fail{background:linear-gradient(90deg,var(--failbg),transparent 45%)}.ah-row.warn{background:linear-gradient(90deg,var(--warnbg),transparent 45%)}
.ah-nm{font-weight:700;font-size:13.5px;line-height:1.35}
.ah-ex{font-size:11.5px;color:var(--ah-dim)}
.ah-dt{font-size:12.5px;color:var(--ah-muted);line-height:1.45;overflow-wrap:anywhere}
.ah-last{font-size:12px;color:var(--ah-muted);text-align:right;font-variant-numeric:tabular-nums}
.ah-last small{display:block;color:var(--ah-dim);font-size:11px}
.ah-pill{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;width:max-content}
.ah-pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.ah-pill.ok{color:var(--ok);background:var(--okbg)}.ah-pill.warn{color:var(--warn);background:var(--warnbg)}.ah-pill.fail{color:var(--fail);background:var(--failbg)}
.ah-pill.idle,.ah-pill.info{color:var(--idle);background:rgba(139,143,163,.14)}.ah-pill.wait{color:#818cf8;background:rgba(129,140,248,.14)}
.ah-note{font-size:12px;color:var(--ah-dim);line-height:1.6;margin-top:14px}
.ah-empty{padding:18px;text-align:center;color:var(--ah-muted)}
@media(max-width:900px){
 .ah-hero{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
 .ah-overall{grid-column:1/-1}
 .ah-num{padding:8px 10px;text-align:center}.ah-num .ah-v{font-size:20px}.ah-num .ah-l{font-size:9.5px;letter-spacing:.03em}
 .ah-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"nm pill" "dt dt" "last last";gap:4px 10px;padding:11px 12px}
 .ah-row>.ah-pill{grid-area:pill;align-self:start}.ah-row>.ah-name{grid-area:nm}.ah-row>.ah-dt{grid-area:dt}.ah-row>.ah-last{grid-area:last;text-align:left}
 .ah-last small{display:inline;margin-left:6px}
 .ah-stamp{width:100%;margin-left:0}
}`;
  document.head.appendChild(css);
  const q = (id) => root.querySelector('[data-ah="' + id + '"]');
const ORDER = { fail: 0, warn: 1, wait: 2, ok: 3, idle: 4, info: 5 };
  const LABEL = { ok: 'OK', warn: 'Late', fail: 'Broken', idle: 'Idle', info: 'Info', wait: 'Checking' };
  let db = null, live = [], filter = 'all', busy = false;
  
  function ago(v) {
    if (!v) return '';
    const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v + 'T10:00:00Z') : Date.parse(v);
    if (!Number.isFinite(t)) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const m = Math.round((Date.now() - t) / 60e3);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago' : Math.round(m / 1440) + ' days ago';
  }
  const ist = (v) => v && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '';
  
  /* ───────── Live checks: each backend function, called from this browser ───────── */
  async function timed(url, test) {
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
      const ms = Math.round(performance.now() - t0);
      if (!r.ok) return { status: 'fail', detail: 'HTTP ' + r.status + ' after ' + ms + ' ms' };
      const d = await r.json();
      const [ok, what] = test(d);
      return { status: ok ? (ms > 8000 ? 'warn' : 'ok') : 'fail', detail: what + ' · ' + ms + ' ms' + (ms > 8000 ? ' (slow)' : '') };
    } catch (e) { return { status: 'fail', detail: 'Request failed: ' + (e.message || e) }; }
  }
  function lastSessionDate(d) { return d && d.last_session; }
  const LIVE = [
    ['GIFT Nifty & index charts (index-sparklines)', () => timed(SB_URL + '/functions/v1/index-sparklines', (d) => {
      const g = d.gift_nifty, n = Object.values(d.series || {}).filter((s) => s.points && s.points.length).length;
      return [!!(g && g.price) && n > 0, (g && g.price ? 'GIFT Nifty ' + g.price + (g.live ? ' (live)' : ' (closed' + (g.as_of ? ', last traded ' + g.as_of : '') + ')') : 'no GIFT Nifty reading at all') + ' · ' + n + ' index charts'];
    })],
    ['Option chain (option-chain, NSE)', () => timed(SB_URL + '/functions/v1/option-chain?symbol=NIFTY', (d) => [(d.rows || []).length > 20, (d.rows || []).length + ' strikes · PCR ' + (d.pcr ?? '—') + ' · NSE as of ' + (d.timestamp || '—')])],
    ['Nifty history (index-history)', () => timed(SB_URL + '/functions/v1/index-history?index=NIFTY50', (d) => [(d.closes || []).length > 200, (d.closes || []).length + ' daily closes'])],
    ['Stock quote (stock-data)', () => timed(SB_URL + '/functions/v1/stock-data?symbol=RELIANCE', (d) => { const q = d.data || d.stock || d; return [Number(q.price) > 0, 'RELIANCE ₹' + (q.price ?? '—')]; })],
    ['Stock news (stock-news: Google News + NSE filings)', () => timed(SB_URL + '/functions/v1/stock-news?symbol=RELIANCE&name=Reliance%20Industries%20Limited', (d) => [(d.headlines || []).length > 0 || (d.filings || []).length > 0, (d.headlines || []).length + ' headlines · ' + (d.filings || []).length + ' filings' + ((d.errors || []).length ? ' · errors: ' + d.errors.join('; ') : '')])],
    ['Mutual fund NAVs (mf-data)', () => timed(SB_URL + '/functions/v1/mf-data?q=nifty', (d) => { const n = (d.funds || d.results || d || []).length || 0; return [n > 0, n + ' funds found for "nifty"']; })],
    ['Global market page data (global_market)', async () => {
      const t0 = performance.now();
      const { data, error } = await sb.rpc('global_market');
      if (error) return { status: 'fail', detail: error.message };
      const n = (data.quotes || []).length;
      return { status: n >= 30 ? 'ok' : 'warn', detail: n + ' quotes · ' + Math.round(performance.now() - t0) + ' ms' };
    }],
  ];
  // Blog posts are built by GitHub Actions and published with the site.
  async function blogChecks() {
    try {
      const r = await fetch('/blog/posts.json?_=' + Date.now(), { cache: 'no-store' });
      const posts = await r.json();
      const latest = {}; for (const p of posts) if (!latest[p.category] || p.date > latest[p.category]) latest[p.category] = p.date;
      const sess = db && db.last_session;
      const istNow = new Date(Date.now() + 330 * 60e3), today = istNow.toISOString().slice(0, 10), mins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
      // Market posts are due after the close (~15:40–17:00 IST); FII/DII after NSE's evening data (~19:30).
      const prevOf = (d) => { const t = new Date(d + 'T00:00:00Z'); do { t.setUTCDate(t.getUTCDate() - 1); } while ([0, 6].includes(t.getUTCDay())); return t.toISOString().slice(0, 10); };
      const want = (dueMin) => !sess ? null : (sess === today && mins < dueMin ? prevOf(sess) : sess);
      return [['Daily Wrap', 'daily-wrap', 1050], ['Sector Analysis', 'sector-analysis', 1050], ['Stock Spotlight', 'stock-spotlight', 1050], ['FII / DII post', 'fiidii-flows', 1260]].map(([nm, cat, due]) => {
        const have = (latest[cat] || '').slice(0, 10), w = want(due);
        const status = !have ? 'fail' : !w || have >= w ? 'ok' : have >= prevOf(w) ? 'warn' : 'fail';
        return { group: 'Blog (published site)', name: nm, status, detail: (have ? 'Latest post ' + have : 'No posts') + (w ? ' · expected ' + w : ''), last: latest[cat] || null };
      });
    } catch (e) { return [{ group: 'Blog (published site)', name: 'posts.json', status: 'fail', detail: 'Could not read /blog/posts.json: ' + e.message }]; }
  }
  
  /* ───────── Render ───────── */
  function render() {
    const all = [...(db ? db.checks : []), ...live];
    const count = (s) => all.filter((c) => c.status === s).length;
    const f = count('fail'), w = count('warn'), ok = count('ok'), idle = count('idle') + count('info');
    const overall = f ? 'fail' : w ? 'warn' : 'ok';
    q('hero').innerHTML = `<div class="ah-card ah-overall ${overall}"><div class="ah-l">Overall</div><div class="ah-v">${f ? f + ' broken' : w ? w + ' running late' : 'All systems normal'}</div>
      <div class="ah-s">${db ? (db.market_open ? 'Market open' : 'Market closed') + ' · ' + esc(db.ist) + ' IST · last session ' + esc(db.last_session) : 'Loading…'}</div></div>
      <div class="ah-card ah-num fail"><div class="ah-l">Broken</div><div class="ah-v">${f}</div></div><div class="ah-card ah-num warn"><div class="ah-l">Late</div><div class="ah-v">${w}</div></div>
      <div class="ah-card ah-num ok"><div class="ah-l">OK</div><div class="ah-v">${ok}</div></div><div class="ah-card ah-num idle"><div class="ah-l">Idle</div><div class="ah-v">${idle}</div></div>`;
    const groups = {};
    for (const c of all) (groups[c.group] || (groups[c.group] = [])).push(c);
    const order = ['Live checks', 'Market data', 'News & content', 'Blog (published site)', 'Signals', 'Background jobs', 'Scheduler'];
    q('groups').innerHTML = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((g) => {
      let rows = groups[g].slice().sort((a, b) => ORDER[a.status] - ORDER[b.status]);
      const bad = rows.filter((c) => c.status === 'fail' || c.status === 'warn').length;
      if (filter === 'problems') rows = rows.filter((c) => c.status === 'fail' || c.status === 'warn');
      if (!rows.length) return '';
      return `<section class="ah-grp"><h2>${esc(g)} <span>${groups[g].length} check${groups[g].length === 1 ? '' : 's'}${bad ? ' · ' + bad + ' need attention' : ''}</span></h2><div class="ah-rows">${rows.map((c) => `
        <div class="ah-row ${c.status}"><span class="ah-pill ${c.status}"><i></i>${LABEL[c.status] || c.status}</span>
          <div class="ah-name"><div class="ah-nm">${esc(c.name)}</div>${c.expect ? `<div class="ah-ex">${esc(c.expect)}</div>` : ''}</div>
          <div class="ah-dt">${esc(c.detail || '')}</div>
          <div class="ah-last">${c.last ? esc(ago(c.last)) + `<small>${esc(ist(c.last))}</small>` : ''}</div></div>`).join('')}</div></section>`;
    }).join('') || '<div class="ah-card ah-empty">No problems right now. 🎉</div>';
    q('stamp').textContent = db ? 'Checked ' + new Date(db.checked_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '';
  }
  
  async function check() {
    if (busy) return; busy = true; q('refresh').disabled = true;
    live = LIVE.map(([name]) => ({ group: 'Live checks', name, status: 'wait', detail: 'Checking…' }));
    try {
      const { data, error } = await sb.rpc('data_health');
      if (error) throw error;
      db = data;
    } catch (e) { db = { checks: [{ group: 'Market data', name: 'Health check', status: 'fail', detail: e.message }], checked_at: new Date().toISOString(), ist: '', last_session: '' }; }
    render();
    const blog = await blogChecks();
    await Promise.all(LIVE.map(async ([name, fn], i) => { const r = await fn(); live[i] = { group: 'Live checks', name, ...r }; render(); }));
    live.push(...blog); render();
    if (onCount) { const all = [...(db ? db.checks : []), ...live]; onCount(all.filter((c) => c.status === 'fail').length, all.filter((c) => c.status === 'warn').length); }
    busy = false; q('refresh').disabled = false;
  }

  function mount(host, client, opts = {}) {
    sb = client; onCount = opts.onCount || null;
    if (!root) {
      root = host;
      root.classList.add('ah');
      root.innerHTML = `<section class="ah-hero" data-ah="hero"></section>
        <div class="ah-bar"><div class="ah-seg"><button class="on" data-filter="all" type="button">All checks</button><button data-filter="problems" type="button">Problems only</button></div>
          <button class="ah-btn" data-ah="refresh" type="button">↻ Re-check</button><span class="ah-stamp" data-ah="stamp"></span></div>
        <div data-ah="groups"></div>
        <p class="ah-note">Database checks compare each feed's newest data with what should exist right now: live feeds are strict during NSE hours (Mon–Fri 09:15–15:30 IST) and only need the last session's data otherwise, so nights and weekends don't raise false alarms. Exchange holidays aren't known, so on a holiday market-hours feeds can show as late. Live checks call each backend function from this browser. Re-checks every 2 minutes while this tab is open.</p>`;
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-filter]');
        if (b) { filter = b.dataset.filter; root.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b)); render(); }
        if (e.target.closest('[data-ah="refresh"]')) check();
      });
      timer = setInterval(() => { if (!document.hidden && root.offsetParent) check(); }, 120e3);
    }
    return check();
  }
  window.mpAdminHealth = { mount, check: () => check() };
})();
