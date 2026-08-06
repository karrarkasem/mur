import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const PRIORITY_LABELS = { low: "منخفضة", medium: "متوسطة", high: "عالية" };

const tbody = document.getElementById("tasksBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("taskForm");
const modalEl = document.getElementById("taskModal");
const modal = new bootstrap.Modal(modalEl);

let allTasks = [];
let userCanManage = false;

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  const filter = statusFilter.value;
  const rows = filter === "all" ? allTasks : allTasks.filter((t) => (t.status || "pending") === filter);

  countLabel.textContent = `${rows.length} من ${allTasks.length} مهمة`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-check2-square"></i>ماكو مهام بهذه الحالة</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((t) => `
    <tr>
      <td><strong>${t.title}</strong>${t.notes ? `<br><span class="text-muted small">${t.notes}</span>` : ""}</td>
      <td>${t.assignee || "—"}</td>
      <td>${formatDate(t.dueDate)}</td>
      <td>${PRIORITY_LABELS[t.priority] || "—"}</td>
      <td>
        ${userCanManage
          ? `<select class="status-select" data-id="${t.id}">
              <option value="pending" ${(t.status || "pending") === "pending" ? "selected" : ""}>قيد التنفيذ</option>
              <option value="done" ${t.status === "done" ? "selected" : ""}>مكتملة</option>
            </select>`
          : `<span class="status-badge status-${t.status || "pending"}">${t.status === "done" ? "مكتملة" : "قيد التنفيذ"}</span>`
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
      if (!confirm("تأكيد حذف هذه المهمة؟")) return;
      try {
        await deleteDoc(doc(db, "tasks", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
  tbody.querySelectorAll("select[data-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      try {
        await updateDoc(doc(db, "tasks", e.target.dataset.id), { status: e.target.value });
      } catch (err) {
        alert("تعذر تحديث الحالة: " + err.message);
      }
    });
  });
}

function openModal(task) {
  form.reset();
  document.getElementById("taskId").value = task?.id || "";
  document.getElementById("taskModalTitle").textContent = task ? "تعديل المهمة" : "إضافة مهمة";
  document.getElementById("title").value = task?.title || "";
  document.getElementById("assignee").value = task?.assignee || "";
  document.getElementById("dueDate").value = task?.dueDate || "";
  document.getElementById("priority").value = task?.priority || "medium";
  document.getElementById("notes").value = task?.notes || "";
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
statusFilter.addEventListener("change", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("taskId").value;
  const data = {
    title: document.getElementById("title").value.trim(),
    assignee: document.getElementById("assignee").value.trim(),
    dueDate: document.getElementById("dueDate").value,
    priority: document.getElementById("priority").value,
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "tasks", id), data);
    } else {
      await addDoc(collection(db, "tasks"), { ...data, status: "pending", createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  userCanManage = canManage(role);
  if (!userCanManage) document.getElementById("addBtn").classList.add("d-none");
  const q = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allTasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
