"""
================================================================================
  ADVANCED ELEVATOR DIGITAL TWIN SIMULATOR
  For: Agentic AI Smart Elevator Management System
  Schema: Eclipse Ditto (building:floor1:elevator)
  Protocol: MQTT -> Mosquitto -> Ditto Connectivity Service
================================================================================

  ARCHITECTURE:
    Physics Engine -> Anomaly Injector -> MQTT Publisher -> Ditto Twin

  PHYSICS MODEL:
  - Realistic floor-to-floor travel: DOOR_OPEN -> CLOSING -> MOVING -> DECELERATING -> ARRIVED
  - Acceleration/deceleration curves (not instant speed changes)
  - Sub-step integration: physics is advanced in fixed small steps regardless
    of the configured publish interval, so motion stays stable and floors
    never overshoot.
  - Time-rate thermal model (per-second), independent of tick rate.
  - Door open timer with obstruction detection.

  SAFETY:
  - Emergency stop, forced entry, and audio distress LATCH by default.
    Manual acknowledgement is required to clear them; an opt-in demo
    auto-clear is available for academic demonstrations.

  ANOMALY ENGINE:
  - Per-second rate model (Poisson approximation): the configured publish
    interval no longer changes how often anomalies fire.
  - Profiles: normal, noisy, demo, critical, disabled.
  - Cascading failures (e.g. extreme vibration -> emergency stop).

  DITTO PAYLOAD:
  - Eclipse Ditto Protocol wire format (topic + path + value).
  - Field names backwards-compatible with the existing bridge, dashboard,
    and n8n risk engine. Adds the fields the n8n analysis agent reads
    (max_load_kg, between_floors, vibration_g, vibration_baseline_g,
    current_draw_a, power_kw, cycle_count, obstruction_events, etc.).

  RELIABILITY:
  - Unique MQTT client id derived from THING_ID, instance id, and pid.
  - QoS 1 publish with delivery confirmation timeout.
  - Graceful shutdown on SIGINT and SIGTERM.
  - Optional deterministic random seed for repeatable demos and unit tests.
  - runtime/.health touch every tick so Dockerfile.simulator HEALTHCHECK passes.
================================================================================
"""

from __future__ import annotations

import json
import logging
import math
import os
import random
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum, auto
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt


# ──────────────────────────────────────────────────────────────────────────────
# LOGGING SETUP
# ──────────────────────────────────────────────────────────────────────────────
def _configure_logging(level_name: str) -> None:
    level = getattr(logging, str(level_name).upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )


_configure_logging(os.getenv("SIM_LOG_LEVEL", "INFO"))
log = logging.getLogger("ElevatorSim")


# ──────────────────────────────────────────────────────────────────────────────
# CANONICAL MQTT TOPIC HELPERS
# ──────────────────────────────────────────────────────────────────────────────
# Topic convention (single source of truth, used everywhere):
#     elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
#
# Ditto Thing IDs use ':' as a namespace/name separator
# (e.g. "building:floor1:elevator"). ':' is legal in MQTT topics but mixes
# poorly with topic ACLs and is unusual in IoT topic schemes, so we derive a
# safe MQTT id by replacing ':' with '-'. The Ditto Thing ID itself is
# unchanged.
def thing_id_to_mqtt_id(thing_id: str) -> str:
    """Derive an MQTT-safe id from a Ditto Thing ID. ':' -> '-'."""
    return str(thing_id).replace(":", "-")


def mqtt_id_to_thing_id(mqtt_id: str) -> str:
    """Inverse of thing_id_to_mqtt_id. Lossy if a Thing ID legitimately
    contained '-', so only use this when you know the topic was produced
    by thing_id_to_mqtt_id (e.g. parsed back out of a bridge subscription)."""
    return str(mqtt_id).replace("-", ":")


def build_telemetry_topic(thing_id: str) -> str:
    return f"elevator/{thing_id_to_mqtt_id(thing_id)}/telemetry"


def build_events_topic(thing_id: str) -> str:
    return f"elevator/{thing_id_to_mqtt_id(thing_id)}/events"


def build_commands_topic(thing_id: str) -> str:
    return f"elevator/{thing_id_to_mqtt_id(thing_id)}/commands"


def build_status_topic(thing_id: str) -> str:
    return f"elevator/{thing_id_to_mqtt_id(thing_id)}/status"


# ──────────────────────────────────────────────────────────────────────────────
# ENV PARSING HELPERS
# ──────────────────────────────────────────────────────────────────────────────
def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    return default if value is None or value == "" else str(value)


def _env_int(name: str, default: int, *, minimum: Optional[int] = None,
             maximum: Optional[int] = None) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer (got {raw!r})") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name}={value} is below minimum {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name}={value} is above maximum {maximum}")
    return value


def _env_float(name: str, default: float, *, minimum: Optional[float] = None,
               maximum: Optional[float] = None) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number (got {raw!r})") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name}={value} is below minimum {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name}={value} is above maximum {maximum}")
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_optional_int(name: str) -> Optional[int]:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer (got {raw!r})") from exc


# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ──────────────────────────────────────────────────────────────────────────────
ANOMALY_PROFILES = {
    # Per-second activation rates. Per-tick probability is derived as
    # 1 - exp(-rate * dt) so changing the publish interval does not change
    # the effective failure frequency.
    "normal": {
        "forced_door":           0.0040,
        "unauthorized_rfid":     0.0060,
        "motor_vibration_spike": 0.0050,
        "audio_distress":        0.0025,
        "emergency_button":      0.0015,
        "overload":              0.0033,
        "door_obstruction":      0.0070,
        "motor_overheat":        0.0020,
        "power_fluctuation":     0.0030,
        "rfid_reader_fault":     0.0023,
        "free_fall_vibration":   0.0010,
        "stuck_between_floors":  0.0013,
    },
    "noisy": {},     # filled below as 2x normal
    "demo": {},      # filled below as 5x normal
    "critical": {},  # filled below as 10x normal
    "disabled": {key: 0.0 for key in [
        "forced_door", "unauthorized_rfid", "motor_vibration_spike",
        "audio_distress", "emergency_button", "overload", "door_obstruction",
        "motor_overheat", "power_fluctuation", "rfid_reader_fault",
        "free_fall_vibration", "stuck_between_floors",
    ]},
}
ANOMALY_PROFILES["noisy"]    = {k: v * 2.0  for k, v in ANOMALY_PROFILES["normal"].items()}
ANOMALY_PROFILES["demo"]     = {k: v * 5.0  for k, v in ANOMALY_PROFILES["normal"].items()}
ANOMALY_PROFILES["critical"] = {k: v * 10.0 for k, v in ANOMALY_PROFILES["normal"].items()}

AUTHORIZED_CARDS = ["CARD-A001", "CARD-A002", "CARD-B001",
                    "CARD-MAINT-01", "CARD-SECURITY-01"]


@dataclass(frozen=True)
class SimConfig:
    """All runtime configuration. Built once from env at startup."""
    # MQTT
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str        # broker auth (matches firmware SECRET_MQTT_USERNAME); '' = anonymous
    mqtt_password: str
    mqtt_topic: str           # canonical telemetry publish topic
    mqtt_events_topic: str    # canonical events publish topic
    mqtt_commands_topic: str  # canonical commands topic (publish for device-side, subscribe for cloud)
    mqtt_status_topic: str    # canonical status/heartbeat topic
    mqtt_keepalive: int
    mqtt_qos: int
    mqtt_publish_timeout_s: float

    # Identity
    thing_id: str
    instance_id: str

    # Tick / physics
    publish_interval_s: float
    physics_step_s: float

    # Building / physics constants
    num_floors: int
    lobby_floor: int
    floor_height_m: float
    max_speed_ms: float
    accel_ms2: float
    decel_ms2: float
    door_open_dwell_s: float
    door_travel_s: float
    max_load_kg: float
    overload_threshold: float

    # Motor model
    motor_idle_temp_c: float
    motor_max_temp_c: float
    motor_heat_rate_c_per_s: float
    motor_cool_rate_c_per_s: float
    motor_design_life_h: float
    vibration_baseline_g: float

    # Anomaly engine
    anomaly_profile: str
    anomaly_rates: dict

    # Safety
    emergency_auto_clear: bool
    demo_auto_clear_s: float

    # Determinism
    random_seed: Optional[int]

    # Runtime artifacts
    runtime_dir: Path
    health_file: Path
    snapshot_file: Path

    # Logging
    log_level: str

    @classmethod
    def from_env(cls) -> "SimConfig":
        thing_id = _env_str("THING_ID", _env_str("PRIMARY_THING_ID",
                                                 "building:floor1:elevator"))
        publish_interval_s = _env_float("PUBLISH_INTERVAL_S",
                                        _env_float("SIMULATOR_PUBLISH_INTERVAL_S", 3.0,
                                                   minimum=0.1, maximum=60.0),
                                        minimum=0.1, maximum=60.0)
        physics_step_s = _env_float("SIM_PHYSICS_STEP_S", 0.1,
                                    minimum=0.01, maximum=publish_interval_s)
        if physics_step_s > publish_interval_s:
            physics_step_s = publish_interval_s

        runtime_dir = Path(_env_str("SIM_RUNTIME_DIR",
                                    str(Path(__file__).resolve().parent / "runtime")))
        health_file = Path(_env_str("SIM_HEALTH_FILE",
                                    str(runtime_dir / ".health")))
        snapshot_file = Path(_env_str("SIM_SNAPSHOT_FILE",
                                      str(runtime_dir / "live-twin.json")))

        anomaly_profile = _env_str("SIM_ANOMALY_PROFILE", "normal").lower()
        if anomaly_profile not in ANOMALY_PROFILES:
            raise ValueError(
                f"SIM_ANOMALY_PROFILE={anomaly_profile!r} unknown. "
                f"Choose one of {sorted(ANOMALY_PROFILES)}."
            )

        num_floors = _env_int("SIM_NUM_FLOORS", 4, minimum=2, maximum=200)
        lobby_floor = _env_int("SIM_LOBBY_FLOOR", 0, minimum=0, maximum=num_floors - 1)

        # Canonical MQTT topic convention:
        #     elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
        # MQTT_TOPIC / MQTT_TELEMETRY_TOPIC / MQTT_EVENTS_TOPIC / MQTT_STATUS_TOPIC
        # may override the default. The legacy "elevator/telemetry/{id}" form is
        # deprecated and no longer the default.
        default_telemetry_topic = build_telemetry_topic(thing_id)
        default_events_topic = build_events_topic(thing_id)
        default_commands_topic = build_commands_topic(thing_id)
        default_status_topic = build_status_topic(thing_id)
        mqtt_telemetry_topic = _env_str(
            "MQTT_TOPIC",
            _env_str("MQTT_TELEMETRY_TOPIC", default_telemetry_topic),
        )
        mqtt_events_topic = _env_str("MQTT_EVENTS_TOPIC", default_events_topic)
        mqtt_commands_topic = _env_str("MQTT_COMMANDS_TOPIC", default_commands_topic)
        mqtt_status_topic = _env_str("MQTT_STATUS_TOPIC", default_status_topic)

        return cls(
            mqtt_host=_env_str("MQTT_HOST", "127.0.0.1"),
            mqtt_port=_env_int("MQTT_PORT", 1883, minimum=1, maximum=65535),
            mqtt_username=_env_str("MQTT_USERNAME", ""),
            mqtt_password=_env_str("MQTT_PASSWORD", ""),
            mqtt_topic=mqtt_telemetry_topic,
            mqtt_events_topic=mqtt_events_topic,
            mqtt_commands_topic=mqtt_commands_topic,
            mqtt_status_topic=mqtt_status_topic,
            mqtt_keepalive=_env_int("SIM_MQTT_KEEPALIVE_S", 60, minimum=5, maximum=600),
            mqtt_qos=_env_int("SIM_MQTT_QOS", 1, minimum=0, maximum=2),
            mqtt_publish_timeout_s=_env_float("SIM_MQTT_PUBLISH_TIMEOUT_S", 5.0,
                                              minimum=0.5, maximum=60.0),
            thing_id=thing_id,
            instance_id=_env_str("SIM_INSTANCE_ID", uuid.uuid4().hex[:8]),
            publish_interval_s=publish_interval_s,
            physics_step_s=physics_step_s,
            num_floors=num_floors,
            lobby_floor=lobby_floor,
            floor_height_m=_env_float("SIM_FLOOR_HEIGHT_M", 3.0,
                                      minimum=2.0, maximum=10.0),
            max_speed_ms=_env_float("SIM_MAX_SPEED_MS", 1.8,
                                    minimum=0.1, maximum=10.0),
            accel_ms2=_env_float("SIM_ACCEL_MS2", 0.6, minimum=0.05, maximum=10.0),
            decel_ms2=_env_float("SIM_DECEL_MS2", 0.6, minimum=0.05, maximum=10.0),
            door_open_dwell_s=_env_float("SIM_DOOR_OPEN_DWELL_S", 4.0,
                                         minimum=0.5, maximum=120.0),
            door_travel_s=_env_float("SIM_DOOR_TRAVEL_S", 2.0,
                                     minimum=0.2, maximum=60.0),
            max_load_kg=_env_float("SIM_MAX_LOAD_KG", 800.0,
                                   minimum=50.0, maximum=10000.0),
            overload_threshold=_env_float("SIM_OVERLOAD_THRESHOLD", 0.95,
                                          minimum=0.5, maximum=1.5),
            motor_idle_temp_c=_env_float("SIM_MOTOR_IDLE_TEMP_C", 25.0,
                                         minimum=-20.0, maximum=80.0),
            motor_max_temp_c=_env_float("SIM_MOTOR_MAX_TEMP_C", 95.0,
                                        minimum=40.0, maximum=200.0),
            motor_heat_rate_c_per_s=_env_float("SIM_MOTOR_HEAT_RATE_C_PER_S", 0.30,
                                               minimum=0.0, maximum=20.0),
            motor_cool_rate_c_per_s=_env_float("SIM_MOTOR_COOL_RATE_C_PER_S", 0.15,
                                               minimum=0.0, maximum=20.0),
            motor_design_life_h=_env_float("SIM_MOTOR_DESIGN_LIFE_H", 10000.0,
                                           minimum=100.0, maximum=1_000_000.0),
            vibration_baseline_g=_env_float("SIM_VIBRATION_BASELINE_G", 0.05,
                                            minimum=0.001, maximum=1.0),
            anomaly_profile=anomaly_profile,
            anomaly_rates=dict(ANOMALY_PROFILES[anomaly_profile]),
            emergency_auto_clear=_env_bool("SIM_EMERGENCY_AUTO_CLEAR", False),
            demo_auto_clear_s=_env_float("SIM_DEMO_AUTO_CLEAR_S", 90.0,
                                         minimum=1.0, maximum=86400.0),
            random_seed=_env_optional_int("SIM_RANDOM_SEED"),
            runtime_dir=runtime_dir,
            health_file=health_file,
            snapshot_file=snapshot_file,
            log_level=_env_str("SIM_LOG_LEVEL", "INFO"),
        )


# ──────────────────────────────────────────────────────────────────────────────
# STATE MACHINE ENUMS
# ──────────────────────────────────────────────────────────────────────────────
class ElevatorPhase(Enum):
    IDLE = auto()
    DOOR_CLOSING = auto()
    ACCELERATING = auto()
    CRUISING = auto()
    DECELERATING = auto()
    DOOR_OPENING = auto()
    DOOR_DWELL = auto()
    EMERGENCY = auto()
    MAINTENANCE = auto()


class Direction(str, Enum):
    UP = "UP"
    DOWN = "DOWN"
    IDLE = "IDLE"


class DoorState(str, Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    OPENING = "OPENING"
    CLOSING = "CLOSING"
    BLOCKED = "BLOCKED"


class HealthStatus(str, Enum):
    GOOD = "GOOD"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class AlertLevel(str, Enum):
    NORMAL = "NORMAL"
    CAUTION = "CAUTION"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SecurityState(str, Enum):
    NORMAL = "NORMAL"
    WATCH = "WATCH"
    SUSPICIOUS = "SUSPICIOUS"
    HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED"
    LOCKDOWN = "LOCKDOWN"


# ──────────────────────────────────────────────────────────────────────────────
# DISPATCH POLICY STATE (device-side)
# ──────────────────────────────────────────────────────────────────────────────
# The AI-Adaptive Dispatch engine (Brain A) picks a policy and the safety gate
# forwards it as a DISPATCH_POLICY command. The simulator plays the role of the
# ESP32 firmware: it ACCEPTS the policy params and tunes its EXISTING dispatcher
# and motion profile accordingly. It never weakens a safety path — overrides
# (fire / e-stop / overload) are handled by the physics/anomaly engine, not here.
#
# Field names mirror packages/shared/dispatch DEFAULT_PARAMS so the same object
# round-trips from the engine to the device unchanged.
@dataclass
class DispatchPolicyState:
    policy_id: str = "SCAN_COLLECTIVE"
    park_floor: Optional[int] = None       # idle parking target (e.g. lobby for UP_PEAK)
    direction_bias: int = 0                # -1 down, 0 none, +1 up
    accel_profile: str = "NORMAL"          # GENTLE | NORMAL
    speed_cap_ms: Optional[float] = None   # cap on cruising speed
    dwell_ms: int = 5000                   # door dwell (longer for ECO/HEALTH)
    grace_ms: int = 1200
    deep_idle: bool = False
    force_fan: bool = False
    restrict_floors: bool = False          # SECURITY_RESTRICTED: serve only the park/lobby floor
    applied_at: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# INCIDENT LOG
# ──────────────────────────────────────────────────────────────────────────────
@dataclass
class Incident:
    incident_id: str
    ts: str
    type: str
    description: str
    resolved: bool = False
    resolved_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "incident_id": self.incident_id,
            "ts": self.ts,
            "type": self.type,
            "description": self.description,
            "resolved": self.resolved,
            "resolved_at": self.resolved_at,
        }


# ──────────────────────────────────────────────────────────────────────────────
# PHYSICS STATE MACHINE
# ──────────────────────────────────────────────────────────────────────────────
class ElevatorPhysics:
    """Multi-phase elevator physics with sub-step integration."""

    LATCHING_INCIDENT_TYPES = frozenset({
        "EMERGENCY_STOP", "FORCED_ENTRY", "DISTRESS_AUDIO",
        "FREE_FALL_VIBRATION", "STUCK_BETWEEN_FLOORS",
    })

    def __init__(self, cfg: SimConfig, rng: random.Random) -> None:
        self.cfg = cfg
        self.rng = rng

        # Position / motion
        self.current_floor: int = cfg.lobby_floor
        self.target_floor: int = cfg.lobby_floor
        self.position_m: float = float(cfg.lobby_floor * cfg.floor_height_m)
        self.speed_ms: float = 0.0
        self.direction: Direction = Direction.IDLE

        # Phase / doors
        self.phase: ElevatorPhase = ElevatorPhase.IDLE
        self.door_state: DoorState = DoorState.OPEN
        self.door_timer_s: float = cfg.door_open_dwell_s
        self.door_obstruction: bool = False
        self.door_blocked: bool = False
        self.door_force_sensor_n: float = 0.0
        self.door_cycle_count: int = 0
        self.door_obstruction_events: int = 0

        # Cabin
        self.load_kg: float = 0.0
        self.cabin_temp_c: float = 22.0
        self.emergency_stop: bool = False
        self.between_floors: bool = False
        self.trips_today: int = 0

        # Motor / mechanical
        self.vibration_level: float = cfg.vibration_baseline_g
        self.motor_temp_c: float = cfg.motor_idle_temp_c
        self.hours_operated: float = self.rng.uniform(800.0, 2500.0)
        self.motor_health: HealthStatus = HealthStatus.GOOD
        self.current_draw_a: float = 0.0
        self.power_kw: float = 0.0
        self.energy_kwh_today: float = 0.0

        # Security
        self.audio_distress: bool = False
        self.forced_entry: bool = False
        self.unauth_attempts: int = 0
        self.rfid_last_card: str = ""
        self.rfid_access_granted: bool = True
        self.alert_level: AlertLevel = AlertLevel.NORMAL
        self.security_state: SecurityState = SecurityState.NORMAL

        # Incidents
        self.incidents: list[Incident] = []
        self._incident_counter: int = 0

        # Dispatch policy (device-side, set by the AI engine via DISPATCH_POLICY)
        self.dispatch: DispatchPolicyState = DispatchPolicyState()

        # Internal
        self._call_queue: list[int] = []
        self._time_in_phase_s: float = 0.0
        self._time_in_emergency_s: float = 0.0
        self._latched_security_s: dict[str, float] = {}
        self._last_arrival_floor: int = cfg.lobby_floor

        log.info(
            "Physics engine initialised | Floor: %d | Motor hours: %.1fh | Profile: %s",
            self.current_floor, self.hours_operated, cfg.anomaly_profile,
        )

    # ── Public API ─────────────────────────────────────────────────────────

    def tick(self, dt: float) -> None:
        """Advance the simulation by `dt` real-time seconds."""
        if dt <= 0:
            return

        # Sub-step integration: advance physics in fixed small slices so
        # the configured publish interval cannot cause floor overshoot or
        # impossible single-frame motion.
        steps = max(1, math.ceil(dt / self.cfg.physics_step_s))
        sub_dt = dt / steps
        for _ in range(steps):
            self._sub_tick(sub_dt)

        self._update_motor_thermal(dt)
        self._update_motor_health()
        self._update_derived_metrics(dt)
        self._maybe_demo_auto_clear(dt)

    def request_emergency_stop(self, reason: str = "manual") -> None:
        if not self.emergency_stop:
            self.emergency_stop = True
            self.alert_level = AlertLevel.CRITICAL
            self._latched_security_s["EMERGENCY_STOP"] = 0.0
            self._log_incident("EMERGENCY_STOP", f"Emergency stop: {reason}")
            log.warning("EMERGENCY STOP -- %s", reason)

    def clear_emergency(self, reason: str = "operator_acknowledged") -> None:
        if self.emergency_stop:
            self.emergency_stop = False
            self._time_in_emergency_s = 0.0
            self._resolve_incidents_of_type("EMERGENCY_STOP", reason)
            self._latched_security_s.pop("EMERGENCY_STOP", None)
            log.info("Emergency cleared: %s", reason)
        if self.phase == ElevatorPhase.EMERGENCY:
            self._transition(ElevatorPhase.IDLE)
        self.alert_level = AlertLevel.NORMAL
        self.security_state = SecurityState.NORMAL

    def acknowledge_security_incident(self) -> None:
        """Manual operator acknowledgement of latched safety/security flags."""
        self.forced_entry = False
        self.audio_distress = False
        self.security_state = SecurityState.NORMAL
        self.alert_level = AlertLevel.NORMAL
        for kind in ("FORCED_ENTRY", "DISTRESS_AUDIO"):
            self._resolve_incidents_of_type(kind, "operator_acknowledged")
            self._latched_security_s.pop(kind, None)

    def apply_dispatch_policy(self, policy_id: str, params: Optional[dict] = None) -> None:
        """Adopt a dispatch policy from the AI engine. Tunes dispatch + motion
        profile only; safety paths are untouched. Tolerant of partial params."""
        params = params or {}
        d = self.dispatch
        d.policy_id = str(policy_id or "SCAN_COLLECTIVE").upper()

        pf = params.get("park_floor", None)
        d.park_floor = (max(0, min(self.cfg.num_floors - 1, int(pf)))
                        if pf is not None else None)
        d.direction_bias = int(params.get("direction_bias", 0) or 0)
        d.accel_profile = str(params.get("accel_profile", "NORMAL")).upper()
        sc = params.get("speed_cap_ms", None)
        d.speed_cap_ms = float(sc) if sc else None
        d.dwell_ms = int(params.get("dwell_ms", 5000) or 5000)
        d.grace_ms = int(params.get("grace_ms", 1200) or 1200)
        d.deep_idle = bool(params.get("deep_idle", False))
        d.force_fan = bool(params.get("force_fan", False))
        d.restrict_floors = bool(params.get("restrict_floors", False))
        d.applied_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        log.info("Dispatch policy adopted: %s | park=%s bias=%+d accel=%s cap=%s dwell=%dms restrict=%s",
                 d.policy_id, d.park_floor, d.direction_bias, d.accel_profile,
                 d.speed_cap_ms, d.dwell_ms, d.restrict_floors)

    # ── Effective motion parameters (policy-modulated) ──────────────────────

    def _eff_max_speed(self) -> float:
        cap = self.dispatch.speed_cap_ms
        return min(self.cfg.max_speed_ms, cap) if cap else self.cfg.max_speed_ms

    def _eff_accel(self) -> float:
        scale = 0.5 if self.dispatch.accel_profile == "GENTLE" else 1.0
        return self.cfg.accel_ms2 * scale

    def _eff_decel(self) -> float:
        scale = 0.5 if self.dispatch.accel_profile == "GENTLE" else 1.0
        return self.cfg.decel_ms2 * scale

    def _eff_dwell(self) -> float:
        # Policy dwell_ms is relative to the 5000ms baseline; scale the
        # configured door dwell so ECO/HEALTH visibly hold doors longer.
        return self.cfg.door_open_dwell_s * (self.dispatch.dwell_ms / 5000.0)

    # ── Sub-tick dispatcher ────────────────────────────────────────────────

    def _sub_tick(self, dt: float) -> None:
        self._time_in_phase_s += dt
        self._maybe_queue_call()

        if self.emergency_stop and self.phase != ElevatorPhase.EMERGENCY:
            self._enter_emergency()
            return

        dispatch = {
            ElevatorPhase.IDLE:         self._phase_idle,
            ElevatorPhase.DOOR_CLOSING: self._phase_door_closing,
            ElevatorPhase.ACCELERATING: self._phase_accelerating,
            ElevatorPhase.CRUISING:     self._phase_cruising,
            ElevatorPhase.DECELERATING: self._phase_decelerating,
            ElevatorPhase.DOOR_OPENING: self._phase_door_opening,
            ElevatorPhase.DOOR_DWELL:   self._phase_door_dwell,
            ElevatorPhase.EMERGENCY:    self._phase_emergency,
            ElevatorPhase.MAINTENANCE:  self._phase_maintenance,
        }
        dispatch[self.phase](dt)

    # ── Phase handlers ─────────────────────────────────────────────────────

    def _phase_idle(self, dt: float) -> None:
        self.speed_ms = 0.0
        self.direction = Direction.IDLE
        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g, 0.002)
        if self._time_in_phase_s <= dt:  # just entered IDLE
            self.door_state = DoorState.OPEN
            self.door_timer_s = self._eff_dwell()
            self._set_load_at_stop()
        self.door_timer_s -= dt
        if self.door_timer_s <= 0:
            if self._has_pending_call():
                self._pick_next_target()
                self._transition(ElevatorPhase.DOOR_CLOSING)
            elif self._should_park():
                # Policy-driven repositioning: e.g. UP_PEAK returns the empty
                # car to the lobby; DOWN_PEAK parks high to anticipate egress.
                self._begin_parking()
                self._transition(ElevatorPhase.DOOR_CLOSING)

    def _phase_door_closing(self, dt: float) -> None:
        self.door_state = DoorState.CLOSING
        self.speed_ms = 0.0
        if self.door_obstruction:
            self.door_state = DoorState.BLOCKED
            self.door_blocked = True
            self.door_obstruction_events += 1
            self.door_timer_s = self.cfg.door_open_dwell_s
            self._transition(ElevatorPhase.DOOR_OPENING)
            self._log_incident("DOOR_OBSTRUCTION", "Door blocked while closing")
            return
        self.door_timer_s -= dt
        if self.door_timer_s <= 0:
            self.door_state = DoorState.CLOSED
            self.door_blocked = False
            self.door_cycle_count += 1
            self._set_load_at_stop()
            self._transition(ElevatorPhase.ACCELERATING)

    def _phase_accelerating(self, dt: float) -> None:
        self.door_state = DoorState.CLOSED
        eff_max = self._eff_max_speed()
        self.speed_ms = min(self.speed_ms + self._eff_accel() * dt, eff_max)
        self._update_position(dt)
        self.vibration_level = (self._jitter(self.cfg.vibration_baseline_g * 1.4, 0.012)
                                + (self.speed_ms / self.cfg.max_speed_ms) * 0.04)
        if self.speed_ms >= eff_max - 1e-6:
            self._transition(ElevatorPhase.CRUISING)
        self._check_arrival()

    def _phase_cruising(self, dt: float) -> None:
        self.speed_ms = self._eff_max_speed()
        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g * 1.2, 0.010)
        self._update_position(dt)
        self._check_arrival()

    def _phase_decelerating(self, dt: float) -> None:
        # Reduce speed, then move at the average speed of this slice — and
        # never advance past the target floor's coordinate.
        prev_speed = self.speed_ms
        self.speed_ms = max(0.0, self.speed_ms - self._eff_decel() * dt)
        avg_speed = (prev_speed + self.speed_ms) / 2.0
        delta = avg_speed * dt

        target_pos = self.target_floor * self.cfg.floor_height_m
        if self.direction == Direction.UP:
            self.position_m = min(self.position_m + delta, target_pos)
        elif self.direction == Direction.DOWN:
            self.position_m = max(self.position_m - delta, target_pos)
        self._update_floor_from_position()

        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g * 1.05, 0.010)

        arrived = abs(self.position_m - target_pos) < 1e-3 or self.speed_ms <= 1e-3
        if arrived:
            self._snap_to_floor()
            self._transition(ElevatorPhase.DOOR_OPENING)

    def _phase_door_opening(self, dt: float) -> None:
        self.speed_ms = 0.0
        self.door_state = DoorState.OPENING
        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g, 0.002)
        self.door_timer_s -= dt
        if self.door_timer_s <= 0:
            self.door_state = DoorState.OPEN
            self.door_blocked = False
            self.door_cycle_count += 1
            self._transition(ElevatorPhase.DOOR_DWELL)

    def _phase_door_dwell(self, dt: float) -> None:
        self.door_state = DoorState.OPEN
        self.speed_ms = 0.0
        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g, 0.002)
        self.door_timer_s -= dt
        if self.door_timer_s <= 0:
            if self._has_pending_call():
                self._pick_next_target()
                self._transition(ElevatorPhase.DOOR_CLOSING)
            else:
                self.load_kg = max(0.0, self.load_kg * 0.0)  # everyone leaves
                self._transition(ElevatorPhase.IDLE)

    def _phase_emergency(self, dt: float) -> None:
        self.speed_ms = 0.0
        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g * 0.7, 0.001)
        self.direction = Direction.IDLE
        self._time_in_emergency_s += dt
        # Auto-clear ONLY when explicitly enabled (academic demos).
        if (self.cfg.emergency_auto_clear
                and self._time_in_emergency_s >= self.cfg.demo_auto_clear_s):
            self.clear_emergency("demo_auto_clear")

    def _phase_maintenance(self, dt: float) -> None:
        self.speed_ms = 0.0
        self.vibration_level = self._jitter(self.cfg.vibration_baseline_g * 1.5, 0.003)
        self.direction = Direction.IDLE

    # ── Helpers ────────────────────────────────────────────────────────────

    def _update_position(self, dt: float) -> None:
        delta = self.speed_ms * dt
        if self.direction == Direction.UP:
            self.position_m += delta
        elif self.direction == Direction.DOWN:
            self.position_m -= delta
        self._update_floor_from_position()

    def _update_floor_from_position(self) -> None:
        height = self.cfg.floor_height_m
        floor = round(self.position_m / height)
        floor = max(0, min(self.cfg.num_floors - 1, floor))
        self.current_floor = floor
        # between_floors is true if we're more than ~5cm off a level coordinate
        self.between_floors = abs(self.position_m - floor * height) > 0.05

    def _check_arrival(self) -> None:
        target_pos = self.target_floor * self.cfg.floor_height_m
        dist_remaining = abs(target_pos - self.position_m)
        braking_distance = (self.speed_ms ** 2) / (2 * max(self._eff_decel(), 1e-6))
        if dist_remaining <= braking_distance + 0.05:
            if self.phase in (ElevatorPhase.CRUISING, ElevatorPhase.ACCELERATING):
                self._transition(ElevatorPhase.DECELERATING)

    def _snap_to_floor(self) -> None:
        self.current_floor = self.target_floor
        self.position_m = float(self.target_floor * self.cfg.floor_height_m)
        self.speed_ms = 0.0
        self.between_floors = False
        # Increment lifetime hours by the time it took to traverse one floor at max speed.
        self.hours_operated += (self.cfg.floor_height_m / self.cfg.max_speed_ms) / 3600.0
        if self.current_floor != self._last_arrival_floor:
            self.trips_today += 1
            self._last_arrival_floor = self.current_floor
        log.info("  -> Arrived at floor %d (trips_today=%d)",
                 self.current_floor, self.trips_today)

    def _update_motor_thermal(self, dt: float) -> None:
        moving = self.phase in (ElevatorPhase.ACCELERATING,
                                ElevatorPhase.CRUISING,
                                ElevatorPhase.DECELERATING)
        if moving:
            load_factor = 1.0 + (self.load_kg / self.cfg.max_load_kg) * 0.5
            self.motor_temp_c += self.cfg.motor_heat_rate_c_per_s * load_factor * dt
        else:
            self.motor_temp_c -= self.cfg.motor_cool_rate_c_per_s * dt

        self.motor_temp_c = max(self.cfg.motor_idle_temp_c,
                                min(self.cfg.motor_max_temp_c, self.motor_temp_c))
        self.cabin_temp_c = (22.0
                             + (self.motor_temp_c - self.cfg.motor_idle_temp_c) * 0.04
                             + self.rng.uniform(-0.15, 0.15))
        self.cabin_temp_c = round(self.cabin_temp_c, 1)

    def _update_motor_health(self) -> None:
        ratio = self.vibration_level / max(self.cfg.vibration_baseline_g, 1e-6)
        if ratio > 5.0 or self.motor_temp_c > 88:
            self.motor_health = HealthStatus.CRITICAL
        elif ratio > 2.5 or self.motor_temp_c > 72:
            self.motor_health = HealthStatus.WARNING
        else:
            self.motor_health = HealthStatus.GOOD

    def _update_derived_metrics(self, dt: float) -> None:
        # Current draw scales with speed and load. Idle ~ 1A, full-load cruising ~ 40A.
        moving_factor = (self.speed_ms / max(self.cfg.max_speed_ms, 1e-6))
        load_factor = (self.load_kg / max(self.cfg.max_load_kg, 1e-6))
        thermal_factor = max(0.0, (self.motor_temp_c - self.cfg.motor_idle_temp_c)
                             / max(self.cfg.motor_max_temp_c - self.cfg.motor_idle_temp_c,
                                   1e-6))
        # 1 A baseline + up to 35 A driven by motion/load + small thermal-derate term.
        self.current_draw_a = round(1.0 + 35.0 * moving_factor * (0.6 + 0.6 * load_factor)
                                    + 5.0 * thermal_factor, 2)
        # P (kW) = V (≈400V three-phase) × I × √3 × pf (~0.85), simplified to a
        # constant factor so n8n's HIGH_POWER_USAGE flag fires at ~12 kW.
        self.power_kw = round(self.current_draw_a * 0.42, 2)
        self.energy_kwh_today += (self.power_kw * dt) / 3600.0

        # Door force sensor: small noise when closed/open, larger when blocked.
        if self.door_blocked or self.door_obstruction:
            self.door_force_sensor_n = round(self.rng.uniform(80.0, 180.0), 1)
        elif self.door_state in (DoorState.CLOSING, DoorState.OPENING):
            self.door_force_sensor_n = round(self.rng.uniform(20.0, 45.0), 1)
        else:
            self.door_force_sensor_n = round(self.rng.uniform(0.0, 8.0), 1)

        # Security state derived from current latched flags.
        if self.forced_entry and self.audio_distress:
            self.security_state = SecurityState.LOCKDOWN
        elif self.forced_entry or self.audio_distress:
            self.security_state = SecurityState.HUMAN_REVIEW_REQUIRED
        elif self.unauth_attempts >= 3:
            self.security_state = SecurityState.SUSPICIOUS
        elif self.unauth_attempts >= 1:
            self.security_state = SecurityState.WATCH
        else:
            self.security_state = SecurityState.NORMAL

    def _maybe_demo_auto_clear(self, dt: float) -> None:
        """Time-bounded demo clears for FORCED_ENTRY and DISTRESS_AUDIO when configured."""
        if not self.cfg.emergency_auto_clear:
            # We reuse the same opt-in flag for all demo auto-clears so the
            # 'safe by default' rule applies everywhere.
            return

        for kind in list(self._latched_security_s.keys()):
            if kind == "EMERGENCY_STOP":
                continue
            self._latched_security_s[kind] = self._latched_security_s.get(kind, 0.0) + dt
            if self._latched_security_s[kind] >= self.cfg.demo_auto_clear_s:
                if kind == "FORCED_ENTRY":
                    self.forced_entry = False
                elif kind == "DISTRESS_AUDIO":
                    self.audio_distress = False
                self._resolve_incidents_of_type(kind, "demo_auto_clear")
                self._latched_security_s.pop(kind, None)

    def _transition(self, new_phase: ElevatorPhase) -> None:
        log.debug("  Phase: %s -> %s", self.phase.name, new_phase.name)
        self.phase = new_phase
        self._time_in_phase_s = 0.0
        if new_phase in (ElevatorPhase.DOOR_CLOSING, ElevatorPhase.DOOR_OPENING):
            self.door_timer_s = self.cfg.door_travel_s
        elif new_phase in (ElevatorPhase.IDLE, ElevatorPhase.DOOR_DWELL):
            self.door_timer_s = self._eff_dwell()

    def _enter_emergency(self) -> None:
        self.speed_ms = 0.0
        self.alert_level = AlertLevel.CRITICAL
        self._transition(ElevatorPhase.EMERGENCY)

    def _maybe_queue_call(self) -> None:
        if self.rng.random() < 0.05 and len(self._call_queue) < 3:
            floor = self.rng.randint(0, self.cfg.num_floors - 1)
            if floor != self.current_floor and floor not in self._call_queue:
                self._call_queue.append(floor)

    def _has_pending_call(self) -> bool:
        return bool(self._call_queue)

    def _should_park(self) -> bool:
        pf = self.dispatch.park_floor
        return pf is not None and self.current_floor != pf

    def _begin_parking(self) -> None:
        pf = self.dispatch.park_floor
        self.target_floor = pf
        self.direction = Direction.UP if pf > self.current_floor else Direction.DOWN
        log.info("  parking -> Floor %d [%s] (policy %s)",
                 pf, self.direction.value, self.dispatch.policy_id)

    def _pick_next_target(self) -> None:
        if not self._call_queue:
            return
        # SECURITY_RESTRICTED: only the authorised (park/lobby) floor is served;
        # calls to other floors are dropped (denied), matching restricted mode.
        if self.dispatch.restrict_floors:
            allowed = (self.dispatch.park_floor
                       if self.dispatch.park_floor is not None else self.cfg.lobby_floor)
            self._call_queue = [f for f in self._call_queue if f == allowed]
            self.target_floor = allowed
            self.direction = (Direction.UP if allowed > self.current_floor
                              else Direction.DOWN if allowed < self.current_floor
                              else Direction.IDLE)
            if allowed in self._call_queue:
                self._call_queue.remove(allowed)
            return
        above = [f for f in self._call_queue if f > self.current_floor]
        below = [f for f in self._call_queue if f < self.current_floor]
        bias = self.dispatch.direction_bias
        if self.direction == Direction.UP and above:
            self.target_floor = min(above)
        elif self.direction == Direction.DOWN and below:
            self.target_floor = max(below)
        # Policy direction bias breaks ties when the car is idle: UP_PEAK serves
        # upward calls first, DOWN_PEAK downward, before the default fallback.
        elif bias > 0 and above:
            self.target_floor = min(above)
        elif bias < 0 and below:
            self.target_floor = max(below)
        elif above:
            self.target_floor = min(above)
        elif below:
            self.target_floor = max(below)
        else:
            self.target_floor = self._call_queue[0]
        if self.target_floor in self._call_queue:
            self._call_queue.remove(self.target_floor)
        self.direction = (Direction.UP if self.target_floor > self.current_floor
                          else Direction.DOWN)
        log.info("  call -> Floor %d [%s] | Queue: %s",
                 self.target_floor, self.direction.value, self._call_queue)

    def _set_load_at_stop(self) -> None:
        load = self.rng.choices(
            [0, 65, 130, 195, 260, 390, 520, 680],
            weights=[20, 15, 15, 15, 12, 10, 8, 5],
        )[0]
        # Clamp to non-negative and a small safety margin above max_load_kg.
        jittered = load + self.rng.uniform(-10.0, 10.0)
        self.load_kg = max(0.0, min(self.cfg.max_load_kg * 1.5, jittered))

    def _log_incident(self, incident_type: str, description: str) -> None:
        self._incident_counter += 1
        inc = Incident(
            incident_id=f"INC-{self._incident_counter:05d}",
            ts=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            type=incident_type,
            description=description,
        )
        self.incidents.append(inc)
        self.incidents = self.incidents[-50:]
        if incident_type in self.LATCHING_INCIDENT_TYPES:
            self._latched_security_s.setdefault(incident_type, 0.0)

    def _resolve_incidents_of_type(self, kind: str, reason: str) -> None:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for inc in self.incidents:
            if inc.type == kind and not inc.resolved:
                inc.resolved = True
                inc.resolved_at = ts
                inc.description = f"{inc.description} (resolved: {reason})"

    def _jitter(self, base: float, sigma: float) -> float:
        return max(0.0, round(self.rng.gauss(base, sigma), 4))


# ──────────────────────────────────────────────────────────────────────────────
# ANOMALY INJECTOR
# ──────────────────────────────────────────────────────────────────────────────
class AnomalyInjector:
    """Per-second rate-driven anomaly engine."""

    def __init__(self, physics: ElevatorPhysics, cfg: SimConfig,
                 rng: random.Random) -> None:
        self.phy = physics
        self.cfg = cfg
        self.rng = rng
        # Active duration tracking (seconds remaining).
        self._active: dict[str, float] = {}
        # Anomalies that should auto-clear at all only outside SAFETY-LATCH set.
        self._unauth_pool = [f"UNKNOWN_{self.rng.randint(1000, 9999)}" for _ in range(8)]

    def roll(self, dt: float) -> list[str]:
        triggered: list[str] = []
        for name, rate in self.cfg.anomaly_rates.items():
            base_rate = rate
            if name in self._active:
                # Strongly suppress re-roll while still active.
                base_rate *= 0.05
            # Poisson approximation: P(at least 1 event in dt) = 1 - e^(-rate*dt).
            prob = 1.0 - math.exp(-base_rate * dt)
            if self.rng.random() < prob:
                if self._apply(name):
                    triggered.append(name)

        # Tick down active durations.
        expired = []
        for name in list(self._active.keys()):
            self._active[name] -= dt
            if self._active[name] <= 0:
                expired.append(name)
        for name in expired:
            self._clear(name)
            self._active.pop(name, None)
        return triggered

    def _apply(self, name: str) -> bool:
        phy = self.phy
        if name == "forced_door":
            phy.forced_entry = True
            phy.alert_level = AlertLevel.CRITICAL
            phy.door_state = DoorState.BLOCKED
            phy.door_blocked = True
            phy._log_incident("FORCED_ENTRY",
                              "Door forced entry detected by reed switch")
            # Latches; demo auto-clear governs duration if enabled.
            self._active[name] = float("inf")
            log.warning("ANOMALY: forced door entry")
            return True

        if name == "unauthorized_rfid":
            card = self.rng.choice(self._unauth_pool)
            phy.rfid_last_card = card
            phy.rfid_access_granted = False
            phy.unauth_attempts += 1
            if phy.unauth_attempts >= 3:
                phy.alert_level = AlertLevel.HIGH
            phy._log_incident("UNAUTHORIZED_RFID",
                              f"Card {card} denied -- not in whitelist")
            self._active[name] = 1.5
            log.warning("ANOMALY: unauthorized RFID (%s)", card)
            return True

        if name == "motor_vibration_spike":
            phy.vibration_level = round(self.rng.uniform(0.18, 0.45), 4)
            phy.motor_health = HealthStatus.WARNING
            phy._log_incident("VIBRATION_SPIKE",
                              f"Vibration spike: {phy.vibration_level}g")
            self._active[name] = 6.0
            log.warning("ANOMALY: vibration spike %.3fg", phy.vibration_level)
            return True

        if name == "audio_distress":
            phy.audio_distress = True
            phy.alert_level = AlertLevel.CRITICAL
            phy._log_incident("DISTRESS_AUDIO",
                              "Passenger distress audio detected by MEMS mic")
            self._active[name] = float("inf")
            log.warning("ANOMALY: audio distress detected")
            return True

        if name == "emergency_button":
            phy.request_emergency_stop("Emergency button pressed by passenger")
            self._active[name] = float("inf")
            log.warning("ANOMALY: emergency button pressed")
            return True

        if name == "overload":
            phy.load_kg = self.cfg.max_load_kg * self.rng.uniform(1.02, 1.15)
            phy.alert_level = AlertLevel.HIGH
            phy._log_incident("OVERLOAD",
                              f"Cabin overloaded: {phy.load_kg:.0f}kg "
                              f"> {self.cfg.max_load_kg:.0f}kg")
            self._active[name] = 6.0
            log.warning("ANOMALY: overload %.0fkg", phy.load_kg)
            return True

        if name == "door_obstruction":
            if phy.phase in (ElevatorPhase.DOOR_CLOSING,
                             ElevatorPhase.IDLE,
                             ElevatorPhase.DOOR_DWELL):
                phy.door_obstruction = True
                phy.door_state = DoorState.BLOCKED
                phy.door_blocked = True
                phy.door_obstruction_events += 1
                phy._log_incident("DOOR_OBSTRUCTION",
                                  "Door blocked by foreign object")
                self._active[name] = 6.0
                log.warning("ANOMALY: door obstruction")
                return True
            return False

        if name == "motor_overheat":
            phy.motor_temp_c = min(self.cfg.motor_max_temp_c,
                                   phy.motor_temp_c + self.rng.uniform(15.0, 25.0))
            phy.motor_health = HealthStatus.CRITICAL
            phy._log_incident("MOTOR_OVERHEAT",
                              f"Motor temperature critical: "
                              f"{phy.motor_temp_c:.1f}°C")
            self._active[name] = 15.0
            log.warning("ANOMALY: motor overheat %.1fC", phy.motor_temp_c)
            return True

        if name == "power_fluctuation":
            phy.cabin_temp_c += self.rng.uniform(1.5, 4.0)
            phy.vibration_level += self.rng.uniform(0.02, 0.05)
            phy._log_incident("POWER_FLUCTUATION",
                              "Voltage fluctuation detected")
            self._active[name] = 3.0
            log.warning("ANOMALY: power fluctuation")
            return True

        if name == "rfid_reader_fault":
            phy.rfid_last_card = "ERR_HARDWARE"
            phy.rfid_access_granted = False
            phy._log_incident("RFID_FAULT", "RC522 reader hardware fault")
            self._active[name] = 6.0
            log.warning("ANOMALY: RFID reader hardware fault")
            return True

        if name == "free_fall_vibration":
            phy.vibration_level = round(self.rng.uniform(0.50, 0.95), 4)
            phy.motor_health = HealthStatus.CRITICAL
            phy.alert_level = AlertLevel.CRITICAL
            phy.request_emergency_stop("Extreme vibration -- possible cable fault")
            phy._log_incident("FREE_FALL_VIBRATION",
                              f"Extreme vibration: {phy.vibration_level}g")
            self._active[name] = float("inf")
            log.warning("ANOMALY: free-fall vibration %.3fg -- E-STOP",
                        phy.vibration_level)
            return True

        if name == "stuck_between_floors":
            if phy.phase in (ElevatorPhase.CRUISING, ElevatorPhase.ACCELERATING):
                phy.request_emergency_stop("Elevator stuck between floors -- encoder fault")
                phy._log_incident("STUCK_BETWEEN_FLOORS",
                                  "Elevator halted mid-shaft")
                self._active[name] = float("inf")
                log.warning("ANOMALY: stuck between floors")
                return True
            return False

        return False

    def _clear(self, name: str) -> None:
        phy = self.phy
        if name == "door_obstruction":
            phy.door_obstruction = False
            phy.door_blocked = False
        elif name in ("motor_vibration_spike",):
            phy.vibration_level = self.cfg.vibration_baseline_g
        elif name == "overload":
            phy._set_load_at_stop()
        # forced_door, audio_distress, emergency_button, free_fall_vibration,
        # stuck_between_floors are LATCHED -- only manual ack or demo auto-clear
        # resolves them. We do not touch them here.


# ──────────────────────────────────────────────────────────────────────────────
# DITTO PAYLOAD BUILDER
# ──────────────────────────────────────────────────────────────────────────────
def build_ditto_payload(phy: ElevatorPhysics, cfg: SimConfig) -> dict:
    """Eclipse Ditto Protocol envelope. Field names match the bridge + n8n agents."""
    door_str = phy.door_state.value
    alert_str = phy.alert_level.value

    feature_value = {
        "cabin": {
            "properties": {
                "current_floor":     phy.current_floor,
                "target_floor":      phy.target_floor,
                "direction":         phy.direction.value,
                "load_kg":           round(phy.load_kg, 1),
                "max_load_kg":       round(cfg.max_load_kg, 1),
                "payload_weight_kg": round(phy.load_kg, 1),  # bridge alias
                "temperature_c":     phy.cabin_temp_c,
                "speed_ms":          round(phy.speed_ms, 3),
                "emergency_stop":    phy.emergency_stop,
                "between_floors":    phy.between_floors,
                "trips_today":       phy.trips_today,
            }
        },
        "door": {
            "properties": {
                "state":              door_str,
                "door_forced_entry":  phy.forced_entry,
                "forced_entry":       phy.forced_entry,        # n8n alias
                "blocked":            phy.door_blocked,
                "cycle_count":        phy.door_cycle_count,
                "obstruction_events": phy.door_obstruction_events,
                "force_sensor_n":     phy.door_force_sensor_n,
            }
        },
        "motor": {
            "properties": {
                "vibration_level":      round(phy.vibration_level, 4),
                "vibration_g":          round(phy.vibration_level, 4),  # n8n alias
                "vibration_baseline_g": round(cfg.vibration_baseline_g, 4),
                "hours_operated":       round(phy.hours_operated, 2),
                "health_status":        phy.motor_health.value,
                "temperature_c":        round(phy.motor_temp_c, 1),
                "current_draw_a":       round(phy.current_draw_a, 2),
                "power_kw":             round(phy.power_kw, 2),
            }
        },
        "security": {
            "properties": {
                "audio_distress_active":        phy.audio_distress,
                "audio_distress":               phy.audio_distress,  # n8n alias
                "unauthorized_access_attempts": phy.unauth_attempts,
                "rfid_last_card":               phy.rfid_last_card,
                "rfid_access_granted":          phy.rfid_access_granted,
                "alert_level":                  alert_str,
                "state":                        phy.security_state.value,
            }
        },
        "incident_log": {
            "properties": {
                "entries":        [inc.to_dict() for inc in phy.incidents[-10:]],
                "open_incidents": sum(1 for inc in phy.incidents if not inc.resolved),
            }
        },
        # Device-reported applied dispatch policy. Written under control via an
        # RFC-7396 merge-patch, so it sits ALONGSIDE the engine's authoritative
        # control.dispatch_policy (intent) without overwriting it. This is the
        # "what the cabin is actually running" view for the dashboard.
        "control": {
            "properties": {
                "device_applied_policy": {
                    "policy_id":       phy.dispatch.policy_id,
                    "park_floor":      phy.dispatch.park_floor,
                    "direction_bias":  phy.dispatch.direction_bias,
                    "accel_profile":   phy.dispatch.accel_profile,
                    "speed_cap_ms":    phy.dispatch.speed_cap_ms,
                    "dwell_ms":        phy.dispatch.dwell_ms,
                    "deep_idle":       phy.dispatch.deep_idle,
                    "force_fan":       phy.dispatch.force_fan,
                    "restrict_floors": phy.dispatch.restrict_floors,
                    "applied_at":      phy.dispatch.applied_at,
                }
            }
        },
        "energy": {
            "properties": {
                "kwh_today":   round(phy.energy_kwh_today, 4),
                "power_kw":    round(phy.power_kw, 2),
                "current_draw_a": round(phy.current_draw_a, 2),
            }
        },
        "performance": {
            "properties": {
                "trips_today":     phy.trips_today,
                "door_cycles":     phy.door_cycle_count,
                "obstruction_events": phy.door_obstruction_events,
                "availability_pct": 0.0 if phy.phase == ElevatorPhase.MAINTENANCE
                                    else (98.0 if phy.emergency_stop else 99.5),
            }
        },
    }

    ditto_msg = {
        # Ditto protocol topic is unchanged (Ditto namespace/name/things/...).
        "topic":   f"{cfg.thing_id.replace(':', '/', 1)}/things/twin/commands/modify",
        "headers": {"content-type": "application/json"},
        "path":    "/features",
        "value":   feature_value,
        # Identification helpers for the bridge / subscribers. The MQTT topic
        # carries the mqtt-safe id; we also embed both forms in the payload so
        # consumers never have to round-trip via topic parsing.
        "thingId": cfg.thing_id,
        "mqttId":  thing_id_to_mqtt_id(cfg.thing_id),
    }
    return ditto_msg


# ──────────────────────────────────────────────────────────────────────────────
# RUNTIME ARTIFACTS (snapshot, healthcheck)
# ──────────────────────────────────────────────────────────────────────────────
def write_health_marker(cfg: SimConfig, status: dict) -> None:
    """Write the marker file that Dockerfile.simulator HEALTHCHECK looks for."""
    cfg.runtime_dir.mkdir(parents=True, exist_ok=True)
    tmp = cfg.health_file.with_suffix(cfg.health_file.suffix + ".tmp")
    tmp.write_text(json.dumps(status), encoding="utf-8")
    os.replace(tmp, cfg.health_file)


def persist_live_snapshot(cfg: SimConfig, feature_value: dict) -> None:
    cfg.runtime_dir.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "thingId":   cfg.thing_id,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "features":  feature_value,
    }
    tmp = cfg.snapshot_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot), encoding="utf-8")
    os.replace(tmp, cfg.snapshot_file)


# ──────────────────────────────────────────────────────────────────────────────
# CLI DASHBOARD
# ──────────────────────────────────────────────────────────────────────────────
def print_dashboard(phy: ElevatorPhysics, tick: int, anomalies: list[str]) -> None:
    arrows = {Direction.UP: "^", Direction.DOWN: "v", Direction.IDLE: "-"}
    arrow = arrows[phy.direction]
    health_marks = {HealthStatus.GOOD: "OK", HealthStatus.WARNING: "WARN",
                    HealthStatus.CRITICAL: "CRIT"}
    h_mark = health_marks[phy.motor_health]
    a_str = f" | anomalies: {', '.join(anomalies)}" if anomalies else ""
    log.info(
        "[Tick %04d] %-13s | Floor %d%s%d | Door: %-8s | "
        "Speed: %.2fm/s | Load: %.0fkg | Vib: %.3fg | "
        "Motor: %.1fC %s | I=%.1fA P=%.1fkW | trips=%d cycles=%d%s",
        tick, phy.phase.name, phy.current_floor, arrow, phy.target_floor,
        phy.door_state.value, phy.speed_ms, phy.load_kg, phy.vibration_level,
        phy.motor_temp_c, h_mark, phy.current_draw_a, phy.power_kw,
        phy.trips_today, phy.door_cycle_count, a_str,
    )


# ──────────────────────────────────────────────────────────────────────────────
# MQTT
# ──────────────────────────────────────────────────────────────────────────────
def handle_command_payload(physics: ElevatorPhysics, data: dict) -> bool:
    """Apply one inbound MQTT command to the simulated device. Returns True if a
    dispatch policy was applied. Recognises the DISPATCH_POLICY /
    SET_DISPATCH_POLICY command the bridge forwards from the safety gate; other
    commands are acknowledged (see build_command_ack) but do not alter the
    simulated physics."""
    if not isinstance(data, dict):
        return False
    cmd = str(data.get("command", "")).upper()
    if cmd not in ("DISPATCH_POLICY", "SET_DISPATCH_POLICY"):
        return False
    policy_id = data.get("policy_id") or data.get("policy")
    params = data.get("params") or data.get("dispatch_params") or {}
    if not isinstance(params, dict):
        params = {}
    physics.apply_dispatch_policy(policy_id, params)
    return True


def build_command_ack(physics: ElevatorPhysics, data: dict, applied: bool) -> dict:
    """Build the COMMAND_RESULT event a real ESP32 publishes to confirm a command
    it received. The bridge reconciles this terminal result into Ditto's
    pending_command, completing the dashboard command lifecycle. Without it the
    command stays PENDING until the bridge's ack-timeout fires (~45s), during
    which the dashboard blocks every new operator command."""
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "event_type":     "COMMAND_RESULT",
        "command_id":     str(data.get("command_id") or "").strip(),
        "correlation_id": data.get("correlation_id"),
        "command":        data.get("command"),
        "status":         "SUCCEEDED",
        "current_floor":  physics.current_floor,
        "reason":         "Applied by simulator" if applied else "Acknowledged by simulator",
        "source":         "esp32_simulator",
        "timestamp":      now,
    }


def make_mqtt_client(cfg: SimConfig, physics: Optional[ElevatorPhysics] = None) -> mqtt.Client:
    """Unique client_id per instance so multiple simulators don't clobber sessions.
    When `physics` is supplied, the client subscribes to the commands topic and
    applies DISPATCH_POLICY commands to the device (the firmware's role)."""
    sanitized_thing = cfg.thing_id.replace(":", "_").replace("/", "_")
    client_id = f"elevator-sim-{sanitized_thing}-{cfg.instance_id}-{os.getpid()}"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    if cfg.mqtt_username:
        # Broker runs allow_anonymous=false; authenticate like the firmware does.
        client.username_pw_set(cfg.mqtt_username, cfg.mqtt_password)

    def on_connect(client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            log.info("Connected to Mosquitto at %s:%d as %s",
                     cfg.mqtt_host, cfg.mqtt_port, client_id)
            if physics is not None:
                # Subscribe on (re)connect so command handling survives reconnects.
                client.subscribe(cfg.mqtt_commands_topic, qos=cfg.mqtt_qos)
                log.info("Subscribed to commands topic: %s", cfg.mqtt_commands_topic)
        else:
            log.error("MQTT connect failed -- reason code: %s", reason_code)

    def on_disconnect(client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log.warning("Unexpected MQTT disconnect (rc=%s) -- will retry",
                        reason_code)

    def on_message(client, userdata, msg):
        if physics is None:
            return
        try:
            raw = msg.payload.decode("utf-8", errors="replace")
        except Exception:  # pragma: no cover - decode is extremely defensive
            return
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(data, dict):
            return

        applied = handle_command_payload(physics, data)
        if applied:
            log.info("Command applied from %s", msg.topic)

        # Confirm every correlated command on the events topic so the bridge can
        # reconcile a terminal result into Ditto and the dashboard's command
        # lifecycle completes instead of waiting out the ~45s ack-timeout.
        command_id = str(data.get("command_id") or "").strip()
        if not command_id:
            return
        ack = build_command_ack(physics, data, applied)
        info = client.publish(cfg.mqtt_events_topic, json.dumps(ack), qos=cfg.mqtt_qos)
        if info.rc == mqtt.MQTT_ERR_SUCCESS:
            log.info("Acknowledged command %s (%s) -> %s",
                     command_id, ack["command"], cfg.mqtt_events_topic)
        else:
            log.warning("Command ack enqueue failed (rc=%s) for %s", info.rc, command_id)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    return client


def connect_with_backoff(client: mqtt.Client, cfg: SimConfig,
                         shutdown_event_fn=lambda: False) -> None:
    backoff = 1
    while not shutdown_event_fn():
        try:
            client.connect(cfg.mqtt_host, cfg.mqtt_port,
                           keepalive=cfg.mqtt_keepalive)
            return
        except Exception as exc:  # broad: network errors vary by platform
            log.error("Cannot reach broker %s:%d: %s -- retrying in %ds",
                      cfg.mqtt_host, cfg.mqtt_port, exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)


# ──────────────────────────────────────────────────────────────────────────────
# MAIN LOOP
# ──────────────────────────────────────────────────────────────────────────────

# Backwards-compatible module-level constants. Existing tooling that imports
# these still works; the live values come from `SimConfig.from_env()`.
_CFG_FOR_BACKCOMPAT = None
def _backcompat_constants(cfg: SimConfig) -> None:
    global BROKER_HOST, BROKER_PORT, THING_ID, MQTT_TOPIC
    global PUBLISH_INTERVAL_S, RUNTIME_DIR, LIVE_SNAPSHOT_PATH, MAX_LOAD_KG
    BROKER_HOST = cfg.mqtt_host
    BROKER_PORT = cfg.mqtt_port
    THING_ID = cfg.thing_id
    MQTT_TOPIC = cfg.mqtt_topic
    PUBLISH_INTERVAL_S = cfg.publish_interval_s
    RUNTIME_DIR = cfg.runtime_dir
    LIVE_SNAPSHOT_PATH = cfg.snapshot_file
    MAX_LOAD_KG = cfg.max_load_kg


def main() -> None:
    cfg = SimConfig.from_env()
    _configure_logging(cfg.log_level)
    _backcompat_constants(cfg)

    log.info("=" * 70)
    log.info("  ELEVATOR DIGITAL TWIN SIMULATOR -- Agentic AI Platform")
    log.info("  Thing ID         : %s", cfg.thing_id)
    log.info("  MQTT-safe ID     : %s", thing_id_to_mqtt_id(cfg.thing_id))
    log.info("  Broker           : %s:%d", cfg.mqtt_host, cfg.mqtt_port)
    log.info("  Telemetry topic  : %s", cfg.mqtt_topic)
    log.info("  Events topic     : %s", cfg.mqtt_events_topic)
    log.info("  Commands topic   : %s", cfg.mqtt_commands_topic)
    log.info("  Status topic     : %s", cfg.mqtt_status_topic)
    log.info("  Publish interval : %.2fs (physics step %.2fs)",
             cfg.publish_interval_s, cfg.physics_step_s)
    log.info("  Anomaly profile  : %s", cfg.anomaly_profile)
    log.info("  Emergency latch  : %s",
             "demo auto-clear" if cfg.emergency_auto_clear else "manual ack required")
    log.info("  Random seed      : %s",
             cfg.random_seed if cfg.random_seed is not None else "(non-deterministic)")
    log.info("=" * 70)

    rng = random.Random(cfg.random_seed) if cfg.random_seed is not None else random.Random()
    physics = ElevatorPhysics(cfg, rng)
    injector = AnomalyInjector(physics, cfg, rng)

    shutdown = {"signal": False}

    def _handle_signal(signum, frame):
        log.info("Received signal %s -- shutting down gracefully", signum)
        shutdown["signal"] = True

    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)

    client = make_mqtt_client(cfg, physics)
    connect_with_backoff(client, cfg, lambda: shutdown["signal"])
    if shutdown["signal"]:
        return
    client.loop_start()

    tick_index = 0
    publish_failures = 0
    log.info("Simulation started.\n")

    try:
        next_tick_at = time.monotonic()
        while not shutdown["signal"]:
            tick_index += 1
            tick_start_wall = datetime.now(timezone.utc)

            physics.tick(cfg.publish_interval_s)
            triggered = injector.roll(cfg.publish_interval_s)

            payload = build_ditto_payload(physics, cfg)
            payload_json = json.dumps(payload)
            persist_live_snapshot(cfg, payload["value"])

            info = client.publish(cfg.mqtt_topic, payload_json, qos=cfg.mqtt_qos)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                publish_failures += 1
                log.error("Publish enqueue failed (rc=%s, total_failures=%d)",
                          info.rc, publish_failures)
            else:
                try:
                    info.wait_for_publish(timeout=cfg.mqtt_publish_timeout_s)
                    if not info.is_published():
                        publish_failures += 1
                        log.warning("Publish ack timeout after %.1fs (total_failures=%d)",
                                    cfg.mqtt_publish_timeout_s, publish_failures)
                except (RuntimeError, ValueError) as exc:
                    publish_failures += 1
                    log.error("Publish wait error: %s (total_failures=%d)",
                              exc, publish_failures)

            health_status = {
                "thing_id":          cfg.thing_id,
                "tick":              tick_index,
                "tick_wall":         tick_start_wall.isoformat().replace("+00:00", "Z"),
                "phase":             physics.phase.name,
                "publish_failures":  publish_failures,
                "emergency_stop":    physics.emergency_stop,
                "anomaly_profile":   cfg.anomaly_profile,
            }
            try:
                write_health_marker(cfg, health_status)
            except OSError as exc:
                log.warning("Could not write health marker %s: %s",
                            cfg.health_file, exc)

            print_dashboard(physics, tick_index, triggered)

            # Drift-free pacing: sleep until the next scheduled tick boundary.
            next_tick_at += cfg.publish_interval_s
            sleep_for = next_tick_at - time.monotonic()
            if sleep_for > 0:
                # Wake early if a signal arrives so shutdown is responsive.
                slept = 0.0
                slice_s = 0.25
                while slept < sleep_for and not shutdown["signal"]:
                    chunk = min(slice_s, sleep_for - slept)
                    time.sleep(chunk)
                    slept += chunk
            else:
                # Tick took longer than the interval -- log and resync.
                log.warning("Tick %d ran %.2fs over schedule",
                            tick_index, -sleep_for)
                next_tick_at = time.monotonic()
    finally:
        log.info("Stopping MQTT loop...")
        try:
            client.loop_stop()
            client.disconnect()
        except Exception as exc:
            log.warning("MQTT cleanup error: %s", exc)
        log.info("MQTT disconnected cleanly.")


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        # Configuration error: fail loudly with non-zero exit so Docker can detect it.
        log.error("Configuration error: %s", exc)
        sys.exit(2)
