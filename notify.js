/* Notifications bell (🔔 in the header on every page). Reads site_notifications_feed() (supabase/notifications.sql):
   new festive picks, strong trade signals, picks hitting targets, IPOs opening/listing and site updates.
   Mounts into every element with [data-mp-bell] (the shared header adds one; Home has its own).
   "New" = newer than the last time the bell was opened on this device (localStorage). While a page is open
   the feed is re-checked every minute, and anything new pops up as a small toast.
   Signed in: the "My alerts" tab adds the user's own alerts (my_alerts(), supabase/alerts.sql: price alerts, big moves,
   results and dividends on their stocks, signals on their stocks, paper trades closing). Those are read/unread on the
   server, so they stay in step across devices; opening the bell marks them read. */
(function () {
  if (window.MPNotify) return;
  const URL_ = window.MP_CONFIG.supabaseUrl + '/rest/v1/rpc/site_notifications_feed';
  const KEY = window.MP_CONFIG.supabaseKey;
  const SEEN = 'mpNotifSeen', CACHE = 'mpNotifCache';
  const KINDS = [['all', 'All'], ['mine', 'My alerts'], ['picks', 'Picks'], ['signal', 'Signals'], ['ipo', 'IPOs'], ['update', 'Updates']];
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (t) => new Date(t).getTime();
  function ago(t) {
    const s = Math.max(0, (Date.now() - ms(t)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d < 7 ? d + ' days ago' : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  const CSS = `
.mpn-btn{position:relative;width:38px;height:38px;border-radius:10px;border:1px solid var(--mpn-line);background:var(--mpn-surface);color:var(--mpn-text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;padding:0}
.mpn-btn:hover{border-color:#818cf8}
.mpn-btn svg{display:block}
.mpn-btn.has svg{animation:mpn-ring 2.4s ease-in-out 1}
.mpn-badge{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font:800 11px/19px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px var(--mpn-bg)}
.mpn-badge::after{content:"";position:absolute;inset:-3px;border-radius:999px;border:2px solid #ef4444;opacity:0;animation:mpn-pulse 2s ease-out infinite}
@keyframes mpn-pulse{0%{transform:scale(.85);opacity:.8}100%{transform:scale(1.5);opacity:0}}
@keyframes mpn-ring{0%,100%{transform:rotate(0)}10%,30%{transform:rotate(14deg)}20%,40%{transform:rotate(-14deg)}50%{transform:rotate(0)}}
.mpn-panel{position:fixed;z-index:2147483000;width:380px;max-height:min(560px,calc(100vh - 90px));display:flex;flex-direction:column;background:var(--mpn-bg);color:var(--mpn-text);border:1px solid var(--mpn-line);border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.45);font:14px/1.4 Inter,system-ui,-apple-system,sans-serif;overflow:hidden}
.mpn-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;flex:0 0 auto}
.mpn-head b{font-size:16px}
.mpn-head button{border:0;background:none;color:#818cf8;font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer;padding:4px}
.mpn-tabs{display:flex;flex:0 0 auto;align-items:center;gap:6px;padding:2px 14px 10px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;border-bottom:1px solid var(--mpn-line)}
.mpn-tabs::-webkit-scrollbar{display:none}
.mpn-tabs button{flex:0 0 auto;white-space:nowrap;line-height:1.4;border:1px solid var(--mpn-line);background:var(--mpn-surface);color:var(--mpn-muted);border-radius:999px;padding:4px 10px;font:700 12px Inter,system-ui,sans-serif;cursor:pointer}
.mpn-tabs button.on{background:#4f46e5;border-color:#4f46e5;color:#fff}
.mpn-tabs button i{font-style:normal;opacity:.8;margin-left:3px}
.mpn-list{overflow-y:auto;flex:1 1 auto;min-height:0;overscroll-behavior:contain}
.mpn-item{display:flex;gap:11px;padding:11px 14px;text-decoration:none;color:inherit;border-bottom:1px solid var(--mpn-line);position:relative}
.mpn-item:hover{background:var(--mpn-hover)}
.mpn-item.new{background:var(--mpn-new)}
.mpn-ic{flex:0 0 36px;height:36px;border-radius:10px;background:var(--mpn-surface);display:flex;align-items:center;justify-content:center;font-size:18px}
.mpn-item.k-mine .mpn-ic{background:rgba(239,68,68,.13)}
.mpn-foot a{color:#818cf8;font-weight:700;text-decoration:none;float:right}
.mpn-item.k-signal .mpn-ic{background:rgba(34,197,94,.14)}.mpn-item.k-picks .mpn-ic{background:rgba(245,158,11,.16)}.mpn-item.k-target .mpn-ic{background:rgba(245,158,11,.16)}.mpn-item.k-ipo .mpn-ic{background:rgba(59,130,246,.15)}.mpn-item.k-update .mpn-ic{background:rgba(129,140,248,.16)}
.mpn-tx{min-width:0;flex:1}
.mpn-tx b{display:block;font-size:13.5px;font-weight:700;line-height:1.3}
.mpn-tx p{margin:2px 0 0;font-size:12.5px;color:var(--mpn-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mpn-tx small{display:block;font-size:11px;color:var(--mpn-dim);margin-top:3px}
.mpn-item.off{opacity:.55}
.mpn-off{font-style:normal;font-weight:700;color:#f59e0b}
.mpn-dot{position:absolute;right:12px;top:14px;width:8px;height:8px;border-radius:50%;background:#ef4444}
.mpn-empty{padding:36px 16px;text-align:center;color:var(--mpn-muted)}
.mpn-foot{flex:0 0 auto;padding:8px 14px;font-size:11px;color:var(--mpn-dim);border-top:1px solid var(--mpn-line)}
.mpn-toast{position:fixed;z-index:2147483001;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));max-width:min(360px,calc(100vw - 32px));display:flex;gap:10px;align-items:center;background:#111827;color:#fff;border:1px solid #f59e0b;border-radius:14px;padding:10px 12px;box-shadow:0 14px 34px rgba(0,0,0,.4);font:14px/1.35 Inter,system-ui,sans-serif;cursor:pointer;transform:translateY(20px);opacity:0;transition:transform .25s,opacity .25s}
.mpn-toast.on{transform:none;opacity:1}
.mpn-toast span{font-size:22px}
.mpn-toast small{display:block;color:#cbd5e1;font-size:12px}
.mpn-toast button{border:0;background:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:0 2px}
:root{--mpn-bg:#0f1629;--mpn-surface:#151e37;--mpn-hover:#141c33;--mpn-new:rgba(79,70,229,.12);--mpn-line:#1f2a46;--mpn-text:#e7ecf6;--mpn-muted:#a3aec6;--mpn-dim:#6e7b98}
[data-theme=light]{--mpn-bg:#ffffff;--mpn-surface:#f3f4f8;--mpn-hover:#f7f8fb;--mpn-new:rgba(79,70,229,.07);--mpn-line:#e2e4ee;--mpn-text:#0f0f1a;--mpn-muted:#5a5d6b;--mpn-dim:#8b8fa3}
@media (max-width:600px){.mpn-panel{left:8px!important;right:8px!important;width:auto;max-height:calc(100vh - 150px);max-height:calc(100dvh - 150px)}.mpn-head b{font-size:15px}.mpn-btn{width:36px;height:36px}}
`;
  const BELL = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  let items = [], tab = 'all', panel = null, openBtn = null, seenAtOpen = null, loadedAt = Date.now(), toastShown = {};
  const buttons = [];

  function seen() {
    const v = ls.get(SEEN);
    if (v) return ms(v);
    return Date.now() - 3 * 864e5; // first visit: the last three days count as new
  }
  const isNew = (n) => n.kind === 'mine' ? !n.read : ms(n.at) > seen() && n.active !== false;
  const unread = () => items.filter(isNew);
  // The signed-in user's access token from supabase-js's saved session (null when signed out or expired).
  function token() {
    try {
      const s = JSON.parse(ls.get(window.MP_CONFIG.authStorageKey) || 'null');
      const t = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
      const exp = s && (s.expires_at || (s.currentSession && s.currentSession.expires_at));
      return t && (!exp || exp * 1000 > Date.now() + 30000) ? t : null;
    } catch (e) { return null; }
  }
  let mine = [];
  async function fetchMine() {
    const t = token(); if (!t) { mine = []; return; }
    const r = await fetch(window.MP_CONFIG.supabaseUrl + '/rest/v1/rpc/my_alerts', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: 40 }) });
    if (!r.ok) return;
    const d = await r.json();
    mine = (Array.isArray(d) ? d : []).map((a) => ({ id: 'u' + a.id, uid: a.id, kind: 'mine', sub: a.kind, icon: a.icon, title: a.title, body: a.body, url: a.url, at: a.created_at, read: !!a.read_at }));
  }
  function markMineRead() {
    const t = token(); if (!t || !mine.some((n) => !n.read)) return;
    mine.forEach((n) => { n.read = true; });
    fetch(window.MP_CONFIG.supabaseUrl + '/rest/v1/rpc/my_alerts_read', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  }

  async function fetchFeed(force) {
    if (!force) {
      try { const c = JSON.parse(ss.get(CACHE) || 'null'); if (c && Date.now() - c.t < 120000) { await fetchMine().catch(() => {}); items = merge(tidy(c.items)); return; } } catch (e) {}
    }
    const r = await fetch(URL_, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: 40 }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const site = tidy((d && d.items) || []);
    ss.set(CACHE, JSON.stringify({ t: Date.now(), items: site }));
    await fetchMine().catch(() => {});
    items = merge(site);
  }
  const merge = (site) => mine.concat(site).sort((a, b) => ms(b.at) - ms(a.at));

  function tidy(list) {
    let intraday = 0;
    return list.filter((n) => {
      if (n.kind !== 'signal' || !/^Intraday /.test(n.body || '')) return true;
      return Date.now() - ms(n.at) < 30 * 60000 && ++intraday <= 3;
    });
  }
  function paintBadges() {
    const n = unread().length;
    buttons.forEach((b) => {
      const badge = b.querySelector('.mpn-badge');
      badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
      b.classList.toggle('has', !!n);
      b.setAttribute('aria-label', n ? `Notifications: ${n} new` : 'Notifications');
      b.title = n ? `${n} new update${n > 1 ? 's' : ''}` : 'Notifications';
    });
  }

  function listHtml() {
    const cut = seenAtOpen ?? seen();
    const shown = items.filter((n) => tab === 'all' || n.kind === tab || (tab === 'picks' && n.kind === 'target'));
    if (!shown.length && tab === 'mine') return `<div class="mpn-empty">No alerts yet.<br>Price alerts, big moves, results and dividends for your holdings and watchlist will show up here. <a href="/alerts.html" style="color:#818cf8">Alert settings</a></div>`;
    if (!shown.length) return `<div class="mpn-empty">${items.length ? 'Nothing here in the last few days.' : 'No notifications yet.<br>New picks, strong signals and updates will show up here.'}</div>`;
    return shown.map((n) => {
      const off = n.active === false;  // a signal the scanner has since dropped
      const isNew = n.kind === 'mine' ? !n.wasRead : ms(n.at) > cut && !off;
      const tag = n.url ? 'a' : 'div';
      return `<${tag} class="mpn-item k-${esc(n.kind)}${isNew ? ' new' : ''}${off ? ' off' : ''}"${n.url ? ` href="${esc(n.url)}" target="_self"` : ''}>
        <span class="mpn-ic" aria-hidden="true">${esc(n.icon || '🔔')}</span>
        <span class="mpn-tx"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${ago(n.at)}${off ? ' · <em class="mpn-off">No longer active</em>' : ''}</small></span>${isNew ? '<span class="mpn-dot" aria-label="new"></span>' : ''}</${tag}>`;
    }).join('');
  }
  function counts() { const c = {}; items.forEach((n) => { const k = n.kind === 'target' ? 'picks' : n.kind; c[k] = (c[k] || 0) + 1; }); c.all = items.length; return c; }
  function paintPanel() {
    if (!panel) return;
    const c = counts();
    panel.querySelector('.mpn-tabs').innerHTML = KINDS.filter(([k]) => k === 'all' || c[k]).map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}<i>${c[k] || 0}</i></button>`).join('');
    panel.querySelector('.mpn-list').innerHTML = listHtml();
  }
  function place() {
    if (!panel || !openBtn) return;
    const r = openBtn.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 8) + 'px';
    if (innerWidth > 600) { panel.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px'; panel.style.left = 'auto'; }
  }
  function open(btn) {
    if (panel) { close(); return; }
    openBtn = btn; seenAtOpen = seen();
    mine.forEach((n) => { n.wasRead = n.read; });
    if (mine.some((n) => !n.read)) tab = 'mine';
    panel = document.createElement('div');
    panel.className = 'mpn-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML = `<div class="mpn-head"><b>Notifications</b><button type="button" data-act="read">Mark all as read</button></div><div class="mpn-tabs"></div><div class="mpn-list"></div><div class="mpn-foot">${token() ? '<a href="/alerts.html">Alert settings →</a>' : ''}Picks and signals are for education, not investment advice.</div>`;
    document.body.appendChild(panel);
    paintPanel(); place();
    btn.setAttribute('aria-expanded', 'true');
    // opening the bell counts as seeing everything up to the newest item; the "new" marks stay until it closes
    const newest = items.reduce((m, n) => Math.max(m, ms(n.at)), 0);
    if (newest) ls.set(SEEN, new Date(Math.max(newest, Date.now())).toISOString());
    markMineRead();
    paintBadges();
    fetchFeed(true).then(() => { mine.forEach((n) => { if (n.wasRead === undefined) n.wasRead = n.read; }); markMineRead(); paintPanel(); paintBadges(); }).catch(() => {});
  }
  function close() {
    if (!panel) return;
    panel.remove(); panel = null; seenAtOpen = null;
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    openBtn = null;
  }

  function toast(n) {
    if (toastShown[n.id]) return; toastShown[n.id] = 1;
    const t = document.createElement('div');
    t.className = 'mpn-toast'; t.setAttribute('role', 'status');
    t.innerHTML = `<span aria-hidden="true">${esc(n.icon || '🔔')}</span><div><b>${esc(n.title)}</b><small>${esc(n.body || 'Tap to see')}</small></div><button type="button" aria-label="Dismiss">×</button>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('on'));
    const kill = () => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); };
    t.addEventListener('click', (e) => { if (e.target.closest('button')) { kill(); return; } if (n.url) location.href = n.url; else { kill(); buttons[0] && open(buttons[0]); } });
    setTimeout(kill, 9000);
  }

  function mountOne(el) {
    if (el.dataset.mpnMounted) return;
    el.dataset.mpnMounted = '1';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mpn-btn'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = BELL + '<span class="mpn-badge" hidden></span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); open(b); });
    el.appendChild(b);
    buttons.push(b);
    paintBadges();
  }
  function mount() { document.querySelectorAll('[data-mp-bell]').forEach(mountOne); }

  async function refresh(force) {
    const before = new Set(items.map((n) => n.id));
    try { await fetchFeed(force); } catch (e) { return; }
    paintBadges(); paintPanel();
    // something arrived while this page is open: highlight it
    if (before.size) items.filter((n) => !before.has(n.id) && ms(n.at) > loadedAt - 60000 && isNew(n)).slice(0, 1).forEach(toast);
  }

  function init() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    mount();
    refresh(false);
    setInterval(() => { if (!document.hidden) refresh(true); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
    document.addEventListener('click', (e) => {
      if (!panel) return;
      const tb = e.target.closest('.mpn-tabs [data-tab]');
      if (tb) { tab = tb.dataset.tab; paintPanel(); return; }
      if (e.target.closest('[data-act="read"]')) { seenAtOpen = Date.now(); ls.set(SEEN, new Date().toISOString()); mine.forEach((n) => { n.read = true; n.wasRead = true; }); markMineRead(); paintPanel(); paintBadges(); return; }
      if (!panel.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    addEventListener('resize', place);
    addEventListener('scroll', place, { passive: true });
  }

  window.MPNotify = { mount, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
