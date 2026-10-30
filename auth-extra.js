/* Extra sign-in options in the Home login window: "Continue with Google" and phone number + SMS code.
   Each option only appears once it is switched on in Supabase (Authentication -> Providers), which the
   page checks from the project's public /auth/v1/settings, so nothing half-works before setup.
   Accounts made this way get the same profile and portfolio as email accounts (database triggers). */
(function () {
  if (typeof supabaseClient === 'undefined' || typeof SUPABASE_URL === 'undefined') return;
  const modal = document.getElementById('authModal');
  const body = modal && modal.querySelector('.modal-body');
  if (!body) return;
  const statusEl = document.getElementById('authStatus');
  const say = (msg, kind) => { if (typeof setAuthStatus === 'function') setAuthStatus(msg, kind); else if (statusEl) statusEl.textContent = msg; };

  async function providers() {
    try {
      const cached = JSON.parse(sessionStorage.getItem('mp-auth-providers') || 'null');
      if (cached && Date.now() - cached.at < 10 * 60e3) return cached.p;
    } catch (_) {}
    const r = await fetch(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    const d = await r.json();
    const p = { google: !!d?.external?.google, phone: !!d?.external?.phone };
    try { sessionStorage.setItem('mp-auth-providers', JSON.stringify({ at: Date.now(), p })); } catch (_) {}
    return p;
  }

  const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  const css = document.createElement('style');
  css.textContent =
    '.auth-alt{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}' +
    '.auth-alt[hidden],.auth-phone[hidden],.auth-phone [hidden]{display:none!important}' +
    '.auth-alt-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:44px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}' +
    '.auth-alt-btn:hover{border-color:var(--indigo-light,#818cf8)}' +
    '.auth-or{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em}' +
    '.auth-or::before,.auth-or::after{content:"";flex:1;height:1px;background:var(--border)}' +
    '.auth-phone{display:flex;flex-direction:column;gap:10px;margin-bottom:14px}' +
    '.auth-phone-row{display:flex;gap:8px}' +
    '.auth-phone-row span{flex:0 0 auto;display:flex;align-items:center;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-weight:700}' +
    '.auth-phone input{flex:1;min-width:0}' +
    '.auth-phone .hint{font-size:11.5px;color:var(--text-muted)}' +
    '.auth-link{background:none;border:0;padding:0;color:var(--indigo-light,#818cf8);font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;align-self:flex-start}';
  document.head.appendChild(css);

  const alt = document.createElement('div');
  alt.className = 'auth-alt';
  alt.hidden = true;
  alt.innerHTML =
    '<button type="button" class="auth-alt-btn" id="authGoogle" hidden>' + GOOGLE_ICON + '<span>Continue with Google</span></button>' +
    '<button type="button" class="auth-alt-btn" id="authPhoneOpen" hidden><span aria-hidden="true">📱</span><span>Continue with phone number</span></button>' +
    '<div class="auth-or">or use email</div>';
  const phone = document.createElement('form');
  phone.className = 'auth-phone';
  phone.hidden = true;
  phone.noValidate = true;
  phone.innerHTML =
    '<div class="modal-field"><label for="authPhoneNum">Mobile number</label><div class="auth-phone-row"><span>+91</span><input id="authPhoneNum" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="16" placeholder="10-digit mobile number"></div></div>' +
    '<div class="modal-field" id="authOtpField" hidden><label for="authOtp">6-digit code from SMS</label><input id="authOtp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></div>' +
    '<button class="auth-submit" id="authPhoneSubmit" type="submit">Send code</button>' +
    '<span class="hint" id="authPhoneHint">We will text you a one-time code. New numbers get an account automatically.</span>' +
    '<button type="button" class="auth-link" id="authPhoneBack">← Back to email login</button>';
  body.prepend(phone);
  body.prepend(alt);

  const forms = () => body.querySelectorAll('.auth-form');
  const tabs = modal.querySelector('.auth-tabs');
  function showPhone(on) {
    phone.hidden = !on;
    alt.hidden = on;
    if (tabs) tabs.style.display = on ? 'none' : '';
    forms().forEach((f) => { f.style.display = on ? 'none' : ''; });
    say('', '');
    if (on) setTimeout(() => document.getElementById('authPhoneNum').focus(), 50);
  }

  let sentTo = null, resendAt = 0;
  const num = () => document.getElementById('authPhoneNum').value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const submitBtn = () => document.getElementById('authPhoneSubmit');
  phone.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = submitBtn();
    if (!sentTo) {
      const n = num();
      if (!/^[6-9]\d{9}$/.test(n)) return say('Enter a valid 10-digit Indian mobile number.', 'error');
      btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await supabaseClient.auth.signInWithOtp({ phone: '+91' + n });
      btn.disabled = false;
      if (error) { btn.textContent = 'Send code'; return say(error.message || 'Could not send the code.', 'error'); }
      sentTo = '+91' + n; resendAt = Date.now() + 60e3;
      document.getElementById('authOtpField').hidden = false;
      document.getElementById('authPhoneNum').readOnly = true;
      btn.textContent = 'Verify and sign in';
      document.getElementById('authPhoneHint').textContent = 'Code sent to ' + sentTo + '. It can take up to a minute.';
      say('', '');
      document.getElementById('authOtp').focus();
      return;
    }
    const code = document.getElementById('authOtp').value.replace(/\D/g, '');
    if (code.length !== 6) return say('Enter the 6-digit code from the SMS.', 'error');
    btn.disabled = true; btn.textContent = 'Verifying…';
    const { error } = await supabaseClient.auth.verifyOtp({ phone: sentTo, token: code, type: 'sms' });
    btn.disabled = false; btn.textContent = 'Verify and sign in';
    if (error) return say(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Check it, or go back and request a new one.' : error.message, 'error');
    say('Signed in.', 'success');
    reset();
    setTimeout(() => { if (typeof closeAuthModal === 'function') closeAuthModal(); }, 500);
  });
  function reset() {
    sentTo = null;
    const n = document.getElementById('authPhoneNum'); n.readOnly = false; n.value = '';
    document.getElementById('authOtp').value = '';
    document.getElementById('authOtpField').hidden = true;
    submitBtn().textContent = 'Send code';
    document.getElementById('authPhoneHint').textContent = 'We will text you a one-time code. New numbers get an account automatically.';
  }
  document.getElementById('authPhoneOpen').addEventListener('click', () => showPhone(true));
  document.getElementById('authPhoneBack').addEventListener('click', () => {
    if (sentTo && Date.now() < resendAt) { /* keep the number so a resend waits for the cool-down */ }
    reset(); showPhone(false);
  });
  document.getElementById('authGoogle').addEventListener('click', async () => {
    say('Opening Google…', '');
    // Back to the page the person started from; Supabase must list this site under Redirect URLs.
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) say(error.message || 'Could not start Google sign-in.', 'error');
  });
  // Close as soon as Supabase reports the sign-in (verifyOtp itself can wait on the page's other auth handlers).
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' && sentTo && !phone.hidden) {
      say('Signed in.', 'success');
      setTimeout(() => { reset(); showPhone(false); if (typeof closeAuthModal === 'function') closeAuthModal(); }, 400);
    }
  });
  // Closing the window always returns it to the normal email view.
  new MutationObserver(() => { if (modal.getAttribute('aria-hidden') === 'true' && !phone.hidden) { reset(); showPhone(false); } })
    .observe(modal, { attributes: true, attributeFilter: ['aria-hidden'] });

  providers().then((p) => {
    document.getElementById('authGoogle').hidden = !p.google;
    document.getElementById('authPhoneOpen').hidden = !p.phone;
    alt.hidden = !(p.google || p.phone);
  }).catch(() => {});
})();
