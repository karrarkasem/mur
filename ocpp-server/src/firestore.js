// Minimal Firestore REST client for the Workers runtime (Firebase Admin SDK
// doesn't work here - no Node APIs). Auth is a service-account JWT, signed
// with WebCrypto via `jose`, exchanged for a Google OAuth access token.
import { SignJWT, importPKCS8 } from "jose";

let cachedToken = null;
let cachedExpiry = 0;

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedExpiry - 60) return cachedToken;

  const privateKeyPem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(privateKeyPem, "RS256");

  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now)
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google auth failed: " + JSON.stringify(data));

  cachedToken = data.access_token;
  cachedExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

function baseUrl(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}

function fromFirestoreValue(fv) {
  if (!fv) return null;
  const [key, val] = Object.entries(fv)[0] || [];
  switch (key) {
    case "integerValue": return parseInt(val, 10);
    case "doubleValue": return val;
    case "mapValue": return fromFirestoreFields(val.fields || {});
    case "nullValue": return null;
    default: return val;
  }
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

export async function getDoc(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${baseUrl(env)}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get ${path} failed: ${res.status} ${await res.text()}`);
  const doc = await res.json();
  return fromFirestoreFields(doc.fields);
}

export async function patchDoc(env, path, fields) {
  const token = await getAccessToken(env);
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);

  const res = await fetch(`${baseUrl(env)}/${path}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Firestore patch ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function createDoc(env, collectionPath, fields) {
  const token = await getAccessToken(env);
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);

  const res = await fetch(`${baseUrl(env)}/${collectionPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Firestore create ${collectionPath} failed: ${res.status} ${await res.text()}`);
  const doc = await res.json();
  return { id: doc.name.split("/").pop(), ...fromFirestoreFields(doc.fields) };
}

// Firestore's raw REST field-path syntax requires any path segment that
// isn't a plain identifier ([a-zA-Z_][a-zA-Z_0-9]*) to be backtick-quoted -
// e.g. an ISO week key like "2026-W34" has a hyphen, so it must become
// `weeklyStats.`2026-W34`.kwh`. The client SDK's dotted-path update() does
// this automatically; the REST API does not.
function quoteFieldPath(dottedPath) {
  return dottedPath
    .split(".")
    .map((segment) => (/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(segment) ? segment : "`" + segment.replace(/`/g, "\\`") + "`"))
    .join(".");
}

// Atomic field-transform increments (same guarantee as the client SDK's
// increment() used in assets/js/ev-sessions.js) - avoids read-modify-write
// races on money fields. Supports dotted paths (e.g. "weeklyStats.2026-W34.kwh")
// which Firestore creates as nested maps automatically, same as the client SDK.
export async function commitIncrement(env, docPath, incrementFields) {
  const token = await getAccessToken(env);
  const resourceName = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const fieldTransforms = Object.entries(incrementFields).map(([fieldPath, amount]) => ({
    fieldPath: quoteFieldPath(fieldPath),
    increment: { doubleValue: amount }
  }));

  const res = await fetch(`${baseUrl(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [{ transform: { document: resourceName, fieldTransforms } }] })
  });
  if (!res.ok) throw new Error(`Firestore commitIncrement ${docPath} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function queryChargerByOcppId(env, ocppId) {
  const token = await getAccessToken(env);
  const res = await fetch(`${baseUrl(env)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "evChargers" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "ocppId" },
            op: "EQUAL",
            value: { stringValue: ocppId }
          }
        },
        limit: 1
      }
    })
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  const match = rows.find((r) => r.document)?.document;
  if (!match) return null;
  return { id: match.name.split("/").pop(), ...fromFirestoreFields(match.fields) };
}
