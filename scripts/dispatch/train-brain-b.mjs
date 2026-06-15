#!/usr/bin/env node
/**
 * Brain B trainer (offline, Phase 1 imitation).
 *
 * Fits a transparent multinomial (softmax) linear model over the shared feature
 * vector to imitate Brain A's policy choices, then writes a model spec in the
 * exact shape Brain B (brainML.js) loads:
 *
 *     { id, version, trained_at, training_rows, metrics, policies: { POLICY: { bias, weights } } }
 *
 * Softmax regression keeps the model EXPLAINABLE (per-feature weights = the
 * attributions Brain B surfaces). Phase 2 swaps the label-imitation target for
 * the reward column to optimise realized outcomes; the model shape is unchanged.
 *
 * Usage:
 *   node scripts/dispatch/train-brain-b.mjs \
 *        --data scripts/dispatch/data/training.jsonl \
 *        --out packages/shared/dispatch/models/ml_v1.json \
 *        --epochs 300 --lr 0.5 --l2 0.001
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_NAMES, POLICY_IDS } from "../../packages/shared/dispatch/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const DATA = path.resolve(arg("data", path.join(__dirname, "data", "training.jsonl")));
const OUT = path.resolve(arg("out", path.join(__dirname, "..", "..", "dashboard", "src", "lib", "dispatch", "models", "ml_v1.json")));
const EPOCHS = parseInt(arg("epochs", "300"), 10);
const LR = parseFloat(arg("lr", "0.5"));
const L2 = parseFloat(arg("l2", "0.001"));

if (!fs.existsSync(DATA)) {
  console.error(`No training data at ${DATA}. Run generate-training-data.mjs first.`);
  process.exit(1);
}

// ---- Load dataset ----------------------------------------------------------
const rows = fs.readFileSync(DATA, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const F = FEATURE_NAMES.length;
const K = POLICY_IDS.length;
const polIndex = Object.fromEntries(POLICY_IDS.map((p, i) => [p, i]));

const X = rows.map((r) => FEATURE_NAMES.map((f) => Number(r.features[f] ?? 0)));
const y = rows.map((r) => polIndex[r.label]);
const valid = y.map((v) => v != null);
const Xs = X.filter((_, i) => valid[i]);
const ys = y.filter((v) => v != null);
console.log(`Loaded ${Xs.length} rows, ${F} features, ${K} classes`);

// ---- Softmax regression (full-batch gradient descent) ----------------------
const W = Array.from({ length: K }, () => new Float64Array(F)); // weights[class][feature]
const b = new Float64Array(K);                                  // bias[class]

function softmax(logits) {
  const m = Math.max(...logits);
  const ex = logits.map((z) => Math.exp(z - m));
  const s = ex.reduce((a, v) => a + v, 0);
  return ex.map((v) => v / s);
}

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const gW = Array.from({ length: K }, () => new Float64Array(F));
  const gB = new Float64Array(K);
  let loss = 0;

  for (let n = 0; n < Xs.length; n++) {
    const x = Xs[n], t = ys[n];
    const logits = new Array(K);
    for (let k = 0; k < K; k++) {
      let z = b[k];
      for (let f = 0; f < F; f++) z += W[k][f] * x[f];
      logits[k] = z;
    }
    const p = softmax(logits);
    loss += -Math.log(Math.max(p[t], 1e-12));
    for (let k = 0; k < K; k++) {
      const err = p[k] - (k === t ? 1 : 0);
      gB[k] += err;
      for (let f = 0; f < F; f++) gW[k][f] += err * x[f];
    }
  }

  const inv = 1 / Xs.length;
  for (let k = 0; k < K; k++) {
    b[k] -= LR * (gB[k] * inv);
    for (let f = 0; f < F; f++) {
      W[k][f] -= LR * (gW[k][f] * inv + L2 * W[k][f]);
    }
  }
  if (epoch % 50 === 0 || epoch === EPOCHS - 1) {
    console.log(`epoch ${epoch}  loss ${(loss * inv).toFixed(4)}`);
  }
}

// ---- Training agreement (accuracy vs Brain A) ------------------------------
let correct = 0;
for (let n = 0; n < Xs.length; n++) {
  const x = Xs[n];
  let best = 0, bestZ = -Infinity;
  for (let k = 0; k < K; k++) {
    let z = b[k];
    for (let f = 0; f < F; f++) z += W[k][f] * x[f];
    if (z > bestZ) { bestZ = z; best = k; }
  }
  if (best === ys[n]) correct++;
}
const agreement = correct / Xs.length;
console.log(`Training agreement with Brain A: ${(agreement * 100).toFixed(1)}%`);

// ---- Emit model spec -------------------------------------------------------
const policies = {};
for (let k = 0; k < K; k++) {
  const weights = {};
  for (let f = 0; f < F; f++) {
    if (Math.abs(W[k][f]) > 1e-4) weights[FEATURE_NAMES[f]] = +W[k][f].toFixed(5);
  }
  policies[POLICY_IDS[k]] = { bias: +b[k].toFixed(5), weights };
}
const spec = {
  id: "ml_v1",
  version: `trained-${new Date().toISOString().slice(0, 10)}`,
  trained_at: new Date().toISOString(),
  training_rows: Xs.length,
  metrics: { imitation_agreement: +agreement.toFixed(4), epochs: EPOCHS, lr: LR, l2: L2 },
  policies,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2), "utf8");
console.log(`Wrote model spec -> ${OUT}`);
