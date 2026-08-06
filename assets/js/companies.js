import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const GOVERNORATES = [
  "بغداد", "البصرة", "نينوى", "أربيل", "النجف", "كربلاء", "كركوك", "الأنبار",
  "ذي قار", "بابل", "ديالى", "واسط", "ميسان", "المثنى", "القادسية",
  "صلاح الدين", "دهوك", "السليمانية"
];

const IRAQ_CENTER = [33.3, 44.4];

const tbody = document.getElementById("companiesBody");
const searchInput = document.getElementById("searchInput");
const countLabel = document.getElementById("countLabel");
const form = document.getElementById("companyForm");
const modalEl = document.getElementById("companyModal");
const modal = new bootstrap.Modal(modalEl);
const governorateSelect = document.getElementById("governorate");
const coordsLabel = document.getElementById("coordsLabel");

let allCompanies = [];
let userCanManage = false;
let map = null;
let marker = null;
let selectedLat = null;
let selectedLng = null;

governorateSelect.innerHTML += GOVERNORATES.map((g) => `<option value="${g}">${g}</option>`).join("");

function setCoords(lat, lng) {
  selectedLat = lat;
  selectedLng = lng;
  coordsLabel.textContent = `الإحداثيات المحددة: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function ensureMap() {
  if (map) return;
  map = L.map("locationMap", { scrollWheelZoom: false }).setView(IRAQ_CENTER, 6);
  map.on("click", () => map.scrollWheelZoom.enable());
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  map.on("click", (e) => {
    placeMarker(e.latlng.lat, e.latlng.lng);
  });
}

function placeMarker(lat, lng) {
  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      setCoords(pos.lat, pos.lng);
    });
  }
  setCoords(lat, lng);
}

modalEl.addEventListener("shown.bs.modal", () => {
  ensureMap();
  map.invalidateSize();
  if (selectedLat && selectedLng) {
    map.setView([selectedLat, selectedLng], 14);
    placeMarker(selectedLat, selectedLng);
  }
});

function mapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const rows = term ? allCompanies.filter((c) => (c.name || "").toLowerCase().includes(term)) : allCompanies;

  countLabel.textContent = `${rows.length} من ${allCompanies.length} شركة`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="bi bi-building"></i>ماكو شركات مسجلة بعد</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((c) => `
    <tr>
      <td><strong>${c.name}</strong>${c.address ? `<br><span class="text-muted small">${c.address}</span>` : ""}</td>
      <td>${c.sector || "—"}</td>
      <td>${c.governorate || "—"}</td>
      <td>${c.contactPerson || "—"}</td>
      <td dir="ltr" class="text-end">${c.phone || "—"}</td>
      <td>${c.lat && c.lng ? `<a href="${mapsLink(c.lat, c.lng)}" target="_blank" class="btn-icon" title="فتح على الخارطة"><i class="bi bi-geo-alt-fill" style="color:var(--brand)"></i></a>` : `<span class="text-muted small">—</span>`}</td>
      <td class="text-nowrap">
        ${userCanManage ? `
          <button class="btn-icon" data-edit="${c.id}" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn-icon danger" data-delete="${c.id}" title="حذف"><i class="bi bi-trash"></i></button>
        ` : ""}
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(allCompanies.find((c) => c.id === btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف هذه الشركة؟")) return;
      try {
        await deleteDoc(doc(db, "companies", btn.dataset.delete));
      } catch (err) {
        alert("تعذر الحذف: " + err.message);
      }
    });
  });
}

function openModal(company) {
  form.reset();
  document.getElementById("companyId").value = company?.id || "";
  document.getElementById("companyModalTitle").textContent = company ? "تعديل الشركة" : "إضافة شركة";
  document.getElementById("name").value = company?.name || "";
  document.getElementById("sector").value = company?.sector || "";
  document.getElementById("contactPerson").value = company?.contactPerson || "";
  document.getElementById("phone").value = company?.phone || "";
  document.getElementById("email").value = company?.email || "";
  document.getElementById("address").value = company?.address || "";
  governorateSelect.value = company?.governorate || "";
  document.getElementById("notes").value = company?.notes || "";

  marker = null;
  if (company?.lat && company?.lng) {
    setCoords(company.lat, company.lng);
  } else {
    selectedLat = null;
    selectedLng = null;
    coordsLabel.textContent = "ما تم تحديد موقع بعد";
  }
  modal.show();
}

document.getElementById("addBtn").addEventListener("click", () => openModal(null));
searchInput.addEventListener("input", render);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("companyId").value;
  const data = {
    name: document.getElementById("name").value.trim(),
    sector: document.getElementById("sector").value.trim(),
    contactPerson: document.getElementById("contactPerson").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    email: document.getElementById("email").value.trim(),
    governorate: governorateSelect.value,
    address: document.getElementById("address").value.trim(),
    lat: selectedLat,
    lng: selectedLng,
    notes: document.getElementById("notes").value.trim()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "companies", id), data);
    } else {
      await addDoc(collection(db, "companies"), { ...data, createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  userCanManage = canManage(role);
  if (!userCanManage) document.getElementById("addBtn").classList.add("d-none");
  const q = query(collection(db, "companies"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    allCompanies = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">تعذر تحميل البيانات: ${err.message}</td></tr>`;
  });
});
