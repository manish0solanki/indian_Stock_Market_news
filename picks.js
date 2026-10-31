/* Festive picks (picks.html): 5 large, 5 mid and 5 small-cap stocks per occasion (Diwali, New Year, Holi...),
   from festive_picks_page() (supabase/festive-picks.sql), with live prices and the track record since the pick.
   ?o=<slug> selects an occasion. Picks are made by the festive-picks Edge Function. */
(function () {
  const SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
  const KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v);
  const rs = (v, d) => { v = num(v); if (v === null) return '—'; if (d === undefined) d = Number.isInteger(v) || v >= 1000 ? 0 : 2; return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const n1 = (v, d = 1) => (num(v) === null ? '—' : (+v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sp = (v, d = 1) => (num(v) === null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%');
  const cls = (v) => (num(v) === null ? '' : v >= 0 ? 'up' : 'down');
  const cr = (v) => (num(v) === null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN') + ' Cr');
  const dt = (s) => s ? new Date(String(s).length <= 10 ? s + 'T00:00:00+05:30' : s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
  const THEME = {
    diwali: { em: '🪔', deco: '🪔 ✨ 🪔 🌼 🪔 ✨ 🪔', greet: 'Wishing you a bright and prosperous Diwali!' },
    newyear: { em: '🎆', deco: '🎆 ✨ 🥂 🎉 🥂 ✨ 🎆', greet: 'Happy New Year — here is to a profitable year ahead!' },
    holi: { em: '🎨', deco: '🎨 💜 💛 💚 💙 🧡 🎨', greet: 'Happy Holi — may your portfolio be as colourful as the festival!' },
    akshaya: { em: '🪙', deco: '🪙 ✨ 🌾 🪙 🌾 ✨ 🪙', greet: 'Happy Akshaya Tritiya — buy what lasts.' },
    independence: { em: '🇮🇳', deco: '🇮🇳 ✨ 🇮🇳 ✨ 🇮🇳', greet: 'Happy Independence Day — bet on India for the long run.' },
  };
  const CAPS = [['large', 'Large cap'], ['mid', 'Mid cap'], ['small', 'Small cap']];

  function mono(sym) {
    let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 360;
    const letters = sym.replace(/[^A-Z]/g, '').slice(0, 2) || sym.slice(0, 2);
    return `<span class="mono" style="background:linear-gradient(135deg,hsl(${h} 70% 42%),hsl(${(h + 40) % 360} 75% 55%))">${esc(letters)}</span>`;
  }
  const short = (name) => String(name || '').replace(/\s+(Limited|Ltd\.?)$/i, '');

  async function load(slug) {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/festive_picks_page', {
      method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug || null }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  let D = null;
  function setTheme(t) {
    document.body.className = document.body.className.replace(/\bt-\w+/g, '').trim();
    document.body.classList.add('t-' + (THEME[t] ? t : 'diwali'));
  }

  function tabs(occs, sel) {
    $('occ').innerHTML = occs.map((o) => {
      const th = THEME[o.theme] || THEME.diwali;
      const state = o.status === 'published'
        ? (o.basket_return !== null ? `Since pick ${sp(o.basket_return)}` : 'Published')
        : `Out ${dt(o.publish_on)}`;
      return `<button type="button" role="tab" data-slug="${esc(o.slug)}" class="${o.slug === sel ? 'on' : ''}" aria-selected="${o.slug === sel}"><b><span class="em">${th.em}</span>${esc(o.title)}</b><small>${esc(state)}</small></button>`;
    }).join('');
    const on = $('occ').querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  const DL = `<div class="dl"><button type="button" class="dlbtn" id="dlBtn" aria-haspopup="true" aria-expanded="false">⬇ Download</button>
    <div class="dlmenu" id="dlMenu" role="menu" hidden>
      <button type="button" role="menuitem" data-dl="poster"><b>🖼️ Poster image</b><small>Wide PNG of all 15 picks, great for sharing</small></button>
      <button type="button" role="menuitem" data-dl="story"><b>📱 Phone story image</b><small>Tall PNG for WhatsApp status &amp; Instagram stories</small></button>
      <button type="button" role="menuitem" data-dl="pdf"><b>📄 PDF report</b><small>Cover, market note, every stock's reasons, risks &amp; target</small></button>
      <button type="button" role="menuitem" data-dl="share" class="dlshare" hidden><b>📤 Share image…</b><small>Send the story image straight to an app</small></button>
    </div></div>`;
  function hero(o, extra, withDl) {
    const th = THEME[o.theme] || THEME.diwali;
    return `<section class="hero">${withDl ? DL : ''}
      <div class="eyebrow">MarketPulse ${esc(o.name)} picks</div>
      <h1>${esc(o.title)}</h1>
      <div class="sub">${esc(o.subtitle || '')}</div>
      <div class="meta">${extra}</div>
      <div class="deco" aria-hidden="true">${th.deco.split(' ').map((e) => `<span>${e}</span>`).join('')}</div>
    </section>`;
  }

  function card(p) {
    const ret = num(p.price) !== null ? (p.price / p.pick_price - 1) * 100 : null;
    const left = num(p.price) !== null ? (p.target_price / p.price - 1) * 100 : null;
    return `<article class="card" data-open="${esc(p.symbol)}" tabindex="0" aria-label="${esc(short(p.name))}: details">
      ${p.target_hit_on ? '<span class="hit">🎯 Target hit</span>' : ''}
      <div class="top">${mono(p.symbol)}<div class="nm"><a href="/stock-analysis.html?symbol=${encodeURIComponent(p.symbol)}" data-sym="${esc(p.symbol)}">${esc(short(p.name))}</a><small>${esc(p.sector || p.broad_sector || '')}</small></div></div>
      <div class="trio"><div><span>Picked at</span><b>${rs(p.pick_price)}</b></div><div><span>Target</span><b>${rs(p.target_price)}</b></div><div class="upb"><span>Upside</span>▲${n1(p.metrics && p.metrics.upside, 0)}%</div></div>
      <div class="now"><span>Now <b>${rs(p.price)}</b></span><span>Since pick <b class="${cls(ret)}">${sp(ret)}</b></span></div>
      <div class="now"><span>To target</span><b class="${cls(left)}">${left === null ? '—' : left <= 0 ? 'Reached' : sp(left)}</b></div>
    </article>`;
  }

  function table(picks) {
    let h = `<div class="tablewrap"><table><thead><tr><th>Company</th><th>Picked at</th><th>Now</th><th>Since pick</th><th>Target</th><th>P/E</th><th>Industry P/E</th><th>ROE %</th><th>ROCE %</th><th>Profit YoY</th><th>Revenue YoY</th><th>Div. yield</th><th>Market cap</th></tr></thead><tbody>`;
    for (const [cap, label] of CAPS) {
      const rows = picks.filter((p) => p.cap === cap);
      if (!rows.length) continue;
      h += `<tr class="cap"><td colspan="13">${label}</td></tr>`;
      for (const p of rows) {
        const m = p.metrics || {}, g = m.results || {};
        const ret = num(p.price) !== null ? (p.price / p.pick_price - 1) * 100 : null;
        h += `<tr><td><a href="/stock-analysis.html?symbol=${encodeURIComponent(p.symbol)}" data-sym="${esc(p.symbol)}">${esc(short(p.name))}</a></td>
          <td>${rs(p.pick_price)}</td><td>${rs(p.price)}</td><td class="${cls(ret)}">${sp(ret)}</td><td>${rs(p.target_price)}</td>
          <td>${n1(m.pe)}</td><td>${n1(m.sector_pe)}</td><td>${n1(m.roe)}</td><td>${m.fin ? '—' : n1(m.roce)}</td>
          <td class="${cls(g.profit_yoy)}">${g.turnaround ? 'Turnaround' : sp(g.profit_yoy)}</td><td class="${cls(g.revenue_yoy)}">${sp(g.revenue_yoy)}</td>
          <td>${num(m.dy) ? n1(m.dy, 2) + '%' : '—'}</td><td>${cr(p.mcap_cr)}</td></tr>`;
      }
    }
    return h + '</tbody></table></div>';
  }

  function detail(p) {
    const m = p.metrics || {}, g = m.results || {};
    const ret = num(p.price) !== null ? (p.price / p.pick_price - 1) * 100 : null;
    const capLabel = (CAPS.find((c) => c[0] === p.cap) || [, ''])[1];
    return `<details class="detail" id="d-${esc(p.symbol)}">
      <summary>${mono(p.symbol)}<div class="t"><b>${esc(short(p.name))}</b><small>${capLabel} · ${esc(p.sector || p.broad_sector || '')}</small></div>
        <div class="px"><small>Target </small><b>${rs(p.target_price)}</b><br><span class="${cls(ret)}">${sp(ret)}</span> <small>since pick</small></div></summary>
      <div class="dbody">
        <div>
          <h3>Why we picked it</h3><ul class="why">${(p.thesis || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          <h3>Key risks</h3><ul class="risk">${(p.risks || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          <div class="math"><b>How the target is set:</b> trailing EPS ${rs(m.eps_ttm, 1)} grown ${n1(m.growth_used)}% (from recent profit and revenue growth) = ${rs(m.eps_fwd, 1)} next-year EPS, × a fair P/E of ${n1(m.fair_pe)} (between its own ${n1(m.pe)} and the industry's ${n1(m.sector_pe)}) = <b>${rs(p.target_price)}</b>${m.capped ? ', capped at 40% upside' : ''}. 12-month view.</div>
        </div>
        <div>
          <h3>Stock data</h3>
          <div class="kv">
            <span>Market cap</span><b>${cr(p.mcap_cr)}</b>
            <span>Price now</span><b>${rs(p.price)} <small class="${cls(p.change_percent)}">${sp(p.change_percent, 2)}</small></b>
            <span>52-week high / low</span><b>${rs(p.high_52w ?? m.high_52w)} / ${rs(p.low_52w ?? m.low_52w)}</b>
            <span>P/E · industry P/E</span><b>${n1(m.pe)} · ${n1(m.sector_pe)}</b>
            <span>ROE${m.fin ? '' : ' · ROCE'}</span><b>${n1(m.roe)}%${m.fin ? '' : ' · ' + n1(m.roce) + '%'}</b>
            ${num(m.pb) ? `<span>Price / book</span><b>${n1(m.pb, 2)}</b>` : ''}
            ${num(m.dy) ? `<span>Dividend yield</span><b>${n1(m.dy, 2)}%</b>` : ''}
            ${num(m.promoter) ? `<span>Promoter holding</span><b>${n1(m.promoter)}%</b>` : ''}
            ${g.label ? `<span>Latest results (${esc(g.label)})</span><b>${g.turnaround ? 'Back in profit' : 'Profit ' + sp(g.profit_yoy)}</b>` : ''}
            ${num(g.net_margin) !== null ? `<span>Net margin</span><b>${n1(g.net_margin)}%</b>` : ''}
          </div>
          <a class="dlink" href="/stock-analysis.html?symbol=${encodeURIComponent(p.symbol)}" data-sym="${esc(p.symbol)}">Open full analysis →</a>
        </div>
      </div>
    </details>`;
  }

  const METHOD = `<section class="panel method"><h2>How we pick</h2><ol>
    <li><b>Size buckets.</b> Stocks are ranked by market cap, as SEBI does: the top 100 are large caps, the next 150 mid caps, the rest small caps (₹3,000 Cr and above, with enough daily trading to buy and sell easily).</li>
    <li><b>Quality first.</b> Return on equity of 13%+ (11%+ for lenders) and return on capital of 13%+. Suspicious one-off numbers are filtered out.</li>
    <li><b>Sensible value.</b> P/E is compared with the company's own industry, so a cheap stock in a cheap sector isn't mistaken for a bargain.</li>
    <li><b>Healthy trend.</b> No falling knives: the price must be near or above its 200-day average and not overheated, ideally 8–30% below its 52-week high.</li>
    <li><b>Growing earnings.</b> The latest quarterly results (NSE filings) must show profits and revenue holding up; loss-makers and shrinking businesses are dropped.</li>
    <li><b>Diversified.</b> One stock per sector in each bucket, two at most across the 15 picks.</li>
    <li><b>Target.</b> Next-year earnings (trailing EPS grown at the recent rate, 4–22%) × a fair P/E between the stock's own and its industry's, for a 12-month view; only stocks with 10%+ upside make the list.</li>
  </ol>
  <p class="disc">Picks are generated automatically from public data on the publish date and are never changed afterwards, so the track record above is honest. MarketPulse is not a SEBI-registered investment adviser or research analyst; this is educational information, not a recommendation to buy or sell. Markets carry risk — do your own research or consult a registered adviser, and invest only what you can hold for the long term.</p></section>`;

  function render() {
    const o = D.occasion;
    const occs = D.occasions || [];
    const sel = D.selected;
    tabs(occs, sel);
    const chosen = occs.find((x) => x.slug === sel);
    if (!o) {
      if (!chosen) { $('view').innerHTML = `<div class="panel empty">No picks yet.</div>` + METHOD; setTheme('diwali'); return; }
      setTheme(chosen.theme);
      const days = Math.max(0, Math.ceil((new Date(chosen.publish_on + 'T09:00:00+05:30') - Date.now()) / 864e5));
      const latest = occs.filter((x) => x.status === 'published').pop();
      $('view').innerHTML = hero(chosen, `<span>📅 ${esc(chosen.name)}: ${dt(chosen.event_date)}</span><span>🗓️ Picks out ${dt(chosen.publish_on)}</span>`) +
        `<section class="panel soon"><div class="big">${days === 0 ? 'Today' : days + (days === 1 ? ' day' : ' days')}</div><div class="muted">until our ${esc(chosen.title)} go live — 5 large, 5 mid and 5 small-cap stocks for the year ahead.</div>
        ${latest ? `<p><a href="?o=${encodeURIComponent(latest.slug)}" data-slug="${esc(latest.slug)}">See the ${esc(latest.title)} and how they are doing →</a></p>` : ''}</section>` + METHOD;
      return;
    }
    setTheme(o.theme);
    const th = THEME[o.theme] || THEME.diwali;
    const picks = D.picks || [];
    const rets = picks.filter((p) => num(p.price) !== null).map((p) => (p.price / p.pick_price - 1) * 100);
    const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
    const nret = num(D.nifty) && num(o.nifty_at_pick) ? (D.nifty / o.nifty_at_pick - 1) * 100 : null;
    const ups = picks.filter((p) => num(p.price) !== null).map((p) => (p.target_price / p.price - 1) * 100);
    const avgUp = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
    const hits = picks.filter((p) => p.target_hit_on).length;
    const winners = rets.filter((r) => r > 0).length;
    const note = (o.market_note && o.market_note.lines) || [];
    const days = Math.floor((Date.now() - new Date(o.published_at)) / 864e5);

    let h = hero(o, `<span>📅 Published ${dt(o.published_at)}</span><span>⏳ ${o.horizon_months}-month view</span><span>📊 ${picks.length} stocks · large, mid &amp; small cap</span>${num(o.nifty_at_pick) ? `<span>Nifty at pick ${n1(o.nifty_at_pick, 0)}</span>` : ''}`, true);
    h += `<section class="score">
      <div class="s"><span>Basket since pick</span><b class="${cls(avg)}">${sp(avg)}</b><small>equal-weight, ${days < 1 ? 'today' : days + (days === 1 ? ' day' : ' days')}</small></div>
      <div class="s"><span>Nifty 50 since pick</span><b class="${cls(nret)}">${sp(nret)}</b><small>${avg !== null && nret !== null ? (avg >= nret ? 'Picks ahead by ' : 'Picks behind by ') + Math.abs(avg - nret).toFixed(1) + ' pts' : '&nbsp;'}</small></div>
      <div class="s"><span>In profit</span><b>${winners}/${rets.length}</b><small>${hits ? hits + ' reached target 🎯' : 'targets hit: 0 so far'}</small></div>
      <div class="s"><span>Avg. upside left</span><b class="${cls(avgUp)}">${sp(avgUp)}</b><small>to the 12-month targets</small></div>
    </section>`;
    if (note.length) h += `<section class="panel letter"><h2>${th.em} Dear investors,</h2>${note.map((l) => `<p>${esc(l)}</p>`).join('')}<p><b>${esc(th.greet)}</b></p></section>`;
    h += `<section class="panel"><h2>The picks</h2>`;
    for (const [cap, label] of CAPS) {
      const rows = picks.filter((p) => p.cap === cap);
      if (!rows.length) continue;
      h += `<div class="bucket"><div class="blabel">${label}</div><div class="cards">${rows.map(card).join('')}</div></div>`;
    }
    h += `<p class="muted" style="margin:4px 0 0;font-size:12px">Tap a card for the reasons, risks and how the target is set. Prices are live; the track record uses the price on the publish date.</p></section>`;
    h += `<section class="panel"><h2>Valuation snapshot</h2>${table(picks)}</section>`;
    h += `<section><h2 style="font-size:17px;margin:4px 0 10px">Stock by stock</h2>${picks.map(detail).join('')}</section>`;
    h += METHOD;
    $('view').innerHTML = h;
  }

  async function go(slug, push) {
    try {
      D = await load(slug);
      if (push) history.pushState(null, '', D.selected ? '?o=' + encodeURIComponent(D.selected) : location.pathname);
      const o = D.occasion || (D.occasions || []).find((x) => x.slug === D.selected);
      if (o) document.title = `${o.title} — MarketPulse`;
      render();
    } catch (e) {
      $('view').innerHTML = `<div class="panel empty">Couldn't load the picks (${esc(e.message)}). Please refresh.</div>`;
    }
  }

  // Downloads: picks-export.js is loaded the first time it's needed.
  let exporter = null;
  function loadExporter() {
    if (window.MPPicksExport) return Promise.resolve(window.MPPicksExport);
    return exporter || (exporter = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = '/picks-export.js?v=2';
      s.onload = () => res(window.MPPicksExport); s.onerror = () => { exporter = null; rej(new Error('Could not load the download tool')); };
      document.head.appendChild(s);
    }));
  }
  function toast(msg, ms) {
    let t = $('mpToast');
    if (!t) { t = document.createElement('div'); t.id = 'mpToast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on'); clearTimeout(t._h);
    if (ms) t._h = setTimeout(() => t.classList.remove('on'), ms);
  }
  function menu(open) {
    const m = $('dlMenu'), b = $('dlBtn'); if (!m || !b) return;
    m.hidden = !open; b.setAttribute('aria-expanded', String(open));
    if (open) { const sh = m.querySelector('.dlshare'); if (sh) sh.hidden = !(navigator.canShare && window.File && matchMedia('(pointer:coarse)').matches); }
  }
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#dlBtn')) { menu($('dlMenu').hidden); return; }
    const d = e.target.closest('[data-dl]');
    if (d) {
      menu(false);
      const label = { poster: 'poster image', story: 'story image', pdf: 'PDF report', share: 'image' }[d.dataset.dl];
      toast(`Preparing your ${label}…`);
      try {
        const ex = await loadExporter();
        await ex.run(d.dataset.dl, D);
        toast(d.dataset.dl === 'share' ? 'Ready to share ✨' : `Downloaded the ${label} ✨`, 2500);
      } catch (err) {
        toast(err && err.name === 'AbortError' ? 'Share cancelled' : `Couldn't create the ${label}: ${err.message}`, 4000);
      }
      return;
    }
    if (!e.target.closest('#dlMenu')) menu(false);
    const t = e.target.closest('[data-slug]');
    if (t) { e.preventDefault(); go(t.dataset.slug, true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (e.target.closest('a')) return;
    const c = e.target.closest('[data-open]');
    if (c) {
      const d = document.getElementById('d-' + c.dataset.open);
      if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu(false);
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-open]')) { e.preventDefault(); e.target.click(); }
  });
  window.addEventListener('popstate', () => go(new URLSearchParams(location.search).get('o'), false));
  go(new URLSearchParams(location.search).get('o'), false);
  setInterval(() => { if (!document.hidden && D && D.occasion) go(D.selected, false); }, 120000);
})();
