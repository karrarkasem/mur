import { db } from "../../services/firebase.js";
import {
  doc, getDoc, addDoc, updateDoc, collection, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const CONNECTOR_BADGE = { Available: "status-done", Charging: "status-contacted", Faulted: "status-rejected", Unavailable: "status-offline" };
const OCPP_SERVER_URL = "https://mur-ocpp-server.mur-ev-iq.workers.dev";

const params = new URLSearchParams(location.search);
const chargerId = params.get("c");
const connectorId = params.get("n") || "1";

const loadingBox = document.getElementById("loadingBox");
const notFoundBox = document.getElementById("notFoundBox");
const stationBox = document.getElementById("stationBox");
const identifyBox = document.getElementById("identifyBox");
const customerBox = document.getElementById("customerBox");
const identifyForm = document.getElementById("identifyForm");
const codeIdentifyForm = document.getElementById("codeIdentifyForm");
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
let identifiedTag = null; // RFID tag or login code the customer identified with - doubles as the OCPP idTag for remote-start
let sawCharging = false;

function currencyIQD(n) {
  return Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
}

// Same ISO-week bucketing used by ev-sessions.js when it writes weeklyStats
// onto evCustomers - must stay in sync so the key we read here matches the
// key that was written.
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function init() {
  if (!chargerId) { showNotFound(); return; }

  try {
    const chargerSnap = await getDoc(doc(db, "evChargers", chargerId));
    if (!chargerSnap.exists()) { showNotFound(); return; }
    charger = chargerSnap.data();

    const connectorSnap = await getDoc(doc(db, "evChargers", chargerId, "connectors", connectorId));
    connector = connectorSnap.exists() ? connectorSnap.data() : { status: "Unavailable" };

    const tariffSnap = await getDoc(doc(db, "evTariffs", "default"));
    pricePerKwh = tariffSnap.exists() ? Number(tariffSnap.data().pricePerKwh || 0) : 0;
  } catch (err) {
    showNotFound(`تعذر تحميل بيانات المحطة: ${err.message}`);
    return;
  }

  document.getElementById("stationName").textContent = charger.name || charger.ocppId || "محطة شحن";
  document.getElementById("stationLocation").textContent = charger.location || "";
  document.getElementById("connectorStatusBadge").className = `status-badge ${CONNECTOR_BADGE[connector.status] || "status-offline"}`;
  document.getElementById("connectorStatusBadge").textContent = connector.status || "Unavailable";
  document.getElementById("connectorLabel").textContent = `موصل #${connectorId}`;
  document.getElementById("priceLabel").textContent = pricePerKwh ? `${currencyIQD(pricePerKwh)} / kWh` : "السعر يحدد لاحقًا";

  loadingBox.classList.add("d-none");
  stationBox.classList.remove("d-none");
}

function showNotFound(message) {
  loadingBox.classList.add("d-none");
  notFoundBox.classList.remove("d-none");
  if (message) notFoundBox.querySelector("p").textContent = message;
}

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

async function showCustomer(resolvedCustomerId, data) {
  customerId = resolvedCustomerId;
  customer = data;

  document.getElementById("customerName").textContent = customer.name || "";
  document.getElementById("customerBalance").textContent = currencyIQD(customer.walletBalance);
  document.getElementById("customerTotalKwh").textContent = `${Number(customer.totalConsumptionKwh || 0).toFixed(1)} kWh`;
  document.getElementById("customerTotalSpent").textContent = currencyIQD(customer.totalSpent);

  const weekKey = isoWeekKey(new Date());
  const weekly = customer.weeklyStats?.[weekKey] || {};
  document.getElementById("customerWeekKwh").textContent = `${Number(weekly.kwh || 0).toFixed(1)} kWh`;
  document.getElementById("customerWeekSpent").textContent = currencyIQD(weekly.spent);

  const hasBalance = Number(customer.walletBalance || 0) > 0;
  const isAvailable = connector.status === "Available";
  balanceWarning.classList.toggle("d-none", hasBalance);
  busyWarning.classList.toggle("d-none", isAvailable);
  startBtn.disabled = !hasBalance || !isAvailable;

  identifyBox.classList.add("d-none");
  customerBox.classList.remove("d-none");
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
    identifiedTag = tag;
    await showCustomer(resolvedId, customerSnap.data());
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
    identifiedTag = code;
    await showCustomer(resolvedId, customerSnap.data());
  } catch (err) {
    identifyStatus.textContent = "تعذر التحقق: " + err.message;
    identifyStatus.className = "d-block mt-2 text-danger";
  }
});

// Watches the connector's real status as reported by the physical charger
// over OCPP (StatusNotification -> Firestore, wired in phase 6). Once we've
// actually seen it reach "Charging" and it then leaves that state, that's a
// real signal the session ended - not a guess, and not battery-percentage
// based since most AC chargers never report SoC.
function watchConnector() {
  const connectorRef = doc(db, "evChargers", chargerId, "connectors", connectorId);
  onSnapshot(connectorRef, (snap) => {
    const status = snap.exists() ? snap.data().status : "Unavailable";

    if (status === "Charging") {
      sawCharging = true;
      startStatus.innerHTML = `⚡ جاري الشحن الآن...`;
      startStatus.className = "d-block mt-2 text-success";
    } else if (status === "Faulted") {
      startStatus.innerHTML = `⚠️ في عطل بالمحطة. تواصل مع فريق مُر.`;
      startStatus.className = "d-block mt-2 text-danger";
    } else if (sawCharging) {
      startStatus.innerHTML = `✅ انتهت جلسة الشحن بنجاح، يرجى فصل الشاحن الآن.`;
      startStatus.className = "d-block mt-2 text-success";
    }
  });
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startStatus.textContent = "جاري إرسال طلبك...";
  startStatus.className = "d-block mt-2";

  let requestRef;
  try {
    requestRef = await addDoc(collection(db, "evChargeRequests"), {
      customerId, customerName: customer.name, customerPhone: customer.phone || "",
      chargerId, chargerName: charger.name || charger.ocppId, connectorId,
      status: "pending", requestedAt: serverTimestamp()
    });
  } catch (err) {
    startBtn.disabled = false;
    startStatus.textContent = "تعذر إرسال الطلب: " + err.message;
    startStatus.className = "d-block mt-2 text-danger";
    return;
  }

  // Try to command the charger directly over OCPP (RemoteStartTransaction).
  // If it's offline or rejects, fall back to the existing staff-notification
  // flow instead of leaving the customer with nothing.
  try {
    const res = await fetch(`${OCPP_SERVER_URL}/remote-start/${encodeURIComponent(charger.ocppId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorId, idTag: identifiedTag })
    });

    if (res.ok) {
      await updateDoc(requestRef, { status: "acknowledged", acknowledgedBy: "system" });
      startStatus.innerHTML = `تم إرسال أمر التشغيل للمحطة ⚡`;
      startStatus.className = "d-block mt-2 text-success";
      watchConnector();
    } else {
      startStatus.innerHTML = `المحطة غير متصلة حاليًا ⚠️<br><span class="text-muted">وصل طلبك لفريق مُر وراح يفعّل الشحن يدويًا خلال دقائق.</span>`;
      startStatus.className = "d-block mt-2 text-warning";
      watchConnector();
    }
  } catch {
    startStatus.innerHTML = `تعذر التواصل مع سيرفر الشحن ⚠️<br><span class="text-muted">وصل طلبك لفريق مُر وراح يفعّل الشحن يدويًا خلال دقائق.</span>`;
    startStatus.className = "d-block mt-2 text-warning";
    watchConnector();
  }
});

init();
