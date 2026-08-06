import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const tbody = document.getElementById("companiesBody");
const searchInput = document.getElementById("searchInput");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("companyForm");
const modalEl = document.getElementById("companyModal");
const modal = new bootstrap.Modal(modalEl);

let allCompanies = [];
let userCanManage = false;

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const rows = term ? allCompanies.filter((c) => (c.name || "").toLowerCase().includes(term)) : allCompanies;

  countLabel.textContent = `${rows.length} من ${allCompanies.length} شركة`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-building"></i>ماكو شركات مسجلة بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((c) => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.sector || "—"}</td>
      <td>${c.contactPerson || "—"}</td>
      <td dir="ltr" class="text-end">${c.phone || "—"}</td>
      <td>${c.email || "—"}</td>
      <td class="text-nowrap">
        ${userCanManage ? `
          <button class="btn-icon" data-edit="${c.id}" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger" data-delete="${c.id}" title="حذف"><i class="bi bi-trash"></i></button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allCompanies.find((c) => c.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف هذه الشركة؟")) return;
      try {
        await deleteDoc(doc(db, "companies", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

function openModal(company) {
  form.reset();
  document.getElementById("companyId").value = company?.id || "";
  document.getElementById("companyModalTitle").textContent = company ? "تعديل الشركة" : "إضافة شركة";
  document.getElementById("name").value = company?.name || "";
  document.getElementById("sector").value = company?.sector || "";
  document.getElementById("contactPerson").value = company?.contactPerson || "";
  document.getElementById("phone").value = company?.phone || "";
  document.getElementById("email").value = company?.email || "";
  document.getElementById("address").value = company?.address || "";
  document.getElementById("notes").value = company?.notes || "";
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
searchInput.addEventListener("input", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("companyId").value;
  const data = {
    name: document.getElementById("name").value.trim(),
    sector: document.getElementById("sector").value.trim(),
    contactPerson: document.getElementById("contactPerson").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    email: document.getElementById("email").value.trim(),
    address: document.getElementById("address").value.trim(),
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "companies", id), data);
    } else {
      await addDoc(collection(db, "companies"), { ...data, createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  userCanManage = canManage(role);
  if (!userCanManage) document.getElementById("addBtn").classList.add("d-none");
  const q = query(collection(db, "companies"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allCompanies = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
