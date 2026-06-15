/**
 * Server-side Eclipse Ditto REST helper.
 *
 * NEVER import this from client-side code (pages, components, hooks). Only API
 * route handlers (app/api/**) should use it. The browser talks to Ditto only
 * through the authenticated /api/ditto proxy and the /api/commands safety gate.
 *
 * Env (shared with app/api/commands/route.js so the whole server stack uses one
 * Ditto identity):
 *   DITTO_URL | DITTO_BASE_URL | NEXT_PUBLIC_DITTO_URL  (default http://127.0.0.1:8080)
 *   DITTO_USER | DITTO_USERNAME                          (default "ditto")
 *   DITTO_PASSWORD                                       (default "ditto")
 *   DITTO_TIMEOUT_MS                                     (default 8000)
 *   PRIMARY_THING_ID                                     (default building:floor1:elevator)
 */

export const DITTO_URL = (
  process.env.DITTO_URL ||
  process.env.DITTO_BASE_URL ||
  process.env.NEXT_PUBLIC_DITTO_URL ||
  "http://127.0.0.1:8080"
).replace(/\/+$/, "");

const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || "ditto";
const DITTO_AUTH = "Basic " + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64");
const DITTO_TIMEOUT_MS = Number.parseInt(process.env.DITTO_TIMEOUT_MS || "8000", 10);

export const PRIMARY_THING_ID = process.env.PRIMARY_THING_ID || "building:floor1:elevator";

function encodePath(path) {
  return String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function dittoFetch(method, path, body) {
  const url = `${DITTO_URL}/api/2/things/${encodePath(path)}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: DITTO_AUTH,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(DITTO_TIMEOUT_MS),
  });

  const text = await response.text().catch(() => "");
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data, raw: text };
}

/** Read a feature (or any sub-path) of a Thing. Returns { ok, status, data }. */
export function getThingPath(thingId, subPath = "") {
  const full = subPath ? `${encodeURIComponent(thingId)}/${subPath}` : encodeURIComponent(thingId);
  // subPath is already-structured (e.g. "features/accessControl/properties").
  return dittoFetch("GET", full);
}

/** PUT a value at a feature property path. Creates the feature if missing. */
export async function putFeatureProperty(thingId, featureId, propertyPath, value) {
  const path = `${encodeURIComponent(thingId)}/features/${encodeURIComponent(featureId)}/properties/${propertyPath}`;
  let result = await dittoFetch("PUT", path, value);

  // Ditto returns 404 things:feature.notfound when the feature itself does not
  // exist yet. Create the feature shell, then retry the property write.
  if (!result.ok && result.status === 404 && /feature\.notfound/.test(result.raw || "")) {
    await dittoFetch(
      "PUT",
      `${encodeURIComponent(thingId)}/features/${encodeURIComponent(featureId)}`,
      { properties: {} },
    );
    result = await dittoFetch("PUT", path, value);
  }
  return result;
}

/** DELETE a value at a feature property path. 404 is treated as success. */
export async function deleteFeatureProperty(thingId, featureId, propertyPath) {
  const path = `${encodeURIComponent(thingId)}/features/${encodeURIComponent(featureId)}/properties/${propertyPath}`;
  const result = await dittoFetch("DELETE", path);
  if (!result.ok && result.status === 404) return { ok: true, status: 204, data: null, raw: "" };
  return result;
}

/** Read accessControl.properties for a Thing. Returns {} when absent. */
export async function getAccessControlProperties(thingId) {
  const result = await getThingPath(
    thingId,
    `features/accessControl/properties`,
  );
  if (result.ok && result.data && typeof result.data === "object") return result.data;
  return {};
}
