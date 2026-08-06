import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STATUS_LABELS = { draft: "مسودة", sent: "مرسل", accepted: "مقبول", rejected: "مرفوض" };

const tbody = document.getElementById("quotesBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("quoteForm");
const modalEl = document.getElementById("quoteModal");
const modal = new bootstrap.Modal(modalEl);

let allQuotes = [];
let userCanManage = false;

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function formatAmount(value) {
  if (!value) return "—";
  return Number(value).toLocaleString("ar-IQ") + " د.ع";
}

function render() {
  const filter = statusFilter.value;
  const rows = filter === "all" ? allQuotes : allQuotes.filter((q) => (q.status || "draft") === filter);

  countLabel.textContent = `${rows.length} من ${allQuotes.length} عرض`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-file-earmark-text"></i>ماكو عروض بهذه الحالة</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((q) => `
    <tr>
      <td><strong>${q.clientName}</strong>${q.notes ? `<br><span class="text-muted small">${q.notes}</span>` : ""}</td>
      <td>${q.companyName || "—"}</td>
      <td>${formatAmount(q.amount)}</td>
      <td>${formatDate(q.validUntil)}</td>
      <td>
        ${userCanManage
          ? `<select class="status-select" data-id="${q.id}">
              ${Object.entries(STATUS_LABELS).map(([val, label]) =>
                `<option value="${val}" ${(q.status || "draft") === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>`
          : `<span class="status-badge status-${q.status || "draft"}">${STATUS_LABELS[q.status] || "مسودة"}</span>`
        }
      </td>
      <td class="text-nowrap">
        ${userCanManage ? `
          <button class="btn-icon" data-edit="${q.id}" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger" data-delete="${q.id}" title="حذف"><i class="bi bi-trash"></i></button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allQuotes.find((q) => q.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف هذا العرض؟")) return;
      try {
        await deleteDoc(doc(db, "quotes", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
  tbody.querySelectorAll("select[data-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      try {
        await updateDoc(doc(db, "quotes", e.target.dataset.id), { status: e.target.value });
      } catch (err) {
        alert("تعذر تحديث الحالة: " + err.message);
      }
    });
  });
}

function openModal(quote) {
  form.reset();
  document.getElementById("quoteId").value = quote?.id || "";
  document.getElementById("quoteModalTitle").textContent = quote ? "تعديل العرض" : "إضافة عرض سعر";
  document.getElementById("clientName").value = quote?.clientName || "";
  document.getElementById("companyName").value = quote?.companyName || "";
  document.getElementById("amount").value = quote?.amount || "";
  document.getElementById("validUntil").value = quote?.validUntil || "";
  document.getElementById("notes").value = quote?.notes || "";
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
statusFilter.addEventListener("change", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("quoteId").value;
  const data = {
    clientName: document.getElementById("clientName").value.trim(),
    companyName: document.getElementById("companyName").value.trim(),
    amount: Number(document.getElementById("amount").value) || 0,
    validUntil: document.getElementById("validUntil").value,
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "quotes", id), data);
    } else {
      await addDoc(collection(db, "quotes"), { ...data, status: "draft", createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  userCanManage = canManage(role);
  if (!userCanManage) document.getElementById("addBtn").classList.add("d-none");
  const q = query(collection(db, "quotes"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allQuotes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
