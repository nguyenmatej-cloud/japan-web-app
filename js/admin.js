/** admin.js – Admin Panel. Bude implementován v kroku 5. */
import { state } from './app.js';

export function render(container) {
  if (!state.isAdmin) {
    container.innerHTML = `
      <div class="page">
        <div class="empty-state">
          <span class="empty-state__icon" aria-hidden="true">🚫</span>
          <h2 class="empty-state__title">Přístup zamítnut</h2>
          <p class="empty-state__desc">Tato sekce je dostupná pouze pro admina.</p>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-header__title">⚙️ Admin Panel</h1>
        <p class="page-header__subtitle">Správa aplikace a uživatelů</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">⚙️</span>
        <h2 class="empty-state__title">Admin Panel – připravujeme!</h2>
        <p class="empty-state__desc">
          Správa whitelistu, přepnutí fáze, URL Google Photos alba, mazání obsahu.<br>
          Bude dostupný v kroku 5 implementace.
        </p>
      </div>
    </div>`;
}
