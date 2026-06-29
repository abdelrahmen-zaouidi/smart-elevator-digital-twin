#!/usr/bin/env node
/**
 * Build a histogram data file for the paper's gate-latency figure from the raw
 * benchmark samples, so the plotted distribution is the measured one (no
 * hand-entered numbers).
 *   node scripts/measurement/make-latency-hist.mjs
 * Reads evidence/perf/decision-latency.json, writes paper/figures/gate-latency-hist.dat
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const data = JSON.parse(fs.readFileSync(path.join(root, "evidence/perf/decision-latency.json"), "utf8"));
const samples = data.gate_accepted_samples_us;
if (!Array.isArray(samples) || !samples.length) {
  console.error("no gate_accepted_samples_us in JSON"); process.exit(1);
}

// Fixed-width bins 5..14 us at 0.5 us; everything >=14 us folds into an overflow bin.
const LO = 5.0, HI = 14.0, W = 0.5;
const nbins = Math.round((HI - LO) / W);
const counts = new Array(nbins + 1).fill(0); // last cell = overflow
for (const v of samples) {
  if (v >= HI) { counts[nbins]++; continue; }
  const b = Math.floor((v - LO) / W);
  if (b < 0) counts[0]++; else counts[b]++;
}

const lines = ["bin count"]; // bin = left edge (us)
for (let i = 0; i < nbins; i++) lines.push(`${(LO + i * W).toFixed(1)} ${counts[i]}`);
lines.push(`${HI.toFixed(1)} ${counts[nbins]}`); // overflow drawn at 14.0 ("14+")

const dest = path.join(root, "paper/figures/gate-latency-hist.dat");
fs.writeFileSync(dest, lines.join("\n") + "\n");
console.log(`wrote ${dest} (${samples.length} samples, ${nbins}+1 bins)`);

// ECDF (downsampled): x = latency (us), y = cumulative fraction. Clip x for readability.
const sorted = Float64Array.from(samples).sort();
const n = sorted.length;
const XCLIP = 25.0;
const ec = ["lat frac"];
for (let p = 0; p <= 1.0001; p += 0.0025) {
  const v = sorted[Math.min(n - 1, Math.floor(p * n))];
  ec.push(`${Math.min(v, XCLIP).toFixed(3)} ${p.toFixed(4)}`);
}
const ecdest = path.join(root, "paper/figures/gate-latency-ecdf.dat");
fs.writeFileSync(ecdest, ec.join("\n") + "\n");
console.log(`wrote ${ecdest} (ECDF, clipped at ${XCLIP}us)`);

const g = data.results.gate_accepted;
console.log(`median=${g.median_us}us p95=${g.p95_us}us p99=${g.p99_us}us`);
