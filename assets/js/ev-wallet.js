import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy, limit, where, getDocs, getDoc,
  doc, addDoc, updateDoc, setDoc, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const tariffForm = document.getElementById("tariffForm");
const tariffPriceInput = document.getElementById("tariffPrice");
const tariffStatus = document.getElementById("tariffStatus");

const METHOD_LABELS = { mastercard: "ماستركارد", zaincash: "زين كاش" };

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");
const topupBody = document.getElementById("topupBody");
const rfidBody = document.getElementById("rfidBody");
const txnBody = document.getElementById("txnBody");

let currentUser = null;
let allTopups = [];
let allRfidRequests = [];

function formatDate(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function currencyIQD(n) {
  return Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
}

// Looks up a customer by phone; creates a lightweight record if none exists yet
// (the public top-up/RFID forms don't require an existing account first).
async function findOrCreateCustomer(phone, name) {
  const snap = await getDocs(query(collection(db, "evCustomers"), where("phone", "==", phone)));
  if (!snap.empty) return snap.docs[0].id;
  const ref = await addDoc(collection(db, "evCustomers"), {
    name, phone, car: "", compound: "", active: true,
    walletBalance: 0, totalConsumptionKwh: 0,
    createdBy: currentUser?.email || null, createdAt: serverTimestamp()
  });
  return ref.id;
}

function renderTopups() {
  const pending = allTopups.filter((t) => t.status === "pending");
  if (!pending.length) {
    topupBody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="bi bi-wallet2"></i>ماكو طلبات تعبئة معلّقة</td></tr>`;
    return;
  }
  topupBody.innerHTML = pending.map((t) => `
    <tr>
      <td>${t.customerName || "—"}</td>
      <td dir="ltr" class="text-end">${t.customerPhone || "—"}</td>
      <td>${currencyIQD(t.amount)}</td>
      <td>${METHOD_LABELS[t.method] || t.method || "—"}</td>
      <td>${formatDate(t.requestedAt)}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-brand" data-confirm="${t.id}">تأكيد الدفع</button>
        <button class="btn btn-sm btn-outline-danger" data-reject="${t.id}">رفض</button>
      </td>
    </tr>
  `).join("");

  topupBody.querySelectorAll("[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => confirmTopup(btn.dataset.confirm));
  });
  topupBody.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد رفض طلب التعبئة هذا؟")) return;
      try {
        await updateDoc(doc(db, "evTopupRequests", btn.dataset.reject), {
          status: "rejected", confirmedBy: currentUser?.email || null, confirmedAt: serverTimestamp()
        });
      } catch (err) {
        alert("تعذر الرفض: " + err.message);
      }
    });
  });
}

async function confirmTopup(requestId) {
  const request = allTopups.find((t) => t.id === requestId);
  if (!request) return;
  if (!confirm(`تأكيد استلام دفعة ${currencyIQD(request.amount)} من ${request.customerName}؟ راح ينضاف المبلغ لمحفظته.`)) return;

  try {
    const customerId = request.customerId || await findOrCreateCustomer(request.customerPhone, request.customerName);
    const customerRef = doc(db, "evCustomers", customerId);
    const txnRef = doc(collection(db, "evWalletTransactions"));
    const requestRef = doc(db, "evTopupRequests", requestId);

    await runTransaction(db, async (t) => {
      const customerSnap = await t.get(customerRef);
      const currentBalance = Number(customerSnap.data()?.walletBalance || 0);
      const newBalance = currentBalance + Number(request.amount || 0);

      t.update(customerRef, { walletBalance: newBalance });
      t.set(txnRef, {
        customerId, type: "topup", amount: Number(request.amount || 0),
        method: request.method, relatedRequestId: requestId,
        balanceAfter: newBalance, by: currentUser?.email || null, at: serverTimestamp()
      });
      t.update(requestRef, {
        status: "confirmed", linkedCustomerId: customerId,
        confirmedBy: currentUser?.email || null, confirmedAt: serverTimestamp()
      });
    });
  } catch (err) {
    alert("تعذر تأكيد الدفع: " + err.message);
  }
}

function renderRfidRequests() {
  const pending = allRfidRequests.filter((r) => r.status === "requested");
  if (!pending.length) {
    rfidBody.innerHTML = `<tr><td colspan="4" class="empty-state"><i class="bi bi-credit-card-2-front"></i>ماكو طلبات بطاقات معلّقة</td></tr>`;
    return;
  }
  rfidBody.innerHTML = pending.map((r) => `
    <tr>
      <td>${r.customerName || "—"}</td>
      <td dir="ltr" class="text-end">${r.customerPhone || "—"}</td>
      <td>${formatDate(r.requestedAt)}</td>
      <td class="text-nowrap">
        <div class="input-group input-group-sm" style="max-width:260px">
          <input class="form-control" dir="ltr" placeholder="كود البطاقة" id="tag-${r.id}">
          <button class="btn btn-brand" data-issue="${r.id}">إصدار</button>
        </div>
      </td>
    </tr>
  `).join("");

  rfidBody.querySelectorAll("[data-issue]").forEach((btn) => {
    btn.addEventListener("click", () => issueRfid(btn.dataset.issue));
  });
}

async function issueRfid(requestId) {
  const request = allRfidRequests.find((r) => r.id === requestId);
  const tagInput = document.getElementById(`tag-${requestId}`);
  const tag = tagInput?.value.trim();
  if (!tag) { alert("اكتب كود البطاقة أول."); return; }

  try {
    const customerId = await findOrCreateCustomer(request.customerPhone, request.customerName);
    await setDoc(doc(db, "evRfidTokens", tag), {
      customerId, customerName: request.customerName, active: true, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "evRfidRequests", requestId), {
      status: "issued", linkedCustomerId: customerId, issuedTagId: tag,
      issuedBy: currentUser?.email || null, issuedAt: serverTimestamp()
    });
  } catch (err) {
    alert("تعذر الإصدار: " + err.message);
  }
}

function renderTransactions(txns) {
  if (!txns.length) {
    txnBody.innerHTML = `<tr><td colspan="4" class="empty-state">ماكو عمليات بعد</td></tr>`;
    return;
  }
  txnBody.innerHTML = txns.map((t) => `
    <tr>
      <td>${t.type === "topup" ? "تعبئة" : t.type}</td>
      <td>${currencyIQD(t.amount)}</td>
      <td>${t.by || "—"}</td>
      <td>${formatDate(t.at)}</td>
    </tr>
  `).join("");
}

tariffForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await setDoc(doc(db, "evTariffs", "default"), {
      pricePerKwh: Number(tariffPriceInput.value) || 0,
      updatedBy: currentUser?.email || null, updatedAt: serverTimestamp()
    });
    tariffStatus.textContent = "تم الحفظ.";
    tariffStatus.className = "text-success";
  } catch (err) {
    tariffStatus.textContent = "تعذر الحفظ: " + err.message;
    tariffStatus.className = "text-danger";
  }
});

requireAuth(async (user, role) => {
  currentUser = user;
  if (!canManage(role)) {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  const tariffSnap = await getDoc(doc(db, "evTariffs", "default"));
  tariffPriceInput.value = tariffSnap.exists() ? tariffSnap.data().pricePerKwh : 300;

  onSnapshot(query(collection(db, "evTopupRequests"), orderBy("requestedAt", "desc")), (snap) => {
    allTopups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTopups();
  }, (err) => { topupBody.innerHTML = `<tr><td colspan="6" class="empty-state">تعذر التحميل: ${err.message}</td></tr>`; });

  onSnapshot(query(collection(db, "evRfidRequests"), orderBy("requestedAt", "desc")), (snap) => {
    allRfidRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderRfidRequests();
  }, (err) => { rfidBody.innerHTML = `<tr><td colspan="4" class="empty-state">تعذر التحميل: ${err.message}</td></tr>`; });

  onSnapshot(query(collection(db, "evWalletTransactions"), orderBy("at", "desc"), limit(20)), (snap) => {
    renderTransactions(snap.docs.map((d) => d.data()));
  }, (err) => { txnBody.innerHTML = `<tr><td colspan="4" class="empty-state">تعذر التحميل: ${err.message}</td></tr>`; });
});
