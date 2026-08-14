import { db } from "../../services/firebase.js";
import { requireAuth, canManage } from "../../services/auth-guard.js";
import {
  collection, collectionGroup, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // heartbeat within 5 min counts as online

const deniedBox = document.getElementById("deniedBox");
const content = document.getElementById("content");

const totalChargersEl = document.getElementById("totalChargers");
const onlineChargersEl = document.getElementById("onlineChargers");
const activeSessionsEl = document.getElementById("activeSessions");
const todayEnergyEl = document.getElementById("todayEnergy");
const countAvailableEl = document.getElementById("countAvailable");
const countChargingEl = document.getElementById("countCharging");
const countFaultedEl = document.getElementById("countFaulted");

let energyChart = null;
let revenueChart = null;

function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function dayLabel(date) {
  return date.toLocaleDateString("ar-IQ", { month: "short", day: "numeric" });
}

function renderChargers(chargers) {
  totalChargersEl.textContent = chargers.length;
  const now = Date.now();
  const online = chargers.filter((c) => {
    const hb = c.lastHeartbeat?.toDate ? c.lastHeartbeat.toDate().getTime() : 0;
    return now - hb <= ONLINE_THRESHOLD_MS;
  });
  onlineChargersEl.textContent = online.length;
}

function renderConnectors(connectors) {
  const counts = { Available: 0, Charging: 0, Faulted: 0 };
  connectors.forEach((c) => {
    if (counts[c.status] !== undefined) counts[c.status]++;
  });
  countAvailableEl.textContent = counts.Available;
  countChargingEl.textContent = counts.Charging;
  countFaultedEl.textContent = counts.Faulted;
}

function renderSessions(sessions) {
  activeSessionsEl.textContent = sessions.filter((s) => s.status === "active").length;

  const days = last7Days();
  const energyByDay = Object.fromEntries(days.map((d) => [dayKey(d), 0]));
  const revenueByDay = Object.fromEntries(days.map((d) => [dayKey(d), 0]));
  const todayKey = dayKey(days[days.length - 1]);
  let hasAnyData = false;

  sessions.forEach((s) => {
    const start = s.startTime?.toDate ? s.startTime.toDate() : null;
    if (!start) return;
    const key = dayKey(start);
    if (!(key in energyByDay)) return;
    hasAnyData = true;
    energyByDay[key] += Number(s.energyConsumedKwh || 0);
    revenueByDay[key] += Number(s.finalCost || 0);
  });

  todayEnergyEl.textContent = (energyByDay[todayKey] || 0).toFixed(1);

  const labels = days.map(dayLabel);
  const energyValues = days.map((d) => Number(energyByDay[dayKey(d)].toFixed(2)));
  const revenueValues = days.map((d) => Number(revenueByDay[dayKey(d)].toFixed(0)));

  toggleChart("energy", hasAnyData, () => buildEnergyChart(labels, energyValues));
  toggleChart("revenue", hasAnyData, () => buildRevenueChart(labels, revenueValues));
}

function toggleChart(name, hasData, buildFn) {
  const emptyEl = document.getElementById(`${name}Empty`);
  const canvasEl = document.getElementById(`${name}Chart`);
  emptyEl.classList.toggle("d-none", hasData);
  canvasEl.classList.toggle("d-none", !hasData);
  if (hasData) buildFn();
}

function buildEnergyChart(labels, values) {
  if (energyChart) { energyChart.data.labels = labels; energyChart.data.datasets[0].data = values; energyChart.update(); return; }
  energyChart = new Chart(document.getElementById("energyChart"), {
    type: "bar",
    data: { labels, datasets: [{ label: "kWh", data: values, backgroundColor: "#14895f" }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function buildRevenueChart(labels, values) {
  if (revenueChart) { revenueChart.data.labels = labels; revenueChart.data.datasets[0].data = values; revenueChart.update(); return; }
  revenueChart = new Chart(document.getElementById("revenueChart"), {
    type: "line",
    data: { labels, datasets: [{ label: "IQD", data: values, borderColor: "#d9b47f", backgroundColor: "rgba(217,180,127,.2)", tension: .3, fill: true }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

requireAuth((user, role) => {
  if (!canManage(role)) {
    deniedBox.classList.remove("d-none");
    return;
  }
  content.classList.remove("d-none");

  onSnapshot(collection(db, "evChargers"), (snap) => {
    renderChargers(snap.docs.map((d) => d.data()));
  }, (err) => { console.error("evChargers:", err.message); });

  onSnapshot(collectionGroup(db, "connectors"), (snap) => {
    renderConnectors(snap.docs.map((d) => d.data()));
  }, (err) => { console.error("evChargers connectors:", err.message); });

  onSnapshot(collection(db, "evChargingSessions"), (snap) => {
    renderSessions(snap.docs.map((d) => d.data()));
  }, (err) => { console.error("evChargingSessions:", err.message); });
});
