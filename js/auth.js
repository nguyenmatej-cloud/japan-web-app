/**
 * auth.js – Firebase Authentication + Firestore whitelist/profile.
 * Neobsahuje žádnou DOM logiku – to patří do app.js.
 */
import { auth, db } from './firebase-config.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Provider ─────────────────────────────────────────────── */

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

/* ── Detekce iOS Safari (signInWithRedirect jako fallback) ── */

function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/* ── Sign-in ─────────────────────────────────────────────── */

export async function signInWithGoogle() {
  if (isIOS()) {
    // iOS Safari blokuje popupy → použij redirect
    return signInWithRedirect(auth, provider);
  }
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request'
    ) {
      // Popup blokován → fallback na redirect
      return signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

/**
 * Volej při startu aplikace – zachytí výsledek redirect sign-in (iOS).
 * Vrátí UserCredential nebo null.
 */
export async function checkRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (err) {
    console.warn('[auth] getRedirectResult error:', err.code);
    return null;
  }
}

/* ── Sign-out ─────────────────────────────────────────────── */

export async function signOut() {
  await fbSignOut(auth);
}

/* ── Auth state listener ─────────────────────────────────── */

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ── Whitelist ────────────────────────────────────────────── */

/**
 * Vrátí data dokumentu z `allowed_users/{email}` nebo null.
 * Dokument existuje → uživatel má přístup.
 * Pole `role: "admin"` → admin přístup.
 */
export async function checkWhitelist(email) {
  const ref  = doc(db, 'allowed_users', email.toLowerCase().trim());
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/* ── User profile ─────────────────────────────────────────── */

/** Vrátí profil uživatele z `users/{uid}` nebo null. */
export async function getUserProfile(uid) {
  const ref  = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? { uid, ...snap.data() } : null;
}

/** Vytvoří nový profil uživatele (volá se po onboardingu). */
export async function createUserProfile(uid, email, nickname, avatar) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, {
    email,
    nickname:  nickname.trim(),
    avatar:    avatar || '😊',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLogin: serverTimestamp(),
  });
}

/** Aktualizuje libovolná pole profilu (merge). */
export async function updateUserProfile(uid, data) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

/** Aktualizuje čas posledního přihlášení. */
export async function updateLastLogin(uid) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
}

/* ── Chybové hlášky ──────────────────────────────────────── */

export function getAuthErrorMessage(code) {
  const map = {
    'auth/popup-closed-by-user':   'Přihlášení bylo zrušeno.',
    'auth/cancelled-popup-request':'Přihlášení bylo zrušeno.',
    'auth/popup-blocked':          'Prohlížeč zablokoval popup. Zkusíme přesměrování…',
    'auth/network-request-failed': 'Chyba sítě. Zkontroluj připojení k internetu.',
    'auth/too-many-requests':      'Příliš mnoho pokusů o přihlášení. Zkus to za chvíli.',
    'auth/user-disabled':          'Tento Google účet byl zablokován.',
    'auth/account-exists-with-different-credential':
      'Účet s tímto emailem již existuje s jiným způsobem přihlášení.',
  };
  return map[code] ?? 'Chyba při přihlašování. Zkus to znovu.';
}
