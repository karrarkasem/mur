import { auth, db } from "../../services/firebase.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form = document.getElementById("loginForm");
const statusEl = document.getElementById("loginStatus");

document.getElementById("forgotPasswordLink").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  if (!email) {
    statusEl.textContent = "اكتب إيميلك بالحقل فوق أولاً، وبعدها اضغط \"نسيت كلمة المرور\".";
    statusEl.className = "small mt-3 text-danger";
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    statusEl.textContent = "أرسلنا رابط إعادة تعيين كلمة المرور إلى إيميلك.";
    statusEl.className = "small mt-3 text-success";
  } catch (error) {
    statusEl.textContent = "تعذر الإرسال: " + error.message;
    statusEl.className = "small mt-3 text-danger";
  }
});

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
