/* Sample data for white-label demos.
   On a demo (a Brand Studio ?wl= link whose brand doesn't turn it off) or with ?sample=1, the site's data
   requests to Supabase and the Cloudflare Worker are answered from a saved snapshot of real responses in
   /sample/ instead of the live feeds, so a prospect always sees a full, working site and their browsing
   never reaches NSE / Yahoo through our accounts. A request with no saved answer goes to the live service
   as usual (sign-in and a user's own data always do). ?sample=0 turns it off for the tab.

   The snapshot is recorded by scripts/demo/record.mjs (GitHub Action "Demo sample data", weekly and on
   demand), which loads every page in a real browser and saves each response under the key below.
   Loaded on every page right after brand.js. Also imported by the recorder (no window), for mpSampleKey. */
(function (root) {
  'use strict';
  // Cache-buster parameters don't change the answer, so they're left out of the key.
  var VOLATILE = { t: 1, _: 1, ts: 1, cb: 1, nocache: 1, _t: 1, rand: 1 };
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  // "METHOD host/path?sorted&params body" for one request.
  function key(method, url, body) {
    var u = new URL(url, 'https://x.invalid');
    var ps = [];
    u.searchParams.forEach(function (v, k) { if (!VOLATILE[k] && !/^\d{10,}$/.test(v)) ps.push([k, v]); });
    ps.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    var b = body == null ? '' : String(body);
    if (b) { try { b = stable(JSON.parse(b)); } catch (e) {} }
    return String(method || 'GET').toUpperCase() + ' ' + u.host + u.pathname + (ps.length ? '?' + ps.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&') : '') + (b ? ' ' + b : '');
  }
  // Two FNV-1a passes → 16 hex characters: the snapshot file name for a key.
  function hash(s) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= c; h2 = Math.imul(h2, 0x0100019d) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }
  root.mpSampleKey = function (method, url, body) { var k = key(method, url, body); return { key: k, id: hash(k) }; };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* ───────── in the browser ───────── */
  var CFG = window.MP_CONFIG || {};
  var q = null; try { q = new URLSearchParams(location.search).get('sample'); } catch (e) {}
  try { if (q === '1') sessionStorage.setItem('mp-sample', '1'); else if (q === '0') sessionStorage.setItem('mp-sample', '0'); } catch (e) {}
  var pref = null; try { pref = sessionStorage.getItem('mp-sample'); } catch (e) {}
  var B = window.MP_BRAND;
  var on = pref === '1' || (pref !== '0' && !!window.MP_BRAND_DEMO && !!B && B.sample !== false);
  window.MP_SAMPLE = on;
  if (!on || !window.fetch) return;

  var hosts = [];
  try { hosts.push(new URL(CFG.supabaseUrl).host); } catch (e) {}
  if (CFG.apiHost) hosts.push(CFG.apiHost);
  var orig = window.fetch.bind(window);
  // index.json: { recorded_at, files: { id: 1, ... } }
  var manifest = orig('/sample/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  window.MP_SAMPLE_INFO = manifest;
  var hits = 0, misses = 0;

  window.fetch = function (input, init) {
    var url, method, body;
    try {
      url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      method = (init && init.method) || (input && input.method) || 'GET';
      body = init && typeof init.body === 'string' ? init.body : '';
      var u = new URL(url, location.href);
      if (hosts.indexOf(u.host) < 0 || /^\/auth\//.test(u.pathname)) return orig(input, init);
    } catch (e) { return orig(input, init); }
    var k = root.mpSampleKey(method, url, body);
    return manifest.then(function (m) {
      if (!m || !m.files || !m.files[k.id]) { misses++; return orig(input, init); }
      return orig('/sample/' + k.id + '.json').then(function (r) {
        if (!r.ok) return orig(input, init);
        return r.json().then(function (rec) {
          hits++;
          var h = { 'Content-Type': rec.type || 'application/json', 'X-MP-Sample': '1' };
          if (rec.range) h['Content-Range'] = rec.range;
          return new Response(rec.status === 204 ? null : rec.body, { status: rec.status || 200, headers: h });
        });
      }).catch(function () { return orig(input, init); });
    });
  };
  window.mpSampleStats = function () { return { hits: hits, misses: misses }; };
})(typeof window !== 'undefined' ? window : globalThis);
