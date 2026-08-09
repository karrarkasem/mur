import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const DEFAULT_COMPANY_INFO = {
  name: "مُر - حلول شحن السيارات الكهربائية",
  phone: "07711763931",
  email: "mur.ev.iq@gmail.com",
  address: "بغداد - العراق",
  website: "www.mur.ev.iq"
};

let companyInfoCache = null;
async function getCompanyInfo() {
  if (companyInfoCache) return companyInfoCache;
  try {
    const snap = await getDoc(doc(db, "settings", "company"));
    companyInfoCache = snap.exists() ? { ...DEFAULT_COMPANY_INFO, ...snap.data() } : DEFAULT_COMPANY_INFO;
  } catch {
    companyInfoCache = DEFAULT_COMPANY_INFO;
  }
  return companyInfoCache;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function printQuote(quote) {
  const company = await getCompanyInfo();
  const win = window.open("", "_blank");
  if (!win) { alert("المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع."); return; }

  const itemsRows = (quote.items || []).map((i) => `
    <tr>
      <td>${escapeHtml(i.description)}</td>
      <td>${i.qty}</td>
      <td>${formatMoney(i.unitPrice)}</td>
      <td>${formatMoney(i.qty * i.unitPrice)}</td>
    </tr>
  `).join("");

  const html = `
    <!doctype html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8">
      <title>عرض سعر ${escapeHtml(quote.quoteNumber)}</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;color:#17281f;padding:2rem;max-width:800px;margin:auto}
        .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #106b4c;padding-bottom:1rem;margin-bottom:1.5rem}
        .head h1{color:#106b4c;margin:0 0 .3rem}
        .head p{margin:.15rem 0;font-size:.85rem;color:#555}
        .quote-meta{text-align:left}
        .quote-meta strong{display:block;font-size:1.1rem}
        h3{color:#106b4c;border-bottom:1px solid #eee;padding-bottom:.3rem;margin-top:1.5rem}
        table{width:100%;border-collapse:collapse;margin-top:.5rem}
        th,td{border:1px solid #ddd;padding:.5rem;text-align:right;font-size:.9rem}
        th{background:#f0f5f2}
        .totals{margin-top:.75rem;text-align:left}
        .totals div{display:flex;justify-content:space-between;max-width:280px;margin-inline-start:auto;padding:.2rem 0}
        .totals .grand{font-weight:bold;font-size:1.2rem;border-top:2px solid #106b4c;padding-top:.4rem;margin-top:.4rem}
        .two-col{display:flex;gap:2rem}
        .two-col > div{flex:1}
        .footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.8rem;color:#777;text-align:center}
        @media print{ body{padding:0} }
      </style>
    </head>
    <body>
      <div class="head">
        <div>
          <h1>${escapeHtml(company.name)}</h1>
          <p>${escapeHtml(company.phone)} | ${escapeHtml(company.email)}</p>
          <p>${escapeHtml(company.address)} | ${escapeHtml(company.website)}</p>
        </div>
        <div class="quote-meta">
          <strong>عرض سعر</strong>
          <span>${escapeHtml(quote.quoteNumber)}</span><br>
          <span>صالح حتى: ${formatDate(quote.validUntil)}</span>
        </div>
      </div>

      <h3>معلومات العميل</h3>
      <p><strong>${escapeHtml(quote.clientName)}</strong>${quote.companyName ? " — " + escapeHtml(quote.companyName) : ""}</p>
      <p>${quote.phone ? escapeHtml(quote.phone) + " | " : ""}${quote.sector ? escapeHtml(quote.sector) : ""}</p>

      <h3>بنود العرض</h3>
      <table>
        <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <div class="totals">
        <div><span>المجموع الفرعي</span><span>${formatMoney(quote.subtotal)} د.ع</span></div>
        <div><span>الخصم</span><span>${quote.discountPercent || 0}%</span></div>
        <div class="grand"><span>الإجمالي</span><span>${formatMoney(quote.total)} د.ع</span></div>
      </div>

      ${quote.scopeIncludes ? `<h3>يشمل هذا العرض</h3><p>${escapeHtml(quote.scopeIncludes).replace(/\n/g, "<br>")}</p>` : ""}

      <div class="two-col">
        ${quote.murResponsibilities ? `<div><h3>مسؤوليات ${escapeHtml(company.name)}</h3><p>${escapeHtml(quote.murResponsibilities).replace(/\n/g, "<br>")}</p></div>` : ""}
        ${quote.clientResponsibilities ? `<div><h3>مسؤوليات العميل</h3><p>${escapeHtml(quote.clientResponsibilities).replace(/\n/g, "<br>")}</p></div>` : ""}
      </div>

      ${quote.notes ? `<h3>ملاحظات</h3><p>${escapeHtml(quote.notes).replace(/\n/g, "<br>")}</p>` : ""}

      <div class="footer">${escapeHtml(company.name)} — ${escapeHtml(company.phone)} — ${escapeHtml(company.email)}</div>
    </body>
    </html>
  `;

  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

const STATUS_LABELS = { draft: "مسودة", sent: "مرسل", accepted: "مقبول", rejected: "مرفوض" };

const tbody = document.getElementById("quotesBody");
const statusFilter = document.getElementById("statusFilter");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("quoteForm");
const modalEl = document.getElementById("quoteModal");
const modal = new bootstrap.Modal(modalEl);
const itemsBody = document.getElementById("itemsBody");
const subtotalDisplay = document.getElementById("subtotalDisplay");
const totalDisplay = document.getElementById("totalDisplay");
const discountPercent = document.getElementById("discountPercent");

let allQuotes = [];
let userCanManage = false;
let currentUserEmail = null;

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ar-IQ");
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" });
}

function generateQuoteNumber() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `MUR-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/* ---------- line items ---------- */
function addItemRow(item = { description: "", qty: 1, unitPrice: 0 }) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="form-control form-control-sm item-desc" value="${item.description || ""}" placeholder="مثال: جهاز شحن AC 22kW + التركيب"></td>
    <td><input type="number" min="1" class="form-control form-control-sm item-qty" value="${item.qty || 1}"></td>
    <td><input type="number" min="0" class="form-control form-control-sm item-price" value="${item.unitPrice || 0}"></td>
    <td class="item-line-total text-nowrap">0</td>
    <td><button type="button" class="btn-icon danger remove-item"><i class="bi bi-x-lg"></i></button></td>
  `;
  itemsBody.appendChild(tr);

  tr.querySelectorAll(".item-qty, .item-price").forEach((input) => input.addEventListener("input", recalcTotals));
  tr.querySelector(".remove-item").addEventListener("click", () => { tr.remove(); recalcTotals(); });
  recalcTotals();
}

function readItems() {
  return [...itemsBody.querySelectorAll("tr")].map((tr) => ({
    description: tr.querySelector(".item-desc").value.trim(),
    qty: Number(tr.querySelector(".item-qty").value) || 0,
    unitPrice: Number(tr.querySelector(".item-price").value) || 0
  })).filter((i) => i.description);
}

function recalcTotals() {
  let subtotal = 0;
  itemsBody.querySelectorAll("tr").forEach((tr) => {
    const qty = Number(tr.querySelector(".item-qty").value) || 0;
    const price = Number(tr.querySelector(".item-price").value) || 0;
    const lineTotal = qty * price;
    tr.querySelector(".item-line-total").textContent = formatMoney(lineTotal);
    subtotal += lineTotal;
  });
  const discount = Number(discountPercent.value) || 0;
  const total = subtotal - (subtotal * discount) / 100;
  subtotalDisplay.textContent = formatMoney(subtotal);
  totalDisplay.textContent = formatMoney(total);
  return { subtotal, total };
}

discountPercent.addEventListener("input", recalcTotals);
document.getElementById("addItemBtn").addEventListener("click", () => addItemRow());

/* ---------- list ---------- */
function render() {
  const filter = statusFilter.value;
  const rows = filter === "all" ? allQuotes : allQuotes.filter((q) => (q.status || "draft") === filter);

  countLabel.textContent = `${rows.length} من ${allQuotes.length} عرض`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="bi bi-file-earmark-text"></i>ماكو عروض بهذه الحالة</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((q) => `
    <tr>
      <td class="text-nowrap"><code>${q.quoteNumber || "—"}</code></td>
      <td><strong>${q.clientName}</strong>${q.createdBy ? `<br><span class="text-muted small"><i class="bi bi-person"></i> ${q.createdBy}</span>` : ""}</td>
      <td>${q.companyName || "—"}</td>
      <td class="text-nowrap">${formatMoney(q.total)} د.ع</td>
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
        <button class="btn-icon" data-edit="${q.id}" title="${userCanManage ? "تعديل" : "عرض"}"><i class="bi bi-eye"></i></button>
        <button class="btn-icon" data-print="${q.id}" title="طباعة / PDF"><i class="bi bi-printer"></i></button>
        ${userCanManage ? `<button class="btn-icon danger" data-delete="${q.id}" title="حذف"><i class="bi bi-trash"></i></button>` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allQuotes.find((q) => q.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-print]").forEach((btn) => {
    btn.addEventListener("click", () => printQuote(allQuotes.find((q) => q.id === btn.dataset.print)));
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
  itemsBody.innerHTML = "";
  document.getElementById("quoteId").value = quote?.id || "";
  document.getElementById("quoteModalTitle").textContent = quote ? `عرض رقم ${quote.quoteNumber || ""}` : "إنشاء عرض سعر";
  document.getElementById("clientName").value = quote?.clientName || "";
  document.getElementById("companyName").value = quote?.companyName || "";
  document.getElementById("phone").value = quote?.phone || "";
  document.getElementById("sector").value = quote?.sector || "";
  document.getElementById("validUntil").value = quote?.validUntil || "";
  document.getElementById("scopeIncludes").value = quote?.scopeIncludes || "";
  document.getElementById("murResponsibilities").value = quote?.murResponsibilities || "توريد الأجهزة والمعدات\nالتركيب الاحترافي وفق معايير السلامة\nالفحص والتشغيل والاختبار\nالضمان والدعم الفني";
  document.getElementById("clientResponsibilities").value = quote?.clientResponsibilities || "تجهيز نقطة كهرباء مناسبة بالموقع\nتوفير صلاحية دخول الموقع لفريق التركيب\nتسديد الدفعات حسب الاتفاق";
  document.getElementById("notes").value = quote?.notes || "";
  discountPercent.value = quote?.discountPercent || 0;

  const items = quote?.items?.length ? quote.items : [{ description: "", qty: 1, unitPrice: 0 }];
  items.forEach((item) => addItemRow(item));

  const formElements = form.querySelectorAll("input, textarea, select, button");
  formElements.forEach((el) => { el.disabled = !userCanManage && el.id !== "quoteId"; });
  form.querySelector('button[type="submit"]').classList.toggle("d-none", !userCanManage);

  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
statusFilter.addEventListener("change", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("quoteId").value;
  const items = readItems();
  if (!items.length) {
    alert("أضف بند وحد على الأقل بالعرض.");
    return;
  }
  const { subtotal, total } = recalcTotals();

  const data = {
    clientName: document.getElementById("clientName").value.trim(),
    companyName: document.getElementById("companyName").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    sector: document.getElementById("sector").value,
    validUntil: document.getElementById("validUntil").value,
    items,
    subtotal,
    discountPercent: Number(discountPercent.value) || 0,
    total,
    scopeIncludes: document.getElementById("scopeIncludes").value.trim(),
    murResponsibilities: document.getElementById("murResponsibilities").value.trim(),
    clientResponsibilities: document.getElementById("clientResponsibilities").value.trim(),
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "quotes", id), { ...data, updatedBy: currentUserEmail, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "quotes"), {
        ...data, status: "draft", quoteNumber: generateQuoteNumber(), createdBy: currentUserEmail, createdAt: serverTimestamp()
      });
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
  const q = query(collection(db, "quotes"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allQuotes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
