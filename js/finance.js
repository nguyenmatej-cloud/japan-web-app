/**
 * finance.js – Sdílené výdaje skupiny + Settle Up + Statistiky + JPY/CZK kurz.
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

const CATEGORIES = {
  food:       { label: 'Jídlo & restaurace',  icon: '🍱', color: '#FF9500' },
  transport:  { label: 'Doprava',              icon: '🚇', color: '#0A84FF' },
  hotel:      { label: 'Ubytování',            icon: '🏨', color: '#5E5CE6' },
  attraction: { label: 'Atrakce & vstupné',    icon: '🎟️', color: '#FF375F' },
  shopping:   { label: 'Shopping',             icon: '🛍️', color: '#BF5AF2' },
  drinks:     { label: 'Drobnosti & kafe',     icon: '☕', color: '#A0522D' },
  health:     { label: 'Zdraví & lékárna',     icon: '💊', color: '#34C759' },
  comm:       { label: 'Komunikace (eSIM)',     icon: '🌐', color: '#5AC8FA' },
  other:      { label: 'Ostatní',              icon: '❓', color: '#8E8E93' },
};

let _unsub        = null;
let _expenses     = [];
let _members      = [];
let _container    = null;
let _tab          = 'expenses'; // 'expenses' | 'settle' | 'stats'
let _exchangeRate = null;       // JPY → CZK
let _onEsc        = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container = container;
  _expenses  = [];
  _tab       = 'expenses';

  container.innerHTML = buildShell();

  container.querySelector('#fin-btn-add')
    ?.addEventListener('click', openInlineForm);
  container.querySelector('#fin-modal-close')
    ?.addEventListener('click', closeInlineForm);
  container.querySelector('#fin-form-cancel')
    ?.addEventListener('click', closeInlineForm);
  container.querySelector('#fin-form')
    ?.addEventListener('submit', handleFormSubmit);

  container.querySelector('#fin-expense-list')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) handleCardAction(btn);
    });

  container.querySelector('.finance-tabs')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) switchTab(btn.dataset.tab);
    });

  _onEsc = (e) => {
    if (e.key !== 'Escape') return;
    const form = _container?.querySelector('#fin-add-form');
    if (form && form.classList.contains('inline-form--open')) closeInlineForm();
  };
  document.addEventListener('keydown', _onEsc);

  loadMembers().then(() => {
    fillPaidBySelect();
    fillSplitCheckboxes();
    fillCategorySelect();
  });

  subscribe();
  fetchExchangeRate();
  return cleanup;
}

function cleanup() {
  if (_onEsc) { document.removeEventListener('keydown', _onEsc); _onEsc = null; }
  _unsub?.();
  _unsub     = null;
  _container = null;
  _expenses  = [];
}

/* ── HTML Shell ──────────────────────────────────────────────── */

function buildShell() {
  const catOptions = Object.entries(CATEGORIES)
    .map(([k, c]) => `<option value="${k}">${c.icon} ${c.label}</option>`)
    .join('');

  return `
    <div class="page page--enter">
      <div class="page-header todos-page-header">
        <div>
          <h1 class="page-header__title">💰 Finance & Settle Up</h1>
          <p class="page-header__subtitle">Sdílené výdaje a přehled, kdo komu dluží</p>
        </div>
      </div>

      <div class="exchange-rate" id="fin-exchange-rate">
        <span class="exchange-rate__icon">💱</span>
        <span id="fin-rate-text">Načítám kurz JPY/CZK…</span>
      </div>

      <button class="add-cta" id="fin-btn-add">
        <span class="add-cta__plus">+</span>
        <span class="add-cta__text">Přidat nový výdaj</span>
      </button>

      <div class="inline-form" id="fin-add-form" hidden>
        <div class="inline-form__header">
          <h2 class="inline-form__title">💰 Nový výdaj</h2>
          <button type="button" class="inline-form__close" id="fin-modal-close" aria-label="Zavřít">×</button>
        </div>
        <form id="fin-form" novalidate>
          <div class="inline-form__body">
            <div class="form-group">
              <label for="fin-desc" class="form-label">Popis <span class="required" aria-label="povinné">*</span></label>
              <input type="text" id="fin-desc" class="form-input" placeholder="Např. Ramen v Ichiran" maxlength="100" required autocomplete="off" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="fin-amount" class="form-label">Částka JPY <span class="required" aria-label="povinné">*</span></label>
                <input type="number" id="fin-amount" class="form-input" placeholder="2 400" min="1" max="99999999" required />
              </div>
              <div class="form-group">
                <label for="fin-category" class="form-label">Kategorie</label>
                <select id="fin-category" class="form-select">${catOptions}</select>
              </div>
            </div>
            <div class="form-group">
              <label for="fin-paidby" class="form-label">Zaplatil/a <span class="required" aria-label="povinné">*</span></label>
              <select id="fin-paidby" class="form-select" required></select>
            </div>
            <div class="form-group">
              <label class="form-label">Rozdělit mezi <span class="required" aria-label="povinné">*</span></label>
              <p class="form-hint" style="margin-bottom:var(--space-2)">Rovným dílem mezi zaškrtnuté členy</p>
              <div id="fin-split-checkboxes" class="fin-split-checkboxes"></div>
            </div>
          </div>
          <div class="inline-form__footer">
            <button type="button" class="btn btn--ghost" id="fin-form-cancel">Zrušit</button>
            <button type="submit" class="btn btn--primary" id="fin-form-submit">Přidat výdaj</button>
          </div>
        </form>
      </div>

      <div class="finance-tabs" role="tablist" aria-label="Sekce finance">
        <button class="finance-tab finance-tab--active" data-tab="expenses" role="tab" aria-selected="true">🧾 Výdaje</button>
        <button class="finance-tab" data-tab="settle" role="tab" aria-selected="false">⚖️ Vyrovnání</button>
        <button class="finance-tab" data-tab="stats" role="tab" aria-selected="false">📊 Statistiky</button>
      </div>

      <div id="fin-tab-expenses" role="tabpanel">
        <div id="fin-summary" class="fin-summary hidden"></div>
        <div id="fin-expense-list" class="fin-expense-list" role="list" aria-label="Seznam výdajů">
          <div class="wl-skeletons" id="fin-loading">
            <div class="skeleton skeleton--card" style="height:88px"></div>
            <div class="skeleton skeleton--card" style="height:88px"></div>
            <div class="skeleton skeleton--card" style="height:88px"></div>
          </div>
        </div>
      </div>

      <div id="fin-tab-settle" class="hidden" role="tabpanel">
        <div id="fin-settle-content"></div>
      </div>

      <div id="fin-tab-stats" class="hidden" role="tabpanel">
        <div id="fin-stats-content"></div>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   EXCHANGE RATE
   ════════════════════════════════════════════════════════════ */

async function fetchExchangeRate() {
  try {
    const res  = await fetch('https://api.frankfurter.app/latest?from=JPY&to=CZK');
    const data = await res.json();
    _exchangeRate = data.rates?.CZK ?? 0.16;
  } catch {
    _exchangeRate = 0.16;
  }

  const el = _container?.querySelector('#fin-rate-text');
  if (el) {
    el.textContent = `1 JPY = ${_exchangeRate.toFixed(4)} CZK (live)`;
  }

  // Re-render current tab to show CZK values
  renderExpenses();
  if (_tab === 'stats') renderStats();
}

/* ════════════════════════════════════════════════════════════
   MEMBERS
   ════════════════════════════════════════════════════════════ */

async function loadMembers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    _members = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch (err) {
    console.error('[finance] loadMembers:', err);
  }
}

function fillPaidBySelect() {
  const sel = _container?.querySelector('#fin-paidby');
  if (!sel) return;
  sel.innerHTML = _members.map(m =>
    `<option value="${esc(m.uid)}"${m.uid === state.user?.uid ? ' selected' : ''}>${esc(m.avatar ?? '😊')} ${esc(m.nickname)}</option>`
  ).join('');
}

function fillSplitCheckboxes() {
  const box = _container?.querySelector('#fin-split-checkboxes');
  if (!box) return;
  box.innerHTML = _members.map(m => `
    <label class="fin-split-label">
      <input type="checkbox" name="split" value="${esc(m.uid)}" checked class="fin-split-cb" />
      <span class="fin-split-member">
        <span aria-hidden="true">${esc(m.avatar ?? '😊')}</span>
        ${esc(m.nickname)}
      </span>
    </label>
  `).join('');
}

function fillCategorySelect() {
  // Already built in shell HTML — just ensure default is 'food'
  const sel = _container?.querySelector('#fin-category');
  if (sel) sel.value = 'food';
}

/* ════════════════════════════════════════════════════════════
   FIRESTORE
   ════════════════════════════════════════════════════════════ */

function subscribe() {
  const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
  _unsub = onSnapshot(q, (snap) => {
    _expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderExpenses();
    if (_tab === 'settle') renderSettle();
    if (_tab === 'stats')  renderStats();
  }, (err) => {
    console.error('[finance] onSnapshot:', err);
    showToast('Chyba při načítání výdajů.', 'error');
  });
}

/* ════════════════════════════════════════════════════════════
   TABS
   ════════════════════════════════════════════════════════════ */

function switchTab(tab) {
  _tab = tab;
  _container?.querySelectorAll('.finance-tab').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('finance-tab--active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  _container?.querySelector('#fin-tab-expenses')?.classList.toggle('hidden', tab !== 'expenses');
  _container?.querySelector('#fin-tab-settle')?.classList.toggle('hidden', tab !== 'settle');
  _container?.querySelector('#fin-tab-stats')?.classList.toggle('hidden', tab !== 'stats');
  if (tab === 'settle') renderSettle();
  if (tab === 'stats')  renderStats();
}

/* ════════════════════════════════════════════════════════════
   RENDER EXPENSES
   ════════════════════════════════════════════════════════════ */

function renderExpenses() {
  const listEl = _container?.querySelector('#fin-expense-list');
  if (!listEl) return;

  _container?.querySelector('#fin-loading')?.remove();

  if (!_expenses.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">💰</span>
        <h2 class="empty-state__title">Žádné výdaje</h2>
        <p class="empty-state__desc">Přidej první skupinový výdaj a aplikace začne počítat vyrovnání!</p>
      </div>`;
    renderSummary(0, 0);
    return;
  }

  const total   = _expenses.reduce((s, e) => s + (e.amountJpy ?? 0), 0);
  const myShare = _expenses.reduce((s, e) => {
    if (!e.splitWithUids?.includes(state.user?.uid)) return s;
    return s + (e.amountJpy ?? 0) / (e.splitWithUids.length || 1);
  }, 0);

  renderSummary(total, myShare);
  listEl.innerHTML = _expenses.map(e => buildExpenseCard(e)).join('');
}

function renderSummary(total, myShare) {
  const el = _container?.querySelector('#fin-summary');
  if (!el) return;
  if (!total) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="fin-summary-grid">
      <div class="fin-summary-item">
        <span class="fin-summary-label">Celkem výdajů</span>
        <span class="fin-summary-value">${fmtJpy(total)}</span>
        <span class="fin-summary-czk">${fmtCzk(total)}</span>
      </div>
      <div class="fin-summary-item">
        <span class="fin-summary-label">Můj podíl</span>
        <span class="fin-summary-value">${fmtJpy(Math.round(myShare))}</span>
        <span class="fin-summary-czk">${fmtCzk(myShare)}</span>
      </div>
      <div class="fin-summary-item">
        <span class="fin-summary-label">Počet výdajů</span>
        <span class="fin-summary-value">${_expenses.length}</span>
      </div>
    </div>
  `;
}

function buildExpenseCard(exp) {
  const canDelete  = exp.authorUid === state.user?.uid || state.isAdmin;
  const splitCount = exp.splitWithUids?.length || 1;
  const share      = Math.round(exp.amountJpy / splitCount);
  const timeStr    = exp.createdAt?.toDate ? fmtTime(exp.createdAt.toDate()) : '';
  const isMe       = exp.paidByUid === state.user?.uid;
  const cat        = CATEGORIES[exp.category] ?? CATEGORIES.other;

  return `
    <article class="expense-card card${isMe ? ' expense-card--mine' : ''}" role="listitem" data-id="${exp.id}">
      <div class="expense-card__main">
        <div class="expense-card__info">
          <h3 class="expense-card__title">${esc(exp.description)}</h3>
          <div class="expense-card__meta">
            <span class="todo-meta-chip" style="--cat-color:${cat.color}">${cat.icon} ${esc(cat.label)}</span>
            <span class="todo-meta-chip">
              <span aria-hidden="true">${esc(exp.paidByAvatar ?? '😊')}</span>
              ${esc(exp.paidByNickname ?? '—')} zaplatil/a
            </span>
            ${timeStr ? `<span class="todo-meta-chip todo-meta-chip--muted">${timeStr}</span>` : ''}
          </div>
        </div>
        <div class="expense-card__amounts">
          <span class="expense-amount">${fmtJpy(exp.amountJpy)}</span>
          <span class="expense-amount-czk">${fmtCzk(exp.amountJpy)}</span>
          <span class="expense-share">/${splitCount} os. = ${fmtJpy(share)}</span>
        </div>
      </div>
      ${canDelete ? `
        <div class="expense-card__del">
          <button class="idea-action-btn idea-action-btn--delete" data-action="delete" data-id="${exp.id}" aria-label="Smazat výdaj">🗑️</button>
        </div>` : ''}
    </article>
  `;
}

/* ════════════════════════════════════════════════════════════
   RENDER SETTLE UP
   ════════════════════════════════════════════════════════════ */

function renderSettle() {
  const el = _container?.querySelector('#fin-settle-content');
  if (!el) return;

  if (!_expenses.length) {
    el.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">⚖️</span>
        <h2 class="empty-state__title">Žádné výdaje</h2>
        <p class="empty-state__desc">Přidej výdaje a aplikace spočítá, kdo komu dluží.</p>
      </div>`;
    return;
  }

  const memberMap    = Object.fromEntries(_members.map(m => [m.uid, m]));
  const balances     = computeBalances(_expenses, _members);
  const transactions = computeSettleUp(balances);

  const balanceRows = _members
    .map(m => {
      const bal = balances[m.uid] ?? 0;
      if (Math.abs(bal) < 1) return null;
      const positive = bal > 0;
      return `
        <div class="balance-item">
          <span class="balance-avatar" aria-hidden="true">${esc(m.avatar ?? '😊')}</span>
          <span class="balance-name">${esc(m.nickname)}</span>
          <span class="balance-amount ${positive ? 'balance--positive' : 'balance--negative'}">
            ${positive ? `dostane zpět ${fmtJpy(Math.round(bal))}` : `dluží ${fmtJpy(Math.round(-bal))}`}
          </span>
        </div>`;
    })
    .filter(Boolean)
    .join('');

  const transRows = transactions.length
    ? transactions.map(tx => {
        const from = memberMap[tx.from];
        const to   = memberMap[tx.to];
        if (!from || !to) return '';
        return `
          <div class="settle-item">
            <span class="settle-from">${esc(from.avatar ?? '😊')} <strong>${esc(from.nickname)}</strong></span>
            <span class="settle-arrow" aria-hidden="true">→</span>
            <span class="settle-to">${esc(to.avatar ?? '😊')} <strong>${esc(to.nickname)}</strong></span>
            <span class="settle-amount">${fmtJpy(Math.round(tx.amount))} <small>${fmtCzk(tx.amount)}</small></span>
          </div>`;
      }).join('')
    : `<p class="settle-all-good">🎉 Všichni jsou vyrovnáni!</p>`;

  el.innerHTML = `
    <div class="settle-section">
      <h3 class="settle-section-title">Zůstatky členů</h3>
      <div class="balance-list">
        ${balanceRows || '<p class="settle-all-good">🎉 Všichni jsou vyrovnáni!</p>'}
      </div>
    </div>
    <div class="settle-section">
      <h3 class="settle-section-title">Minimální platby k vyrovnání</h3>
      <p class="form-hint" style="margin-bottom:var(--space-3)">Nejmenší počet převodů, které vyrovnají všechny dluhy</p>
      <div class="settle-list">${transRows}</div>
    </div>
  `;
}

/* ── Settle Up algoritmus (minimalizace počtu transakcí) ──────── */

function computeBalances(expenses, members) {
  const balances = {};
  members.forEach(m => { balances[m.uid] = 0; });

  expenses.forEach(exp => {
    const uids = exp.splitWithUids ?? [];
    if (!uids.length) return;
    const share = exp.amountJpy / uids.length;

    if (balances[exp.paidByUid] !== undefined) balances[exp.paidByUid] += exp.amountJpy;
    uids.forEach(uid => { if (balances[uid] !== undefined) balances[uid] -= share; });
  });

  return balances;
}

function computeSettleUp(balances) {
  const credits = [];
  const debts   = [];

  Object.entries(balances).forEach(([uid, bal]) => {
    if (bal > 0.5)       credits.push({ uid, amount: bal });
    else if (bal < -0.5) debts.push({ uid, amount: -bal });
  });

  credits.sort((a, b) => b.amount - a.amount);
  debts.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0, j = 0;

  while (i < credits.length && j < debts.length) {
    const amount = Math.min(credits[i].amount, debts[j].amount);
    transactions.push({ from: debts[j].uid, to: credits[i].uid, amount });
    credits[i].amount -= amount;
    debts[j].amount   -= amount;
    if (credits[i].amount < 0.5) i++;
    if (debts[j].amount   < 0.5) j++;
  }

  return transactions;
}

/* ════════════════════════════════════════════════════════════
   RENDER STATISTICS
   ════════════════════════════════════════════════════════════ */

function renderStats() {
  const el = _container?.querySelector('#fin-stats-content');
  if (!el) return;

  if (!_expenses.length) {
    el.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">📊</span>
        <h2 class="empty-state__title">Žádná data</h2>
        <p class="empty-state__desc">Přidej výdaje pro zobrazení statistik.</p>
      </div>`;
    return;
  }

  const total = _expenses.reduce((s, e) => s + (e.amountJpy ?? 0), 0);

  // By category
  const byCategory = {};
  _expenses.forEach(exp => {
    const key = exp.category ?? 'other';
    byCategory[key] = (byCategory[key] ?? 0) + (exp.amountJpy ?? 0);
  });

  // By payer
  const byPayer = {};
  _expenses.forEach(exp => {
    byPayer[exp.paidByUid] = (byPayer[exp.paidByUid] ?? 0) + (exp.amountJpy ?? 0);
  });

  const memberMap = Object.fromEntries(_members.map(m => [m.uid, m]));

  const catRows = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([key, amount]) => {
      const cat = CATEGORIES[key] ?? CATEGORIES.other;
      const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
      return `
        <div class="balance-item">
          <span class="balance-avatar" aria-hidden="true">${cat.icon}</span>
          <span class="balance-name">${cat.label}</span>
          <div class="stats-bar-wrap">
            <div class="stats-bar" style="width:${pct}%;background:${cat.color}"></div>
          </div>
          <span class="balance-amount">${fmtJpy(amount)} <small>(${pct}%)</small></span>
        </div>`;
    }).join('');

  const payerRows = Object.entries(byPayer)
    .sort((a, b) => b[1] - a[1])
    .map(([uid, amount]) => {
      const m = memberMap[uid];
      if (!m) return '';
      return `
        <div class="balance-item">
          <span class="balance-avatar" aria-hidden="true">${esc(m.avatar ?? '😊')}</span>
          <span class="balance-name">${esc(m.nickname)}</span>
          <span class="balance-amount">${fmtJpy(amount)} <small>${fmtCzk(amount)}</small></span>
        </div>`;
    }).join('');

  el.innerHTML = `
    <div class="settle-section">
      <h3 class="settle-section-title">Celkový přehled</h3>
      <div class="fin-summary">
        <div class="fin-summary-grid">
          <div class="fin-summary-item">
            <span class="fin-summary-label">Celkem</span>
            <span class="fin-summary-value">${fmtJpy(total)}</span>
            <span class="fin-summary-czk">${fmtCzk(total)}</span>
          </div>
          <div class="fin-summary-item">
            <span class="fin-summary-label">Průměr/výdaj</span>
            <span class="fin-summary-value">${fmtJpy(Math.round(total / _expenses.length))}</span>
          </div>
          <div class="fin-summary-item">
            <span class="fin-summary-label">Celkem výdajů</span>
            <span class="fin-summary-value">${_expenses.length}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="settle-section">
      <h3 class="settle-section-title">Podle kategorií</h3>
      <div class="balance-list">${catRows}</div>
    </div>

    <div class="settle-section">
      <h3 class="settle-section-title">Podle plátce</h3>
      <div class="balance-list">${payerRows}</div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   CARD ACTIONS
   ════════════════════════════════════════════════════════════ */

function handleCardAction(btn) {
  const { action, id } = btn.dataset;
  if (!id) return;
  if (action === 'delete') confirmDelete(id);
}

async function confirmDelete(expId) {
  const exp = _expenses.find(e => e.id === expId);
  if (!exp) return;
  const ok = await showConfirm('Smazat výdaj', `Opravdu smazat „${exp.description}"?`, 'Smazat');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'expenses', expId));
    showToast('Výdaj smazán.', 'success');
  } catch (err) {
    console.error('[finance] delete:', err);
    showToast('Nepodařilo se smazat výdaj.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   INLINE FORM
   ════════════════════════════════════════════════════════════ */

function openInlineForm() {
  _container?.querySelector('#fin-form')?.reset();
  fillPaidBySelect();
  fillSplitCheckboxes();

  const form = _container?.querySelector('#fin-add-form');
  if (!form) return;
  form.hidden = false;
  requestAnimationFrame(() => {
    form.classList.add('inline-form--open');
    setTimeout(() => {
      const rect = form.getBoundingClientRect();
      window.scrollTo({ top: rect.top + window.pageYOffset - 80, behavior: 'smooth' });
    }, 50);
  });
  _container?.querySelector('#fin-btn-add')?.classList.add('hidden');
}

function closeInlineForm() {
  const form = _container?.querySelector('#fin-add-form');
  if (!form) return;
  form.classList.remove('inline-form--open');
  setTimeout(() => { form.hidden = true; }, 300);
  _container?.querySelector('#fin-btn-add')?.classList.remove('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const descEl   = _container.querySelector('#fin-desc');
  const amountEl = _container.querySelector('#fin-amount');
  const paidByEl = _container.querySelector('#fin-paidby');
  const catEl    = _container.querySelector('#fin-category');

  const description = descEl.value.trim();
  const amountRaw   = amountEl.value;
  const paidByUid   = paidByEl.value;
  const category    = catEl?.value ?? 'other';

  let valid = true;
  [[descEl, !description], [amountEl, !amountRaw || Number(amountRaw) <= 0]].forEach(([el, err]) => {
    el.classList.toggle('error', err);
    if (err) valid = false;
  });

  if (!valid) {
    showToast('Vyplň popis a platnou částku.', 'warning');
    return;
  }

  const splitUids = [..._container.querySelectorAll('.fin-split-cb:checked')].map(cb => cb.value);
  if (!splitUids.length) {
    showToast('Vyber alespoň jednu osobu pro rozdělení výdaje.', 'warning');
    return;
  }

  const paidByMember   = _members.find(m => m.uid === paidByUid);
  const splitNicknames = splitUids
    .map(uid => _members.find(m => m.uid === uid)?.nickname)
    .filter(Boolean);

  const submitBtn = _container.querySelector('#fin-form-submit');
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, 'expenses'), {
      description,
      amountJpy:          Number(amountRaw),
      category,
      paidByUid,
      paidByNickname:     paidByMember?.nickname ?? '—',
      paidByAvatar:       paidByMember?.avatar   ?? '😊',
      splitWithUids:      splitUids,
      splitWithNicknames: splitNicknames,
      authorUid:          state.user.uid,
      createdAt:          serverTimestamp(),
    });
    showToast('Výdaj přidán! 💰', 'success');
    closeInlineForm();
  } catch (err) {
    console.error('[finance] addExpense:', err);
    showToast('Nepodařilo se uložit výdaj.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function fmtJpy(n) {
  return `${Number(n).toLocaleString('cs-CZ')} JPY`;
}

function fmtCzk(jpyAmount) {
  if (!_exchangeRate) return '';
  const czk = Math.round(jpyAmount * _exchangeRate);
  return `≈ ${czk.toLocaleString('cs-CZ')} Kč`;
}

function fmtTime(date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)         return 'před chvílí';
  if (diff < 3_600_000)      return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)     return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000) return `před ${Math.floor(diff / 86_400_000)} dny`;
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
