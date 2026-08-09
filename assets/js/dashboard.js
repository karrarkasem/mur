import { db } from "../../services/firebase.js";
import { requireAuth } from "../../services/auth-guard.js";
import { collection, getCountFromServer, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const counters = {
  companies: document.getElementById("companiesCount"),
  leads: document.getElementById("leadsCount"),
  tasks: document.getElementById("tasksCount"),
  quotes: document.getElementById("quotesCount")
};

const TYPE_LABELS = {
  installation: "تركيب", maintenance: "صيانة", site_survey: "دراسة موقع",
  follow_up: "متابعة عميل", admin: "إداري", other: "أخرى"
};

async function loadCounters() {
  for (const [collectionName, element] of Object.entries(counters)) {
    try {
      const snapshot = await getCountFromServer(collection(db, collectionName));
      element.textContent = snapshot.data().count;
    } catch {
      element.textContent = "—";
    }
  }
}

function loadFollowUps() {
  const box = document.getElementById("followUpsBox");
  const list = document.getElementById("followUpsList");
  const today = new Date().toISOString().slice(0, 10);

  onSnapshot(query(collection(db, "leads"), where("nextFollowUp", "<=", today)), (snapshot) => {
    const leads = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((l) => l.status !== "closed")
      .sort((a, b) => (a.nextFollowUp < b.nextFollowUp ? -1 : 1));

    if (!leads.length) {
      box.classList.add("d-none");
      return;
    }
    box.classList.remove("d-none");

    list.innerHTML = leads.map((l) => `
      <div class="d-flex justify-content-between align-items-center py-2 ${l !== leads[leads.length - 1] ? "border-bottom" : ""}">
        <div>
          <strong>${l.name || "—"}</strong>
          ${l.company ? `<span class="text-muted small"> — ${l.company}</span>` : ""}
          <div class="small text-muted" dir="ltr">${l.phone || ""}</div>
        </div>
        <span class="status-badge ${l.nextFollowUp < today ? "status-rejected" : "status-pending"}">${l.nextFollowUp < today ? "متأخرة" : "اليوم"}</span>
      </div>
    `).join("") + `<a href="leads.html" class="btn btn-sm btn-outline-secondary mt-3">شوف كل العملاء المحتملين</a>`;
  });
}

function loadMyTasks(uid) {
  const box = document.getElementById("myTasksBox");
  const list = document.getElementById("myTasksList");

  onSnapshot(query(collection(db, "tasks"), where("assignedToUid", "==", uid)), (snapshot) => {
    const tasks = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => (t.status || "pending") !== "done")
      .sort((a, b) => (a.status === "blocked" ? -1 : 1) - (b.status === "blocked" ? -1 : 1));

    if (!tasks.length) {
      box.classList.add("d-none");
      return;
    }
    box.classList.remove("d-none");

    list.innerHTML = tasks.map((t) => `
      <div class="d-flex justify-content-between align-items-center py-2 ${t !== tasks[tasks.length - 1] ? "border-bottom" : ""}">
        <div>
          <strong>${t.title}</strong>
          <span class="text-muted small"> — ${TYPE_LABELS[t.type] || "مهمة"}</span>
          ${t.status === "blocked" && t.blockerNotes ? `<div class="small" style="color:#c0392b"><i class="bi bi-exclamation-triangle"></i> معوق: ${t.blockerNotes}</div>` : ""}
        </div>
        <span class="status-badge status-${t.status === "blocked" ? "rejected" : "pending"}">${t.status === "blocked" ? "متعثرة" : "قيد التنفيذ"}</span>
      </div>
    `).join("") + `<a href="tasks.html" class="btn btn-sm btn-outline-secondary mt-3">شوف كل مهامي</a>`;
  });
}

requireAuth((user, role) => {
  document.getElementById("userInfo").innerHTML =
    `<strong>${user.email}</strong><br><span class="text-muted">الصلاحية: ${role}</span>`;

  loadCounters();
  loadFollowUps();
  loadMyTasks(user.uid);
});
