import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import { collection, collectionGroup, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STATUS_BADGE = { Available: "status-done", Charging: "status-contacted", Faulted: "status-rejected", Unavailable: "status-offline" };
const STATUS_LABEL = { Available: "فاضية", Charging: "تشحن حاليًا", Faulted: "عطل", Unavailable: "غير متصلة" };

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");
const grid = document.getElementById("stationsGrid");

let allChargers = [];
let connectorsByCharger = {};

function render() {
  if (!allChargers.length) {
    grid.innerHTML = `<div class="empty-state w-100"><i class="bi bi-ev-station"></i>ماكو محطات مسجّلة بعد</div>`;
    return;
  }

  const cards = [];
  allChargers.forEach((charger) => {
    const connectors = connectorsByCharger[charger.id]?.length
      ? connectorsByCharger[charger.id]
      : [{ id: "1", status: "Unavailable" }];

    connectors.forEach((connector) => {
      const status = connector.status || "Unavailable";
      const badge = STATUS_BADGE[status] || "status-offline";
      const label = STATUS_LABEL[status] || status;
      const isAvailable = status === "Available";

      cards.push(`
        <div class="col-6 col-md-4 col-lg-3">
          <div class="station-card">
            <span class="status-badge ${badge}">${label}</span>
            <h6>${charger.name || charger.ocppId}</h6>
            <p class="text-muted small mb-3">موصل #${connector.id}${charger.location ? ` · ${charger.location}` : ""}</p>
            ${isAvailable
              ? `<button class="btn btn-brand btn-sm w-100" data-start="${charger.id}" data-connector="${connector.id}">⚡ ابدأ جلسة</button>`
              : `<a href="ev-sessions.html" class="btn btn-outline-secondary btn-sm w-100">تفاصيل الجلسات</a>`}
          </div>
        </div>
      `);
    });
  });

  grid.innerHTML = cards.join("");

  grid.querySelectorAll("[data-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.href = `ev-sessions.html?chargerId=${encodeURIComponent(btn.dataset.start)}&connectorId=${encodeURIComponent(btn.dataset.connector)}`;
    });
  });
}

requireAuth((user, role) => {
  if (!canManage(role)) {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  onSnapshot(collection(db, "evChargers"), (snap) => {
    allChargers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => { grid.innerHTML = `<div class="empty-state w-100">تعذر التحميل: ${err.message}</div>`; });

  onSnapshot(collectionGroup(db, "connectors"), (snap) => {
    const grouped = {};
    snap.docs.forEach((d) => {
      const chargerId = d.ref.parent.parent.id;
      (grouped[chargerId] ||= []).push({ id: d.id, ...d.data() });
    });
    connectorsByCharger = grouped;
    render();
  });
});
