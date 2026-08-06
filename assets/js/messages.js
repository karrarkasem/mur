import { db } from "../../services/firebase.js";
import { requireAuth } from "../../services/auth-guard.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const audienceList = document.getElementById("audienceList");
const sourceFilter = document.getElementById("sourceFilter");
const selectedCountEl = document.getElementById("selectedCount");
const messageText = document.getElementById("messageText");
const sendListBody = document.getElementById("sendListBody");

let leads = [];
let companies = [];
let selectedIds = new Set();

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/[\s-]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "964" + p.slice(1);
  if (!p.startsWith("964")) p = "964" + p;
  return p;
}

function getAudience() {
  const source = sourceFilter.value;
  const items = [];
  if (source === "all" || source === "leads") {
    leads.forEach((l) => items.push({ id: "lead-" + l.id, name: l.name, phone: l.phone, email: null, tag: "عميل محتمل" }));
  }
  if (source === "all" || source === "companies") {
    companies.forEach((c) => items.push({ id: "company-" + c.id, name: c.name, phone: c.phone, email: c.email, tag: "شركة" }));
  }
  return items.filter((i) => i.name);
}

function renderAudienceList() {
  const items = getAudience();
  if (!items.length) {
    audienceList.innerHTML = `<p class="text-muted small mb-0">ماكو بيانات بعد — أضف عملاء أو شركات أول.</p>`;
    return;
  }
  audienceList.innerHTML = items.map((i) => `
    <div class="form-check py-1">
      <input class="form-check-input audience-check" type="checkbox" value="${i.id}" id="chk-${i.id}" ${selectedIds.has(i.id) ? "checked" : ""}>
      <label class="form-check-label small" for="chk-${i.id}">
        <strong>${i.name}</strong> <span class="text-muted">(${i.tag})</span>
        ${i.phone ? ` — <span dir="ltr">${i.phone}</span>` : ""}
      </label>
    </div>
  `).join("");

  audienceList.querySelectorAll(".audience-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) selectedIds.add(e.target.value);
      else selectedIds.delete(e.target.value);
      renderSendList();
    });
  });
}

function renderSendList() {
  const items = getAudience().filter((i) => selectedIds.has(i.id));
  selectedCountEl.textContent = items.length;

  if (!items.length) {
    sendListBody.innerHTML = `<tr><td colspan="3" class="empty-state">اختر مستلمين أولاً من القائمة اليسار</td></tr>`;
    return;
  }

  sendListBody.innerHTML = items.map((i) => {
    const personalized = (messageText.value || "").replace(/\{name\}/g, i.name);
    const encoded = encodeURIComponent(personalized);
    const waNumber = normalizePhone(i.phone);
    const waLink = waNumber ? `https://wa.me/${waNumber}?text=${encoded}` : null;
    const mailLink = i.email ? `mailto:${i.email}?subject=${encodeURIComponent("عرض من مُر")}&body=${encoded}` : null;
    return `
      <tr>
        <td><strong>${i.name}</strong><br><span class="text-muted small">${i.tag}</span></td>
        <td>${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-sm btn-outline-success"><i class="bi bi-whatsapp"></i> إرسال</a>` : `<span class="text-muted small">لا يوجد هاتف</span>`}</td>
        <td>${mailLink ? `<a href="${mailLink}" class="btn btn-sm btn-outline-secondary"><i class="bi bi-envelope"></i> إرسال</a>` : `<span class="text-muted small">لا يوجد إيميل</span>`}</td>
      </tr>
    `;
  }).join("");
}

sourceFilter.addEventListener("change", renderAudienceList);
messageText.addEventListener("input", renderSendList);

document.getElementById("selectAllBtn").addEventListener("click", () => {
  getAudience().forEach((i) => selectedIds.add(i.id));
  renderAudienceList();
  renderSendList();
});
document.getElementById("clearAllBtn").addEventListener("click", () => {
  selectedIds.clear();
  renderAudienceList();
  renderSendList();
});

requireAuth(() => {
  onSnapshot(collection(db, "leads"), (snap) => {
    leads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAudienceList();
    renderSendList();
  });
  onSnapshot(collection(db, "companies"), (snap) => {
    companies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAudienceList();
    renderSendList();
  });
});
