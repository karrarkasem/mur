import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import { moveToTrash } from "../../services/trash.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");
const tbody = document.getElementById("customersBody");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("customerForm");
const modalEl = document.getElementById("customerModal");
const modal = new bootstrap.Modal(modalEl);
const rfidSection = document.getElementById("rfidSection");
const rfidNoCustomer = document.getElementById("rfidNoCustomer");
const rfidList = document.getElementById("rfidList");
const rfidTagInput = document.getElementById("rfidTagInput");
const addRfidBtn = document.getElementById("addRfidBtn");
const loginCodeSection = document.getElementById("loginCodeSection");
const loginCodeNoCustomer = document.getElementById("loginCodeNoCustomer");
const loginCodeList = document.getElementById("loginCodeList");
const loginCodeInput = document.getElementById("loginCodeInput");
const loginPinInput = document.getElementById("loginPinInput");
const addLoginCodeBtn = document.getElementById("addLoginCodeBtn");

let allCustomers = [];
let allRfid = [];
let allLoginCodes = [];
let currentUser = null;
let userCanManage = false;
let editingCustomerId = null;

function currencyIQD(n) {
  return Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
}

function customerRfidTags(customerId) {
  return allRfid.filter((r) => r.customerId === customerId);
}

function customerLoginCodes(customerId) {
  return allLoginCodes.filter((c) => c.customerId === customerId);
}

function render() {
  countLabel.textContent = `${allCustomers.length} عميل`;

  if (!allCustomers.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><i class="bi bi-person-badge"></i>ماكو عملاء مسجلين بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = allCustomers.map((c) => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td dir="ltr" class="text-end">${c.phone || "—"}</td>
      <td>${c.car || "—"}</td>
      <td>${c.compound || "—"}</td>
      <td>${currencyIQD(c.walletBalance)}</td>
      <td>${Number(c.totalConsumptionKwh || 0).toFixed(1)} kWh</td>
      <td>${customerRfidTags(c.id).length}</td>
      <td>
        <span class="status-badge ${c.active === false ? "status-rejected" : "status-done"}">${c.active === false ? "موقوف" : "فعّال"}</span>
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
    btn.addEventListener("click", () => openModal(allCustomers.find((c) => c.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.delete;
      if (!confirm("تأكيد نقل هذا العميل لسلة المحذوفات؟ يقدر يترجع من هناك.")) return;
      try {
        const { id: _id, ...data } = allCustomers.find((c) => c.id === id) || {};
        await moveToTrash("evCustomers", id, data);
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

function renderRfidList() {
  const tags = editingCustomerId ? customerRfidTags(editingCustomerId) : [];
  if (!tags.length) {
    rfidList.innerHTML = `<p class="text-muted small mb-2">ماكو بطاقات RFID مربوطة بعد</p>`;
    return;
  }
  rfidList.innerHTML = tags.map((r) => `
    <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2">
      <span dir="ltr"><strong>${r.id}</strong></span>
      <div class="d-flex gap-2 align-items-center">
        <span class="status-badge ${r.active === false ? "status-rejected" : "status-done"}">${r.active === false ? "موقوفة" : "فعّالة"}</span>
        <button type="button" class="btn-icon" data-toggle-rfid="${r.id}" title="${r.active === false ? "تفعيل" : "إيقاف"}"><i class="bi bi-power"></i></button>
        <button type="button" class="btn-icon danger" data-remove-rfid="${r.id}" title="حذف"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `).join("");

  rfidList.querySelectorAll("[data-toggle-rfid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tag = allRfid.find((r) => r.id === btn.dataset.toggleRfid);
      try {
        await updateDoc(doc(db, "evRfidTokens", tag.id), { active: tag.active === false ? true : false });
      } catch (err) {
        alert("تعذر التحديث: " + err.message);
      }
    });
  });
  rfidList.querySelectorAll("[data-remove-rfid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف بطاقة RFID هذه؟")) return;
      try {
        await deleteDoc(doc(db, "evRfidTokens", btn.dataset.removeRfid));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

addRfidBtn.addEventListener("click", async () => {
  const tag = rfidTagInput.value.trim();
  if (!tag || !editingCustomerId) return;
  const customer = allCustomers.find((c) => c.id === editingCustomerId);
  try {
    await setDoc(doc(db, "evRfidTokens", tag), {
      customerId: editingCustomerId,
      customerName: customer?.name || "",
      active: true,
      createdAt: serverTimestamp()
    });
    rfidTagInput.value = "";
  } catch (err) {
    alert("تعذر الإضافة: " + err.message);
  }
});

function renderLoginCodeList() {
  const codes = editingCustomerId ? customerLoginCodes(editingCustomerId) : [];
  if (!codes.length) {
    loginCodeList.innerHTML = `<p class="text-muted small mb-2">ماكو كود دخول مسوّى بعد</p>`;
    return;
  }
  loginCodeList.innerHTML = codes.map((c) => `
    <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2">
      <span dir="ltr"><strong>${c.id}</strong> <span class="text-muted small">PIN: ${c.pin}</span></span>
      <div class="d-flex gap-2 align-items-center">
        <span class="status-badge ${c.active === false ? "status-rejected" : "status-done"}">${c.active === false ? "موقوف" : "فعّال"}</span>
        <button type="button" class="btn-icon" data-toggle-code="${c.id}" title="${c.active === false ? "تفعيل" : "إيقاف"}"><i class="bi bi-power"></i></button>
        <button type="button" class="btn-icon danger" data-remove-code="${c.id}" title="حذف"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `).join("");

  loginCodeList.querySelectorAll("[data-toggle-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = allLoginCodes.find((c) => c.id === btn.dataset.toggleCode);
      try {
        await updateDoc(doc(db, "evLoginCodes", code.id), { active: code.active === false ? true : false });
      } catch (err) {
        alert("تعذر التحديث: " + err.message);
      }
    });
  });
  loginCodeList.querySelectorAll("[data-remove-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف كود الدخول هذا؟")) return;
      try {
        await deleteDoc(doc(db, "evLoginCodes", btn.dataset.removeCode));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

addLoginCodeBtn.addEventListener("click", async () => {
  const code = loginCodeInput.value.trim();
  const pin = loginPinInput.value.trim();
  if (!code || !pin || !editingCustomerId) { alert("اكتب الكود والرقم السري."); return; }
  const customer = allCustomers.find((c) => c.id === editingCustomerId);
  try {
    await setDoc(doc(db, "evLoginCodes", code), {
      customerId: editingCustomerId,
      customerName: customer?.name || "",
      pin,
      active: true,
      createdAt: serverTimestamp()
    });
    loginCodeInput.value = "";
    loginPinInput.value = "";
  } catch (err) {
    alert("تعذر الإضافة: " + err.message);
  }
});

function openModal(customer) {
  form.reset();
  editingCustomerId = customer?.id || null;
  document.getElementById("customerId").value = customer?.id || "";
  document.getElementById("customerModalTitle").textContent = customer ? "تعديل العميل" : "إضافة عميل";
  document.getElementById("name").value = customer?.name || "";
  document.getElementById("phone").value = customer?.phone || "";
  document.getElementById("car").value = customer?.car || "";
  document.getElementById("compound").value = customer?.compound || "";
  document.getElementById("active").checked = customer?.active !== false;

  rfidSection.classList.toggle("d-none", !editingCustomerId);
  rfidNoCustomer.classList.toggle("d-none", !!editingCustomerId);
  loginCodeSection.classList.toggle("d-none", !editingCustomerId);
  loginCodeNoCustomer.classList.toggle("d-none", !!editingCustomerId);
  if (editingCustomerId) { renderRfidList(); renderLoginCodeList(); }

  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("customerId").value;
  const data = {
    name: document.getElementById("name").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    car: document.getElementById("car").value.trim(),
    compound: document.getElementById("compound").value.trim(),
    active: document.getElementById("active").checked
  };

  try {
    if (id) {
      await updateDoc(doc(db, "evCustomers", id), { ...data, updatedBy: currentUser?.email || null, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "evCustomers"), {
        ...data, walletBalance: 0, totalConsumptionKwh: 0,
        createdBy: currentUser?.email || null, createdAt: serverTimestamp()
      });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUser = user;
  userCanManage = canManage(role);

  if (!userCanManage) {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  const q = query(collection(db, "evCustomers"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allCustomers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });

  onSnapshot(collection(db, "evRfidTokens"), (snapshot) => {
    allRfid = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
    if (editingCustomerId) renderRfidList();
  }, (err) => { console.error("evRfidTokens:", err.message); });

  onSnapshot(collection(db, "evLoginCodes"), (snapshot) => {
    allLoginCodes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (editingCustomerId) renderLoginCodeList();
  }, (err) => { console.error("evLoginCodes:", err.message); });
});
