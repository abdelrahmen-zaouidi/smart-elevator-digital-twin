// =============================================================================
// esp32_resource_probe.h  —  drop-in ESP32-S3 resource instrumentation (GAPS M8)
//
// Logs free heap, minimum-ever free heap, largest allocatable block, task stack
// high-water mark, and loop timing over serial, so the paper can report measured
// embedded-resource figures instead of "no capture found".
//
// HOW TO USE (Arduino-ESP32 core, the firmware already uses it):
//   1. Copy this file next to the .ino and add at the top of the sketch:
//          #include "esp32_resource_probe.h"
//   2. In setup(), place snapshots around the connection lifecycle:
//          m8_mark("boot");                 // very start of setup()
//          // ... WiFi.begin(...) ...
//          m8_mark("after_wifi");           // once WiFi.status()==WL_CONNECTED
//          // ... espClient.setCACert(...); first TLS connect ...
//          m8_mark("after_tls");            // after WiFiClientSecure connects
//          // ... mqttClient.connect(...) ...
//          m8_mark("after_mqtt");           // after PubSubClient connects
//   3. As the FIRST line of loop():
//          m8_loop_tick();                  // measures loop period + prints window
//   4. In the MQTT receive callback, after a command is applied:
//          m8_mark("after_command");
//   5. Flash, open Serial at 115200, run a >=30 min session (idle + several
//      moves + a command burst), and capture the serial log to a file, e.g.:
//          # Linux/macOS
//          (stty -F /dev/ttyUSB0 115200; cat /dev/ttyUSB0) | tee evidence/perf/esp32-resources.txt
//          # Windows: use Arduino Serial Monitor "Log output to file", or
//          #   plink -serial COM5 -sercfg 115200 | tee evidence/perf/esp32-resources.txt
//   6. Lines are CSV-tagged "M8,...". Summarise with:
//          node scripts/measurement/summarize_esp32.mjs evidence/perf/esp32-resources.txt
//
// Report: min free heap (worst case), idle vs. moving vs. post-TLS heap, stack
// head-room, and loop period (median/p95/max). Heap is in bytes; loop in us.
// =============================================================================
#pragma once
#include <Arduino.h>
#include "esp_heap_caps.h"

#ifndef M8_WINDOW_MS
#define M8_WINDOW_MS 5000UL   // print a rolling loop+heap summary this often
#endif

static uint32_t  m8_win_start   = 0;
static uint32_t  m8_loop_count  = 0;
static uint32_t  m8_last_us     = 0;
static uint32_t  m8_loop_min_us = 0xFFFFFFFFUL;
static uint32_t  m8_loop_max_us = 0;
static uint64_t  m8_loop_sum_us = 0;

// Labeled one-shot snapshot at a lifecycle point.
inline void m8_mark(const char* label) {
  Serial.printf(
    "M8,mark,%s,uptime_ms=%lu,free_heap=%u,min_free_heap=%u,max_alloc=%u,"
    "stack_hwm_words=%u,psram_free=%u\n",
    label, (unsigned long)millis(),
    (unsigned)ESP.getFreeHeap(),
    (unsigned)ESP.getMinFreeHeap(),
    (unsigned)ESP.getMaxAllocHeap(),
    (unsigned)uxTaskGetStackHighWaterMark(NULL),
    (unsigned)ESP.getFreePsram());
}

// Call as the first line of loop(): accumulates loop period, prints a window.
inline void m8_loop_tick() {
  uint32_t now_us = micros();
  if (m8_last_us != 0) {
    uint32_t dt = now_us - m8_last_us;           // wraps cleanly (uint32 modulo)
    if (dt < m8_loop_min_us) m8_loop_min_us = dt;
    if (dt > m8_loop_max_us) m8_loop_max_us = dt;
    m8_loop_sum_us += dt;
    m8_loop_count++;
  }
  m8_last_us = now_us;

  uint32_t now_ms = millis();
  if (m8_win_start == 0) m8_win_start = now_ms;
  if (now_ms - m8_win_start >= M8_WINDOW_MS && m8_loop_count > 0) {
    Serial.printf(
      "M8,window,uptime_ms=%lu,loops=%lu,loop_avg_us=%lu,loop_min_us=%lu,"
      "loop_max_us=%lu,free_heap=%u,min_free_heap=%u\n",
      (unsigned long)now_ms, (unsigned long)m8_loop_count,
      (unsigned long)(m8_loop_sum_us / m8_loop_count),
      (unsigned long)m8_loop_min_us, (unsigned long)m8_loop_max_us,
      (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap());
    m8_win_start   = now_ms;
    m8_loop_count  = 0;
    m8_loop_min_us = 0xFFFFFFFFUL;
    m8_loop_max_us = 0;
    m8_loop_sum_us = 0;
  }
}
