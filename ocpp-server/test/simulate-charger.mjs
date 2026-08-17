// Minimal OCPP 1.6J charge-point simulator for testing the CSMS without
// real hardware. Two modes, both exercising the same real message flow a
// physical charger would:
//   - No idTag arg: connects and boots, then waits - if charge.html sends
//     a RemoteStartTransaction, runs a full simulated charging session
//     (StartTransaction -> MeterValues -> StopTransaction).
//   - With an idTag arg: simulates a physical card tap right after boot
//     (Authorize -> StartTransaction -> MeterValues -> StopTransaction),
//     without waiting on the web app.
// Either way, it also honors a RemoteStopTransaction from the server
// (the low-balance auto-stop) and prints every message exchanged.
//
// Usage: node test/simulate-charger.mjs <wss://worker-url> <ocppId> [idTag]

const [, , workerUrl, ocppId, idTag] = process.argv;
if (!workerUrl || !ocppId) {
  console.error("Usage: node test/simulate-charger.mjs <wss://worker-url> <ocppId> [idTag]");
  process.exit(1);
}

const url = `${workerUrl.replace(/\/$/, "")}/ocpp/${encodeURIComponent(ocppId)}`;
console.log(`Connecting to ${url} ...`);

const ws = new WebSocket(url, "ocpp1.6");
let msgId = 1;
let meterWh = 0;
let activeTransactionId = null;
let meterInterval = null;
let pendingAuthorizeTag = null;
let pendingConnectorId = 1;

function call(action, payload) {
  const id = String(msgId++);
  console.log(`\n→ ${action}`, payload);
  ws.send(JSON.stringify([2, id, action, payload]));
  return id;
}

function respond(id, payload) {
  console.log(`\n→ [CALLRESULT for ${id}]`, payload);
  ws.send(JSON.stringify([3, id, payload]));
}

function startSimulatedSession(tag, connectorId) {
  pendingAuthorizeTag = tag;
  pendingConnectorId = connectorId || 1;
  call("Authorize", { idTag: tag });
}

function beginMeterLoop() {
  meterWh = 0;
  meterInterval = setInterval(() => {
    meterWh += 500; // ~0.5 kWh per tick, so the low-balance auto-stop is easy to trigger with a small test wallet
    call("MeterValues", {
      connectorId: pendingConnectorId,
      transactionId: activeTransactionId,
      meterValue: [{
        timestamp: new Date().toISOString(),
        sampledValue: [{ value: String(meterWh), unit: "Wh", measurand: "Energy.Active.Import.Register" }]
      }]
    });
  }, 3000);
}

function stopSimulatedSession(reason) {
  if (meterInterval) clearInterval(meterInterval);
  meterInterval = null;
  if (activeTransactionId == null) return;
  call("StopTransaction", { transactionId: activeTransactionId, meterStop: meterWh, timestamp: new Date().toISOString(), reason });
  call("StatusNotification", { connectorId: pendingConnectorId, status: "Available", errorCode: "NoError" });
  activeTransactionId = null;
}

ws.addEventListener("open", () => {
  console.log("Connected. Negotiated subprotocol:", ws.protocol);
  call("BootNotification", { chargePointVendor: "SUNTREE", chargePointModel: "SWG5" });
});

ws.addEventListener("message", (event) => {
  const [type, id, ...rest] = JSON.parse(event.data);

  if (type === 2) {
    // Inbound CALL from the server: RemoteStartTransaction (web button) or
    // RemoteStopTransaction (low-balance auto-stop).
    const [action, payload] = rest;
    console.log(`\n← ${action}`, payload);
    if (action === "RemoteStartTransaction") {
      respond(id, { status: "Accepted" });
      startSimulatedSession(payload?.idTag, payload?.connectorId);
    } else if (action === "RemoteStopTransaction") {
      respond(id, { status: "Accepted" });
      stopSimulatedSession("Remote");
    } else {
      respond(id, {});
    }
    return;
  }

  const [payload] = rest;
  console.log(`← [messageType ${type}]`, payload);

  if (payload?.status === "Accepted" && payload?.currentTime && !pendingAuthorizeTag) {
    // BootNotification.conf
    setTimeout(() => call("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" }), 500);
    setTimeout(() => call("Heartbeat", {}), 1500);
    setTimeout(() => {
      console.log("\nBoot sequence done - check ev-chargers.html now.");
      if (idTag) {
        console.log(`\nSimulating a physical card tap with idTag "${idTag}" ...`);
        startSimulatedSession(idTag, 1);
      } else {
        console.log("Waiting for a RemoteStartTransaction from the web app... Ctrl+C to exit.");
      }
    }, 2500);
  } else if (payload?.status === "Rejected") {
    console.log("\nBoot was Rejected - no evChargers doc with this ocppId was found in Firestore.");
  } else if (payload?.idTagInfo && pendingAuthorizeTag) {
    // Authorize.conf
    const tag = pendingAuthorizeTag;
    pendingAuthorizeTag = null;
    if (payload.idTagInfo.status === "Accepted") {
      call("StatusNotification", { connectorId: pendingConnectorId, status: "Charging", errorCode: "NoError" });
      call("StartTransaction", { connectorId: pendingConnectorId, idTag: tag, meterStart: 0, timestamp: new Date().toISOString() });
    } else {
      console.log(`Authorize was rejected: ${payload.idTagInfo.status}`);
    }
  } else if (typeof payload?.transactionId === "number") {
    // StartTransaction.conf
    if (payload.transactionId === 0) {
      console.log("StartTransaction rejected:", payload.idTagInfo?.status);
    } else {
      activeTransactionId = payload.transactionId;
      console.log(`Transaction ${activeTransactionId} started - sending MeterValues every 3s. Ctrl+C to stop early.`);
      beginMeterLoop();
    }
  }
});

ws.addEventListener("close", (e) => console.log("Closed:", e.code, e.reason));
ws.addEventListener("error", (e) => console.error("Error:", e.message || e));
