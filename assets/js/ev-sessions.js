import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, collectionGroup, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, serverTimestamp, runTransaction, Timestamp, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const PAYMENT_LABELS = { wallet: "المحفظة", cash: "نقدًا", pending: "بدون تحصيل" };
const OCPP_SERVER_URL = "https://mur-ocpp-server.mur-ev-iq.workers.dev";

// Deep-linked from ev-station-map.html ("ابدأ جلسة" on an available station) -
// pre-fills and opens the manual-session modal for that exact charger/connector.
const params = new URLSearchParams(location.search);
const preselect = params.get("chargerId") ? { chargerId: params.get("chargerId"), connectorId: params.get("connectorId") || "1" } : null;
let preselectApplied = false;

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");
const chargeRequestsBody = document.getElementById("chargeRequestsBody");
const tbody = document.getElementById("sessionsBody");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("sessionForm");
const modalEl = document.getElementById("sessionModal");
const modal = new bootstrap.Modal(modalEl);
const customerSelect = document.getElementById("customerSelect");
const chargerSelect = document.getElementById("chargerSelect");
const connectorSelect = document.getElementById("connectorSelect");
const energyInput = document.getElementById("energyKwh");
const priceInput = document.getElementById("pricePerKwh");
const costInput = document.getElementById("finalCost");
const paymentSelect = document.getElementById("paymentStatus");
const walletWarning = document.getElementById("walletWarning");

let allSessions = [];
let allCustomers = [];
let allChargers = [];
let connectorsByCharger = {};
let currentUser = null;

function formatDateTime(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function currencyIQD(n) {
  return Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
}

// Keyed by ISO week so charge.html can show "this week's" consumption/spend
// without needing a public list-query permission on evChargingSessions
// (that collection stays signed-in-only - see firestore.rules). Must stay
// in sync with the copy of this function in charge.js.
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function durationLabel(start, stop) {
  if (!start?.toDate || !stop?.toDate) return "—";
  const mins = Math.round((stop.toDate() - start.toDate()) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}س ${m}د` : `${m}د`;
}

function render() {
  countLabel.textContent = `${allSessions.length} جلسة`;

  if (!allSessions.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="bi bi-lightning-charge"></i>ماكو جلسات شحن مسجّلة بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = allSessions.map((s) => `
    <tr>
      <td><strong>${s.customerName || "—"}</strong>${s.customerPhone ? `<br><span class="text-muted small" dir="ltr">${s.customerPhone}</span>` : ""}</td>
      <td>${s.chargerName || "—"}${s.connectorId ? ` <span class="text-muted small">#${s.connectorId}</span>` : ""}</td>
      <td>${formatDateTime(s.startTime)}<br><span class="text-muted small">${durationLabel(s.startTime, s.stopTime)}</span></td>
      <td>${Number(s.energyConsumedKwh || 0).toFixed(1)} kWh</td>
      <td>${currencyIQD(s.finalCost)}</td>
      <td><span class="status-badge ${s.paymentStatus === "wallet" ? "status-done" : s.paymentStatus === "cash" ? "status-contacted" : "status-pending"}">${PAYMENT_LABELS[s.paymentStatus] || "—"}</span></td>
      <td>${s.source === "manual" ? `<span class="status-badge type-badge">تسجيل يدوي</span>` : "OCPP"}</td>
    </tr>
  `).join("");
}

function renderChargeRequests(requests) {
  const pending = requests.filter((r) => r.status === "pending");
  if (!pending.length) {
    chargeRequestsBody.innerHTML = `<tr><td colspan="4" class="empty-state">ماكو طلبات معلّقة</td></tr>`;
    return;
  }
  chargeRequestsBody.innerHTML = pending.map((r) => `
    <tr>
      <td>${r.customerName || "—"}</td>
      <td>${r.chargerName || "—"} <span class="text-muted small">#${r.connectorId}</span></td>
      <td>${formatDateTime(r.requestedAt)}</td>
      <td><button class="btn btn-sm btn-outline-secondary" data-ack="${r.id}">تم التفعيل يدويًا</button></td>
    </tr>
  `).join("");

  chargeRequestsBody.querySelectorAll("[data-ack]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "evChargeRequests", btn.dataset.ack), {
          status: "acknowledged", acknowledgedBy: currentUser?.email || null, acknowledgedAt: serverTimestamp()
        });
      } catch (err) {
        alert("تعذر التحديث: " + err.message);
      }
    });
  });
}

function populateSelects() {
  customerSelect.innerHTML = `<option value="" disabled selected>اختر العميل</option>` +
    allCustomers.map((c) => `<option value="${c.id}">${c.name} — ${c.phone || ""} (${currencyIQD(c.walletBalance)})</option>`).join("");

  chargerSelect.innerHTML = `<option value="" disabled selected>اختر المحطة</option>` +
    allChargers.map((c) => `<option value="${c.id}">${c.name || c.ocppId}</option>`).join("");
}

function populateConnectors() {
  const chargerId = chargerSelect.value;
  const connectors = connectorsByCharger[chargerId] || [];
  connectorSelect.innerHTML = connectors.length
    ? connectors.map((c) => `<option value="${c.id}">#${c.id}</option>`).join("")
    : `<option value="1">#1</option>`;
}

chargerSelect.addEventListener("change", populateConnectors);

function recalcCost() {
  const energy = Number(energyInput.value) || 0;
  const price = Number(priceInput.value) || 0;
  costInput.value = (energy * price).toFixed(0);
}
energyInput.addEventListener("input", recalcCost);
priceInput.addEventListener("input", recalcCost);

paymentSelect.addEventListener("change", () => {
  if (paymentSelect.value !== "wallet") { walletWarning.classList.add("d-none"); return; }
  const customer = allCustomers.find((c) => c.id === customerSelect.value);
  const cost = Number(costInput.value) || 0;
  const balance = Number(customer?.walletBalance || 0);
  walletWarning.classList.toggle("d-none", !customer || balance >= cost);
});

function openAddModal(prefill) {
  form.reset();
  populateSelects();
  if (prefill?.chargerId) chargerSelect.value = prefill.chargerId;
  populateConnectors();
  if (prefill?.connectorId) connectorSelect.value = prefill.connectorId;
  priceInput.value = 300;
  costInput.value = 0;
  walletWarning.classList.add("d-none");
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openAddModal());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const customer = allCustomers.find((c) => c.id === customerSelect.value);
  const charger = allChargers.find((c) => c.id === chargerSelect.value);
  const energyConsumedKwh = Number(energyInput.value) || 0;
  const pricePerKwh = Number(priceInput.value) || 0;
  const finalCost = Number(costInput.value) || 0;
  const paymentStatus = paymentSelect.value;
  const startMinutesAgo = Number(document.getElementById("durationMinutes").value) || 0;

  if (!customer || !charger) { alert("اختر العميل والمحطة."); return; }

  const stopTime = Timestamp.now();
  const startTime = Timestamp.fromMillis(stopTime.toMillis() - startMinutesAgo * 60000);
  const weekKey = isoWeekKey(startTime.toDate());

  const sessionData = {
    customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "",
    chargerId: charger.id, chargerName: charger.name || charger.ocppId, connectorId: connectorSelect.value,
    startTime, stopTime, energyConsumedKwh, pricePerKwh, finalCost, paymentStatus,
    stopReason: document.getElementById("stopReason").value.trim() || "Manual",
    notes: document.getElementById("notes").value.trim(),
    status: "completed", source: "manual",
    loggedBy: currentUser?.email || null, loggedAt: serverTimestamp()
  };

  try {
    if (paymentStatus === "wallet") {
      const customerRef = doc(db, "evCustomers", customer.id);
      const chargerRef = doc(db, "evChargers", charger.id);
      const sessionRef = doc(collection(db, "evChargingSessions"));
      const txnRef = doc(collection(db, "evWalletTransactions"));

      await runTransaction(db, async (t) => {
        const customerSnap = await t.get(customerRef);
        const balance = Number(customerSnap.data()?.walletBalance || 0);
        if (balance < finalCost) throw new Error("رصيد العميل غير كافي لتغطية هذه الجلسة.");
        const newBalance = balance - finalCost;

        t.set(sessionRef, sessionData);
        t.update(customerRef, {
          walletBalance: newBalance,
          totalConsumptionKwh: increment(energyConsumedKwh),
          totalSpent: increment(finalCost),
          [`weeklyStats.${weekKey}.kwh`]: increment(energyConsumedKwh),
          [`weeklyStats.${weekKey}.spent`]: increment(finalCost)
        });
        t.update(chargerRef, { totalKwh: increment(energyConsumedKwh) });
        t.set(txnRef, {
          customerId: customer.id, type: "charge", amount: finalCost, relatedSessionId: sessionRef.id,
          balanceAfter: newBalance, by: currentUser?.email || null, at: serverTimestamp()
        });
      });
    } else {
      const sessionRef = doc(collection(db, "evChargingSessions"));
      const batch = writeBatch(db);
      batch.set(sessionRef, sessionData);
      batch.update(doc(db, "evCustomers", customer.id), {
        totalConsumptionKwh: increment(energyConsumedKwh),
        totalSpent: increment(finalCost),
        [`weeklyStats.${weekKey}.kwh`]: increment(energyConsumedKwh),
        [`weeklyStats.${weekKey}.spent`]: increment(finalCost)
      });
      batch.update(doc(db, "evChargers", charger.id), { totalKwh: increment(energyConsumedKwh) });
      await batch.commit();
    }
    modal.hide();

    // Best-effort Telegram alert - never let a notification failure look
    // like the session itself failed to save (it already did, above).
    fetch(`${OCPP_SERVER_URL}/notify-session-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id, chargerName: charger.name || charger.ocppId,
        connectorId: connectorSelect.value, energyKwh: energyConsumedKwh, finalCost,
        loggedBy: currentUser?.email || null
      })
    }).catch(() => {});
  } catch (err) {
    alert("تعذر تسجيل الجلسة: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUser = user;
  if (!canManage(role)) {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  onSnapshot(query(collection(db, "evChargingSessions"), orderBy("startTime", "desc")), (snap) => {
    allSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => { tbody.innerHTML = `<tr><td colspan="7" class="empty-state">تعذر التحميل: ${err.message}</td></tr>`; });

  function maybeApplyPreselect() {
    if (preselect && !preselectApplied && allCustomers.length && allChargers.length) {
      preselectApplied = true;
      openAddModal(preselect);
    }
  }

  onSnapshot(collection(db, "evCustomers"), (snap) => {
    allCustomers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    maybeApplyPreselect();
  });

  onSnapshot(collection(db, "evChargers"), (snap) => {
    allChargers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    maybeApplyPreselect();
  });

  onSnapshot(collectionGroup(db, "connectors"), (snap) => {
    const grouped = {};
    snap.docs.forEach((d) => {
      const chargerId = d.ref.parent.parent.id;
      (grouped[chargerId] ||= []).push({ id: d.id, ...d.data() });
    });
    connectorsByCharger = grouped;
  });

  onSnapshot(query(collection(db, "evChargeRequests"), orderBy("requestedAt", "desc")), (snap) => {
    renderChargeRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => { chargeRequestsBody.innerHTML = `<tr><td colspan="4" class="empty-state">تعذر التحميل: ${err.message}</td></tr>`; });
});
