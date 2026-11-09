/* Events page: "What to expect" before a company's results.
   market_events.preview is built by events-refresh (?only=previews, hourly) for results due in the next 14 days:
   how the shares moved on past results days, the last reported quarter, the year-ago quarter the new one is
   compared with, sector peers that reported this season, the run-up versus the Nifty, and rule-based factors.
   This file adds the stock's own news of the last 7 days (stock-news.js). The lean and its factors are shown
   to the platform admin only (paper / personal use until SEBI RA registration); the facts are for everyone.
   Uses the page's globals: sb, $, esc, fmtDay, pct, cls, crore, inr, q, isAdmin. */
(function () {
  const qLabel = (iso) => iso ? fmtDay(iso, { month: 'short', year: 'numeric' }) : '—';
  const lc = (s, d) => esc(String(s || d).toLowerCase());

  function newsLine(n) {
    const sg = n.score > 0 ? '+' : n.score < 0 ? '−' : '';
    return '<div class="pv-line"><b>News in the last 7 days:</b> <span class="' + (n.score >= 15 ? 'pos' : n.score <= -15 ? 'neg' : '') + '">' + esc(n.label) +
      (n.score != null ? ' (' + sg + Math.abs(n.score) + ')' : '') + '</span> <span class="muted">· ' + n.pos + ' positive, ' + n.neg + ' negative, ' + n.neu + ' neutral headlines</span></div>';
  }

  function previewHtml(e, p, news) {
    const st = p.stats, l = p.last, b = p.base, pe = p.peers, ru = p.runup;
    const px = (q(e.symbol) && q(e.symbol).p) || (ru && ru.lastClose);
    const due = fmtDay(e.event_date, { weekday: 'long', day: 'numeric', month: 'long' });
    let h = '<div class="sec"><h3>What to expect <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">· quarter to ' + qLabel(p.upQe) + '</span></h3>';
    h += '<div class="advice info">The board meets on ' + due + ' to approve the results. They usually reach NSE the same evening, so the shares react in the next session. ';
    h += st ? 'On its last ' + st.n + ' results days ' + esc(e.symbol) + ' moved <b>±' + st.avgAbs.toFixed(1) + '%</b> on average (biggest ' + st.maxAbs.toFixed(1) + '%)' +
      (p.dayAbs != null ? ', against ±' + p.dayAbs.toFixed(1) + '% on a normal day' : '') + '.'
      : 'There is not enough history of its results days to size the usual move.';
    h += ' There are no analyst estimates here: this is the company’s own record.</div>';
    if (st) {
      const m = st.avgAbs / 100;
      h += '<div class="kv" style="margin-top:8px"><div><span>Usual results move</span><b>±' + st.avgAbs.toFixed(1) + '%</b></div>' +
        (px ? '<div><span>That range from ' + inr(px, 0) + '</span><b>' + inr(px * (1 - m), 0) + ' – ' + inr(px * (1 + m), 0) + '</b></div>' : '') +
        '<div><span>Rose / fell after</span><b><i class="pos">' + st.up + ' up</i> · <i class="neg">' + st.down + ' down</i></b></div>' +
        '<div><span>Average rise</span><b class="pos">' + (st.avgUp != null ? pct(st.avgUp) : '—') + '</b></div>' +
        '<div><span>Average fall</span><b class="neg">' + (st.avgDown != null ? pct(st.avgDown) : '—') + '</b></div>' +
        '<div><span>Average opening gap</span><b>±' + st.avgGapAbs.toFixed(1) + '%</b></div></div>';
      h += '<details class="pv-hist"><summary>Past results days</summary><div class="tblwrap"><table class="tbl"><thead><tr><th>Quarter</th><th>Reacted on</th><th>Opening gap</th><th>Day’s move</th><th>Volume</th></tr></thead><tbody>' +
        p.history.map((x) => '<tr><td>' + qLabel(x.quarterEnd) + '</td><td>' + fmtDay(x.day, { day: 'numeric', month: 'short', year: '2-digit' }) + '</td><td class="' + cls(x.gapPct) + '">' + pct(x.gapPct) +
          '</td><td class="' + cls(x.pct) + '"><b>' + pct(x.pct) + '</b></td><td>' + (x.volRatio ? x.volRatio.toFixed(1) + '× normal' : '—') + '</td></tr>').join('') +
        '</tbody></table></div></details>';
    }
    h += '</div>';

    const rows = [];
    if (b && (b.profit != null || b.revenue != null)) {
      rows.push('<div class="pv-line"><b>The bar to beat:</b> the same quarter a year ago (' + qLabel(b.quarterEnd) + ', ' + lc(b.consolidated, '') + ') had ' +
        (b.revenue != null ? lc(b.revLabel, 'revenue') + ' of ' + crore(b.revenue) : '') + (b.revenue != null && b.profit != null ? ' and ' : '') +
        (b.profit != null ? 'net profit of <b>' + crore(b.profit) + '</b>' : '') + '. Above that is growth on the year; below it is a decline.</div>');
    }
    if (l) {
      rows.push('<div class="pv-line"><b>Last quarter (' + qLabel(l.quarterEnd) + '):</b> ' + lc(l.revLabel, 'revenue') + ' ' + crore(l.revenue) +
        (l.revYoY != null ? ' (<span class="' + cls(l.revYoY) + '">' + pct(l.revYoY) + '</span> on the year)' : '') + ', net profit ' + crore(l.profit) +
        (l.profitYoY != null ? ' (<span class="' + cls(l.profitYoY) + '">' + pct(l.profitYoY) + '</span>)' : '') +
        (l.marginNow != null ? ', margin ' + l.marginNow.toFixed(1) + '%' + (l.marginYearAgo != null ? ' (from ' + l.marginYearAgo.toFixed(1) + '%)' : '') : '') +
        (l.reaction != null ? '. The shares moved <span class="' + cls(l.reaction) + '">' + pct(l.reaction) + '</span> on those results' : '') + '.</div>');
    }
    if (pe) {
      rows.push('<div class="pv-line"><b>' + esc(pe.sector) + ' peers this season:</b> ' + pe.list.map((x) => '<span data-sym="' + esc(x.symbol) + '">' + esc(x.symbol) + '</span> <span class="' +
        (x.label === 'positive' ? 'pos' : x.label === 'negative' ? 'neg' : '') + '">' + esc(x.label) + (x.pct != null ? ' ' + pct(x.pct) : '') + '</span>').join(', ') +
        (pe.n > pe.list.length ? ' and ' + (pe.n - pe.list.length) + ' more' : '') + '.</div>');
    }
    if (ru && ru.d20 != null) {
      rows.push('<div class="pv-line"><b>Going in:</b> <span class="' + cls(ru.d20) + '">' + pct(ru.d20) + '</span> in the last 20 sessions' + (ru.nifty20 != null ? ' (Nifty ' + pct(ru.nifty20) + ')' : '') +
        (ru.d60 != null ? ', <span class="' + cls(ru.d60) + '">' + pct(ru.d60) + '</span> over 60 sessions' + (ru.nifty60 != null ? ' (Nifty ' + pct(ru.nifty60) + ')' : '') : '') + '.</div>');
    }
    if (news && news.n) rows.push(newsLine(news));
    if (rows.length) h += '<div class="sec"><h3>What the numbers will be measured against</h3>' + rows.join('') + '</div>';

    if (isAdmin) {
      const f = (p.factors || []).slice();
      if (news && news.score != null) {
        if (news.score >= 15) f.push({ w: 0.5, t: 'News in the last 7 days reads ' + news.label.toLowerCase() });
        else if (news.score <= -15) f.push({ w: -0.5, t: 'News in the last 7 days reads ' + news.label.toLowerCase() });
      }
      const sc = f.reduce((s, x) => s + x.w, 0);
      const lab = sc >= 1 ? ['Leans positive', 'positive', '▲', 'pos'] : sc <= -1 ? ['Leans negative', 'negative', '▼', 'neg'] : ['No clear lean', 'mixed', '◆', ''];
      h += '<div class="verdict ' + lab[1] + '"><h4 class="' + lab[3] + '">' + lab[2] + ' Setup going in: ' + lab[0] + '</h4>' +
        (f.length ? '<ul>' + f.map((x) => '<li><span class="' + (x.w > 0 ? 'pos' : x.w < 0 ? 'neg' : 'muted') + '">' + (x.w > 0 ? '▲' : x.w < 0 ? '▼' : '•') + '</span> ' + esc(x.t) + '</li>').join('') + '</ul>'
          : '<p>Not enough history to weigh this one.</p>') +
        (st ? '<p style="margin-top:8px;font-size:13px">If the numbers please, past rises averaged ' + (st.avgUp != null ? pct(st.avgUp) : '—') + '; if they disappoint, past falls averaged ' +
          (st.avgDown != null ? pct(st.avgDown) : '—') + '. A stop closer than about ' + st.avgAbs.toFixed(1) + '% can be jumped by the opening gap, so a position held through results is usually smaller, or the trade waits for the numbers.</p>' : '') +
        '<p class="disc" style="margin:6px 0 0">Visible to you only (platform admin). A rule-based read of the trend, peers, run-up and news, not a forecast: results can surprise either way.</p></div>';
    }
    return h;
  }

  async function loadPreview(e) {
    const box = $('pvBox'); if (!box) return;
    const [res, news] = await Promise.all([
      sb.from('market_events').select('preview').eq('id', e.id).maybeSingle().then((r) => r, () => ({ data: null })),
      window.mpStockNews ? window.mpStockNews.sentiment({ symbol: e.symbol, name: e.company, client: sb }).catch(() => null) : null,
    ]);
    if (box !== $('pvBox')) return; // another event was opened meanwhile
    const p = res && res.data && res.data.preview;
    if (p && p.status === 'ready') { box.outerHTML = previewHtml(e, p, news); return; }
    if (p && p.status === 'filed') box.insertAdjacentHTML('beforeend', '<div class="advice info" style="margin-top:8px">This quarter’s results have already reached NSE. The numbers and the reaction appear here after the next hourly check.</div>');
    else if (news && news.n) box.insertAdjacentHTML('beforeend', newsLine(news));
  }

  window.mpEventPreview = { load: loadPreview };
})();
