import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function requireAuth(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) {
      // Account was removed from the users collection (offboarded) - the
      // Firebase Auth login still works, so don't fall back to a "viewer"
      // role or they'd keep read access forever. Force them out instead.
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }
    onReady(user, snap.data().role);
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

export function canManage(role) {
  return role === "admin" || role === "manager";
}
