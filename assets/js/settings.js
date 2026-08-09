import { db, auth } from "../../services/firebase.js";
import { requireAuth } from "../../services/auth-guard.js";
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const passwordForm = document.getElementById("passwordForm");
const passwordStatus = document.getElementById("passwordStatus");
const companyForm = document.getElementById("companyForm");
const companyStatus = document.getElementById("companyStatus");
const companySaveBtn = document.getElementById("companySaveBtn");

passwordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = document.getElementById("currentPassword").value;
  const next = document.getElementById("newPassword").value;
  const confirm = document.getElementById("confirmPassword").value;

  if (next !== confirm) {
    passwordStatus.textContent = "كلمة المرور الجديدة وتأكيدها غير متطابقين.";
    passwordStatus.className = "small mt-2 text-danger";
    return;
  }

  try {
    const user = auth.currentUser;
    const credential = EmailAuthProvider.credential(user.email, current);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, next);
    passwordStatus.textContent = "تم تحديث كلمة المرور بنجاح.";
    passwordStatus.className = "small mt-2 text-success";
    passwordForm.reset();
  } catch (err) {
    passwordStatus.textContent = "تعذر التحديث: " + (err.code === "auth/invalid-credential" ? "كلمة المرور الحالية غير صحيحة." : err.message);
    passwordStatus.className = "small mt-2 text-danger";
  }
});

companyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await setDoc(doc(db, "settings", "company"), {
      name: document.getElementById("companyName").value.trim(),
      phone: document.getElementById("companyPhone").value.trim(),
      email: document.getElementById("companyEmail").value.trim(),
      address: document.getElementById("companyAddress").value.trim(),
      website: document.getElementById("companyWebsite").value.trim(),
      updatedAt: serverTimestamp()
    });
    companyStatus.textContent = "تم الحفظ بنجاح.";
    companyStatus.className = "small mt-2 text-success";
  } catch (err) {
    companyStatus.textContent = "تعذر الحفظ: " + err.message;
    companyStatus.className = "small mt-2 text-danger";
  }
});

requireAuth(async (user, role) => {
  document.getElementById("accountEmail").textContent = `مسجل دخول بإيميل: ${user.email}`;

  if (role !== "admin") {
    [...companyForm.querySelectorAll("input")].forEach((el) => (el.disabled = true));
    companySaveBtn.classList.add("d-none");
  }

  try {
    const snap = await getDoc(doc(db, "settings", "company"));
    if (snap.exists()) {
      const c = snap.data();
      if (c.name) document.getElementById("companyName").value = c.name;
      if (c.phone) document.getElementById("companyPhone").value = c.phone;
      if (c.email) document.getElementById("companyEmail").value = c.email;
      if (c.address) document.getElementById("companyAddress").value = c.address;
      if (c.website) document.getElementById("companyWebsite").value = c.website;
    }
  } catch {
    /* keep the default placeholder values shown in the form */
  }
});
