/**
 * app.js – Hlavní entry point.
 * Zodpovídá za auth flow, UI orchestraci, navigaci a téma.
 */
import {
  signInWithGoogle,
  checkRedirectResult,
  checkWhitelist,
  getUserProfile,
  createUserProfile,
  updateLastLogin,
  signOut,
  onAuthChange,
  getAuthErrorMessage,
} from './auth.js';
import { Router } from './router.js';

/* ── Konstanty ───────────────────────────────────────────────── */

const DEPARTURE        = new Date('2026-09-07T00:00:00+02:00');
const PLANNING_DEADLINE = new Date('2026-07-22T00:00:00+02:00');

const AVATAR_OPTIONS = [
  '😊','😄','🤩','😎','🥳','😴','🤔','🧐',
  '🦊','🐼','🐸','🦁','🐯','🦄','🐺','🦝',
  '🌸','🌊','🍣','🍜','🎯','🚀','⭐','💎',
  '🎸','🎮','🏔️','🌙','🍺','🌺',
];

const SIDEBAR_NAV = [
  { route: 'dashboard',   label: 'Dashboard',    emoji: '🏠' },
  { route: 'map',         label: 'Mapa',          emoji: '🗺️' },
  { route: 'wishlist',    label: 'Wishlist',      emoji: '⭐' },
  { route: 'members',     label: 'Členové',        emoji: '👥' },
  { route: 'itinerary',   label: 'Itinerář',      emoji: '📅' },
  { route: 'todos',       label: 'Úkoly',          emoji: '✅' },
  { route: 'finance',     label: 'Finance',        emoji: '💰' },
  { route: 'photos',      label: 'Fotky',          emoji: '📸' },
  { route: 'chat',        label: 'Chat',           emoji: '💬' },
  { route: 'japan-utils', label: 'Japonsko info',  emoji: '🗾' },
];

const BOTTOM_NAV = [
  { route: 'dashboard',  label: 'Domů',     emoji: '🏠' },
  { route: 'wishlist',   label: 'Wishlist', emoji: '⭐' },
  { route: 'itinerary',  label: 'Itinerář', emoji: '📅' },
  { route: 'todos',      label: 'Úkoly',    emoji: '✅' },
  { route: 'more',       label: 'Více',     emoji: '⋯', isMore: true },
];

/* ── Sdílený stav (exportován pro moduly) ────────────────────── */

export const state = {
  user:    null,   // Firebase User objekt
  profile: null,   // Firestore profil {uid, email, nickname, avatar, …}
  isAdmin: false,
};

/* ── Router instance ─────────────────────────────────────────── */

let router = null;

/* ── Onboarding stav ─────────────────────────────────────────── */

let onboardingStep   = 1;
const TOTAL_STEPS    = 6;
let selectedAvatar   = '😊';
let currentFirebaseUser = null; // dočasně pro onboarding

/* ── Confirm dialog promise callbacks ────────────────────────── */

let _confirmResolve = null;

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */

async function init() {
  initTheme();
  setupGlobalEventListeners();

  // Redirect result (iOS Google Sign-In po přesměrování)
  await checkRedirectResult().catch(() => null);

  // Poslouchej změny auth stavu
  onAuthChange(async (user) => {
    if (user) {
      await handleUserSignedIn(user);
    } else {
      showScreen('auth');
    }
  });
}

/* ════════════════════════════════════════════════════════════
   AUTH FLOW
   ════════════════════════════════════════════════════════════ */

async function handleUserSignedIn(user) {
  showScreen('loading');

  try {
    // Whitelist check
    const allowedData = await checkWhitelist(user.email);
    if (!allowedData) {
      await signOut();
      const deniedEmail = document.getElementById('denied-email');
      if (deniedEmail) deniedEmail.textContent = user.email;
      showScreen('denied');
      return;
    }

    state.user    = user;
    state.isAdmin = allowedData.role === 'admin';

    // Profil check
    const profile = await getUserProfile(user.uid);

    if (!profile || !profile.nickname) {
      // Nový uživatel – onboarding
      currentFirebaseUser = user;
      showScreen('onboarding');
      initOnboarding(user);
    } else {
      // Vracející se uživatel
      state.profile = profile;
      await updateLastLogin(user.uid);
      showAppUI();
    }
  } catch (err) {
    console.error('[app] handleUserSignedIn error:', err);
    showToast('Chyba při přihlašování. Zkus to znovu.', 'error');
    showScreen('auth');
  }
}

/* ════════════════════════════════════════════════════════════
   OBRAZOVKY
   ════════════════════════════════════════════════════════════ */

function showScreen(name) {
  const map = {
    loading:    'splash-screen',
    auth:       'auth-screen',
    denied:     'access-denied-screen',
    onboarding: 'onboarding-modal',
    app:        'app',
  };

  // Schovat vše
  Object.values(map).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  // Zobrazit cíl
  document.getElementById(map[name])?.classList.remove('hidden');
}

/* ════════════════════════════════════════════════════════════
   APP UI
   ════════════════════════════════════════════════════════════ */

function showAppUI() {
  buildSidebarNav();
  buildBottomNav();
  updateUserDisplay();
  showAdminItems();
  updatePhaseBadge();
  startSidebarCountdown();
  showScreen('app');

  if (!router) {
    router = new Router({
      'dashboard':    () => import('./dashboard.js'),
      'map':          () => import('./map-page.js'),
      'wishlist':     () => import('./wishlist.js'),
      'itinerary':    () => import('./itinerary.js'),
      'todos':        () => import('./todos.js'),
      'finance':      () => import('./finance.js'),
      'photos':       () => import('./photos.js'),
      'chat':         () => import('./chat.js'),
      'japan-utils':  () => import('./japan-utils.js'),
      'members':      () => import('./members.js'),
      'profile':      () => import('./profile.js'),
      'admin':        () => import('./admin.js'),
    });
    router.start(
      document.getElementById('main-content'),
      document.getElementById('page-title')
    );
  } else {
    // Router již existuje – jen znovu načti aktuální route
    router._onHashChange();
  }

  // Sleduj nepřečtené zprávy v chatu globálně (badge v sidebaru)
  import('./chat.js').then(m => m.trackUnreadGlobally?.()).catch(() => {});
}

/* ── Sidebar nav ─────────────────────────────────────────────── */

function buildSidebarNav() {
  const ul = document.getElementById('sidebar-nav');
  if (!ul) return;

  ul.innerHTML = SIDEBAR_NAV.map(item => `
    <li>
      <a href="#${item.route}" class="sidebar__nav-item" data-route="${item.route}">
        <span class="nav-emoji" aria-hidden="true">${item.emoji}</span>
        <span>${item.label}</span>
      </a>
    </li>
  `).join('');

  // Oddělovač + profil + admin
  ul.innerHTML += `
    <li><hr class="sidebar__nav-separator" role="separator"></li>
    <li>
      <a href="#profile" class="sidebar__nav-item" data-route="profile">
        <span class="nav-emoji" aria-hidden="true">👤</span>
        <span>Profil</span>
      </a>
    </li>
    <li>
      <a href="#admin" class="sidebar__nav-item admin-only hidden" data-route="admin">
        <span class="nav-emoji" aria-hidden="true">⚙️</span>
        <span>Admin panel</span>
      </a>
    </li>
  `;
}

/* ── Bottom nav ──────────────────────────────────────────────── */

function buildBottomNav() {
  const ul = document.getElementById('bottom-nav-list');
  if (!ul) return;

  ul.innerHTML = BOTTOM_NAV.map(item => `
    <li>
      <a href="${item.isMore ? '#' : `#${item.route}`}"
         class="bottom-nav__item${item.isMore ? ' bottom-nav__item--more' : ''}"
         data-route="${item.route}"
         ${item.isMore ? 'data-action="open-more"' : ''}>
        <span class="nav-emoji" aria-hidden="true">${item.emoji}</span>
        <span>${item.label}</span>
      </a>
    </li>
  `).join('');

  ul.querySelector('[data-action="open-more"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openMoreSheet();
  });
}

/* ── User display ────────────────────────────────────────────── */

function updateUserDisplay() {
  const { profile, user } = state;
  const nickname = profile?.nickname || user?.displayName || '—';
  const avatar   = profile?.avatar   || '😊';
  const email    = user?.email || '';

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('header-avatar',     avatar);
  set('dropdown-avatar',   avatar);
  set('dropdown-nickname', nickname);
  set('dropdown-email',    email);
}

function showAdminItems() {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !state.isAdmin);
  });
}

/* ── Phase badge ─────────────────────────────────────────────── */

function updatePhaseBadge() {
  const el = document.getElementById('phase-badge-text');
  if (!el) return;
  const isPlanning = Date.now() < PLANNING_DEADLINE.getTime();
  el.textContent = isPlanning ? 'Fáze 1 – Plánování' : 'Fáze 2 – Realizace';
}

/* ── Sidebar countdown ───────────────────────────────────────── */

function startSidebarCountdown() {
  const el = document.getElementById('sidebar-countdown');
  if (!el) return;

  function tick() {
    const diff = DEPARTURE.getTime() - Date.now();
    if (diff <= 0) {
      el.innerHTML = '✈️ <strong>Letíme!</strong>';
      return;
    }
    const days = Math.floor(diff / 86_400_000);
    el.innerHTML = `✈️ Za <strong>${days}</strong> dní do Japonska`;
  }

  tick();
  const id = setInterval(tick, 60_000);
  // Cleanup při odhlášení není nutný – malý interval
  return () => clearInterval(id);
}

/* ════════════════════════════════════════════════════════════
   ONBOARDING
   ════════════════════════════════════════════════════════════ */

function initOnboarding(user) {
  onboardingStep = 1;
  selectedAvatar = '😊';

  buildAvatarPicker();
  updateOnboardingCountdown();
  renderOnboardingStep();

  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');

  // Odstraň staré listenery (re-init safety)
  prevBtn?.replaceWith(prevBtn.cloneNode(true));
  nextBtn?.replaceWith(nextBtn.cloneNode(true));

  document.getElementById('onboarding-prev')
    ?.addEventListener('click', onboardingGoBack);

  document.getElementById('onboarding-next')
    ?.addEventListener('click', () => onboardingGoNext(user));
}

function buildAvatarPicker() {
  const picker = document.getElementById('avatar-picker');
  if (!picker) return;

  picker.innerHTML = AVATAR_OPTIONS.map(emoji => `
    <button
      type="button"
      class="avatar-picker__option${emoji === selectedAvatar ? ' selected' : ''}"
      data-emoji="${emoji}"
      role="option"
      aria-selected="${emoji === selectedAvatar}"
      aria-label="Avatar ${emoji}"
    >${emoji}</button>
  `).join('');

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.avatar-picker__option');
    if (!btn) return;
    selectedAvatar = btn.dataset.emoji;
    picker.querySelectorAll('.avatar-picker__option').forEach(b => {
      const active = b.dataset.emoji === selectedAvatar;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-selected', String(active));
    });
  });
}

function updateOnboardingCountdown() {
  const el = document.getElementById('onboarding-countdown');
  if (!el) return;
  const diff = DEPARTURE.getTime() - Date.now();
  if (diff <= 0) { el.textContent = '✈️ Letíme!'; return; }
  const days  = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  el.textContent = `${days} dní a ${hours} hodin`;
}

function renderOnboardingStep() {
  // Zobraz správný krok
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const el = document.getElementById(`onboarding-step-${i}`);
    if (el) el.classList.toggle('hidden', i !== onboardingStep);
  }

  // Aktualizuj step 2 class
  const step2 = document.getElementById('onboarding-step-2');
  if (step2) step2.classList.toggle('step--form', true);

  // Progress bar
  const bar = document.getElementById('onboarding-progress-bar');
  if (bar) bar.style.width = `${Math.round((onboardingStep / TOTAL_STEPS) * 100)}%`;

  // Indikátor
  const indicator = document.getElementById('onboarding-step-indicator');
  if (indicator) indicator.textContent = `${onboardingStep} / ${TOTAL_STEPS}`;

  // Tlačítka
  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');

  if (prevBtn) prevBtn.disabled = onboardingStep === 1;
  if (nextBtn) {
    nextBtn.textContent = onboardingStep === TOTAL_STEPS ? 'Jdeme na to! 🚀' : 'Dál →';
  }
}

function onboardingGoBack() {
  if (onboardingStep > 1) {
    onboardingStep--;
    renderOnboardingStep();
  }
}

async function onboardingGoNext(user) {
  // Validace kroku 2 – přezdívka
  if (onboardingStep === 2) {
    const input    = document.getElementById('onboarding-nickname');
    const nickname = input?.value.trim();

    if (!nickname) {
      input?.classList.add('error');
      input?.focus();
      showToast('Přezdívka je povinná!', 'warning');
      return;
    }
    if (nickname.length > 20) {
      input?.classList.add('error');
      showToast('Přezdívka může mít max. 20 znaků.', 'warning');
      return;
    }

    input?.classList.remove('error');

    // Ulož profil do Firestore hned po kroku 2
    try {
      await createUserProfile(user.uid, user.email, nickname, selectedAvatar);
      state.profile = { uid: user.uid, email: user.email, nickname, avatar: selectedAvatar };
    } catch (err) {
      console.error('[app] createUserProfile error:', err);
      showToast('Chyba při ukládání profilu. Zkontroluj připojení.', 'error');
      return;
    }
  }

  if (onboardingStep < TOTAL_STEPS) {
    onboardingStep++;
    if (onboardingStep === TOTAL_STEPS) updateOnboardingCountdown();
    renderOnboardingStep();
  } else {
    // Onboarding dokončen
    showAppUI();
    showToast(`Vítej, ${state.profile?.nickname}! 🎉`, 'success');
  }
}

/* ════════════════════════════════════════════════════════════
   TÉMA
   ════════════════════════════════════════════════════════════ */

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const icon = theme === 'dark' ? '☀️' : '🌙';
  const iconEl = document.getElementById('theme-icon');
  if (iconEl) iconEl.textContent = icon;
  window.dispatchEvent(new CustomEvent('themechange'));
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ════════════════════════════════════════════════════════════
   GLOBÁLNÍ EVENT LISTENERS
   ════════════════════════════════════════════════════════════ */

function setupGlobalEventListeners() {
  /* Google sign-in */
  const googleBtn = document.getElementById('btn-google-login');
  const originalBtnHTML = googleBtn?.innerHTML ?? '';

  googleBtn?.addEventListener('click', async () => {
    const errorEl = document.getElementById('auth-error');
    errorEl?.classList.add('hidden');

    googleBtn.disabled = true;
    googleBtn.innerHTML = '<span aria-hidden="true">⏳</span> Přihlašuji…';

    try {
      await signInWithGoogle();
      // onAuthStateChanged se postará o zbytek (popup)
      // Pro redirect Firebase přesměruje stránku
    } catch (err) {
      console.error('[app] signInWithGoogle error:', err);
      const msg = getAuthErrorMessage(err.code);
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
      }
      googleBtn.disabled  = false;
      googleBtn.innerHTML = originalBtnHTML;
    }
  });

  /* Odhlášení – hlavní */
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

  /* Odhlášení – přístup zamítnut */
  document.getElementById('btn-logout-denied')?.addEventListener('click', async () => {
    await signOut();
    showScreen('auth');
  });

  /* Přepnutí tématu */
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);

  /* Sidebar toggle (mobile) */
  const sidebarToggle  = document.getElementById('btn-sidebar-toggle');
  const sidebar        = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function toggleSidebar(open) {
    sidebar?.classList.toggle('open', open);
    sidebarOverlay?.classList.toggle('hidden', !open);
    sidebarToggle?.setAttribute('aria-expanded', String(open));
    sidebarToggle?.classList.toggle('active', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  sidebarToggle?.addEventListener('click', () => {
    toggleSidebar(!sidebar?.classList.contains('open'));
  });

  sidebarOverlay?.addEventListener('click', () => toggleSidebar(false));

  // Zavři sidebar při kliknutí na nav item (mobile)
  sidebar?.addEventListener('click', (e) => {
    if (e.target.closest('[data-route]') && window.innerWidth < 1024) {
      toggleSidebar(false);
    }
  });

  /* User dropdown */
  const userMenuBtn = document.getElementById('btn-user-menu');
  const dropdown    = document.getElementById('user-dropdown');

  userMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown?.classList.toggle('hidden') === false;
    userMenuBtn.setAttribute('aria-expanded', String(open));
    // classList.toggle returns true if class is NOW present (hidden)
    // Opravíme: pokud hidden chybí = dropdown je viditelný
    const visible = !dropdown?.classList.contains('hidden');
    userMenuBtn.setAttribute('aria-expanded', String(visible));
  });

  document.addEventListener('click', () => {
    dropdown?.classList.add('hidden');
    userMenuBtn?.setAttribute('aria-expanded', 'false');
  });

  /* Confirm dialog */
  document.getElementById('confirm-cancel')?.addEventListener('click', () => {
    document.getElementById('confirm-dialog')?.classList.add('hidden');
    _confirmResolve?.(false);
    _confirmResolve = null;
  });

  document.getElementById('confirm-ok')?.addEventListener('click', () => {
    document.getElementById('confirm-dialog')?.classList.add('hidden');
    _confirmResolve?.(true);
    _confirmResolve = null;
  });

  document.getElementById('confirm-backdrop')?.addEventListener('click', () => {
    document.getElementById('confirm-dialog')?.classList.add('hidden');
    _confirmResolve?.(false);
    _confirmResolve = null;
  });

  /* More sheet backdrop */
  document.getElementById('more-sheet-backdrop')?.addEventListener('click', closeMoreSheet);

  /* More sheet nav items – zavři při navigaci */
  document.addEventListener('click', (e) => {
    if (e.target.closest('#more-sheet .sheet-nav-item')) closeMoreSheet();
  });

  /* ESC klávesa */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Zavři dropdown
    dropdown?.classList.add('hidden');
    // Zavři sidebar
    if (sidebar?.classList.contains('open')) toggleSidebar(false);
    // Zavři more sheet
    const moreSheet = document.getElementById('more-sheet');
    if (!moreSheet?.classList.contains('hidden')) closeMoreSheet();
    // Zavři confirm dialog
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog?.classList.contains('hidden')) {
      dialog.classList.add('hidden');
      _confirmResolve?.(false);
      _confirmResolve = null;
    }
  });
}

/* ════════════════════════════════════════════════════════════
   BOTTOM SHEET "VÍCE"
   ════════════════════════════════════════════════════════════ */

function openMoreSheet() {
  const sheet    = document.getElementById('more-sheet');
  const backdrop = document.getElementById('more-sheet-backdrop');
  if (!sheet || !backdrop) return;

  backdrop.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
  setupSheetSwipe(sheet);
}

function closeMoreSheet() {
  const sheet    = document.getElementById('more-sheet');
  const backdrop = document.getElementById('more-sheet-backdrop');
  if (!sheet || !backdrop) return;

  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  setTimeout(() => {
    sheet.classList.add('hidden');
    backdrop.classList.add('hidden');
  }, 350);
  document.body.style.overflow = '';
}

function setupSheetSwipe(sheet) {
  let startY = 0, currentY = 0, isDragging = false;

  const onStart = (e) => {
    startY     = e.touches ? e.touches[0].clientY : e.clientY;
    isDragging = true;
    sheet.style.transition = 'none';
  };

  const onMove = (e) => {
    if (!isDragging) return;
    currentY   = e.touches ? e.touches[0].clientY : e.clientY;
    const diff = currentY - startY;
    if (diff > 0) sheet.style.transform = `translateY(${diff}px)`;
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = '';
    sheet.style.transform  = '';
    if (currentY - startY > 100) closeMoreSheet();
  };

  const handle = sheet.querySelector('.bottom-sheet__handle');
  handle?.addEventListener('touchstart', onStart, { passive: true });
  handle?.addEventListener('touchmove',  onMove,  { passive: true });
  handle?.addEventListener('touchend',   onEnd);
}


async function handleLogout() {
  const confirmed = await showConfirm('Odhlásit se?', 'Chceš se opravdu odhlásit?');
  if (!confirmed) return;
  try {
    await signOut();
    state.user    = null;
    state.profile = null;
    state.isAdmin = false;
    router?.stop();
    router = null;
    showScreen('auth');
    document.getElementById('user-dropdown')?.classList.add('hidden');
  } catch (err) {
    console.error('[app] signOut error:', err);
    showToast('Chyba při odhlašování.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   TOAST NOTIFIKACE (exportovány pro moduly)
   ════════════════════════════════════════════════════════════ */

const TOAST_ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${TOAST_ICONS[type] ?? 'ℹ️'}</span>
    <span class="toast__message">${message}</span>
  `;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

/* ════════════════════════════════════════════════════════════
   CONFIRM DIALOG (exportován pro moduly)
   ════════════════════════════════════════════════════════════ */

export function showConfirm(title, message, dangerLabel = 'Potvrdit') {
  return new Promise((resolve) => {
    _confirmResolve = resolve;

    const dialog = document.getElementById('confirm-dialog');
    const titleEl   = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn     = document.getElementById('confirm-ok');

    if (titleEl)   titleEl.textContent   = title;
    if (messageEl) messageEl.textContent = message;
    if (okBtn)     okBtn.textContent     = dangerLabel;

    dialog?.classList.remove('hidden');
  });
}

/* ════════════════════════════════════════════════════════════
   START
   ════════════════════════════════════════════════════════════ */

init().catch(err => console.error('[app] Init error:', err));
