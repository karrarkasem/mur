import { db } from "../../services/firebase.js";
import { requireAuth } from "../../services/auth-guard.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const IRAQ_CENTER = [33.3, 44.4];
const countLabel = document.getElementById("mapCountLabel");

requireAuth(() => {
  const map = L.map("allMap").setView(IRAQ_CENTER, 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const markers = L.layerGroup().addTo(map);

  onSnapshot(collection(db, "companies"), (snapshot) => {
    markers.clearLayers();
    const companies = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.lat && c.lng);

    countLabel.textContent = `${companies.length} موقع محدد على الخارطة من أصل ${snapshot.size} شركة`;

    companies.forEach((c) => {
      L.marker([c.lat, c.lng]).addTo(markers).bindPopup(`
        <strong>${c.name}</strong><br>
        ${c.sector ? c.sector + "<br>" : ""}
        ${c.governorate ? c.governorate + " — " : ""}${c.address || ""}
        ${c.phone ? `<br>${c.phone}` : ""}
      `);
    });

    if (companies.length) {
      const bounds = L.latLngBounds(companies.map((c) => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  });
});
