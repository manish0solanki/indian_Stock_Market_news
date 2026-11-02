/* Money (money.html): a private personal finance manager. Data lives in Supabase tables pf_* (supabase/money.sql),
   each protected by row level security so a user only ever reads and writes their own rows.
   Month view: income, planned vs actual per category (with a pace marker), quick add, bills & EMIs, major expenses
   and goals, a donut of where the money went, a 6-month trend and the transaction list. */
(function () {
  const SUPABASE_URL = 'https://fzazdrzlemmkqngvpzxj.supabase.co';
  const KEY = 'sb_publishable_PXXly0ZAeBTmXXG7KbPYoA_RB8HqVZq';
  const sb = window.supabase.createClient(SUPABASE_URL, KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? 0 : +v);
  const inr = (v) => '₹' + Math.round(num(v)).toLocaleString('en-IN');
  const inrS = (v) => { v = num(v); const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e7 ? s + '₹' + (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + ' Cr' : a >= 1e5 ? s + '₹' + (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + ' L' : a >= 1e3 ? s + '₹' + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : s + '₹' + Math.round(a); };
  const pctS = (v) => Math.round(v) + '%';
  // Categorical palette (dark / light), in fixed order: a category's colour follows its position in the list.
  const PAL = { dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'], light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] };
  const OTHER = '#6b7280';
  const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
  const DEFAULT_CATS = [
    ['Housing & Rent', '🏠'], ['Groceries', '🛒'], ['Food & Dining', '🍽️'], ['Transport & Fuel', '🚗'], ['Bills & Utilities', '💡'],
    ['Shopping', '🛍️'], ['EMIs & Loans', '💳'], ['Health & Insurance', '🏥'], ['Education', '🎓'], ['Entertainment', '🎬'],
    ['Travel', '✈️'], ['Gifts & Festivals', '🎁'], ['Investments & SIP', '📈', 'saving'], ['Other', '🧾'],
  ];
  const EMOJIS = ['🏠', '🛒', '🍽️', '🚗', '⛽', '💡', '📱', '🌐', '🛍️', '👕', '💳', '🏥', '💊', '🎓', '📚', '🎬', '🎮', '✈️', '🏖️', '🎁', '🪔', '💍', '👶', '🐶', '🏋️', '💇', '🧹', '🔧', '🚌', '🚕', '📈', '🏦', '🛡️', '🧾', '☕', '🍕', '💻', '🚙', '🏍️', '🎯'];

  const S = { user: null, month: null, cats: [], budgets: {}, income: 0, txns: [], bills: [], goals: [], majors: [], trend: null, txQ: '', txCat: '', editTx: null };

  /* ───────── dates (IST) ───────── */
  const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const monthOf = (d) => d.slice(0, 7) + '-01';
  function addMonths(m, n) { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 10); }
  const monthEnd = (m) => { const d = new Date(addMonths(m, 1) + 'T00:00:00Z'); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const daysIn = (m) => +monthEnd(m).slice(8, 10);
  const mLabel = (m, short) => new Date(m + 'T00:00:00Z').toLocaleDateString('en-IN', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric', timeZone: 'UTC' });
  const dLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dShort = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  // share of the month gone: 1 for past months, 0 for future ones
  function pace() {
    const t = todayIST(), cur = monthOf(t);
    if (S.month < cur) return 1;
    if (S.month > cur) return 0;
    return +t.slice(8, 10) / daysIn(S.month);
  }
  const isCurrent = () => S.month === monthOf(todayIST());

  /* ───────── ui helpers ───────── */
  let toastT;
  function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2600); }
  function openSheet(html) { $('sbox').innerHTML = html; $('sheet').hidden = false; const f = $('sbox').querySelector('input,select,button'); if (f) setTimeout(() => f.focus(), 30); }
  function closeSheet() { $('sheet').hidden = true; $('sbox').innerHTML = ''; }
  const catById = (id) => S.cats.find((c) => c.id === id);
  const visibleCats = () => S.cats.filter((c) => !c.archived);
  function colorOf(cat) {
    const i = visibleCats().indexOf(cat);
    return i >= 0 && i < 8 ? PAL[isLight() ? 'light' : 'dark'][i] : OTHER;
  }
  const amt = (s) => { const v = +String(s).replace(/[^\d.]/g, ''); return isFinite(v) ? v : 0; };
  async function run(p, okMsg) {
    const { error } = await p;
    if (error) { toast(error.message || 'Something went wrong', true); return false; }
    if (okMsg) toast(okMsg);
    return true;
  }

  /* ───────── data ───────── */
  async function ensureCats() {
    const { data, error } = await sb.from('pf_categories').select('*').order('sort').order('created_at');
    if (error) throw error;
    if (data.length) { S.cats = data; return; }
    const rows = DEFAULT_CATS.map(([name, icon, kind], i) => ({ name, icon, kind: kind || 'expense', sort: i }));
    const ins = await sb.from('pf_categories').insert(rows).select('*');
    if (ins.error) throw ins.error;
    S.cats = ins.data.sort((a, b) => a.sort - b.sort);
  }
  async function loadMonth() {
    const m = S.month, end = monthEnd(m), from6 = addMonths(m, -5);
    const yearStart = m.slice(0, 4) + '-01-01';
    const [b, mo, tx, bills, goals, majors, t6, b6, i6] = await Promise.all([
      sb.from('pf_budgets').select('category_id,planned').eq('month', m),
      sb.from('pf_months').select('income').eq('month', m).maybeSingle(),
      sb.from('pf_transactions').select('*').gte('txn_date', m).lte('txn_date', end).order('txn_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('pf_bills').select('*').eq('active', true).order('due_day'),
      sb.from('pf_goals').select('*').neq('status', 'dropped').order('target_date', { ascending: true, nullsFirst: false }),
      sb.from('pf_transactions').select('id,txn_date,amount,category_id,note,goal_id').eq('is_major', true).gte('txn_date', yearStart).order('txn_date', { ascending: false }).limit(60),
      sb.from('pf_transactions').select('txn_date,amount,category_id').gte('txn_date', from6).lte('txn_date', end).limit(5000),
      sb.from('pf_budgets').select('month,planned,category_id').gte('month', from6).lte('month', m),
      sb.from('pf_months').select('month,income').gte('month', from6).lte('month', m),
    ]);
    for (const r of [b, tx, bills, goals, majors, t6, b6, i6]) if (r.error) throw r.error;
    S.budgets = {}; (b.data || []).forEach((x) => { S.budgets[x.category_id] = num(x.planned); });
    S.income = num(mo.data && mo.data.income);
    S.txns = tx.data || []; S.bills = bills.data || []; S.goals = goals.data || []; S.majors = majors.data || [];
    const saving = new Set(S.cats.filter((c) => c.kind === 'saving').map((c) => c.id));
    const months = Array.from({ length: 6 }, (_, i) => addMonths(from6, i));
    S.trend = months.map((mm) => ({
      m: mm,
      planned: (b6.data || []).filter((x) => x.month === mm && !saving.has(x.category_id)).reduce((a, x) => a + num(x.planned), 0),
      actual: (t6.data || []).filter((x) => monthOf(x.txn_date) === mm && !saving.has(x.category_id)).reduce((a, x) => a + num(x.amount), 0),
      income: num(((i6.data || []).find((x) => x.month === mm) || {}).income),
    }));
  }
  async function reload() { try { await loadMonth(); render(); } catch (e) { toast('Could not load: ' + (e.message || e), true); } }

  /* ───────── numbers for the month ───────── */
  function totals() {
    const spentBy = {}; let spent = 0, invested = 0;
    for (const t of S.txns) {
      const c = catById(t.category_id);
      spentBy[t.category_id || 'none'] = (spentBy[t.category_id || 'none'] || 0) + num(t.amount);
      if (c && c.kind === 'saving') invested += num(t.amount); else spent += num(t.amount);
    }
    const planned = visibleCats().filter((c) => c.kind !== 'saving').reduce((a, c) => a + num(S.budgets[c.id]), 0);
    const plannedSave = visibleCats().filter((c) => c.kind === 'saving').reduce((a, c) => a + num(S.budgets[c.id]), 0);
    return { spentBy, spent, invested, planned, plannedSave };
  }

  /* ───────── render ───────── */
  function render() {
    $('monthLbl').textContent = mLabel(S.month);
    $('thisM').hidden = isCurrent();
    const T = totals();
    renderKpis(T); renderInsights(T); renderBudget(T); renderFormCats(); renderDonut(T); renderBills(); renderGoals(); renderTrend(); renderTx();
    if (!$('fDate').value || monthOf($('fDate').value) !== S.month) $('fDate').value = isCurrent() ? todayIST() : (S.month > todayIST() ? S.month : monthEnd(S.month));
  }

  function renderKpis(T) {
    const p = pace(), left = T.planned - T.spent;
    const dLeft = isCurrent() ? daysIn(S.month) - +todayIST().slice(8, 10) + 1 : 0;
    const saved = S.income - T.spent, rate = S.income > 0 ? saved / S.income * 100 : null;
    $('kpis').innerHTML = `
      <div class="kpi hero-k"><span>Income this month</span><div id="incomeBox"><b>${S.income ? inr(S.income) : '—'}</b></div>
        <small>${S.income ? `Plan leaves ${inr(S.income - T.planned - T.plannedSave)} unallocated` : 'Add your income to see your savings'} · <button type="button" class="edit" id="editIncome">${S.income ? 'Edit' : 'Add income'}</button></small></div>
      <div class="kpi"><span>Planned spend</span><b>${inr(T.planned)}</b><small>${T.plannedSave ? inr(T.plannedSave) + ' planned to invest' : 'across ' + visibleCats().filter((c) => S.budgets[c.id]).length + ' categories'}</small></div>
      <div class="kpi"><span>Spent so far</span><b class="${T.planned && T.spent > T.planned ? 'down' : ''}">${inr(T.spent)}</b><small>${T.planned ? pctS(T.spent / T.planned * 100) + ' of plan' : 'no plan yet'}${p > 0 && p < 1 ? ` · ${pctS(p * 100)} of month gone` : ''}</small></div>
      <div class="kpi"><span>${left >= 0 ? 'Left to spend' : 'Over plan'}</span><b class="${left >= 0 ? 'up' : 'down'}">${inr(Math.abs(left))}</b><small>${isCurrent() && left > 0 && dLeft > 0 ? `≈ ${inr(left / dLeft)} a day for ${dLeft} day${dLeft > 1 ? 's' : ''}` : left < 0 ? 'beyond this month\'s plan' : T.planned ? 'of this month\'s plan' : 'set a plan below'}</small></div>
      <div class="kpi"><span>Saved</span><b class="${rate === null ? '' : saved >= 0 ? 'up' : 'down'}">${rate === null ? '—' : inr(saved)}</b><small>${rate === null ? 'needs your income' : pctS(rate) + ' savings rate'}${T.invested ? ' · ' + inr(T.invested) + ' invested' : ''}</small></div>`;
    $('editIncome').onclick = () => {
      $('incomeBox').innerHTML = `<input id="incomeIn" type="text" inputmode="numeric" value="${S.income || ''}" placeholder="e.g. 85000" aria-label="Income this month">`;
      const i = $('incomeIn'); i.focus(); i.select();
      const save = async () => { const v = amt(i.value); if (v === S.income) { renderKpis(totals()); return; } if (await run(sb.from('pf_months').upsert({ month: S.month, income: v, updated_at: new Date().toISOString() }), 'Income saved')) { S.income = v; render(); } };
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = S.income; i.blur(); } });
      i.addEventListener('blur', save, { once: true });
    };
  }

  function renderInsights(T) {
    const out = [], p = pace();
    const cats = visibleCats().filter((c) => c.kind !== 'saving');
    if (!T.planned && !T.spent) out.push(['🧭', 'Start by setting a plan for a few categories below, or copy last month\'s plan. Then add expenses as they happen.', '']);
    const over = cats.filter((c) => S.budgets[c.id] > 0 && (T.spentBy[c.id] || 0) > S.budgets[c.id]).sort((a, b) => ((T.spentBy[b.id] - S.budgets[b.id]) - (T.spentBy[a.id] - S.budgets[a.id])));
    over.slice(0, 2).forEach((c) => out.push(['⛔', `${c.icon} ${esc(c.name)} is ${inr(T.spentBy[c.id] - S.budgets[c.id])} over plan.`, 'bad']));
    if (isCurrent() && p > 0.15 && p < 1 && T.planned) {
      const proj = T.spent / p;
      out.push(proj > T.planned * 1.03 ? ['📈', `At this pace you'll spend about ${inr(proj)} this month, ${inr(proj - T.planned)} over plan.`, 'warnb']
        : ['✅', `On pace: about ${inr(proj)} by month end, within your ${inr(T.planned)} plan.`, 'good']);
      const hot = cats.filter((c) => S.budgets[c.id] > 0 && !over.includes(c) && (T.spentBy[c.id] || 0) / S.budgets[c.id] > Math.min(0.9, p + 0.25)).slice(0, 1);
      hot.forEach((c) => out.push(['⚠️', `${c.icon} ${esc(c.name)} has used ${pctS((T.spentBy[c.id] || 0) / S.budgets[c.id] * 100)} of its plan with ${pctS((1 - p) * 100)} of the month left.`, 'warnb']));
    }
    const unplanned = cats.filter((c) => !S.budgets[c.id] && (T.spentBy[c.id] || 0) > 0);
    if (unplanned.length && T.planned) out.push(['🧾', `${inr(unplanned.reduce((a, c) => a + T.spentBy[c.id], 0))} spent in categories with no plan (${unplanned.slice(0, 3).map((c) => esc(c.name)).join(', ')}).`, 'warnb']);
    if (isCurrent()) {
      const d = +todayIST().slice(8, 10);
      const due = S.bills.filter((b) => !billPaid(b) && b.due_day >= d && b.due_day - d <= 5);
      if (due.length) out.push(['📅', `${due.map((b) => `${esc(b.name)} ${inr(b.amount)}`).slice(0, 2).join(' and ')} due in the next ${Math.max(...due.map((b) => b.due_day - d)) || 0} day${due.length > 1 || Math.max(...due.map((b) => b.due_day - d)) !== 1 ? 's' : ''}.`, 'warnb']);
      const late = S.bills.filter((b) => !billPaid(b) && b.due_day < d);
      if (late.length) out.push(['⏰', `Not marked paid yet: ${late.slice(0, 3).map((b) => esc(b.name)).join(', ')}.`, 'bad']);
    }
    const g = S.goals.filter((x) => x.status === 'planned' && x.target_date).map((x) => [x, goalMonthly(x)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    if (g) out.push(['🎯', `Set aside ${inr(g[1])} a month to cover ${g[0].icon} ${esc(g[0].title)} by ${mLabel(monthOf(g[0].target_date))}.`, '']);
    if (S.income && T.spent && !out.some((x) => x[2] === 'bad')) { const r = (S.income - T.spent) / S.income * 100; if (r >= 30) out.push(['🌱', `You're saving ${pctS(r)} of your income this month. Nice!`, 'good']); }
    $('insights').innerHTML = out.slice(0, 5).map(([i, t, c]) => `<div class="ins ${c}"><i aria-hidden="true">${i}</i><div>${t}</div></div>`).join('');
    $('insights').hidden = !out.length;
  }

  function renderBudget(T) {
    const p = pace();
    const all = visibleCats();
    const used = all.filter((c) => num(S.budgets[c.id]) > 0 || (T.spentBy[c.id] || 0) > 0);
    const empty = all.filter((c) => !used.includes(c));
    const cats = !used.length || S.showEmpty ? all : used;
    let h = '';
    for (const c of cats) {
      const plan = num(S.budgets[c.id]), spent = T.spentBy[c.id] || 0;
      const scale = Math.max(plan, spent) || 1;
      const ratio = plan ? spent / plan : (spent ? 2 : 0);
      const cls = ratio > 1 ? 'over' : (plan && isCurrent() && ratio > p + 0.15 ? 'near' : '');
      const n = S.txns.filter((t) => t.category_id === c.id).length;
      let foot;
      if (!plan && !spent) foot = '<span class="muted">No plan set</span>';
      else if (!plan) foot = `<span class="warn">⚠ Unplanned spend</span>`;
      else if (spent > plan) foot = `<span class="down">⛔ ${inr(spent - plan)} over</span>`;
      else foot = `<span class="${cls === 'near' ? 'warn' : 'up'}">${cls === 'near' ? '⚠ ahead of pace · ' : '✓ '}${inr(plan - spent)} left</span>`;
      h += `<div class="brow">
        <div class="bname" data-filter="${c.id}" title="Show ${esc(c.name)} transactions"><div class="ic" style="--sw:${colorOf(c)}">${esc(c.icon)}</div><div style="min-width:0"><b>${esc(c.name)}${c.kind === 'saving' ? ' <span class="pill major">saving</span>' : ''}</b><small>${n} transaction${n === 1 ? '' : 's'} · <button type="button" class="ecat" data-editcat="${c.id}" aria-label="Edit ${esc(c.name)}">✎ edit</button></small></div></div>
        <label class="plan" title="Planned for ${mLabel(S.month)}"><span>₹</span><input type="text" inputmode="numeric" data-plan="${c.id}" value="${plan ? Math.round(plan) : ''}" placeholder="Plan" aria-label="Plan for ${esc(c.name)}"></label>
        <div class="bbar"><div class="btop"><span>Spent <b>${inr(spent)}</b>${plan ? ` of ${inr(plan)}` : ''}</span>${plan ? `<span class="muted">${pctS(spent / plan * 100)}</span>` : ''}</div>
          <div class="track"><div class="fill ${cls}" style="width:${Math.min(100, spent / scale * 100).toFixed(1)}%"></div>${plan && p > 0 && p < 1 ? `<div class="pace" style="left:${(plan * p / scale * 100).toFixed(1)}%" title="Where spending would be at an even pace"></div>` : ''}</div>
          <div class="bfoot">${foot}</div></div>
      </div>`;
    }
    if (used.length && empty.length) h += `<button type="button" class="btn" id="toggleEmpty" style="margin:8px 2px 2px">${S.showEmpty ? 'Hide categories with no plan' : `＋ Show ${empty.length} more categor${empty.length === 1 ? 'y' : 'ies'} (no plan or spending yet)`}</button>`;
    const uncategorised = T.spentBy.none || 0;
    if (uncategorised) h += `<div class="brow"><div class="bname"><div class="ic">❔</div><div><b>Uncategorised</b></div></div><div></div><div class="bbar"><div class="btop"><span>Spent <b>${inr(uncategorised)}</b></span></div></div></div>`;
    h += `<div class="btotal"><span>Total (spending)</span><span>${inr(T.spent)} <span class="muted" style="font-weight:600">of ${inr(T.planned)}</span></span></div>`;
    h += `<p class="muted" style="font-size:11.5px;margin:6px 2px 0">The thin line on each bar marks where spending would be at an even pace through the month. Tap a category name to see its transactions, or ✎ to rename it.</p>`;
    $('budgetList').innerHTML = h;
  }

  function renderFormCats() {
    const sel = $('fCats').dataset.sel;
    $('fCats').innerHTML = visibleCats().map((c) => `<button type="button" class="cchip${c.id === sel ? ' on' : ''}" data-cat="${c.id}" role="radio" aria-checked="${c.id === sel}">${esc(c.icon)} ${esc(c.name)}</button>`).join('');
  }

  /* donut: spend by category; the first 8 categories keep their colour, the rest fold into "Other" */
  function renderDonut(T) {
    const vc = visibleCats().filter((c) => c.kind !== 'saving');
    const first = vc.filter((c) => visibleCats().indexOf(c) < 8);
    const segs = first.map((c) => ({ label: c.name, icon: c.icon, v: T.spentBy[c.id] || 0, color: colorOf(c), id: c.id })).filter((s) => s.v > 0);
    const rest = vc.filter((c) => !first.includes(c)).reduce((a, c) => a + (T.spentBy[c.id] || 0), 0) + (T.spentBy.none || 0);
    if (rest > 0) segs.push({ label: 'Other', icon: '•', v: rest, color: OTHER });
    const total = segs.reduce((a, s) => a + s.v, 0);
    $('donutSub').textContent = total ? `${inr(total)} spent` : '';
    if (!total) { $('donut').innerHTML = '<div class="empty">No spending recorded for this month yet.</div>'; return; }
    segs.sort((a, b) => b.v - a.v);
    const R = 80, r = 52, cx = 90, cy = 90, gap = segs.length > 1 ? 0.012 : 0;
    let a0 = -Math.PI / 2, paths = '';
    const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    segs.forEach((s, i) => {
      const frac = s.v / total, a1 = a0 + frac * Math.PI * 2;
      const s0 = a0 + gap, s1 = Math.max(s0 + 0.001, a1 - gap), large = s1 - s0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(R, s0), [x1, y1] = pt(R, s1), [x2, y2] = pt(r, s1), [x3, y3] = pt(r, s0);
      const d = frac >= 0.9999 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${cx - r},${cy}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0`
        : `M${x0.toFixed(2)},${y0.toFixed(2)}A${R},${R} 0 ${large},1 ${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}A${r},${r} 0 ${large},0 ${x3.toFixed(2)},${y3.toFixed(2)}Z`;
      paths += `<path d="${d}" fill="${s.color}" fill-rule="evenodd" data-tip="${esc(s.icon + ' ' + s.label)}|${inr(s.v)} · ${pctS(frac * 100)} of spending" tabindex="0"></path>`;
      a0 = a1;
    });
    $('donut').innerHTML = `<div class="donutwrap"><svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="Spending by category">${paths}
      <text x="90" y="84" text-anchor="middle" style="font-size:11px">Spent</text><text x="90" y="104" text-anchor="middle" style="font-size:17px;font-weight:800;fill:var(--text)">${inrS(total)}</text></svg>
      <div class="legend">${segs.map((s) => `<div><i style="background:${s.color}"></i><span>${esc(s.icon)} ${esc(s.label)}</span><b>${inr(s.v)}</b><em>${pctS(s.v / total * 100)}</em></div>`).join('')}</div></div>`;
  }

  /* bills & EMIs */
  const billPaid = (b) => S.txns.find((t) => t.bill_id === b.id);
  function renderBills() {
    const d = isCurrent() ? +todayIST().slice(8, 10) : (S.month < monthOf(todayIST()) ? 99 : 0);
    if (!S.bills.length) { $('bills').innerHTML = '<div class="empty">Add rent, EMIs, SIPs, insurance and subscriptions with their due day, and mark them paid each month.</div>'; $('billSum').textContent = ''; return; }
    let paidAmt = 0, total = 0;
    $('bills').innerHTML = S.bills.map((b) => {
      const p = billPaid(b), day = Math.min(b.due_day, daysIn(S.month)); total += num(b.amount); if (p) paidAmt += num(p.amount);
      const dueDate = S.month.slice(0, 8) + String(day).padStart(2, '0');
      let st;
      if (p) st = `<span class="pill paid">✓ Paid ${dShort(p.txn_date)}</span>`;
      else if (day < d) st = `<span class="pill late">Overdue</span>`;
      else if (d && day - d <= 5) st = `<span class="pill due">Due ${day === d ? 'today' : 'in ' + (day - d) + 'd'}</span>`;
      else st = `<span class="muted" style="font-size:12px">Due ${dShort(dueDate)}</span>`;
      const c = catById(b.category_id);
      return `<div class="item"><div class="ic">${esc(b.icon)}</div><div class="tx"><b>${esc(b.name)}</b><small>${inr(b.amount)} · every month on the ${b.due_day}${['th', 'st', 'nd', 'rd'][(b.due_day % 100 > 10 && b.due_day % 100 < 14) ? 0 : Math.min(b.due_day % 10, 4) % 4] || 'th'}${c ? ' · ' + esc(c.name) : ''}</small></div>
        <div class="rt">${st}${p ? `<button type="button" class="btn sm" data-unpay="${p.id}" title="Undo">↺</button>` : `<button type="button" class="btn sm ok" data-pay="${b.id}">Mark paid</button>`}<button type="button" class="btn sm" data-editbill="${b.id}" aria-label="Edit ${esc(b.name)}">✎</button></div></div>`;
    }).join('');
    $('billSum').textContent = `${inr(paidAmt)} of ${inr(total)} paid`;
  }

  /* goals & major expenses */
  function goalMonthly(g) {
    if (!g.target_date) return 0;
    const left = Math.max(0, num(g.target_amount) - num(g.saved));
    const t = todayIST(); const months = Math.max(1, (+g.target_date.slice(0, 4) - +t.slice(0, 4)) * 12 + (+g.target_date.slice(5, 7) - +t.slice(5, 7)) + 1);
    return left / months;
  }
  function renderGoals() {
    const planned = S.goals.filter((g) => g.status === 'planned'), done = S.goals.filter((g) => g.status === 'done').slice(0, 4);
    let h = planned.length ? '' : '<div class="empty">Plan your big expenses: a laptop, insurance renewal, a trip, a wedding gift. We\'ll show how much to set aside each month.</div>';
    for (const g of planned) {
      const p = Math.min(1, num(g.saved) / num(g.target_amount)), m = goalMonthly(g);
      const overdue = g.target_date && g.target_date < todayIST();
      h += `<div class="goal"><div class="gt"><div class="ic">${esc(g.icon)}</div><div><b>${esc(g.title)}</b><small>${g.target_date ? (overdue ? '<span class="down">was due</span> ' : 'by ') + dLabel(g.target_date) : 'no date set'}${g.note ? ' · ' + esc(g.note) : ''}</small></div>
          <div class="gamt"><b>${inr(g.target_amount)}</b><small class="muted" style="display:block;font-size:11.5px">${pctS(p * 100)} saved</small></div></div>
        <div class="track"><div class="fill" style="width:${(p * 100).toFixed(1)}%"></div></div>
        <div class="gfoot"><span>${inr(g.saved)} saved${m > 0 && !overdue ? ` · set aside <b style="color:var(--text)">${inr(m)}/month</b>` : ''}</span>
          <span class="acts"><button type="button" class="btn sm" data-save="${g.id}">+ Saved</button><button type="button" class="btn sm ok" data-buy="${g.id}">Mark bought</button><button type="button" class="btn sm" data-editgoal="${g.id}" aria-label="Edit">✎</button></span></div></div>`;
    }
    if (done.length) h += `<div class="subhead">Done</div>` + done.map((g) => `<div class="item"><div class="ic">${esc(g.icon)}</div><div class="tx"><b>${esc(g.title)}</b><small>Bought ${g.done_at ? dShort(g.done_at.slice(0, 10)) : ''}</small></div><div class="rt"><b>${inr(g.target_amount)}</b></div></div>`).join('');
    $('goals').innerHTML = h;
    const yr = S.month.slice(0, 4), tot = S.majors.reduce((a, t) => a + num(t.amount), 0);
    $('majors').innerHTML = `<div class="subhead">⭐ Major expenses in ${yr}${S.majors.length ? ' · ' + inr(tot) : ''}</div>` + (S.majors.length ? S.majors.slice(0, 8).map((t) => {
      const c = catById(t.category_id);
      return `<div class="item tx" data-tx="${t.id}"><div class="ic">${esc(c ? c.icon : '⭐')}</div><div class="tx"><b>${esc(t.note || (c ? c.name : 'Major expense'))}</b><small>${dLabel(t.txn_date)}${c ? ' · ' + esc(c.name) : ''}</small></div><div class="rt"><b>${inr(t.amount)}</b></div></div>`;
    }).join('') : '<div class="muted" style="font-size:12.5px;padding:4px 2px">Tick ⭐ Major expense when adding a big one-off spend to track it here.</div>');
  }

  /* trend: planned vs actual, last 6 months (one axis, grouped bars) */
  function renderTrend() {
    const D = S.trend || [];
    const max = Math.max(1, ...D.map((x) => Math.max(x.planned, x.actual)));
    const W = Math.max(300, Math.round($('trend').clientWidth || 640)), H = 210, padL = 46, padB = 26, padT = 14, cw = (W - padL) / D.length, bw = Math.min(26, cw / 3.2);
    const y = (v) => padT + (H - padB - padT) * (1 - v / max);
    const step = niceStep(max / 3);
    let grid = '';
    for (let v = 0; v <= max * 1.001; v += step) grid += `<line x1="${padL}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/><text x="${padL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${inrS(v)}</text>`;
    let bars = '';
    D.forEach((x, i) => {
      const cx = padL + cw * i + cw / 2, on = x.m === S.month;
      const bar = (v, xx, fill, stroke) => v > 0 ? `<path d="M${xx},${y(0)}V${(y(v) + 4).toFixed(1)}q0,-4 4,-4h${bw - 8}q4,0 4,4V${y(0)}Z" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}/>` : '';
      const over = x.planned > 0 && x.actual > x.planned;
      bars += `<g class="tcol" data-month="${x.m}" style="cursor:pointer" data-tip="${mLabel(x.m)}|Planned ${inr(x.planned)} · Spent ${inr(x.actual)}${x.income ? ' · Income ' + inr(x.income) + ' · Saved ' + inr(x.income - x.actual) : ''}${over ? ' · ⛔ over plan' : ''}">
        <rect x="${(cx - cw / 2 + 2).toFixed(1)}" y="${padT}" width="${(cw - 4).toFixed(1)}" height="${H - padB - padT}" fill="${on ? 'var(--hover)' : 'transparent'}" rx="8"/>
        ${bar(x.planned, (cx - bw - 1).toFixed(1), 'var(--plan)')}${bar(x.actual, (cx + 1).toFixed(1), over ? 'var(--red)' : 'var(--actual)')}
        ${over ? `<text x="${(cx + bw / 2 + 1).toFixed(1)}" y="${(y(x.actual) - 5).toFixed(1)}" text-anchor="middle" style="font-size:11px">⚠</text>` : ''}
        <text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" style="${on ? 'fill:var(--text);font-weight:700' : ''}">${mLabel(x.m, true)}</text></g>`;
    });
    $('trend').innerHTML = `<div class="chartlegend"><span><i style="background:var(--plan)"></i>Planned</span><span><i style="background:var(--actual)"></i>Spent</span><span><i style="background:var(--red)"></i>Spent, over plan</span></div>
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;max-width:100%" role="img" aria-label="Planned vs spent, last six months">${grid}<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--dim)" stroke-width="1"/>${bars}</svg>
      <details style="margin-top:6px"><summary class="muted" style="font-size:12px;cursor:pointer">Show as table</summary><table style="width:100%;font-size:12.5px;border-collapse:collapse;margin-top:6px"><tr class="muted"><th style="text-align:left">Month</th><th style="text-align:right">Income</th><th style="text-align:right">Planned</th><th style="text-align:right">Spent</th><th style="text-align:right">Saved</th></tr>${D.map((x) => `<tr><td>${mLabel(x.m)}</td><td style="text-align:right">${x.income ? inr(x.income) : '—'}</td><td style="text-align:right">${inr(x.planned)}</td><td style="text-align:right">${inr(x.actual)}</td><td style="text-align:right">${x.income ? inr(x.income - x.actual) : '—'}</td></tr>`).join('')}</table></details>`;
  }
  function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

  /* transactions */
  function filteredTx() {
    const q = S.txQ.trim().toLowerCase();
    return S.txns.filter((t) => (!S.txCat || t.category_id === S.txCat) && (!q || (String(t.note || '') + ' ' + ((catById(t.category_id) || {}).name || '') + ' ' + t.amount + ' ' + (t.method || '')).toLowerCase().includes(q)));
  }
  function renderTx() {
    $('txCat').innerHTML = '<option value="">All categories</option>' + visibleCats().map((c) => `<option value="${c.id}"${c.id === S.txCat ? ' selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');
    const list = filteredTx();
    if (!list.length) { $('txList').innerHTML = `<div class="empty">${S.txns.length ? 'Nothing matches.' : 'No expenses in ' + mLabel(S.month) + ' yet. Add one above.'}</div>`; return; }
    let h = '', day = '';
    for (const t of list) {
      if (t.txn_date !== day) { day = t.txn_date; const sum = list.filter((x) => x.txn_date === day).reduce((a, x) => a + num(x.amount), 0); h += `<div class="txday">${dLabel(day)} · ${inr(sum)}</div>`; }
      const c = catById(t.category_id);
      h += `<div class="item tx" data-tx="${t.id}" tabindex="0"><div class="ic">${esc(c ? c.icon : '❔')}</div><div class="tx"><b>${esc(t.note || (c ? c.name : 'Expense'))}</b><small>${esc(c ? c.name : 'Uncategorised')}${t.method ? ' · ' + esc(t.method) : ''}${t.bill_id ? ' · bill' : ''}${t.goal_id ? ' · goal' : ''}</small></div>
        <div class="rt">${t.is_major ? '<span class="pill major">⭐ Major</span>' : ''}<b>${inr(t.amount)}</b></div></div>`;
    }
    $('txList').innerHTML = h;
  }

  /* ───────── actions ───────── */
  async function addExpense(e) {
    e.preventDefault();
    const amount = amt($('fAmt').value), cat = $('fCats').dataset.sel || null;
    if (!(amount > 0)) { toast('Enter an amount', true); $('fAmt').focus(); return; }
    if (!cat) { toast('Pick a category', true); return; }
    const row = { amount, category_id: cat, txn_date: $('fDate').value || todayIST(), note: $('fNote').value.trim() || null, method: $('fMethod').value, is_major: $('fMajor').checked, goal_id: $('fGoal').value || null, bill_id: $('fBill').value || null };
    $('fSave').disabled = true;
    const { error } = await sb.from('pf_transactions').insert(row);
    $('fSave').disabled = false;
    if (error) { toast(error.message, true); return; }
    if (row.goal_id) await sb.from('pf_goals').update({ status: 'done', done_at: new Date().toISOString() }).eq('id', row.goal_id);
    toast(`Added ${inr(amount)} · ${(catById(cat) || {}).name || ''}`);
    resetForm();
    if (monthOf(row.txn_date) !== S.month) { S.month = monthOf(row.txn_date); }
    await reload();
  }
  function resetForm() {
    $('fAmt').value = ''; $('fNote').value = ''; $('fMajor').checked = false; $('fGoal').value = ''; $('fBill').value = '';
    $('fSave').textContent = 'Add expense'; $('fReset').hidden = true;
  }
  async function savePlan(input) {
    const id = input.dataset.plan, v = amt(input.value);
    if (num(S.budgets[id]) === v) return;
    const ok = v > 0 ? await run(sb.from('pf_budgets').upsert({ month: S.month, category_id: id, planned: v })) : await run(sb.from('pf_budgets').delete().eq('month', S.month).eq('category_id', id));
    if (ok) { if (v > 0) S.budgets[id] = v; else delete S.budgets[id]; const T = totals(); renderKpis(T); renderInsights(T); renderBudget(T); renderTrendLocal(); toast('Plan saved'); }
  }
  function renderTrendLocal() { const x = (S.trend || []).find((t) => t.m === S.month); if (x) { x.planned = visibleCats().filter((c) => c.kind !== 'saving').reduce((a, c) => a + num(S.budgets[c.id]), 0); renderTrend(); } }
  async function copyPlan() {
    const prev = addMonths(S.month, -1);
    const [b, mo] = await Promise.all([sb.from('pf_budgets').select('category_id,planned').eq('month', prev), sb.from('pf_months').select('income').eq('month', prev).maybeSingle()]);
    if (b.error) { toast(b.error.message, true); return; }
    const rows = (b.data || []).filter((x) => !(S.budgets[x.category_id] > 0)).map((x) => ({ month: S.month, category_id: x.category_id, planned: x.planned }));
    if (!rows.length && !(mo.data && mo.data.income && !S.income)) { toast(b.data && b.data.length ? 'This month already has those plans' : 'Nothing planned in ' + mLabel(prev), true); return; }
    if (rows.length && !(await run(sb.from('pf_budgets').upsert(rows)))) return;
    if (mo.data && num(mo.data.income) && !S.income) await sb.from('pf_months').upsert({ month: S.month, income: mo.data.income, updated_at: new Date().toISOString() });
    toast(`Copied ${rows.length} plan${rows.length === 1 ? '' : 's'} from ${mLabel(prev)}`);
    await reload();
  }

  /* sheets */
  const emojiPick = (sel) => `<div class="emojis">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === sel ? 'on' : ''}">${e}</button>`).join('')}</div>`;
  function catOptions(sel) { return '<option value="">—</option>' + visibleCats().map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join(''); }
  function catSheet(c) {
    openSheet(`<h3>${c ? 'Edit category' : 'New category'}</h3>
      <label class="fld" style="margin-bottom:10px"><span>Name</span><input id="sName" maxlength="40" value="${esc(c ? c.name : '')}" placeholder="e.g. Kids, Pets, Gym"></label>
      <div class="fld"><span>Icon</span></div>${emojiPick(c ? c.icon : '🧾')}
      <label class="check"><input type="checkbox" id="sSaving" ${c && c.kind === 'saving' ? 'checked' : ''}> This is saving or investing (not counted as spending)</label>
      <div class="formacts">${c ? '<button type="button" class="btn del" id="sArchive">Hide category</button>' : ''}<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="sOk">${c ? 'Save' : 'Add'}</button></div>`);
    $('sOk').onclick = async () => {
      const name = $('sName').value.trim(); if (!name) { toast('Enter a name', true); return; }
      const icon = ($('sbox').querySelector('.emojis .on') || {}).dataset?.emoji || '🧾', kind = $('sSaving').checked ? 'saving' : 'expense';
      const ok = c ? await run(sb.from('pf_categories').update({ name, icon, kind }).eq('id', c.id), 'Category saved')
        : await run(sb.from('pf_categories').insert({ name, icon, kind, sort: Math.max(0, ...S.cats.map((x) => x.sort)) + 1 }), 'Category added');
      if (ok) { closeSheet(); await ensureCats(); await reload(); }
    };
    if (c) $('sArchive').onclick = async () => { if (await run(sb.from('pf_categories').update({ archived: true }).eq('id', c.id), `${c.name} hidden`)) { closeSheet(); await ensureCats(); await reload(); } };
  }
  function billSheet(b) {
    openSheet(`<h3>${b ? 'Edit bill' : 'New bill, EMI or subscription'}</h3>
      <div class="frow"><label class="fld"><span>Name</span><input id="sName" maxlength="60" value="${esc(b ? b.name : '')}" placeholder="e.g. Rent, Car EMI, Netflix"></label>
      <label class="fld"><span>Amount (₹)</span><input id="sAmt" inputmode="decimal" value="${b ? Math.round(b.amount) : ''}"></label></div>
      <div class="frow"><label class="fld"><span>Due day of month</span><input id="sDay" type="number" min="1" max="31" value="${b ? b.due_day : 5}"></label>
      <label class="fld"><span>Category</span><select id="sCat">${catOptions(b ? b.category_id : (S.cats.find((c) => c.name === 'Bills & Utilities') || {}).id)}</select></label></div>
      <div class="fld"><span>Icon</span></div>${emojiPick(b ? b.icon : '🧾')}
      <div class="formacts">${b ? '<button type="button" class="btn del" id="sDel">Delete</button>' : ''}<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="sOk">${b ? 'Save' : 'Add bill'}</button></div>`);
    $('sOk').onclick = async () => {
      const row = { name: $('sName').value.trim(), amount: amt($('sAmt').value), due_day: Math.min(31, Math.max(1, +$('sDay').value || 1)), category_id: $('sCat').value || null, icon: ($('sbox').querySelector('.emojis .on') || {}).dataset?.emoji || '🧾' };
      if (!row.name || !(row.amount > 0)) { toast('Enter a name and an amount', true); return; }
      if (await run(b ? sb.from('pf_bills').update(row).eq('id', b.id) : sb.from('pf_bills').insert(row), b ? 'Bill saved' : 'Bill added')) { closeSheet(); await reload(); }
    };
    if (b) $('sDel').onclick = async () => { if (confirm(`Delete ${b.name}? Past payments stay in your transactions.`) && await run(sb.from('pf_bills').update({ active: false }).eq('id', b.id), 'Bill removed')) { closeSheet(); await reload(); } };
  }
  function goalSheet(g) {
    openSheet(`<h3>${g ? 'Edit goal' : 'Plan a major expense'}</h3>
      <label class="fld" style="margin-bottom:8px"><span>What</span><input id="sName" maxlength="80" value="${esc(g ? g.title : '')}" placeholder="e.g. New laptop, Car insurance, Goa trip"></label>
      <div class="frow"><label class="fld"><span>Amount (₹)</span><input id="sAmt" inputmode="decimal" value="${g ? Math.round(g.target_amount) : ''}"></label>
      <label class="fld"><span>By when</span><input id="sDate" type="date" value="${g && g.target_date ? g.target_date : ''}"></label></div>
      <div class="frow"><label class="fld"><span>Saved so far (₹)</span><input id="sSaved" inputmode="decimal" value="${g ? Math.round(g.saved) : 0}"></label>
      <label class="fld"><span>Category</span><select id="sCat">${catOptions(g ? g.category_id : null)}</select></label></div>
      <label class="fld" style="margin-bottom:8px"><span>Note</span><input id="sNote" maxlength="300" value="${esc(g ? g.note || '' : '')}"></label>
      <div class="fld"><span>Icon</span></div>${emojiPick(g ? g.icon : '🎯')}
      <div class="formacts">${g ? '<button type="button" class="btn del" id="sDel">Drop goal</button>' : ''}<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="sOk">${g ? 'Save' : 'Add goal'}</button></div>`);
    $('sOk').onclick = async () => {
      const row = { title: $('sName').value.trim(), target_amount: amt($('sAmt').value), target_date: $('sDate').value || null, saved: amt($('sSaved').value), category_id: $('sCat').value || null, note: $('sNote').value.trim() || null, icon: ($('sbox').querySelector('.emojis .on') || {}).dataset?.emoji || '🎯' };
      if (!row.title || !(row.target_amount > 0)) { toast('Enter what it is and the amount', true); return; }
      if (await run(g ? sb.from('pf_goals').update(row).eq('id', g.id) : sb.from('pf_goals').insert(row), g ? 'Goal saved' : 'Goal added')) { closeSheet(); await reload(); }
    };
    if (g) $('sDel').onclick = async () => { if (confirm(`Drop "${g.title}"?`) && await run(sb.from('pf_goals').update({ status: 'dropped' }).eq('id', g.id), 'Goal dropped')) { closeSheet(); await reload(); } };
  }
  function saveSheet(g) {
    openSheet(`<h3>${esc(g.icon)} Add to ${esc(g.title)}</h3><p class="muted" style="margin:-6px 0 10px;font-size:13px">${inr(g.saved)} saved of ${inr(g.target_amount)}</p>
      <div class="amt"><b>₹</b><input id="sAmt" inputmode="decimal" placeholder="${Math.round(goalMonthly(g)) || ''}"></div>
      <div class="formacts"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="sOk">Add savings</button></div>`);
    $('sOk').onclick = async () => { const v = amt($('sAmt').value); if (!(v > 0)) return; if (await run(sb.from('pf_goals').update({ saved: num(g.saved) + v }).eq('id', g.id), `${inr(v)} added`)) { closeSheet(); await reload(); } };
  }
  function txSheet(t) {
    openSheet(`<h3>Edit expense</h3>
      <div class="amt"><b>₹</b><input id="sAmt" inputmode="decimal" value="${num(t.amount)}"></div>
      <div class="frow"><label class="fld"><span>Category</span><select id="sCat">${catOptions(t.category_id)}</select></label><label class="fld"><span>Date</span><input id="sDate" type="date" value="${t.txn_date}"></label></div>
      <div class="frow"><label class="fld"><span>Paid by</span><select id="sMethod">${['UPI', 'Card', 'Cash', 'Net banking', 'Auto-debit', 'Other'].map((m) => `<option${m === t.method ? ' selected' : ''}>${m}</option>`).join('')}</select></label><label class="fld"><span>Note</span><input id="sNote" maxlength="200" value="${esc(t.note || '')}"></label></div>
      <label class="check"><input type="checkbox" id="sMajor" ${t.is_major ? 'checked' : ''}> ⭐ Major expense</label>
      <div class="formacts"><button type="button" class="btn del" id="sDel">Delete</button><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="sOk">Save</button></div>`);
    $('sOk').onclick = async () => {
      const row = { amount: amt($('sAmt').value), category_id: $('sCat').value || null, txn_date: $('sDate').value, method: $('sMethod').value, note: $('sNote').value.trim() || null, is_major: $('sMajor').checked };
      if (!(row.amount > 0)) { toast('Enter an amount', true); return; }
      if (await run(sb.from('pf_transactions').update(row).eq('id', t.id), 'Saved')) { closeSheet(); await reload(); }
    };
    $('sDel').onclick = async () => { if (confirm(`Delete ${inr(t.amount)} ${t.note ? '(' + t.note + ')' : ''}?`) && await run(sb.from('pf_transactions').delete().eq('id', t.id), 'Deleted')) { closeSheet(); await reload(); } };
  }
  function exportCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Category', 'Note', 'Amount', 'Paid by', 'Major']].concat(filteredTx().slice().reverse().map((t) => [t.txn_date, (catById(t.category_id) || {}).name || '', t.note || '', num(t.amount), t.method || '', t.is_major ? 'Yes' : '']));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `marketpulse-money-${S.month.slice(0, 7)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ───────── wiring ───────── */
  function wire() {
    $('prevM').onclick = () => { S.month = addMonths(S.month, -1); reload(); };
    $('nextM').onclick = () => { S.month = addMonths(S.month, 1); reload(); };
    $('thisM').onclick = () => { S.month = monthOf(todayIST()); reload(); };
    $('addForm').addEventListener('submit', addExpense);
    $('fReset').onclick = resetForm;
    $('fAmt').addEventListener('input', (e) => { const d = e.target.value.replace(/[^\d.]/g, ''); const [i, f] = d.split('.'); const v = (i ? (+i).toLocaleString('en-IN') : '') + (f !== undefined ? '.' + f.slice(0, 2) : ''); if (e.target.value !== v) e.target.value = v; });
    $('fCats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; $('fCats').dataset.sel = b.dataset.cat; renderFormCats(); });
    $('copyPlan').onclick = copyPlan;
    $('addCat').onclick = () => catSheet(null);
    $('addBill').onclick = () => billSheet(null);
    $('addGoal').onclick = () => goalSheet(null);
    $('csv').onclick = exportCsv;
    $('txQ').addEventListener('input', (e) => { S.txQ = e.target.value; renderTx(); });
    $('txCat').addEventListener('change', (e) => { S.txCat = e.target.value; renderTx(); });
    $('fab').onclick = () => { $('addPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('fAmt').focus(), 350); };
    $('budgetList').addEventListener('keydown', (e) => { if (e.target.dataset.plan && e.key === 'Enter') e.target.blur(); });
    $('budgetList').addEventListener('focusout', (e) => { if (e.target.dataset.plan) savePlan(e.target); });
    $('budgetList').addEventListener('click', (e) => {
      if (e.target.closest('#toggleEmpty')) { S.showEmpty = !S.showEmpty; renderBudget(totals()); return; }
      const ec = e.target.closest('[data-editcat]'); if (ec) { e.stopPropagation(); catSheet(catById(ec.dataset.editcat)); return; }
      const f = e.target.closest('[data-filter]');
      if (f) { S.txCat = f.dataset.filter; renderTx(); $('txList').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    document.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const em = e.target.closest('[data-emoji]'); if (em) { em.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === em)); return; }
      const pay = e.target.closest('[data-pay]');
      if (pay) {
        const b = S.bills.find((x) => x.id === pay.dataset.pay); if (!b) return;
        const day = String(Math.min(b.due_day, daysIn(S.month))).padStart(2, '0');
        const date = isCurrent() ? todayIST() : S.month.slice(0, 8) + day;
        if (await run(sb.from('pf_transactions').insert({ amount: b.amount, category_id: b.category_id, txn_date: date, note: b.name, method: 'Auto-debit', bill_id: b.id }), `${b.name} marked paid`)) await reload();
        return;
      }
      const un = e.target.closest('[data-unpay]'); if (un) { if (await run(sb.from('pf_transactions').delete().eq('id', un.dataset.unpay), 'Payment undone')) await reload(); return; }
      const eb = e.target.closest('[data-editbill]'); if (eb) { billSheet(S.bills.find((x) => x.id === eb.dataset.editbill)); return; }
      const eg = e.target.closest('[data-editgoal]'); if (eg) { goalSheet(S.goals.find((x) => x.id === eg.dataset.editgoal)); return; }
      const sv = e.target.closest('[data-save]'); if (sv) { saveSheet(S.goals.find((x) => x.id === sv.dataset.save)); return; }
      const buy = e.target.closest('[data-buy]');
      if (buy) {
        const g = S.goals.find((x) => x.id === buy.dataset.buy); if (!g) return;
        $('fAmt').value = Math.round(g.target_amount).toLocaleString('en-IN'); $('fNote').value = g.title; $('fMajor').checked = true; $('fGoal').value = g.id;
        if (g.category_id) { $('fCats').dataset.sel = g.category_id; renderFormCats(); }
        $('fSave').textContent = 'Save as bought'; $('fReset').hidden = false;
        $('addPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('fAmt').focus(), 350);
        toast('Check the amount and category, then save');
        return;
      }
      const tx = e.target.closest('[data-tx]'); if (tx) { const t = S.txns.find((x) => x.id === tx.dataset.tx) || S.majors.find((x) => x.id === tx.dataset.tx); if (t && t.txn_date) { if (!('method' in t)) { const r = await sb.from('pf_transactions').select('*').eq('id', t.id).maybeSingle(); if (r.data) txSheet(r.data); } else txSheet(t); } return; }
      const col = e.target.closest('[data-month]'); if (col) { S.month = col.dataset.month; reload(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-tx]') && !e.target.closest('input')) e.target.click(); });
    // chart tooltips (donut segments, trend columns)
    const tip = $('tip');
    const showTip = (el, x, y) => { const [a, b] = el.dataset.tip.split('|'); tip.innerHTML = `<b>${a}</b><br>${b}`; tip.hidden = false; tip.style.left = Math.min(innerWidth - 250, x + 14) + 'px'; tip.style.top = (y + 14) + 'px'; };
    document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
    document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.right, r.top); } });
    window.addEventListener('mp:theme', () => { if (S.user) render(); });
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.trend) renderTrend(); }, 150); });
  }

  async function init() {
    wire();
    const { data } = await sb.auth.getSession();
    S.user = data && data.session && data.session.user;
    $('loading').hidden = true;
    if (!S.user) { $('gate').hidden = false; return; }
    $('app').hidden = false; $('monthNav').hidden = false; $('fab').hidden = false;
    S.month = monthOf(todayIST());
    try { await ensureCats(); await loadMonth(); render(); }
    catch (e) { $('app').innerHTML = `<div class="gate"><h2>Couldn't load your money</h2><p class="muted">${esc(e.message || e)}</p><button class="btn pri" onclick="location.reload()">Try again</button></div>`; }
    sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
  }
  init();
})();
