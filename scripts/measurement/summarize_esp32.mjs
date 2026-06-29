#!/usr/bin/env node
/**
 * Summarize an ESP32 resource-probe serial capture (GAPS M8).
 *   node scripts/measurement/summarize_esp32.mjs evidence/perf/esp32-resources.txt
 *
 * Parses the "M8,mark,..." and "M8,window,..." CSV lines emitted by
 * esp32_resource_probe.h and prints the figures to quote in the paper.
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: summarize_esp32.mjs <serial-capture.txt>"); process.exit(1); }

const kv = (s) => Object.fromEntries(
  s.split(",").filter((p) => p.includes("=")).map((p) => {
    const [k, v] = p.split("="); return [k, Number(v)];
  }));
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

const marks = [];
const windows = [];
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  if (line.startsWith("M8,mark,")) {
    const label = line.split(",")[2];
    marks.push({ label, ...kv(line) });
  } else if (line.startsWith("M8,window,")) {
    windows.push(kv(line));
  }
}

console.log(`# ESP32 resource summary from ${file}`);
console.log(`# ${marks.length} lifecycle marks, ${windows.length} loop windows\n`);

if (marks.length) {
  console.log("## Lifecycle heap snapshots (bytes)");
  for (const m of marks) {
    console.log(`  ${m.label.padEnd(14)} free_heap=${m.free_heap}  min_free_heap=${m.min_free_heap}  ` +
      `max_alloc=${m.max_alloc}  stack_hwm_words=${m.stack_hwm_words}`);
  }
  console.log("");
}

if (windows.length) {
  const minFree = Math.min(...windows.map((w) => w.min_free_heap));
  const avgs = windows.map((w) => w.loop_avg_us);
  const maxes = windows.map((w) => w.loop_max_us);
  console.log("## Loop timing across windows (microseconds)");
  console.log(`  loop_avg: median=${pct(avgs, 0.5)}  p95=${pct(avgs, 0.95)}  min=${Math.min(...avgs)}  max=${Math.max(...avgs)}`);
  console.log(`  worst single-loop max across run: ${Math.max(...maxes)} us`);
  console.log(`  minimum free heap observed: ${minFree} bytes`);
}
