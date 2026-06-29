#!/usr/bin/env node
/**
 * MQTT round-trip time over the local broker and the TLS listener (paper GAPS M2).
 *
 * Measures steady-state publish -> broker -> subscriber round-trip for one
 * in-flight message at a time (QoS 1, sequential), after the connection and TLS
 * handshake are already established. It does NOT include connect/handshake setup
 * and is NOT end-to-end command latency (that crosses gate + Ditto + firmware).
 *
 * Requires a reachable broker. A throwaway broker is sufficient because this
 * measures transport latency, not authentication (auth/ACL are evidenced
 * separately in evidence/mqtt/). Bring one up by staging the config + certs in
 * one directory (see scripts/measurement/README.md for the exact commands and
 * why a directory mount + chmod 644 on the key is required), then:
 *
 *   node scripts/validation/bench-mqtt-rtt.mjs
 *   docker rm -f mqtt-rtt-test
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mqtt = require(path.resolve(here, "../../apps/dashboard/node_modules/mqtt"));

const N = 500;       // timed round-trips per transport
const WARMUP = 50;
const TOPIC = "rtt/probe";

function stats(samplesMs) {
  const s = Float64Array.from(samplesMs).sort();
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, mean_ms: mean, median_ms: q(0.5), p95_ms: q(0.95), p99_ms: q(0.99),
    min_ms: s[0], max_ms: s[n - 1], stddev_ms: Math.sqrt(variance) };
}

function connect(label, url, opts) {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 8000, ...opts });
    c.once("connect", () => resolve(c));
    c.once("error", reject);
  });
}

async function measure(label, url, opts) {
  const c = await connect(label, url, opts);
  await new Promise((res, rej) => c.subscribe(TOPIC, { qos: 1 }, (e) => e ? rej(e) : res()));

  let resolveEcho = null;
  c.on("message", (_t, payload) => {
    if (resolveEcho) { const r = resolveEcho; resolveEcho = null; r(payload.toString()); }
  });

  const rttOnce = (seq) => new Promise((res) => {
    const t0 = process.hrtime.bigint();
    resolveEcho = () => res(Number(process.hrtime.bigint() - t0) / 1e6); // ns -> ms
    c.publish(TOPIC, String(seq), { qos: 1 });
  });

  for (let i = 0; i < WARMUP; i++) await rttOnce(i);
  const samples = new Float64Array(N);
  for (let i = 0; i < N; i++) samples[i] = await rttOnce(i);

  await new Promise((res) => c.end(false, {}, res));
  return stats(samples);
}

function fmt(s) {
  return `n=${s.n}  median=${s.median_ms.toFixed(3)}ms  mean=${s.mean_ms.toFixed(3)}ms  ` +
    `p95=${s.p95_ms.toFixed(3)}ms  p99=${s.p99_ms.toFixed(3)}ms  ` +
    `min=${s.min_ms.toFixed(3)}ms  max=${s.max_ms.toFixed(3)}ms  sd=${s.stddev_ms.toFixed(3)}ms`;
}

const TCP_URL = process.env.RTT_TCP_URL || "mqtt://127.0.0.1:18831";
const TLS_URL = process.env.RTT_TLS_URL || "mqtts://127.0.0.1:18883";
const CA = path.resolve(here, "../../infra/mqtt/certs/ca.crt");

const out = [];
out.push("# MQTT round-trip time -- local broker and TLS listener (GAPS M2)");
out.push(`# ${new Date().toISOString()}`);
out.push(`# node ${process.version} | ${os.platform()} ${os.release()} | ${os.cpus()[0]?.model?.trim()}`);
out.push(`# QoS 1, one in-flight message, ${N} samples/transport after ${WARMUP} warmup; loopback`);
out.push("# steady-state RTT only (excludes connect + TLS handshake). NOT end-to-end command latency.");
out.push("");

try {
  const tcp = await measure("tcp", TCP_URL, {});
  out.push(`local TCP  (${TCP_URL}) : ${fmt(tcp)}`);
} catch (e) { out.push(`local TCP  (${TCP_URL}) : FAILED -- ${e.message}`); }

try {
  const tls = await measure("tls", TLS_URL, {
    ca: fs.existsSync(CA) ? fs.readFileSync(CA) : undefined,
    rejectUnauthorized: false, // measure transport, not hostname/SAN (cert validity evidenced separately)
  });
  out.push(`TLS 8883   (${TLS_URL}) : ${fmt(tls)}`);
} catch (e) { out.push(`TLS 8883   (${TLS_URL}) : FAILED -- ${e.message}`); }

const text = out.join("\n");
console.log(text);
const dest = path.resolve(here, "../../evidence/perf/mqtt-rtt.txt");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, text + "\n");
console.log(`\n# wrote ${dest}`);
process.exit(0);
