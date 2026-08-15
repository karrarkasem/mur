import { patchDoc, queryChargerByOcppId } from "./firestore.js";

// One Durable Object instance per physical charger (keyed by its OCPP
// identity, see index.js). Uses the WebSocket Hibernation API so the
// connection stays open on Cloudflare's edge while this object is evicted
// from memory between messages - it only "wakes" (and only then gets
// billed) when the charger actually sends something.
//
// This first slice only speaks the 3 messages needed to get the charger
// connected and its live status flowing into the same Firestore documents
// the admin pages already read (evChargers / evChargers/{id}/connectors/{n}).
// Authorize/StartTransaction/MeterValues/StopTransaction are a follow-up.
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

export class ChargerSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
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
}
