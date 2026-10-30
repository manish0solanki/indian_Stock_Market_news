/* Shared MarketPulse header, phone tab bar and theme for every page except Home.
   Include in <head>:  <link rel="stylesheet" href="/site-header.css"><script src="/site-header.js"></script>
   It applies the saved light/dark theme before the page paints, then renders the header into
   <div id="mpHeader"></div> (or at the top of <body>) and the tab bar at the bottom on phones.
   Theme preference is shared with Home via localStorage 'marketpulse-theme'. */
(function () {
  'use strict';
  var THEME_KEY = 'marketpulse-theme';
  var AUTH_KEY = 'sb-fzazdrzlemmkqngvpzxj-auth-token'; // where supabase-js keeps the session
  var SEARCH_API = 'https://marketpulse-cache.manish0solanki20078.workers.dev/stock-search';
  var SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';

  function storedTheme() { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#ffffff' : '#0a0f1e');
    var btn = document.getElementById('mphTheme');
    if (btn) { btn.textContent = t === 'light' ? '🌙' : '☀️'; btn.title = t === 'light' ? 'Switch to dark mode' : 'Switch to light mode'; }
  }
  applyTheme(storedTheme()); // before first paint: no flash of the wrong theme

  var NAV = [
    ['Home', '/', function (p) { return p === '/' || p === '/index.html'; }],
    ['Sectors', '/#sectors', function () { return false; }],
    ['Analysis', '/stock-analysis.html', function (p) { return p.indexOf('/stock-analysis') === 0; }],
    ['Screener', '/screener.html', function (p) { return p.indexOf('/screener') === 0; }],
    ['Signals', '/stock-signals.html', function (p) { return p.indexOf('/stock-signals') === 0; }],
    ['Portfolio', '/portfolio.html', function (p) { return p.indexOf('/portfolio') === 0; }],
    ['IPO', '/ipo.html', function (p) { return p.indexOf('/ipo') === 0; }],
    ['Events', '/events.html', function (p) { return p.indexOf('/events') === 0; }],
    ['Crypto', '/crypto-signals.html', function (p) { return p.indexOf('/crypto-signals') === 0; }],
    ['Blog', '/blog/', function (p) { return p.indexOf('/blog') === 0; }],
  ];
  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    markets: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    analysis: '<path d="M3 20h18"/><path d="M6 16l4-5 3 3 5-7"/><circle cx="18" cy="7" r="1.2"/>',
    portfolio: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  function svg(name, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function session() {
    try {
      var raw = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      var s = raw && (raw.currentSession || raw);
      return s && s.user && s.refresh_token ? s.user : null;
    } catch (e) { return null; }
  }

  function render() {
    if (document.getElementById('mph')) return;
    var path = location.pathname;
    var navHtml = NAV.map(function (n) { return '<a href="' + n[1] + '" target="_self"' + (n[2](path) ? ' aria-current="page"' : '') + '>' + n[0] + '</a>'; }).join('');
    var user = session();
    // Phone sign-ins have no email; Google ones carry a name.
    var who = user ? (user.email || (user.phone ? '+' + String(user.phone).replace(/^\+/, '') : '') || (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '') : '';
    var acct = user
      ? '<div class="mph-rel"><button class="mph-acct" id="mphAcct" type="button" aria-haspopup="true" aria-expanded="false"><b>' + esc(((user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email || 'U').charAt(0).toUpperCase()) + '</b><span>Account</span></button>' +
        '<div class="mph-pop" id="mphAcctMenu" hidden><div class="mph-email">' + esc(who) + '</div>' +
        '<a href="/my-ticker.html" target="_self">✎ My Ticker</a><a href="/portfolio.html" target="_self">📊 My Portfolio</a><a href="/stock-signals.html" target="_self">📈 Stock Signals</a><a href="/" target="_self">🏠 Dashboard</a>' +
        '<button type="button" id="mphLogout">↩ Log out</button></div></div>'
      : '<a class="mph-login" href="/?login=1" target="_self">Login</a>';
    // Plain <div>s with roles: some pages style the header/nav tags globally.
    var header = document.createElement('div');
    header.className = 'mph'; header.id = 'mph'; header.setAttribute('role', 'banner');
    header.innerHTML =
      '<div class="mph-in">' +
        '<button class="mph-ico mph-menu-btn" id="mphMenu" type="button" aria-label="Open menu" aria-expanded="false">' + svg('menu', 20) + '</button>' +
        '<a class="mph-brand" href="/" target="_self"><i></i>MarketPulse</a>' +
        '<div class="mph-nav" role="navigation" aria-label="Main">' + navHtml + '</div>' +
        '<div class="mph-right">' +
          '<div class="mph-search" role="search">' + svg('search', 16) + '<input id="mphSearch" type="search" placeholder="Search stocks…" autocomplete="off" aria-label="Search stocks"><div class="mph-results" id="mphResults" hidden></div></div>' +
          '<button class="mph-ico mph-search-btn" id="mphSearchBtn" type="button" aria-label="Search stocks">' + svg('search', 18) + '</button>' +
          acct +
          '<button class="mph-ico" id="mphTheme" type="button"></button>' +
        '</div>' +
      '</div>';
    var slot = document.getElementById('mpHeader');
    if (slot) slot.replaceWith(header); else document.body.insertBefore(header, document.body.firstChild);

    var sheet = document.createElement('div');
    sheet.className = 'mph-sheet'; sheet.id = 'mphSheet'; sheet.hidden = true;
    sheet.innerHTML = '<div class="mph-sheet-scrim"></div><div class="mph-sheet-panel" role="navigation" aria-label="Menu"><a class="mph-brand" href="/" target="_self"><i></i>MarketPulse</a>' + navHtml + '</div>';
    document.body.appendChild(sheet);

    // Small footer with the legal links (Home has its own footer and doesn't use this header).
    if (!document.querySelector('.mph-foot')) {
      var foot = document.createElement('footer');
      foot.className = 'mph-foot';
      foot.innerHTML = '<a href="/privacy.html" target="_self">Privacy Policy</a><span>·</span><a href="/terms.html" target="_self">Terms of Use</a><span>·</span><a href="/#contact" target="_self">Contact</a>' +
        '<p>MarketPulse is for information and education only. It is not investment advice, and signals are paper trading only.</p>';
      document.body.appendChild(foot);
    }

    var tabs = [['Home', '/', 'home', NAV[0][2]], ['Markets', '/#mpHeatmap', 'markets', null], ['News', '/#marketNews', 'news', null],
      ['Analysis', '/stock-analysis.html', 'analysis', NAV[2][2]], ['Portfolio', '/portfolio.html', 'portfolio', NAV[4][2]]];
    var bar = document.createElement('div');
    bar.className = 'mph-tabbar'; bar.setAttribute('role', 'navigation'); bar.setAttribute('aria-label', 'Quick navigation');
    bar.innerHTML = tabs.map(function (t) { return '<a href="' + t[1] + '" target="_self"' + (t[3] && t[3](path) ? ' aria-current="page"' : '') + '>' + svg(t[2]) + t[0] + '</a>'; }).join('');
    document.body.appendChild(bar);
    document.body.classList.add('mph-has-tabbar');

    applyTheme(storedTheme());
    wire(header, sheet);
  }

  function wire(header, sheet) {
    document.getElementById('mphTheme').addEventListener('click', function () {
      var t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
      applyTheme(t);
      window.dispatchEvent(new CustomEvent('mp:theme', { detail: t }));
    });
    var menuBtn = document.getElementById('mphMenu');
    function setSheet(open) { sheet.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); }
    menuBtn.addEventListener('click', function () { setSheet(sheet.hidden); });
    sheet.querySelector('.mph-sheet-scrim').addEventListener('click', function () { setSheet(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setSheet(false); closeResults(); var m = document.getElementById('mphAcctMenu'); if (m) m.hidden = true; } });

    var acct = document.getElementById('mphAcct');
    if (acct) {
      var menu = document.getElementById('mphAcctMenu');
      acct.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; acct.setAttribute('aria-expanded', String(!menu.hidden)); });
      document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; acct.setAttribute('aria-expanded', 'false'); } });
      document.getElementById('mphLogout').addEventListener('click', function () {
        var done = function () { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} location.href = '/'; };
        try {
          if (window.supabase && window.supabase.createClient) window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY).auth.signOut().then(done, done);
          else done();
        } catch (e) { done(); }
      });
    }

    // Stock search → Stock Analysis page.
    var input = document.getElementById('mphSearch'), results = document.getElementById('mphResults');
    var searchBtn = document.getElementById('mphSearchBtn');
    var timer = null, items = [], idx = -1, client = null;
    function closeResults() { results.hidden = true; idx = -1; }
    searchBtn.addEventListener('click', function () { header.classList.toggle('mph-search-open'); if (header.classList.contains('mph-search-open')) input.focus(); else closeResults(); });
    function go(sym) { location.href = '/stock-analysis.html?symbol=' + encodeURIComponent(sym); }
    function draw() {
      results.innerHTML = items.length ? items.map(function (s, i) { return '<a href="/stock-analysis.html?symbol=' + encodeURIComponent(s.symbol) + '" target="_self"' + (i === idx ? ' class="on"' : '') + '><b>' + esc(s.symbol) + '</b><small>' + esc(s.company_name || s.name || '') + '</small></a>'; }).join('') : '<div class="mph-empty">No matching stocks</div>';
      results.hidden = false;
    }
    function ensureSearch(cb) {
      if (window.mpSearchStocks) return cb();
      var s = document.createElement('script'); s.src = '/stock-search.js'; s.onload = cb; s.onerror = cb; document.head.appendChild(s);
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { closeResults(); return; }
      timer = setTimeout(function () {
        ensureSearch(function () {
          if (!window.mpSearchStocks) return;
          if (!client && window.supabase && window.supabase.createClient) { try { client = window.__mpSearchClient || (window.__mpSearchClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)); } catch (e) {} }
          window.mpSearchStocks(q, { url: SEARCH_API, client: client, limit: 8 }).then(function (list) {
            if (input.value.trim() !== q) return;
            items = list.slice(0, 8); idx = -1; draw();
          }).catch(function () { items = []; draw(); });
        });
      }, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); idx = (idx + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); var q = input.value.trim(); if (idx >= 0 && items[idx]) go(items[idx].symbol); else if (items[0]) go(items[0].symbol); else if (q) go(q.toUpperCase()); }
    });
    document.addEventListener('click', function (e) { if (!header.contains(e.target)) closeResults(); });
  }

  // Other tabs changing the theme keep this one in sync.
  window.addEventListener('storage', function (e) { if (e.key === THEME_KEY) applyTheme(storedTheme()); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
  window.MPHeader = { applyTheme: applyTheme };
  // Outside links open in an in-site viewer or the same tab, never a new tab (/link-viewer.js).
  if (!document.querySelector('script[src*="link-viewer.js"]')) {
    var lv = document.createElement('script'); lv.src = '/link-viewer.js?v=1'; lv.defer = true; document.head.appendChild(lv);
  }
  // Any element with data-sym="SYMBOL" (a company name or symbol) opens that stock's analysis.
  // Capture phase, so it wins over a row or card click handler around the name.
  window.mpStockUrl = function (sym) { return '/stock-analysis.html?symbol=' + encodeURIComponent(String(sym).trim().toUpperCase()); };
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-sym]');
    if (!el || !el.getAttribute('data-sym') || e.defaultPrevented) return;
    e.preventDefault(); e.stopPropagation();
    location.href = window.mpStockUrl(el.getAttribute('data-sym'));
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('[data-sym]:not(a)')) e.target.click();
  });
  // Blog articles (/blog/<category>/<post>/) get a "Listen" button that reads the article aloud.
  if (/^\/blog\/[^/]+\/[^/]+/.test(location.pathname) && !document.querySelector('script[src*="read-aloud.js"]')) {
    var ra = document.createElement('script'); ra.src = '/blog/read-aloud.js?v=1'; ra.defer = true; document.head.appendChild(ra);
  }
})();
