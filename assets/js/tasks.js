import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import { moveToTrash, addTrashOpsToBatch } from "../../services/trash.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const TYPE_LABELS = {
  installation: "تركيب", maintenance: "صيانة", site_survey: "دراسة موقع",
  follow_up: "متابعة عميل", admin: "إداري", other: "أخرى"
};
const STATUS_LABELS = { pending: "قيد التنفيذ", blocked: "متعثرة", done: "مكتملة" };

const tbody = document.getElementById("tasksBody");
const statusFilter = document.getElementById("statusFilter");
const myTasksOnly = document.getElementById("myTasksOnly");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("taskForm");
const modalEl = document.getElementById("taskModal");
const modal = new bootstrap.Modal(modalEl);
const statusSelect = document.getElementById("status");
const blockerWrap = document.getElementById("blockerWrap");
const assignedToSelect = document.getElementById("assignedTo");
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const selectedCountEl = document.getElementById("selectedCount");

let allTasks = [];
let allUsers = [];
let userCanManage = false;
let currentUid = null;
let currentUserEmail = null;
let selectedIds = new Set();

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function updateBulkToolbar(visibleIds) {
  if (!userCanManage) return;
  selectedIds.forEach((id) => { if (!visibleIds.includes(id)) selectedIds.delete(id); });

  selectedCountEl.textContent = selectedIds.size;
  deleteSelectedBtn.classList.toggle("d-none", selectedIds.size === 0);
  deleteAllBtn.classList.toggle("d-none", visibleIds.length === 0);

  selectAllCheckbox.checked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  selectAllCheckbox.indeterminate = selectedIds.size > 0 && !selectAllCheckbox.checked;
}

function currentRows() {
  let rows = allTasks;
  if (statusFilter.value !== "all") rows = rows.filter((t) => (t.status || "pending") === statusFilter.value);
  if (myTasksOnly.checked) rows = rows.filter((t) => t.assignedToUid === currentUid);
  return rows;
}

function render() {
  const rows = currentRows();

  countLabel.textContent = `${rows.length} من ${allTasks.length} مهمة`;
  selectAllCheckbox.classList.toggle("d-none", !userCanManage);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><i class="bi bi-check2-square"></i>ماكو مهام بهذا الفلتر</td></tr>`;
    updateBulkToolbar([]);
    return;
  }

  tbody.innerHTML = rows.map((t) => `
    <tr${t.status === "blocked" ? ' style="background:rgba(192,57,43,.04)"' : ""}>
      <td>${userCanManage ? `<input type="checkbox" class="row-check" data-id="${t.id}" ${selectedIds.has(t.id) ? "checked" : ""}>` : ""}</td>
      <td><strong>${t.title}</strong>
        ${t.status === "blocked" && t.blockerNotes ? `<br><span class="small" style="color:#c0392b"><i class="bi bi-exclamation-triangle"></i> ${t.blockerNotes}</span>` : ""}
        ${t.notes ? `<br><span class="text-muted small">${t.notes}</span>` : ""}
        ${t.createdBy ? `<br><span class="text-muted small"><i class="bi bi-person"></i> أضافها ${t.createdBy}</span>` : ""}
      </td>
      <td>${TYPE_LABELS[t.type] || "—"}</td>
      <td>${t.assignedToName || "—"}</td>
      <td>${formatDate(t.dueDate)}</td>
      <td>${{ low: "منخفضة", medium: "متوسطة", high: "عالية" }[t.priority] || "—"}</td>
      <td>
        ${userCanManage || t.assignedToUid === currentUid
          ? `<select class="status-select" data-id="${t.id}">
              ${Object.entries(STATUS_LABELS).map(([val, label]) =>
                `<option value="${val}" ${(t.status || "pending") === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>`
          : `<span class="status-badge status-${t.status === "blocked" ? "rejected" : t.status === "done" ? "done" : "pending"}">${STATUS_LABELS[t.status] || "قيد التنفيذ"}</span>`
        }
      </td>
      <td class="text-nowrap">
        ${userCanManage ? `
          <button class="btn-icon" data-edit="${t.id}" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger" data-delete="${t.id}" title="حذف"><i class="bi bi-trash"></i></button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allTasks.find((t) => t.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد نقل هذه المهمة لسلة المحذوفات؟ يقدر يترجع من هناك.")) return;
      try {
        const id = btn.dataset.delete;
        const { id: _id, ...data } = allTasks.find((t) => t.id === id) || {};
        await moveToTrash("tasks", id, data);
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
  tbody.querySelectorAll("select[data-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      try {
        const newStatus = e.target.value;
        const patch = { status: newStatus };
        if (newStatus !== "blocked") patch.blockerNotes = "";
        await updateDoc(doc(db, "tasks", e.target.dataset.id), patch);
        if (newStatus === "blocked") {
          const note = prompt("شنو المعوق اللي أخر هذه المهمة؟");
          if (note) await updateDoc(doc(db, "tasks", e.target.dataset.id), { blockerNotes: note });
        }
      } catch (err) {
        alert("تعذر تحديث الحالة: " + err.message);
      }
    });
  });
  tbody.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) selectedIds.add(e.target.dataset.id);
      else selectedIds.delete(e.target.dataset.id);
      updateBulkToolbar(rows.map((t) => t.id));
    });
  });

  updateBulkToolbar(rows.map((t) => t.id));
}

async function bulkDelete(ids) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach((id) => {
      const task = allTasks.find((t) => t.id === id);
      if (!task) return;
      const { id: _id, ...data } = task;
      addTrashOpsToBatch(batch, "tasks", id, data);
    });
    await batch.commit();
  }
}

selectAllCheckbox.addEventListener("change", () => {
  const rows = currentRows();
  if (selectAllCheckbox.checked) rows.forEach((t) => selectedIds.add(t.id));
  else rows.forEach((t) => selectedIds.delete(t.id));
  render();
});

deleteSelectedBtn.addEventListener("click", async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`تأكيد نقل ${ids.length} مهمة محددة لسلة المحذوفات؟`)) return;
  try {
    await bulkDelete(ids);
    selectedIds.clear();
  } catch (err) {
    alert("تعذر الحذف: " + err.message);
  }
});

deleteAllBtn.addEventListener("click", async () => {
  const rows = currentRows();
  if (!rows.length) return;
  if (!confirm(`تأكيد نقل كل المهام المعروضة حاليًا (${rows.length}) لسلة المحذوفات؟`)) return;
  try {
    await bulkDelete(rows.map((t) => t.id));
    selectedIds.clear();
  } catch (err) {
    alert("تعذر الحذف: " + err.message);
  }
});

function populateAssigneeOptions() {
  assignedToSelect.innerHTML = `<option value="">— غير محددة —</option>` +
    allUsers.map((u) => `<option value="${u.id}" data-name="${u.name || u.email}">${u.name || u.email}</option>`).join("");
}

function openModal(task) {
  form.reset();
  blockerWrap.style.display = "none";
  document.getElementById("taskId").value = task?.id || "";
  document.getElementById("taskModalTitle").textContent = task ? "تعديل المهمة" : "إضافة مهمة";
  document.getElementById("title").value = task?.title || "";
  document.getElementById("type").value = task?.type || "installation";
  assignedToSelect.value = task?.assignedToUid || "";
  document.getElementById("dueDate").value = task?.dueDate || "";
  document.getElementById("priority").value = task?.priority || "medium";
  statusSelect.value = task?.status || "pending";
  document.getElementById("blockerNotes").value = task?.blockerNotes || "";
  document.getElementById("notes").value = task?.notes || "";
  blockerWrap.style.display = statusSelect.value === "blocked" ? "block" : "none";
  modal.show();
}

statusSelect.addEventListener("change", () => {
  blockerWrap.style.display = statusSelect.value === "blocked" ? "block" : "none";
});

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
statusFilter.addEventListener("change", render);
myTasksOnly.addEventListener("change", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("taskId").value;
  const selectedOption = assignedToSelect.options[assignedToSelect.selectedIndex];
  const data = {
    title: document.getElementById("title").value.trim(),
    type: document.getElementById("type").value,
    assignedToUid: assignedToSelect.value || null,
    assignedToName: assignedToSelect.value ? selectedOption.dataset.name : null,
    dueDate: document.getElementById("dueDate").value,
    priority: document.getElementById("priority").value,
    status: statusSelect.value,
    blockerNotes: statusSelect.value === "blocked" ? document.getElementById("blockerNotes").value.trim() : "",
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "tasks", id), { ...data, updatedBy: currentUserEmail, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "tasks"), { ...data, createdBy: currentUserEmail, createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUid = user.uid;
  currentUserEmail = user.email;
  userCanManage = canManage(role);
  if (!userCanManage) document.getElementById("addBtn").classList.add("d-none");

  onSnapshot(query(collection(db, "users"), orderBy("name")), (snap) => {
    allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateAssigneeOptions();
  });

  const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allTasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
