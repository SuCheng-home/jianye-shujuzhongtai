#!/usr/bin/env python3
"""Offline, deterministic screenshot-data build; writes only its generated JSON."""

import copy
import hashlib
import json
import math
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/smart-campus.source.json"
OUTPUT = ROOT / "data/smart-campus.generated.json"
SOURCE_NAME = "data/smart-campus.source.json"
GENERATOR_NAME = "scripts/build-smart-campus-data.py"
CONFIDENCE = {"low": 0, "medium": 1, "high": 2}
SOURCE_DATASETS = {
    "overview", "overviewWxj3", "schoolCategoriesWxj1", "schoolCategoriesWxj3",
    "roleBreakdown", "visitsDaily", "visitsDeduplicated", "moduleInstallations",
    "leaveSummary", "leaveDaily", "leaveSchools", "schoolActivity",
    "growthSchools", "growthFollowers",
}
ROW_METADATA = {
    "id", "rawLabel", "schoolName", "schoolType", "rawScore", "date",
    "displayOrder", "dataStatus", "confidence", "labelConfidence", "note",
    "evidence", "isTruncated", "isOccluded", "isSimulated",
}
PROVENANCE_FIELDS = {"source", "region", "period", "sourceRef", "derivedFrom"}


def require(condition, message):
    """Do not use assert: checks must also run with python -O."""
    if not condition:
        raise ValueError(message)


def reject_constant(value):
    raise ValueError(f"Non-finite JSON number: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)


def serialize(document):
    return (json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def source_ref(dataset, index, field=None):
    suffix = f"/{field}" if field else ""
    return f"{SOURCE_NAME}#/datasets/{dataset}/rows/{index}{suffix}"


def resolve_ref(document, reference):
    prefix = SOURCE_NAME + "#/"
    require(isinstance(reference, str) and reference.startswith(prefix), "Invalid source reference")
    value = document
    for part in reference[len(prefix):].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


def percent(numerator, denominator):
    require(denominator > 0, "Percentage denominator must be positive")
    return float((Decimal(numerator) * 100 / Decimal(denominator)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def date_range(start, end):
    start, end = date.fromisoformat(start), date.fromisoformat(end)
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


def validate_structure(document, generated=False):
    require(set(document) == {"schemaVersion", "meta", "datasets"}, "Unexpected document keys")
    require(document["schemaVersion"] == "1.0.0", "Unsupported schema version")
    meta = document["meta"]
    for key in ("source", "periods", "dataStatusDefinitions", "confidenceDefinitions", "commonFields", "policies", "uncertainties", "gaps"):
        require(bool(meta.get(key)), f"Missing metadata: {key}")
    require(set(meta["dataStatusDefinitions"]) == {"screenshot", "derived", "simulated", "missing"}, "Invalid status dictionary")
    require(set(meta["confidenceDefinitions"]) == set(CONFIDENCE), "Invalid confidence dictionary")
    sources = {item["id"]: item for item in meta["source"]}
    require(len(sources) == len(meta["source"]) == 3, "Expected three distinct screenshots")
    require(set(sources) == {"wxj1", "wxj2", "wxj3"}, "Unknown screenshot ID")
    for sid, item in sources.items():
        require(item["fileName"] == sid + ".png", "Screenshot name mismatch")
        require(item["relativePath"] == f"docs/smart-campus/{sid}.png", "Unexpected screenshot path")
        require(len(item["sha256"]) == 64 and all(c in "0123456789abcdef" for c in item["sha256"]), "Invalid screenshot SHA256")
    for period in meta["periods"].values():
        require(bool(period["description"]), "Period description required")
        if period["start"] is None:
            require(period["end"] is None and period["inclusive"] is None, "Unknown time range must stay null")
        else:
            require(date.fromisoformat(period["start"]) <= date.fromisoformat(period["end"]), "Reversed date range")
            require(period["inclusive"] is True, "Date ranges must be inclusive")
    issues = meta["uncertainties"] + meta["gaps"]
    require(len({issue["id"] for issue in issues}) == len(issues), "Duplicate issue ID")
    for issue in issues:
        require(bool(issue["message"]) and bool(issue["source"]), "Issue needs evidence and explanation")
        require(set(issue["source"]) <= set(sources), "Issue references unknown screenshot")
        require(set(issue["datasets"]) <= set(document["datasets"]), "Issue references unknown dataset")
    for name, dataset in document["datasets"].items():
        require(bool(dataset["source"]) and set(dataset["source"]) <= set(sources), f"{name}: invalid sources")
        require(dataset["period"] in meta["periods"], f"{name}: missing period")
        require(bool(dataset["region"]) and bool(dataset["scope"]), f"{name}: missing scope/region")
        fields = dataset["fields"]
        require(bool(fields) and bool(dataset["rows"]), f"{name}: empty fields/rows")
        for field, definition in fields.items():
            require(not (field in ROW_METADATA or field in PROVENANCE_FIELDS), f"{name}: reserved numeric field")
            require(definition["type"] in {"integer", "number"}, f"{name}.{field}: invalid type")
            for key in ("description", "unit", "aggregation", "charts"):
                require(bool(definition[key]), f"{name}.{field}: missing {key}")
            require(isinstance(definition["charts"], list), f"{name}.{field}: charts must be a list")
            require("formula" in definition, f"{name}.{field}: missing formula declaration")
            require(definition["formula"] is None or isinstance(definition["formula"], str), "Invalid formula")
        ids = set()
        for row in dataset["rows"]:
            rid = row["id"]
            require(isinstance(rid, str) and rid and rid not in ids, f"{name}: duplicate/empty row ID")
            ids.add(rid)
            require(set(fields) <= set(row), f"{name}/{rid}: missing numeric field")
            allowed = set(fields) | ROW_METADATA | (PROVENANCE_FIELDS if generated else set())
            require(set(row) <= allowed, f"{name}/{rid}: undocumented row field")
            status = row["dataStatus"]
            require(status in {"screenshot", "derived", "missing"}, f"{name}/{rid}: this release does not permit simulated data")
            require(generated or status != "derived", f"{name}/{rid}: source cannot contain derived values")
            require(row["confidence"] in CONFIDENCE, f"{name}/{rid}: invalid confidence")
            require(row.get("isSimulated", False) is False, f"{name}/{rid}: simulation flag not allowed")
            if generated:
                require(row.get("isSimulated") is False, f"{name}/{rid}: explicit simulation flag required")
                require(row["period"] == dataset["period"] and row["source"], f"{name}/{rid}: invalid row provenance")
            if status == "missing":
                require(bool(row.get("note")), f"{name}/{rid}: missing value needs explanation")
            for flag in ("isTruncated", "isOccluded"):
                if flag in row:
                    require(type(row[flag]) is bool, f"{name}/{rid}: {flag} must be boolean")
            if "labelConfidence" in row:
                require(row["labelConfidence"] in CONFIDENCE, f"{name}/{rid}: invalid label confidence")
            if "date" in row:
                period = meta["periods"][dataset["period"]]
                require(row["date"] in date_range(period["start"], period["end"]), f"{name}/{rid}: out-of-period date")
                require(row["date"] == rid, f"{name}/{rid}: date ID mismatch")
            for field, definition in fields.items():
                value = row[field]
                if status == "missing":
                    require(value is None, f"{name}/{rid}/{field}: missing must be null, not zero")
                    continue
                numeric = type(value) is int if definition["type"] == "integer" else type(value) in (int, float)
                require(numeric and math.isfinite(value), f"{name}/{rid}/{field}: invalid numeric value")
                require(value >= 0 or definition.get("allowNegative") is True, f"{name}/{rid}/{field}: unexpected negative value")
                if definition["unit"] == "%":
                    require(0 <= value <= 100, f"{name}/{rid}/{field}: percentage out of range")
                if status == "derived":
                    require(bool(definition["formula"]), f"{name}/{rid}/{field}: derived formula required")
                else:
                    require(definition["formula"] is None, f"{name}/{rid}/{field}: screenshot formula must stay unknown")


def validate_source(source, verify_images=True):
    validate_structure(source)
    require(set(source["datasets"]) == SOURCE_DATASETS, "Source dataset contract changed")
    if verify_images:
        for item in source["meta"]["source"]:
            path = ROOT / item["relativePath"]
            require(hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"], f"Screenshot changed: {item['fileName']}")
    datasets = source["datasets"]
    overview = datasets["overview"]["rows"][0]
    require(overview["followerCount"] <= overview["userCount"], "Followers exceed users")
    require(percent(overview["followerCount"], overview["userCount"]) == overview["followerRatePct"], "Overall follower rate does not reconcile")
    for field in datasets["overviewWxj3"]["fields"]:
        require(overview[field] == datasets["overviewWxj3"]["rows"][0][field], "Repeated overview readings disagree")
    for name in ("schoolCategoriesWxj1", "schoolCategoriesWxj3"):
        require(sum(row["count"] for row in datasets[name]["rows"]) == overview["schoolCount"], f"{name}: classification total mismatch")
    for name in ("visitsDaily", "leaveDaily", "growthSchools", "growthFollowers"):
        period = source["meta"]["periods"][datasets[name]["period"]]
        require([row["date"] for row in datasets[name]["rows"]] == date_range(period["start"], period["end"]), f"{name}: dates must be complete, unique and sorted")
    for row in datasets["visitsDaily"]["rows"]:
        require(row["pv"] >= row["uv"], "Daily UV exceeds PV")
    for row in datasets["moduleInstallations"]["rows"]:
        require(row["installedSchools"] <= overview["schoolCount"], "Module installations exceed platform denominator")
    for name in ("roleBreakdown", "visitsDeduplicated", "growthFollowers"):
        require(all(row["dataStatus"] == "missing" for row in datasets[name]["rows"]), f"{name}: unavailable data must not be filled")
    for row in datasets["schoolActivity"]["rows"]:
        if row["isTruncated"] or row["isOccluded"]:
            require(row["schoolName"] is None and row["labelConfidence"] != "high", "Uncertain school name must not be expanded")
        else:
            require(row["schoolName"] == row["rawLabel"], "Unverified school-name normalization")
        if row["isOccluded"]:
            require(row["score"] is None and row["confidence"] == "low", "Occluded score must remain missing")
        else:
            require(row["rawScore"] == str(row["score"]), "Activity score disagrees with its raw text")


def field(description, unit, formula, charts, value_type="integer", allow_negative=False):
    result = {"type": value_type, "description": description, "unit": unit, "formula": formula, "aggregation": "none", "charts": charts}
    if allow_negative:
        result["allowNegative"] = True
    return result


def build(source, source_bytes):
    """Pure transformation; callers validate source before invoking this function."""
    result = copy.deepcopy(source)
    result["meta"]["title"] = "智慧校园截图数据（含显式派生指标）"
    result["meta"]["generation"] = {
        "sourceFile": SOURCE_NAME,
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "generator": GENERATOR_NAME,
        "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "deterministic": True,
        "generatedAt": None,
        "note": "无运行时间戳、随机数或外部依赖；相同来源和生成器产生完全相同字节。数值字段见各数据集fields。",
    }
    for name, dataset in result["datasets"].items():
        for index, row in enumerate(dataset["rows"]):
            row.update({"source": list(dataset["source"]), "region": dataset["region"], "period": dataset["period"], "sourceRef": source_ref(name, index), "isSimulated": False})

    def add_dataset(name, period, scope, fields, rows):
        result["datasets"][name] = {
            "source": sorted({sid for row in rows for sid in row["source"]}),
            "region": "派生计算；输入区域见derivedFrom指向的来源数据集",
            "period": period, "scope": scope, "fields": fields, "rows": rows,
        }

    def derived_row(rid, period, values, refs, **text):
        source_ids, confidence = set(), "high"
        for ref in refs:
            require(resolve_ref(source, ref) is not None, "Cannot derive a number from missing data")
            parts = ref.split("#", 1)[1].split("/")
            dataset = source["datasets"][parts[2]]
            row = dataset["rows"][int(parts[4])]
            source_ids.update(dataset["source"])
            if CONFIDENCE[row["confidence"]] < CONFIDENCE[confidence]:
                confidence = row["confidence"]
        return {"id": rid, **text, **values, "dataStatus": "derived", "confidence": confidence,
                "isSimulated": False, "source": sorted(source_ids), "period": period,
                "region": "派生计算；输入区域见derivedFrom", "derivedFrom": refs}

    datasets = source["datasets"]
    overview = datasets["overview"]["rows"][0]
    school_count = overview["schoolCount"]
    add_dataset("overviewDerived", "snapshot", "仅对用户概览进行算术补充，不生成角色拆分", {
        "unfollowedCount": field("未关注人数。", "人", "overview.userCount - overview.followerCount", ["kpi", "donut"]),
        "followerRateCalculatedPct": field("用于核对原图63.75%，不覆盖原图比例。", "%", "roundHalfUp(overview.followerCount / overview.userCount * 100, 2)", ["audit"], "number"),
    }, [derived_row("all", "snapshot", {"unfollowedCount": overview["userCount"] - overview["followerCount"], "followerRateCalculatedPct": percent(overview["followerCount"], overview["userCount"])}, [source_ref("overview", 0, "userCount"), source_ref("overview", 0, "followerCount")])])

    visits = datasets["visitsDaily"]["rows"]
    add_dataset("visitsSummary", "visits7d", "访问次数和人日合计；不是7天去重人数", {
        "pv7dTotal": field("7天访问次数合计。", "次", "sum(visitsDaily.pv)", ["kpi"]),
        "uvPersonDays": field("每日UV之和；重复用户可在多日出现，不能叫独立访客数。", "人日", "sum(visitsDaily.uv)", ["kpi", "audit"]),
    }, [derived_row("all", "visits7d", {"pv7dTotal": sum(row["pv"] for row in visits), "uvPersonDays": sum(row["uv"] for row in visits)}, [source_ref("visitsDaily", i, key) for i in range(len(visits)) for key in ("pv", "uv")])])

    for suffix in ("Wxj1", "Wxj3"):
        base = "schoolCategories" + suffix
        denominator_dataset = "overview" if suffix == "Wxj1" else "overviewWxj3"
        denominator = datasets[denominator_dataset]["rows"][0]["schoolCount"]
        add_dataset("categoryShares" + suffix, "snapshot", "该截图分类口径内的占比；四舍五入后百分数不强制凑100", {
            "sharePct": field("该类别占本截图39个学校/机构的比例。", "%", f"roundHalfUp({base}.count / {denominator_dataset}.schoolCount * 100, 2)", ["bar", "donut"], "number"),
        }, [derived_row(row["id"], "snapshot", {"sharePct": percent(row["count"], denominator)}, [source_ref(base, i, "count"), source_ref(denominator_dataset, 0, "schoolCount")], rawLabel=row["rawLabel"]) for i, row in enumerate(datasets[base]["rows"])])

    modules = datasets["moduleInstallations"]["rows"]
    add_dataset("moduleCoverage", "snapshot", "按图示安装数/39估算安装覆盖；不是应用使用率，且不确认适用机构范围", {
        "coveragePct": field("模块安装覆盖率（平台学校/机构基数口径）。", "%", "roundHalfUp(moduleInstallations.installedSchools / overview.schoolCount * 100, 2)", ["bar", "table"], "number"),
        "notInstalledSchools": field("按同一平台基数相减的未安装数量，不推断具体学校。", "个学校/机构", "overview.schoolCount - moduleInstallations.installedSchools", ["table"]),
    }, [derived_row(row["id"], "snapshot", {"coveragePct": percent(row["installedSchools"], school_count), "notInstalledSchools": school_count - row["installedSchools"]}, [source_ref("moduleInstallations", i, "installedSchools"), source_ref("overview", 0, "schoolCount")], rawLabel=row["rawLabel"]) for i, row in enumerate(modules)])
    add_dataset("moduleSummary", "snapshot", "仅可见13模块的统计，不代表平台全部模块或去重安装学校数", {
        "visibleModuleCount": field("当前截图可见模块数量。", "个模块", "len(moduleInstallations.rows)", ["audit"]),
        "visibleInstallationPairs": field("可见学校/机构-模块安装数之和，同一学校可在多模块重复计入。", "学校/机构-模块安装对", "sum(moduleInstallations.installedSchools)", ["audit"]),
    }, [derived_row("visible", "snapshot", {"visibleModuleCount": len(modules), "visibleInstallationPairs": sum(row["installedSchools"] for row in modules)}, [source_ref("moduleInstallations", i, "installedSchools") for i in range(len(modules))])])

    reconciliation = []
    for role, raw_label in (("teacher", "教师"), ("student", "学生")):
        total_field = role + "People"
        point_sum = sum(row[role] for row in datasets["leaveDaily"]["rows"])
        displayed = datasets["leaveSummary"]["rows"][0][total_field]
        visible = sum(row[total_field] for row in datasets["leaveSchools"]["rows"])
        refs = ([source_ref("leaveDaily", i, role) for i in range(30)]
                + [source_ref("leaveSummary", 0, total_field)]
                + [source_ref("leaveSchools", i, total_field) for i in range(4)])
        reconciliation.append(derived_row(role, "leave30d", {"dailyPointSum": point_sum, "pointSumMinusDisplayedPeople": point_sum - displayed, "visibleSchoolPeopleSum": visible}, refs, rawLabel=raw_label, note="仅作数值对账；日点值总和与显示人数口径不同，差额不是漏报人数，也不是累计人次。"))
    add_dataset("leaveReconciliation", "leave30d", "保留汇总与日点值的差异，不配平、不假定唯一人数或累计人次", {
        "dailyPointSum": field("30天曲线点值之和，仅作核对。", "日点值之和（非累计人次）", "sum(leaveDaily[role])", ["audit"]),
        "pointSumMinusDisplayedPeople": field("曲线点值总和减文字显示人数的数值差，非业务人数指标。", "数值差（口径不同）", "sum(leaveDaily[role]) - leaveSummary[role + 'People']", ["audit"], allow_negative=True),
        "visibleSchoolPeopleSum": field("4行可见学校的人数列之和，不能当作全区总数。", "人（可见表格列之和）", "sum(leaveSchools[role + 'People'])", ["audit"]),
    }, reconciliation)
    return result


def main():
    if len(sys.argv) != 1:
        print("Usage: python3 scripts/build-smart-campus-data.py", file=sys.stderr)
        return 2
    try:
        raw = SOURCE.read_bytes()
        source = load_json(raw)
        validate_source(source)
        result = build(source, raw)
        validate_structure(result, generated=True)
        encoded = serialize(result)
        changed = not OUTPUT.exists() or OUTPUT.read_bytes() != encoded
        if changed:
            OUTPUT.write_bytes(encoded)
        print(f"{'Generated' if changed else 'Unchanged'}: {OUTPUT}")
        print(f"{len(result['datasets'])} datasets; no simulated data; source and screenshot SHA256 recorded.")
    except (OSError, ValueError, KeyError, TypeError, IndexError) as exc:
        print(f"Smart-campus build FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
