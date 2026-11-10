/* Site settings: the backend addresses every page and script uses. This is the ONLY place they live.
   To run the site on another Supabase project / Cloudflare Worker (a sale or a new deployment),
   change the values below and redeploy; nothing else in the front end needs editing.

   Loaded first in every page's <head> (<script src="/site-config.js"></script>), so window.MP_CONFIG
   is ready before any other script runs. The blog generator (scripts/blog/data.mjs) reads it too.

   These values are public by design: the publishable key only allows what the database's
   row-level security allows. Never put a service-role key or any other secret here. */
(function (root) {
  'use strict';
  var C = {
    // Supabase project: Settings → API → Project URL, and the publishable key (sb_publishable_…).
    supabaseUrl: 'https://fzazdrzlemmkqngvpzxj.supabase.co',
    supabaseKey: 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq',
    // The project's legacy "anon" JWT key (Settings → API → Legacy API keys). Only the Crypto page uses it.
    supabaseLegacyAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6YXpkcnpsZW1ta3FuZ3ZwenhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMzc2MzEsImV4cCI6MjEwNDgxMzYzMX0.LNeR5_h0n2Y-hA2GD9e_tle3Euz1esB0Vr3_-ZtEYAk',
    // Cloudflare Worker that serves stock search, price/index feeds and history (no trailing slash).
    apiBase: 'https://marketpulse-cache.manish0solanki20078.workers.dev',
    // Special trading sessions outside the normal weekday 9:15-3:30 (IST date, from-to in IST, pre-open included),
    // and exchange holidays. These are only the fallback: on every page load the full calendar comes from the
    // database (market_calendar(): NSE's official holiday list, refreshed weekly, plus special sessions such as
    // Muhurat trading), cached in the browser. Pages check MP_CONFIG.marketSession() / isMarketOpen().
    specialSessions: [{ date: '2026-11-08', from: '14:05', to: '15:40', name: 'Muhurat trading' }],
    holidays: ['2026-11-10'],
    holidayNames: { '2026-11-10': 'Diwali Balipratipada' },
  };
  // Derived values (don't edit).
  C.ref = C.supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
  C.authStorageKey = 'sb-' + C.ref + '-auth-token'; // where supabase-js keeps the login session
  C.apiHost = C.apiBase.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  C.fn = function (name) { return C.supabaseUrl + '/functions/v1/' + name; };
  var istParts = function (ms) {
    var t = new Date((ms === undefined ? Date.now() : ms) + 330 * 60000);
    return { day: t.toISOString().slice(0, 10), m: t.getUTCHours() * 60 + t.getUTCMinutes(), dow: t.getUTCDay() };
  };
  var mins = function (hm) { var p = hm.split(':'); return +p[0] * 60 + +p[1]; };
  // { special: session|null, holiday: bool, holidayName, today } for a moment (default now). special is set while a special session is on.
  C.marketSession = function (ms) {
    var p = istParts(ms), sp = null;
    for (var i = 0; i < C.specialSessions.length; i++) { var x = C.specialSessions[i]; if (x.date === p.day && p.m >= mins(x.from) && p.m < mins(x.to)) sp = x; }
    var hol = C.holidays.indexOf(p.day) >= 0;
    return { special: sp, holiday: hol, holidayName: hol ? (C.holidayNames[p.day] || 'Market holiday') : null, today: p.day };
  };
  // Is the NSE cash market trading at this moment? Weekdays 9:15-15:30 IST except holidays, plus special sessions.
  C.isMarketOpen = function (ms) {
    var p = istParts(ms), s = C.marketSession(ms);
    if (s.special) return true;
    return p.dow >= 1 && p.dow <= 5 && !s.holiday && p.m >= 555 && p.m < 930;
  };
  // Is this IST date (YYYY-MM-DD) a trading day? (A special session on a holiday or weekend counts.)
  C.isTradingDay = function (day) {
    for (var i = 0; i < C.specialSessions.length; i++) if (C.specialSessions[i].date === day) return true;
    var dow = new Date(day + 'T00:00:00Z').getUTCDay();
    return dow >= 1 && dow <= 5 && C.holidays.indexOf(day) < 0;
  };
  // The next weekday holidays from today (IST), soonest first: [{ d, name }].
  C.upcomingHolidays = function (n) {
    var today = istParts().day;
    return C.holidays.filter(function (d) { var w = new Date(d + 'T00:00:00Z').getUTCDay(); return d >= today && w >= 1 && w <= 5; })
      .sort().slice(0, n || 5).map(function (d) { return { d: d, name: C.holidayNames[d] || 'Market holiday' }; });
  };
  function mergeCalendar(cal) {
    if (!cal) return;
    (cal.holidays || []).forEach(function (h) { if (C.holidays.indexOf(h.d) < 0) C.holidays.push(h.d); C.holidayNames[h.d] = h.name; });
    (cal.special || []).forEach(function (x) {
      if (!C.specialSessions.some(function (y) { return y.date === x.d; })) C.specialSessions.push({ date: x.d, from: x.from, to: x.to, name: x.name });
    });
  }
  // Browser only: the cached calendar at once, then a fresh copy (at most every 6 hours). Pages that care can
  // listen for the 'mp-market-calendar' event to redraw once the fresh copy is in.
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    var KEY = 'mp-market-cal', cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.cal) mergeCalendar(cached.cal);
    if (!cached || !cached.at || Date.now() - cached.at > 6 * 3600e3) {
      C.calendarReady = fetch(C.supabaseUrl + '/rest/v1/rpc/market_calendar', {
        method: 'POST', headers: { apikey: C.supabaseKey, 'Content-Type': 'application/json' }, body: '{}',
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (cal) {
        if (!cal) return;
        mergeCalendar(cal);
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), cal: cal })); } catch (e) { /* private mode */ }
        try { window.dispatchEvent(new CustomEvent('mp-market-calendar')); } catch (e) { /* old browser */ }
      }).catch(function () { /* offline: keep the fallback */ });
    } else C.calendarReady = Promise.resolve();
  }
  root.MP_CONFIG = Object.freeze(C);
})(typeof window !== 'undefined' ? window : globalThis);
