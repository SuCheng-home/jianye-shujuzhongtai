#!/usr/bin/env python3
"""校验扩展维度的分组守恒、口径、隐私字段和主快照版本。"""

import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN = {"XM", "XMPY", "SFZJH", "SJHM", "JZSJHM", "JTZZ", "TXDZ", "CSRQ", "LoginName", "OpenID",
             "student_no", "student_name", "tester_name", "tester_number", "id_card", "student_uuid",
             "vision_th_name", "cardId", "phoneNumber", "process_name", "actual_name", "user_json", "result_data"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def scan(value, path="root"):
    if isinstance(value, dict):
        require(not FORBIDDEN.intersection(value), f"{path}: 存在不允许导出的个人字段")
        for key, child in value.items():
            scan(child, f"{path}.{key}")
    elif isinstance(value, list):
        for child in value:
            scan(child, path + "[]")
    elif isinstance(value, float):
        require(math.isfinite(value), f"{path}: 非有限数值")


def validate(data):
    scan(data)
    require(data["meta"]["isSimulated"] is False, "数据库扩展维度不可混入模拟数据")
    require(data["meta"]["datasetCount"] == len(data["datasets"]), "数据集数量不一致")
    for key, dataset in data["datasets"].items():
        rows, total = dataset["rows"], dataset["totalRecords"]
        require(dataset["isSimulated"] is False, f"{key}: 不可混入模拟数据")
        require(bool(dataset["filter"] and dataset["note"] and dataset["sourceTable"]), f"{key}: 缺少口径说明")
        require(sum(row["count"] for row in rows) == total, f"{key}: 分组记录数不守恒")
        fields = [field["key"] for field in dataset["dimensions"]]
        if key.startswith("supervision."):
            require("type" in fields, f"{key}: 视导/检查原始类型不可丢失")
        combinations = set()
        for row in rows:
            require(set(fields).issubset(row), f"{key}: 缺少维度字段")
            require(isinstance(row["count"], int) and row["count"] > 0, f"{key}: 分组计数不合法")
            combination = tuple(row[field] for field in fields)
            require(combination not in combinations, f"{key}: 维度分组重复")
            combinations.add(combination)
            require(abs(row["sharePct"] - row["count"] / total * 100) <= 0.006, f"{key}: 占比分母错误")
            for field, value in row.items():
                if field.endswith("KnownRows"):
                    require(0 <= value <= row["count"], f"{key}: 已知值记录数越界")
                    summed = row[field.removesuffix("KnownRows") + "Sum"]
                    require((summed is None) == (value == 0), f"{key}: 空值被伪装为真实零")
            if "attendanceRate" in row:
                attended, expected = row["attendedPersonTimesSum"], row["expectedPersonTimesSum"]
                if expected:
                    require(attended is not None and 0 <= attended <= expected, f"{key}: 签到分子分母错误")
                    require(abs(row["attendanceRate"] - attended / expected * 100) <= 0.006, f"{key}: 出勤率错误")
                else:
                    require(row["attendanceRate"] is None, f"{key}: 无签到必须留空")
        if "uniqueSourceRecords" in dataset:
            if dataset["nonAdditiveAcrossLabels"]:
                require(total >= dataset["uniqueSourceRecords"], f"{key}: 标签记录丢失")
            else:
                require(total == dataset["uniqueSourceRecords"], f"{key}: 活动记录丢失")
    for table in data["quality"]["tables"]:
        require(table["rawRows"] == table["includedRows"] + table["excludedRows"], "源表过滤计数不守恒")
        if table["businessKey"]:
            require(table["includedRows"] == table["distinctBusinessKeys"] + table["missingBusinessKeyRows"] + table["rowsBeyondDistinctKeys"], "业务键计数不守恒")
        for dataset in data["datasets"].values():
            if dataset["sourceTable"] == table["sourceTable"]:
                require(dataset["totalRecords"] == table["includedRows"], "源表与数据集分母不一致")
    profiles = data["schoolProfiles"]["rows"]
    require(len({row["code"] for row in profiles}) == len(profiles), "学校代码重复")
    for row in profiles:
        for total_field, observed_field in [("teacherRecords", "teacherDataObserved"), ("studentRecords", "studentDataObserved"), ("classRecords", "classDataObserved")]:
            require(row[observed_field] == (row[total_field] > 0), "学校缺数标志错误")
        for field, denominator in [("studentsPerTeacherRecord", "teacherRecords"), ("studentsPerClassRecord", "classRecords")]:
            expected = round(row["studentRecords"] / row[denominator], 2) if row["studentRecords"] and row[denominator] else None
            require(row[field] == expected, "学校派生指标分母错误")
    for kind in ("teacher", "student"):
        actual = data["quality"]["baseSnapshotReconciliation"][kind + "Total"]["extracted"]
        require(sum(row[kind + "Records"] for row in profiles) + data["quality"][kind + "RecordsOutsideEnabledSchools"] == actual,
                "学校内外名册记录不守恒")
    return True


def main():
    path = ROOT / "data" / "jianye-dimensions.generated.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    validate(data)
    snapshot_path = ROOT / data["meta"]["baseSnapshot"]["file"]
    require(hashlib.sha256(snapshot_path.read_bytes()).hexdigest() == data["meta"]["baseSnapshot"]["sha256"],
            "主快照已经更新，请重新运行扩展维度生成器")
    print(f"校验通过：{len(data['datasets'])} 组数据集、{len(data['quality']['tables'])} 张事实表、{len(data['schoolProfiles']['rows'])} 所学校档案。")
    for field, item in data["quality"]["baseSnapshotReconciliation"].items():
        print(f"{field}：提取 {item['extracted']} / 原快照 {item['snapshot']} / {'一致' if item['matches'] else '时点不同，勿混用'}")


if __name__ == "__main__":
    main()
