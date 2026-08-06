import { db } from "../../services/firebase.js";
import { requireAuth } from "../../services/auth-guard.js";
import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const counters = {
  companies: document.getElementById("companiesCount"),
  leads: document.getElementById("leadsCount"),
  tasks: document.getElementById("tasksCount"),
  quotes: document.getElementById("quotesCount")
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

requireAuth((user, role) => {
  document.getElementById("userInfo").innerHTML =
    `<strong>${user.email}</strong><br><span class="text-muted">الصلاحية: ${role}</span>`;

  loadCounters();
});
