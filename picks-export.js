/* Festive picks downloads (picks.html): drawn on a canvas in the browser, no libraries.
   MPPicksExport.run(kind, data)  kind: 'poster' (1600x1000 PNG), 'story' (1080x1920 PNG for phones/WhatsApp
   status), 'pdf' (A4 report: cover + market note, picks at a glance + valuation table, two stocks per page with
   reasons, risks, data and target maths, how we pick), 'share' (shares the story image where supported).
   The PDF is assembled here from JPEG page images (a minimal PDF writer, see makePdf). */
(function () {
  const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';
  const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const TH = {
    diwali: { bg: ['#2a0602', '#701807', '#d4560f'], acc: '#f59e0b', gold: ['#fff1c1', '#f7c948', '#d9861c'], ink: '#3b0a05', card: '#fffaf0', pill: ['#b45309', '#7c2d12'], greet: 'Wishing you a bright and prosperous Diwali!' },
    newyear: { bg: ['#03071c', '#0b1640', '#1e3a8a'], acc: '#d4af37', gold: ['#fff7d6', '#f1d27a', '#c99a2e'], ink: '#0b1640', card: '#fbf9f1', pill: ['#1e3a8a', '#0b1640'], greet: 'Happy New Year — here is to a profitable year ahead!' },
    holi: { bg: ['#3b0764', '#a21caf', '#f97316'], acc: '#facc15', gold: ['#ffffff', '#fef08a', '#facc15'], ink: '#3b0764', card: '#ffffff', pill: ['#db2777', '#7c3aed'], greet: 'Happy Holi — may your portfolio be as colourful as the festival!' },
    akshaya: { bg: ['#2d1504', '#713f12', '#c27c0e'], acc: '#eab308', gold: ['#fffbe0', '#fde047', '#ca8a04'], ink: '#422006', card: '#fffbeb', pill: ['#a16207', '#713f12'], greet: 'Happy Akshaya Tritiya — buy what lasts.' },
    independence: { bg: ['#060d2b', '#0b1a4a', '#1e3a8a'], acc: '#f97316', gold: ['#ffffff', '#ffd9b3', '#f97316'], ink: '#0b1640', card: '#ffffff', pill: ['#ea580c', '#15803d'], greet: 'Happy Independence Day — bet on India for the long run.' },
  };
  const CAPS = [['large', 'LARGE CAP'], ['mid', 'MID CAP'], ['small', 'SMALL CAP']];
  const SITE = (location.host || 'marketpulse') + '/picks.html';
  const BRAND_INK = '#1e1b4b';
  const DISC = 'Educational information, not investment advice. MarketPulse is not a SEBI-registered investment adviser or research analyst.';
  const METHOD = [
    ['Size buckets', 'Ranked by market cap as SEBI does: top 100 large caps, next 150 mid caps, the rest small caps (₹3,000 Cr and above, with enough daily trading to buy and sell easily).'],
    ['Quality first', 'Return on equity of 13%+ (11%+ for lenders) and return on capital of 13%+. Suspicious one-off numbers are filtered out.'],
    ['Sensible value', 'P/E is compared with the company\'s own industry, so a cheap stock in a cheap sector isn\'t mistaken for a bargain.'],
    ['Healthy trend', 'No falling knives: the price must be near or above its 200-day average and not overheated, ideally 8–30% below its 52-week high.'],
    ['Growing earnings', 'The latest quarterly results (NSE filings) must show profits and revenue holding up; loss-makers and shrinking businesses are dropped.'],
    ['Diversified', 'One stock per sector in each size bucket, two at most across the 15 picks.'],
    ['Target', 'Next-year earnings (trailing EPS grown at the recent rate, 4–22%) × a fair P/E between the stock\'s own and its industry\'s, for a 12-month view. Only stocks with 10%+ upside make the list.'],
  ];

  /* ───────── helpers ───────── */
  const num = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v);
  const rs = (v) => { v = num(v); if (v === null) return '—'; const d = Number.isInteger(v) || v >= 1000 ? 0 : 2; return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const sp = (v, d = 1) => (num(v) === null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%');
  const n1 = (v, d = 1) => (num(v) === null ? '—' : (+v).toFixed(d));
  const short = (s) => String(s || '').replace(/\s+(Limited|Ltd\.?)$/i, '');
  const dt = (s) => s ? new Date(String(s).length <= 10 ? s + 'T00:00:00+05:30' : s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hue(sym) { let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function font(ctx, weight, size, fam) { ctx.font = `${weight} ${size}px ${fam || SANS}`; }
  function fit(ctx, text, maxW) {
    text = String(text);
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text.trim() + '…';
  }
  function lines(ctx, text, maxW) {
    const words = String(text).split(/\s+/), out = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur);
    return out;
  }
  // Wrapped text; returns the y after the last line. maxLines clips with an ellipsis.
  function wrap(ctx, text, x, y, maxW, lh, maxLines) {
    let ls = lines(ctx, text, maxW);
    if (maxLines && ls.length > maxLines) { ls = ls.slice(0, maxLines); ls[maxLines - 1] = fit(ctx, ls[maxLines - 1] + ' …', maxW); }
    ls.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    return y + ls.length * lh;
  }
  function goldFill(ctx, T, y0, y1) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, T.gold[0]); g.addColorStop(0.5, T.gold[1]); g.addColorStop(1, T.gold[2]); return g; }

  /* ───────── festive decorations ───────── */
  function sparkle(ctx, x, y, s, color, a) {
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s); ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill(); ctx.restore();
  }
  function diya(ctx, x, y, s) {
    const fy = y - s * 0.32;
    let g = ctx.createRadialGradient(x, fy - s * 0.45, 0, x, fy - s * 0.45, s * 1.6);
    g.addColorStop(0, 'rgba(255,214,120,.55)'); g.addColorStop(1, 'rgba(255,140,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, fy - s * 0.45, s * 1.6, 0, 7); ctx.fill();
    g = ctx.createLinearGradient(x, y - s * 0.3, x, y + s * 0.6);
    g.addColorStop(0, '#ffd27a'); g.addColorStop(0.45, '#d9771c'); g.addColorStop(1, '#6b2a06');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y - s * 0.22, s, s * 0.72, 0, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + s * 0.8, y - s * 0.22); ctx.quadraticCurveTo(x + s * 1.25, y - s * 0.32, x + s * 1.32, y - s * 0.55); ctx.quadraticCurveTo(x + s * 1.1, y - s * 0.1, x + s * 0.7, y + s * 0.05); ctx.fill();
    ctx.fillStyle = '#ffe2a3'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.22, s, s * 0.17, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#8a3a0c'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.22, s * 0.86, s * 0.11, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#7a3208'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.55, s * 0.42, s * 0.12, 0, 0, 7); ctx.fill();
    g = ctx.createLinearGradient(x, fy - s * 0.95, x, fy);
    g.addColorStop(0, '#fff7cc'); g.addColorStop(0.5, '#ffc53d'); g.addColorStop(1, '#ff7a00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, fy - s * 0.95); ctx.quadraticCurveTo(x + s * 0.34, fy - s * 0.3, x, fy); ctx.quadraticCurveTo(x - s * 0.34, fy - s * 0.3, x, fy - s * 0.95); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(x, fy - s * 0.55); ctx.quadraticCurveTo(x + s * 0.13, fy - s * 0.18, x, fy - s * 0.05); ctx.quadraticCurveTo(x - s * 0.13, fy - s * 0.18, x, fy - s * 0.55); ctx.fill();
  }
  function marigold(ctx, x, y, r, c) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(120,40,0,.35)'; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.18, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, 7); ctx.fill();
  }
  function garland(ctx, W, s, strands) {
    const cols = ['#f59e0b', '#fb923c', '#facc15', '#ea580c'];
    const r = 9 * s, span = W / 4;
    for (let x = 0, i = 0; x <= W; x += r * 1.55, i++) {
      const t = (x % span) / span, y = 6 * s + Math.sin(t * Math.PI) * 34 * s;
      marigold(ctx, x, y, r, cols[i % cols.length]);
    }
    for (let k = 0; k <= 4 && strands !== false; k++) {
      if (k === 2) continue; // keep the centre clear for the title
      const x = k * span; let y = 10 * s;
      const len = (k % 2 ? 6 : 9);
      for (let i = 0; i < len; i++) { marigold(ctx, x, y, r * 0.95, cols[(i + k) % cols.length]); y += r * 1.7; }
      ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.ellipse(x, y, r * 0.5, r * 0.9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#f7c948'; ctx.beginPath(); ctx.moveTo(x - r * 0.6, y + r * 0.6); ctx.lineTo(x + r * 0.6, y + r * 0.6); ctx.lineTo(x, y + r * 2); ctx.fill();
    }
  }
  function burst(ctx, cx, cy, R, color, rnd) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round';
    const n = 22 + Math.floor(rnd() * 10);
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + rnd() * 0.1, r0 = R * 0.18, r1 = R * (0.75 + rnd() * 0.25);
      ctx.globalAlpha = 0.75; ctx.lineWidth = Math.max(1.2, R / 60);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, Math.max(1.5, R / 36), 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function splash(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(0.55, color + 'aa'); g.addColorStop(1, color + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  function coin(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#fff6c2'); g.addColorStop(0.5, '#f5c542'); g.addColorStop(1, '#a86b06');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,0,.55)'; ctx.lineWidth = Math.max(1, r / 9); ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(110,60,0,.75)'; font(ctx, 800, Math.round(r * 0.95)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('₹', x, y + r * 0.04);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function chakra(ctx, x, y, r, color, a) {
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = r / 14;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    ctx.lineWidth = r / 40;
    for (let k = 0; k < 24; k++) { const an = k / 24 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r); ctx.stroke(); }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r / 8, 0, 7); ctx.fill(); ctx.restore();
  }
  // Background + decorations for a festive area of w x h at the current origin. s = scale.
  function festive(ctx, T, theme, w, h, s, opts) {
    opts = opts || {};
    const rnd = rng(opts.seed || 7);
    let g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    g = ctx.createRadialGradient(w / 2, h * 0.18, 0, w / 2, h * 0.18, Math.max(w, h) * 0.7);
    g.addColorStop(0, T.bg[2]); g.addColorStop(1, T.bg[2] + '00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (theme === 'holi') {
      const cols = ['#ec4899', '#facc15', '#22d3ee', '#a855f7', '#22c55e', '#f97316', '#3b82f6'];
      for (let k = 0; k < 16; k++) { const edge = k % 2; splash(ctx, edge ? (rnd() < 0.5 ? rnd() * w * 0.2 : w - rnd() * w * 0.2) : rnd() * w, edge ? rnd() * h : (rnd() < 0.5 ? rnd() * h * 0.15 : h - rnd() * h * 0.15), (60 + rnd() * 140) * s, cols[k % cols.length]); }
      for (let k = 0; k < 140; k++) { ctx.fillStyle = cols[k % cols.length]; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, (1 + rnd() * 3.5) * s, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (theme === 'newyear') {
      const cols = ['#f1d27a', '#ffffff', '#93c5fd', '#fca5a5', '#c4b5fd'];
      for (let k = 0; k < 70; k++) { ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.25 + rnd() * 0.6; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, (0.6 + rnd() * 1.6) * s, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      const spots = opts.bursts || [[0.1, 0.22, 110], [0.9, 0.2, 130], [0.22, 0.08, 60], [0.78, 0.07, 70], [0.06, 0.6, 70], [0.94, 0.62, 80]];
      spots.forEach((b, k) => burst(ctx, b[0] * w, b[1] * h, b[2] * s, cols[k % cols.length], rnd));
    }
    if (theme === 'akshaya') {
      for (let k = 0; k < 14; k++) { const left = k % 2 === 0; coin(ctx, left ? (20 + rnd() * 140) * s : w - (20 + rnd() * 140) * s, rnd() * h, (16 + rnd() * 22) * s); }
    }
    if (theme === 'independence') {
      chakra(ctx, w / 2, h * 0.32, Math.min(w, h) * 0.3, '#ffffff', 0.07);
      const bands = ['#f97316', '#ffffff', '#16a34a'];
      bands.forEach((c, k) => {
        ctx.fillStyle = c; ctx.globalAlpha = 0.95; ctx.beginPath();
        const y0 = k * 12 * s; ctx.moveTo(0, y0);
        for (let x = 0; x <= w; x += 20) ctx.lineTo(x, y0 + Math.sin(x / w * Math.PI * 2) * 6 * s);
        ctx.lineTo(w, y0 + 12 * s); for (let x = w; x >= 0; x -= 20) ctx.lineTo(x, y0 + 12 * s + Math.sin(x / w * Math.PI * 2) * 6 * s);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    if (theme === 'diwali' && opts.garland !== false) garland(ctx, w, s, opts.strands);
    for (let k = 0; k < (opts.sparkles ?? 26); k++) sparkle(ctx, rnd() * w, rnd() * h * 0.9, (4 + rnd() * 9) * s, k % 3 ? T.gold[0] : T.acc, 0.35 + rnd() * 0.5);
    if (theme === 'diwali' && opts.diyas) {
      const n = opts.diyas, y = h - 26 * s;
      for (let k = 0; k < n; k++) diya(ctx, (k + 0.5) * w / n, y, (k % 2 ? 22 : 28) * s);
    }
  }

  /* ───────── shared pieces ───────── */
  function mono(ctx, sym, x, y, size) {
    const h = hue(sym), g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, `hsl(${h} 70% 42%)`); g.addColorStop(1, `hsl(${(h + 40) % 360} 75% 55%)`);
    ctx.fillStyle = g; rr(ctx, x, y, size, size, size * 0.28); ctx.fill();
    const letters = sym.replace(/[^A-Z]/g, '').slice(0, 2) || sym.slice(0, 2);
    ctx.fillStyle = '#fff'; font(ctx, 800, Math.round(size * 0.38)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letters, x + size / 2, y + size / 2 + 1); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  // The MarketPulse logo (same as favicon-96x96.png): indigo tile, gold diamond, indigo centre dot. Vector, so
  // it stays sharp at any size.
  function logo(ctx, x, y, S) {
    ctx.save();
    ctx.fillStyle = '#2e1f82'; rr(ctx, x, y, S, S, S * 0.21); ctx.fill();
    const cx = x + S / 2, cy = y + S / 2, d = S * 0.335;
    const g = ctx.createLinearGradient(cx, cy - d, cx, cy + d); g.addColorStop(0, '#fcd34d'); g.addColorStop(1, '#f5a623');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2e1f82'; ctx.beginPath(); ctx.arc(cx, cy, S * 0.062, 0, 7); ctx.fill();
    ctx.restore();
  }
  function wordFont(ctx, S) { font(ctx, 800, Math.round(S * 0.66)); if ('letterSpacing' in ctx) ctx.letterSpacing = (-S * 0.015) + 'px'; }
  function brandWidth(ctx, S) { wordFont(ctx, S); const w = S * 1.28 + ctx.measureText('MarketPulse').width; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; return w; }
  // Logo + wordmark; y is the top. Returns the width drawn.
  function brand(ctx, x, y, S, color) {
    logo(ctx, x, y, S);
    const w = brandWidth(ctx, S);
    ctx.fillStyle = color; wordFont(ctx, S); ctx.textBaseline = 'middle'; ctx.fillText('MarketPulse', x + S * 1.28, y + S / 2 + S * 0.03);
    ctx.textBaseline = 'alphabetic'; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    return w;
  }
  // A white badge carrying the brand, with an optional small caption above the wordmark ("PICKED BY").
  function badge(ctx, x, y, S, caption, align) {
    const padX = S * 0.42, w = brandWidth(ctx, S) + padX * 2, h = S * 1.5;
    if (align === 'center') x -= w / 2; else if (align === 'right') x -= w;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = S * 0.5; ctx.shadowOffsetY = S * 0.08;
    ctx.fillStyle = 'rgba(255,255,255,.96)'; rr(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#f5a623'; ctx.lineWidth = Math.max(1.5, S * 0.05); rr(ctx, x + 1, y + 1, w - 2, h - 2, h / 2); ctx.stroke();
    brand(ctx, x + padX, y + (h - S) / 2, S, BRAND_INK);
    if (caption) {
      font(ctx, 800, Math.round(S * 0.24)); const cw = ctx.measureText(caption).width + S * 0.5;
      ctx.fillStyle = '#2e1f82'; rr(ctx, x + w / 2 - cw / 2, y - S * 0.2, cw, S * 0.36, S * 0.18); ctx.fill();
      ctx.fillStyle = '#fcd34d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(caption, x + w / 2, y - S * 0.02); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    return { x, y, w, h };
  }
  // Closing sign-off: logo, "Picked & tracked by MarketPulse", the address. Returns its box.
  function signoff(ctx, x, y, w, h, S, dark) {
    ctx.save(); ctx.fillStyle = dark ? 'rgba(10,8,40,.62)' : '#ffffff'; rr(ctx, x, y, w, h, Math.min(24, h / 4)); ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 2; rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.min(24, h / 4)); ctx.stroke();
    const ly = y + (h - S) / 2;
    logo(ctx, x + S * 0.45, ly, S);
    const tx = x + S * 1.75;
    ctx.fillStyle = dark ? '#fff' : BRAND_INK; wordFont(ctx, S * 0.78); ctx.fillText('MarketPulse', tx, ly + S * 0.5); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.fillStyle = dark ? '#fcd34d' : '#b45309'; font(ctx, 700, Math.round(S * 0.3)); ctx.fillText('Picked & tracked by MarketPulse · live track record at', tx, ly + S * 0.86);
    ctx.fillStyle = dark ? '#fff' : '#2e1f82'; font(ctx, 800, Math.round(S * 0.34)); ctx.fillText(SITE, tx, ly + S * 1.24);
    return { x: tx, y: ly + S * 0.95, w: Math.min(w - (tx - x) - 20, ctx.measureText(SITE).width), h: S * 0.42 };
  }
  function upBadge(ctx, x, y, w, h, up) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#15803d'); g.addColorStop(1, '#22c55e');
    ctx.fillStyle = g; rr(ctx, x, y, w, h, h * 0.22); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; font(ctx, 800, Math.round(h * 0.22)); ctx.textAlign = 'center';
    ctx.fillText('UPSIDE', x + w / 2, y + h * 0.36);
    ctx.fillStyle = '#fff'; font(ctx, 800, Math.round(h * 0.38)); ctx.fillText('▲' + Math.round(up) + '%', x + w / 2, y + h * 0.82);
    ctx.textAlign = 'left';
  }
  const upside = (p) => num(p.metrics && p.metrics.upside) ?? (p.target_price / p.pick_price - 1) * 100;
  const since = (p) => (num(p.price) !== null ? (p.price / p.pick_price - 1) * 100 : null);

  // A pick card (poster / PDF overview). s = scale relative to a 270 x 190 card.
  function card(ctx, T, p, x, y, w, h, s, opts) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 18 * s; ctx.shadowOffsetY = 6 * s;
    ctx.fillStyle = T.card; rr(ctx, x, y, w, h, 16 * s); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = T.acc + '88'; ctx.lineWidth = 2 * s; rr(ctx, x + 1, y + 1, w - 2, h - 2, 15 * s); ctx.stroke();
    const pad = 14 * s, m = 48 * s;
    mono(ctx, p.symbol, x + pad, y + pad, m);
    ctx.fillStyle = T.ink; font(ctx, 800, Math.round(19 * s));
    ctx.fillText(fit(ctx, short(p.name), w - pad * 3 - m), x + pad * 2 + m, y + pad + 21 * s);
    ctx.fillStyle = '#7b6a5d'; font(ctx, 600, Math.round(12.5 * s));
    ctx.fillText(fit(ctx, p.sector || p.broad_sector || '', w - pad * 3 - m), x + pad * 2 + m, y + pad + 40 * s);
    // price strip
    const sy = y + pad + m + 12 * s, sh = 58 * s;
    ctx.fillStyle = 'rgba(0,0,0,.05)'; rr(ctx, x + pad, sy, w - pad * 2, sh, 10 * s); ctx.fill();
    const bw = 66 * s, colW = (w - pad * 2 - bw - 16 * s) / 2;
    [['PICKED AT', rs(p.pick_price)], ['TARGET', rs(p.target_price)]].forEach((c, i) => {
      const cx = x + pad + 10 * s + i * colW;
      ctx.fillStyle = '#8a7a6b'; font(ctx, 800, Math.round(10 * s)); ctx.fillText(c[0], cx, sy + 20 * s);
      ctx.fillStyle = T.ink; font(ctx, 800, Math.round(17 * s)); ctx.fillText(fit(ctx, c[1], colW - 6 * s), cx, sy + 44 * s);
    });
    upBadge(ctx, x + w - pad - bw - 6 * s, sy + 7 * s, bw, sh - 14 * s, upside(p));
    // since the pick
    if (opts && opts.track && num(p.price) !== null) {
      const r = since(p);
      font(ctx, 600, Math.round(13 * s)); ctx.fillStyle = '#6b5d50';
      const ty = y + h - 14 * s;
      ctx.fillText('Now ' + rs(p.price), x + pad, ty);
      ctx.textAlign = 'right'; ctx.fillStyle = r >= 0 ? '#15803d' : '#c2410c'; font(ctx, 800, Math.round(13 * s));
      ctx.fillText(sp(r) + ' since pick', x + w - pad, ty); ctx.textAlign = 'left';
    }
    if (p.target_hit_on) {
      ctx.fillStyle = '#f59e0b'; rr(ctx, x + w - 100 * s, y - 10 * s, 88 * s, 22 * s, 11 * s); ctx.fill();
      ctx.fillStyle = '#1a1300'; font(ctx, 800, Math.round(11 * s)); ctx.textAlign = 'center'; ctx.fillText('TARGET HIT', x + w - 56 * s, y + 5 * s); ctx.textAlign = 'left';
    }
  }
  function pill(ctx, T, text, x, y, w, h, vertical) {
    const g = vertical ? ctx.createLinearGradient(x, y, x, y + h) : ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, T.pill[0]); g.addColorStop(1, T.pill[1]);
    ctx.fillStyle = g; rr(ctx, x, y, w, h, Math.min(w, h) * 0.3); ctx.fill();
    ctx.strokeStyle = T.acc; ctx.lineWidth = 1.5; rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.min(w, h) * 0.3); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (vertical) { ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-Math.PI / 2); font(ctx, 800, Math.round(w * 0.42)); ctx.fillText(text.split('').join(String.fromCharCode(8202)), 0, 1); ctx.restore(); }
    else { font(ctx, 800, Math.round(h * 0.45)); ctx.fillText(text, x + w / 2, y + h / 2 + 1); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  /* ───────── poster: 1600 x 1000 ───────── */
  function poster(D) {
    const o = D.occasion, T = TH[o.theme] || TH.diwali, W = 1600, H = 1000;
    const [c, ctx] = canvas(W, H);
    festive(ctx, T, o.theme, W, H, 1, { diyas: 9, seed: 11 });
    ctx.textAlign = 'center';
    ctx.textAlign = 'left'; badge(ctx, 50, 58, 40, 'PICKED BY'); ctx.textAlign = 'center';
    ctx.fillStyle = T.gold[0]; font(ctx, 800, 16); ctx.fillText(o.name.toUpperCase().split('').join(' ') + '   P I C K S   B Y   M A R K E T P U L S E', W / 2, 92);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18;
    ctx.fillStyle = goldFill(ctx, T, 100, 175); font(ctx, 800, 76, SERIF); ctx.fillText(o.title, W / 2, 168); ctx.restore();
    ctx.fillStyle = '#fff'; font(ctx, 600, 22);
    ctx.fillText([o.subtitle, '5 large, 5 mid & 5 small caps for the next 12 months', 'Published ' + dt(o.published_at)].filter(Boolean).join('   ·   '), W / 2, 208);
    ctx.textAlign = 'left';
    const top = 238, rowH = 190, gap = 16, lx = 46, lw = 40, cx0 = lx + lw + 14, cw = (W - cx0 - 46 - 4 * 16) / 5;
    CAPS.forEach(([cap, label], r) => {
      const y = top + r * (rowH + gap);
      pill(ctx, T, label, lx, y, lw, rowH, true);
      (D.picks || []).filter((p) => p.cap === cap).slice(0, 5).forEach((p, i) => card(ctx, T, p, cx0 + i * (cw + 16), y, cw, rowH, 1, { track: true }));
    });
    const fy = top + 3 * rowH + 2 * gap + 12;
    ctx.fillStyle = 'rgba(10,8,40,.62)'; rr(ctx, 46, fy, W - 92, 74, 16); ctx.fill();
    ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 2; rr(ctx, 47, fy + 1, W - 94, 72, 15); ctx.stroke();
    brand(ctx, 66, fy + 15, 44, '#fff');
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fcd34d'; font(ctx, 800, 18); ctx.fillText(`Picked & tracked by MarketPulse  ·  live track record at ${SITE}`, W - 66, fy + 32);
    ctx.fillStyle = 'rgba(255,255,255,.82)'; font(ctx, 500, 13); ctx.fillText(`Prices as of ${dt(D.as_of || new Date())}  ·  ${DISC}`, W - 66, fy + 56);
    ctx.textAlign = 'left';
    return c;
  }

  /* ───────── story: 1080 x 1920 ───────── */
  function story(D) {
    const o = D.occasion, T = TH[o.theme] || TH.diwali, W = 1080, H = 1920;
    const [c, ctx] = canvas(W, H);
    festive(ctx, T, o.theme, W, H, 1.25, { diyas: 6, seed: 5, bursts: [[0.12, 0.1, 110], [0.88, 0.09, 120], [0.08, 0.95, 70], [0.92, 0.96, 80]] });
    ctx.textAlign = 'center';
    ctx.textAlign = 'left'; badge(ctx, W / 2, 92, 50, 'PICKED BY', 'center'); ctx.textAlign = 'center';
    const words = o.title.split(' '), yr = /^\d{4}$/.test(words[words.length - 1]) ? words.pop() : '';
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 20;
    ctx.fillStyle = goldFill(ctx, T, 160, 330); font(ctx, 800, 96, SERIF);
    ctx.fillText(fit(ctx, words.join(' '), W - 120), W / 2, 248); if (yr) { font(ctx, 800, 84, SERIF); ctx.fillText(yr, W / 2, 335); }
    ctx.restore();
    ctx.fillStyle = '#fff'; font(ctx, 600, 26); ctx.fillText([o.subtitle, '12-month view'].filter(Boolean).join('  ·  '), W / 2, 382);
    ctx.textAlign = 'left';
    let y = 412; const x0 = 54, pw = W - 108, rowH = 68;
    CAPS.forEach(([cap, label]) => {
      pill(ctx, T, label, x0, y, 200, 46, false);
      y += 56;
      const rows = (D.picks || []).filter((p) => p.cap === cap).slice(0, 5);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 20; ctx.fillStyle = T.card; rr(ctx, x0, y, pw, rows.length * rowH + 12, 22); ctx.fill(); ctx.restore();
      rows.forEach((p, i) => {
        const ry = y + 6 + i * rowH;
        if (i) { ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fillRect(x0 + 20, ry, pw - 40, 1.5); }
        mono(ctx, p.symbol, x0 + 18, ry + 9, 50);
        ctx.fillStyle = T.ink; font(ctx, 800, 26); ctx.fillText(fit(ctx, short(p.name), 410), x0 + 84, ry + 35);
        ctx.fillStyle = '#7b6a5d'; font(ctx, 600, 16); ctx.fillText(fit(ctx, p.sector || '', 410), x0 + 84, ry + 57);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#8a7a6b'; font(ctx, 700, 14); ctx.fillText('PICKED → TARGET', x0 + pw - 146, ry + 26);
        ctx.fillStyle = T.ink; font(ctx, 800, 23); ctx.fillText(rs(p.pick_price) + ' → ' + rs(p.target_price), x0 + pw - 146, ry + 54);
        ctx.textAlign = 'left';
        upBadge(ctx, x0 + pw - 128, ry + 9, 108, 50, upside(p));
      });
      y += rows.length * rowH + 12 + 20;
    });
    const fy = Math.max(y + 2, H - 226);
    signoff(ctx, x0, fy, pw, 106, 60, true);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; font(ctx, 500, 14); ctx.textAlign = 'center';
    wrap(ctx, DISC + ' Published ' + dt(o.published_at) + '.', W / 2, fy + 128, pw - 40, 19, 2); ctx.textAlign = 'left';
    return c;
  }

  /* ───────── PDF report: A4 pages at 1240 x 1754 ───────── */
  const PW = 1240, PH = 1754, M = 70;
  function page(T, o, n, total, band) {
    const [c, ctx] = canvas(PW, PH);
    ctx.fillStyle = '#fffaf3'; ctx.fillRect(0, 0, PW, PH);
    // faint border
    ctx.strokeStyle = T.acc + '55'; ctx.lineWidth = 3; rr(ctx, 24, 24, PW - 48, PH - 48, 26); ctx.stroke();
    if (band) {
      ctx.save(); rr(ctx, 24, 24, PW - 48, 200, 26); ctx.clip(); ctx.translate(24, 24);
      festive(ctx, T, o.theme, PW - 48, 200, 0.8, { garland: true, strands: false, sparkles: 14, seed: n * 13, bursts: [[0.06, 0.5, 60], [0.94, 0.45, 70]] });
      ctx.restore();
      badge(ctx, PW - M, 110, 40, 'PICKED BY', 'right');
      ctx.fillStyle = T.gold[0]; font(ctx, 800, 15); ctx.fillText((o.title + (o.subtitle ? '  ·  ' + o.subtitle : '')).toUpperCase(), M, 120);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 12; ctx.fillStyle = goldFill(ctx, T, 130, 190); font(ctx, 800, 50, SERIF); ctx.fillText(band, M, 182); ctx.restore();
    }
    // footer: logo + wordmark, the live address (clickable in the PDF) and the page number
    ctx.fillStyle = T.acc + '66'; ctx.fillRect(M, PH - 108, PW - 2 * M, 2);
    brand(ctx, M, PH - 92, 30, BRAND_INK);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7b6a5d'; font(ctx, 600, 14); const pg = `Page ${n} of ${total}`; ctx.fillText(pg, PW - M, PH - 70);
    const pgW = ctx.measureText(pg).width;
    ctx.fillStyle = '#2e1f82'; font(ctx, 800, 15); const lbl = SITE + '   ·   '; ctx.fillText(lbl, PW - M - pgW, PH - 70);
    const lw = ctx.measureText(SITE).width, lx = PW - M - pgW - ctx.measureText(lbl).width;
    c._links = [{ x: lx, y: PH - 88, w: lw, h: 26 }];
    ctx.textAlign = 'left'; ctx.fillStyle = '#7b6a5d'; font(ctx, 500, 13); ctx.fillText(fit(ctx, DISC, PW - 2 * M), M, PH - 46);
    return [c, ctx];
  }
  function heading(ctx, T, text, x, y) { ctx.fillStyle = T.pill[0]; font(ctx, 800, 17); ctx.fillText(text.toUpperCase().split('').join(String.fromCharCode(8202)), x, y); ctx.fillStyle = T.acc; ctx.fillRect(x, y + 9, 54, 3); }

  function coverPage(D, total) {
    const o = D.occasion, T = TH[o.theme] || TH.diwali;
    const [c, ctx] = page(T, o, 1, total, null);
    const fh = 1000;
    ctx.save(); rr(ctx, 24, 24, PW - 48, fh, 26); ctx.clip(); ctx.translate(24, 24);
    festive(ctx, T, o.theme, PW - 48, fh, 1.2, { diyas: 7, seed: 3, sparkles: 34 });
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textAlign = 'left'; badge(ctx, PW / 2, 240, 64, 'A MARKETPULSE REPORT', 'center'); ctx.textAlign = 'center';
    const words = o.title.split(' '), yr = /^\d{4}$/.test(words[words.length - 1]) ? words.pop() : '';
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 22; ctx.fillStyle = goldFill(ctx, T, 340, 600);
    font(ctx, 800, 118, SERIF); ctx.fillText(fit(ctx, words.join(' '), PW - 160), PW / 2, 470);
    if (yr) { font(ctx, 800, 104, SERIF); ctx.fillText(yr, PW / 2, 585); }
    ctx.restore();
    ctx.fillStyle = '#fff'; font(ctx, 600, 30); if (o.subtitle) ctx.fillText(o.subtitle, PW / 2, 645);
    font(ctx, 500, 24); ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText('5 large-cap  ·  5 mid-cap  ·  5 small-cap stocks for the next 12 months', PW / 2, 700);
    ctx.fillText('Published ' + dt(o.published_at) + (num(o.nifty_at_pick) ? '   ·   Nifty 50 at ' + Math.round(o.nifty_at_pick).toLocaleString('en-IN') : ''), PW / 2, 742);
    ctx.textAlign = 'left';
    // letter
    let y = fh + 90;
    const note = (o.market_note && o.market_note.lines) || [];
    ctx.fillStyle = T.ink; font(ctx, 800, 34, SERIF); ctx.fillText('Dear investors,', M, y); y += 46;
    ctx.fillStyle = '#4a3b30'; font(ctx, 400, 21);
    note.forEach((l) => { y = wrap(ctx, l, M, y, PW - 2 * M, 31) + 10; });
    ctx.fillStyle = T.pill[0]; font(ctx, 800, 22); ctx.fillText(T.greet, M, y + 8); y += 50;
    // scorecard
    const picks = D.picks || [];
    const rets = picks.map(since).filter((v) => v !== null);
    const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
    const nret = num(D.nifty) && num(o.nifty_at_pick) ? (D.nifty / o.nifty_at_pick - 1) * 100 : null;
    const ups = picks.filter((p) => num(p.price) !== null).map((p) => (p.target_price / p.price - 1) * 100);
    const avgUp = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : picks.reduce((a, p) => a + upside(p), 0) / (picks.length || 1);
    const boxes = [['Avg. upside to target', sp(avgUp)], ['Basket since pick', sp(avg)], ['Nifty 50 since pick', sp(nret)], ['Stocks in profit', rets.length ? rets.filter((r) => r > 0).length + ' / ' + rets.length : '—']];
    const bw = (PW - 2 * M - 3 * 18) / 4;
    boxes.forEach((b, i) => {
      const x = M + i * (bw + 18);
      ctx.fillStyle = '#ffffff'; rr(ctx, x, y, bw, 108, 16); ctx.fill(); ctx.strokeStyle = T.acc + '88'; ctx.lineWidth = 2; rr(ctx, x, y, bw, 108, 16); ctx.stroke();
      ctx.fillStyle = '#8a7a6b'; font(ctx, 800, 14); ctx.fillText(b[0].toUpperCase(), x + 18, y + 34);
      ctx.fillStyle = /^\+/.test(b[1]) ? '#15803d' : /^−/.test(b[1]) ? '#c2410c' : T.ink; font(ctx, 800, 36); ctx.fillText(b[1], x + 18, y + 84);
    });
    ctx.fillStyle = '#8a7a6b'; font(ctx, 500, 14); ctx.fillText('Track record as of ' + dt(D.as_of || new Date()) + '. Live prices and the latest results: ' + SITE, M, y + 136);
    return c;
  }

  function overviewPage(D, total) {
    const o = D.occasion, T = TH[o.theme] || TH.diwali;
    const [c, ctx] = page(T, o, 2, total, 'The picks at a glance');
    let y = 262; const cw = (PW - 2 * M - 4 * 14) / 5, ch = 168;
    CAPS.forEach(([cap, label]) => {
      pill(ctx, T, label, M, y, 170, 34, false); y += 46;
      (D.picks || []).filter((p) => p.cap === cap).slice(0, 5).forEach((p, i) => card(ctx, T, p, M + i * (cw + 14), y, cw, ch, 0.8, { track: true }));
      y += ch + 22;
    });
    y += 18; heading(ctx, T, 'Valuation snapshot', M, y); y += 32;
    const cols = [['Company', 300, 'l'], ['Size', 70, 'l'], ['Picked at', 110, 'r'], ['Target', 100, 'r'], ['Upside', 80, 'r'], ['P/E', 66, 'r'], ['Ind. P/E', 84, 'r'], ['ROE %', 74, 'r'], ['Profit YoY', 112, 'r'], ['Div. %', 104, 'r']];
    ctx.fillStyle = T.pill[1]; rr(ctx, M, y, PW - 2 * M, 38, 8); ctx.fill();
    let x = M + 12; ctx.fillStyle = '#fff'; font(ctx, 800, 14);
    cols.forEach(([t, w, a]) => { ctx.textAlign = a === 'r' ? 'right' : 'left'; ctx.fillText(t.toUpperCase(), a === 'r' ? x + w - 8 : x, y + 25); x += w; });
    y += 38;
    (D.picks || []).forEach((p, r) => {
      const m = p.metrics || {}, g = m.results || {};
      if (r % 2) { ctx.fillStyle = 'rgba(0,0,0,.035)'; ctx.fillRect(M, y, PW - 2 * M, 36); }
      const vals = [short(p.name), p.cap === 'large' ? 'Large' : p.cap === 'mid' ? 'Mid' : 'Small', rs(p.pick_price), rs(p.target_price), sp(upside(p), 0), n1(m.pe), n1(m.sector_pe), n1(m.roe), g.turnaround ? 'Turnaround' : sp(g.profit_yoy), num(m.dy) ? n1(m.dy, 2) : '—'];
      x = M + 12;
      cols.forEach(([, w, a], i) => {
        ctx.textAlign = a === 'r' ? 'right' : 'left';
        ctx.fillStyle = i === 4 ? '#15803d' : i === 8 && /^−/.test(vals[i]) ? '#c2410c' : i === 8 ? '#15803d' : T.ink;
        font(ctx, i === 0 ? 700 : 500, 16);
        ctx.fillText(i === 0 ? fit(ctx, vals[i], w - 10) : vals[i], a === 'r' ? x + w - 8 : x, y + 24); x += w;
      });
      y += 36;
    });
    ctx.textAlign = 'left';
    return c;
  }

  function stockBlock(ctx, T, p, y, h) {
    const m = p.metrics || {}, g = m.results || {};
    const capLabel = p.cap === 'large' ? 'Large cap' : p.cap === 'mid' ? 'Mid cap' : 'Small cap';
    // header strip
    const hg = ctx.createLinearGradient(M, y, PW - M, y); hg.addColorStop(0, T.pill[0]); hg.addColorStop(1, T.pill[1]);
    ctx.fillStyle = hg; rr(ctx, M, y, PW - 2 * M, 104, 18); ctx.fill();
    mono(ctx, p.symbol, M + 18, y + 20, 64);
    ctx.fillStyle = '#fff'; font(ctx, 800, 32, SERIF); ctx.fillText(fit(ctx, short(p.name), 500), M + 100, y + 52);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; font(ctx, 600, 17); ctx.fillText(fit(ctx, capLabel + '  ·  ' + (p.sector || p.broad_sector || '') + '  ·  NSE: ' + p.symbol, 500), M + 100, y + 82);
    const stats = [['PICKED AT', rs(p.pick_price)], ['TARGET', rs(p.target_price)]];
    stats.forEach((s, i) => {
      const sx = PW - M - 420 + i * 145;
      ctx.fillStyle = 'rgba(255,255,255,.14)'; rr(ctx, sx, y + 18, 132, 68, 12); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)'; font(ctx, 800, 13); ctx.fillText(s[0], sx + 14, y + 42);
      ctx.fillStyle = '#fff'; font(ctx, 800, 24); ctx.fillText(fit(ctx, s[1], 110), sx + 14, y + 74);
    });
    upBadge(ctx, PW - M - 128, y + 18, 110, 68, upside(p));
    // left column
    let ly = y + 146; const lx = M + 6, lw = 700;
    heading(ctx, T, 'Why we picked it', lx, ly); ly += 36;
    font(ctx, 400, 18);
    for (const t of (p.thesis || []).slice(0, 6)) {
      if (ly > y + h - 200) break;
      ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.arc(lx + 6, ly - 6, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#3d3027'; ly = wrap(ctx, t, lx + 22, ly, lw - 22, 26, 3) + 8;
    }
    ly += 10; heading(ctx, T, 'Key risks', lx, ly); ly += 36; font(ctx, 400, 18);
    for (const t of (p.risks || []).slice(0, 3)) {
      if (ly > y + h - 30) break;
      ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(lx + 6, ly - 6, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#3d3027'; ly = wrap(ctx, t, lx + 22, ly, lw - 22, 26, 2) + 8;
    }
    // right column
    const rx = M + lw + 40, rw = PW - M - rx;
    let ry = y + 128;
    ctx.fillStyle = '#ffffff'; rr(ctx, rx, ry, rw, 330, 16); ctx.fill(); ctx.strokeStyle = T.acc + '77'; ctx.lineWidth = 2; rr(ctx, rx, ry, rw, 330, 16); ctx.stroke();
    heading(ctx, T, 'Stock data', rx + 18, ry + 36);
    const kv = [
      ['Market cap', num(p.mcap_cr) ? '₹' + Math.round(p.mcap_cr).toLocaleString('en-IN') + ' Cr' : '—'],
      ['P/E · industry P/E', n1(m.pe) + ' · ' + n1(m.sector_pe)],
      [m.fin ? 'ROE' : 'ROE · ROCE', m.fin ? n1(m.roe) + '%' : n1(m.roe) + '% · ' + n1(m.roce) + '%'],
      ['Dividend yield', num(m.dy) ? n1(m.dy, 2) + '%' : '—'],
      ['Promoter holding', num(m.promoter) ? n1(m.promoter) + '%' : '—'],
      ['52-week high / low', rs(m.high_52w ?? p.high_52w) + ' / ' + rs(m.low_52w ?? p.low_52w)],
      [g.label ? 'Results (' + g.label + ')' : 'Latest results', g.turnaround ? 'Back in profit' : g.profit_yoy !== undefined && g.profit_yoy !== null ? 'Profit ' + sp(g.profit_yoy) : '—'],
      ['Now (' + dt(new Date()) + ')', num(p.price) !== null ? rs(p.price) + '  ' + sp(since(p)) : '—'],
    ];
    let ky = ry + 76;
    kv.forEach(([k, v]) => {
      ctx.fillStyle = '#7b6a5d'; font(ctx, 500, 16); ctx.fillText(k, rx + 18, ky);
      ctx.fillStyle = T.ink; font(ctx, 800, 16); ctx.textAlign = 'right'; ctx.fillText(fit(ctx, v, rw - 190), rx + rw - 18, ky); ctx.textAlign = 'left';
      ky += 31;
    });
    ry += 350;
    const math = `Trailing EPS ${rs(m.eps_ttm)} grown ${n1(m.growth_used)}% = ${rs(m.eps_fwd)} next-year EPS × fair P/E ${n1(m.fair_pe)} (between its own ${n1(m.pe)} and the industry's ${n1(m.sector_pe)}) = ${rs(p.target_price)}${m.capped ? ', capped at 40% upside' : ''}.`;
    font(ctx, 400, 15);
    const mh = lines(ctx, math, rw - 36).length * 22 + 52;
    ctx.fillStyle = T.acc + '22'; rr(ctx, rx, ry, rw, mh, 14); ctx.fill();
    ctx.fillStyle = T.pill[0]; font(ctx, 800, 15); ctx.fillText('HOW THE TARGET IS SET', rx + 18, ry + 28);
    ctx.fillStyle = '#4a3b30'; font(ctx, 400, 15); wrap(ctx, math, rx + 18, ry + 52, rw - 36, 22);
  }
  function detailPage(D, pair, n, total) {
    const o = D.occasion, T = TH[o.theme] || TH.diwali;
    const [c, ctx] = page(T, o, n, total, 'Stock by stock');
    const h = (PH - 262 - 140) / 2;
    pair.forEach((p, i) => {
      const y = 262 + i * h;
      if (i) { ctx.strokeStyle = T.acc + '55'; ctx.setLineDash([8, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, y - 20); ctx.lineTo(PW - M, y - 20); ctx.stroke(); ctx.setLineDash([]); }
      stockBlock(ctx, T, p, y, h - 30);
    });
    return c;
  }
  function methodPage(D, n, total) {
    const o = D.occasion, T = TH[o.theme] || TH.diwali;
    const [c, ctx] = page(T, o, n, total, 'How we pick');
    let y = 290;
    METHOD.forEach(([t, d], i) => {
      ctx.fillStyle = T.pill[0]; rr(ctx, M, y - 30, 44, 44, 22); ctx.fill();
      ctx.fillStyle = '#fff'; font(ctx, 800, 20); ctx.textAlign = 'center'; ctx.fillText(String(i + 1), M + 22, y); ctx.textAlign = 'left';
      ctx.fillStyle = T.ink; font(ctx, 800, 22); ctx.fillText(t, M + 64, y);
      ctx.fillStyle = '#4a3b30'; font(ctx, 400, 19); y = wrap(ctx, d, M + 64, y + 32, PW - 2 * M - 64, 28) + 34;
    });
    y += 10;
    const disc = 'Picks are generated automatically from public data (company filings, NSE results and market prices) on the publish date and are never changed afterwards, so the track record is honest. MarketPulse is not a SEBI-registered investment adviser or research analyst; this is educational information, not a recommendation to buy or sell any security. Past performance does not guarantee future returns. Markets carry risk — do your own research or consult a registered adviser, and invest only what you can hold for the long term.';
    font(ctx, 400, 17); const dh = lines(ctx, disc, PW - 2 * M - 48).length * 26 + 70;
    ctx.fillStyle = '#fff4e5'; rr(ctx, M, y, PW - 2 * M, dh, 18); ctx.fill(); ctx.strokeStyle = T.acc; ctx.lineWidth = 2; rr(ctx, M, y, PW - 2 * M, dh, 18); ctx.stroke();
    ctx.fillStyle = T.pill[0]; font(ctx, 800, 18); ctx.fillText('IMPORTANT', M + 24, y + 38);
    ctx.fillStyle = '#4a3b30'; font(ctx, 400, 17); y = wrap(ctx, disc, M + 24, y + 70, PW - 2 * M - 48, 26) + 40;
    ctx.textAlign = 'center'; ctx.fillStyle = T.pill[0]; font(ctx, 800, 30, SERIF); ctx.fillText(T.greet, PW / 2, y + 30);
    ctx.textAlign = 'left';
    const sy = Math.min(y + 70, PH - 300);
    const box = signoff(ctx, M, sy, PW - 2 * M, 170, 96, false);
    c._links = (c._links || []).concat([box, { x: M, y: sy, w: PW - 2 * M, h: 170 }]);
    return c;
  }

  /* ───────── minimal PDF writer: one JPEG per A4 page ───────── */
  function b64bytes(dataUrl) { const s = atob(dataUrl.split(',')[1]); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  function makePdf(pages, title, url) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0, next = 1;
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (id, fn) => { offs[id] = len; push(id + ' 0 obj\n'); fn(); push('\nendobj\n'); };
    const esc = (t) => String(t).replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, '');
    push('%PDF-1.4\n'); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
    // object ids: catalog, pages, info, then per page: page, contents, image, link annotations
    const CAT = next++, PAGES = next++, INFO = next++;
    const ids = pages.map((pg) => ({ p: next++, cs: next++, im: next++, an: (pg.links || []).map(() => next++) }));
    const total = next - 1, kx = 595.28 / PW, ky = 841.89 / PH;
    obj(CAT, () => push(`<< /Type /Catalog /Pages ${PAGES} 0 R >>`));
    obj(PAGES, () => push(`<< /Type /Pages /Kids [${ids.map((d) => d.p + ' 0 R').join(' ')}] /Count ${pages.length} >>`));
    obj(INFO, () => push(`<< /Title (${esc(title)}) /Author (MarketPulse) /Subject (${esc(url)}) /Producer (MarketPulse) /Creator (MarketPulse picks.html) >>`));
    pages.forEach((pg, i) => {
      const d = ids[i], stream = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
      const annots = d.an.length ? ` /Annots [${d.an.map((a) => a + ' 0 R').join(' ')}]` : '';
      obj(d.p, () => push(`<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${d.im} 0 R >> >> /Contents ${d.cs} 0 R${annots} >>`));
      obj(d.cs, () => push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
      obj(d.im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.data.length} >>\nstream\n`); push(pg.data); push('\nendstream'); });
      (pg.links || []).forEach((l, k) => {
        const r = [l.x * kx, 841.89 - (l.y + l.h) * ky, (l.x + l.w) * kx, 841.89 - l.y * ky].map((v) => v.toFixed(2)).join(' ');
        obj(d.an[k], () => push(`<< /Type /Annot /Subtype /Link /Rect [${r}] /Border [0 0 0] /A << /S /URI /URI (${esc(url)}) >> >>`));
      });
    });
    const xref = len;
    let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total + 1} /Root ${CAT} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  function report(D) {
    const picks = D.picks || [], pairs = [];
    for (let i = 0; i < picks.length; i += 2) pairs.push(picks.slice(i, i + 2));
    const total = 2 + pairs.length + 1;
    const canvases = [coverPage(D, total), overviewPage(D, total)];
    pairs.forEach((pair, i) => canvases.push(detailPage(D, pair, 3 + i, total)));
    canvases.push(methodPage(D, total, total));
    const url = (location.origin && location.origin !== 'null' ? location.origin : 'https://' + location.host) + '/picks.html?o=' + encodeURIComponent(D.occasion.slug || '');
    return makePdf(canvases.map((c) => ({ w: c.width, h: c.height, links: c._links, data: b64bytes(c.toDataURL('image/jpeg', 0.88)) })), D.occasion.title + ' - MarketPulse', url);
  }

  /* ───────── entry point ───────── */
  const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));
  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  async function fontsReady() {
    try { await Promise.all([document.fonts.load(`800 60px "Playfair Display"`), document.fonts.load('800 20px Inter'), document.fonts.load('400 20px Inter'), document.fonts.load('600 20px Inter')]); } catch (e) { /* fall back to system fonts */ }
  }
  async function run(kind, D) {
    if (!D || !D.occasion || !(D.picks || []).length) throw new Error('No picks to download yet');
    await fontsReady();
    const base = D.occasion.slug || 'picks';
    if (kind === 'poster') { save(await toBlob(poster(D)), `marketpulse-${base}-poster.png`); return; }
    if (kind === 'story') { save(await toBlob(story(D)), `marketpulse-${base}-story.png`); return; }
    if (kind === 'pdf') { save(report(D), `marketpulse-${base}.pdf`); return; }
    if (kind === 'share') {
      const file = new File([await toBlob(story(D))], `marketpulse-${base}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: D.occasion.title, text: `${D.occasion.title} — 15 stocks for the next 12 months: ${location.origin}/picks.html?o=${base}` });
      } else save(file, file.name);
    }
  }
  window.MPPicksExport = { run, poster, story, report, canShare: () => !!(navigator.canShare && window.File) };
})();
