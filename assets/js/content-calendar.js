import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const PLATFORM_LABELS = {
  facebook: "فيسبوك", instagram: "انستغرام", tiktok: "تيك توك",
  whatsapp_status: "حالة واتساب", telegram: "تيليجرام"
};
const STATUS_LABELS = { draft: "مسودة", scheduled: "مجدول", published: "منشور" };

const tbody = document.getElementById("postsBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("postForm");
const modalEl = document.getElementById("postModal");
const modal = new bootstrap.Modal(modalEl);
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const selectedCountEl = document.getElementById("selectedCount");

let allPosts = [];
let userCanManage = false;
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
  const filter = statusFilter.value;
  return filter === "all" ? allPosts : allPosts.filter((p) => (p.status || "draft") === filter);
}

function render() {
  const rows = currentRows();

  countLabel.textContent = `${rows.length} من ${allPosts.length} منشور`;
  selectAllCheckbox.classList.toggle("d-none", !userCanManage);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-calendar3"></i>ماكو منشورات مجدولة بعد</td></tr>`;
    updateBulkToolbar([]);
    return;
  }

  tbody.innerHTML = rows.map((p) => `
    <tr>
      <td>${userCanManage ? `<input type="checkbox" class="row-check" data-id="${p.id}" ${selectedIds.has(p.id) ? "checked" : ""}>` : ""}</td>
      <td class="text-nowrap">${formatDate(p.date)}</td>
      <td>${PLATFORM_LABELS[p.platform] || "—"}</td>
      <td><strong>${p.title || "—"}</strong>${p.content ? `<br><span class="text-muted small">${p.content.slice(0, 80)}${p.content.length > 80 ? "…" : ""}</span>` : ""}</td>
      <td>
        ${userCanManage
          ? `<select class="status-select" data-id="${p.id}">
              ${Object.entries(STATUS_LABELS).map(([val, label]) =>
                `<option value="${val}" ${(p.status || "draft") === val ? "selected" : ""}>${label}</option>`).join("")}
            </select>`
          : `<span class="status-badge status-${p.status || "draft"}">${STATUS_LABELS[p.status] || "مسودة"}</span>`
        }
      </td>
      <td class="text-nowrap">
        ${userCanManage ? `
          <button class="btn-icon" data-edit="${p.id}" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger" data-delete="${p.id}" title="حذف"><i class="bi bi-trash"></i></button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allPosts.find((p) => p.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف هذا المنشور؟")) return;
      try {
        await deleteDoc(doc(db, "contentPosts", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
  tbody.querySelectorAll("select[data-id]").forEach((select) => {
    select.addEventListener("change", async (e) => {
      try {
        await updateDoc(doc(db, "contentPosts", e.target.dataset.id), { status: e.target.value });
      } catch (err) {
        alert("تعذر تحديث الحالة: " + err.message);
      }
    });
  });
  tbody.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) selectedIds.add(e.target.dataset.id);
      else selectedIds.delete(e.target.dataset.id);
      updateBulkToolbar(rows.map((p) => p.id));
    });
  });

  updateBulkToolbar(rows.map((p) => p.id));
}

async function bulkDelete(ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach((id) => batch.delete(doc(db, "contentPosts", id)));
    await batch.commit();
  }
}

selectAllCheckbox.addEventListener("change", () => {
  const rows = currentRows();
  if (selectAllCheckbox.checked) rows.forEach((p) => selectedIds.add(p.id));
  else rows.forEach((p) => selectedIds.delete(p.id));
  render();
});

deleteSelectedBtn.addEventListener("click", async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`تأكيد حذف ${ids.length} منشور محدد؟ ما يمكن التراجع.`)) return;
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
  if (!confirm(`تأكيد حذف كل المنشورات المعروضة حاليًا (${rows.length})؟ ما يمكن التراجع.`)) return;
  try {
    await bulkDelete(rows.map((p) => p.id));
    selectedIds.clear();
  } catch (err) {
    alert("تعذر الحذف: " + err.message);
  }
});

function openModal(post) {
  form.reset();
  document.getElementById("postId").value = post?.id || "";
  document.getElementById("postModalTitle").textContent = post ? "تعديل المنشور" : "منشور جديد";
  document.getElementById("date").value = post?.date || "";
  document.getElementById("platform").value = post?.platform || "facebook";
  document.getElementById("title").value = post?.title || "";
  document.getElementById("content").value = post?.content || "";
  document.getElementById("status").value = post?.status || "draft";
  document.getElementById("notes").value = post?.notes || "";
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
statusFilter.addEventListener("change", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("postId").value;
  const data = {
    date: document.getElementById("date").value,
    platform: document.getElementById("platform").value,
    title: document.getElementById("title").value.trim(),
    content: document.getElementById("content").value.trim(),
    status: document.getElementById("status").value,
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "contentPosts", id), { ...data, updatedBy: currentUserEmail, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "contentPosts"), { ...data, createdBy: currentUserEmail, createdAt: serverTimestamp() });
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
  const q = query(collection(db, "contentPosts"), orderBy("date", "desc"));
  onSnapshot(q, (snapshot) => {
    allPosts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
