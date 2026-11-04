/* White-label branding for every page. Load first in <head>:  <script src="/brand.js"></script>
   With no brand chosen it does nothing and the site stays MarketPulse.

   How a brand is chosen (first match wins):
     1. ?wl=<code>      a demo brand made in /brand-studio.html (the whole config travels in the link).
                        Kept in this browser while browsing and always shown with a "Demo" pill,
                        so a link can't pass the site off as a real firm.
     2. ?brand=<slug>   a brand registered in BRANDS below (?brand=reset goes back to MarketPulse).
     3. the hostname    a BRANDS entry whose hosts list this domain (a client's own deployment).
     4. the last ?brand= choice in this browser, or the last ?wl= demo in this tab.
   Brand Studio itself (/brand-studio.html) always shows as MarketPulse.

   What a brand changes: the name everywhere on the page (text, titles, tooltips, meta tags), the logo
   and favicon, the main colours, which sections are shown, and, for a SEBI-registered firm, the
   registration details and the regulator's standard disclosures in a footer on every page.
   Scripts that draw the brand themselves (the picks image and PDF) read window.MP_BRAND. */
(function () {
  'use strict';
  var BASE = 'MarketPulse';

  // Brands deployed for clients. Fields as in DEFAULT below; hosts: domains that load it automatically.
  var BRANDS = {
    // 'acme': { hosts: ['research.acme.in'], name: 'Acme Research', short: 'AR', primary: '#0b3d2e', accent: '#12a37a', mark: '#f4c542',
    //           legal: { entity: 'Acme Research Pvt Ltd', regType: 'Research Analyst', regNo: 'INH000000000', ... } },
  };

  // The fields a brand can set. Everything is optional except name.
  var DEFAULT = {
    name: BASE, short: 'MP', tagline: '', logo: '',
    primary: '#2e1f82', accent: '#4f46e5', mark: '#f5a623',
    site: '', email: '', phone: '', address: '',
    legal: { entity: '', regType: '', regNo: '', enlistment: '', grievanceName: '', grievanceEmail: '', extra: '' },
    hide: [], poweredBy: false,
  };
  // Sections that can be hidden: key -> link target fragment and page path prefix.
  var SECTIONS = {
    signals: ['stock-signals', '/stock-signals'], picks: ['picks.html', '/picks'], analysis: ['stock-analysis', '/stock-analysis'],
    screener: ['screener.html', '/screener'], fno: ['fno.html', '/fno'], portfolio: ['portfolio.html', '/portfolio'],
    money: ['money.html', '/money'], ipo: ['ipo.html', '/ipo'], events: ['events.html', '/events'],
    crypto: ['crypto-signals', '/crypto-signals'], blog: ['/blog', '/blog'], ticker: ['my-ticker', '/my-ticker'],
  };

  /* ───────── reading and checking a config ───────── */
  var HEX = /^#[0-9a-f]{6}$/i;
  function str(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : ''; }
  function clean(c) {
    if (!c || typeof c !== 'object') return null;
    var name = str(c.name, 40);
    if (!name) return null;
    var lg = c.legal || {};
    var logo = str(c.logo, 300000);
    if (logo && !/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(logo) && !/^https:\/\/[^\s"'()<>]+$/i.test(logo)) logo = '';
    var short = str(c.short, 3).replace(/[^A-Za-z0-9&]/g, '') || name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || name[0];
    return {
      name: name, short: short, tagline: str(c.tagline, 80), logo: logo,
      primary: HEX.test(c.primary) ? c.primary : DEFAULT.primary,
      accent: HEX.test(c.accent) ? c.accent : DEFAULT.accent,
      mark: HEX.test(c.mark) ? c.mark : DEFAULT.mark,
      site: str(c.site, 60), email: str(c.email, 80), phone: str(c.phone, 30), address: str(c.address, 200),
      legal: {
        entity: str(lg.entity, 80), regType: str(lg.regType, 40), regNo: str(lg.regNo, 30), enlistment: str(lg.enlistment, 30),
        grievanceName: str(lg.grievanceName, 60), grievanceEmail: str(lg.grievanceEmail, 80), extra: str(lg.extra, 600),
      },
      hide: Array.isArray(c.hide) ? c.hide.filter(function (k) { return SECTIONS[k]; }) : [],
      poweredBy: c.poweredBy === true,
    };
  }
  function decode(code) {
    try {
      var b = atob(String(code).replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  function encode(cfg) {
    var bytes = new TextEncoder().encode(JSON.stringify(cfg)), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // A registered brand is remembered in this browser; a demo brand only for this tab (sessionStorage),
  // so a preview never sticks to someone's normal browsing.
  function area(k) { return k === 'mp-brand-demo' ? sessionStorage : localStorage; }
  function store(k, v) { try { if (v === null) area(k).removeItem(k); else area(k).setItem(k, v); } catch (e) {} }
  function load(k) { try { return area(k).getItem(k); } catch (e) { return null; } }

  function resolve() {
    var q = new URLSearchParams(location.search), b;
    if (q.get('wl')) {
      b = clean(decode(q.get('wl')));
      if (b) { store('mp-brand-demo', JSON.stringify(b)); store('mp-brand', null); return { brand: b, demo: true }; }
    }
    var slug = (q.get('brand') || '').toLowerCase();
    if (slug === 'reset' || slug === BASE.toLowerCase()) { store('mp-brand-demo', null); store('mp-brand', null); return null; }
    if (slug && BRANDS[slug]) { store('mp-brand', slug); store('mp-brand-demo', null); return { brand: clean(BRANDS[slug]), demo: false, slug: slug }; }
    for (var k in BRANDS) if ((BRANDS[k].hosts || []).indexOf(location.hostname) >= 0) return { brand: clean(BRANDS[k]), demo: false, slug: k };
    var s = load('mp-brand'); if (s && BRANDS[s]) return { brand: clean(BRANDS[s]), demo: false, slug: s };
    var d = load('mp-brand-demo'); if (d) { try { b = clean(JSON.parse(d)); if (b) return { brand: b, demo: true }; } catch (e) {} }
    return null;
  }

  var hit = location.pathname.indexOf('/brand-studio') === 0 ? null : resolve();
  var B = hit && hit.brand;
  // Shared with other scripts (picks image/PDF, Brand Studio). MP_BRAND is null for the default brand.
  window.MP_BRAND = B || null;
  window.MP_BRAND_DEMO = !!(hit && hit.demo);
  window.mpBrand = { encode: encode, decode: decode, clean: clean, DEFAULT: DEFAULT, SECTIONS: SECTIONS, BRANDS: BRANDS };

  /* ───────── which client's users this site serves (supabase/tenants.sql) ─────────
     A registered brand's slug, "demo" for demo links, else "marketpulse". Every Supabase call carries it
     (header x-mp-tenant) and the database only lets a user's own data through when it matches the
     tenant in their login. Here: sign-ups are tagged with it, a Google / phone account's first sign-in
     claims it, and an account from another site is signed out with a short explanation. */
  var TENANT = hit ? (hit.demo ? 'demo' : hit.slug) : 'marketpulse';
  window.MP_TENANT = TENANT;
  var SITE_NAME = B ? B.name : BASE;
  var CFG = window.MP_CONFIG || {};
  var tenantOf = function (user) { return user && user.app_metadata && user.app_metadata.tenant || ''; };
  var noticeShown = false;
  // The message survives one page change (pages that need a login send a signed-out visitor to Home).
  function tenantNotice() {
    if (noticeShown) return; noticeShown = true;
    try { sessionStorage.setItem('mp-tenant-notice', '1'); } catch (e) {}
    var clear = function () { try { sessionStorage.removeItem('mp-tenant-notice'); } catch (e) {} };
    var show = function () {
      var n = document.createElement('div');
      n.setAttribute('role', 'alert'); n.setAttribute('data-mpb', '1');
      n.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483001;max-width:min(560px,calc(100% - 32px));background:#1d1606;border:1px solid #e0a92b;color:#ffe6a3;border-radius:12px;padding:12px 40px 12px 14px;font:600 13.5px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4)';
      n.textContent = 'That account belongs to another website, so it has been signed out here. Sign in with an account made on ' + SITE_NAME + ', or create one.';
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close');
      x.style.cssText = 'position:absolute;right:8px;top:8px;border:0;background:none;color:inherit;font-size:16px;cursor:pointer';
      x.onclick = function () { n.remove(); clear(); };
      n.appendChild(x); document.body.appendChild(n);
      setTimeout(clear, 4000); // read by now: don't repeat it on the next page
      setTimeout(function () { if (n.isConnected) n.remove(); }, 12000);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }
  try { if (sessionStorage.getItem('mp-tenant-notice')) tenantNotice(); } catch (e) {}
  // A saved login from another site is dropped before any page script reads it.
  (function () {
    var key = CFG.authStorageKey; if (!key) return;
    try {
      var raw = JSON.parse(localStorage.getItem(key) || 'null'), sess = raw && (raw.currentSession || raw);
      var t = sess && tenantOf(sess.user);
      if (t && t !== TENANT) { localStorage.removeItem(key); tenantNotice(); }
    } catch (e) {}
  })();
  function hookClient(c) {
    if (!c || !c.auth || c.__mpTenant) return c;
    c.__mpTenant = true;
    var signUp = c.auth.signUp && c.auth.signUp.bind(c.auth);
    if (signUp) c.auth.signUp = function (cred) {
      cred = Object.assign({}, cred); cred.options = Object.assign({}, cred.options);
      cred.options.data = Object.assign({}, cred.options.data, { tenant: TENANT });
      return signUp(cred);
    };
    var busy = false;
    c.auth.onAuthStateChange(function (event, session) {
      if (!session || !session.user || busy) return;
      var t = tenantOf(session.user);
      if (t === TENANT) return;
      busy = true;
      // Not awaited inside the callback (supabase-js runs it while holding its auth lock).
      setTimeout(function () {
        var done = function () { busy = false; };
        if (!t) {
          c.rpc('claim_tenant', { p_tenant: TENANT }).then(function (r) {
            if (r && r.data === TENANT) return c.auth.refreshSession().then(done, done);
            if (r && r.error) { done(); return; }   // database not ready: leave the session alone
            return c.auth.signOut().then(function () { tenantNotice(); done(); }, done);
          }, done);
        } else {
          c.auth.signOut().then(function () { tenantNotice(); done(); }, done);
        }
      }, 0);
    });
    return c;
  }
  function wrapLib(lib) {
    if (!lib || typeof lib.createClient !== 'function' || lib.__mpTenant) return lib;
    var orig = lib.createClient;
    try {
      lib.createClient = function (url, key, opts) {
        // The main site sends no header: the database treats a missing one as marketpulse.
        if (TENANT !== 'marketpulse') {
          opts = Object.assign({}, opts);
          opts.global = Object.assign({}, opts.global);
          opts.global.headers = Object.assign({}, opts.global.headers, { 'x-mp-tenant': TENANT });
        }
        return hookClient(orig.call(this, url, key, opts));
      };
      lib.__mpTenant = true;
    } catch (e) {}
    return lib;
  }
  // The supabase library may already be loaded, or arrive later as `var supabase = …` (the UMD build),
  // which assigns through this setter.
  (function () {
    var cur = wrapLib(window.supabase);
    try {
      Object.defineProperty(window, 'supabase', {
        configurable: true, enumerable: true,
        get: function () { return cur; },
        set: function (v) { cur = wrapLib(v); },
      });
    } catch (e) {}
  })();

  if (!B) return;

  /* ───────── colours, logo, favicon (before the page paints) ───────── */
  function mix(hex, other, t) { // blend two #rrggbb colours, t = share of `other`
    var a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
    var r = Math.round((a >> 16) * (1 - t) + (b >> 16) * t), g = Math.round((a >> 8 & 255) * (1 - t) + (b >> 8 & 255) * t), bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function lum(hex) { var n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; }
  var markInk = lum(B.mark) > 0.6 ? B.primary : '#ffffff';
  var cssStr = function (s) { return '"' + String(s).replace(/["\\\n]/g, '') + '"'; };
  var logoCss = B.logo
    ? 'background:url(' + cssStr(B.logo) + ') center/contain no-repeat !important;'
    : 'background:' + B.mark + ' !important;';
  var markCss = 'transform:none !important;border-radius:6px !important;width:24px !important;height:24px !important;' + logoCss +
    'display:inline-grid !important;place-items:center;flex:0 0 auto;box-shadow:none !important;';
  var style = document.createElement('style');
  style.id = 'mpBrandStyle';
  style.textContent =
    'html:root:root:root{--indigo:' + B.primary + ';--indigo-dark:' + mix(B.primary, '#000000', 0.35) + ';--indigo-light:' + mix(B.primary, '#ffffff', 0.25) +
      ';--accent:' + B.accent + ';--accent2:' + mix(B.accent, '#ffffff', 0.3) +
      ';--mp-accent:' + B.accent + ';--mp-accent-2:' + mix(B.accent, '#ffffff', 0.15) +
      ';--mph-accent:' + B.accent + ';--mph-accent2:' + mix(B.accent, '#ffffff', 0.3) + ';--violet:' + B.accent + '}' +
    '.mph-brand i,.topbar-brand .diamond{' + markCss + '}' +
    (B.logo ? '' : '.mph-brand i::after,.topbar-brand .diamond::after{content:' + cssStr(B.short) + ';font:800 ' + (B.short.length > 2 ? 9 : 11) + 'px/1 system-ui,sans-serif;color:' + markInk + ';font-style:normal;letter-spacing:-.02em}') +
    'html.mpb-wait body{visibility:hidden}' +
    B.hide.map(function (k) { return 'a[href*="' + SECTIONS[k][0] + '"],[data-mp-go="' + k + '"]'; }).join(',') + (B.hide.length ? '{display:none !important}' : '') +
    '.mpb-foot{margin:28px auto 0;max-width:1400px;padding:18px 20px calc(18px + env(safe-area-inset-bottom));border-top:1px solid rgba(127,140,170,.25);font:12px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#8a97b2;box-sizing:border-box}' +
    '.mpb-foot b{color:inherit;font-weight:700}.mpb-foot .mpb-name{font-size:13.5px;color:' + B.accent + '}' +
    '.mpb-foot a{color:' + B.accent + ';text-decoration:none}.mpb-foot a:hover{text-decoration:underline}' +
    '.mpb-foot p{margin:6px 0}.mpb-foot .mpb-warn{font-weight:600}.mpb-foot .mpb-demo{color:#e0a92b;font-weight:700}' +
    '@media(max-width:760px){.mpb-foot{padding-bottom:calc(88px + env(safe-area-inset-bottom))}}' +
    '.mpb-pill{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483000;display:flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;border-radius:999px;background:#1d1606;border:1px solid #e0a92b;color:#ffe6a3;font:700 12px/1 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)}' +
    '.mpb-pill a{color:#1d1606;background:#e0a92b;border-radius:999px;padding:5px 9px;text-decoration:none;font-weight:800}' +
    '@media(max-width:760px){.mpb-pill{bottom:calc(76px + env(safe-area-inset-bottom))}}';
  document.head.appendChild(style);
  document.documentElement.classList.add('mpb-wait');
  setTimeout(function () { document.documentElement.classList.remove('mpb-wait'); }, 1500); // never stay hidden

  function favicon() {
    var href = B.logo || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="' + B.primary + '"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="' + (B.short.length > 2 ? 22 : 28) + '" font-weight="800" text-anchor="middle" fill="' + B.mark + '">' + B.short.replace(/&/g, '&amp;') + '</text></svg>');
    var links = document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]');
    if (!links.length) { var l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); links = [l]; }
    Array.prototype.forEach.call(links, function (l) { l.href = href; l.removeAttribute('sizes'); l.removeAttribute('type'); });
  }

  // A hidden section isn't reachable by its address either.
  var path = location.pathname;
  for (var i = 0; i < B.hide.length; i++) if (path.indexOf(SECTIONS[B.hide[i]][1]) === 0) { location.replace('/'); return; }

  /* ───────── the name in text, titles and attributes ───────── */
  var L = B.legal;
  var regLine = L.regNo ? B.name + ' is a SEBI-registered ' + (L.regType || 'Research Analyst') + ' (Reg. No. ' + L.regNo + ')' : '';
  var PHRASES = regLine ? [[/MarketPulse is not a SEBI-registered investment adviser or research analyst/g, regLine]] : [];
  function swap(s) {
    if (!s || s.indexOf(BASE) < 0) return s;
    for (var i = 0; i < PHRASES.length; i++) s = s.replace(PHRASES[i][0], PHRASES[i][1]);
    return s.split(BASE).join(B.name);
  }
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'content', 'data-tip'];
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (root.nodeValue.indexOf(BASE) >= 0) root.nodeValue = swap(root.nodeValue); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (SKIP[root.tagName] || root.isContentEditable) return;
      for (var a = 0; a < ATTRS.length; a++) { var v = root.getAttribute(ATTRS[a]); if (v && v.indexOf(BASE) >= 0) root.setAttribute(ATTRS[a], swap(v)); }
      if (root.textContent.indexOf(BASE) < 0 && !root.querySelector('[title*="' + BASE + '"],[placeholder*="' + BASE + '"],[aria-label*="' + BASE + '"],[alt*="' + BASE + '"]')) return;
    }
    var tw = document.createTreeWalker(root, 5 /* elements + text */, {
      acceptNode: function (n) { return n.nodeType === 1 && (SKIP[n.tagName] || n.isContentEditable) ? 2 : 1; },
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) { if (n.nodeValue.indexOf(BASE) >= 0) n.nodeValue = swap(n.nodeValue); }
      else for (var j = 0; j < ATTRS.length; j++) { var x = n.getAttribute(ATTRS[j]); if (x && x.indexOf(BASE) >= 0) n.setAttribute(ATTRS[j], swap(x)); }
    }
  }
  function head() {
    if (document.title.indexOf(BASE) >= 0) document.title = swap(document.title);
    Array.prototype.forEach.call(document.querySelectorAll('meta[content]'), function (m) { var c = m.getAttribute('content'); if (c.indexOf(BASE) >= 0) m.setAttribute('content', swap(c)); });
  }

  /* ───────── registration footer and demo pill ───────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function footer() {
    if (document.getElementById('mpbFoot')) return;
    var who = L.entity || B.name, bits = [];
    if (L.regNo) bits.push('SEBI Registered ' + esc(L.regType || 'Research Analyst') + ' · Reg. No. <b>' + esc(L.regNo) + '</b>');
    if (L.enlistment) bits.push('BSE Enlistment No. ' + esc(L.enlistment));
    var contact = [];
    if (B.address) contact.push(esc(B.address));
    if (B.email) contact.push('<a href="mailto:' + esc(B.email) + '">' + esc(B.email) + '</a>');
    if (B.phone) contact.push(esc(B.phone));
    var html =
      (window.MP_BRAND_DEMO ? '<p class="mpb-demo">White-label demo: the name, logo and registration details below were entered in Brand Studio for a preview and have not been verified.</p>' : '') +
      '<p><span class="mpb-name"><b>' + esc(who) + '</b></span>' + (bits.length ? ' · ' + bits.join(' · ') : '') + '</p>' +
      (contact.length ? '<p>' + contact.join(' · ') + '</p>' : '') +
      (L.grievanceName || L.grievanceEmail ? '<p>Grievance officer: ' + esc(L.grievanceName) + (L.grievanceEmail ? ' · <a href="mailto:' + esc(L.grievanceEmail) + '">' + esc(L.grievanceEmail) + '</a>' : '') +
        ' · Unresolved complaints: <a href="https://scores.sebi.gov.in" target="_blank" rel="noopener">SEBI SCORES</a> · <a href="https://smartodr.in" target="_blank" rel="noopener">SMART ODR</a></p>' : '') +
      (L.regNo ? '<p>Registration granted by SEBI, enlistment with the exchange and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.</p>' : '') +
      '<p class="mpb-warn">Investment in securities market are subject to market risks. Read all the related documents carefully before investing.</p>' +
      (L.extra ? '<p>' + esc(L.extra) + '</p>' : '') +
      (B.poweredBy ? '<p>Platform by ' + BASE + '</p>' : '');
    var f = document.createElement('div');
    f.className = 'mpb-foot'; f.id = 'mpbFoot'; f.setAttribute('role', 'contentinfo'); f.setAttribute('data-mpb', '1');
    f.innerHTML = html;
    document.body.appendChild(f);
  }
  function pill() {
    if (!window.MP_BRAND_DEMO || document.getElementById('mpbPill')) return;
    var p = document.createElement('div');
    p.className = 'mpb-pill'; p.id = 'mpbPill'; p.setAttribute('data-mpb', '1');
    p.innerHTML = '<span>Demo · ' + esc(B.name) + '</span><a href="' + esc(location.pathname) + '?brand=reset">Exit</a>';
    document.body.appendChild(p);
  }

  function start() {
    head(); favicon(); walk(document.body); footer(); pill();
    document.documentElement.classList.remove('mpb-wait');
    // Pages render most of their content later (data loads, re-renders): rename whatever is added.
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') { if (m.target.nodeValue.indexOf(BASE) >= 0) m.target.nodeValue = swap(m.target.nodeValue); }
        else if (m.type === 'attributes') { var v = m.target.getAttribute(m.attributeName); if (v && v.indexOf(BASE) >= 0) m.target.setAttribute(m.attributeName, swap(v)); }
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
      if (document.title.indexOf(BASE) >= 0) document.title = swap(document.title);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  head(); favicon();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
