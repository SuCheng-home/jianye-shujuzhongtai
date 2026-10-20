#!/usr/bin/env python3
"""只读生成大屏扩展维度；--source dumps 使用 SQL 备份，--source mysql 使用环境凭据。"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

from jianye_sources import dump_metadata, dump_rows, mysql_rows

ROOT = Path(__file__).resolve().parent.parent
UNKNOWN = "未填写"
NON_SCHOOLS = {"区教育局", "市教育局", "其它", "直属单位", "招办", "少年宫", "社区教育"}


def clean(value):
    if value is None or str(value).strip() == "":
        return None
    return html.unescape(str(value)).strip()


def month(value):
    text = clean(value)
    if not text:
        return None
    match = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if not match:
        return None
    try:
        parsed = date(*map(int, match.groups()))
    except ValueError:
        return None
    return parsed.strftime("%Y-%m")


def ratio(numerator, denominator):
    return round(numerator / denominator, 2) if denominator else None


def percent(numerator, denominator):
    return round(numerator / denominator * 100, 2) if denominator else None


def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def spec(database, table, title, fields, groups, *, rule=None, note="", key=None, sums=(), date_field=None):
    columns = list(dict.fromkeys(fields.split() + list(sums) + ([date_field] if date_field else [])
                                 + ([rule[0]] if rule else []) + ([key] if key else [])))
    return {"database": database, "table": table, "title": title, "columns": columns,
            "groups": groups, "rule": rule, "note": note, "key": key, "sums": sums, "dateField": date_field}


SPECS = [
    spec("u_st_jkxt", "jdts_js", "教职工名册", "ZZJGM XBM XK JSXL JSZW RKXDM GWZTM ZTM",
         {"bySchool": ("ZZJGM",), "byGenderCode": ("XBM",), "bySubject": ("XK",),
          "byEducation": ("JSXL",), "byTitle": ("JSZW",), "byTeachingStageCode": ("RKXDM",),
          "byJobStatusCode": ("GWZTM",), "byStatusCode": ("ZTM",), "schoolSubject": ("ZZJGM", "XK")},
         rule=("DeletionStateCode", "0"), key="Id",
         note="未删除名册记录，不等同在岗教师；任教学段、状态和性别保留源代码，不能按姓名推断。"),
    spec("u_st_jkxt", "jdts_xs", "学生名册", "ZZJGM XDM NJ XBM ZTM",
         {"bySchool": ("ZZJGM",), "byStageCode": ("XDM",), "byGradeCode": ("NJ",),
          "byGenderCode": ("XBM",), "byStatusCode": ("ZTM",), "schoolGrade": ("ZZJGM", "NJ")},
         rule=("IsDelete", "0"), key="Id",
         note="未删除名册记录，可能含毕业或其他学籍状态；不冒充当前在校生，不能用作历史学期分母。"),
    spec("u_st_jkxt", "jdts_classinfo", "班级档案", "OrgID Grade Stage ClassType",
         {"bySchool": ("OrgID",), "byStageCode": ("Stage",), "byGradeCode": ("Grade",),
          "schoolGrade": ("OrgID", "Grade"), "byClassTypeCode": ("ClassType",)}, key="Id",
         note="全量班级档案，源表无学期和删除状态；不能视为本学期教学班。"),
    spec("u_st_jkxt", "c_course", "课程资源", "GradeID SubjectID Status CourseType OrganizationID",
         {"bySubject": ("SubjectID",), "byGrade": ("GradeID",), "byStatusCode": ("Status",),
          "byTypeCode": ("CourseType",), "byOrganization": ("OrganizationID",),
          "byMonth": ("month",), "gradeSubject": ("GradeID", "SubjectID")},
         key="ID", sums=("LessonCount", "StudyCount", "PlayCountSum"), date_field="CreateDate",
         note="全部状态的课程资源记录；学习量、播放量为源字段累计计数，不是去重学习人数，不能当作月活。"),
    spec("u_st_jkxt", "c_lesson", "课时资源", "LessonType VideoStatus Status",
         {"byTypeCode": ("LessonType",), "byVideoStatusCode": ("VideoStatus",),
          "byStatusCode": ("Status",), "byMonth": ("month",)}, key="ID", sums=("PlayCount",), date_field="CreateDate",
         note="课时与课程是不同粒度，播放量不可跨两张表相加。"),
    spec("u_st_wyxt", "v_bulletin_jy", "通知源记录", "bulletin_type flow_state is_delete unit_name depart_name status_name is_send",
         {"byTypeCode": ("bulletin_type",), "byStatus": ("status_name",), "byDeleteFlag": ("is_delete",),
          "bySendFlag": ("is_send",), "byUnit": ("unit_name",), "byDepartment": ("depart_name",),
          "byMonth": ("month",)}, key="id", date_field="create_time",
         note="is_delete 未附语义说明，保留全部源记录并分列删除标志；非已发布/已发送通知数，不计算阅读率。"),
    spec("u_st_wyxt", "v_document_flow_jy", "局发文", "sSchoolName sDepartName sStatusName iUrgencyDegree iIssue flow_state",
         {"byUnit": ("sSchoolName",), "byDepartment": ("sDepartName",), "byStatus": ("sStatusName",),
          "byUrgencyCode": ("iUrgencyDegree",), "byIssuedFlag": ("iIssue",), "byMonth": ("month",)},
         rule=("isDelete", "0"), key="sCode", date_field="sCreateTime",
         note="源表注释明确 isDelete=0 未删除；保留各流程状态，归档状态不等同收文学校全部办结。"),
    spec("u_st_wyxt", "v_triple_review_jy", "三审三校节点", "app_name form_name task_type task_node unit_name status opt_type",
         {"byApp": ("app_name",), "byForm": ("form_name",), "byNodeType": ("task_type",),
          "byLatestNodeFlag": ("task_node",), "byUnit": ("unit_name",), "byStatusCode": ("status",),
          "byOperationCode": ("opt_type",), "byMonth": ("month",)}, key="instance_id", date_field="create_time",
         note="计数单位是流程节点行，同一流程多节点不是重复业务；distinctBusinessKeys 才是有实例ID的流程数，不从节点审批率推导流程办结率。"),
    spec("u_st_wyxt", "v_assessment_project_jy", "评比项目", "classify_name level report_type status unit_name",
         {"byCategory": ("classify_name",), "byLevelCode": ("level",), "byReportTypeCode": ("report_type",),
          "byStatusCode": ("status",), "byUnit": ("unit_name",), "byMonth": ("month",)},
         rule=("is_delete", "0"), key="task_code", date_field="create_time",
         note="教师评比/认定项目，不是学校综合督导；不将草稿和发布量混称已完成项目。"),
    spec("u_st_wyxt", "v_assessment_project_result_jy", "评比评分项", "type result_status item_type",
         {"byReviewTypeCode": ("type",), "byResultCode": ("result_status",),
          "byItemTypeCode": ("item_type",), "byMonth": ("month",)}, key="id", date_field="judge_time",
         note="一行是一个考核评分项，不是参评人数；不跨指标量纲计算平均分，不据此计算教师通过率。"),
    spec("u_st", "st_aizhty_sport_result", "AI 体育运动记录", "type school grade item_code unit score_enable has_test",
         {"byTypeCode": ("type",), "bySchool": ("school",), "byGrade": ("grade",),
          "byProject": ("item_code", "unit"), "byScoreEnabledFlag": ("score_enable",),
          "byTestFlag": ("has_test",), "byMonth": ("month",), "schoolMonth": ("school", "month")},
         date_field="created_date",
         note="按运动记录计数，不等同参与人数；所有成绩有效性状态分别保留，不导出个体成绩、身高体重或健康报告。"),
    spec("u_st", "st_wyydzhty_assessment", "有道体育测评", "school_uuid grade_name project_id level status",
         {"bySchoolId": ("school_uuid",), "byGrade": ("grade_name",), "byProjectId": ("project_id",),
          "byLevel": ("level",), "byStatusCode": ("status",), "byMonth": ("month",)},
         key="original_id", date_field="create_time",
         note="测评记录，等级和可用状态保留源值；学校UUID未映射统一代码，不能同名猜测，也不跨项目计算达标率。"),
    spec("u_st", "t_wyyd_zhty_student_scores", "体育项目成绩记录", "sprot_item",
         {"byProject": ("sprot_item",), "byMonth": ("month",), "projectMonth": ("sprot_item", "month"),
          "bySourceDate": ("sport_date",), "projectSourceDate": ("sprot_item", "sport_date")},
         key="id", date_field="sport_date",
         note="只统计项目记录量，不导出个人成绩；源表没有学校字段，不能补造学校维度或与其他体育系统简单相加。源日期仅月日、无年份，原始标签可分组但不能视为跨年时间序列；完整年月保留null，不从导出时间补年份。"),
    spec("u_st", "st_xsry_student_honor", "学生荣誉", "school_name grade_name honor_type_name cert_type award_level_name award_type_name school_time_name",
         {"bySchool": ("school_name",), "byGrade": ("grade_name",), "byHonorLevel": ("honor_type_name",),
          "byCertificateType": ("cert_type",), "byAwardLevel": ("award_level_name",),
          "byAwardType": ("award_type_name",), "byTerm": ("school_time_name",), "byMonth": ("month",)},
         rule=("is_delete", "1"), key="id", date_field="issue_date",
         note="源注释明确1未删除、2已删除；按荣誉记录计数，不等同获奖学生去重人数，不使用个人学号。"),
]

LOOKUPS = {
    "u_st_jkxt": {
        "jdts_organization": "Id Code Name CategoryID SchoolType DeletionStateCode IsEnabled".split(),
        "jdts_organizationcategory": "Id CategoryName".split(),
        "jdts_organizationtype": "TypeCode TypeName".split(),
        "c_subject": "ID SubjectName".split(), "c_grade": "ID GradeName".split(),
        "jdts_infodic": "Id Code Name DeletionStateCode IsEnabled".split(),
        "jdts_infodicitem": "InfoDicID Code Name DeletionStateCode IsEnabled".split(),
    },
    "u_st": {"st_aizhty_project": "type code name unit".split()},
}

FIELD_LABELS = {
    "ZZJGM": "学校组织代码", "XBM": "性别代码", "XK": "任教学科原值", "JSXL": "教师学历原值",
    "JSZW": "教师职务原值", "RKXDM": "任教学段代码", "GWZTM": "岗位状态代码", "ZTM": "名册状态代码",
    "XDM": "学生学段代码", "NJ": "年级原值", "OrgID": "学校组织UUID", "Grade": "年级原值",
    "Stage": "学段代码", "ClassType": "班级类型代码", "GradeID": "课程年级ID", "SubjectID": "课程学科ID",
    "Status": "源状态代码", "CourseType": "课程类型代码", "OrganizationID": "课程组织ID",
    "LessonType": "课时类型代码", "VideoStatus": "视频状态代码", "month": "业务日期月份",
    "bulletin_type": "通知类型代码", "status_name": "流程状态名称", "is_delete": "源删除标志",
    "is_send": "源发送标志", "unit_name": "单位名称", "depart_name": "部门名称",
    "sSchoolName": "发文单位名称", "sDepartName": "发文部门名称", "sStatusName": "流程步骤名称",
    "iUrgencyDegree": "紧急程度代码", "iIssue": "签发标志", "app_name": "上报应用名称",
    "form_name": "应用菜单名称", "task_type": "流程节点类型", "task_node": "最新节点标志",
    "status": "源状态代码", "opt_type": "操作类型代码", "classify_name": "评比分类名称",
    "level": "源级别/等级", "report_type": "参评对象类型代码", "type": "源类型代码",
    "result_status": "评分项结果状态代码", "item_type": "评分项类型代码", "school": "学校原名",
    "grade": "年级原值", "item_code": "运动项目代码", "unit": "项目单位",
    "score_enable": "成绩有效标志原值", "has_test": "测试标志原值", "school_uuid": "体育学校UUID",
    "grade_name": "年级原值", "project_id": "体育项目ID", "sprot_item": "运动项目原值",
    "sport_date": "运动日期原始标签（年份未展示）",
    "school_name": "学校原名", "honor_type_name": "荣誉等级", "cert_type": "证书类型",
    "award_level_name": "获奖等级", "award_type_name": "获奖类型", "school_time_name": "学期原名",
    "term": "学期", "week": "教学周原值", "stage": "学段原值", "subject": "学科标签",
    "schoolId": "研训学校源ID", "levelName": "研训级别",
    "rating": "视导评级", "course": "源课程字段（非学科字典）", "group": "听课分组",
}


class Cube:
    def __init__(self, fields, sums=()):
        self.fields, self.sums = fields, sums
        self.counts = Counter()
        self.totals = defaultdict(Counter)
        self.known = defaultdict(Counter)

    def add(self, row):
        key = tuple(clean(row.get(field)) for field in self.fields)
        self.counts[key] += 1
        for field in self.sums:
            value = number(row.get(field))
            if value is not None:
                self.totals[key][field] += value
                self.known[key][field] += 1

    def export(self):
        total = sum(self.counts.values())
        result = []
        for key, count in sorted(self.counts.items(), key=lambda item: (-item[1], tuple(x or "" for x in item[0]))):
            row = {field: value for field, value in zip(self.fields, key)}
            row.update(count=count, sharePct=percent(count, total))
            for field in self.sums:
                row[field + "Sum"] = round(self.totals[key][field], 2) if self.known[key][field] else None
                row[field + "KnownRows"] = self.known[key][field]
            result.append(row)
        return result


def source_key(item):
    return f"{item['database']}.{item['table']}"


def collect(source, data_dir):
    specs = {source_key(item): item for item in SPECS}
    states = {key: {"rawRows": 0, "includedRows": 0, "keys": set(), "missingBusinessKeyRows": 0,
                    "filterDistribution": Counter(), "dateRange": [None, None], "invalidDateRows": 0,
                    "cubes": {name: Cube(fields, item["sums"]) for name, fields in item["groups"].items()}}
              for key, item in specs.items()}
    lookups, sources = {}, []
    for database in ("u_st_jkxt", "u_st_wyxt", "u_st"):
        selections = dict(LOOKUPS.get(database, {}))
        selections.update({item["table"]: item["columns"] for item in SPECS if item["database"] == database})
        if source == "dumps":
            path = data_dir / f"{database}.sql"
            sources.append({"database": database, **dump_metadata(path)})
            iterator = dump_rows(path, selections)
        else:
            sources.append({"database": database, "status": "mysql", "queriedAt": datetime.now(timezone.utc).isoformat()})
            iterator = mysql_rows(database, selections)
        for table, row in iterator:
            key = f"{database}.{table}"
            if key not in specs:
                lookups.setdefault(table, []).append(row)
                continue
            item, state = specs[key], states[key]
            state["rawRows"] += 1
            rule = item["rule"]
            if rule:
                value = clean(row[rule[0]])
                state["filterDistribution"][value or UNKNOWN] += 1
                if value != rule[1]:
                    continue
            state["includedRows"] += 1
            if item["key"]:
                value = clean(row[item["key"]])
                if value is None:
                    state["missingBusinessKeyRows"] += 1
                else:
                    state["keys"].add(value)
            if item["dateField"]:
                row["month"] = month(row[item["dateField"]])
                if row["month"]:
                    lo, hi = state["dateRange"]
                    state["dateRange"] = [min(lo or row["month"], row["month"]), max(hi or row["month"], row["month"])]
                else:
                    state["invalidDateRows"] += 1
            for cube in state["cubes"].values():
                cube.add(row)
        print(f"已只读聚合 {database}", flush=True)
    return states, lookups, sources


CODE_LABELS = {
    "v_document_flow_jy.iIssue": {"0": "未签发", "1": "已签发"},
    "v_triple_review_jy.status": {"0": "未审批", "1": "已审批"},
    "v_triple_review_jy.task_node": {"0": "非最新节点", "1": "最新节点"},
    "v_triple_review_jy.opt_type": {"1": "提交", "2": "撤回", "3": "退回", "4": "转审"},
    "v_assessment_project_jy.level": {"1": "区级", "2": "校级"},
    "v_assessment_project_jy.report_type": {"1": "学校", "2": "教师"},
    "v_assessment_project_jy.status": {"0": "草稿", "1": "发布", "2": "结束"},
    "v_assessment_project_result_jy.type": {"0": "自评", "1": "校评", "2": "区评"},
    "v_assessment_project_result_jy.result_status": {"0": "待定", "1": "通过", "2": "不通过"},
    "v_assessment_project_result_jy.item_type": {"0": "基础评分", "1": "附加分"},
    "st_aizhty_sport_result.type": {"1": "校内体育测试", "2": "校内体育锻炼", "3": "校外体育云作业", "4": "校园云体锻"},
}


def dimension_fields(fields, table=None):
    result = []
    for field in fields:
        definition = {"key": field, "label": FIELD_LABELS.get(field, field), "missingValue": None}
        if f"{table}.{field}" in CODE_LABELS:
            definition["valueLabels"] = CODE_LABELS[f"{table}.{field}"]
            definition["labelSource"] = "源表字段注释；未列出的代码保留原值，不套用其他表的含义"
        if field in ("SubjectID", "GradeID"):
            definition["lookup"] = "dictionaries." + ("courseSubjects" if field == "SubjectID" else "courseGrades")
        if field in ("ZZJGM", "OrgID"):
            definition["lookup"] = "schoolProfiles.rows"
            definition["lookupKey"] = "code" if field == "ZZJGM" else "organizationId"
            definition["lookupNote"] = "名录仅包含启用学校，未匹配编码保留，不猜测名称"
        result.append(definition)
    return result


def metric_fields(sums=()):
    result = {
        "count": {"label": "纳入统计的源记录数", "unit": "条", "formula": "COUNT(source rows after filter)"},
        "sharePct": {"label": "该分组占全部纳入记录的比例", "unit": "%", "formula": "count / dataset.totalRecords * 100",
                     "note": "交叉表为占全表的比例，不是校内/学期内比例；重分组时需重算分母。"},
    }
    for field in sums:
        result[field + "Sum"] = {"label": f"源字段 {field} 已知值合计", "unit": "源字段计数",
                                 "formula": f"SUM(valid numeric {field})", "note": "无已知数值时null；不代表去重人数。"}
        result[field + "KnownRows"] = {"label": f"{field} 已填数值记录数", "unit": "条", "formula": "COUNT(valid numeric values)"}
    return result


def export_datasets(states, source):
    datasets, quality = {}, []
    for item in SPECS:
        key, state = source_key(item), states[source_key(item)]
        rule = item["rule"]
        quality.append({"sourceTable": key, "rawRows": state["rawRows"], "includedRows": state["includedRows"],
                        "excludedRows": state["rawRows"] - state["includedRows"],
                        "filterDistribution": dict(state["filterDistribution"]), "businessKey": item["key"],
                        "distinctBusinessKeys": len(state["keys"]) if item["key"] else None,
                        "missingBusinessKeyRows": state["missingBusinessKeyRows"] if item["key"] else None,
                        "rowsBeyondDistinctKeys": state["includedRows"] - state["missingBusinessKeyRows"] - len(state["keys"]) if item["key"] else None,
                        "invalidDateRows": state["invalidDateRows"] if item["dateField"] else None})
        for name, cube in state["cubes"].items():
            datasets[f"{item['table']}.{name}"] = {
                "title": item["title"] + " · " + " × ".join(FIELD_LABELS.get(field, field) for field in cube.fields),
                "sourceTable": key, "dataStatus": "mysql_dump" if source == "dumps" else "mysql",
                "isSimulated": False, "filter": f"{rule[0]} = {rule[1]}" if rule else "源表全量，无额外状态过滤",
                "grain": "源记录行", "deduplication": "不自动按业务键合并；重复键计数见 quality.tables",
                "note": item["note"], "dimensions": dimension_fields(cube.fields, item["table"]), "metrics": metric_fields(item["sums"]),
                "totalRecords": state["includedRows"], "dateField": item["dateField"],
                "observedMonthRange": state["dateRange"], "recommendedCharts": ["趋势图" if "month" in cube.fields else "排行/构成图", "交叉表" if len(cube.fields) > 1 else "明细汇总表"],
                "rows": cube.export(),
            }
    return datasets, quality


def school_profiles(states, lookups):
    organizations = lookups["jdts_organization"]
    categories = {clean(row["Id"]): clean(row["CategoryName"]) for row in lookups["jdts_organizationcategory"]}
    types = {clean(row["TypeCode"]): clean(row["TypeName"]) for row in lookups["jdts_organizationtype"]}
    teachers = states["u_st_jkxt.jdts_js"]["cubes"]["bySchool"].counts
    students = states["u_st_jkxt.jdts_xs"]["cubes"]["bySchool"].counts
    classes = states["u_st_jkxt.jdts_classinfo"]["cubes"]["bySchool"].counts
    result = []
    for org in organizations:
        category = categories.get(clean(org["CategoryID"]))
        if clean(org["DeletionStateCode"]) != "0" or clean(org["IsEnabled"]) != "1" or category in NON_SCHOOLS:
            continue
        code, org_id = clean(org["Code"]), clean(org["Id"])
        tc, sc, cc = teachers[(code,)], students[(code,)], classes[(org_id,)]
        result.append({"code": code, "organizationId": org_id, "name": clean(org["Name"]),
                       "category": category, "orgType": types.get(clean(org["SchoolType"])),
                       "stages": category.split("&") if category else [], "kindergarten": category == "幼儿园",
                       "teacherRecords": tc, "studentRecords": sc, "classRecords": cc,
                       "studentsPerTeacherRecord": ratio(sc, tc) if sc else None,
                       "studentsPerClassRecord": ratio(sc, cc) if sc else None,
                       "teacherDataObserved": tc > 0, "studentDataObserved": sc > 0, "classDataObserved": cc > 0})
    return sorted(result, key=lambda row: row["code"] or "")


def build_dictionaries(lookups):
    dictionaries = {}
    items = lookups["jdts_infodicitem"]
    for dictionary in lookups["jdts_infodic"]:
        if clean(dictionary["DeletionStateCode"]) != "0" or clean(dictionary["IsEnabled"]) != "1":
            continue
        rows = [{"code": clean(item["Code"]), "name": clean(item["Name"])} for item in items
                if item["InfoDicID"] == dictionary["Id"] and clean(item["DeletionStateCode"]) == "0" and clean(item["IsEnabled"]) == "1"]
        dictionaries[clean(dictionary["Code"])] = {"name": clean(dictionary["Name"]), "items": rows}
    return {"sourceCodeDictionaries": dictionaries,
            "courseSubjects": [{"id": row["ID"], "name": clean(row["SubjectName"])} for row in lookups["c_subject"]],
            "courseGrades": [{"id": row["ID"], "name": clean(row["GradeName"])} for row in lookups["c_grade"]],
            "sportsProjects": [{"type": row["type"], "code": row["code"], "name": clean(row["name"]), "unit": clean(row["unit"])} for row in lookups["st_aizhty_project"]],
            "note": "字典保留源表代码和名称；未确认代码字段到字典的映射时不自动翻译。体育项目键为type+code。"}


def snapshot_cubes(snapshot, datasets):
    training_rows, supervision_rows = [], []
    for term in snapshot["training"]["terms"]:
        for activity in term["activities"]:
            training_rows.append({**activity, "term": term["name"]})
    for term in snapshot["supervision"]["terms"]:
        for activity in term["activities"]:
            supervision_rows.append({**activity, "term": term["name"], "month": month(activity["date"]),
                                     "group": "校内听课" if activity["type"] == "校内听课（学校）" else "其他视导与检查"})
    groups = [
        ("training", training_rows, {"term": ("term",), "termMonth": ("term", "month"),
                                    "termWeek": ("term", "week"), "termLevel": ("term", "levelName"),
                                    "termSchool": ("term", "schoolId"), "termStage": ("term", "stage"),
                                    "termSubject": ("term", "subject")}),
        ("supervision", supervision_rows, {"termType": ("term", "type"),
                                         "termMonth": ("term", "type", "month"), "termStage": ("term", "type", "stage"),
                                         "termRating": ("term", "type", "rating"), "termGroup": ("term", "type", "group"),
                                         "schoolRating": ("term", "type", "school", "rating"),
                                         "termCourse": ("term", "type", "course")}),
    ]
    for topic, records, definitions in groups:
        for name, fields in definitions.items():
            sums = ("hours", "expectedPersonTimes", "attendedPersonTimes") if topic == "training" else ()
            cube = Cube(fields, sums)
            multi = topic == "training" and name in ("termStage", "termSubject")
            for activity in records:
                if multi:
                    field, source = ("stage", "stageCodes") if name == "termStage" else ("subject", "subjects")
                    for value in dict.fromkeys(activity[source] or [None]):
                        cube.add({**activity, field: value})
                else:
                    cube.add(activity)
            rows = cube.export()
            if topic == "training":
                for row in rows:
                    expected, attended = row["expectedPersonTimesSum"], row["attendedPersonTimesSum"]
                    row["attendanceRate"] = percent(attended, expected) if attended is not None else None
            metrics = metric_fields(sums)
            if topic == "training":
                metrics["hoursSum"]["unit"] = "学时"
                metrics["expectedPersonTimesSum"]["unit"] = "人次"
                metrics["attendedPersonTimesSum"]["unit"] = "人次"
                metrics["attendanceRate"] = {"label": "有签到数据活动的出勤率", "unit": "%",
                                             "formula": "attendedPersonTimesSum / expectedPersonTimesSum * 100",
                                             "note": "活动×用户去重后的累计人次，不是去重教师人数；无签到返回null。"}
            note = "多学科/多学段活动分别计入标签，不能跨标签相加当活动总数。" if multi else "跨学期累计记录；不能以当前师生名册计算历史参与率。"
            if topic == "supervision":
                note = "包括听课、开学检查、集体备课检查等类型；纯听课统计必须先按type筛选，再重算分母，不将检查数冒充听课数。"
            dimensions = dimension_fields(fields)
            for dimension in dimensions:
                if topic == "supervision" and dimension["key"] == "type":
                    dimension["label"] = "视导/检查原始类型名称"
            datasets[f"{topic}.{name}"] = {
                "title": ("研训" if topic == "training" else "视导与检查") + " · " + " × ".join(d["label"] for d in dimensions),
                "sourceTable": "data/jianye.generated.json#" + topic, "dataStatus": "derived", "isSimulated": False,
                "sourceGeneratedAt": snapshot["meta"]["generatedAt"],
                "filter": "继承主快照有效研训活动/未删除视导记录，不重新查询明细", "grain": "标签关联" if multi else "活动/视导检查记录",
                "deduplication": "研训签到沿用主快照的活动×用户去重结果；跨活动仍按人次累计。" if topic == "training" else "主快照记录行计数，不当作被听课教师去重人数。",
                "note": note,
                "nonAdditiveAcrossLabels": multi, "uniqueSourceRecords": len(records),
                "dimensions": dimensions, "metrics": metrics, "totalRecords": sum(cube.counts.values()),
                "recommendedCharts": ["趋势图" if "month" in fields or "week" in fields else "排行/构成图", "交叉表"], "rows": rows,
            }


def build(source="dumps", data_dir=ROOT.parent / "data", output=ROOT / "data" / "jianye-dimensions.generated.json"):
    states, lookups, sources = collect(source, data_dir)
    datasets, tables = export_datasets(states, source)
    snapshot_path = ROOT / "data" / "jianye.generated.json"
    snapshot_bytes = snapshot_path.read_bytes()
    snapshot = json.loads(snapshot_bytes)
    snapshot_cubes(snapshot, datasets)
    profiles = school_profiles(states, lookups)
    registered_codes = {row["code"] for row in profiles}
    result = {
        "meta": {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                 "district": "建邺区", "generator": "scripts/build-jianye-dimensions.py", "sources": sources,
                 "baseSnapshot": {"file": "data/jianye.generated.json", "generatedAt": snapshot["meta"]["generatedAt"],
                                  "sha256": hashlib.sha256(snapshot_bytes).hexdigest()},
                 "datasetCount": len(datasets), "sourceTableCount": len(tables) + sum(len(t) for t in LOOKUPS.values()),
                 "isSimulated": False, "note": "扩展快照独立存储，按需读取，不自动加入现有首页JS包；数据库只读，SQL备份只解析不执行。"},
        "usage": {"datasets": "以数据集键索引；dimensions为筛选/分组字段，metrics解释单位/公式，rows可直接供图表使用。",
                  "missing": "维度未填写用null；已观测为0与缺数据分开；缺失日期单列null桶，不估算日期。",
                  "dateQuality": "quality.tables.invalidDateRows表示无法得到完整年月的记录数，含缺年份或未填日期，不直接认定源日期错误；体育sport_date原始月日标签无年份，不用于跨年趋势。",
                  "scope": "本文件是源系统覆盖范围，不必等于智慧校园39个接入单位；截图指标存于smart-campus.generated.json，不能混用分母。",
                  "sorting": "rows默认按记录量倒序；趋势图绘制前按month/term/week排序。",
                  "privacy": "不输出姓名、证件、联系方式、学生学号、生日、个人成绩、健康、工资或审批正文。学校/单位维度为业务组织信息。",
                  "refreshDumps": "python3 scripts/build-jianye-dimensions.py --source dumps",
                  "refreshMysql": "python3 scripts/build-jianye-dimensions.py --source mysql（凭据来自JY_DB_*或MYSQL_PWD）",
                  "check": "python3 scripts/check-jianye-dimensions.py"},
        "schoolProfiles": {"sourceTables": ["u_st_jkxt.jdts_organization", "u_st_jkxt.jdts_js", "u_st_jkxt.jdts_xs", "u_st_jkxt.jdts_classinfo"],
                           "dataStatus": "mysql_dump" if source == "dumps" else "mysql", "isSimulated": False,
                           "note": "启用且未删除学校；教师/学生统计未删除名册行，班级为全量档案，师生档案比/班级档案比不是正式在校生师比或班额。0表示无匹配记录，不证明实际师生为0。",
                           "fields": {"code": "学校统一组织代码", "organizationId": "组织UUID，供班级OrgID精确关联",
                                      "teacherRecords": "未删除教职工名册记录数", "studentRecords": "未删除学生名册记录数", "classRecords": "班级档案记录数",
                                      "studentsPerTeacherRecord": "studentRecords/teacherRecords，任一方无数据时null",
                                      "studentsPerClassRecord": "studentRecords/classRecords，任一方无数据时null",
                                      "teacherDataObserved/studentDataObserved/classDataObserved": "是否有匹配源记录；不用于断言业务实际为零"},
                           "rows": profiles},
        "dictionaries": {**build_dictionaries(lookups), "training": snapshot["training"]["dict"],
                         "supervision": snapshot["supervision"]["dict"]}, "datasets": datasets,
        "quality": {"tables": tables,
                    "teacherRecordsOutsideEnabledSchools": sum(n for (code,), n in states["u_st_jkxt.jdts_js"]["cubes"]["bySchool"].counts.items() if code not in registered_codes),
                    "studentRecordsOutsideEnabledSchools": sum(n for (code,), n in states["u_st_jkxt.jdts_xs"]["cubes"]["bySchool"].counts.items() if code not in registered_codes),
                    "baseSnapshotReconciliation": {field: {"snapshot": snapshot["base"][field], "extracted": states[table]["includedRows"],
                                                          "matches": snapshot["base"][field] == states[table]["includedRows"]}
                                                   for field, table in [("teacherTotal", "u_st_jkxt.jdts_js"), ("studentTotal", "u_st_jkxt.jdts_xs"), ("classTotal", "u_st_jkxt.jdts_classinfo")]},
                    "warnings": ["各源系统统计时点不同，generatedAt是生成时刻，不是所有业务数据截至日期。",
                                 "学校组织Code、组织UUID、研训schoolId、体育school_uuid、视导th_unit_code不是同一键；未核准映射不得串联。",
                                 "业务键重复不直接认定为脏数据；三审三校同一实例包含多条合法节点。",
                                 "课程/体育/通知均保留源状态，不把原始记录量命名为正式使用量、达标量或发布量。",
                                 "本文件没有虚构或补齐数据库数值；截图存在的数据须从独立智慧校园快照读取。"]},
    }
    from importlib.util import module_from_spec, spec_from_file_location
    module_spec = spec_from_file_location("check_dimensions", ROOT / "scripts" / "check-jianye-dimensions.py")
    checker = module_from_spec(module_spec)
    module_spec.loader.exec_module(checker)
    checker.validate(result)
    encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(output)
    print(f"扩展维度：{len(datasets)} 组，学校档案：{len(profiles)}，文件：{output.name}（{output.stat().st_size / 1024:.0f} KiB）")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("dumps", "mysql"), default="dumps")
    parser.add_argument("--data-dir", type=Path, default=ROOT.parent / "data")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "jianye-dimensions.generated.json")
    args = parser.parse_args()
    build(args.source, args.data_dir, args.output)
