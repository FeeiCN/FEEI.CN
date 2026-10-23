#!/usr/bin/env python3
"""Validate that a physical iPhone is ready for XCUITest automation."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys


def run_json(command: list[str]) -> dict:
    result = subprocess.run(
        [*command, "--json-output", "-"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(detail or f"{' '.join(command)} failed")
    return json.loads(result.stdout)


def find_device(devices: list[dict], udid: str) -> dict:
    for device in devices:
        hardware = device.get("properties", {}).get("hardware", {})
        if hardware.get("udid") == udid:
            return device
    raise RuntimeError(f"Xcode 未发现 iPhone {udid}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--udid", required=True, help="iPhone UDID")
    args = parser.parse_args()

    try:
        devices = run_json(["xcrun", "devicectl", "list", "devices"])
        device = find_device(devices.get("result", {}).get("devices", []), args.udid)
        properties = device.get("properties", {})
        connection = properties.get("connection", {})
        state = properties.get("state", {})

        if connection.get("state") != "connected":
            raise RuntimeError(f"iPhone 未连接到 Xcode（state={connection.get('state', 'unknown')}）")
        if connection.get("pairingState") != "paired":
            raise RuntimeError("iPhone 尚未与这台 Mac 配对")
        if not state.get("developerModeStatus", {}).get("enabled"):
            raise RuntimeError("iPhone 未开启开发者模式")

        lock_state = run_json(
            ["xcrun", "devicectl", "device", "info", "lockState", "--device", args.udid]
        ).get("result", {})
        if not lock_state.get("unlockedSinceBoot"):
            raise RuntimeError("iPhone 重启后尚未解锁；请解锁设备后重试")

        name = state.get("name") or args.udid
        print(f"iPhone automation ready: {name} ({args.udid})")
        return 0
    except (RuntimeError, json.JSONDecodeError) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
