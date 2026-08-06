import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Secondary app instance so admins can create new team members
// (createUserWithEmailAndPassword) without losing their own signed-in session.
export function getSecondaryAuth() {
  const name = "Secondary";
  const secondaryApp = getApps().find((a) => a.name === name) || initializeApp(firebaseConfig, name);
  return getAuth(secondaryApp);
}
