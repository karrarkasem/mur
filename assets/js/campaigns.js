import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const TYPE_LABELS = { intro: "تعريفي", promo: "ترويجي", limited: "محدود المدة" };
const STATUS_LABELS = { planned: "مخطط لها", active: "نشطة", ended: "منتهية" };

const tbody = document.getElementById("campaignsBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("campaignForm");
const modalEl = document.getElementById("campaignModal");
const modal = new bootstrap.Modal(modalEl);

let allCampaigns = [];
let userCanManage = false;
let currentUserEmail = null;

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  const filter = statusFilter.value;
  const rows = filter === "all" ? allCampaigns : allCampaigns.filter((c) => (c.status || "planned") === filter);

  countLabel.textContent = `${rows.length} من ${allCampaigns.length} حملة`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-megaphone"></i>ماكو حملات مسجلة بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((c) => `
    <tr>
      <td><strong>${c.name}</strong>${c.description ? `<br><span class="text-muted small">${c.description}</span>` : ""}</td>
      <td>${TYPE_LABELS[c.type] || "—"}</td>
      <td>${c.targetSegment || "—"}</td>
      <td class="text-nowrap">${formatDate(c.startDate)} → ${formatDate(c.endDate)}</td>
      <td>
        ${userCanManage
          ? `<select class="status-select" data-id="${c.id}">
              ${Object.entries(STATUS_LABELS).map(([val, label]) =>
                `<option value="${val}" ${(c.status || "planned") === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>`
          : `<span class="status-badge status-${c.status === "active" ? "sent" : c.status === "ended" ? "closed" : "pending"}">${STATUS_LABELS[c.status] || "مخطط لها"}</span>`
        }
      </td>
      <td class="text-nowrap">
        ${userCanManage ? `
          <button class="btn-icon" data-edit="${c.id}" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger" data-delete="${c.id}" title="حذف"><i class="bi bi-trash"></i></button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allCampaigns.find((c) => c.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف هذه الحملة؟")) return;
      try {
        await deleteDoc(doc(db, "campaigns", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
  tbody.querySelectorAll("select[data-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      try {
        await updateDoc(doc(db, "campaigns", e.target.dataset.id), { status: e.target.value });
      } catch (err) {
        alert("تعذر تحديث الحالة: " + err.message);
      }
    });
  });
}

function openModal(campaign) {
  form.reset();
  document.getElementById("campaignId").value = campaign?.id || "";
  document.getElementById("campaignModalTitle").textContent = campaign ? "تعديل الحملة" : "حملة جديدة";
  document.getElementById("name").value = campaign?.name || "";
  document.getElementById("type").value = campaign?.type || "intro";
  document.getElementById("startDate").value = campaign?.startDate || "";
  document.getElementById("endDate").value = campaign?.endDate || "";
  document.getElementById("budget").value = campaign?.budget || "";
  document.getElementById("targetSegment").value = campaign?.targetSegment || "";
  document.getElementById("description").value = campaign?.description || "";
  document.getElementById("status").value = campaign?.status || "planned";
  document.getElementById("resultsNotes").value = campaign?.resultsNotes || "";
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
statusFilter.addEventListener("change", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("campaignId").value;
  const data = {
    name: document.getElementById("name").value.trim(),
    type: document.getElementById("type").value,
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    budget: Number(document.getElementById("budget").value) || 0,
    targetSegment: document.getElementById("targetSegment").value.trim(),
    description: document.getElementById("description").value.trim(),
    status: document.getElementById("status").value,
    resultsNotes: document.getElementById("resultsNotes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "campaigns", id), { ...data, updatedBy: currentUserEmail, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "campaigns"), { ...data, createdBy: currentUserEmail, createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUserEmail = user.email;
  userCanManage = canManage(role);
  if (!userCanManage) document.getElementById("addBtn").classList.add("d-none");
  const q = query(collection(db, "campaigns"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allCampaigns = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
