#!/usr/bin/env python3

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load("dimensions", "build-jianye-dimensions.py")
checker = load("checker", "check-jianye-dimensions.py")


class AggregationTests(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(builder.month("2026-10-09 09:30:00"), "2026-10")
        self.assertEqual(builder.month("2026/9/1"), "2026-09")
        for value in (None, "", "0000-00-00", "2026-02-31", "2026-13-01", "not-a-date", "2月15日", "10月1日"):
            self.assertIsNone(builder.month(value))

    def test_yearless_sports_dates_keep_source_labels(self):
        spec = next(item for item in builder.SPECS if item["table"] == "t_wyyd_zhty_student_scores")
        cube = builder.Cube(spec["groups"]["bySourceDate"])
        for label in ("2月15日", "2月15日", "10月1日"):
            cube.add({"sport_date": label})
        self.assertEqual({row["sport_date"]: row["count"] for row in cube.export()}, {"2月15日": 2, "10月1日": 1})

    def test_missing_is_not_zero(self):
        cube = builder.Cube(("group",), ("hours",))
        cube.add({"group": None, "hours": None})
        cube.add({"group": "0", "hours": 0})
        rows = {row["group"]: row for row in cube.export()}
        self.assertIsNone(rows[None]["hoursSum"])
        self.assertEqual(rows[None]["hoursKnownRows"], 0)
        self.assertEqual(rows["0"]["hoursSum"], 0)
        self.assertEqual(rows["0"]["hoursKnownRows"], 1)
        self.assertEqual(sum(row["count"] for row in rows.values()), 2)

    def test_ratio_denominators(self):
        self.assertIsNone(builder.percent(0, 0))
        self.assertIsNone(builder.ratio(50, 0))
        self.assertEqual(builder.percent(0, 10), 0)
        self.assertEqual(builder.percent(1, 3), 33.33)

    def test_multivalue_and_sign_null(self):
        activity = {"term": "2026-2027学年第一学期", "month": "2026-10", "week": 3, "levelName": "区级",
                    "schoolId": 1, "stageCodes": [2, 2, 3], "subjects": ["语文", "英语"],
                    "hours": 2, "expectedPersonTimes": None, "attendedPersonTimes": None}
        snapshot = {"meta": {"generatedAt": "2026-10-16"},
                    "training": {"terms": [{"name": activity["term"], "activities": [activity]}]},
                    "supervision": {"terms": []}}
        datasets = {}
        builder.snapshot_cubes(snapshot, datasets)
        self.assertEqual(datasets["training.term"]["totalRecords"], 1)
        self.assertEqual(datasets["training.termStage"]["totalRecords"], 2)
        self.assertTrue(datasets["training.termStage"]["nonAdditiveAcrossLabels"])
        self.assertIsNone(datasets["training.term"]["rows"][0]["attendanceRate"])

    def test_inspections_keep_type(self):
        activities = [
            {"type": "开学检查", "date": "2026-09-01", "school": "示例学校", "stage": None, "rating": None, "course": None},
            {"type": "校内听课（学校）", "date": "2026-09-02", "school": "示例学校", "stage": None, "rating": "优秀", "course": None},
        ]
        snapshot = {"meta": {"generatedAt": "2026-10-16"}, "training": {"terms": []},
                    "supervision": {"terms": [{"name": "2026-2027学年第一学期", "activities": activities}]}}
        datasets = {}
        builder.snapshot_cubes(snapshot, datasets)
        for key, dataset in datasets.items():
            if key.startswith("supervision."):
                self.assertIn("type", {field["key"] for field in dataset["dimensions"]})
                self.assertEqual(dataset["totalRecords"], 2)
        groups = {row["type"]: row["group"] for row in datasets["supervision.termGroup"]["rows"]}
        self.assertEqual(groups["开学检查"], "其他视导与检查")
        self.assertEqual(groups["校内听课（学校）"], "校内听课")

    def test_non_finite_numbers(self):
        for value in ("nan", "inf", "-inf", "未填写", None):
            self.assertIsNone(builder.number(value))

    def test_personal_fields_rejected(self):
        with self.assertRaises(ValueError):
            checker.scan({"nested": [{"student_no": "synthetic"}]})


class GeneratedSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / "data" / "jianye-dimensions.generated.json").read_text(encoding="utf-8"))

    def test_full_snapshot(self):
        self.assertTrue(checker.validate(self.data))

    def test_count_corruption_rejected(self):
        data = copy.deepcopy(self.data)
        dataset = next(item for item in data["datasets"].values() if item["rows"])
        dataset["rows"][0]["count"] += 1
        with self.assertRaises(ValueError):
            checker.validate(data)

    def test_reconciliation(self):
        for item in self.data["quality"]["baseSnapshotReconciliation"].values():
            self.assertEqual(item["matches"], item["snapshot"] == item["extracted"])


if __name__ == "__main__":
    unittest.main()
