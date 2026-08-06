import { auth, db } from "../../services/firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getCountFromServer, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const counters = {
  companies: document.getElementById("companiesCount"),
  leads: document.getElementById("leadsCount"),
  tasks: document.getElementById("tasksCount"),
  quotations: document.getElementById("quotesCount")
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userSnapshot = await getDoc(doc(db, "users", user.uid));
  const role = userSnapshot.exists() ? userSnapshot.data().role : "viewer";

  document.getElementById("userInfo").innerHTML =
    `<strong>${user.email}</strong><br><span class="text-muted">الصلاحية: ${role}</span>`;

  loadCounters();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
