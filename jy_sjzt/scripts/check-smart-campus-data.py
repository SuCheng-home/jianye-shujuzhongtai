#!/usr/bin/env python3
"""Validate the frozen screenshot transcription, semantics, provenance and build."""

import argparse
import copy
import hashlib
import runpy
import struct
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "scripts/build-smart-campus-data.py"
API = runpy.run_path(str(BUILDER_PATH))
require = API["require"]

# Independent transcription oracle for this schema/screenshot revision. Deliberate
# corrections require checking the PNG and updating both source and these fixtures.
PV = [5769, 7251, 1375, 10207, 4940, 4661, 5257]
UV = [1322, 1586, 479, 2723, 1149, 1113, 1197]
TEACHER = [64, 69, 0, 29, 44, 51, 68, 72, 0, 0, 0, 68, 71, 66, 0, 0, 0, 0, 0, 0, 0, 40, 61, 40, 0, 48, 80, 43, 43, 38]
STUDENT = [37, 36, 0, 31, 37, 31, 44, 38, 0, 0, 0, 59, 63, 85, 0, 0, 0, 0, 0, 0, 0, 36, 38, 41, 0, 35, 51, 46, 49, 53]
MODULE_LABELS = ["通知公告", "问卷", "学期管理", "工资管理", "报修", "用户组织", "学生请假", "老师请假版本三", "区问卷插件", "校本课程平台", "领导看板", "考勤（版本一）", "护导检查版本二"]
INSTALLATIONS = [34, 28, 27, 27, 26, 25, 24, 20, 19, 17, 17, 16, 16]
ACTIVITY_SCORES = [21855, 16926, 14626, 12573, 12261, 10314, 9372, 6991, 6288, 5547, None, None]
ACTIVITY_LABELS = ["南京致远外国语小学", "南京师范大学附属中学邺城...", "南京师大附中新城初级中学", "新城小学", "南京外国语学校青奥村小学", "新城南校安心驿站", "金陵中学建邺实验学校（小...", "南师附中栋梁学校", "新城小学怡康街分校", "南京师范大学附属中学黄山...", "南京市文泰街幼儿园", "南京市莲花实验学校"]
LEAVE_SCHOOLS = ["金陵中学建邺实验学校（小学部）", "南京外国语学校青奥村小学", "新城小学", "新城南校安心驿站"]
SOURCE_COUNTS = {"overview": 1, "overviewWxj3": 1, "schoolCategoriesWxj1": 7, "schoolCategoriesWxj3": 7, "roleBreakdown": 3, "visitsDaily": 7, "visitsDeduplicated": 1, "moduleInstallations": 13, "leaveSummary": 1, "leaveDaily": 30, "leaveSchools": 4, "schoolActivity": 12, "growthSchools": 7, "growthFollowers": 7}
SCREENSHOTS = {
    "wxj1": ("919ddaeafe5abaf20fe02835d101f9c85c82c5035fba07c7effb98a4961738e0", [3322, 1750]),
    "wxj2": ("ddec2d2394e9abdbb667535dd04a738ff491fc524049a056ed68bcb8eff78cb7", [3328, 1772]),
    "wxj3": ("58bbaa905a2814818b296ba588cf7fb7bc3fcccaf76885416e97b894b09c3871", [3376, 1772]),
}


def column(datasets, name, key):
    return [row[key] for row in datasets[name]["rows"]]


def check_matrix(datasets, name, fields, expected):
    require(set(datasets[name]["fields"]) == set(fields), f"{name}: numeric field contract changed")
    actual = [[row[key] for key in fields] for row in datasets[name]["rows"]]
    require(actual == expected, f"{name}: values differ from verified screenshot transcription")


def validate_source(source, verify_images=True):
    API["validate_source"](source, verify_images=verify_images)
    datasets = source["datasets"]
    for item in source["meta"]["source"]:
        sha, size = SCREENSHOTS[item["id"]]
        require(item["sha256"] == sha and item["pixelSize"] == size, "Screenshot revision/dimensions changed")
        if verify_images:
            with (ROOT / item["relativePath"]).open("rb") as stream:
                header = stream.read(24)
            require(header[:8] == b"\x89PNG\r\n\x1a\n", "Source is not a PNG")
            require(list(struct.unpack(">II", header[16:24])) == size, "Actual PNG dimensions differ")
    for name, count in SOURCE_COUNTS.items():
        require(len(datasets[name]["rows"]) == count, f"{name}: expected {count} rows")
    periods = source["meta"]["periods"]
    require(set(periods) == {"snapshot", "visits7d", "leave30d", "activityUnknown"}, "Unexpected time period")
    require((periods["visits7d"]["start"], periods["visits7d"]["end"]) == ("2026-10-09", "2026-10-15"), "Visit period changed")
    require((periods["leave30d"]["start"], periods["leave30d"]["end"]) == ("2026-09-17", "2026-10-16"), "Leave period changed")
    require(periods["snapshot"]["start"] is None and periods["activityUnknown"]["start"] is None, "Undisplayed date must remain unknown")
    expected_periods = {name: "snapshot" for name in SOURCE_COUNTS}
    expected_periods.update({name: "visits7d" for name in ("visitsDaily", "visitsDeduplicated", "growthSchools", "growthFollowers")})
    expected_periods.update({name: "leave30d" for name in ("leaveSummary", "leaveDaily", "leaveSchools")})
    expected_periods["schoolActivity"] = "activityUnknown"
    for name, period in expected_periods.items():
        require(datasets[name]["period"] == period, f"{name}: incorrect statistical period")
        expected_sources = ["wxj1"]
        if name in {"overviewWxj3", "schoolCategoriesWxj3", "schoolActivity"}:
            expected_sources = ["wxj3"]
        elif name.startswith("leave"):
            expected_sources = ["wxj2"]
        elif name == "roleBreakdown":
            expected_sources = ["wxj1", "wxj3"]
        require(datasets[name]["source"] == expected_sources, f"{name}: wrong screenshot attribution")
    check_matrix(datasets, "overview", ["schoolCount", "userCount", "followerCount", "followerRatePct", "teacherStudentFollowerRatePct"], [[39, 45333, 28901, 63.75, 78.71]])
    check_matrix(datasets, "overviewWxj3", ["schoolCount", "userCount", "followerCount", "followerRatePct"], [[39, 45333, 28901, 63.75]])
    check_matrix(datasets, "schoolCategoriesWxj1", ["count"], [[x] for x in [6, 19, 11, 1, 0, 1, 1]])
    check_matrix(datasets, "schoolCategoriesWxj3", ["count"], [[x] for x in [6, 19, 8, 1, 1, 3, 1]])
    require(column(datasets, "schoolCategoriesWxj1", "rawLabel") == ["幼儿园", "小学", "初中", "高中", "大中专", "局机关", "特殊学校"], "wxj1 classification labels changed")
    require(column(datasets, "schoolCategoriesWxj3", "rawLabel") == ["幼儿园", "小学", "初中", "局机关", "特殊学校", "九年制", "十二年制"], "wxj3 classification labels changed")
    check_matrix(datasets, "visitsDaily", ["pv", "uv"], [list(pair) for pair in zip(PV, UV)])
    check_matrix(datasets, "visitsDeduplicated", ["uniqueVisitors7d"], [[None]])
    require(datasets["visitsDaily"]["fields"]["uv"]["aggregation"] == "personDaysOnly", "UV must not be summed as distinct people")
    check_matrix(datasets, "roleBreakdown", ["userCount", "followerCount", "followerRatePct"], [[None, None, None]] * 3)
    require(column(datasets, "roleBreakdown", "id") == ["teachers", "students", "parents"], "Role definitions changed")
    check_matrix(datasets, "moduleInstallations", ["installedSchools"], [[x] for x in INSTALLATIONS])
    require(column(datasets, "moduleInstallations", "rawLabel") == MODULE_LABELS, "Module labels do not match bars")
    require(datasets["moduleInstallations"]["fields"]["installedSchools"]["aggregation"] == "schoolModulePairsOnly", "Installation count must not become application usage")
    check_matrix(datasets, "leaveSummary", ["teacherPeople", "studentPeople"], [[455, 418]])
    for definition in datasets["leaveSummary"]["fields"].values():
        require(definition["unit"] == "人" and definition["aggregation"] == "none", "Leave summary must remain displayed people, not cumulative events")
    check_matrix(datasets, "leaveDaily", ["teacher", "student"], [list(pair) for pair in zip(TEACHER, STUDENT)])
    for i, row in enumerate(datasets["leaveDaily"]["rows"]):
        expected_evidence = "numeric-labels"
        expected_confidence = "high"
        if row["teacher"] == row["student"] == 0:
            expected_evidence, expected_confidence = "zero-baseline", "medium"
        elif i in (3, 23):
            expected_evidence, expected_confidence = "overlapping-numeric-labels", "medium"
        require(row["evidence"] == expected_evidence and row["confidence"] == expected_confidence, "Daily leave reading must retain evidence/uncertainty")
    check_matrix(datasets, "leaveSchools", ["teacherPeople", "studentPeople"], [[57, 2], [82, 6], [42, 6], [71, 1]])
    require(column(datasets, "leaveSchools", "rawLabel") == LEAVE_SCHOOLS, "Visible leave-school labels changed")
    require(column(datasets, "leaveSchools", "schoolName") == LEAVE_SCHOOLS, "School names must retain screenshot wording")
    require(column(datasets, "leaveSchools", "schoolType") == ["小学"] * 4, "Visible school types changed")
    check_matrix(datasets, "schoolActivity", ["score"], [[x] for x in ACTIVITY_SCORES])
    require(column(datasets, "schoolActivity", "rawLabel") == ACTIVITY_LABELS, "Activity labels must retain clipping/ellipsis")
    require(column(datasets, "schoolActivity", "displayOrder") == list(range(1, 13)), "Activity display order changed")
    require(column(datasets, "schoolActivity", "isOccluded") == [False] * 10 + [True] * 2, "Activity occlusion flags changed")
    require(column(datasets, "schoolActivity", "isTruncated") == [i in (1, 6, 9) for i in range(12)], "Activity truncation flags changed")
    require(column(datasets, "schoolActivity", "rawScore") == [str(x) for x in ACTIVITY_SCORES[:10]] + ["5126", "4462"], "Raw activity candidates changed")
    check_matrix(datasets, "growthSchools", ["schoolCount"], [[39]] * 7)
    check_matrix(datasets, "growthFollowers", ["followersThousands"], [[None]] * 7)
    for name, dataset in datasets.items():
        for row in dataset["rows"]:
            expected = "missing" if name in {"roleBreakdown", "visitsDeduplicated", "growthFollowers"} or (name == "schoolActivity" and row["isOccluded"]) else "screenshot"
            require(row["dataStatus"] == expected, f"{name}: numerical status changed")
    uncertainty_ids = {item["id"] for item in source["meta"]["uncertainties"]}
    gap_ids = {item["id"] for item in source["meta"]["gaps"]}
    require(uncertainty_ids == {"classification-scope", "leave-count-definition", "leave-zero-baseline", "growth-followers-scale", "activity-labels-clipped", "pv-third-verified", "module-coverage-assumption"}, "Required uncertainties missing")
    require(gap_ids == {"role-values-not-shown", "period-uv-not-shown", "partial-module-window", "partial-school-table", "partial-activity-window", "snapshot-time-unknown"}, "Required gaps missing")


def independent_percent(numerator, denominator):
    return float((Decimal(str(numerator)) / Decimal(str(denominator)) * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def validate_generated(source, generated, raw_source):
    API["validate_structure"](generated, generated=True)
    datasets = generated["datasets"]
    expected = API["build"](source, raw_source)
    require(generated == expected, "Generated artifact is stale or changed; run import:campus, then check:campus")
    require(generated["meta"]["generation"]["sourceSha256"] == hashlib.sha256(raw_source).hexdigest(), "Source digest mismatch")
    require(generated["meta"]["generation"]["generatedAt"] is None, "A wall-clock timestamp breaks deterministic output")
    for name, dataset in datasets.items():
        for row in dataset["rows"]:
            if row["dataStatus"] == "derived":
                refs = row["derivedFrom"]
                require(bool(refs) and len(set(refs)) == len(refs), "Missing or duplicate derivation inputs")
                for ref in refs:
                    value = API["resolve_ref"](source, ref)
                    require(type(value) in (int, float), "Derived dependency must be a known numeric source value")
            else:
                original = API["resolve_ref"](source, row["sourceRef"])
                require(all(row[key] == value for key, value in original.items()), f"{name}: original row changed during build")
    # Independent arithmetic checks are intentionally separate from re-running the
    # builder: equality with a buggy builder alone would not validate formulas.
    overview = datasets["overview"]["rows"][0]
    ov = datasets["overviewDerived"]["rows"][0]
    require(ov["unfollowedCount"] == 16432 == overview["userCount"] - overview["followerCount"], "Unfollowed count mismatch")
    require(ov["followerRateCalculatedPct"] == 63.75 == independent_percent(28901, 45333), "Follower rate mismatch")
    vs = datasets["visitsSummary"]["rows"][0]
    require(vs["pv7dTotal"] == 39460 == sum(PV), "PV sum mismatch")
    require(vs["uvPersonDays"] == 9569 == sum(UV), "UV person-day sum mismatch")
    require(datasets["visitsSummary"]["fields"]["uvPersonDays"]["unit"] == "人日", "UV aggregate must use person-days")
    require(datasets["visitsDeduplicated"]["rows"][0]["uniqueVisitors7d"] is None, "Cannot deduplicate daily UV by addition")
    for suffix in ("Wxj1", "Wxj3"):
        base = datasets["schoolCategories" + suffix]["rows"]
        shares = datasets["categoryShares" + suffix]["rows"]
        require(sum(row["count"] for row in base) == 39, "Classification total mismatch")
        require(len(base) == len(shares), "Category share count mismatch")
        for raw, derived in zip(base, shares):
            require(raw["id"] == derived["id"] and derived["sharePct"] == independent_percent(raw["count"], 39), "Category share mismatch")
    coverage = datasets["moduleCoverage"]["rows"]
    require(len(coverage) == 13, "Missing module coverage rows")
    for installation, raw, row in zip(INSTALLATIONS, datasets["moduleInstallations"]["rows"], coverage):
        require(raw["id"] == row["id"], "Module join mismatch")
        require(row["coveragePct"] == independent_percent(installation, 39), "Module coverage formula mismatch")
        require(row["notInstalledSchools"] + installation == 39, "Installed/uninstalled counts do not reconcile")
    summary = datasets["moduleSummary"]["rows"][0]
    require(summary["visibleModuleCount"] == 13 and summary["visibleInstallationPairs"] == 296, "Visible module summary mismatch")
    for row, role, expected_sum, expected_difference, expected_visible in zip(datasets["leaveReconciliation"]["rows"], ["teacher", "student"], [995, 810], [540, 392], [252, 15]):
        require(row["id"] == role, "Leave role order mismatch")
        require(row["dailyPointSum"] == expected_sum, "Leave point sum mismatch")
        require(row["pointSumMinusDisplayedPeople"] == expected_difference, "Leave mismatch was hidden or miscalculated")
        require(row["visibleSchoolPeopleSum"] == expected_visible, "Visible-school subtotal mismatch")
        require(row["confidence"] == "medium", "Derived confidence must not exceed uncertain daily readings")
    require(len(datasets) == 21 and sum(len(ds["rows"]) for ds in datasets.values()) == 133, "Output dataset/row count changed")


def set_path(document, path, value, delete=False):
    parts = path.split("/")
    current = document
    for part in parts[:-1]:
        current = current[int(part)] if isinstance(current, list) else current[part]
    key = int(parts[-1]) if isinstance(current, list) else parts[-1]
    if delete:
        del current[key]
    else:
        current[key] = value


def expect_rejected(label, operation):
    try:
        operation()
    except (ValueError, KeyError, TypeError, IndexError):
        return
    raise ValueError(f"Self-test accepted invalid data: {label}")


def self_test(source, generated, raw_source):
    """Mutation tests operate only on deep copies in memory; no temporary files."""
    source_cases = [
        ("PV third-day transcription", "datasets/visitsDaily/rows/2/pv", 1374),
        ("PV/UV swapped", "datasets/visitsDaily/rows/0/uv", 8000),
        ("duplicate date", "datasets/leaveDaily/rows/1/date", "2026-09-17"),
        ("missing date", "datasets/leaveDaily/rows/29", None, True),
        ("leave overlapping label", "datasets/leaveDaily/rows/3/teacher", 31),
        ("leave summary changed to sum", "datasets/leaveSummary/rows/0/teacherPeople", 995),
        ("unseen role filled", "datasets/roleBreakdown/rows/0/userCount", 1000),
        ("unseen role zeroed", "datasets/roleBreakdown/rows/0/userCount", 0),
        ("deduplicated UV invented", "datasets/visitsDeduplicated/rows/0/uniqueVisitors7d", 9569),
        ("growth followers guessed", "datasets/growthFollowers/rows/0/followersThousands", 56),
        ("occluded score promoted", "datasets/schoolActivity/rows/10/score", 5126),
        ("truncated name expanded", "datasets/schoolActivity/rows/1/schoolName", "未经核实的完整校名"),
        ("module label invented", "datasets/moduleInstallations/rows/0/rawLabel", "应用使用"),
        ("classification conflated", "datasets/schoolCategoriesWxj3/rows/2/count", 11),
        ("negative number", "datasets/moduleInstallations/rows/0/installedSchools", -1),
        ("boolean as integer", "datasets/overview/rows/0/schoolCount", True),
        ("missing field unit", "datasets/visitsDaily/fields/uv/unit", None, True),
        ("incorrect UV semantics", "datasets/visitsDaily/fields/uv/aggregation", "sumWithinPeriod"),
        ("injected simulation", "datasets/overview/rows/0/isSimulated", True),
        ("wrong screenshot", "datasets/leaveDaily/source", ["wxj1"]),
        ("fabricated snapshot date", "meta/periods/snapshot/start", "2026-10-15"),
        ("removed uncertainties", "meta/uncertainties", []),
    ]
    generated_cases = [
        ("wrong PV total", "datasets/visitsSummary/rows/0/pv7dTotal", 1),
        ("wrong install coverage", "datasets/moduleCoverage/rows/0/coveragePct", 99),
        ("wrong subtraction", "datasets/overviewDerived/rows/0/unfollowedCount", 0),
        ("missing provenance", "datasets/visitsDaily/rows/0/sourceRef", None, True),
        ("derived from missing role", "datasets/overviewDerived/rows/0/derivedFrom", ["data/smart-campus.source.json#/datasets/roleBreakdown/rows/0/userCount"]),
        ("hidden leave mismatch", "datasets/leaveReconciliation/rows/0/pointSumMinusDisplayedPeople", 0),
        ("stale hash", "meta/generation/sourceSha256", "0" * 64),
        ("nondeterministic timestamp", "meta/generation/generatedAt", "2026-10-16T00:00:00Z"),
    ]
    for cases, original, validator in (
        (source_cases, source, lambda doc: validate_source(doc, verify_images=False)),
        (generated_cases, generated, lambda doc: validate_generated(source, doc, raw_source)),
    ):
        for label, path, value, *delete in cases:
            mutated = copy.deepcopy(original)
            set_path(mutated, path, value, delete=bool(delete))
            expect_rejected(label, lambda: validator(mutated))
    for text in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
        expect_rejected("invalid JSON", lambda: API["load_json"](text))
    # Cross-check output bytes and ensure pure generation does not modify source.
    before = copy.deepcopy(source)
    require(API["serialize"](API["build"](source, raw_source)) == API["serialize"](API["build"](source, raw_source)), "Build is not deterministic")
    require(source == before, "Build modified the source object")
    return len(source_cases) + len(generated_cases) + 3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="also run in-memory negative/mutation tests")
    args = parser.parse_args()
    try:
        raw_source = API["SOURCE"].read_bytes()
        raw_generated = API["OUTPUT"].read_bytes()
        source = API["load_json"](raw_source)
        generated = API["load_json"](raw_generated)
        validate_source(source)
        validate_generated(source, generated, raw_source)
        require(raw_generated == API["serialize"](generated), "Generated JSON is not in canonical build format")
        if args.self_test:
            count = self_test(source, generated, raw_source)
            print(f"Self-test PASS: {count} invalid-input mutations rejected; deterministic and non-mutating build verified.")
        print("Smart-campus check PASS: 3 screenshot hashes; 14 source datasets; 21 generated datasets / 133 rows; no simulations.")
        print("Totals: schools 39/39; unfollowed 16432; 7-day PV 39460; daily UV sum 9569 person-days (NOT unique people).")
        print("Leave: displayed 455/418 people; daily point sums 995/810; numeric differences 540/392; visible-school sums 252/15.")
        print("Gaps preserved: role splits, 7-day unique UV, growth follower values, 2 occluded activity scores; partial windows explicitly labelled.")
    except (OSError, ValueError, KeyError, TypeError, IndexError, struct.error) as exc:
        print(f"Smart-campus check FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
