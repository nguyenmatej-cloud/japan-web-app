/** todos.js – To-Do List. Bude implementován v kroku 3. */
export function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-header__title">✅ Úkoly</h1>
        <p class="page-header__subtitle">Společný to-do list skupiny</p>
      </div>
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">✅</span>
        <h2 class="empty-state__title">Úkoly – připravujeme!</h2>
        <p class="empty-state__desc">
          Přiřazuj úkoly členům skupiny, sleduj stav a deadliny.<br>
          Bude dostupné v kroku 3 implementace.
        </p>
      </div>
    </div>`;
}
