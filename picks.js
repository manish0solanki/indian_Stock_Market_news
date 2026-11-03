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


  /* ───────── Investment calculator: amount -> whole shares per pick ───────── */
  const MIXES = {
    equal: { label: 'Equal in each stock', w: null, hint: 'The same amount in every pick.' },
    balanced: { label: 'Balanced (60 / 25 / 15)', w: { large: 0.6, mid: 0.25, small: 0.15 }, hint: '60% large, 25% mid, 15% small caps: steadier, the usual choice for long-term money.' },
    safe: { label: 'Conservative (75 / 20 / 5)', w: { large: 0.75, mid: 0.2, small: 0.05 }, hint: 'Mostly large caps; smaller swings, slower growth.' },
    bold: { label: 'Aggressive (40 / 30 / 30)', w: { large: 0.4, mid: 0.3, small: 0.3 }, hint: 'More mid and small caps; higher potential and bigger swings.' },
  };
  const CHARGES = 0.0012; // approx. STT 0.1% + stamp duty 0.015% + exchange/SEBI fees + GST on a delivery buy; brokerage extra
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const CALC = { amount: +(store.get('mpCalcAmt') || 100000), mix: store.get('mpCalcMix') || 'balanced', caps: { large: true, mid: true, small: true } };
  if (!MIXES[CALC.mix]) CALC.mix = 'balanced';
  const priceOf = (p) => num(p.price) || num(p.pick_price);
  const inr0 = (v) => '₹' + Math.round(v).toLocaleString('en-IN');

  // Weights per stock from the mix and the chosen buckets (weights of a left-out bucket are shared out).
  function weights(picks) {
    const use = picks.filter((p) => CALC.caps[p.cap] && priceOf(p));
    const mix = MIXES[CALC.mix].w;
    if (!mix) return use.map((p) => [p, 1 / use.length]);
    const caps = [...new Set(use.map((p) => p.cap))];
    const tot = caps.reduce((a, c) => a + mix[c], 0) || 1;
    return use.map((p) => [p, mix[p.cap] / tot / use.filter((x) => x.cap === p.cap).length]);
  }
  // Whole shares: buy down to each stock's share, then spend what's left one share at a time on the most
  // under-weight stock that still fits (never more than 1.5x its share).
  function allocate(picks, amount) {
    const rows = weights(picks).map(([p, w]) => ({ p, w, w0: w, price: priceOf(p), goal: amount * w, qty: 0 }));
    // A stock whose single share costs more than 1.5x its slice is skipped, and its slice goes to the other
    // picks of the same size, so the large / mid / small split you chose holds.
    for (;;) {
      const live = rows.filter((r) => !r.dropped);
      const bad = live.filter((r) => r.price > r.goal * 1.5).sort((a, b) => b.price / b.goal - a.price / a.goal)
        .find((r) => live.some((x) => x !== r && x.p.cap === r.p.cap));
      if (!bad) break;
      const peers = live.filter((x) => x !== bad && x.p.cap === bad.p.cap);
      peers.forEach((x) => { x.w += bad.w / peers.length; x.goal = amount * x.w; });
      bad.dropped = true; bad.w = 0; bad.goal = 0;
    }
    rows.forEach((r) => { r.qty = r.dropped ? 0 : Math.floor(r.goal / r.price); });
    let left = amount - rows.reduce((a, r) => a + r.qty * r.price, 0);
    for (let guard = 0; guard < 5000; guard++) {
      let best = null, gap = -Infinity;
      for (const r of rows) {
        if (r.dropped || r.price > left || (r.qty + 1) * r.price > r.goal * 1.5) continue;
        const g = (r.goal - r.qty * r.price) / r.goal;
        if (g > gap) { gap = g; best = r; }
      }
      if (!best) break;
      best.qty++; left -= best.price;
    }
    rows.forEach((r) => { r.cost = r.qty * r.price; r.atTarget = r.qty * num(r.p.target_price); });
    const invested = rows.reduce((a, r) => a + r.cost, 0);
    const minAll = rows.length ? Math.max(...rows.map((r) => r.price / r.w0)) : 0; // to own at least one share of each
    return { rows, invested, left: amount - invested, target: rows.reduce((a, r) => a + r.atTarget, 0), minAll };
  }

  function calcPanel() {
    return `<section class="panel calc" id="calc"><h2>💰 Investment calculator</h2>
      <p class="muted" style="margin:-4px 0 12px;font-size:13px">Enter how much you want to invest. We split it across the picks and work out how many shares of each to buy at today's prices.</p>
      <div class="cform">
        <label class="cfld"><span>Amount to invest</span><div class="camt"><b>₹</b><input id="calcAmt" type="text" inputmode="numeric" autocomplete="off" value="${Math.round(CALC.amount).toLocaleString('en-IN')}" aria-label="Amount to invest in rupees"></div></label>
        <div class="cfld"><span>Quick pick</span><div class="cchips">${[25000, 50000, 100000, 250000, 500000, 1000000].map((v) => `<button type="button" class="cchip" data-amt="${v}">${v >= 100000 ? '₹' + v / 100000 + ' L' : '₹' + v / 1000 + 'k'}</button>`).join('')}</div></div>
        <label class="cfld"><span>How to split it</span><select id="calcMix">${Object.entries(MIXES).map(([k, m]) => `<option value="${k}"${k === CALC.mix ? ' selected' : ''}>${m.label}</option>`).join('')}</select></label>
        <div class="cfld"><span>Include</span><div class="cchips">${CAPS.map(([c, l]) => `<label class="ccheck"><input type="checkbox" data-cap="${c}"${CALC.caps[c] ? ' checked' : ''}> ${l}</label>`).join('')}</div></div>
      </div>
      <div class="chint" id="calcHint"></div>
      <div id="calcOut"></div>
    </section>`;
  }
  function calcRender() {
    const out = $('calcOut'); if (!out || !D) return;
    $('calcHint').textContent = MIXES[CALC.mix].hint;
    const A = CALC.amount;
    out._plan = null;
    if (!(A > 0)) { out.innerHTML = '<div class="cempty">Enter an amount to see the plan.</div>'; return; }
    if (!Object.values(CALC.caps).some(Boolean)) { out.innerHTML = '<div class="cempty">Pick at least one of large, mid or small caps.</div>'; return; }
    const R = allocate(D.picks || [], A);
    const bought = R.rows.filter((r) => r.qty > 0), skipped = R.rows.filter((r) => r.qty === 0);
    if (!bought.length) { out.innerHTML = `<div class="cempty">${inr0(A)} isn't enough for one share of these picks. Try ${inr0(Math.min(...R.rows.map((r) => r.price)) * 2)} or more.</div>`; return; }
    const charges = R.invested * CHARGES, gain = R.target - R.invested;
    const byCap = CAPS.map(([c, l]) => [l, bought.filter((r) => r.p.cap === c).reduce((a, r) => a + r.cost, 0)]).filter((x) => x[1] > 0);
    const capCol = { 'Large cap': 'var(--t2)', 'Mid cap': 'var(--t3)', 'Small cap': '#16a34a' };
    let h = `<div class="csum">
      <div><span>You invest</span><b>${inr0(R.invested)}</b><small>in ${bought.length} stock${bought.length > 1 ? 's' : ''}</small></div>
      <div><span>Cash left over</span><b>${inr0(R.left)}</b><small>${(R.left / A * 100).toFixed(1)}% of your amount</small></div>
      <div><span>Value at targets</span><b class="up">${inr0(R.target)}</b><small>${sp(gain / R.invested * 100)} · ${inr0(gain)} potential gain</small></div>
      <div><span>Est. charges</span><b>${inr0(charges)}</b><small>STT, stamp duty &amp; fees; brokerage extra</small></div>
    </div>
    <div class="cbar" role="img" aria-label="Split by company size">${byCap.map(([l, v]) => `<i style="width:${v / R.invested * 100}%;background:${capCol[l]}" title="${l}: ${(v / R.invested * 100).toFixed(0)}%"></i>`).join('')}</div>
    <div class="clegend">${byCap.map(([l, v]) => `<span><i style="background:${capCol[l]}"></i>${l} ${(v / R.invested * 100).toFixed(0)}% · ${inr0(v)}</span>`).join('')}</div>
    <div class="tablewrap"><table class="ctable"><thead><tr><th>Stock</th><th>Price now</th><th>Buy</th><th>Amount</th><th>Weight</th><th>Target</th><th>Value at target</th></tr></thead><tbody>`;
    for (const [c, l] of CAPS) {
      const rows = R.rows.filter((r) => r.p.cap === c);
      if (!rows.length) continue;
      h += `<tr class="cap"><td colspan="7">${l}</td></tr>`;
      for (const r of rows) {
        h += `<tr class="${r.qty ? '' : 'skip'}"><td><a href="/stock-analysis.html?symbol=${encodeURIComponent(r.p.symbol)}" data-sym="${esc(r.p.symbol)}">${esc(short(r.p.name))}</a><small>${esc(r.p.symbol)}</small></td>
          <td>${rs(r.price)}</td><td class="qty">${r.qty ? `<b>${r.qty}</b> share${r.qty > 1 ? 's' : ''}` : '<span class="muted">—</span>'}</td>
          <td>${r.qty ? inr0(r.cost) : '<span class="muted">skip</span>'}</td><td>${r.qty ? (r.cost / R.invested * 100).toFixed(1) + '%' : '—'}</td>
          <td>${rs(r.p.target_price)}</td><td class="up">${r.qty ? inr0(r.atTarget) : '—'}</td></tr>`;
      }
    }
    h += `</tbody><tfoot><tr><td>Total</td><td></td><td>${bought.reduce((a, r) => a + r.qty, 0)} shares</td><td>${inr0(R.invested)}</td><td>100%</td><td></td><td class="up">${inr0(R.target)}</td></tr></tfoot></table></div>`;
    // phone: compact cards
    h += `<div class="ccards">${R.rows.filter((r) => r.qty).map((r) => `<div class="ccard"><div><b>${esc(short(r.p.name))}</b><small>${esc(r.p.symbol)} · ${rs(r.price)}</small></div><div class="cr"><span>${r.qty} share${r.qty > 1 ? 's' : ''}</span><small><b class="amt">${inr0(r.cost)}</b> · ${(r.cost / R.invested * 100).toFixed(1)}% · target ${rs(r.p.target_price)}</small></div></div>`).join('')}
      <div class="ccard tot"><div><b>Total</b><small>${bought.reduce((a, r) => a + r.qty, 0)} shares</small></div><div class="cr"><b>${inr0(R.invested)}</b><small class="up">${inr0(R.target)} at targets</small></div></div></div>`;
    const notes = [];
    if (skipped.length) notes.push(`Skipped at this amount: ${skipped.map((r) => `${esc(short(r.p.name))} (${rs(r.price)} a share)`).join(', ')}. To hold all ${R.rows.length} in this split, invest about ${inr0(Math.ceil(R.minAll / 1000) * 1000)} or more.`);
    notes.push('Prices are live and change through the day; use limit orders near these prices. For stocks trading below their 200-day average, consider buying in two or three parts over a few weeks.');
    notes.push('Potential gain assumes every stock reaches its 12-month model target, which is not guaranteed. Educational only, not investment advice.');
    h += `<ul class="cnotes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <div class="cact"><button type="button" class="btn2" id="calcCopy">📋 Copy order list</button><button type="button" class="btn2" id="calcCsv">⬇ Download as CSV</button></div>`;
    out.innerHTML = h;
    out._plan = R;
  }
  function planText(R) {
    const lines = [`${D.occasion.title} — MarketPulse investment plan (${inr0(CALC.amount)}, ${MIXES[CALC.mix].label})`, ''];
    R.rows.filter((r) => r.qty).forEach((r) => lines.push(`${r.p.symbol.padEnd(12)} ${String(r.qty).padStart(5)} shares  @ ~${rs(r.price)}  = ${inr0(r.cost)}`));
    lines.push('', `Total ${inr0(R.invested)} · cash left ${inr0(R.left)} · value at targets ${inr0(R.target)}`, `${location.origin}/picks.html?o=${D.selected}`);
    return lines.join('\n');
  }
  function planCsv(R) {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [['Symbol', 'Company', 'Size', 'Price now', 'Shares', 'Amount', 'Weight %', 'Target', 'Value at target']];
    R.rows.filter((r) => r.qty).forEach((r) => rows.push([r.p.symbol, short(r.p.name), r.p.cap, r.price, r.qty, Math.round(r.cost), (r.cost / R.invested * 100).toFixed(1), r.p.target_price, Math.round(r.atTarget)]));
    rows.push(['TOTAL', '', '', '', R.rows.reduce((a, r) => a + r.qty, 0), Math.round(R.invested), '100', '', Math.round(R.target)]);
    return rows.map((r) => r.map(q).join(',')).join('\n');
  }
  function calcInput(raw) {
    const v = +String(raw).replace(/[^\d.]/g, '');
    CALC.amount = isFinite(v) ? Math.min(v, 1e10) : 0;
    store.set('mpCalcAmt', String(CALC.amount));
    calcRender();
  }
  document.addEventListener('input', (e) => {
    if (e.target.id === 'calcAmt') {
      const el = e.target, digits = el.value.replace(/[^\d]/g, '');
      calcInput(digits);
      const formatted = digits ? (+digits).toLocaleString('en-IN') : '';
      if (el.value !== formatted) { el.value = formatted; el.setSelectionRange(formatted.length, formatted.length); }
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'calcMix') { CALC.mix = e.target.value; store.set('mpCalcMix', CALC.mix); calcRender(); }
    if (e.target.dataset && e.target.dataset.cap) { CALC.caps[e.target.dataset.cap] = e.target.checked; calcRender(); }
  });

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
    h += calcPanel();
    h += `<section class="panel"><h2>Valuation snapshot</h2>${table(picks)}</section>`;
    h += `<section><h2 style="font-size:17px;margin:4px 0 10px">Stock by stock</h2>${picks.map(detail).join('')}</section>`;
    h += METHOD;
    $('view').innerHTML = h;
    calcRender();
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
      const s = document.createElement('script'); s.src = '/picks-export.js?v=3';
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
    const amt = e.target.closest('[data-amt]');
    if (amt) { const v = +amt.dataset.amt; $('calcAmt').value = v.toLocaleString('en-IN'); calcInput(v); return; }
    if (e.target.closest('#calcCopy')) {
      const R = $('calcOut')._plan; if (!R) return;
      try { await navigator.clipboard.writeText(planText(R)); toast('Order list copied ✨', 2200); } catch (err) { toast('Copy failed — try the CSV instead', 3000); }
      return;
    }
    if (e.target.closest('#calcCsv')) {
      const R = $('calcOut')._plan; if (!R) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([planCsv(R)], { type: 'text/csv' }));
      a.download = `marketpulse-${D.selected}-plan-${Math.round(CALC.amount)}.csv`; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
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
  setInterval(() => { if (!document.hidden && D && D.occasion && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#calc'))) go(D.selected, false); }, 120000);
})();
