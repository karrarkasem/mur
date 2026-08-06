import { db, getSecondaryAuth } from "../../services/firebase.js";
import { requireAuth } from "../../services/auth-guard.js";
import { createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const ROLE_LABELS = {
  admin: "مدير النظام",
  manager: "مدير",
  sales: "مبيعات",
  marketing: "تسويق",
  technician: "فني",
  viewer: "مشاهدة فقط"
};

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");
const tbody = document.getElementById("usersBody");
const form = document.getElementById("userForm");
const modalEl = document.getElementById("userModal");
const modal = new bootstrap.Modal(modalEl);

let allUsers = [];
let currentUid = null;

function render() {
  if (!allUsers.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><i class="bi bi-people"></i>ماكو مستخدمين بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = allUsers.map((u) => `
    <tr>
      <td><strong>${u.name || "—"}</strong>${u.id === currentUid ? ' <span class="status-badge status-contacted">أنت</span>' : ""}</td>
      <td dir="ltr" class="text-end">${u.email || "—"}</td>
      <td>${ROLE_LABELS[u.role] || u.role || "—"}</td>
      <td><span class="status-badge ${u.active === false ? "status-rejected" : "status-closed"}">${u.active === false ? "موقوف" : "نشط"}</span></td>
      <td class="text-nowrap">
        <select class="status-select" data-role-id="${u.id}">
          ${Object.entries(ROLE_LABELS).map(([val, label]) => `<option value="${val}" ${u.role === val ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <button class="btn-icon" data-toggle="${u.id}" title="${u.active === false ? "تفعيل" : "إيقاف"}"><i class="bi bi-toggle2-${u.active === false ? "off" : "on"}"></i></button>
        ${u.id !== currentUid ? `<button class="btn-icon danger" data-delete="${u.id}" title="حذف"><i class="bi bi-trash"></i></button>` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-role-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      try {
        await updateDoc(doc(db, "users", e.target.dataset.roleId), { role: e.target.value });
      } catch (err) {
        alert("تعذر تحديث الدور: " + err.message);
      }
    });
  });

  tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const user = allUsers.find((u) => u.id === btn.dataset.toggle);
      try {
        await updateDoc(doc(db, "users", btn.dataset.toggle), { active: user.active === false ? true : false });
      } catch (err) {
        alert("تعذر التحديث: " + err.message);
      }
    });
  });

  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف هذا المستخدم؟ (هذا يوقف وصوله للوحة التحكم، بس حساب الدخول نفسه لازم يتحذف يدويًا من Firebase Console إذا تريد منعه نهائيًا)")) return;
      try {
        await deleteDoc(doc(db, "users", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

document.getElementById("addBtn").addEventListener("click", () => {
  form.reset();
  modal.show();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const role = document.getElementById("role").value;

  const secondaryAuth = getSecondaryAuth();
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await setDoc(doc(db, "users", credential.user.uid), {
      name, email, role, active: true, createdAt: serverTimestamp()
    });
    await signOutSecondary(secondaryAuth);
    modal.hide();
  } catch (err) {
    alert("تعذر إنشاء الحساب: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUid = user.uid;
  if (role !== "admin") {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allUsers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
