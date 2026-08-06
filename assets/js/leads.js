import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STATUS_LABELS = { new: "جديد", contacted: "تم التواصل", closed: "مغلق" };

const tbody = document.getElementById("leadsBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");

let allLeads = [];
let userCanManage = false;

function formatDate(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  const filter = statusFilter.value;
  const rows = filter === "all" ? allLeads : allLeads.filter((l) => l.status === filter);

  countLabel.textContent = `${rows.length} من ${allLeads.length} طلب`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><i class="bi bi-inbox"></i>ماكو طلبات بهذه الحالة</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((lead) => `
    <tr>
      <td><strong>${lead.name || "—"}</strong></td>
      <td>${lead.company || "—"}</td>
      <td dir="ltr" class="text-end">${lead.phone || "—"}</td>
      <td>${lead.type || "—"}</td>
      <td style="max-width:220px;white-space:normal">${lead.message || "—"}</td>
      <td>${formatDate(lead.createdAt)}</td>
      <td>
        ${userCanManage
          ? `<select class="status-select" data-id="${lead.id}">
              ${Object.entries(STATUS_LABELS).map(([val, label]) =>
                `<option value="${val}" ${lead.status === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>`
          : `<span class="status-badge status-${lead.status || "new"}">${STATUS_LABELS[lead.status] || "جديد"}</span>`
        }
      </td>
      <td>${userCanManage ? `<button class="btn-icon danger" data-delete="${lead.id}" title="حذف"><i class="bi bi-trash"></i></button>` : ""}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      try {
        await updateDoc(doc(db, "leads", id), { status: e.target.value });
      } catch (err) {
        alert("تعذر تحديث الحالة: " + err.message);
      }
    });
  });

  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.delete;
      if (!confirm("تأكيد حذف هذا الطلب؟")) return;
      try {
        await deleteDoc(doc(db, "leads", id));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

requireAuth((user, role) => {
  userCanManage = canManage(role);
  const q = query(collection(db, "leads"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allLeads = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});

statusFilter.addEventListener("change", render);
