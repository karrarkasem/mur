import { auth, db } from "../../services/firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form = document.getElementById("loginForm");
const statusEl = document.getElementById("loginStatus");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "جاري تسجيل الدخول...";

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      document.getElementById("email").value,
      document.getElementById("password").value
    );

    const userDocument = await getDoc(doc(db, "users", credential.user.uid));
    if (!userDocument.exists()) {
      throw new Error("لا يوجد ملف صلاحيات لهذا المستخدم.");
    }

    localStorage.setItem("murRole", userDocument.data().role || "viewer");
    window.location.href = "dashboard.html";
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.className = "small mt-3 text-danger";
  }
});
