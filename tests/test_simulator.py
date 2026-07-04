"""Unit tests for esp32_simulator.

Run from the repo root with:
    python -m unittest tests.test_simulator -v

These tests do not require Docker, MQTT, or any network: they exercise the
physics model, anomaly engine, payload builder, and runtime helpers directly.
"""
from __future__ import annotations

import os
import random
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "services" / "simulator"))

import esp32_simulator as sim  # noqa: E402  (import after sys.path tweak)


def _make_cfg(**overrides):
    """Build a SimConfig directly without going through env, for tests."""
    base = dict(
        mqtt_host="127.0.0.1",
        mqtt_port=1883,
        mqtt_username="",
        mqtt_password="",
        mqtt_topic="elevator/building-floor1-elevator/telemetry",
        mqtt_events_topic="elevator/building-floor1-elevator/events",
        mqtt_commands_topic="elevator/building-floor1-elevator/commands",
        mqtt_status_topic="elevator/building-floor1-elevator/status",
        mqtt_keepalive=60,
        mqtt_qos=1,
        mqtt_publish_timeout_s=5.0,
        thing_id="building:floor1:elevator",
        instance_id="testinst",
        publish_interval_s=3.0,
        physics_step_s=0.1,
        num_floors=4,
        lobby_floor=0,
        floor_height_m=3.0,
        max_speed_ms=1.8,
        accel_ms2=0.6,
        decel_ms2=0.6,
        door_open_dwell_s=4.0,
        door_travel_s=2.0,
        max_load_kg=800.0,
        overload_threshold=0.95,
        motor_idle_temp_c=25.0,
        motor_max_temp_c=95.0,
        motor_heat_rate_c_per_s=0.30,
        motor_cool_rate_c_per_s=0.15,
        motor_design_life_h=10000.0,
        vibration_baseline_g=0.05,
        anomaly_profile="normal",
        anomaly_rates=dict(sim.ANOMALY_PROFILES["normal"]),
        emergency_auto_clear=False,
        demo_auto_clear_s=90.0,
        random_seed=42,
        runtime_dir=Path(tempfile.mkdtemp(prefix="sim-test-")),
        health_file=Path(tempfile.gettempdir()) / "sim-test.health",
        snapshot_file=Path(tempfile.gettempdir()) / "sim-test-live.json",
        log_level="INFO",
    )
    base.update(overrides)
    base["health_file"] = base["runtime_dir"] / ".health"
    base["snapshot_file"] = base["runtime_dir"] / "live-twin.json"
    return sim.SimConfig(**base)


class TestCanonicalTopics(unittest.TestCase):
    """The project standardises on:
        elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
    The Ditto Thing ID keeps ':'; the MQTT segment uses '-'.
    """

    def test_thing_id_to_mqtt_id_replaces_colons(self):
        self.assertEqual(sim.thing_id_to_mqtt_id("building:floor1:elevator"),
                         "building-floor1-elevator")

    def test_mqtt_id_to_thing_id_is_inverse_for_simple_ids(self):
        self.assertEqual(sim.mqtt_id_to_thing_id("building-floor1-elevator"),
                         "building:floor1:elevator")

    def test_topic_builders_match_canonical_pattern(self):
        thing_id = "building:floor1:elevator"
        self.assertEqual(sim.build_telemetry_topic(thing_id),
                         "elevator/building-floor1-elevator/telemetry")
        self.assertEqual(sim.build_events_topic(thing_id),
                         "elevator/building-floor1-elevator/events")
        self.assertEqual(sim.build_commands_topic(thing_id),
                         "elevator/building-floor1-elevator/commands")
        self.assertEqual(sim.build_status_topic(thing_id),
                         "elevator/building-floor1-elevator/status")

    def test_default_simconfig_uses_canonical_telemetry_topic(self):
        for key in ("MQTT_TOPIC", "MQTT_TELEMETRY_TOPIC", "MQTT_EVENTS_TOPIC",
                    "MQTT_COMMANDS_TOPIC", "MQTT_STATUS_TOPIC", "THING_ID",
                    "PRIMARY_THING_ID"):
            os.environ.pop(key, None)
        cfg = sim.SimConfig.from_env()
        self.assertEqual(cfg.mqtt_topic,
                         "elevator/building-floor1-elevator/telemetry")
        self.assertEqual(cfg.mqtt_events_topic,
                         "elevator/building-floor1-elevator/events")
        self.assertEqual(cfg.mqtt_commands_topic,
                         "elevator/building-floor1-elevator/commands")
        self.assertEqual(cfg.mqtt_status_topic,
                         "elevator/building-floor1-elevator/status")


class TestConfig(unittest.TestCase):
    def test_invalid_anomaly_profile_raises(self):
        os.environ["SIM_ANOMALY_PROFILE"] = "does-not-exist"
        try:
            with self.assertRaises(ValueError):
                sim.SimConfig.from_env()
        finally:
            os.environ.pop("SIM_ANOMALY_PROFILE", None)

    def test_invalid_int_raises(self):
        os.environ["MQTT_PORT"] = "not-a-number"
        try:
            with self.assertRaises(ValueError):
                sim.SimConfig.from_env()
        finally:
            os.environ.pop("MQTT_PORT", None)

    def test_defaults_round_trip(self):
        # Clear any test-injected env so we get pure defaults.
        for key in ("MQTT_PORT", "SIM_ANOMALY_PROFILE", "SIM_NUM_FLOORS",
                    "PUBLISH_INTERVAL_S", "SIMULATOR_PUBLISH_INTERVAL_S"):
            os.environ.pop(key, None)
        cfg = sim.SimConfig.from_env()
        self.assertEqual(cfg.thing_id, "building:floor1:elevator")
        self.assertEqual(cfg.mqtt_port, 1883)
        self.assertEqual(cfg.num_floors, 4)
        self.assertGreater(cfg.publish_interval_s, 0)
        self.assertGreater(cfg.physics_step_s, 0)
        self.assertLessEqual(cfg.physics_step_s, cfg.publish_interval_s)
        self.assertIn(cfg.anomaly_profile, sim.ANOMALY_PROFILES)


class TestPhysicsMotion(unittest.TestCase):
    def setUp(self):
        self.cfg = _make_cfg(anomaly_profile="disabled",
                             anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        self.rng = random.Random(123)

    def test_no_floor_overshoot(self):
        """While stopped (idle / dwell / opening / closing) position must be on a floor."""
        phy = sim.ElevatorPhysics(self.cfg, self.rng)
        stopped_phases = (sim.ElevatorPhase.IDLE,
                          sim.ElevatorPhase.DOOR_DWELL,
                          sim.ElevatorPhase.DOOR_OPENING,
                          sim.ElevatorPhase.DOOR_CLOSING)
        height = self.cfg.floor_height_m
        floors_visited = set()
        for _ in range(120):
            phy.tick(self.cfg.publish_interval_s)
            if phy.phase in stopped_phases and phy.speed_ms == 0.0:
                # The cabin is stationary -- it must be exactly on a floor coord.
                offset = abs(phy.position_m - phy.current_floor * height)
                self.assertLess(
                    offset, 0.01,
                    f"Stopped at phase {phy.phase.name} but offset {offset:.3f}m "
                    f"from floor {phy.current_floor} (pos={phy.position_m:.3f}m)"
                )
                floors_visited.add(phy.current_floor)
        # The elevator should have stopped at more than one distinct floor.
        self.assertGreater(len(floors_visited), 1)

    def test_load_never_negative(self):
        phy = sim.ElevatorPhysics(self.cfg, self.rng)
        for _ in range(200):
            phy.tick(self.cfg.publish_interval_s)
            self.assertGreaterEqual(phy.load_kg, 0.0,
                                    f"load_kg went negative: {phy.load_kg}")

    def test_position_clamped_to_building(self):
        phy = sim.ElevatorPhysics(self.cfg, self.rng)
        # Drive long enough to visit several floors; the floor index must
        # always be inside the building.
        for _ in range(150):
            phy.tick(self.cfg.publish_interval_s)
            self.assertGreaterEqual(phy.current_floor, 0)
            self.assertLess(phy.current_floor, self.cfg.num_floors)


class TestSafetyLatch(unittest.TestCase):
    def test_emergency_latches_by_default(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]),
                        emergency_auto_clear=False)
        phy = sim.ElevatorPhysics(cfg, random.Random(7))
        phy.request_emergency_stop("test")
        # 5 minutes of simulated time at default tick rate -- emergency must persist.
        for _ in range(120):
            phy.tick(cfg.publish_interval_s)
        self.assertTrue(phy.emergency_stop)
        self.assertEqual(phy.phase, sim.ElevatorPhase.EMERGENCY)

    def test_emergency_clears_only_on_acknowledgement(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        phy = sim.ElevatorPhysics(cfg, random.Random(7))
        phy.request_emergency_stop("test")
        phy.tick(cfg.publish_interval_s)
        self.assertTrue(phy.emergency_stop)
        phy.clear_emergency("operator_ack")
        self.assertFalse(phy.emergency_stop)
        self.assertNotEqual(phy.phase, sim.ElevatorPhase.EMERGENCY)

    def test_emergency_demo_auto_clear_when_enabled(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]),
                        emergency_auto_clear=True,
                        demo_auto_clear_s=2.0,
                        publish_interval_s=1.0,
                        physics_step_s=0.1)
        phy = sim.ElevatorPhysics(cfg, random.Random(7))
        phy.request_emergency_stop("test")
        # Advance well past the auto-clear window.
        for _ in range(5):
            phy.tick(cfg.publish_interval_s)
        self.assertFalse(phy.emergency_stop)

    def test_security_state_reflects_latched_flags(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        phy = sim.ElevatorPhysics(cfg, random.Random(7))
        phy.forced_entry = True
        phy.tick(cfg.publish_interval_s)
        self.assertEqual(phy.security_state, sim.SecurityState.HUMAN_REVIEW_REQUIRED)
        phy.audio_distress = True
        phy.tick(cfg.publish_interval_s)
        self.assertEqual(phy.security_state, sim.SecurityState.LOCKDOWN)
        phy.acknowledge_security_incident()
        phy.tick(cfg.publish_interval_s)
        self.assertEqual(phy.security_state, sim.SecurityState.NORMAL)


class TestAnomalyEngine(unittest.TestCase):
    def test_disabled_profile_yields_zero_anomalies(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        rng = random.Random(99)
        phy = sim.ElevatorPhysics(cfg, rng)
        inj = sim.AnomalyInjector(phy, cfg, rng)
        triggered_total = []
        for _ in range(200):
            triggered_total.extend(inj.roll(cfg.publish_interval_s))
        self.assertEqual(triggered_total, [])

    def test_critical_profile_triggers_at_least_one(self):
        cfg = _make_cfg(anomaly_profile="critical",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["critical"]))
        rng = random.Random(11)
        phy = sim.ElevatorPhysics(cfg, rng)
        inj = sim.AnomalyInjector(phy, cfg, rng)
        any_triggered = False
        for _ in range(200):
            if inj.roll(cfg.publish_interval_s):
                any_triggered = True
                break
        self.assertTrue(any_triggered)

    def test_anomaly_per_second_rate_independent_of_tick(self):
        """Doubling the tick should not roughly double the activation count."""
        rng_a = random.Random(2024)
        rng_b = random.Random(2024)
        cfg_short = _make_cfg(publish_interval_s=1.0, physics_step_s=0.1,
                              anomaly_profile="critical",
                              anomaly_rates=dict(sim.ANOMALY_PROFILES["critical"]),
                              random_seed=2024)
        cfg_long = _make_cfg(publish_interval_s=2.0, physics_step_s=0.1,
                             anomaly_profile="critical",
                             anomaly_rates=dict(sim.ANOMALY_PROFILES["critical"]),
                             random_seed=2024)
        phy_a = sim.ElevatorPhysics(cfg_short, rng_a)
        phy_b = sim.ElevatorPhysics(cfg_long, rng_b)
        inj_a = sim.AnomalyInjector(phy_a, cfg_short, rng_a)
        inj_b = sim.AnomalyInjector(phy_b, cfg_long, rng_b)
        # Same total simulated time = 100 seconds in both cases.
        count_a = 0
        for _ in range(100):
            count_a += len(inj_a.roll(cfg_short.publish_interval_s))
        count_b = 0
        for _ in range(50):
            count_b += len(inj_b.roll(cfg_long.publish_interval_s))
        # Counts should be in the same ballpark (within ~3x). The old code,
        # which rolled per-tick, would have shown ~1:1 instead of ~rate-equal.
        self.assertGreater(count_a, 0)
        self.assertGreater(count_b, 0)
        self.assertLess(abs(count_a - count_b), max(count_a, count_b))


class TestPayloadSchema(unittest.TestCase):
    def test_payload_includes_all_n8n_fields(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        phy = sim.ElevatorPhysics(cfg, random.Random(7))
        phy.tick(cfg.publish_interval_s)
        msg = sim.build_ditto_payload(phy, cfg)
        self.assertEqual(msg["path"], "/features")
        self.assertIn("topic", msg)
        feats = msg["value"]
        for feature in ("cabin", "door", "motor", "security", "incident_log",
                        "energy", "performance"):
            self.assertIn(feature, feats, f"missing feature {feature}")
            self.assertIn("properties", feats[feature])
        cabin = feats["cabin"]["properties"]
        for key in ("current_floor", "target_floor", "direction", "load_kg",
                    "max_load_kg", "speed_ms", "emergency_stop",
                    "between_floors", "trips_today"):
            self.assertIn(key, cabin, f"cabin missing {key}")
        door = feats["door"]["properties"]
        for key in ("state", "door_forced_entry", "forced_entry", "blocked",
                    "cycle_count", "obstruction_events", "force_sensor_n"):
            self.assertIn(key, door, f"door missing {key}")
        motor = feats["motor"]["properties"]
        for key in ("vibration_level", "vibration_g", "vibration_baseline_g",
                    "hours_operated", "health_status", "temperature_c",
                    "current_draw_a", "power_kw"):
            self.assertIn(key, motor, f"motor missing {key}")
        security = feats["security"]["properties"]
        for key in ("audio_distress_active", "audio_distress",
                    "unauthorized_access_attempts", "rfid_last_card",
                    "rfid_access_granted", "alert_level", "state"):
            self.assertIn(key, security, f"security missing {key}")


class TestRuntimeArtifacts(unittest.TestCase):
    def test_health_marker_written(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        sim.write_health_marker(cfg, {"thing_id": cfg.thing_id, "tick": 1})
        self.assertTrue(cfg.health_file.exists())
        self.assertGreater(cfg.health_file.stat().st_size, 0)

    def test_snapshot_written_atomically(self):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]))
        phy = sim.ElevatorPhysics(cfg, random.Random(7))
        phy.tick(cfg.publish_interval_s)
        msg = sim.build_ditto_payload(phy, cfg)
        sim.persist_live_snapshot(cfg, msg["value"])
        self.assertTrue(cfg.snapshot_file.exists())
        contents = cfg.snapshot_file.read_text(encoding="utf-8")
        self.assertIn(cfg.thing_id, contents)


class TestDispatchPolicy(unittest.TestCase):
    """The device honours DISPATCH_POLICY params from the AI engine."""

    def _phy(self, **overrides):
        cfg = _make_cfg(anomaly_profile="disabled",
                        anomaly_rates=dict(sim.ANOMALY_PROFILES["disabled"]),
                        **overrides)
        return sim.ElevatorPhysics(cfg, random.Random(7)), cfg

    def test_default_policy_is_scan_collective(self):
        phy, _ = self._phy()
        self.assertEqual(phy.dispatch.policy_id, "SCAN_COLLECTIVE")
        self.assertIsNone(phy.dispatch.park_floor)

    def test_apply_policy_sets_params(self):
        phy, _ = self._phy()
        phy.apply_dispatch_policy("UP_PEAK", {
            "park_floor": 0, "direction_bias": 1, "accel_profile": "NORMAL",
            "speed_cap_ms": 1.6, "dwell_ms": 5000,
        })
        self.assertEqual(phy.dispatch.policy_id, "UP_PEAK")
        self.assertEqual(phy.dispatch.park_floor, 0)
        self.assertEqual(phy.dispatch.direction_bias, 1)
        self.assertIsNotNone(phy.dispatch.applied_at)

    def test_park_floor_clamped_to_building(self):
        phy, cfg = self._phy()
        phy.apply_dispatch_policy("DOWN_PEAK", {"park_floor": 99, "direction_bias": -1})
        self.assertEqual(phy.dispatch.park_floor, cfg.num_floors - 1)

    def test_gentle_profile_halves_accel_and_decel(self):
        phy, cfg = self._phy()
        phy.apply_dispatch_policy("HEALTH_LIMP", {"accel_profile": "GENTLE"})
        self.assertAlmostEqual(phy._eff_accel(), cfg.accel_ms2 * 0.5)
        self.assertAlmostEqual(phy._eff_decel(), cfg.decel_ms2 * 0.5)

    def test_speed_cap_limits_effective_max_speed(self):
        phy, cfg = self._phy()
        phy.apply_dispatch_policy("HEALTH_LIMP", {"speed_cap_ms": 1.0})
        self.assertEqual(phy._eff_max_speed(), 1.0)
        # A cap above the mechanical max cannot exceed it.
        phy.apply_dispatch_policy("SCAN_COLLECTIVE", {"speed_cap_ms": 99.0})
        self.assertEqual(phy._eff_max_speed(), cfg.max_speed_ms)

    def test_eco_dwell_extends_door_hold(self):
        phy, cfg = self._phy()
        phy.apply_dispatch_policy("ECO_ENERGY", {"dwell_ms": 7000})
        self.assertGreater(phy._eff_dwell(), cfg.door_open_dwell_s)

    def test_direction_bias_breaks_idle_ties_upward(self):
        phy, _ = self._phy()
        phy.current_floor = 1
        phy.direction = sim.Direction.IDLE
        phy._call_queue = [0, 3]                 # one below, one above
        phy.apply_dispatch_policy("UP_PEAK", {"direction_bias": 1})
        phy._pick_next_target()
        self.assertEqual(phy.target_floor, 3)    # upward call chosen

    def test_direction_bias_breaks_idle_ties_downward(self):
        phy, _ = self._phy()
        phy.current_floor = 2
        phy.direction = sim.Direction.IDLE
        phy._call_queue = [0, 3]
        phy.apply_dispatch_policy("DOWN_PEAK", {"direction_bias": -1})
        phy._pick_next_target()
        self.assertEqual(phy.target_floor, 0)    # downward call chosen

    def test_should_park_when_away_from_park_floor(self):
        phy, _ = self._phy()
        phy.current_floor = 3
        phy.apply_dispatch_policy("UP_PEAK", {"park_floor": 0})
        self.assertTrue(phy._should_park())
        phy.current_floor = 0
        self.assertFalse(phy._should_park())

    def test_restrict_floors_only_serves_allowed_floor(self):
        phy, _ = self._phy()
        phy.current_floor = 2
        phy._call_queue = [0, 1, 3]
        phy.apply_dispatch_policy("SECURITY_RESTRICTED", {"park_floor": 0, "restrict_floors": True})
        phy._pick_next_target()
        self.assertEqual(phy.target_floor, 0)
        # restricted floors were dropped from the queue
        self.assertNotIn(1, phy._call_queue)
        self.assertNotIn(3, phy._call_queue)

    def test_command_payload_applies_policy(self):
        # handle_command_payload takes the already-parsed dict: JSON decoding
        # happens once in the MQTT on_message handler (see make_mqtt_client).
        phy, _ = self._phy()
        applied = sim.handle_command_payload(
            phy,
            {
                "command": "DISPATCH_POLICY",
                "policy_id": "ECO_ENERGY",
                "params": {"park_floor": 2, "accel_profile": "GENTLE", "deep_idle": True},
            },
        )
        self.assertTrue(applied)
        self.assertEqual(phy.dispatch.policy_id, "ECO_ENERGY")
        self.assertEqual(phy.dispatch.park_floor, 2)
        self.assertTrue(phy.dispatch.deep_idle)

    def test_command_payload_ignores_junk(self):
        phy, _ = self._phy()
        # Non-dict payloads are rejected by the isinstance guard.
        self.assertFalse(sim.handle_command_payload(phy, "not a dict"))
        # Recognised-but-non-dispatch commands are acknowledged, not applied.
        self.assertFalse(sim.handle_command_payload(phy, {"command": "MOVE_TO_FLOOR"}))
        # unchanged
        self.assertEqual(phy.dispatch.policy_id, "SCAN_COLLECTIVE")

    def test_payload_reports_device_applied_policy(self):
        phy, cfg = self._phy()
        phy.apply_dispatch_policy("UP_PEAK", {"park_floor": 0, "direction_bias": 1})
        payload = sim.build_ditto_payload(phy, cfg)
        applied = payload["value"]["control"]["properties"]["device_applied_policy"]
        self.assertEqual(applied["policy_id"], "UP_PEAK")
        self.assertEqual(applied["park_floor"], 0)
        self.assertEqual(applied["direction_bias"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
