import { db } from "../../services/firebase.js";
import { GOVERNORATES } from "./companies.js";
import { collection, doc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FIELDS = [
  { key: "ignore", label: "تجاهل هذا العمود" },
  { key: "name", label: "اسم الشركة" },
  { key: "sector", label: "النشاط" },
  { key: "contactPerson", label: "الشخص المسؤول" },
  { key: "phone", label: "الهاتف" },
  { key: "email", label: "الإيميل" },
  { key: "governorate", label: "المحافظة" },
  { key: "address", label: "العنوان" },
  { key: "notes", label: "ملاحظات" }
];

const HEADER_HINTS = {
  name: ["اسم", "شركة", "name", "company"],
  sector: ["نشاط", "sector", "type", "قطاع", "activity", "category"],
  contactPerson: ["مسؤول", "شخص", "contact", "person"],
  phone: ["هاتف", "phone", "جوال", "موبايل", "رقم", "tel", "mobile"],
  email: ["ايميل", "إيميل", "email", "mail"],
  governorate: ["محافظة", "governorate", "province", "city", "مدينة", "region"],
  address: ["عنوان", "address", "location"],
  notes: ["ملاحظ", "notes", "comment"]
};

const modalEl = document.getElementById("importModal");
const modal = new bootstrap.Modal(modalEl);
const step1 = document.getElementById("importStep1");
const step2 = document.getElementById("importStep2");
const step3 = document.getElementById("importStep3");
const mappingRow = document.getElementById("mappingRow");
const firstRowHeader = document.getElementById("firstRowHeader");
const previewTable = document.getElementById("previewTable");
const importSummary = document.getElementById("importSummary");

let rawRows = [];
let mapping = [];

function resetImport() {
  rawRows = [];
  mapping = [];
  step1.classList.remove("d-none");
  step2.classList.add("d-none");
  step3.classList.add("d-none");
  document.getElementById("importFile").value = "";
  document.getElementById("importText").value = "";
}

document.getElementById("importBtn").addEventListener("click", () => {
  resetImport();
  modal.show();
});

function splitLine(line) {
  const delimiter = line.includes("\t") ? "\t" : ",";
  return line.split(delimiter).map((c) => c.trim());
}

function parseText(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(splitLine);
}

async function parseFile(file) {
  if (/\.csv$/i.test(file.name)) {
    // Read as text directly so UTF-8 (Arabic) decodes correctly - XLSX's binary
    // CSV reader can mangle non-Latin encodings.
    const text = await file.text();
    return parseText(text);
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return rows
    .map((r) => r.map((c) => String(c ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));
}

function guessMapping(headerRow) {
  return headerRow.map((cell) => {
    const lower = cell.toLowerCase();
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (hints.some((h) => lower.includes(h))) return field;
    }
    return "ignore";
  });
}

function buildMappingUI(colCount, headerRow) {
  mappingRow.innerHTML = "";
  mapping = firstRowHeader.checked ? guessMapping(headerRow) : new Array(colCount).fill("ignore");

  for (let i = 0; i < colCount; i++) {
    const wrap = document.createElement("div");
    wrap.style.minWidth = "160px";
    const label = firstRowHeader.checked && headerRow[i] ? headerRow[i] : `عمود ${i + 1}`;
    wrap.innerHTML = `
      <label class="form-label small text-muted mb-1">${label}</label>
      <select class="form-select form-select-sm" data-col="${i}">
        ${FIELDS.map((f) => `<option value="${f.key}" ${mapping[i] === f.key ? "selected" : ""}>${f.label}</option>`).join("")}
      </select>
    `;
    mappingRow.appendChild(wrap);
  }

  mappingRow.querySelectorAll("select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      mapping[Number(e.target.dataset.col)] = e.target.value;
      renderPreview();
    });
  });
}

function dataRows() {
  return firstRowHeader.checked ? rawRows.slice(1) : rawRows;
}

function rowToCompany(row) {
  const company = {};
  mapping.forEach((field, i) => {
    if (field === "ignore") return;
    company[field] = (row[i] || "").trim();
  });
  return company;
}

function renderPreview() {
  const rows = dataRows();
  const previewFields = FIELDS.filter((f) => f.key !== "ignore");

  previewTable.querySelector("thead").innerHTML = `<tr>${previewFields.map((f) => `<th>${f.label}</th>`).join("")}</tr>`;
  previewTable.querySelector("tbody").innerHTML = rows.slice(0, 5).map((row) => {
    const c = rowToCompany(row);
    return `<tr>${previewFields.map((f) => `<td>${c[f.key] || "—"}</td>`).join("")}</tr>`;
  }).join("");

  const validCount = rows.filter((row) => rowToCompany(row).name).length;
  importSummary.textContent = `${rows.length} صف تم العثور عليه — ${validCount} صالح للاستيراد (يحتاج اسم شركة على الأقل).`;
}

document.getElementById("importParseBtn").addEventListener("click", async () => {
  const isFileTab = document.getElementById("importFileTab").classList.contains("active");

  try {
    if (isFileTab) {
      const file = document.getElementById("importFile").files[0];
      if (!file) { alert("اختر ملف أولاً."); return; }
      rawRows = await parseFile(file);
    } else {
      const text = document.getElementById("importText").value;
      if (!text.trim()) { alert("الصق النص أولاً."); return; }
      rawRows = parseText(text);
    }

    if (!rawRows.length) { alert("ما لقيت بيانات قابلة للقراءة."); return; }

    const colCount = Math.max(...rawRows.map((r) => r.length));
    buildMappingUI(colCount, rawRows[0]);
    renderPreview();
    step1.classList.add("d-none");
    step2.classList.remove("d-none");
  } catch (err) {
    alert("تعذرت قراءة البيانات: " + err.message);
  }
});

firstRowHeader.addEventListener("change", () => {
  const colCount = Math.max(...rawRows.map((r) => r.length));
  buildMappingUI(colCount, rawRows[0]);
  renderPreview();
});

document.getElementById("importBackBtn").addEventListener("click", () => {
  step2.classList.add("d-none");
  step1.classList.remove("d-none");
});

document.getElementById("importConfirmBtn").addEventListener("click", async () => {
  const rows = dataRows().map(rowToCompany).filter((c) => c.name);
  if (!rows.length) { alert("ماكو صفوف صالحة للاستيراد (تحتاج اسم شركة)."); return; }

  const btn = document.getElementById("importConfirmBtn");
  btn.disabled = true;
  btn.textContent = "جاري الاستيراد...";

  try {
    let imported = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((c) => {
        const ref = doc(collection(db, "companies"));
        const governorate = GOVERNORATES.includes(c.governorate) ? c.governorate : (c.governorate || "");
        batch.set(ref, {
          name: c.name,
          sector: c.sector || "",
          contactPerson: c.contactPerson || "",
          phone: c.phone || "",
          email: c.email || "",
          governorate,
          address: c.address || "",
          notes: c.notes || "",
          lat: null,
          lng: null,
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();
      imported += chunk.length;
    }

    document.getElementById("importResultText").textContent = `تم استيراد ${imported} شركة بنجاح!`;
    step2.classList.add("d-none");
    step3.classList.remove("d-none");
  } catch (err) {
    alert("صار خطأ أثناء الاستيراد: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle"></i> تأكيد الاستيراد';
  }
});
