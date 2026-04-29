/**
 * finance.js – Sdílené výdaje skupiny + Settle Up (minimální platby).
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

let _unsub     = null;
let _expenses  = [];
let _members   = [];
let _container = null;
let _tab       = 'expenses'; // 'expenses' | 'settle'
let _onEsc     = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container = container;
  _expenses  = [];
  _tab       = 'expenses';

  container.innerHTML = buildShell();

  container.querySelector('#fin-btn-add')
    ?.addEventListener('click', openModal);
  container.querySelector('#fin-modal-backdrop')
    ?.addEventListener('click', closeModal);
  container.querySelector('#fin-modal-close')
    ?.addEventListener('click', closeModal);
  container.querySelector('#fin-form-cancel')
    ?.addEventListener('click', closeModal);
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
    const modal = _container?.querySelector('#fin-modal');
    if (modal && !modal.classList.contains('hidden')) closeModal();
  };
  document.addEventListener('keydown', _onEsc);

  loadMembers().then(() => {
    fillPaidBySelect();
    fillSplitCheckboxes();
  });

  subscribe();
  return cleanup;
}

function cleanup() {
  if (_onEsc) { document.removeEventListener('keydown', _onEsc); _onEsc = null; }
  _unsub?.();
  _unsub     = null;
  _container = null;
  _expenses  = [];
  document.body.style.overflow = '';
}

/* ── HTML Shell ──────────────────────────────────────────────── */

function buildShell() {
  return `
    <div class="page page--enter">
      <div class="page-header todos-page-header">
        <div>
          <h1 class="page-header__title">💰 Finance & Settle Up</h1>
          <p class="page-header__subtitle">Sdílené výdaje a přehled, kdo komu dluží</p>
        </div>
        <button class="btn btn--primary" id="fin-btn-add">+ Přidat výdaj</button>
      </div>

      <div class="finance-tabs" role="tablist" aria-label="Sekce finance">
        <button class="finance-tab finance-tab--active" data-tab="expenses" role="tab" aria-selected="true">
          🧾 Výdaje
        </button>
        <button class="finance-tab" data-tab="settle" role="tab" aria-selected="false">
          ⚖️ Vyrovnání
        </button>
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
    </div>

    <!-- Modal: přidat výdaj -->
    <div id="fin-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="fin-modal-title">
      <div class="modal__backdrop" id="fin-modal-backdrop"></div>
      <div class="modal__content">
        <div class="modal__header">
          <h2 class="modal__title" id="fin-modal-title">Přidat výdaj</h2>
          <button class="modal__close" id="fin-modal-close" aria-label="Zavřít">✕</button>
        </div>
        <form id="fin-form" novalidate>
          <div class="modal__body">
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
                <label for="fin-paidby" class="form-label">Zaplatil/a <span class="required" aria-label="povinné">*</span></label>
                <select id="fin-paidby" class="form-select" required></select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Rozdělit mezi <span class="required" aria-label="povinné">*</span></label>
              <p class="form-hint" style="margin-bottom:var(--space-2)">Rovným dílem mezi zaškrtnuté členy</p>
              <div id="fin-split-checkboxes" class="fin-split-checkboxes"></div>
            </div>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn btn--ghost" id="fin-form-cancel">Zrušit</button>
            <button type="submit" class="btn btn--primary" id="fin-form-submit">Přidat výdaj</button>
          </div>
        </form>
      </div>
    </div>
  `;
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

/* ════════════════════════════════════════════════════════════
   FIRESTORE
   ════════════════════════════════════════════════════════════ */

function subscribe() {
  const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
  _unsub = onSnapshot(q, (snap) => {
    _expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderExpenses();
    if (_tab === 'settle') renderSettle();
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
  if (tab === 'settle') renderSettle();
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

  const total    = _expenses.reduce((s, e) => s + (e.amountJpy ?? 0), 0);
  const myShare  = _expenses.reduce((s, e) => {
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
      </div>
      <div class="fin-summary-item">
        <span class="fin-summary-label">Můj podíl</span>
        <span class="fin-summary-value">${fmtJpy(Math.round(myShare))}</span>
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
  const names      = exp.splitWithNicknames?.join(', ') ?? '';
  const timeStr    = exp.createdAt?.toDate ? fmtTime(exp.createdAt.toDate()) : '';
  const isMe       = exp.paidByUid === state.user?.uid;

  return `
    <article class="expense-card card${isMe ? ' expense-card--mine' : ''}" role="listitem" data-id="${exp.id}">
      <div class="expense-card__main">
        <div class="expense-card__info">
          <h3 class="expense-card__title">${esc(exp.description)}</h3>
          <div class="expense-card__meta">
            <span class="todo-meta-chip">
              <span aria-hidden="true">${esc(exp.paidByAvatar ?? '😊')}</span>
              ${esc(exp.paidByNickname ?? '—')} zaplatil/a
            </span>
            ${names ? `<span class="todo-meta-chip">👥 ${esc(names)}</span>` : ''}
            ${timeStr ? `<span class="todo-meta-chip todo-meta-chip--muted">${timeStr}</span>` : ''}
          </div>
        </div>
        <div class="expense-card__amounts">
          <span class="expense-amount">${fmtJpy(exp.amountJpy)}</span>
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
            <span class="settle-amount">${fmtJpy(Math.round(tx.amount))}</span>
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
    if (bal > 0.5)   credits.push({ uid, amount: bal });
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
   MODAL
   ════════════════════════════════════════════════════════════ */

function openModal() {
  _container?.querySelector('#fin-form')?.reset();
  fillPaidBySelect();
  fillSplitCheckboxes();
  _container?.querySelector('#fin-modal')?.classList.remove('hidden');
  _container?.querySelector('#fin-desc')?.focus();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  _container?.querySelector('#fin-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const descEl   = _container.querySelector('#fin-desc');
  const amountEl = _container.querySelector('#fin-amount');
  const paidByEl = _container.querySelector('#fin-paidby');

  const description = descEl.value.trim();
  const amountRaw   = amountEl.value;
  const paidByUid   = paidByEl.value;

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

  const paidByMember     = _members.find(m => m.uid === paidByUid);
  const splitNicknames   = splitUids
    .map(uid => _members.find(m => m.uid === uid)?.nickname)
    .filter(Boolean);

  const submitBtn = _container.querySelector('#fin-form-submit');
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, 'expenses'), {
      description,
      amountJpy:          Number(amountRaw),
      paidByUid,
      paidByNickname:     paidByMember?.nickname ?? '—',
      paidByAvatar:       paidByMember?.avatar   ?? '😊',
      splitWithUids:      splitUids,
      splitWithNicknames: splitNicknames,
      authorUid:          state.user.uid,
      createdAt:          serverTimestamp(),
    });
    showToast('Výdaj přidán! 💰', 'success');
    closeModal();
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

function fmtTime(date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)          return 'před chvílí';
  if (diff < 3_600_000)       return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)      return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000)  return `před ${Math.floor(diff / 86_400_000)} dny`;
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
