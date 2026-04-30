import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-auth.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-firestore.js';
import { getStorage }    from 'https://www.gstatic.com/firebasejs/11.5.0/firebase-storage.js';

const firebaseConfig = {
  apiKey:            "AIzaSyB7BFQFLlHgmmVVjfJMPGujzbAxddFyIR8",
  authDomain:        "japan-web-app.web.app",
  projectId:         "japan-web-app",
  storageBucket:     "japan-web-app.firebasestorage.app",
  messagingSenderId: "931635362119",
  appId:             "1:931635362119:web:a8f84b1a6cecf7903a7462",
  measurementId:     "G-ZH6P5BNQ73",
};

const app = initializeApp(firebaseConfig);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
export default app;
