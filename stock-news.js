/* Per-stock news, shared by the Home stock card's News tab and Stock Analysis.
   window.mpStockNews.render(host, { symbol, name, client })
   Three sources, newest first in each section:
     1. MarketPulse news tagged to the stock (news table, with short/long-term impact tags)
     2. Latest headlines from Google News, last 14 days       } stock-news Edge Function,
     3. The company's NSE filings (results, dividends, orders) } cached 15 min */
(function () {
  const FN = 'https://fzazdrzlemmkqngvpzxj.supabase.co/functions/v1/stock-news';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; } };
  const ago = (iso) => {
    if (!iso) return '';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
    if (m < 60) return Math.max(1, m) + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    if (m < 7 * 1440) return Math.round(m / 1440) + ' d ago';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  const tone = (v) => { const s = String(v || '').toLowerCase(); return /pos|bull/.test(s) ? 'up' : /neg|bear/.test(s) ? 'down' : 'flat'; };

  const css = document.createElement('style');
  css.textContent = `
.msn{display:grid;gap:14px}
.msn-sec h4{margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,var(--muted,#8b93a7))}
.msn-sec h4 span{font-weight:600;letter-spacing:0;text-transform:none}
.msn-list{display:grid;gap:2px}
.msn-item{display:block;padding:9px 10px;border-radius:10px;text-decoration:none!important;color:var(--text,inherit)!important;border:1px solid transparent}
.msn-item:hover{background:var(--surface-hover,var(--hover,rgba(127,127,127,.08)));border-color:var(--border,var(--line2,rgba(127,127,127,.2)))}
.msn-item b{display:block;font-size:13.5px;font-weight:600;line-height:1.45}
.msn-item p{margin:3px 0 0;font-size:12.5px;line-height:1.5;color:var(--text-secondary,var(--muted,#a0a0b8))}
.msn-meta{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;margin-top:4px;font-size:11.5px;color:var(--text-muted,var(--muted,#8b93a7))}
.msn-tag{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px}
.msn-tag.up{background:rgba(34,197,94,.14);color:var(--positive,var(--green,#22c55e))}
.msn-tag.down{background:rgba(239,68,68,.14);color:var(--negative,var(--red,#ef4444))}
.msn-tag.flat{background:rgba(245,166,35,.14);color:var(--neutral,var(--gold,#f5a623))}
.msn-more{margin-top:4px;border:1px solid var(--border,var(--line2,rgba(127,127,127,.25)));background:none;color:var(--text,inherit);border-radius:8px;padding:6px 10px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.msn-empty{font-size:13px;color:var(--text-muted,var(--muted,#8b93a7));padding:6px 2px}
.msn-skel{height:54px;border-radius:10px;background:linear-gradient(90deg,rgba(127,127,127,.08),rgba(127,127,127,.16),rgba(127,127,127,.08));background-size:200% 100%;animation:msnSk 1.2s infinite}
@keyframes msnSk{to{background-position:-200% 0}}`;
  document.head.appendChild(css);

  let run = 0;
  async function ours(client, symbol) {
    if (!client) return [];
    const { data, error } = await client.from('news')
      .select('title,summary,short_term_impact,long_term_impact,source_link,published_at,created_at')
      .eq('is_visible', true).eq('symbol', symbol)
      .order('published_at', { ascending: false, nullsFirst: false }).limit(6);
    if (error) throw error;
    return data || [];
  }
  async function external(symbol, name) {
    const r = await fetch(FN + '?symbol=' + encodeURIComponent(symbol) + (name ? '&name=' + encodeURIComponent(name) : ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function list(items, first, row) {
    if (!items.length) return '';
    const head = items.slice(0, first).map(row).join('');
    const rest = items.slice(first);
    return `<div class="msn-list">${head}</div>${rest.length ? `<div class="msn-list" hidden>${rest.map(row).join('')}</div><button type="button" class="msn-more" data-msn-more>Show ${rest.length} more</button>` : ''}`;
  }

  async function render(host, { symbol, name, client } = {}) {
    if (!host || !symbol) return;
    const id = ++run;
    symbol = String(symbol).toUpperCase();
    host.innerHTML = '<div class="msn"><div class="msn-skel"></div><div class="msn-skel"></div><div class="msn-skel"></div></div>';
    const [a, b] = await Promise.allSettled([ours(client, symbol), external(symbol, name)]);
    if (id !== run) return;
    const mp = a.status === 'fulfilled' ? a.value : [];
    const ext = b.status === 'fulfilled' ? b.value : {};
    const heads = ext.headlines || [], files = ext.filings || [];
    if (!mp.length && !heads.length && !files.length) {
      host.innerHTML = `<div class="msn-empty">${a.status === 'rejected' && b.status === 'rejected' ? 'News could not be loaded right now. Please try again shortly.' : 'No news for ' + esc(symbol) + ' in the last two weeks.'}</div>`;
      return;
    }
    const mpRow = (n) => {
      const link = safeUrl(n.source_link);
      return `<${link ? `a href="${esc(link)}" target="_blank" rel="noopener"` : 'div'} class="msn-item"><b>${esc(n.title || '')}</b>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
        <div class="msn-meta">${n.short_term_impact ? `<span class="msn-tag ${tone(n.short_term_impact)}">Short term: ${esc(n.short_term_impact)}</span>` : ''}${n.long_term_impact ? `<span class="msn-tag ${tone(n.long_term_impact)}">Long term: ${esc(n.long_term_impact)}</span>` : ''}<span>${esc(ago(n.published_at || n.created_at))}</span></div></${link ? 'a' : 'div'}>`;
    };
    const headRow = (h) => {
      const link = safeUrl(h.url);
      return `<${link ? `a href="${esc(link)}" target="_blank" rel="noopener"` : 'div'} class="msn-item"><b>${esc(h.title)}</b><div class="msn-meta"><span>${esc(h.source || 'News')}</span><span>· ${esc(ago(h.published_at))}</span></div></${link ? 'a' : 'div'}>`;
    };
    const fileRow = (f) => {
      const link = safeUrl(f.url);
      return `<${link ? `a href="${esc(link)}" target="_blank" rel="noopener"` : 'div'} class="msn-item"><b>${esc(f.subject)}</b>${f.detail ? `<p>${esc(f.detail)}</p>` : ''}<div class="msn-meta"><span>NSE filing</span><span>· ${esc(ago(f.published_at))}</span>${link ? '<span>· PDF</span>' : ''}</div></${link ? 'a' : 'div'}>`;
    };
    host.innerHTML = `<div class="msn">
      ${mp.length ? `<div class="msn-sec"><h4>MarketPulse analysis <span>· impact-tagged</span></h4>${list(mp, 3, mpRow)}</div>` : ''}
      <div class="msn-sec"><h4>Latest headlines <span>· last 14 days</span></h4>${heads.length ? list(heads, 6, headRow) : '<div class="msn-empty">No recent headlines found.</div>'}</div>
      <div class="msn-sec"><h4>NSE filings <span>· company announcements</span></h4>${files.length ? list(files, 4, fileRow) : '<div class="msn-empty">No recent filings found.</div>'}</div>
    </div>`;
    host.querySelectorAll('[data-msn-more]').forEach((btn) => btn.addEventListener('click', () => { btn.previousElementSibling.hidden = false; btn.remove(); }));
  }

  window.mpStockNews = { render };
})();
