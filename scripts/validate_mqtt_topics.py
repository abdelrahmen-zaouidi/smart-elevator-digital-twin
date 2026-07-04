"""Validate that the project follows the canonical MQTT topic convention.

Canonical convention:
    elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}

This script scans the repository for:
  1. Legacy topic strings that should no longer appear by default:
       elevator/telemetry/{...}, elevator/events/{...}, elevator/+/telemetry
       used in the wrong position, etc.
  2. The expected canonical topics in core configuration files.

Exit code 0 = all good, 1 = legacy strings still present where they should not be.

Run from the repo root:
    python scripts/validate_mqtt_topics.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Paths we walk recursively.
SCAN_GLOBS = [
    "*.py", "*.js", "*.ts", "*.tsx", "*.mjs", "*.cjs",
    "*.json", "*.yml", "*.yaml", "*.ino", "*.cpp", "*.h",
    "*.ps1", "*.sh", "*.md", "*.tex", "*.env", ".env*",
]

# Directories we never scan.
EXCLUDE_DIRS = {
    "node_modules", ".next", "dist", "build", ".venv", "venv",
    "__pycache__", ".git", "runtime", ".vscode",
    # Gitignored backup artifacts (scripts/backup.ps1) — n8n exports inside
    # may contain historical/inactive workflows that predate the topic scheme.
    "backups",
    # The simulator-side ditto envelope's "topic" field uses a slash form
    # (building/floor1:elevator/things/...) — that is a Ditto protocol topic,
    # not an MQTT topic. Skipping nothing here; we whitelist the pattern below.
}

# Legacy patterns that must not appear in production code/config.
LEGACY_PATTERNS = [
    r"elevator/telemetry/\{",      # elevator/telemetry/{thingId}
    r"elevator/telemetry/\#",      # elevator/telemetry/#
    r"elevator/telemetry/\+",      # elevator/telemetry/+
    r"elevator/events/\+",         # elevator/events/+
    r"elevator/events/\#",         # elevator/events/#
    r"elevator/telemetry/building",  # elevator/telemetry/building:floor1:...
]

# Paths whose mentions of legacy patterns are intentional (deprecation notes,
# changelogs, validation script itself, etc.).
LEGACY_ALLOWED_FILES = {
    "scripts/validate_mqtt_topics.py",
    "docs/system-architecture-and-design-chapter.md",
    "docs/software-design-and-implementation-chapter.md",
    "master-thesis/chapters/chapter03_software_agentic_architecture.tex",
    "SETUP.md",
    ".env.example",
    # esp32_simulator.py and bridge.js contain deprecation notes that
    # explicitly reference the legacy topic strings.
    "services/simulator/esp32_simulator.py",
    "services/ditto-bridge/bridge.js",
}

# Canonical topics that MUST appear in these reference files.
EXPECTED_TOPICS = {
    ".env.example": [
        "elevator/building-floor1-elevator/telemetry",
        "elevator/building-floor1-elevator/events",
        "elevator/building-floor1-elevator/commands",
        "elevator/building-floor1-elevator/status",
        "elevator/+/telemetry",
    ],
    "docker-compose.yml": [
        "elevator/+/telemetry",
    ],
    "apps/dashboard/.env.example": [
        "elevator/+/telemetry",
        "elevator/building-floor1-elevator/telemetry",
    ],
}


def iter_files() -> list[Path]:
    files: list[Path] = []
    for pattern in SCAN_GLOBS:
        for path in REPO_ROOT.rglob(pattern):
            if any(part in EXCLUDE_DIRS for part in path.parts):
                continue
            if path.is_file():
                files.append(path)
    return files


def scan_legacy(files: list[Path]) -> list[tuple[Path, int, str, str]]:
    hits: list[tuple[Path, int, str, str]] = []
    compiled = [(re.compile(p), p) for p in LEGACY_PATTERNS]
    for path in files:
        rel = path.relative_to(REPO_ROOT).as_posix()
        if rel in LEGACY_ALLOWED_FILES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for regex, pattern in compiled:
                if regex.search(line):
                    hits.append((path, lineno, pattern, line.strip()))
    return hits


def check_expected(files: list[Path]) -> list[tuple[str, str]]:
    missing: list[tuple[str, str]] = []
    for rel_path, expected_strings in EXPECTED_TOPICS.items():
        path = REPO_ROOT / rel_path
        if not path.exists():
            missing.append((rel_path, "<file missing>"))
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for expected in expected_strings:
            if expected not in text:
                missing.append((rel_path, expected))
    return missing


def main() -> int:
    files = iter_files()
    print(f"Scanning {len(files)} files in {REPO_ROOT}")

    legacy_hits = scan_legacy(files)
    missing = check_expected(files)

    if legacy_hits:
        print("\nFAIL: legacy MQTT topic patterns still present:")
        for path, lineno, pattern, line in legacy_hits:
            rel = path.relative_to(REPO_ROOT).as_posix()
            print(f"  {rel}:{lineno}  matches /{pattern}/")
            print(f"      {line}")
    else:
        print("\nPASS: no unexpected legacy MQTT topic patterns found.")

    if missing:
        print("\nFAIL: canonical MQTT topics missing from reference files:")
        for rel, expected in missing:
            print(f"  {rel}: expected to contain '{expected}'")
    else:
        print("PASS: all reference files contain the expected canonical topics.")

    return 0 if not legacy_hits and not missing else 1


if __name__ == "__main__":
    sys.exit(main())
