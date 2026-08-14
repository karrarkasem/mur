import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import { restoreFromTrash, purgeFromTrash } from "../../services/trash.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const COLLECTION_LABELS = {
  leads: "العملاء المحتملون",
  tasks: "المهام",
  quotes: "عروض الأسعار",
  companies: "الشركات",
  campaigns: "الحملات",
  contentPosts: "منشورات التقويم",
  users: "المستخدمون",
  evChargers: "محطات الشحن",
  evCustomers: "عملاء الشحن"
};

const ITEM_LABEL = {
  leads: (d) => d.name,
  tasks: (d) => d.title,
  quotes: (d) => d.clientName,
  companies: (d) => d.name,
  campaigns: (d) => d.name,
  contentPosts: (d) => d.title,
  users: (d) => d.name || d.email,
  evChargers: (d) => d.name || d.ocppId,
  evCustomers: (d) => d.name
};

const tbody = document.getElementById("trashBody");
const statusFilter = document.getElementById("statusFilter");
const sectionFilter = document.getElementById("sectionFilter");
const countLabel = document.getElementById("countLabel");
const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");

let allItems = [];
let userIsAdmin = false;
let userCanManage = false;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function formatDate(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function itemLabel(item) {
  const fn = ITEM_LABEL[item.sourceCollection];
  const label = fn ? fn(item.data || {}) : null;
  return label || "—";
}

function populateSectionFilter() {
  const sections = [...new Set(allItems.map((i) => i.sourceCollection))];
  const current = sectionFilter.value;
  sectionFilter.innerHTML = `<option value="all">كل الأقسام</option>` +
    sections.map((s) => `<option value="${s}">${COLLECTION_LABELS[s] || s}</option>`).join("");
  sectionFilter.value = sections.includes(current) ? current : "all";
}

function render() {
  populateSectionFilter();

  const statusVal = statusFilter.value;
  const sectionVal = sectionFilter.value;
  const rows = allItems.filter((i) =>
    (statusVal === "all" || i.status === statusVal) &&
    (sectionVal === "all" || i.sourceCollection === sectionVal)
  );

  countLabel.textContent = `${rows.length} من ${allItems.length}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-trash3"></i>ماكو عناصر بهذا الفلتر</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((item) => `
    <tr>
      <td>${COLLECTION_LABELS[item.sourceCollection] || item.sourceCollection}</td>
      <td>${escapeHtml(itemLabel(item))}</td>
      <td>${escapeHtml(item.deletedBy) || "—"}</td>
      <td>${formatDate(item.deletedAt)}</td>
      <td>
        ${item.status === "restored"
          ? `<span class="status-badge status-done">تم الاسترجاع${item.restoredBy ? ` (${escapeHtml(item.restoredBy)})` : ""}</span>`
          : `<span class="status-badge status-pending">بانتظار الاسترجاع</span>`
        }
      </td>
      <td class="text-nowrap">
        ${item.status === "trashed" && (item.sourceCollection === "users" ? userIsAdmin : userCanManage) ? `<button class="btn-icon" data-restore="${item.id}" title="استرجاع"><i class="bi bi-arrow-counterclockwise"></i></button>` : ""}
        ${userIsAdmin ? `<button class="btn-icon danger" data-purge="${item.id}" title="حذف نهائي"><i class="bi bi-trash3"></i></button>` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = allItems.find((i) => i.id === btn.dataset.restore);
      if (!item) return;
      if (!confirm(`تأكيد استرجاع "${itemLabel(item)}" لقسم ${COLLECTION_LABELS[item.sourceCollection] || item.sourceCollection}؟`)) return;
      try {
        await restoreFromTrash(item.id, item.sourceCollection, item.sourceId, item.data);
      } catch (err) {
        alert("تعذر الاسترجاع: " + err.message);
      }
    });
  });

  tbody.querySelectorAll("[data-purge]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد الحذف النهائي؟ ما راح يقدر يترجع بعدها.")) return;
      try {
        await purgeFromTrash(btn.dataset.purge);
      } catch (err) {
        alert("تعذر الحذف النهائي: " + err.message);
      }
    });
  });
}

requireAuth((user, role) => {
  userIsAdmin = role === "admin";
  userCanManage = canManage(role);

  if (!userCanManage) {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  const q = query(collection(db, "deletedItems"), orderBy("deletedAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allItems = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});

statusFilter.addEventListener("change", render);
sectionFilter.addEventListener("change", render);
