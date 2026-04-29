/** photos.js – Google Photos integrace. Bude implementován v kroku 4. */
export function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-header__title">📸 Fotky</h1>
        <p class="page-header__subtitle">Sdílené album skupiny z Japonska</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">📸</span>
        <h2 class="empty-state__title">Fotky – připravujeme!</h2>
        <p class="empty-state__desc">
          Sdílené Google Photos album pro celou skupinu.<br>
          Bude dostupné v kroku 4 implementace.
        </p>
      </div>
    </div>`;
}
