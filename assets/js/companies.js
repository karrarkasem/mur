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

const GOVERNORATE_COORDS = {
  "بغداد": [33.3152, 44.3661], "البصرة": [30.5085, 47.7804], "نينوى": [36.3350, 43.1189],
  "أربيل": [36.1901, 44.0091], "النجف": [31.9962, 44.3268], "كربلاء": [32.6160, 44.0249],
  "كركوك": [35.4681, 44.3922], "الأنبار": [33.4200, 43.3000], "ذي قار": [31.0559, 46.2570],
  "بابل": [32.4637, 44.4194], "ديالى": [33.7500, 44.6367], "واسط": [32.5122, 45.8235],
  "ميسان": [31.8356, 47.1450], "المثنى": [31.3234, 45.2830], "القادسية": [31.9959, 44.9248],
  "صلاح الدين": [34.6100, 43.6800], "دهوك": [36.8642, 42.9903], "السليمانية": [35.5650, 45.4331]
};

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
let currentUser = null;
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
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 19
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

governorateSelect.addEventListener("change", () => {
  const coords = GOVERNORATE_COORDS[governorateSelect.value];
  if (coords && map) map.setView(coords, 10);
});

modalEl.addEventListener("shown.bs.modal", () => {
  ensureMap();
  map.invalidateSize();
  if (selectedLat && selectedLng) {
    map.setView([selectedLat, selectedLng], 14);
    placeMarker(selectedLat, selectedLng);
  } else if (GOVERNORATE_COORDS[governorateSelect.value]) {
    map.setView(GOVERNORATE_COORDS[governorateSelect.value], 10);
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
      <td><strong>${c.name}</strong>${c.address ? `<br><span class="text-muted small">${c.address}</span>` : ""}${c.createdBy ? `<br><span class="text-muted small"><i class="bi bi-person"></i> أضافها ${c.createdBy}</span>` : ""}</td>
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

document.getElementById("exportBtn").addEventListener("click", () => {
  const rows = allCompanies.map((c) => ({
    "اسم الشركة": c.name || "",
    "النشاط": c.sector || "",
    "الشخص المسؤول": c.contactPerson || "",
    "الهاتف": c.phone || "",
    "الإيميل": c.email || "",
    "المحافظة": c.governorate || "",
    "العنوان": c.address || "",
    "ملاحظات": c.notes || "",
    "أضافها": c.createdBy || ""
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الشركات");
  XLSX.writeFile(wb, `شركات-مُر-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

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
      await updateDoc(doc(db, "companies", id), { ...data, updatedBy: currentUser?.email || null, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "companies"), { ...data, createdBy: currentUser?.email || null, createdAt: serverTimestamp() });
    }
    modal.hide();
  } catch (err) {
    alert("تعذر الحفظ: " + err.message);
  }
});

requireAuth((user, role) => {
  currentUser = user;
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
