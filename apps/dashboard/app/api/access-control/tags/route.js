/**
 * /api/access-control/tags — RFID authorized-tag registry CRUD.
 *
 * Source of truth: the Eclipse Ditto feature `accessControl`, under
 *   features/accessControl/properties/authorizedTags/<UID>
 * Each write also refreshes tag_count + updated_at so the dashboard can show
 * registry freshness without recomputing.
 *
 * The browser never writes Ditto directly — it calls this server route, which
 * holds the Ditto identity and performs the structured, validated write.
 *
 *   GET    -> list all tags
 *   POST   -> create a tag                        { uid, label, role, floors, note, enabled }
 *   PUT    -> update / assign role / enable-disable { uid, ...patch }
 *   DELETE -> remove a tag                         ?uid=... or { uid }
 */

import { NextResponse } from "next/server";
import {
  PRIMARY_THING_ID,
  getAccessControlProperties,
  putFeatureProperty,
  deleteFeatureProperty,
} from "../../../../src/server/ditto.js";
import { normalizeTag, normalizeTagMap, normalizeUid } from "../../../../src/lib/accessControl.js";

export const dynamic = "force-dynamic";

function thingIdFrom(request, body) {
  const url = new URL(request.url);
  return body?.thing_id || url.searchParams.get("thing_id") || PRIMARY_THING_ID;
}

function tagsToArray(map) {
  return Object.values(map).sort((a, b) => a.label.localeCompare(b.label));
}

async function readTags(thingId) {
  const props = await getAccessControlProperties(thingId);
  return normalizeTagMap(props.authorizedTags);
}

async function writeTagCount(thingId, count) {
  await putFeatureProperty(thingId, "accessControl", "tag_count", count);
  await putFeatureProperty(thingId, "accessControl", "updated_at", new Date().toISOString());
}

export async function GET(request) {
  const thingId = thingIdFrom(request);
  try {
    const map = await readTags(thingId);
    return NextResponse.json({ ok: true, tags: tagsToArray(map), total: Object.keys(map).length, error: null });
  } catch (error) {
    console.error("[api/access-control/tags GET]", error.message);
    return NextResponse.json({ ok: false, tags: [], total: 0, error: error.message }, { status: 502 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const thingId = thingIdFrom(request, body);

  let tag;
  try {
    tag = normalizeTag(body);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  try {
    const existing = await readTags(thingId);
    if (existing[tag.uid]) {
      return NextResponse.json({ ok: false, error: `Tag ${tag.uid} already exists` }, { status: 409 });
    }
    const result = await putFeatureProperty(thingId, "accessControl", `authorizedTags/${tag.uid}`, tag);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: `Ditto write failed (${result.status})` }, { status: 502 });
    }
    await writeTagCount(thingId, Object.keys(existing).length + 1);
    return NextResponse.json({ ok: true, tag, error: null }, { status: 201 });
  } catch (error) {
    console.error("[api/access-control/tags POST]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
}

export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const thingId = thingIdFrom(request, body);
  const uid = normalizeUid(body.uid);

  try {
    const existing = await readTags(thingId);
    if (!existing[uid]) {
      return NextResponse.json({ ok: false, error: `Tag ${uid || body.uid} not found` }, { status: 404 });
    }
    let tag;
    try {
      tag = normalizeTag(body, existing[uid]);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    const result = await putFeatureProperty(thingId, "accessControl", `authorizedTags/${uid}`, tag);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: `Ditto write failed (${result.status})` }, { status: 502 });
    }
    await putFeatureProperty(thingId, "accessControl", "updated_at", new Date().toISOString());
    return NextResponse.json({ ok: true, tag, error: null });
  } catch (error) {
    console.error("[api/access-control/tags PUT]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
}

export async function DELETE(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* DELETE may carry no body; uid can come from the query string */
  }
  const thingId = thingIdFrom(request, body);
  const url = new URL(request.url);
  const uid = normalizeUid(body.uid || url.searchParams.get("uid"));

  if (!uid) {
    return NextResponse.json({ ok: false, error: "Missing uid" }, { status: 400 });
  }

  try {
    const existing = await readTags(thingId);
    if (!existing[uid]) {
      return NextResponse.json({ ok: true, deleted: uid, note: "already absent", error: null });
    }
    const result = await deleteFeatureProperty(thingId, "accessControl", `authorizedTags/${uid}`);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: `Ditto delete failed (${result.status})` }, { status: 502 });
    }
    await writeTagCount(thingId, Math.max(0, Object.keys(existing).length - 1));
    return NextResponse.json({ ok: true, deleted: uid, error: null });
  } catch (error) {
    console.error("[api/access-control/tags DELETE]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
}
