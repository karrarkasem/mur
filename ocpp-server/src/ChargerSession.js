import { getDoc, patchDoc, createDoc, commitIncrement, queryChargerByOcppId } from "./firestore.js";

// One Durable Object instance per physical charger (keyed by its OCPP
// identity, see index.js). Uses the WebSocket Hibernation API so the
// connection stays open on Cloudflare's edge while this object is evicted
// from memory between messages - it only "wakes" (and only then gets
// billed) when the charger actually sends something.
//
// Handles BootNotification/Heartbeat/StatusNotification (charger connects,
// live connector status flows into the same Firestore documents the admin
// pages already read) plus real charging sessions: Authorize/StartTransaction/
// MeterValues/StopTransaction, and RemoteStartTransaction triggered from the
// web (see the /internal/remote-start branch in fetch()).
const CONNECTOR_STATUS_MAP = {
  Available: "Available",
  Preparing: "Available",
  Charging: "Charging",
  SuspendedEV: "Charging",
  SuspendedEVSE: "Charging",
  Finishing: "Available",
  Reserved: "Available",
  Unavailable: "Unavailable",
  Faulted: "Faulted"
};

// Same pure function already duplicated across assets/js/{charge,wallet-topup,
// ev-sessions}.js - this is the 4th copy, in a different JS runtime that can't
// share a module with the browser code without a build step. Must stay in sync.
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export class ChargerSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Internal command from index.js's /remote-start/{ocppId} route (a plain
    // HTTP call from the browser, not the charger's own WebSocket) - sends a
    // live RemoteStartTransaction to whatever charger is currently connected
    // to this Durable Object, if any.
    if (url.pathname === "/internal/remote-start" && request.method === "POST") {
      return this.handleRemoteStart(await request.json());
    }

    const ocppId = url.searchParams.get("ocppId");
    await this.state.storage.put("ocppId", ocppId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [ocppId]);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "ocpp1.6" }
    });
  }

  async webSocketMessage(ws, message) {
    let call;
    try {
      call = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    const [messageTypeId, uniqueId, action, payload] = call;
    if (messageTypeId !== 2) return; // only handling CALL (charger -> us) in this slice

    const ocppId = await this.state.storage.get("ocppId");
    let response = {};
    try {
      if (action === "BootNotification") response = await this.handleBoot();
      else if (action === "Heartbeat") response = await this.handleHeartbeat();
      else if (action === "StatusNotification") response = await this.handleStatusNotification(payload);
      else if (action === "Authorize") response = await this.handleAuthorize(payload);
      else if (action === "StartTransaction") response = await this.handleStartTransaction(payload);
      else if (action === "MeterValues") response = await this.handleMeterValues(payload, ws);
      else if (action === "StopTransaction") response = await this.handleStopTransaction(payload);
    } catch (err) {
      ws.send(JSON.stringify([4, uniqueId, "InternalError", String(err.message || err), {}]));
      return;
    }

    ws.send(JSON.stringify([3, uniqueId, response]));
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* already closing */ }
  }

  async webSocketError() {
    // Hibernation API will drop and let the charger reconnect on its own.
  }

  async chargerDocId() {
    let docId = await this.state.storage.get("chargerDocId");
    if (docId) return docId;

    const ocppId = await this.state.storage.get("ocppId");
    const charger = await queryChargerByOcppId(this.env, ocppId);
    if (!charger) return null;

    await this.state.storage.put("chargerDocId", charger.id);
    return charger.id;
  }

  async handleBoot() {
    const docId = await this.chargerDocId();
    if (docId) await patchDoc(this.env, `evChargers/${docId}`, { lastHeartbeat: new Date() });

    return {
      status: docId ? "Accepted" : "Rejected",
      currentTime: new Date().toISOString(),
      // Kept under Cloudflare's 100s free-plan WebSocket idle timeout so
      // the connection never drops between heartbeats.
      interval: 60
    };
  }

  async handleHeartbeat() {
    const docId = await this.chargerDocId();
    if (docId) await patchDoc(this.env, `evChargers/${docId}`, { lastHeartbeat: new Date() });
    return { currentTime: new Date().toISOString() };
  }

  async handleStatusNotification(payload) {
    const docId = await this.chargerDocId();
    if (docId) {
      const connectorId = String(payload?.connectorId ?? 1);
      await patchDoc(this.env, `evChargers/${docId}/connectors/${connectorId}`, {
        status: CONNECTOR_STATUS_MAP[payload?.status] || "Unavailable",
        errorCode: payload?.errorCode || null
      });
    }
    return {};
  }

  // Same "get by known ID" identity pattern the web app already uses (see
  // firestore.rules) - checks the RFID tag first, then falls back to a
  // resident login code, since a web-initiated remote-start supplies
  // whichever one the customer identified with on charge.html.
  async resolveCustomerByIdTag(idTag) {
    if (!idTag) return null;
    const tokenDoc = await getDoc(this.env, `evRfidTokens/${idTag}`);
    let customerId = tokenDoc && tokenDoc.active !== false ? tokenDoc.customerId : null;
    if (!customerId) {
      const codeDoc = await getDoc(this.env, `evLoginCodes/${idTag}`);
      if (codeDoc && codeDoc.active !== false) customerId = codeDoc.customerId;
    }
    if (!customerId) return null;
    const customer = await getDoc(this.env, `evCustomers/${customerId}`);
    return customer ? { customerId, customer } : null;
  }

  async handleAuthorize(payload) {
    const resolved = await this.resolveCustomerByIdTag(payload?.idTag);
    if (!resolved) return { idTagInfo: { status: "Invalid" } };
    if (Number(resolved.customer.walletBalance || 0) <= 0) return { idTagInfo: { status: "Blocked" } };
    return { idTagInfo: { status: "Accepted" } };
  }

  async handleStartTransaction(payload) {
    const resolved = await this.resolveCustomerByIdTag(payload?.idTag);
    const docId = await this.chargerDocId();

    if (!resolved || !docId || Number(resolved.customer.walletBalance || 0) <= 0) {
      return { transactionId: 0, idTagInfo: { status: !resolved ? "Invalid" : "Blocked" } };
    }

    const connectorId = String(payload?.connectorId ?? 1);
    const tariffDoc = await getDoc(this.env, "evTariffs/default");
    const pricePerKwh = Number(tariffDoc?.pricePerKwh || 0);
    const meterStart = Number(payload?.meterStart || 0);
    const transactionId = Math.floor(Date.now() / 1000);
    const chargerDoc = await getDoc(this.env, `evChargers/${docId}`);

    const session = await createDoc(this.env, "evChargingSessions", {
      customerId: resolved.customerId,
      customerName: resolved.customer.name || "",
      customerPhone: resolved.customer.phone || "",
      chargerId: docId,
      chargerName: chargerDoc?.name || chargerDoc?.ocppId || "",
      connectorId,
      startTime: new Date(),
      meterStart,
      transactionId,
      pricePerKwh,
      energyConsumedKwh: 0,
      finalCost: 0,
      paymentStatus: "wallet",
      status: "active",
      source: "ocpp"
    });

    await this.state.storage.put(`activeTx:${transactionId}`, {
      sessionDocId: session.id,
      connectorId,
      meterStart,
      pricePerKwh,
      customerId: resolved.customerId,
      stopRequested: false
    });

    return { transactionId, idTagInfo: { status: "Accepted" } };
  }

  extractLatestEnergyWh(payload) {
    const values = payload?.meterValue || [];
    for (let i = values.length - 1; i >= 0; i--) {
      const sampled = values[i]?.sampledValue || [];
      const energy = sampled.find((s) => !s.measurand || s.measurand === "Energy.Active.Import.Register");
      if (energy) return Number(energy.value);
    }
    return null;
  }

  // Checked on every MeterValues sample (the only cadence we have): if the
  // running cost has consumed the customer's live wallet balance, send a
  // RemoteStopTransaction so the session can't run far negative unattended.
  // Some overage between samples is expected (real-world postpaid tail),
  // not a bug - see README/plan notes.
  async handleMeterValues(payload, ws) {
    const transactionId = payload?.transactionId;
    if (transactionId == null) return {};
    const tx = await this.state.storage.get(`activeTx:${transactionId}`);
    if (!tx) return {};

    const latestReading = this.extractLatestEnergyWh(payload);
    if (latestReading == null) return {};

    const energyConsumedKwh = Math.max(0, (latestReading - tx.meterStart) / 1000);
    const runningCost = energyConsumedKwh * tx.pricePerKwh;
    await patchDoc(this.env, `evChargingSessions/${tx.sessionDocId}`, { energyConsumedKwh, finalCost: runningCost });

    if (!tx.stopRequested) {
      const customer = await getDoc(this.env, `evCustomers/${tx.customerId}`);
      const balance = Number(customer?.walletBalance || 0);
      if (runningCost >= balance) {
        await this.sendCall(ws, "RemoteStopTransaction", { transactionId });
        await this.state.storage.put(`activeTx:${transactionId}`, { ...tx, stopRequested: true });
      }
    }
    return {};
  }

  async handleStopTransaction(payload) {
    const transactionId = payload?.transactionId;
    const tx = transactionId != null ? await this.state.storage.get(`activeTx:${transactionId}`) : null;
    if (!tx) return { idTagInfo: { status: "Accepted" } };

    const meterStop = Number(payload?.meterStop || 0);
    const energyConsumedKwh = Math.max(0, (meterStop - tx.meterStart) / 1000);
    const finalCost = energyConsumedKwh * tx.pricePerKwh;
    const weekKey = isoWeekKey(new Date());

    await patchDoc(this.env, `evChargingSessions/${tx.sessionDocId}`, {
      status: "completed",
      stopTime: new Date(),
      meterStop,
      energyConsumedKwh,
      finalCost,
      stopReason: payload?.reason || "Remote"
    });

    // Atomic increments - same guarantee FieldValue.increment() gives the
    // wallet-payment path in assets/js/ev-sessions.js, reimplemented here
    // since this runs from the Worker, not the browser SDK.
    await commitIncrement(this.env, `evCustomers/${tx.customerId}`, {
      walletBalance: -finalCost,
      totalConsumptionKwh: energyConsumedKwh,
      totalSpent: finalCost,
      [`weeklyStats.${weekKey}.kwh`]: energyConsumedKwh,
      [`weeklyStats.${weekKey}.spent`]: finalCost
    });

    const docId = await this.chargerDocId();
    if (docId) await commitIncrement(this.env, `evChargers/${docId}`, { totalKwh: energyConsumedKwh });

    await createDoc(this.env, "evWalletTransactions", {
      customerId: tx.customerId,
      type: "charge",
      amount: finalCost,
      relatedSessionId: tx.sessionDocId,
      by: "ocpp-server",
      at: new Date()
    });

    await this.state.storage.delete(`activeTx:${transactionId}`);
    return { idTagInfo: { status: "Accepted" } };
  }

  // Triggered by index.js's /remote-start/{ocppId} route (a plain HTTP call
  // from charge.html, not the charger). Re-validates the idTag server-side
  // before forwarding anything to the charger - same bar the web app already
  // requires to reach this point, since this endpoint has no other auth.
  async handleRemoteStart(body) {
    const { connectorId, idTag } = body || {};
    const resolved = await this.resolveCustomerByIdTag(idTag);
    if (!resolved) {
      return new Response(JSON.stringify({ error: "بطاقة أو كود غير صالح" }), { status: 403 });
    }
    if (Number(resolved.customer.walletBalance || 0) <= 0) {
      return new Response(JSON.stringify({ error: "الرصيد غير كافٍ" }), { status: 403 });
    }

    // Hibernatable WebSockets API: retrieves the live socket even if this
    // Durable Object was evicted from memory between messages.
    const sockets = this.state.getWebSockets();
    if (!sockets.length) {
      return new Response(JSON.stringify({ error: "المحطة غير متصلة بالسيرفر حاليًا" }), { status: 503 });
    }

    await this.sendCall(sockets[0], "RemoteStartTransaction", { connectorId: Number(connectorId) || 1, idTag });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // Fire-and-forget: we don't block on the charger's CALLRESULT for this -
  // the charger's own subsequent StartTransaction/StopTransaction CALL is
  // the actual source of truth, and webSocketMessage() already ignores
  // inbound messageTypeId !== 2 (i.e. responses to our own outbound calls).
  async sendCall(ws, action, payload) {
    ws.send(JSON.stringify([2, crypto.randomUUID(), action, payload]));
  }
}
