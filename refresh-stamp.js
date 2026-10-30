/* "Updated 12s ago" pill, pinned to the bottom-left corner so it stays visible while scrolling.
   It watches the page's own data calls (Supabase REST / RPC / edge functions) and stamps the time of
   the last successful one, so pages need no wiring. Load it in <head>, before the Supabase client is
   created, because supabase-js keeps the fetch it finds at creation time.
   A page can set window.mpRefreshNow = () => {...} to make the pill a "refresh now" button.
   A view with its own refresh cycle can take over the pill with
   window.mpStampCycle = { last: <ms timestamp of its last refresh>, every: <ms> }, which shows
   "Updated 12s ago · next in 18s" from those times; set it back to null to return to normal. */
(function () {
  if (window.mpStamp) return;
  let last = 0, el = null, busy = false;
  const isData = (url, method) => {
    if (!/\.supabase\.co\/(rest|functions)\/v1\//.test(url)) return false;
    if (/\/rest\/v1\/(rpc\/)?(user_ticker|profiles|page_views|visits)/.test(url)) return false;
    // Plain writes to tables are user actions, not data refreshes.
    return method === 'GET' || /\/rest\/v1\/rpc\/|\/functions\/v1\//.test(url);
  };
  const orig = window.fetch && window.fetch.bind(window);
  if (orig) window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const p = orig(input, init);
    if (isData(url, method)) p.then((r) => { if (r && r.ok) stamp(); }).catch(() => {});
    return p;
  };

  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's ago';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm ago';
  }
  function paint() {
    const cyc = window.mpStampCycle;
    if (cyc && cyc.last) { mount(); if (el) el.hidden = false; }
    if (!el || !(last || (cyc && cyc.last))) return;
    const age = Date.now() - (cyc && cyc.last ? cyc.last : last);
    el.querySelector('b').textContent = ago(age);
    const nx = el.querySelector('em');
    if (cyc && cyc.last && cyc.every) {
      const left = Math.max(0, Math.ceil((cyc.last + cyc.every - Date.now()) / 1000));
      nx.textContent = left ? '· next in ' + left + 's' : '· refreshing…';
      nx.hidden = false;
    } else nx.hidden = true;
    el.dataset.age = age < (cyc && cyc.every ? cyc.every * 2 + 5e3 : 90e3) ? 'fresh' : age < 10 * 60e3 ? 'ok' : 'stale';
    el.title = 'Last data refresh: ' + new Date(last).toLocaleTimeString('en-IN') + (window.mpRefreshNow ? ' · tap to refresh now' : '');
    // Sit above whichever phone bottom bar the page shows (Home's, the shared header's, or the page's own).
    let h = 0;
    document.querySelectorAll('.mp-tabbar,.mph-tabbar,#tabbar').forEach((bar) => {
      const cs = getComputedStyle(bar), r = bar.getBoundingClientRect();
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position === 'fixed' && r.height && Math.abs(r.bottom - innerHeight) < 4) h = Math.max(h, r.height);
    });
    el.style.bottom = 'calc(' + Math.round(h + 12) + 'px + ' + (h ? '0px' : 'env(safe-area-inset-bottom)') + ')';
  }
  function mount() {
    if (el || !document.body) return;
    const css = document.createElement('style');
    css.textContent = '.mp-stamp{position:fixed;left:12px;bottom:12px;z-index:140;display:inline-flex;align-items:center;gap:7px;padding:6px 11px 6px 9px;border-radius:999px;font:600 12px/1.2 Inter,system-ui,sans-serif;color:var(--text-muted,var(--muted,#94a3b8));background:color-mix(in srgb,var(--surface,var(--card,#111827)) 92%,transparent);border:1px solid var(--border,rgba(148,163,184,.25));box-shadow:0 6px 18px rgba(0,0,0,.22);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:default;user-select:none}' +
      '.mp-stamp b{color:var(--text,#e5e7eb);font-weight:700;font-variant-numeric:tabular-nums}' +
      '.mp-stamp em{font-style:normal;font-variant-numeric:tabular-nums}' +
      '.mp-stamp i{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:0 0 auto}' +
      '.mp-stamp[data-age=fresh] i{background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:mpStampPulse 2s infinite}' +
      '.mp-stamp[data-age=ok] i{background:#f59e0b}' +
      '.mp-stamp.can{cursor:pointer}.mp-stamp.can:hover{color:var(--text,#e5e7eb)}' +
      '.mp-stamp.busy i{animation:mpStampSpin .8s linear infinite;background:transparent;border:2px solid #6366f1;border-top-color:transparent;width:6px;height:6px}' +
      '.mp-stamp[hidden]{display:none!important}' +
      '@keyframes mpStampPulse{70%{box-shadow:0 0 0 6px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}' +
      '@keyframes mpStampSpin{to{transform:rotate(360deg)}}' +
      '@media print{.mp-stamp{display:none}}';
    document.head.appendChild(css);
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'mp-stamp';
    el.hidden = true;
    el.setAttribute('aria-live', 'off');
    el.innerHTML = '<i aria-hidden="true"></i><span>Updated</span><b></b><em hidden></em>';
    el.addEventListener('click', async () => {
      if (!window.mpRefreshNow || busy) return;
      busy = true; el.classList.add('busy');
      try { await window.mpRefreshNow(); } catch (_) {}
      busy = false; el.classList.remove('busy');
    });
    document.body.appendChild(el);
    if (last) { el.hidden = false; paint(); }
  }
  function stamp() {
    last = Date.now();
    mount();
    if (el) { el.hidden = false; el.classList.toggle('can', !!window.mpRefreshNow); paint(); }
  }
  window.mpStamp = stamp;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  setInterval(paint, 1000);
  window.addEventListener('resize', paint);
})();
