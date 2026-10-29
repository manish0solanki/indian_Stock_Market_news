/* Reads a CAMS / KFintech Consolidated Account Statement (CAS) PDF in the browser.
   Nothing leaves the device: pdf.js opens the PDF with the user's password, and this file turns
   the text into funds and transactions. Exposes window.mpCas = { readPdf, parseLines, parseNumber }.

   A detailed CAS lists, per folio and scheme:
     PP001ZG-Parag Parikh Flexi Cap Fund - Direct Plan Growth - ISIN: INF879O01027(Advisor: DIRECT) Registrar : CAMS
     Opening Unit Balance: 0.000
     05-Nov-2025  Purchase - Systematic   9,999.50   137.917   72.5050   137.917
     05-Nov-2025  *** Stamp Duty ***   0.50
     10-Mar-2026  Redemption   (5,000.00)   (60.000)   83.3333   77.917
     Closing Unit Balance: 77.917   NAV on 28-Oct-2026: INR 88.8018   Total Cost Value: 5,500.00   Market Value on 28-Oct-2026: INR 6,919.15
*/
(function () {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // "1,23,456.78" -> 123456.78; "(5,000.00)" and "-5,000.00" -> -5000
  function parseNumber(s) {
    const t = String(s || '').trim();
    const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
    const n = Number(t.replace(/[(),\s-]/g, ''));
    return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  }
  // "05-Nov-2025" -> "2025-11-05"
  function isoDate(s) {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || '').trim());
    if (!m || !MONTHS[m[2].toLowerCase()]) return null;
    return m[3] + '-' + String(MONTHS[m[2].toLowerCase()]).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  const NUM = /^\(?-?[\d,]*\d(?:\.\d+)?\)?$/;

  // Funds keyed by ISIN; the same scheme in two folios is merged.
  function parseLines(lines) {
    const funds = new Map();
    let folio = '', cur = null, period = null;
    const amc = { name: '' };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if (!period) {
        const p = /(\d{2}-[A-Za-z]{3}-\d{4})\s+To\s+(\d{2}-[A-Za-z]{3}-\d{4})/i.exec(line);
        if (p) period = { from: isoDate(p[1]), to: isoDate(p[2]) };
      }
      if (/Mutual Fund\s*$/i.test(line) && !/ISIN/i.test(line) && line.length < 80) amc.name = line;
      const fm = /Folio\s*No\s*[:.]?\s*([A-Za-z0-9/ ]+?)(?=\s{1,}(?:PAN|KYC|Nominee)|$)/i.exec(line);
      if (fm) folio = fm[1].trim();

      const im = /ISIN\s*:?\s*(IN[A-Z0-9]{10})/i.exec(line);
      if (im) {
        let name = line.slice(0, im.index).replace(/[-\s]+$/, '').trim();
        if (!name && i > 0) name = lines[i - 1].trim();
        name = name.replace(/^[A-Z0-9]{2,15}-(?=\S)/, '').replace(/\s*-\s*$/, '').trim();
        const isin = im[1].toUpperCase();
        if (!funds.has(isin)) funds.set(isin, { isin, name, amc: amc.name, folios: [], txs: [], opening: 0, closing: null, cost: null, nav: null, navDate: null, value: null });
        cur = funds.get(isin);
        cur.part = { folio, opening: 0, closing: null, cost: null };
        cur.folios.push(cur.part);
        continue;
      }
      if (!cur) continue;

      let m;
      if ((m = /Opening Unit Balance\s*:?\s*(\(?-?[\d,]+\.?\d*\)?)/i.exec(line))) cur.part.opening = parseNumber(m[1]);
      if ((m = /Closing Unit Balance\s*:?\s*(\(?-?[\d,]+\.?\d*\)?)/i.exec(line))) cur.part.closing = parseNumber(m[1]);
      if ((m = /Cost Value\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i.exec(line))) cur.part.cost = parseNumber(m[1]);
      if ((m = /NAV on\s*(\d{2}-[A-Za-z]{3}-\d{4})\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d+)/i.exec(line))) { cur.navDate = isoDate(m[1]); cur.nav = parseNumber(m[2]); }
      if ((m = /Market Value on\s*\S+\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.\d+)/i.exec(line))) cur.part.value = parseNumber(m[1]);

      const tm = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+)$/.exec(line);
      if (!tm) continue;
      const date = isoDate(tm[1]);
      if (!date) continue;
      // Trailing numeric columns: Amount, Units, Price (NAV), Unit balance.
      const toks = tm[2].split(' ');
      const nums = [];
      while (toks.length && NUM.test(toks[toks.length - 1])) nums.unshift(toks.pop());
      const desc = toks.join(' ');
      if (/stamp duty/i.test(desc) && nums.length >= 1) {
        // Stamp duty is charged on purchases: add it to the latest purchase's cost.
        const last = [...cur.txs].reverse().find((t) => t.type === 'BUY' && t.date === date);
        if (last) last.amount += Math.abs(parseNumber(nums[nums.length - 1]));
        continue;
      }
      if (nums.length < 4) continue; // dividend payouts, STT and notes have no unit movement
      const [amount, units, nav] = nums.slice(-4).map(parseNumber);
      if (!Number.isFinite(units) || !units || !Number.isFinite(nav) || nav <= 0) continue;
      cur.txs.push({ date, desc, type: units > 0 ? 'BUY' : 'SELL', units: Math.abs(units), nav, amount: Math.abs(Number.isFinite(amount) ? amount : units * nav), folio: cur.part.folio });
    }

    return [...funds.values()].map((f) => {
      const parts = f.folios;
      const sum = (k) => parts.reduce((a, p) => a + (Number.isFinite(p[k]) ? p[k] : 0), 0);
      const closing = parts.some((p) => p.closing !== null) ? sum('closing') : null;
      const cost = parts.some((p) => p.cost !== null) ? sum('cost') : null;
      const opening = sum('opening');
      const net = f.txs.reduce((a, t) => a + (t.type === 'BUY' ? t.units : -t.units), 0);
      // Transactions are only trusted when they add up to the closing balance from a zero opening.
      const complete = closing !== null && opening < 0.001 && f.txs.length > 0 && Math.abs(net - closing) <= Math.max(0.01, closing * 0.0005);
      return {
        isin: f.isin, name: f.name, amc: f.amc, folios: parts.map((p) => p.folio).filter(Boolean),
        txs: f.txs, closing, cost, opening, nav: f.nav, navDate: f.navDate, value: sum('value') || null,
        mode: complete ? 'transactions' : closing ? 'snapshot' : 'skip', net,
      };
    }).map((f) => ({ ...f, period }));
  }

  // Rebuild text lines from pdf.js text items (grouped by baseline, ordered left to right).
  async function pageLines(page) {
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' '));
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
      s.onerror = () => reject(new Error('Could not load the PDF reader. Check your connection.'));
      document.head.appendChild(s);
    });
  }

  // Throws Error with .code 'PASSWORD_NEEDED' | 'PASSWORD_WRONG' | 'NOT_CAS'.
  async function readPdf(file, password) {
    const lib = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    let doc;
    try {
      doc = await lib.getDocument({ data, password: password || undefined, isEvalSupported: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        const err = new Error(e.code === 2 ? 'That password did not open the statement.' : 'This statement is password protected. Enter its password.');
        err.code = e.code === 2 ? 'PASSWORD_WRONG' : 'PASSWORD_NEEDED';
        throw err;
      }
      throw new Error('Could not open this file as a PDF.');
    }
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) lines.push(...await pageLines(await doc.getPage(p)));
    const funds = parseLines(lines);
    if (!funds.length) {
      const err = new Error('No mutual fund schemes were found. Make sure this is a CAS from CAMS, KFintech or MF Central.');
      err.code = 'NOT_CAS';
      throw err;
    }
    return funds;
  }

  window.mpCas = { readPdf, parseLines, parseNumber, isoDate };
})();
