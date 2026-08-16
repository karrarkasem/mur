import { db } from "../../services/firebase.js";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

function currencyIQD(n) {
  return Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
}

// ---------- Identify (RFID or code+PIN) ----------
const identifyBox = document.getElementById("identifyBox");
const accountBox = document.getElementById("accountBox");
const blindBox = document.getElementById("blindBox");
const identifyForm = document.getElementById("identifyForm");
const codeIdentifyForm = document.getElementById("codeIdentifyForm");
const identifyStatus = document.getElementById("identifyStatus");
const showBlindBtn = document.getElementById("showBlindBtn");

let customerId = null;
let customer = null;

document.querySelectorAll("#identifyTabs [data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#identifyTabs [data-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    identifyForm.classList.toggle("d-none", mode !== "rfid");
    codeIdentifyForm.classList.toggle("d-none", mode !== "code");
    identifyStatus.textContent = "";
  });
});

showBlindBtn.addEventListener("click", () => {
  identifyBox.classList.add("d-none");
  blindBox.classList.remove("d-none");
});

function showAccount(id, data) {
  customerId = id;
  customer = data;
  document.getElementById("acctName").textContent = customer.name || "";
  document.getElementById("acctBalance").textContent = currencyIQD(customer.walletBalance);
  document.getElementById("acctKwh").textContent = `${Number(customer.totalConsumptionKwh || 0).toFixed(1)} kWh`;
  document.getElementById("acctSpent").textContent = currencyIQD(customer.totalSpent);

  identifyBox.classList.add("d-none");
  accountBox.classList.remove("d-none");
}

identifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tag = document.getElementById("tagInput").value.trim();
  identifyStatus.textContent = "جاري التحقق...";
  identifyStatus.className = "d-block mt-2";

  try {
    const tagSnap = await getDoc(doc(db, "evRfidTokens", tag));
    if (!tagSnap.exists() || tagSnap.data().active === false) {
      identifyStatus.textContent = "بطاقة غير صالحة أو موقوفة. تواصل مع فريق مُر.";
      identifyStatus.className = "d-block mt-2 text-danger";
      return;
    }
    const resolvedId = tagSnap.data().customerId;
    const customerSnap = await getDoc(doc(db, "evCustomers", resolvedId));
    if (!customerSnap.exists()) {
      identifyStatus.textContent = "تعذر إيجاد الحساب المرتبط بهذه البطاقة.";
      identifyStatus.className = "d-block mt-2 text-danger";
      return;
    }
    showAccount(resolvedId, customerSnap.data());
  } catch (err) {
    identifyStatus.textContent = "تعذر التحقق: " + err.message;
    identifyStatus.className = "d-block mt-2 text-danger";
  }
});

codeIdentifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = document.getElementById("codeInput").value.trim();
  const pin = document.getElementById("pinInput").value.trim();
  identifyStatus.textContent = "جاري التحقق...";
  identifyStatus.className = "d-block mt-2";

  try {
    const codeSnap = await getDoc(doc(db, "evLoginCodes", code));
    if (!codeSnap.exists() || codeSnap.data().active === false || codeSnap.data().pin !== pin) {
      identifyStatus.textContent = "الكود أو الرقم السري غير صحيح. تواصل مع فريق مُر.";
      identifyStatus.className = "d-block mt-2 text-danger";
      return;
    }
    const resolvedId = codeSnap.data().customerId;
    const customerSnap = await getDoc(doc(db, "evCustomers", resolvedId));
    if (!customerSnap.exists()) {
      identifyStatus.textContent = "تعذر إيجاد الحساب المرتبط بهذا الكود.";
      identifyStatus.className = "d-block mt-2 text-danger";
      return;
    }
    showAccount(resolvedId, customerSnap.data());
  } catch (err) {
    identifyStatus.textContent = "تعذر التحقق: " + err.message;
    identifyStatus.className = "d-block mt-2 text-danger";
  }
});

// ---------- Linked top-up (once identified) ----------
const acctTopupForm = document.getElementById("acctTopupForm");
const acctAmountInput = document.getElementById("acctAmountInput");
const acctTopupStatus = document.getElementById("acctTopupStatus");

document.querySelectorAll("#acctAmountButtons .amount-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#acctAmountButtons .amount-btn").forEach((b) => b.classList.remove("btn-brand", "text-white"));
    btn.classList.add("btn-brand", "text-white");
    acctAmountInput.value = btn.dataset.amount;
  });
});

acctTopupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  acctTopupStatus.textContent = "جاري الإرسال...";
  const method = acctTopupForm.querySelector('input[name="acctMethod"]:checked').value;

  try {
    await addDoc(collection(db, "evTopupRequests"), {
      customerId, customerName: customer.name, customerPhone: customer.phone || "",
      amount: Number(acctAmountInput.value) || 0,
      method,
      status: "pending",
      requestedAt: serverTimestamp()
    });
    acctTopupForm.reset();
    acctTopupStatus.textContent = "تم إرسال طلبك بنجاح. راح يتواصل معك فريقنا قريبًا.";
    acctTopupStatus.className = "mt-2 d-block text-success";
  } catch (error) {
    console.error(error);
    acctTopupStatus.textContent = "تعذر الإرسال. حاول مرة ثانية.";
    acctTopupStatus.className = "mt-2 d-block text-danger";
  }
});

// ---------- Blind forms (no card/code yet) ----------
const topupForm = document.getElementById("topupForm");
const rfidForm = document.getElementById("rfidForm");
const topupStatus = document.getElementById("topupStatus");
const rfidStatus = document.getElementById("rfidStatus");
const amountInput = document.getElementById("amountInput");

document.querySelectorAll("#modeTabs [data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#modeTabs [data-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    topupForm.classList.toggle("d-none", mode !== "topup");
    rfidForm.classList.toggle("d-none", mode !== "rfid");
  });
});

document.querySelectorAll("#amountButtons .amount-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#amountButtons .amount-btn").forEach((b) => b.classList.remove("btn-brand", "text-white"));
    btn.classList.add("btn-brand", "text-white");
    amountInput.value = btn.dataset.amount;
  });
});

topupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  topupStatus.textContent = "جاري الإرسال...";
  const data = Object.fromEntries(new FormData(topupForm).entries());

  try {
    await addDoc(collection(db, "evTopupRequests"), {
      customerName: data.name,
      customerPhone: data.phone,
      amount: Number(data.amount) || 0,
      method: data.method,
      status: "pending",
      requestedAt: serverTimestamp()
    });
    topupForm.reset();
    topupStatus.textContent = "تم إرسال طلبك بنجاح. راح يتواصل معك فريقنا قريبًا.";
    topupStatus.className = "mt-2 d-block text-success";
  } catch (error) {
    console.error(error);
    topupStatus.textContent = "تعذر الإرسال. حاول مرة ثانية.";
    topupStatus.className = "mt-2 d-block text-danger";
  }
});

rfidForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  rfidStatus.textContent = "جاري الإرسال...";
  const data = Object.fromEntries(new FormData(rfidForm).entries());

  try {
    await addDoc(collection(db, "evRfidRequests"), {
      customerName: data.name,
      customerPhone: data.phone,
      status: "requested",
      requestedAt: serverTimestamp()
    });
    rfidForm.reset();
    rfidStatus.textContent = "تم إرسال طلبك بنجاح. راح يتواصل معك فريقنا لتسليم البطاقة.";
    rfidStatus.className = "mt-2 d-block text-success";
  } catch (error) {
    console.error(error);
    rfidStatus.textContent = "تعذر الإرسال. حاول مرة ثانية.";
    rfidStatus.className = "mt-2 d-block text-danger";
  }
});
