/**
 * todos.js – Skupinový To-Do list s Firestore real-time sync.
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, getDocs,
} from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';

const PRIORITIES = {
  high:   { label: 'Vysoká',  emoji: '🔴', cssClass: 'priority--must'  },
  medium: { label: 'Střední', emoji: '🟡', cssClass: 'priority--nice'  },
  low:    { label: 'Nízká',   emoji: '🟢', cssClass: 'priority--maybe' },
};

let _unsub      = null;
let _todos      = [];
let _members    = [];
let _container  = null;
let _editingId  = null;
let _filter     = 'all';  // 'all' | 'open' | 'done'
let _filterUser = '';
let _onEsc      = null;

/* ════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container  = container;
  _todos      = [];
  _editingId  = null;
  _filter     = 'all';
  _filterUser = '';

  container.innerHTML = buildShell();

  container.querySelector('#td-btn-add')
    ?.addEventListener('click', () => openModal());
  container.querySelector('#td-modal-backdrop')
    ?.addEventListener('click', closeModal);
  container.querySelector('#td-modal-close')
    ?.addEventListener('click', closeModal);
  container.querySelector('#td-form-cancel')
    ?.addEventListener('click', closeModal);
  container.querySelector('#td-form')
    ?.addEventListener('submit', handleFormSubmit);

  container.querySelector('#td-list')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) handleCardAction(btn);
    });

  setupFilters();

  _onEsc = (e) => {
    if (e.key !== 'Escape') return;
    const modal = _container?.querySelector('#td-modal');
    if (modal && !modal.classList.contains('hidden')) closeModal();
  };
  document.addEventListener('keydown', _onEsc);

  loadMembers().then(() => {
    updateAssigneeFilter();
    updateAssigneeSelect();
  });

  subscribe();
  return cleanup;
}

function cleanup() {
  if (_onEsc) { document.removeEventListener('keydown', _onEsc); _onEsc = null; }
  _unsub?.();
  _unsub     = null;
  _container = null;
  _todos     = [];
  document.body.style.overflow = '';
}

/* ── HTML Shell ──────────────────────────────────────────────── */

function buildShell() {
  return `
    <div class="page">
      <div class="page-header todos-page-header">
        <div>
          <h1 class="page-header__title">✅ Skupinové úkoly</h1>
          <p class="page-header__subtitle">Přiřazuj úkoly, sleduj deadliny a označuj hotové</p>
        </div>
        <button class="btn btn--primary" id="td-btn-add">+ Přidat úkol</button>
      </div>

      <div class="todos-toolbar">
        <div class="todo-status-filters" role="group" aria-label="Filtr stavu">
          <button class="todo-filter-btn todo-filter-btn--active" data-filter="all">Vše</button>
          <button class="todo-filter-btn" data-filter="open">Otevřené</button>
          <button class="todo-filter-btn" data-filter="done">Hotové ✅</button>
        </div>
        <select class="form-select todo-filter-user" id="td-filter-user" aria-label="Filtr přiřazeného">
          <option value="">Všichni členové</option>
        </select>
      </div>

      <p class="wishlist-count" id="td-count" aria-live="polite"></p>

      <div id="td-list" class="todo-list" role="list" aria-label="Seznam úkolů">
        <div class="wl-skeletons" id="td-loading">
          <div class="skeleton skeleton--card" style="height:88px"></div>
          <div class="skeleton skeleton--card" style="height:88px"></div>
          <div class="skeleton skeleton--card" style="height:88px"></div>
        </div>
      </div>
    </div>

    <!-- Modal: přidat / upravit úkol -->
    <div id="td-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="td-modal-title">
      <div class="modal__backdrop" id="td-modal-backdrop"></div>
      <div class="modal__content">
        <div class="modal__header">
          <h2 class="modal__title" id="td-modal-title">Přidat úkol</h2>
          <button class="modal__close" id="td-modal-close" aria-label="Zavřít">✕</button>
        </div>
        <form id="td-form" novalidate>
          <div class="modal__body">
            <div class="form-group">
              <label for="td-title" class="form-label">Název <span class="required" aria-label="povinné">*</span></label>
              <input type="text" id="td-title" class="form-input" placeholder="Např. Koupit JR Pass" maxlength="100" required autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="td-desc" class="form-label">Popis <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
              <textarea id="td-desc" class="form-textarea" placeholder="Detaily úkolu…" maxlength="500"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="td-priority" class="form-label">Priorita <span class="required" aria-label="povinné">*</span></label>
                <select id="td-priority" class="form-select" required>
                  <option value="">— Vybrat —</option>
                  <option value="high">🔴 Vysoká</option>
                  <option value="medium">🟡 Střední</option>
                  <option value="low">🟢 Nízká</option>
                </select>
              </div>
              <div class="form-group">
                <label for="td-deadline" class="form-label">Deadline <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
                <input type="date" id="td-deadline" class="form-input" />
              </div>
            </div>
            <div class="form-group">
              <label for="td-assign" class="form-label">Přiřadit členovi <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
              <select id="td-assign" class="form-select">
                <option value="">— Nepřiřazeno —</option>
              </select>
            </div>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn btn--ghost" id="td-form-cancel">Zrušit</button>
            <button type="submit" class="btn btn--primary" id="td-form-submit">Přidat úkol</button>
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
    console.error('[todos] loadMembers:', err);
  }
}

function updateAssigneeFilter() {
  const sel = _container?.querySelector('#td-filter-user');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Všichni členové</option>'
    + _members.map(m =>
        `<option value="${esc(m.uid)}"${m.uid === cur ? ' selected' : ''}>${esc(m.avatar ?? '😊')} ${esc(m.nickname)}</option>`
      ).join('');
  sel.addEventListener('change', (e) => {
    _filterUser = e.target.value;
    renderList();
  });
}

function updateAssigneeSelect() {
  const sel = _container?.querySelector('#td-assign');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Nepřiřazeno —</option>'
    + _members.map(m =>
        `<option value="${esc(m.uid)}">${esc(m.avatar ?? '😊')} ${esc(m.nickname)}</option>`
      ).join('');
}

/* ════════════════════════════════════════════════════════════
   FIRESTORE
   ════════════════════════════════════════════════════════════ */

function subscribe() {
  const q = query(collection(db, 'todos'), orderBy('createdAt', 'desc'));
  _unsub = onSnapshot(q, (snap) => {
    _todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderList();
  }, (err) => {
    console.error('[todos] onSnapshot:', err);
    showToast('Chyba při načítání úkolů.', 'error');
  });
}

/* ════════════════════════════════════════════════════════════
   RENDER LIST
   ════════════════════════════════════════════════════════════ */

function renderList() {
  const listEl  = _container?.querySelector('#td-list');
  const countEl = _container?.querySelector('#td-count');
  if (!listEl) return;

  _container?.querySelector('#td-loading')?.remove();

  let todos = [..._todos];
  if (_filter === 'open') todos = todos.filter(t => !t.done);
  if (_filter === 'done') todos = todos.filter(t => t.done);
  if (_filterUser) todos = todos.filter(t => t.assignedToUid === _filterUser);

  // Sort: open first, then by priority, then by deadline
  todos.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const priOrder = { high: 0, medium: 1, low: 2 };
    const pa = priOrder[a.priority] ?? 99;
    const pb = priOrder[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return 0;
  });

  if (countEl) {
    countEl.textContent = todos.length
      ? `${todos.length} ${pluralTodos(todos.length)}`
      : '';
  }

  listEl.innerHTML = todos.length
    ? todos.map(t => buildTodoCard(t)).join('')
    : buildEmptyState();
}

function pluralTodos(n) {
  if (n === 1) return 'úkol';
  if (n >= 2 && n <= 4) return 'úkoly';
  return 'úkolů';
}

function buildTodoCard(todo) {
  const pri       = PRIORITIES[todo.priority] ?? { label: '?', emoji: '⚪', cssClass: '' };
  const canEdit   = todo.authorUid === state.user?.uid;
  const canDelete = todo.authorUid === state.user?.uid || state.isAdmin;
  const isOverdue = todo.deadline && !todo.done && isDeadlinePast(todo.deadline);
  const deadlineStr = todo.deadline
    ? formatDeadline(todo.deadline.toDate ? todo.deadline.toDate() : new Date(todo.deadline.seconds * 1000))
    : null;

  return `
    <article class="todo-card card${todo.done ? ' todo-card--done' : ''}" role="listitem" data-id="${todo.id}">
      <button class="todo-check${todo.done ? ' todo-check--done' : ''}"
        data-action="toggle" data-id="${todo.id}"
        aria-pressed="${todo.done}"
        aria-label="${todo.done ? 'Označit jako otevřené' : 'Označit jako hotové'}">
        <span aria-hidden="true">${todo.done ? '✅' : '⬜'}</span>
      </button>
      <div class="todo-card__body">
        <div class="todo-card__header-row">
          <h3 class="todo-card__title">${esc(todo.title)}</h3>
          <span class="badge ${pri.cssClass}">${pri.emoji} ${esc(pri.label)}</span>
        </div>
        ${todo.description ? `<p class="todo-card__desc">${esc(todo.description)}</p>` : ''}
        <div class="todo-card__meta">
          ${todo.assignedToNickname
            ? `<span class="todo-meta-chip"><span aria-hidden="true">${esc(todo.assignedToAvatar ?? '😊')}</span> ${esc(todo.assignedToNickname)}</span>`
            : `<span class="todo-meta-chip todo-meta-chip--muted">Nepřiřazeno</span>`}
          ${deadlineStr
            ? `<span class="todo-meta-chip${isOverdue ? ' todo-meta-chip--overdue' : ''}">
                 <span aria-hidden="true">📅</span> ${deadlineStr}
               </span>`
            : ''}
          <span class="todo-meta-chip todo-meta-chip--muted">
            <span aria-hidden="true">${esc(todo.authorAvatar ?? '😊')}</span> ${esc(todo.authorNickname ?? '—')}
          </span>
        </div>
      </div>
      <div class="todo-card__actions">
        ${canEdit ? `<button class="idea-action-btn idea-action-btn--edit" data-action="edit" data-id="${todo.id}" aria-label="Upravit úkol">✏️</button>` : ''}
        ${canDelete ? `<button class="idea-action-btn idea-action-btn--delete" data-action="delete" data-id="${todo.id}" aria-label="Smazat úkol">🗑️</button>` : ''}
      </div>
    </article>
  `;
}

function buildEmptyState() {
  const hasFilter = _filter !== 'all' || _filterUser;
  return `
    <div class="empty-state">
      <span class="empty-state__icon" aria-hidden="true">${hasFilter ? '🔍' : '✅'}</span>
      <h2 class="empty-state__title">${hasFilter ? 'Žádné úkoly' : 'Žádné úkoly'}</h2>
      <p class="empty-state__desc">${hasFilter ? 'Zkus změnit filtr.' : 'Přidej první skupinový úkol!'}</p>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   FILTRY
   ════════════════════════════════════════════════════════════ */

function setupFilters() {
  _container?.querySelector('.todo-status-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    _filter = btn.dataset.filter;
    _container.querySelectorAll('.todo-filter-btn').forEach(b => {
      b.classList.toggle('todo-filter-btn--active', b === btn);
    });
    renderList();
  });
}

/* ════════════════════════════════════════════════════════════
   CARD ACTIONS
   ════════════════════════════════════════════════════════════ */

function handleCardAction(btn) {
  const { action, id } = btn.dataset;
  if (!id) return;
  switch (action) {
    case 'toggle': toggleDone(id); break;
    case 'edit': {
      const todo = _todos.find(t => t.id === id);
      if (todo) openModal(todo);
      break;
    }
    case 'delete': confirmDelete(id); break;
  }
}

async function toggleDone(todoId) {
  const todo = _todos.find(t => t.id === todoId);
  if (!todo) return;
  try {
    await updateDoc(doc(db, 'todos', todoId), {
      done:      !todo.done,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[todos] toggleDone:', err);
    showToast('Nepodařilo se uložit stav.', 'error');
  }
}

async function confirmDelete(todoId) {
  const todo = _todos.find(t => t.id === todoId);
  if (!todo) return;
  const ok = await showConfirm('Smazat úkol', `Opravdu smazat „${todo.title}"?`, 'Smazat');
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'todos', todoId));
    showToast('Úkol smazán.', 'success');
  } catch (err) {
    console.error('[todos] delete:', err);
    showToast('Nepodařilo se smazat úkol.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   MODAL
   ════════════════════════════════════════════════════════════ */

function openModal(todo = null) {
  _editingId = todo?.id ?? null;

  const titleEl  = _container.querySelector('#td-modal-title');
  const submitEl = _container.querySelector('#td-form-submit');

  if (todo) {
    titleEl.textContent  = 'Upravit úkol';
    submitEl.textContent = 'Uložit změny';
    _container.querySelector('#td-title').value    = todo.title       ?? '';
    _container.querySelector('#td-desc').value     = todo.description ?? '';
    _container.querySelector('#td-priority').value = todo.priority    ?? '';
    _container.querySelector('#td-assign').value   = todo.assignedToUid ?? '';

    if (todo.deadline) {
      const d = todo.deadline.toDate
        ? todo.deadline.toDate()
        : new Date(todo.deadline.seconds * 1000);
      _container.querySelector('#td-deadline').value = d.toISOString().slice(0, 10);
    } else {
      _container.querySelector('#td-deadline').value = '';
    }
  } else {
    titleEl.textContent  = 'Přidat úkol';
    submitEl.textContent = 'Přidat úkol';
    _container.querySelector('#td-form').reset();
  }

  _container.querySelectorAll('#td-form .error').forEach(el => el.classList.remove('error'));
  _container.querySelector('#td-modal').classList.remove('hidden');
  _container.querySelector('#td-title').focus();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  _container?.querySelector('#td-modal')?.classList.add('hidden');
  _editingId = null;
  document.body.style.overflow = '';
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const titleEl    = _container.querySelector('#td-title');
  const priorityEl = _container.querySelector('#td-priority');
  const title      = titleEl.value.trim();
  const priority   = priorityEl.value;

  let valid = true;
  [[titleEl, !title], [priorityEl, !priority]].forEach(([el, err]) => {
    el.classList.toggle('error', err);
    if (err) valid = false;
  });

  if (!valid) {
    showToast('Vyplň povinná pole: Název a Priorita.', 'warning');
    if (!title) titleEl.focus();
    return;
  }

  const submitBtn = _container.querySelector('#td-form-submit');
  submitBtn.disabled = true;

  const deadlineVal = _container.querySelector('#td-deadline').value;
  const assignUid   = _container.querySelector('#td-assign').value;
  const member      = assignUid ? _members.find(m => m.uid === assignUid) : null;

  const payload = {
    title,
    description:        _container.querySelector('#td-desc').value.trim(),
    priority,
    deadline:           deadlineVal ? new Date(deadlineVal) : null,
    assignedToUid:      member?.uid      ?? null,
    assignedToNickname: member?.nickname ?? null,
    assignedToAvatar:   member?.avatar   ?? null,
    updatedAt:          serverTimestamp(),
  };

  try {
    if (_editingId) {
      await updateDoc(doc(db, 'todos', _editingId), payload);
      showToast('Úkol upraven! ✏️', 'success');
    } else {
      await addDoc(collection(db, 'todos'), {
        ...payload,
        done:           false,
        authorUid:      state.user.uid,
        authorNickname: state.profile.nickname,
        authorAvatar:   state.profile.avatar ?? '😊',
        createdAt:      serverTimestamp(),
      });
      showToast('Úkol přidán! ✅', 'success');
    }
    closeModal();
  } catch (err) {
    console.error('[todos] save:', err);
    showToast('Nepodařilo se uložit. Zkontroluj připojení.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function isDeadlinePast(deadline) {
  const d = deadline.toDate ? deadline.toDate() : new Date(deadline.seconds * 1000);
  return d < new Date();
}

function formatDeadline(date) {
  const diff = date.getTime() - Date.now();
  const days = Math.ceil(diff / 86_400_000);
  if (days < 0)  return `Po termínu (${date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' })})`;
  if (days === 0) return 'Dnes';
  if (days === 1) return 'Zítra';
  if (days <= 7)  return `Za ${days} dní`;
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' });
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
