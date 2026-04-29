/**
 * wishlist.js – Skupinový Wishlist s real-time synchronizací přes Firestore.
 */
import { db } from './firebase-config.js';
import { state, showToast, showConfirm } from './app.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Konstanty ───────────────────────────────────────────────── */

const CATEGORIES = {
  food:       { label: 'Jídlo',     emoji: '🍜' },
  culture:    { label: 'Kultura',   emoji: '⛩️' },
  nature:     { label: 'Příroda',   emoji: '🌸' },
  shopping:   { label: 'Shopping',  emoji: '🛍️' },
  nightlife:  { label: 'Nightlife', emoji: '🍻' },
  experience: { label: 'Zážitky',   emoji: '🎢' },
  transport:  { label: 'Doprava',   emoji: '🚄' },
  stay:       { label: 'Ubytování', emoji: '🏨' },
  other:      { label: 'Ostatní',   emoji: '✨' },
};

const PRIORITIES = {
  must:  { label: 'Must-have',       emoji: '🔴', cssClass: 'priority--must' },
  nice:  { label: 'Nice-to-have',    emoji: '🟡', cssClass: 'priority--nice' },
  maybe: { label: 'Pokud zbyde čas', emoji: '🟢', cssClass: 'priority--maybe' },
};

/* ── Stav modulu ─────────────────────────────────────────────── */

let _unsubIdeas    = null;
let _unsubComments = null;
let _editingId     = null;
let _openCommentsId = null;
let _ideasCache    = [];
let _authorsCache  = new Set();
let _citiesCache   = new Set();
let _filters       = { category: '', priority: '', author: '', city: '' };
let _sort          = 'newest';
let _container     = null;
let _onEsc         = null;

/* ════════════════════════════════════════════════════════════
   RENDER (entry point)
   ════════════════════════════════════════════════════════════ */

export function render(container) {
  _container      = container;
  _editingId      = null;
  _openCommentsId = null;
  _filters        = { category: '', priority: '', author: '', city: '' };
  _sort           = 'newest';
  _ideasCache     = [];

  container.innerHTML = buildShell();

  /* Tlačítko + modal */
  container.querySelector('#wl-btn-add')
    ?.addEventListener('click', () => openModal());
  container.querySelector('#wl-modal-backdrop')
    ?.addEventListener('click', closeModal);
  container.querySelector('#wl-modal-close')
    ?.addEventListener('click', closeModal);
  container.querySelector('#wl-form-cancel')
    ?.addEventListener('click', closeModal);
  container.querySelector('#wl-form')
    ?.addEventListener('submit', handleFormSubmit);

  /* Toolbar */
  setupToolbar();

  /* Comments panel */
  container.querySelector('#wl-comments-backdrop')
    ?.addEventListener('click', closeCommentsPanel);
  container.querySelector('#wl-comments-close')
    ?.addEventListener('click', closeCommentsPanel);
  container.querySelector('#wl-comment-send')
    ?.addEventListener('click', sendComment);
  container.querySelector('#wl-comment-input')
    ?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
    });

  /* Grid – event delegation (přežije innerHTML update) */
  container.querySelector('#wl-grid')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) { handleCardAction(btn); return; }
      if (e.target.closest('#wl-reset-filters')) resetFilters();
      if (e.target.closest('#wl-empty-add')) openModal();
    });

  /* ESC klávesa */
  _onEsc = (e) => {
    if (e.key !== 'Escape') return;
    const modal = _container?.querySelector('#wl-modal');
    if (modal && !modal.classList.contains('hidden')) { closeModal(); return; }
    const panel = _container?.querySelector('#wl-comments-panel');
    if (panel && !panel.classList.contains('hidden')) { closeCommentsPanel(); }
  };
  document.addEventListener('keydown', _onEsc);

  subscribeIdeas();
  return cleanup;
}

function cleanup() {
  if (_onEsc) {
    document.removeEventListener('keydown', _onEsc);
    _onEsc = null;
  }
  _unsubIdeas?.();
  _unsubIdeas = null;
  _unsubComments?.();
  _unsubComments = null;
  document.body.style.overflow = '';
  _container = null;
  _ideasCache = [];
  _authorsCache = new Set();
  _citiesCache  = new Set();
}

/* ── HTML Shell ──────────────────────────────────────────────── */

function buildShell() {
  const categoryOptions = Object.entries(CATEGORIES)
    .map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`)
    .join('');
  const priorityOptions = Object.entries(PRIORITIES)
    .map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`)
    .join('');

  return `
    <div class="page page--wide">
      <div class="page-header wishlist-page-header">
        <div>
          <h1 class="page-header__title">⭐ Skupinový Wishlist</h1>
          <p class="page-header__subtitle">Nápady na aktivity, jídlo a místa v Japonsku</p>
        </div>
        <button class="btn btn--primary" id="wl-btn-add">+ Přidat nápad</button>
      </div>

      <div class="wishlist-toolbar" role="search" aria-label="Filtry a řazení">
        <div class="wishlist-filters">
          <select class="form-select wishlist-filter-select" id="wl-filter-category" aria-label="Filtr kategorie">
            <option value="">Všechny kategorie</option>
            ${categoryOptions}
          </select>
          <select class="form-select wishlist-filter-select" id="wl-filter-priority" aria-label="Filtr priority">
            <option value="">Všechny priority</option>
            ${priorityOptions}
          </select>
          <select class="form-select wishlist-filter-select" id="wl-filter-author" aria-label="Filtr autora">
            <option value="">Všichni autoři</option>
          </select>
          <select class="form-select wishlist-filter-select" id="wl-filter-city" aria-label="Filtr města">
            <option value="">Všechna města</option>
          </select>
        </div>
        <select class="form-select wishlist-sort-select" id="wl-sort" aria-label="Řazení">
          <option value="newest">🕐 Nejnovější</option>
          <option value="likes">👍 Nejvíc lajků</option>
          <option value="cosigns">✋ Nejvíc co-signů</option>
          <option value="alpha">🔤 Abecedně</option>
        </select>
      </div>

      <p class="wishlist-count" id="wl-count" aria-live="polite"></p>

      <div class="wishlist-grid" id="wl-grid" role="list" aria-label="Seznam nápadů">
        <div class="wl-skeletons" id="wl-loading" aria-label="Načítání…">
          <div class="skeleton skeleton--card" style="height:200px"></div>
          <div class="skeleton skeleton--card" style="height:200px"></div>
          <div class="skeleton skeleton--card" style="height:200px"></div>
        </div>
      </div>
    </div>

    <!-- Modal: přidat / upravit nápad -->
    <div id="wl-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="wl-modal-title">
      <div class="modal__backdrop" id="wl-modal-backdrop"></div>
      <div class="modal__content">
        <div class="modal__header">
          <h2 class="modal__title" id="wl-modal-title">Přidat nápad</h2>
          <button class="modal__close" id="wl-modal-close" aria-label="Zavřít">✕</button>
        </div>
        <form id="wl-form" novalidate>
          <div class="modal__body">
            <div class="form-group">
              <label for="wl-title" class="form-label">Název <span class="required" aria-label="povinné">*</span></label>
              <input type="text" id="wl-title" class="form-input" placeholder="Např. Ramen v Ichiran" maxlength="100" required autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="wl-desc" class="form-label">Popis <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
              <textarea id="wl-desc" class="form-textarea" placeholder="Proč to chceš zažít? Kde přesně?" maxlength="500"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="wl-category" class="form-label">Kategorie <span class="required" aria-label="povinné">*</span></label>
                <select id="wl-category" class="form-select" required>
                  <option value="">— Vybrat —</option>
                  ${categoryOptions}
                </select>
              </div>
              <div class="form-group">
                <label for="wl-priority" class="form-label">Priorita <span class="required" aria-label="povinné">*</span></label>
                <select id="wl-priority" class="form-select" required>
                  <option value="">— Vybrat —</option>
                  ${priorityOptions}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="wl-city" class="form-label">Město <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
                <input type="text" id="wl-city" class="form-input" placeholder="Tokio, Kjóto…" maxlength="50" autocomplete="off" />
              </div>
              <div class="form-group">
                <label for="wl-price" class="form-label">Cena JPY <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
                <input type="number" id="wl-price" class="form-input" placeholder="1500" min="0" max="9999999" />
              </div>
            </div>
            <div class="form-group">
              <label for="wl-duration" class="form-label">Délka v hodinách <span class="text-muted" style="font-weight:400">(volitelné)</span></label>
              <input type="number" id="wl-duration" class="form-input" placeholder="2" min="0.5" max="72" step="0.5" style="max-width:180px" />
            </div>
          </div>
          <div class="modal__footer">
            <button type="button" class="btn btn--ghost" id="wl-form-cancel">Zrušit</button>
            <button type="submit" class="btn btn--primary" id="wl-form-submit">Přidat nápad</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Panel komentářů -->
    <div id="wl-comments-panel" class="comments-panel hidden" role="dialog" aria-modal="true" aria-labelledby="wl-comments-title">
      <div class="comments-panel__backdrop" id="wl-comments-backdrop"></div>
      <div class="comments-panel__inner">
        <div class="comments-panel__header">
          <h3 class="comments-panel__title" id="wl-comments-title">Komentáře</h3>
          <button class="modal__close" id="wl-comments-close" aria-label="Zavřít komentáře">✕</button>
        </div>
        <div class="comments-panel__list" id="wl-comments-list" aria-live="polite"></div>
        <div class="comments-panel__form">
          <input type="text" id="wl-comment-input" class="form-input" placeholder="Napsat komentář…" maxlength="300" autocomplete="off" aria-label="Nový komentář" />
          <button class="btn btn--primary" id="wl-comment-send">Odeslat</button>
        </div>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════
   MODAL
   ════════════════════════════════════════════════════════════ */

function openModal(idea = null) {
  _editingId = idea?.id ?? null;

  const titleEl  = _container.querySelector('#wl-modal-title');
  const submitEl = _container.querySelector('#wl-form-submit');

  if (idea) {
    titleEl.textContent  = 'Upravit nápad';
    submitEl.textContent = 'Uložit změny';
    _container.querySelector('#wl-title').value    = idea.title        ?? '';
    _container.querySelector('#wl-desc').value     = idea.description  ?? '';
    _container.querySelector('#wl-category').value = idea.category     ?? '';
    _container.querySelector('#wl-priority').value = idea.priority     ?? '';
    _container.querySelector('#wl-city').value     = idea.city         ?? '';
    _container.querySelector('#wl-price').value    = idea.priceJpy     ?? '';
    _container.querySelector('#wl-duration').value = idea.durationHours ?? '';
  } else {
    titleEl.textContent  = 'Přidat nápad';
    submitEl.textContent = 'Přidat nápad';
    _container.querySelector('#wl-form').reset();
  }

  _container.querySelectorAll('#wl-form .error').forEach(el => el.classList.remove('error'));
  _container.querySelector('#wl-modal').classList.remove('hidden');
  _container.querySelector('#wl-title').focus();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  _container?.querySelector('#wl-modal')?.classList.add('hidden');
  _editingId = null;
  document.body.style.overflow = '';
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const titleEl    = _container.querySelector('#wl-title');
  const categoryEl = _container.querySelector('#wl-category');
  const priorityEl = _container.querySelector('#wl-priority');

  const title    = titleEl.value.trim();
  const category = categoryEl.value;
  const priority = priorityEl.value;

  let valid = true;
  [[titleEl, !title], [categoryEl, !category], [priorityEl, !priority]].forEach(([el, err]) => {
    el.classList.toggle('error', err);
    if (err) valid = false;
  });

  if (!valid) {
    showToast('Vyplň povinná pole: Název, Kategorie, Priorita.', 'warning');
    if (!title) titleEl.focus();
    return;
  }

  const submitBtn = _container.querySelector('#wl-form-submit');
  submitBtn.disabled = true;

  const priceRaw = _container.querySelector('#wl-price').value;
  const durRaw   = _container.querySelector('#wl-duration').value;

  const payload = {
    title,
    description:   _container.querySelector('#wl-desc').value.trim(),
    category,
    priority,
    city:          _container.querySelector('#wl-city').value.trim(),
    priceJpy:      priceRaw ? Number(priceRaw) : null,
    durationHours: durRaw   ? Number(durRaw)   : null,
    updatedAt:     serverTimestamp(),
  };

  try {
    if (_editingId) {
      await updateDoc(doc(db, 'ideas', _editingId), payload);
      showToast('Nápad upraven! ✏️', 'success');
    } else {
      await addDoc(collection(db, 'ideas'), {
        ...payload,
        authorUid:      state.user.uid,
        authorNickname: state.profile.nickname,
        authorAvatar:   state.profile.avatar ?? '😊',
        likes:          [],
        cosigns:        [],
        createdAt:      serverTimestamp(),
      });
      showToast('Nápad přidán! ⭐', 'success');
    }
    closeModal();
  } catch (err) {
    console.error('[wishlist] save error:', err);
    showToast('Nepodařilo se uložit. Zkontroluj připojení.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════════
   TOOLBAR
   ════════════════════════════════════════════════════════════ */

function setupToolbar() {
  ['category', 'priority', 'author', 'city'].forEach(key => {
    _container.querySelector(`#wl-filter-${key}`)?.addEventListener('change', (e) => {
      _filters[key] = e.target.value;
      renderGrid();
    });
  });
  _container.querySelector('#wl-sort')?.addEventListener('change', (e) => {
    _sort = e.target.value;
    renderGrid();
  });
}

/* ════════════════════════════════════════════════════════════
   FIRESTORE – IDEAS
   ════════════════════════════════════════════════════════════ */

function subscribeIdeas() {
  const q = query(collection(db, 'ideas'), orderBy('createdAt', 'desc'));
  _unsubIdeas = onSnapshot(q, (snap) => {
    _ideasCache   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _authorsCache = new Set(_ideasCache.map(i => i.authorNickname).filter(Boolean));
    _citiesCache  = new Set(_ideasCache.map(i => i.city).filter(Boolean));
    updateFilterOptions();
    renderGrid();
  }, (err) => {
    console.error('[wishlist] onSnapshot error:', err);
    showToast('Chyba při načítání wishlistu.', 'error');
  });
}

function updateFilterOptions() {
  const authorSel = _container?.querySelector('#wl-filter-author');
  if (authorSel) {
    const cur = authorSel.value;
    authorSel.innerHTML = '<option value="">Všichni autoři</option>'
      + [..._authorsCache].sort().map(a =>
          `<option value="${esc(a)}"${a === cur ? ' selected' : ''}>${esc(a)}</option>`
        ).join('');
  }
  const citySel = _container?.querySelector('#wl-filter-city');
  if (citySel) {
    const cur = citySel.value;
    citySel.innerHTML = '<option value="">Všechna města</option>'
      + [..._citiesCache].sort().map(c =>
          `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`
        ).join('');
  }
}

/* ── Render grid ─────────────────────────────────────────────── */

function renderGrid() {
  const grid  = _container?.querySelector('#wl-grid');
  const count = _container?.querySelector('#wl-count');
  if (!grid) return;

  /* Odstraň skeleton při prvním renderu */
  _container.querySelector('#wl-loading')?.remove();

  let ideas = [..._ideasCache];

  if (_filters.category) ideas = ideas.filter(i => i.category       === _filters.category);
  if (_filters.priority)  ideas = ideas.filter(i => i.priority       === _filters.priority);
  if (_filters.author)    ideas = ideas.filter(i => i.authorNickname === _filters.author);
  if (_filters.city)      ideas = ideas.filter(i => i.city           === _filters.city);

  switch (_sort) {
    case 'likes':   ideas.sort((a, b) => (b.likes?.length ?? 0)   - (a.likes?.length ?? 0));   break;
    case 'cosigns': ideas.sort((a, b) => (b.cosigns?.length ?? 0) - (a.cosigns?.length ?? 0)); break;
    case 'alpha':   ideas.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'cs'));   break;
    default: /* newest – Firestore pořadí zachováno */ break;
  }

  if (count) {
    count.textContent = ideas.length
      ? `${ideas.length} ${pluralIdeas(ideas.length)}`
      : '';
  }

  grid.innerHTML = ideas.length
    ? ideas.map(buildIdeaCard).join('')
    : buildEmptyState();
}

function pluralIdeas(n) {
  if (n === 1) return 'nápad';
  if (n >= 2 && n <= 4) return 'nápady';
  return 'nápadů';
}

function resetFilters() {
  _filters = { category: '', priority: '', author: '', city: '' };
  ['category', 'priority', 'author', 'city'].forEach(k => {
    const el = _container?.querySelector(`#wl-filter-${k}`);
    if (el) el.value = '';
  });
  renderGrid();
}

/* ── Idea card ───────────────────────────────────────────────── */

function buildIdeaCard(idea) {
  const uid     = state.user?.uid ?? '';
  const cat     = CATEGORIES[idea.category] ?? { label: idea.category ?? '?', emoji: '✨' };
  const pri     = PRIORITIES[idea.priority] ?? { label: idea.priority ?? '?', emoji: '⚪', cssClass: '' };
  const liked   = idea.likes?.includes(uid);
  const cosigned = idea.cosigns?.includes(uid);
  const canEdit = idea.authorUid === uid;
  const canDelete = idea.authorUid === uid || state.isAdmin;

  const meta = [];
  if (idea.city)          meta.push(`📍 ${esc(idea.city)}`);
  if (idea.priceJpy != null) meta.push(`💴 ${Number(idea.priceJpy).toLocaleString('cs-CZ')} JPY`);
  if (idea.durationHours != null) meta.push(`⏱️ ${idea.durationHours} h`);

  const timeStr = idea.createdAt?.toDate ? fmtTime(idea.createdAt.toDate()) : '';

  return `
    <article class="idea-card card" role="listitem" data-id="${idea.id}">
      <div class="idea-card__badges">
        <span class="badge badge--indigo"><span aria-hidden="true">${cat.emoji}</span> ${esc(cat.label)}</span>
        <span class="badge ${pri.cssClass}"><span aria-hidden="true">${pri.emoji}</span> ${esc(pri.label)}</span>
      </div>
      <h3 class="idea-card__title">${esc(idea.title)}</h3>
      ${idea.description ? `<p class="idea-card__desc">${esc(idea.description)}</p>` : ''}
      ${meta.length ? `<div class="idea-card__meta">${meta.join('<span class="idea-card__meta-sep" aria-hidden="true"> · </span>')}</div>` : ''}
      <div class="idea-card__author">
        <span class="idea-card__avatar" aria-hidden="true">${esc(idea.authorAvatar ?? '😊')}</span>
        <span class="idea-card__author-name">${esc(idea.authorNickname ?? '—')}</span>
        ${timeStr ? `<span class="idea-card__time">${timeStr}</span>` : ''}
      </div>
      <div class="idea-card__actions">
        <button class="idea-action-btn${liked ? ' idea-action-btn--active' : ''}"
          data-action="like" data-id="${idea.id}"
          aria-pressed="${liked}" aria-label="${liked ? 'Odebrat lajk' : 'Lajknout'}">
          <span aria-hidden="true">👍</span>
          <span class="idea-action-btn__count">${idea.likes?.length ?? 0}</span>
        </button>
        <button class="idea-action-btn${cosigned ? ' idea-action-btn--active idea-action-btn--cosign' : ''}"
          data-action="cosign" data-id="${idea.id}"
          aria-pressed="${cosigned}" aria-label="${cosigned ? 'Odebrat \'I já chci\'' : 'I já chci'}">
          <span aria-hidden="true">✋</span>
          <span class="idea-action-btn__count">${idea.cosigns?.length ?? 0}</span>
        </button>
        <button class="idea-action-btn"
          data-action="comments" data-id="${idea.id}"
          aria-label="Komentáře">
          <span aria-hidden="true">💬</span>
        </button>
        ${canEdit || canDelete ? `<div class="idea-action-sep" aria-hidden="true"></div>` : ''}
        ${canEdit ? `
          <button class="idea-action-btn idea-action-btn--edit"
            data-action="edit" data-id="${idea.id}" aria-label="Upravit nápad">
            <span aria-hidden="true">✏️</span>
          </button>` : ''}
        ${canDelete ? `
          <button class="idea-action-btn idea-action-btn--delete"
            data-action="delete" data-id="${idea.id}" aria-label="Smazat nápad">
            <span aria-hidden="true">🗑️</span>
          </button>` : ''}
      </div>
    </article>
  `;
}

function buildEmptyState() {
  const hasFilters = Object.values(_filters).some(Boolean);
  return `
    <div class="empty-state" style="grid-column:1/-1">
      <span class="empty-state__icon" aria-hidden="true">${hasFilters ? '🔍' : '⭐'}</span>
      <h2 class="empty-state__title">${hasFilters ? 'Nic nenalezeno' : 'Wishlist je prázdný'}</h2>
      <p class="empty-state__desc">
        ${hasFilters
          ? 'Zkus upravit nebo resetovat filtry.'
          : 'Buď první, kdo přidá nápad na Wishlist!'}
      </p>
      ${hasFilters
        ? `<button class="btn btn--secondary" id="wl-reset-filters">Resetovat filtry</button>`
        : `<button class="btn btn--primary"   id="wl-empty-add">+ Přidat nápad</button>`}
    </div>`;
}

/* ── Card action dispatcher ──────────────────────────────────── */

function handleCardAction(btn) {
  const { action, id } = btn.dataset;
  if (!id) return;
  switch (action) {
    case 'like':     toggleLike(id);    break;
    case 'cosign':   toggleCosign(id);  break;
    case 'comments': openComments(id);  break;
    case 'edit': {
      const idea = _ideasCache.find(i => i.id === id);
      if (idea) openModal(idea);
      break;
    }
    case 'delete': confirmDelete(id); break;
  }
}

/* ── Lajk ────────────────────────────────────────────────────── */

async function toggleLike(ideaId) {
  const uid  = state.user?.uid;
  if (!uid) return;
  const idea = _ideasCache.find(i => i.id === ideaId);
  if (!idea) return;
  try {
    await updateDoc(doc(db, 'ideas', ideaId), {
      likes: idea.likes?.includes(uid) ? arrayRemove(uid) : arrayUnion(uid),
    });
  } catch (err) {
    console.error('[wishlist] toggleLike:', err);
    showToast('Nepodařilo se uložit lajk.', 'error');
  }
}

/* ── Co-sign ─────────────────────────────────────────────────── */

async function toggleCosign(ideaId) {
  const uid  = state.user?.uid;
  if (!uid) return;
  const idea = _ideasCache.find(i => i.id === ideaId);
  if (!idea) return;
  try {
    await updateDoc(doc(db, 'ideas', ideaId), {
      cosigns: idea.cosigns?.includes(uid) ? arrayRemove(uid) : arrayUnion(uid),
    });
  } catch (err) {
    console.error('[wishlist] toggleCosign:', err);
    showToast('Nepodařilo se uložit.', 'error');
  }
}

/* ── Delete ──────────────────────────────────────────────────── */

async function confirmDelete(ideaId) {
  const idea = _ideasCache.find(i => i.id === ideaId);
  if (!idea) return;
  const ok = await showConfirm(
    'Smazat nápad',
    `Opravdu smazat „${idea.title}"? Tato akce je nevratná.`,
    'Smazat'
  );
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'ideas', ideaId));
    showToast('Nápad smazán.', 'success');
  } catch (err) {
    console.error('[wishlist] delete:', err);
    showToast('Nepodařilo se smazat nápad.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   KOMENTÁŘE
   ════════════════════════════════════════════════════════════ */

function openComments(ideaId) {
  if (_openCommentsId === ideaId) { closeCommentsPanel(); return; }

  _openCommentsId = ideaId;
  _unsubComments?.();

  const idea  = _ideasCache.find(i => i.id === ideaId);
  const panel = _container.querySelector('#wl-comments-panel');
  const title = _container.querySelector('#wl-comments-title');

  if (title && idea) title.textContent = `💬 ${idea.title}`;

  const list = _container.querySelector('#wl-comments-list');
  if (list) list.innerHTML = '<div class="skeleton skeleton--text" style="margin:var(--space-4)"></div>';

  panel?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const q = query(
    collection(db, 'ideas', ideaId, 'idea_comments'),
    orderBy('createdAt', 'asc')
  );
  _unsubComments = onSnapshot(q, (snap) => {
    renderComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[wishlist] comments snapshot:', err);
    showToast('Chyba při načítání komentářů.', 'error');
  });

  _container.querySelector('#wl-comment-input')?.focus();
}

function closeCommentsPanel() {
  _unsubComments?.();
  _unsubComments  = null;
  _openCommentsId = null;
  _container?.querySelector('#wl-comments-panel')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function renderComments(comments) {
  const list = _container?.querySelector('#wl-comments-list');
  if (!list) return;

  if (!comments.length) {
    list.innerHTML = `
      <div class="comments-empty">
        <span aria-hidden="true" style="font-size:2rem">💬</span>
        <p>Zatím žádné komentáře. Buď první!</p>
      </div>`;
    return;
  }

  list.innerHTML = comments.map(c => {
    const isMe  = c.authorUid === state.user?.uid;
    const tStr  = c.createdAt?.toDate ? fmtTime(c.createdAt.toDate()) : '';
    return `
      <div class="comment-item${isMe ? ' comment-item--me' : ''}">
        <span class="comment-item__avatar" aria-hidden="true">${esc(c.authorAvatar ?? '😊')}</span>
        <div class="comment-item__bubble">
          <span class="comment-item__author">${esc(c.authorNickname ?? '—')}</span>
          <p class="comment-item__text">${esc(c.text)}</p>
          ${tStr ? `<span class="comment-item__time">${tStr}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

async function sendComment() {
  if (!_openCommentsId) return;
  const input = _container?.querySelector('#wl-comment-input');
  const text  = input?.value.trim();
  if (!text) return;

  const btn = _container?.querySelector('#wl-comment-send');
  if (btn) btn.disabled = true;

  try {
    await addDoc(collection(db, 'ideas', _openCommentsId, 'idea_comments'), {
      text,
      authorUid:      state.user.uid,
      authorNickname: state.profile.nickname,
      authorAvatar:   state.profile.avatar ?? '😊',
      createdAt:      serverTimestamp(),
    });
    if (input) input.value = '';
  } catch (err) {
    console.error('[wishlist] sendComment:', err);
    showToast('Nepodařilo se odeslat komentář.', 'error');
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

/* ════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtTime(date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000)        return 'před chvílí';
  if (diff < 3_600_000)     return `před ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000)    return `před ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 7 * 86_400_000) return `před ${Math.floor(diff / 86_400_000)} dny`;
  return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' });
}
