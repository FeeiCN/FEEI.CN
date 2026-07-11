import json
import tempfile
import unittest
from pathlib import Path

from scripts.upsert_drive_event import parse_drive_title, upsert_drive_event


class UpsertDriveEventTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.data_root = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def read_day(self) -> dict:
        return json.loads((self.data_root / "2026/07/10.json").read_text(encoding="utf-8"))

    def upsert(self, action: str, address: str, issue_number: int) -> dict:
        return upsert_drive_event(
            data_root=self.data_root,
            title=f"2026-07-10 09:00:00{action}",
            address=address,
            issue_number=issue_number,
        )

    def test_up_then_down_keeps_up_and_tracks_suppressed_issue(self) -> None:
        self.upsert("上车", "地址 A", 1)
        result = self.upsert("下车", "地址 A", 2)

        self.assertEqual(result["status"], "ignored_conflicting_down")
        self.assertTrue(result["changed"])
        self.assertEqual(
            self.read_day()["09:00:00"],
            {
                "time": "09:00:00",
                "action": "上车",
                "address": "地址 A",
                "issue_number": 1,
                "suppressed_issue_numbers": [2],
            },
        )

    def test_down_then_up_replaces_down(self) -> None:
        self.upsert("下车", "地址 A", 2)
        result = self.upsert("上车", "地址 A", 1)

        self.assertEqual(result["status"], "replaced_conflicting_down")
        self.assertEqual(self.read_day()["09:00:00"]["action"], "上车")
        self.assertEqual(self.read_day()["09:00:00"]["suppressed_issue_numbers"], [2])

    def test_reprocessing_suppressed_down_is_idempotent(self) -> None:
        self.upsert("上车", "地址 A", 1)
        self.upsert("下车", "地址 A", 2)
        result = self.upsert("下车", "地址 A", 2)

        self.assertFalse(result["changed"])
        self.assertEqual(self.read_day()["09:00:00"]["suppressed_issue_numbers"], [2])

    def test_address_whitespace_does_not_bypass_conflict_rule(self) -> None:
        self.upsert("上车", "地址   A", 1)
        self.upsert("下车", "地址\nA", 2)

        self.assertEqual(len(self.read_day()), 1)
        self.assertEqual(self.read_day()["09:00:00"]["action"], "上车")

    def test_same_time_different_addresses_remain_separate(self) -> None:
        self.upsert("上车", "地址 A", 1)
        self.upsert("下车", "地址 B", 2)

        self.assertEqual(len(self.read_day()), 2)

    def test_existing_legacy_event_is_enriched_with_issue_number(self) -> None:
        data_file = self.data_root / "2026/07/10.json"
        data_file.parent.mkdir(parents=True)
        data_file.write_text(
            json.dumps({"09:00:00": {"action": "上车", "address": "地址 A"}}, ensure_ascii=False),
            encoding="utf-8",
        )

        result = self.upsert("上车", "地址 A", 1)

        self.assertEqual(result["status"], "enriched_existing")
        self.assertEqual(self.read_day()["09:00:00"]["issue_number"], 1)

    def test_non_drive_title_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_drive_title("普通人如何上车存储")


if __name__ == "__main__":
    unittest.main()
