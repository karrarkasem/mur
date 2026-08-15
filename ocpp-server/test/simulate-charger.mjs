// Minimal OCPP 1.6J charge-point simulator for testing the CSMS without
// real hardware. Sends BootNotification -> StatusNotification -> Heartbeat
// and prints every message exchanged.
//
// Usage: node test/simulate-charger.mjs <wss://worker-url> <ocppId>

const [, , workerUrl, ocppId] = process.argv;
if (!workerUrl || !ocppId) {
  console.error("Usage: node test/simulate-charger.mjs <wss://worker-url> <ocppId>");
  process.exit(1);
}

const url = `${workerUrl.replace(/\/$/, "")}/ocpp/${encodeURIComponent(ocppId)}`;
console.log(`Connecting to ${url} ...`);

const ws = new WebSocket(url, "ocpp1.6");
let msgId = 1;

function call(action, payload) {
  const id = String(msgId++);
  console.log(`\n→ ${action}`, payload);
  ws.send(JSON.stringify([2, id, action, payload]));
}

ws.addEventListener("open", () => {
  console.log("Connected. Negotiated subprotocol:", ws.protocol);
  call("BootNotification", { chargePointVendor: "SUNTREE", chargePointModel: "SWG5" });
});

ws.addEventListener("message", (event) => {
  const [type, , ...rest] = JSON.parse(event.data);
  console.log(`← [messageType ${type}]`, rest);

  if (rest[0]?.status === "Accepted") {
    setTimeout(() => call("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" }), 500);
    setTimeout(() => call("Heartbeat", {}), 1500);
    setTimeout(() => {
      console.log("\nTest sequence done - check ev-chargers.html now. Ctrl+C to exit.");
    }, 2500);
  } else if (rest[0]?.status === "Rejected") {
    console.log("\nBoot was Rejected - no evChargers doc with this ocppId was found in Firestore.");
  }
});

ws.addEventListener("close", (e) => console.log("Closed:", e.code, e.reason));
ws.addEventListener("error", (e) => console.error("Error:", e.message || e));
