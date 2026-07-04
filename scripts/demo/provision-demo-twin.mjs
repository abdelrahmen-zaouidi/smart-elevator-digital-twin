#!/usr/bin/env node
/*
 * Demo-mode Ditto provisioner (one-shot init container, see docker-compose.yml
 * `demo-init` service). Dependency-free: Node >= 18 global fetch only, so it
 * runs on a bare node:20-alpine image with the scripts/demo dir mounted.
 *
 * Behaviour (deliberately safer than scripts/init-ditto.sh for reruns):
 *   - Ditto unreachable  -> waits up to ~90 s, then fails with ONE actionable line.
 *   - Thing exists       -> exits 0 WITHOUT touching live twin state.
 *   - Thing missing (404)-> creates policy + Thing from demo-twin-seed.json.
 *
 * init-ditto.sh remains the full manual provisioning tool; this script exists
 * so `docker compose --profile demo up` needs no manual Ditto step.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DITTO_URL = (process.env.DITTO_URL || "http://docker-nginx-1").replace(/\/$/, "");
const DITTO_USER = process.env.DITTO_USER || process.env.DITTO_USERNAME || "ditto";
const DITTO_PASSWORD = process.env.DITTO_PASSWORD || "ditto";
const THING_ID = process.env.THING_ID || "building:floor1:elevator";

const WAIT_ATTEMPTS = 30;
const WAIT_DELAY_MS = 3000;

const AUTH = "Basic " + Buffer.from(`${DITTO_USER}:${DITTO_PASSWORD}`).toString("base64");
const JSON_HEADERS = { Authorization: AUTH, "Content-Type": "application/json" };

const thingUrl = `${DITTO_URL}/api/2/things/${encodeURIComponent(THING_ID)}`;
const policyUrl = `${DITTO_URL}/api/2/policies/${encodeURIComponent(THING_ID)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getThingWithRetry() {
  let lastError = null;
  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(thingUrl, { headers: { Authorization: AUTH } });
    } catch (error) {
      lastError = error;
      console.log(`waiting for Ditto at ${DITTO_URL} ... (${attempt}/${WAIT_ATTEMPTS})`);
      await sleep(WAIT_DELAY_MS);
    }
  }
  console.error(
    `ERROR: Ditto is not reachable at ${DITTO_URL} (${lastError?.cause?.code || lastError?.message}) - start the Ditto stack first (its own docker compose, e.g. C:\\Users\\Administrator\\ditto\\deployment\\docker> docker compose up -d), then re-run: docker compose --profile demo up -d`,
  );
  process.exit(1);
}

async function main() {
  console.log(`Demo twin provisioning: ${THING_ID} @ ${DITTO_URL} (user: ${DITTO_USER})`);

  const res = await getThingWithRetry();

  if (res.status === 200) {
    console.log("Thing already exists - leaving live twin state untouched. Done.");
    return;
  }
  if (res.status === 401 || res.status === 403) {
    console.error(
      `ERROR: Ditto rejected credentials (HTTP ${res.status}) - check DITTO_USERNAME/DITTO_PASSWORD in .env (defaults: ditto/ditto).`,
    );
    process.exit(1);
  }
  if (res.status !== 404) {
    console.error(`ERROR: unexpected HTTP ${res.status} reading the Thing: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }

  // 404: fresh Ditto - create policy, then Thing from the canonical seed.
  console.log("Thing not found - provisioning policy + Thing from demo-twin-seed.json ...");

  const policyRes = await fetch(policyUrl, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      entries: {
        owner: {
          subjects: { [`nginx:${DITTO_USER}`]: { type: "generated" } },
          resources: {
            "thing:/": { grant: ["READ", "WRITE"], revoke: [] },
            "policy:/": { grant: ["READ", "WRITE"], revoke: [] },
            "message:/": { grant: ["READ", "WRITE"], revoke: [] },
          },
        },
      },
    }),
  });
  if (![200, 201, 204].includes(policyRes.status)) {
    console.error(`ERROR: policy PUT failed (HTTP ${policyRes.status}): ${(await policyRes.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`policy ${THING_ID}: HTTP ${policyRes.status}`);

  const seedPath = join(dirname(fileURLToPath(import.meta.url)), "demo-twin-seed.json");
  const seed = JSON.parse(readFileSync(seedPath, "utf8"));
  delete seed._comment;

  const thingRes = await fetch(thingUrl, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ policyId: THING_ID, ...seed }),
  });
  if (![200, 201, 204].includes(thingRes.status)) {
    console.error(`ERROR: Thing PUT failed (HTTP ${thingRes.status}): ${(await thingRes.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`thing ${THING_ID}: HTTP ${thingRes.status} - provisioned. Done.`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
