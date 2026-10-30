/* Outside links stay inside MarketPulse.
   Any link that would open a new tab (target="_blank") or leads to another website is caught here.
   If the other site allows being embedded, it opens in a full-screen viewer panel over the page
   (close with ✕, the back button or Esc). If it refuses (many news sites and NSE do), it opens in
   the same tab instead, and the browser's back button returns to MarketPulse.
   The check is done by the frame-check edge function and remembered per site for the session. */
(function () {
  if (window.mpLinkViewer) return;
  const CHECK_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/frame-check?url=';
  const verdicts = new Map();
  try { Object.entries(JSON.parse(sessionStorage.getItem('mp-frame-ok') || '{}')).forEach(([k, v]) => verdicts.set(k, v)); } catch (_) {}
  const remember = (host, ok) => { verdicts.set(host, ok); try { sessionStorage.setItem('mp-frame-ok', JSON.stringify(Object.fromEntries(verdicts))); } catch (_) {} };

  let panel = null, frame = null, label = null, openOut = null, spinner = null;
  function build() {
    if (panel) return;
    const css = document.createElement('style');
    css.textContent =
      '.mp-lv{position:fixed;inset:0;z-index:400;display:flex;flex-direction:column;background:var(--bg,var(--background,#0b1120))}' +
      '.mp-lv[hidden]{display:none!important}' +
      '.mp-lv-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;padding-top:max(8px,env(safe-area-inset-top));border-bottom:1px solid var(--border,rgba(148,163,184,.25));background:var(--surface,var(--card,#111827))}' +
      '.mp-lv-bar button,.mp-lv-bar a{flex:0 0 auto;min-width:40px;height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--border,rgba(148,163,184,.3));background:transparent;color:var(--text,#e5e7eb);font:600 13px/36px Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer;text-align:center}' +
      '.mp-lv-title{flex:1;min-width:0;font:600 13px Inter,system-ui,sans-serif;color:var(--text-muted,var(--muted,#94a3b8));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.mp-lv-body{position:relative;flex:1;min-height:0}' +
      '.mp-lv-body iframe{width:100%;height:100%;border:0;background:#fff}' +
      '.mp-lv-spin{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 13px Inter,system-ui,sans-serif;color:var(--text-muted,#94a3b8);background:var(--bg,#0b1120)}' +
      '.mp-lv-spin[hidden]{display:none}' +
      'html.mp-lv-open,html.mp-lv-open body{overflow:hidden}';
    document.head.appendChild(css);
    panel = document.createElement('div');
    panel.className = 'mp-lv';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = '<div class="mp-lv-bar"><button type="button" class="mp-lv-close" aria-label="Close and go back">&#x2715;</button><span class="mp-lv-title"></span><a class="mp-lv-out" target="_self" rel="noopener">Open full page</a></div>' +
      '<div class="mp-lv-body"><div class="mp-lv-spin">Loading&hellip;</div><iframe title="Linked page" referrerpolicy="no-referrer-when-downgrade" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe></div>';
    document.body.appendChild(panel);
    frame = panel.querySelector('iframe');
    label = panel.querySelector('.mp-lv-title');
    openOut = panel.querySelector('.mp-lv-out');
    spinner = panel.querySelector('.mp-lv-spin');
    frame.addEventListener('load', () => { spinner.hidden = true; });
    panel.querySelector('.mp-lv-close').addEventListener('click', () => history.state?.mpViewer ? history.back() : close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) history.state?.mpViewer ? history.back() : close(); });
    // The phone's back button closes the viewer instead of leaving the page.
    addEventListener('popstate', () => { if (!panel.hidden) close(); });
  }
  function open(url, host) {
    build();
    label.textContent = host;
    openOut.href = url;
    spinner.hidden = false;
    frame.src = url;
    panel.hidden = false;
    document.documentElement.classList.add('mp-lv-open');
    history.pushState({ mpViewer: true }, '');
  }
  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    frame.src = 'about:blank';
    document.documentElement.classList.remove('mp-lv-open');
  }

  async function canFrame(url, host) {
    if (verdicts.has(host)) return verdicts.get(host);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(CHECK_URL + encodeURIComponent(url), { signal: ctl.signal });
      clearTimeout(t);
      const d = await r.json();
      const ok = !!(d && d.ok && d.frameable);
      remember(host, ok);
      return ok;
    } catch (_) { return false; }
  }

  document.addEventListener('click', async (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('download') || a.closest('.mp-lv')) return;
    let u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (_) { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const external = u.origin !== location.origin;
    if (!external) {
      // Our own pages always open in this tab.
      if (a.target === '_blank') { e.preventDefault(); location.href = u.href; }
      return;
    }
    e.preventDefault();
    if (await canFrame(u.href, u.hostname)) open(u.href, u.hostname.replace(/^www\./, ''));
    else location.href = u.href;
  }, true);

  window.mpLinkViewer = { open: (url) => { const u = new URL(url, location.href); open(u.href, u.hostname.replace(/^www\./, '')); }, close };
})();
