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
    const role = snap.exists() ? snap.data().role : "viewer";
    onReady(user, role);
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

export function canManage(role) {
  return role === "admin" || role === "manager";
}
