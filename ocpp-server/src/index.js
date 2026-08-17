import { ChargerSession } from "./ChargerSession.js";

export { ChargerSession };

// A physical charger connects to wss://<worker-url>/ocpp/<ocppId>, where
// <ocppId> matches the `ocppId` field already stored on the evChargers doc
// (e.g. "SWG5-001"). Each ocppId gets its own Durable Object instance.

// /remote-start/<ocppId> is called from charge.js when a customer clicks
// "ابدأ الشحن" - a plain browser fetch() from the site's own origin, so
// (unlike the WebSocket route) it needs CORS headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const remoteStartMatch = url.pathname.match(/^\/remote-start\/([^/]+)$/);
    if (remoteStartMatch) {
      if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

      const ocppId = decodeURIComponent(remoteStartMatch[1]);
      const id = env.CHARGER_SESSION.idFromName(ocppId);
      const stub = env.CHARGER_SESSION.get(id);

      const internalUrl = new URL(request.url);
      internalUrl.pathname = "/internal/remote-start";
      const doResponse = await stub.fetch(internalUrl.toString(), {
        method: "POST",
        body: await request.text(),
        headers: { "Content-Type": "application/json" }
      });

      return new Response(await doResponse.text(), {
        status: doResponse.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const match = url.pathname.match(/^\/ocpp\/([^/]+)$/);

    if (!match) {
      return new Response("MUR OCPP server is running.", { status: 200 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade request", { status: 426 });
    }

    const offeredProtocols = (request.headers.get("Sec-WebSocket-Protocol") || "")
      .split(",").map((p) => p.trim());
    if (!offeredProtocols.includes("ocpp1.6")) {
      return new Response("Expected Sec-WebSocket-Protocol: ocpp1.6", { status: 400 });
    }

    const ocppId = decodeURIComponent(match[1]);
    const id = env.CHARGER_SESSION.idFromName(ocppId);
    const stub = env.CHARGER_SESSION.get(id);

    const forwardUrl = new URL(request.url);
    forwardUrl.searchParams.set("ocppId", ocppId);
    return stub.fetch(forwardUrl, request);
  }
};
