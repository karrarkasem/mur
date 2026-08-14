import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import { moveToTrash } from "../../services/trash.js";
import {
  collection, collectionGroup, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const CONNECTOR_BADGE = { Available: "status-done", Charging: "status-contacted", Faulted: "status-rejected", Unavailable: "status-offline" };
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");
const tbody = document.getElementById("chargersBody");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("chargerForm");
const modalEl = document.getElementById("chargerModal");
const modal = new bootstrap.Modal(modalEl);
const connectorsCountInput = document.getElementById("connectorsCount");
const connectorsCountWrap = document.getElementById("connectorsCountWrap");

let allChargers = [];
let connectorsByCharger = {};
let currentUser = null;
let userCanManage = false;

function formatDate(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("ar-IQ", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isOnline(charger) {
  const hb = charger.lastHeartbeat?.toDate ? charger.lastHeartbeat.toDate().getTime() : 0;
  return Date.now() - hb <= ONLINE_THRESHOLD_MS;
}

function connectorBadges(chargerId) {
  const connectors = connectorsByCharger[chargerId] || [];
  if (!connectors.length) return `<span class="text-muted small">—</span>`;
  return connectors
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((c) => `
      <span class="status-badge ${CONNECTOR_BADGE[c.status] || "status-offline"}">#${c.id} ${c.status}</span>
      <button type="button" class="btn-icon" data-qr="${chargerId}" data-connector="${c.id}" title="QR Code"><i class="bi bi-qr-code"></i></button>
    `).join(" ");
}

function chargeUrl(chargerId, connectorId) {
  return `${location.origin}${location.pathname.replace(/ev-chargers\.html$/, "")}charge.html?c=${chargerId}&n=${connectorId}`;
}

function showQr(chargerId, connectorId) {
  const charger = allChargers.find((c) => c.id === chargerId);
  const url = chargeUrl(chargerId, connectorId);
  document.getElementById("qrModalTitle").textContent = `${charger?.name || charger?.ocppId || ""} — موصل #${connectorId}`;
  document.getElementById("qrUrl").value = url;
  const canvas = document.getElementById("qrCanvas");
  QRCode.toCanvas(canvas, url, { width: 220 }, (err) => { if (err) console.error(err); });
  new bootstrap.Modal(document.getElementById("qrModal")).show();
}

function render() {
  countLabel.textContent = `${allChargers.length} محطة`;

  if (!allChargers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="bi bi-ev-station"></i>ماكو محطات مسجلة بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = allChargers.map((c) => `
    <tr>
      <td><strong>${c.ocppId}</strong><br><span class="text-muted small">${c.name || ""}</span></td>
      <td>${c.location || "—"}</td>
      <td>${c.vendor || "—"} ${c.model ? "/ " + c.model : ""}</td>
      <td>${c.powerKw ? c.powerKw + " kW" : "—"}${c.phase ? `<br><span class="text-muted small">${c.phase}</span>` : ""}</td>
      <td>${connectorBadges(c.id)}</td>
      <td>
        <span class="status-badge ${isOnline(c) ? "status-done" : "status-offline"}">${isOnline(c) ? "Online" : "Offline"}</span>
        <br><span class="text-muted small">${formatDate(c.lastHeartbeat)}</span>
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
    btn.addEventListener("click", () => openModal(allChargers.find((c) => c.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-qr]").forEach((btn) => {
    btn.addEventListener("click", () => showQr(btn.dataset.qr, btn.dataset.connector));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.delete;
      if (!confirm("تأكيد نقل هذه المحطة لسلة المحذوفات؟ يقدر ترجع من هناك (الموصلات ما ترجع تلقائيًا وتنعاد بنفس العدد الافتراضي).")) return;
      try {
        const { id: _id, ...data } = allChargers.find((c) => c.id === id) || {};
        await deleteChargerConnectors(id);
        await moveToTrash("evChargers", id, data);
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

async function deleteChargerConnectors(chargerId) {
  const connectors = connectorsByCharger[chargerId] || [];
  if (!connectors.length) return;
  const batch = writeBatch(db);
  connectors.forEach((c) => batch.delete(doc(db, "evChargers", chargerId, "connectors", c.id)));
  await batch.commit();
}

async function createConnectors(chargerId, count) {
  const batch = writeBatch(db);
  for (let i = 1; i <= count; i++) {
    batch.set(doc(db, "evChargers", chargerId, "connectors", String(i)), {
      status: "Available", currentSessionId: null, currentPowerKw: 0, errorCode: null
    });
  }
  await batch.commit();
}

function openModal(charger) {
  form.reset();
  document.getElementById("chargerId").value = charger?.id || "";
  document.getElementById("chargerModalTitle").textContent = charger ? "تعديل المحطة" : "إضافة محطة";
  document.getElementById("ocppId").value = charger?.ocppId || "";
  document.getElementById("name").value = charger?.name || "";
  document.getElementById("location").value = charger?.location || "";
  document.getElementById("vendor").value = charger?.vendor || "";
  document.getElementById("model").value = charger?.model || "";
  document.getElementById("powerKw").value = charger?.powerKw || "";
  document.getElementById("phase").value = charger?.phase || "3 Phase";
  document.getElementById("notes").value = charger?.notes || "";
  connectorsCountInput.value = 1;
  connectorsCountWrap.classList.toggle("d-none", !!charger);
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("chargerId").value;
  const data = {
    ocppId: document.getElementById("ocppId").value.trim(),
    name: document.getElementById("name").value.trim(),
    location: document.getElementById("location").value.trim(),
    vendor: document.getElementById("vendor").value.trim(),
    model: document.getElementById("model").value.trim(),
    powerKw: Number(document.getElementById("powerKw").value) || null,
    phase: document.getElementById("phase").value,
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "evChargers", id), { ...data, updatedBy: currentUser?.email || null, updatedAt: serverTimestamp() });
    } else {
      const ref = await addDoc(collection(db, "evChargers"), {
        ...data, lastHeartbeat: null, totalKwh: 0,
        createdBy: currentUser?.email || null, createdAt: serverTimestamp()
      });
      const count = Math.max(1, Number(connectorsCountInput.value) || 1);
      await createConnectors(ref.id, count);
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

  const q = query(collection(db, "evChargers"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allChargers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });

  onSnapshot(collectionGroup(db, "connectors"), (snapshot) => {
    const grouped = {};
    snapshot.docs.forEach((d) => {
      const chargerId = d.ref.parent.parent.id;
      (grouped[chargerId] ||= []).push({ id: d.id, ...d.data() });
    });
    connectorsByCharger = grouped;
    render();
  }, (err) => { console.error("connectors:", err.message); });
});
