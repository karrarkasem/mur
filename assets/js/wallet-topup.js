import { db } from "../../services/firebase.js";
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const topupForm = document.getElementById("topupForm");
const rfidForm = document.getElementById("rfidForm");
const topupStatus = document.getElementById("topupStatus");
const rfidStatus = document.getElementById("rfidStatus");
const amountInput = document.getElementById("amountInput");

document.querySelectorAll("#modeTabs [data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#modeTabs [data-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    topupForm.classList.toggle("d-none", mode !== "topup");
    rfidForm.classList.toggle("d-none", mode !== "rfid");
  });
});

document.querySelectorAll(".amount-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".amount-btn").forEach((b) => b.classList.remove("btn-brand", "text-white"));
    btn.classList.add("btn-brand", "text-white");
    amountInput.value = btn.dataset.amount;
  });
});

topupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  topupStatus.textContent = "جاري الإرسال...";
  const data = Object.fromEntries(new FormData(topupForm).entries());

  try {
    await addDoc(collection(db, "evTopupRequests"), {
      customerName: data.name,
      customerPhone: data.phone,
      amount: Number(data.amount) || 0,
      method: data.method,
      status: "pending",
      requestedAt: serverTimestamp()
    });
    topupForm.reset();
    topupStatus.textContent = "تم إرسال طلبك بنجاح. راح يتواصل معك فريقنا قريبًا.";
    topupStatus.className = "mt-2 d-block text-success";
  } catch (error) {
    console.error(error);
    topupStatus.textContent = "تعذر الإرسال. حاول مرة ثانية.";
    topupStatus.className = "mt-2 d-block text-danger";
  }
});

rfidForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  rfidStatus.textContent = "جاري الإرسال...";
  const data = Object.fromEntries(new FormData(rfidForm).entries());

  try {
    await addDoc(collection(db, "evRfidRequests"), {
      customerName: data.name,
      customerPhone: data.phone,
      status: "requested",
      requestedAt: serverTimestamp()
    });
    rfidForm.reset();
    rfidStatus.textContent = "تم إرسال طلبك بنجاح. راح يتواصل معك فريقنا لتسليم البطاقة.";
    rfidStatus.className = "mt-2 d-block text-success";
  } catch (error) {
    console.error(error);
    rfidStatus.textContent = "تعذر الإرسال. حاول مرة ثانية.";
    rfidStatus.className = "mt-2 d-block text-danger";
  }
});
