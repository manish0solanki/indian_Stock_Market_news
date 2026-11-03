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
  };
  // Derived values (don't edit).
  C.ref = C.supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
  C.authStorageKey = 'sb-' + C.ref + '-auth-token'; // where supabase-js keeps the login session
  C.apiHost = C.apiBase.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  C.fn = function (name) { return C.supabaseUrl + '/functions/v1/' + name; };
  root.MP_CONFIG = Object.freeze(C);
})(typeof window !== 'undefined' ? window : globalThis);
