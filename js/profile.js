/** profile.js – Profil uživatele. Bude implementován v kroku 2. */
import { state } from './app.js';

export function render(container) {
  const { profile, user, isAdmin } = state;
  const nickname = profile?.nickname || '—';
  const avatar   = profile?.avatar   || '😊';
  const email    = user?.email       || '—';

  container.innerHTML = `
    <div class="page" style="max-width:600px">
      <div class="page-header">
        <h1 class="page-header__title">👤 Profil</h1>
      </div>
      <div class="card" style="text-align:center;padding:40px">
        <div style="font-size:72px;margin-bottom:16px">${avatar}</div>
        <h2 style="font-size:1.5rem;margin-bottom:4px">${nickname}</h2>
        <p style="color:var(--text-secondary);margin-bottom:8px">${email}</p>
        ${isAdmin ? '<span class="admin-chip">⚙️ Admin</span>' : ''}
        <p style="color:var(--text-muted);font-size:.875rem;margin-top:24px">
          Možnost editace profilu bude dostupná v dalším kroku implementace.
        </p>
      </div>
    </div>`;
}
