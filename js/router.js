/**
 * router.js – Jednoduchý hash-based router s lazy loadingem modulů.
 *
 * Každý modul musí exportovat:
 *   export function render(container): void | (() => void)
 *   Volitelně vrátí cleanup funkci, která se zavolá při opuštění stránky.
 */

const ROUTE_LABELS = {
  'dashboard':   'Dashboard',
  'wishlist':    'Wishlist',
  'itinerary':   'Itinerář',
  'todos':       'Úkoly',
  'finance':     'Finance',
  'photos':      'Fotky',
  'chat':        'Chat',
  'japan-utils': 'Japonsko info',
  'profile':     'Profil',
  'admin':       'Admin panel',
};

export class Router {
  /**
   * @param {Object<string, () => Promise<{render: Function}>>} routes
   *   Mapa route → lazy import funkce
   */
  constructor(routes) {
    this.routes      = routes;
    this.container   = null;
    this.titleEl     = null;
    this.currentRoute = null;
    this.cleanupFn   = null;
    this._bound      = this._onHashChange.bind(this);
  }

  /**
   * Spustí router.
   * @param {HTMLElement} container  Cílový element pro renderování stránek
   * @param {HTMLElement} titleEl    Element pro nadpis stránky (#page-title)
   */
  start(container, titleEl) {
    this.container = container;
    this.titleEl   = titleEl;
    window.addEventListener('hashchange', this._bound);
    this._onHashChange();
  }

  stop() {
    window.removeEventListener('hashchange', this._bound);
    this._runCleanup();
  }

  navigate(route) {
    window.location.hash = route;
  }

  getCurrentRoute() {
    return this.currentRoute;
  }

  /* ── Interní ─────────────────────────────────────────────── */

  _onHashChange() {
    const hash = window.location.hash.slice(1) || 'dashboard';
    this._loadRoute(hash);
  }

  async _loadRoute(route) {
    this.currentRoute = route;

    // Nadpis stránky
    const label = ROUTE_LABELS[route] || route;
    if (this.titleEl) this.titleEl.textContent = label;
    document.title = `${label} – Japonsko 2026`;

    // Aktivní stavy v navigaci
    this._updateNav(route);

    // Cleanup předchozí stránky
    this._runCleanup();

    // Scroll nahoru
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (this.container) this.container.scrollTop = 0;

    // Loader skeletons
    this._renderLoading();

    const loader = this.routes[route];
    if (!loader) {
      this._renderComingSoon(label);
      return;
    }

    try {
      const module  = await loader();
      this.container.innerHTML = '';
      const cleanup = await module.render(this.container);
      if (typeof cleanup === 'function') {
        this.cleanupFn = cleanup;
      }
    } catch (err) {
      console.error(`[Router] Nelze načíst modul "${route}":`, err);
      this._renderComingSoon(label);
    }
  }

  _updateNav(route) {
    document.querySelectorAll('[data-route]').forEach(el => {
      const active = el.dataset.route === route;
      el.classList.toggle('active', active);
      el.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  _runCleanup() {
    if (typeof this.cleanupFn === 'function') {
      try { this.cleanupFn(); } catch {}
      this.cleanupFn = null;
    }
  }

  _renderLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="page" aria-busy="true" aria-label="Načítání…">
        <div class="skeleton skeleton--title" style="max-width:280px"></div>
        <div class="skeleton skeleton--card" style="height:140px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div class="skeleton skeleton--card" style="height:100px"></div>
          <div class="skeleton skeleton--card" style="height:100px"></div>
        </div>
        <div class="skeleton skeleton--card" style="height:200px;margin-top:12px"></div>
      </div>`;
  }

  _renderComingSoon(label) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="page">
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden="true">🚧</span>
          <h2 class="empty-state__title">${label} – bude brzy</h2>
          <p class="empty-state__desc">
            Tato sekce je ve výstavbě a bude přidána v dalším kroku.
          </p>
        </div>
      </div>`;
  }
}
