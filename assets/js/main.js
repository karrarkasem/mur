import { db } from "../../services/firebase.js";
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form = document.getElementById("leadForm");
const statusEl = document.getElementById("leadStatus");
const requestTypeSelect = document.getElementById("requestType");

function updateFormFields() {
  const selected = requestTypeSelect.value;
  document.querySelectorAll(".field-group").forEach((group) => {
    const visible = group.dataset.showFor.split(",").includes(selected);
    group.classList.toggle("d-none", !visible);
    const governorateSelect = group.querySelector("select[name=governorate]");
    if (governorateSelect) governorateSelect.required = visible;
  });
}

requestTypeSelect?.addEventListener("change", updateFormFields);
updateFormFields();

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "جاري الإرسال...";
  const data = Object.fromEntries(new FormData(form).entries());

  try {
    await addDoc(collection(db, "leads"), {
      ...data,
      source: "website",
      status: "new",
      createdAt: serverTimestamp()
    });
    form.reset();
    statusEl.textContent = "تم إرسال الطلب بنجاح.";
    statusEl.className = "mt-2 text-success";
  } catch (error) {
    console.error(error);
    statusEl.textContent = "تعذر الإرسال. تأكد من إعداد Firebase.";
    statusEl.className = "mt-2 text-danger";
  }
});
