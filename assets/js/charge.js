import { db } from "../../services/firebase.js";
import {
  doc, getDoc, addDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const CONNECTOR_BADGE = { Available: "status-done", Charging: "status-contacted", Faulted: "status-rejected", Unavailable: "status-offline" };

const params = new URLSearchParams(location.search);
const chargerId = params.get("c");
const connectorId = params.get("n") || "1";

const loadingBox = document.getElementById("loadingBox");
const notFoundBox = document.getElementById("notFoundBox");
const stationBox = document.getElementById("stationBox");
const identifyBox = document.getElementById("identifyBox");
const customerBox = document.getElementById("customerBox");
const identifyForm = document.getElementById("identifyForm");
const identifyStatus = document.getElementById("identifyStatus");
const startBtn = document.getElementById("startBtn");
const startStatus = document.getElementById("startStatus");
const balanceWarning = document.getElementById("balanceWarning");
const busyWarning = document.getElementById("busyWarning");

let charger = null;
let connector = null;
let pricePerKwh = 0;
let customer = null;
let customerId = null;

function currencyIQD(n) {
  return Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
}

async function init() {
  if (!chargerId) { showNotFound(); return; }

  const chargerSnap = await getDoc(doc(db, "evChargers", chargerId));
  if (!chargerSnap.exists()) { showNotFound(); return; }
  charger = chargerSnap.data();

  const connectorSnap = await getDoc(doc(db, "evChargers", chargerId, "connectors", connectorId));
  connector = connectorSnap.exists() ? connectorSnap.data() : { status: "Unavailable" };

  const tariffSnap = await getDoc(doc(db, "evTariffs", "default"));
  pricePerKwh = tariffSnap.exists() ? Number(tariffSnap.data().pricePerKwh || 0) : 0;

  document.getElementById("stationName").textContent = charger.name || charger.ocppId || "محطة شحن";
  document.getElementById("stationLocation").textContent = charger.location || "";
  document.getElementById("connectorStatusBadge").className = `status-badge ${CONNECTOR_BADGE[connector.status] || "status-offline"}`;
  document.getElementById("connectorStatusBadge").textContent = connector.status || "Unavailable";
  document.getElementById("connectorLabel").textContent = `موصل #${connectorId}`;
  document.getElementById("priceLabel").textContent = pricePerKwh ? `${currencyIQD(pricePerKwh)} / kWh` : "السعر يحدد لاحقًا";

  loadingBox.classList.add("d-none");
  stationBox.classList.remove("d-none");
}

function showNotFound() {
  loadingBox.classList.add("d-none");
  notFoundBox.classList.remove("d-none");
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
    customerId = tagSnap.data().customerId;
    const customerSnap = await getDoc(doc(db, "evCustomers", customerId));
    if (!customerSnap.exists()) {
      identifyStatus.textContent = "تعذر إيجاد الحساب المرتبط بهذه البطاقة.";
      identifyStatus.className = "d-block mt-2 text-danger";
      return;
    }
    customer = customerSnap.data();

    document.getElementById("customerName").textContent = customer.name || "";
    document.getElementById("customerBalance").textContent = currencyIQD(customer.walletBalance);

    const hasBalance = Number(customer.walletBalance || 0) > 0;
    const isAvailable = connector.status === "Available";
    balanceWarning.classList.toggle("d-none", hasBalance);
    busyWarning.classList.toggle("d-none", isAvailable);
    startBtn.disabled = !hasBalance || !isAvailable;

    identifyBox.classList.add("d-none");
    customerBox.classList.remove("d-none");
  } catch (err) {
    identifyStatus.textContent = "تعذر التحقق: " + err.message;
    identifyStatus.className = "d-block mt-2 text-danger";
  }
});

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startStatus.textContent = "جاري إرسال طلبك...";
  startStatus.className = "d-block mt-2";

  try {
    await addDoc(collection(db, "evChargeRequests"), {
      customerId, customerName: customer.name, customerPhone: customer.phone || "",
      chargerId, chargerName: charger.name || charger.ocppId, connectorId,
      status: "pending", requestedAt: serverTimestamp()
    });
    startStatus.innerHTML = `تم إرسال طلبك ✅<br><span class="text-muted">الربط الآلي بالشاحن قيد الإعداد حاليًا — موظف مُر بيفعّل الشحن يدويًا خلال دقائق.</span>`;
    startStatus.className = "d-block mt-2 text-success";
  } catch (err) {
    startBtn.disabled = false;
    startStatus.textContent = "تعذر إرسال الطلب: " + err.message;
    startStatus.className = "d-block mt-2 text-danger";
  }
});

init();
