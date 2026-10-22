#!/usr/bin/env python3
"""检查并续签 iPhone 上的 WebDriverAgent。

Personal Team 签发到真机的 provisioning profile 仅有效七天。本脚本在
profile 到期后强制 Appium 重新构建和安装 WDA，并验证新 profile。
"""

from __future__ import annotations

import argparse
import plistlib
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import ios_appium_capture as ios


DEFAULT_WDA_BUNDLE_ID = "com.feei.WebDriverAgentRunner"
DEFAULT_TEAM_ID = "792GZF4XQ4"
DEFAULT_DERIVED_DATA = Path.home() / "Library/Developer/Xcode/DerivedData"


@dataclass(frozen=True)
class ProvisioningProfile:
    path: Path
    name: str
    application_identifier: str
    team_identifier: str
    expiration: datetime


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查并自动续签 iOS WebDriverAgent")
    parser.add_argument("--appium-url", default=ios.DEFAULT_APPIUM_URL)
    parser.add_argument("--udid", default=None, help="iPhone UDID；默认自动检测")
    parser.add_argument("--xcode-org-id", default=DEFAULT_TEAM_ID, help="Apple Developer Team ID")
    parser.add_argument("--xcode-signing-id", default="Apple Development")
    parser.add_argument("--updated-wda-bundle-id", default=DEFAULT_WDA_BUNDLE_ID)
    parser.add_argument("--renew-before-hours", type=int, default=0, help="到期前多少小时开始续签，默认到期后才续签")
    parser.add_argument("--minimum-renewed-hours", type=int, default=144, help="续签后要求的最少有效小时数")
    parser.add_argument("--force", action="store_true", help="忽略剩余有效期，立即重签")
    parser.add_argument("--check-only", action="store_true", help="只输出当前描述文件状态，不重签")
    return parser.parse_args()


def expected_application_identifier(team_id: str, bundle_id: str) -> str:
    return f"{team_id}.{bundle_id}.xctrunner"


def profile_paths(derived_data: Path) -> list[Path]:
    return sorted(
        derived_data.glob("**/WebDriverAgentRunner-Runner.app/embedded.mobileprovision"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def decode_profile(path: Path) -> ProvisioningProfile:
    result = subprocess.run(
        ["security", "cms", "-D", "-i", str(path)],
        check=True,
        capture_output=True,
    )
    payload = plistlib.loads(result.stdout)
    expiration = payload["ExpirationDate"]
    if expiration.tzinfo is None:
        expiration = expiration.replace(tzinfo=timezone.utc)
    team_identifiers = payload.get("TeamIdentifier") or []
    application_identifier = (payload.get("Entitlements") or {}).get("application-identifier")
    if not team_identifiers or not application_identifier:
        raise ValueError(f"描述文件缺少 TeamIdentifier 或 application-identifier: {path}")
    return ProvisioningProfile(
        path=path,
        name=str(payload.get("Name") or ""),
        application_identifier=str(application_identifier),
        team_identifier=str(team_identifiers[0]),
        expiration=expiration,
    )


def current_profile(team_id: str, bundle_id: str) -> ProvisioningProfile | None:
    expected_identifier = expected_application_identifier(team_id, bundle_id)
    for path in profile_paths(DEFAULT_DERIVED_DATA):
        try:
            profile = decode_profile(path)
        except (OSError, plistlib.InvalidFileException, subprocess.CalledProcessError, ValueError):
            continue
        if profile.application_identifier == expected_identifier:
            return profile
    return None


def profile_status(profile: ProvisioningProfile | None, now: datetime) -> str:
    if profile is None:
        return "未找到当前 WDA 描述文件"
    remaining = profile.expiration - now
    return (
        f"WDA 描述文件: {profile.name}\n"
        f"路径: {profile.path}\n"
        f"到期: {profile.expiration.astimezone().isoformat(timespec='seconds')}\n"
        f"剩余: {remaining}"
    )


def renew_wda(args: argparse.Namespace, udid: str) -> None:
    driver_args = SimpleNamespace(
        bundle_id=ios.HEALTH_AUTO_EXPORT_BUNDLE_ID,
        new_command_timeout=600,
        device_name=None,
        platform_version=None,
        # 重签是低频操作；保留 Xcode 输出，便于 GitHub Action 直接定位签名失败原因。
        show_xcode_log=True,
        xcode_org_id=args.xcode_org_id,
        xcode_signing_id=args.xcode_signing_id,
        updated_wda_bundle_id=args.updated_wda_bundle_id,
        use_new_wda=True,
        wda_local_port=None,
        allow_provisioning_updates=True,
        allow_provisioning_device_registration=True,
        appium_url=args.appium_url,
    )
    driver = ios.create_driver(driver_args, udid)
    try:
        print("WDA 已重新签名并安装", flush=True)
    finally:
        driver.quit()


def main() -> int:
    args = parse_args()
    if args.renew_before_hours < 0 or args.minimum_renewed_hours < 1:
        print("续签有效期参数必须为正数", file=sys.stderr)
        return 2

    now = datetime.now(timezone.utc)
    profile = current_profile(args.xcode_org_id, args.updated_wda_bundle_id)
    print(profile_status(profile, now), flush=True)

    remaining = profile.expiration - now if profile else timedelta.min
    needs_renewal = args.force or profile is None or remaining <= timedelta(hours=args.renew_before_hours)
    if args.check_only:
        return 1 if needs_renewal else 0
    if not needs_renewal:
        print("有效期充足，无需续签", flush=True)
        return 0

    udid = ios.detect_udid(args.udid)
    if not udid:
        print("无法自动确定 UDID。请确认 iPhone 已连接并受信任。", file=sys.stderr)
        return 2

    print("开始强制重新签名 WebDriverAgent", flush=True)
    renew_wda(args, udid)
    renewed_at = datetime.now(timezone.utc)
    renewed_profile = current_profile(args.xcode_org_id, args.updated_wda_bundle_id)
    print(profile_status(renewed_profile, renewed_at), flush=True)
    if renewed_profile is None:
        print("续签后未找到 WDA 描述文件", file=sys.stderr)
        return 1
    if renewed_profile.expiration - renewed_at < timedelta(hours=args.minimum_renewed_hours):
        print("续签后的 WDA 描述文件有效期不足预期", file=sys.stderr)
        return 1
    print("WDA 自动续签验证通过", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
