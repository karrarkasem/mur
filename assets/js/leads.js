import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, updateDoc, deleteDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STATUS_LABELS = { new: "جديد", contacted: "تم التواصل", closed: "مغلق" };

const tbody = document.getElementById("leadsBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");
const modalEl = document.getElementById("leadModal");
const modal = new bootstrap.Modal(modalEl);
const leadModalInfo = document.getElementById("leadModalInfo");
const nextFollowUpInput = document.getElementById("nextFollowUp");
const activityLogEl = document.getElementById("activityLog");
const newActivityText = document.getElementById("newActivityText");

let allLeads = [];
let userCanManage = false;
let currentUserEmail = null;
let openLeadId = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateStr(str) {
  if (!str) return "—";
  return new Date(str).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function followUpBadge(lead) {
  if (!lead.nextFollowUp) return `<span class="text-muted small">—</span>`;
  const isOverdue = lead.nextFollowUp < todayStr();
  const isToday = lead.nextFollowUp === todayStr();
  const cls = isOverdue ? "status-rejected" : isToday ? "status-pending" : "status-contacted";
  return `<span class="status-badge ${cls}">${formatDateStr(lead.nextFollowUp)}</span>`;
}

function render() {
  const filter = statusFilter.value;
  const rows = filter === "all" ? allLeads : allLeads.filter((l) => l.status === filter);

  countLabel.textContent = `${rows.length} من ${allLeads.length} طلب`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><i class="bi bi-inbox"></i>ماكو طلبات بهذه الحالة</td></tr>`;
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
      <td>${followUpBadge(lead)}</td>
      <td>
        ${userCanManage
          ? `<select class="status-select" data-id="${lead.id}">
              ${Object.entries(STATUS_LABELS).map(([val, label]) =>
                `<option value="${val}" ${lead.status === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>`
          : `<span class="status-badge status-${lead.status || "new"}">${STATUS_LABELS[lead.status] || "جديد"}</span>`
        }
      </td>
      <td class="text-nowrap">
        <button class="btn-icon" data-followup="${lead.id}" title="متابعة"><i class="bi bi-clock-history"></i></button>
        ${userCanManage ? `<button class="btn-icon danger" data-delete="${lead.id}" title="حذف"><i class="bi bi-trash"></i></button>` : ""}
      </td>
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

  tbody.querySelectorAll("[data-followup]").forEach((btn) => {
    btn.addEventListener("click", () => openLeadModal(btn.dataset.followup));
  });
}

function renderActivityLog(lead) {
  const log = [...(lead.activityLog || [])].reverse();
  if (!log.length) {
    activityLogEl.innerHTML = `<p class="text-muted small">ماكو ملاحظات متابعة بعد.</p>`;
    return;
  }
  activityLogEl.innerHTML = log.map((a) => `
    <div class="border-bottom py-2">
      <p class="mb-1">${a.text}</p>
      <span class="text-muted small">${a.by || "—"} • ${a.at ? new Date(a.at).toLocaleString("ar-IQ") : ""}</span>
    </div>
  `).join("");
}

function openLeadModal(leadId) {
  const lead = allLeads.find((l) => l.id === leadId);
  if (!lead) return;
  openLeadId = leadId;

  document.getElementById("leadModalTitle").textContent = `متابعة: ${lead.name || ""}`;
  leadModalInfo.innerHTML = `
    <p class="mb-1"><strong>${lead.name || "—"}</strong>${lead.company ? " — " + lead.company : ""}</p>
    <p class="text-muted small mb-0" dir="ltr">${lead.phone || ""}</p>
  `;
  nextFollowUpInput.value = lead.nextFollowUp || "";
  newActivityText.value = "";
  renderActivityLog(lead);
  modal.show();
}

document.getElementById("saveFollowUpBtn").addEventListener("click", async () => {
  if (!openLeadId) return;
  try {
    await updateDoc(doc(db, "leads", openLeadId), { nextFollowUp: nextFollowUpInput.value || null });
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

document.getElementById("addActivityBtn").addEventListener("click", async () => {
  const text = newActivityText.value.trim();
  if (!text || !openLeadId) return;
  try {
    await updateDoc(doc(db, "leads", openLeadId), {
      activityLog: arrayUnion({ text, by: currentUserEmail || "—", at: new Date().toISOString() })
    });
    newActivityText.value = "";
  } catch (err) {
    alert("تعذر إضافة الملاحظة: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUserEmail = user.email;
  userCanManage = canManage(role);
  const q = query(collection(db, "leads"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allLeads = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
    if (openLeadId) {
      const lead = allLeads.find((l) => l.id === openLeadId);
      if (lead) renderActivityLog(lead);
    }
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});

statusFilter.addEventListener("change", render);

document.getElementById("exportBtn").addEventListener("click", () => {
  const rows = allLeads.map((l) => ({
    "الاسم": l.name || "",
    "الجهة": l.company || "",
    "الهاتف": l.phone || "",
    "النوع": l.type || "",
    "التفاصيل": l.message || "",
    "الحالة": STATUS_LABELS[l.status] || "جديد",
    "المتابعة القادمة": l.nextFollowUp || "",
    "التاريخ": formatDate(l.createdAt)
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "العملاء المحتملون");
  XLSX.writeFile(wb, `عملاء-محتملون-مُر-${new Date().toISOString().slice(0, 10)}.xlsx`);
});
