#!/usr/bin/env python3
"""从本地建邺三库聚合出大屏快照 data/jianye.generated.json。

只读查询，不修改任何源库；输出只含聚合值与必要的业务展示字段，
不输出证件号、手机号、家庭住址、健康或工资明细。

凭据一律来自环境变量，脚本内不写死：
    JY_DB_HOST      默认 127.0.0.1
    JY_DB_PORT      默认 3306
    JY_DB_USER      默认 root
    JY_DB_PASSWORD  或标准 MYSQL_PWD
用法：
    MYSQL_PWD=... python3 scripts/build-jianye-data.py
"""

from __future__ import annotations

import html
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "jianye.generated.json"

DB_WYXT = "u_st_wyxt"
DB_JKXT = "u_st_jkxt"

# 建邺区在 DataV GeoAtlas 的 adcode；区界素材单独放 data/jianye-map.json。
DISTRICT = {"name": "建邺区", "adcode": 320105}

# 研训学段代码与玄武原版 YX_DICT.seg 顺序一致，迁移模板时无需改字典。
STAGE_DICT = [
    {"code": 1, "name": "幼教"},
    {"code": 2, "name": "小学"},
    {"code": 3, "name": "初中"},
    {"code": 4, "name": "高中"},
    {"code": 5, "name": "职教"},
    {"code": 9, "name": "特教"},
]

# 非学校机构类别：不进学校名录，也不进师生基数。
NON_SCHOOL_CATEGORIES = {"区教育局", "市教育局", "其它", "直属单位", "招办", "少年宫", "社区教育"}
KINDERGARTEN = "幼儿园"

gaps: list[str] = []


def gap(message: str) -> None:
    if message not in gaps:
        gaps.append(message)


def connect_args() -> list[str]:
    return [
        "mysql",
        "--default-character-set=utf8mb4",
        "-N",
        "-B",
        "-r",
        "-h",
        os.environ.get("JY_DB_HOST", "127.0.0.1"),
        "-P",
        os.environ.get("JY_DB_PORT", "3306"),
        "-u",
        os.environ.get("JY_DB_USER", "root"),
    ]


def db_env() -> dict[str, str]:
    """口令走 MYSQL_PWD 环境变量，不出现在命令行参数里（进程列表可见）。"""
    env = dict(os.environ)
    password = os.environ.get("JY_DB_PASSWORD") or os.environ.get("MYSQL_PWD")
    if password:
        env["MYSQL_PWD"] = password
    return env


def sql_str(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def query_json(sql: str) -> object:
    """执行返回单个 JSON 值的查询并解析。标量结果也要 CAST 成 JSON 才能取出。"""
    statement = f"SET SESSION group_concat_max_len=1073741823; SELECT CAST(({sql}) AS JSON);"
    result = subprocess.run(
        connect_args() + ["-e", statement],
        capture_output=True,
        text=True,
        env=db_env(),
    )
    if result.returncode != 0:
        raise SystemExit(f"查询失败：{result.stderr.strip()}\nSQL: {sql[:400]}")
    raw = result.stdout.strip()
    if raw in ("", "NULL"):
        return None
    return json.loads(raw)


def decode_text(value: object) -> object:
    """源库标题里带 &mdash; / &ldquo; 等 HTML 实体，展示前还原。"""
    if not isinstance(value, str):
        return value
    return html.unescape(value).strip()


# ---------------------------------------------------------------- 学校名录与基数


def build_schools() -> list[dict]:
    rows = query_json(f"""
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'code', o.Code,
            'name', o.Name,
            'shortName', o.ShortName,
            'category', c.CategoryName,
            'orgType', t.TypeName,
            'statusNote', o.Description,
            'sortCode', o.SortCode,
            'teacherCount', tc.n,
            'studentCount', sc.n
        ))
        FROM {DB_JKXT}.jdts_organization o
        JOIN {DB_JKXT}.jdts_organizationcategory c ON c.Id = o.CategoryID
        LEFT JOIN {DB_JKXT}.jdts_organizationtype t ON t.TypeCode = o.SchoolType
        LEFT JOIN (
            SELECT ZZJGM code, COUNT(*) n FROM {DB_JKXT}.jdts_js
            WHERE DeletionStateCode = 0 GROUP BY ZZJGM
        ) tc ON tc.code = o.Code
        LEFT JOIN (
            SELECT ZZJGM code, COUNT(*) n FROM {DB_JKXT}.jdts_xs
            WHERE IsDelete = 0 GROUP BY ZZJGM
        ) sc ON sc.code = o.Code
        WHERE o.DeletionStateCode = 0 AND o.IsEnabled = 1
          AND c.CategoryName NOT IN ({", ".join(repr(x) for x in sorted(NON_SCHOOL_CATEGORIES))})
    """)
    schools = []
    for row in rows or []:
        schools.append({
            "code": row["code"],
            "name": decode_text(row["name"]),
            "shortName": decode_text(row["shortName"]) or None,
            "category": row["category"],
            "orgType": row["orgType"],
            "statusNote": (decode_text(row["statusNote"]) or None),
            "teacherCount": row["teacherCount"],
            "studentCount": row["studentCount"],
            "kindergarten": row["category"] == KINDERGARTEN,
            "stages": split_stages(row["category"]),
        })
    schools.sort(key=lambda s: (s["kindergarten"], s["category"], s["code"] or ""))
    return schools


def split_stages(category: str | None) -> list[str]:
    """一贯制类别拆成学段列表；类别名本身就是「小学&初中&高中」这种写法。"""
    if not category:
        return []
    return [part for part in category.split("&") if part]


def build_base() -> dict:
    counts = query_json(f"""
        SELECT JSON_OBJECT(
            'studentTotal', (SELECT COUNT(*) FROM {DB_JKXT}.jdts_xs WHERE IsDelete = 0),
            'teacherTotal', (SELECT COUNT(*) FROM {DB_JKXT}.jdts_js WHERE DeletionStateCode = 0),
            'classTotal', (SELECT COUNT(*) FROM {DB_JKXT}.jdts_classinfo),
            'teacherByCategory', (
                SELECT JSON_OBJECTAGG(x.cat, x.n) FROM (
                    SELECT c.CategoryName cat, COUNT(*) n
                    FROM {DB_JKXT}.jdts_js j
                    JOIN {DB_JKXT}.jdts_organization o ON o.Code = j.ZZJGM
                    JOIN {DB_JKXT}.jdts_organizationcategory c ON c.Id = o.CategoryID
                    WHERE j.DeletionStateCode = 0
                    GROUP BY c.CategoryName
                ) x
            ),
            'studentByCategory', (
                SELECT JSON_OBJECTAGG(x.cat, x.n) FROM (
                    SELECT c.CategoryName cat, COUNT(*) n
                    FROM {DB_JKXT}.jdts_xs s
                    JOIN {DB_JKXT}.jdts_organization o ON o.Code = s.ZZJGM
                    JOIN {DB_JKXT}.jdts_organizationcategory c ON c.Id = o.CategoryID
                    WHERE s.IsDelete = 0
                    GROUP BY c.CategoryName
                ) x
            )
        )
    """)
    base = counts or {}
    teacher_by_category = base.get("teacherByCategory") or {}
    base["teacherTotalNonKinder"] = sum(
        n for cat, n in teacher_by_category.items() if cat not in NON_SCHOOL_CATEGORIES and cat != KINDERGARTEN
    )
    base["studentTotalNonKinder"] = sum(
        n for cat, n in (base.get("studentByCategory") or {}).items()
        if cat not in NON_SCHOOL_CATEGORIES and cat != KINDERGARTEN
    )
    gap("师生基数为当前时点快照，无历史学期名册；历史学期的参与率分母不可靠，一律留空。")
    gap("一贯制学校（小学&初中、小学&初中&高中）的师生无法按学段拆分，学段维度的教师基数待业务补充。")
    return base


# ---------------------------------------------------------------- 研训


def training_terms() -> list[str]:
    rows = query_json(f"""
        SELECT JSON_ARRAYAGG(x.termName)
        FROM (
            SELECT DISTINCT p.termName
            FROM {DB_WYXT}.v_oa_education_plan_jy p
            WHERE p.isDelete = 1 AND p.status = 2 AND p.termName IS NOT NULL AND p.termName <> ''
        ) x
    """)
    terms = [t for t in (rows or []) if isinstance(t, str)]

    def sort_key(name: str) -> tuple:
        # 形如「2026-2027学年第一学期」/「第二学期」，按学年倒序、学期倒序。
        head, _, tail = name.partition("学年")
        try:
            year = int(head.split("-")[0])
        except ValueError:
            return (0, 0, name)
        return (year, 2 if "第二学期" in tail else 1, name)

    return sorted(terms, key=sort_key, reverse=True)


def sign_stats_by_plan() -> dict[int, dict]:
    """每个活动的「活动×用户」去重签到统计，全量只算一次。

    签到源表同一活动同一用户会有多行（重复同步），因此一律按
    「活动 × 用户」去重后再算应到人次与出勤人次，不能用行数。
    """
    rows = query_json(f"""
        SELECT JSON_OBJECTAGG(x.kid, JSON_OBJECT('expected', x.expected, 'attended', x.attended))
        FROM (
            SELECT s.educationId kid,
                   COUNT(DISTINCT s.userId) expected,
                   COUNT(DISTINCT CASE WHEN s.status = 1 THEN s.userId END) attended
            FROM {DB_WYXT}.v_oa_education_plan_sign_record_jy s
            GROUP BY s.educationId
        ) x
    """)
    return {int(kid): value for kid, value in (rows or {}).items()}


def training_activities(term: str, sign_by_kid: dict[int, dict]) -> list[dict]:
    rows = query_json(f"""
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'kid', p.kid,
            'date', DATE_FORMAT(COALESCE(p.time, p.createTime), '%Y-%m-%d'),
            'month', DATE_FORMAT(COALESCE(p.time, p.createTime), '%Y-%m'),
            'title', p.title,
            'gradeCode', p.gradeCode,
            'subjects', p.subjects,
            'levelName', p.levelName,
            'sponsor', p.sponsor,
            'hours', p.period,
            'weekid', p.weekid,
            'week', p.week,
            'schoolId', p.schoolId,
            'expected', p.pnumber
        ))
        FROM {DB_WYXT}.v_oa_education_plan_jy p
        WHERE p.isDelete = 1 AND p.status = 2 AND p.termName = {sql_str(term)}
    """)
    activities = []
    for row in rows or []:
        kid = row["kid"]
        sign = sign_by_kid.get(kid)
        expected = sign["expected"] if sign else None
        attended = sign["attended"] if sign else None
        activities.append({
            "kid": kid,
            "date": row["date"],
            "month": row["month"],
            "title": decode_text(row["title"]),
            "stageCodes": parse_codes(row["gradeCode"]),
            "subjects": [decode_text(s.strip()) for s in (row["subjects"] or "").split(",") if s.strip()],
            "levelName": row["levelName"],
            "sponsor": decode_text(row["sponsor"]),
            "hours": parse_hours(row["hours"]),
            "weekid": row["weekid"],
            "week": row["week"],
            "schoolId": row["schoolId"],
            "plannedNumber": int(row["expected"]) if str(row["expected"] or "").isdigit() else None,
            "expectedPersonTimes": expected,
            "attendedPersonTimes": attended,
            "hasSignData": sign is not None,
        })
    activities.sort(key=lambda a: (a["date"] or "", a["kid"] or 0), reverse=True)
    return activities


def parse_hours(raw: object) -> float | None:
    """period 在源库是 varchar，取数值；空串/非数字/0 都视为未填。"""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if not value:
        return None
    return int(value) if value.is_integer() else value


def parse_codes(raw: object) -> list[int]:
    if raw is None:
        return []
    out = []
    for part in str(raw).split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def rate(numerator: int | None, denominator: int | None) -> float | None:
    """分母缺失或为 0 时不出百分比；分子为真实 0 时照实给 0。"""
    if numerator is None or not denominator:
        return None
    return round(numerator / denominator * 100, 2)


def build_training() -> dict:
    terms = training_terms()
    sign_by_kid = sign_stats_by_plan()
    built = []
    for index, term in enumerate(terms):
        activities = training_activities(term, sign_by_kid)
        expected = sum(a["expectedPersonTimes"] or 0 for a in activities)
        attended = sum(a["attendedPersonTimes"] or 0 for a in activities)
        unique_teachers = query_json(f"""
            SELECT COUNT(DISTINCT s.userId)
            FROM {DB_WYXT}.v_oa_education_plan_sign_record_jy s
            JOIN {DB_WYXT}.v_oa_education_plan_jy p ON p.kid = s.educationId
            WHERE s.status = 1 AND p.isDelete = 1 AND p.status = 2
              AND p.termName = {sql_str(term)}
        """)
        hours_known = [a["hours"] for a in activities if a["hours"]]
        with_sign = sum(1 for a in activities if a["hasSignData"])
        total_hours = round(sum(hours_known), 2) if hours_known else None
        if total_hours is not None and float(total_hours).is_integer():
            total_hours = int(total_hours)
        built.append({
            "key": term_key(term),
            "name": term,
            "prevKey": term_key(terms[index + 1]) if index + 1 < len(terms) else None,
            "activities": activities,
            "kpi": {
                "activities": len(activities),
                "activitiesWithSignData": with_sign,
                "expectedPersonTimes": expected if expected else None,
                "attendedPersonTimes": attended if expected else None,
                "attendanceRate": rate(attended, expected) if expected else None,
                "uniqueSignedTeachers": unique_teachers if expected else None,
                "teacherBase": None,
                "participationRate": None,
                "totalHours": total_hours,
                "hoursUnknownActivities": sum(1 for a in activities if not a["hours"]),
                "organizers": len({a["sponsor"] for a in activities if a["sponsor"]}),
            },
            "hasSignData": bool(expected),
        })

    # 默认学期 = 最近一个有签到记录的学期。最新学期常只有活动安排、还没产生签到，
    # 直接默认它会让 6 张 KPI 卡里两张半显示「—」（用户 2026-10-15 确认按此口径）。
    signed_terms = [term for term in built if term["hasSignData"]]
    default_term = (signed_terms[0]["key"] if signed_terms else built[0]["key"]) if built else None
    if built and not built[0]["hasSignData"]:
        gap(f"最新学期「{built[0]['name']}」只有活动安排、没有签到记录，默认学期改取「{default_term}」；"
            f"下拉里选中最新学期时，出勤率与教师参与率按原版空态显示「—」。")
    gap("教师参与率分母（各学期应参训教师基数）源库不存在，按方案「没有可靠基数不出数」留空。")
    gap("只有部分活动开启了签到：应到人次与平均出勤率的分母仅覆盖有签到记录的活动，不是全部活动；"
        "各学期覆盖场次见 kpi.activitiesWithSignData，页面须在悬浮提示里写明该口径。")
    gap("「未参与研训教师」按学段拆分需要学段维度的教师基数，源库不存在，保留原版模块并显示「—」。")
    if any(t["kpi"]["hoursUnknownActivities"] for t in built):
        gap("部分活动 period（学时）为 0 或空，总学时按已填学时合计，缺填场次单独计数不估算。")

    return {
        "dict": {
            "stages": STAGE_DICT,
            "levels": sorted({a["levelName"] for t in built for a in t["activities"] if a["levelName"]}),
            "subjects": sorted({s for t in built for a in t["activities"] for s in a["subjects"]}),
        },
        "defaultTerm": default_term,
        "terms": built,
    }


def term_key(name: str) -> str:
    """「2026-2027学年第一学期」→「2026-2027-1」，与玄武原版学期键同构。"""
    head, _, tail = name.partition("学年")
    return f"{head}-{2 if '第二学期' in tail else 1}"


# ---------------------------------------------------------------- 视导

# 原版「A课率」在建邺没有对应评级体系：源库 vision_rating 取值是优秀/良好/合格/不合格，
# 用户 2026-10-15 确认按真实评级构成展示，不折算成单一 A 课率。
RATING_ORDER = ["优秀", "良好", "合格", "不合格"]
SCHOOL_LISTENING = "校内听课（学校）"


def supervision_terms() -> list[str]:
    rows = query_json(f"""
        SELECT JSON_ARRAYAGG(x.term_name)
        FROM (
            SELECT DISTINCT s.term_name
            FROM {DB_WYXT}.v_supervision_record_jy s
            WHERE s.is_delete = 1 AND s.term_name IS NOT NULL AND s.term_name <> ''
        ) x
    """)
    terms = [t for t in (rows or []) if isinstance(t, str)]

    def sort_key(name: str) -> tuple:
        head, _, tail = name.partition("学年")
        try:
            year = int(head.split("-")[0])
        except ValueError:
            return (0, 0, name)
        return (year, 2 if "第二学期" in tail else 1, name)

    return sorted(terms, key=sort_key, reverse=True)


def supervision_term(term: str) -> dict:
    groups = query_json(f"""
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'group', x.grp, 'typeName', x.type_name, 'records', x.records_,
            'teachers', x.teachers, 'schools', x.schools, 'rating', x.rating
        ))
        FROM (
            SELECT CASE WHEN s.type_name = {sql_str(SCHOOL_LISTENING)} THEN '校内听课' ELSE '视导听课' END grp,
                   s.type_name, s.vision_rating rating,
                   COUNT(*) records_,
                   COUNT(DISTINCT s.vision_th_name) teachers,
                   COUNT(DISTINCT s.th_unit_code) schools
            FROM {DB_WYXT}.v_supervision_record_jy s
            WHERE s.is_delete = 1 AND s.term_name = {sql_str(term)}
            GROUP BY grp, s.type_name, s.vision_rating
        ) x
    """)
    merged: dict[str, dict] = {}
    for row in groups or []:
        bucket = merged.setdefault(row["group"], {
            "records": 0, "teachers": None, "schools": None,
            "ratings": {name: 0 for name in RATING_ORDER}, "unrated": 0, "byType": {},
        })
        bucket["records"] += row["records"]
        bucket["byType"][row["typeName"]] = bucket["byType"].get(row["typeName"], 0) + row["records"]
        if row["rating"] in RATING_ORDER:
            bucket["ratings"][row["rating"]] += row["records"]
        else:
            bucket["unrated"] += row["records"]

    # 人数与校数不能由分组行相加（同一教师可能跨评级/跨类型），单独按组去重取。
    for group in merged:
        distinct = query_json(f"""
            SELECT JSON_OBJECT(
                'teachers', COUNT(DISTINCT s.vision_th_name),
                'schools', COUNT(DISTINCT s.th_unit_code)
            )
            FROM {DB_WYXT}.v_supervision_record_jy s
            WHERE s.is_delete = 1 AND s.term_name = {sql_str(term)}
              AND (CASE WHEN s.type_name = {sql_str(SCHOOL_LISTENING)} THEN '校内听课' ELSE '视导听课' END) = {sql_str(group)}
        """)
        merged[group].update(distinct or {})

    by_school = query_json(f"""
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'code', x.code, 'name', x.name, 'records', x.records_,
            'teachers', x.teachers, 'excellent', x.excellent, 'rated', x.rated
        ))
        FROM (
            SELECT s.th_unit_code code, MAX(s.th_unit_name) name, COUNT(*) records_,
                   COUNT(DISTINCT s.vision_th_name) teachers,
                   SUM(s.vision_rating = '优秀') excellent,
                   SUM(s.vision_rating IS NOT NULL AND s.vision_rating <> '') rated
            FROM {DB_WYXT}.v_supervision_record_jy s
            WHERE s.is_delete = 1 AND s.term_name = {sql_str(term)}
            GROUP BY s.th_unit_code
        ) x
    """)
    schools = [{
        "code": row["code"],
        "name": decode_text(row["name"]),
        "records": row["records"],
        "teachers": row["teachers"],
        "excellent": int(row["excellent"] or 0),
        "rated": int(row["rated"] or 0),
        "excellentRate": rate(int(row["excellent"] or 0), int(row["rated"] or 0)),
    } for row in by_school or []]
    schools.sort(key=lambda s: (-s["records"], s["name"] or ""))

    activities = query_json(f"""
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'id', s.id, 'date', s.vision_time, 'type', s.type_name,
            'school', s.th_unit_name, 'stage', s.vision_unit_priod_name,
            'course', s.vision_course_name, 'rating', s.vision_rating,
            'score', s.vision_score, 'isLeader', s.is_leader
        ))
        FROM {DB_WYXT}.v_supervision_record_jy s
        WHERE s.is_delete = 1 AND s.term_name = {sql_str(term)}
        ORDER BY s.vision_time DESC
    """)
    rows = [{
        "id": row["id"],
        "date": row["date"],
        "type": row["type"],
        "school": decode_text(row["school"]),
        "stage": row["stage"],
        "course": decode_text(row["course"]),
        "rating": row["rating"],
        "score": float(row["score"]) if row["score"] is not None else None,
        "isLeader": bool(row["isLeader"]),
    } for row in activities or []]

    return {
        "key": term_key(term),
        "name": term,
        "groups": merged,
        "schools": schools,
        "activities": rows,
    }


def build_supervision() -> dict:
    terms = supervision_terms()
    built = [supervision_term(term) for term in terms]
    gap("视导评级在建邺是「优秀/良好/合格/不合格」，与玄武原版的 A/B/C 课不同构；"
        "按用户确认，原版「A课率」位置改按真实评级构成展示，不折算成单一 A 课率。")
    gap("综合督导、专项督导在三库中无记录（v_supervision_type_jy 里定义了类型但没有数据）；"
        "v_assessment_project_jy 实为教师评比项目（教坛新秀、区优青、能级认定等），不是学校督导，不能挪用。")
    gap("满意度（教师/学生/家长）数据在三库中不存在；原版满意度总体分析与题目分析（含家长维度）保留模块、数值留「—」。")
    gap("综合督导问题数、待解决数、整改状态无数据源，原版问题统计板块保留并留「—」。")
    gap("v_supervision_record_jy.subject_name 存的是课题/课名（如「黄继光」「Road safety」），不是学科；"
        "学科维度需业务确认改用哪个字段，暂不按学科出图。")
    gap("v_supervision_record_jy.th_unit_code 是 UUID，与 jdts_organization.Code（320105…）不同体系，"
        "视导学校无法直接关联学校名录；jianye_dashboard.dim_school_mapping 是空表。"
        "校级联动需要先建这份映射，当前按 th_unit_name 原样展示。")
    return {
        "dict": {"ratings": RATING_ORDER, "groups": ["校内听课", "视导听课"]},
        "defaultTerm": built[0]["key"] if built else None,
        "terms": built,
        "modulesWithoutData": [
            "综合督导（学校/督导次数/问题数/待解决数/报告档案）",
            "专项督导（小学/中学分栏、分项均分、榜单、下钻）",
            "满意度总体分析",
            "满意度题目分析（教师/学生/家长）",
            "综合督导问题统计",
        ],
    }


# ---------------------------------------------------------------- 应用运营 / 协同 / 体育


def build_app_operations() -> dict:
    """三库中不存在应用目录、每日应用使用人数与三角色关注数据，按方案建位不建值。"""
    gap("本地三库无应用目录、无「学校×应用×日期」使用人数、无平台整体日活、无学生/教师/家长关注数据；"
        "应用运营各模块保留完整位置，数值为 null，等接口或 JSON/Excel 导出后接入。")
    return {
        "catalog": None,
        "dailyAppUsers": None,
        "platformDailyUsers": None,
        "roleAttention": None,
        "contract": {
            "catalog": ["schoolCode", "appCode", "appName", "enabled", "icon?", "launchUrl?"],
            "dailyAppUsers": ["date", "scope", "schoolCode", "appCode", "uniqueUsers", "asOfTime", "dedupRule"],
            "platformDailyUsers": ["date", "scope", "schoolCode", "uniqueUsersAcrossApps"],
            "roleAttention": ["statDate", "scope", "schoolCode", "role", "clientType", "total", "followed"],
        },
    }


def build_pending(topic: str, tables: str) -> None:
    gap(f"{topic}在主快照中保留 null；细分聚合另存 data/jianye-dimensions.generated.json，"
        f"由 npm run import:jianye 连续生成；源表范围（{tables}）并非全部已接入，请以扩展快照 sourceTable 为准。")


def main() -> int:
    schools = build_schools()
    build_pending("教育协同", "v_bulletin_jy / v_bulletin_transmit_jy / v_bulletin_transmit_user_jy / v_triple_review_jy / v_document_flow_jy")
    build_pending("体育与成长", "u_st.st_aizhty_* / st_wyydzhty_assessment / t_wyyd_zhty_student_scores / st_xsry_student_honor")
    snapshot = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "district": DISTRICT,
            "sourceDatabases": [DB_JKXT, DB_WYXT],
            "generator": "scripts/build-jianye-data.py",
            "note": "本文件由脚本生成，不要手改；补数后重跑脚本即可，页面无需重排。",
        },
        "schools": schools,
        "base": build_base(),
        "training": build_training(),
        "appOperations": build_app_operations(),
        "supervision": build_supervision(),
        "collaboration": None,
        "sports": None,
        "gaps": gaps,
    }
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # React 页面只需要 KPI 级摘要，研训/视导的活动明细留给模板在构建期读取，
    # 否则 2.6MB 明细会整包进浏览器 bundle。
    overview = {
        "meta": snapshot["meta"],
        "schools": snapshot["schools"],
        "base": snapshot["base"],
        "training": {
            "defaultTerm": snapshot["training"]["defaultTerm"],
            "dict": snapshot["training"]["dict"],
            "terms": [
                {
                    "key": term["key"],
                    "name": term["name"],
                    "prevKey": term["prevKey"],
                    "hasSignData": term["hasSignData"],
                    "kpi": term["kpi"],
                }
                for term in snapshot["training"]["terms"]
            ],
        },
        "supervision": {
            "defaultTerm": snapshot["supervision"]["defaultTerm"],
            "dict": snapshot["supervision"]["dict"],
            "terms": [
                {"key": term["key"], "name": term["name"], "groups": term["groups"],
                 "schoolCount": len(term["schools"])}
                for term in snapshot["supervision"]["terms"]
            ],
            "modulesWithoutData": snapshot["supervision"]["modulesWithoutData"],
        },
        "appOperations": snapshot["appOperations"],
        "gaps": snapshot["gaps"],
    }
    overview_path = ROOT / "data" / "jianye-overview.generated.json"
    overview_path.write_text(json.dumps(overview, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 校点坐标必须人工核准：签到 GPS 推不出学校位置（84% 集中在同一活动场地）。
    # 这里只建空文件占位，绝不覆盖用户已提供的核准坐标。
    points_path = ROOT / "data" / "jianye-school-points.json"
    if not points_path.exists():
        points_path.write_text(
            json.dumps(
                {
                    "_note": "学校统一代码 → [经度, 纬度]（WGS84）。由建邺区教育局核准后填写；"
                             "未填写的学校不上地图，但仍出现在学校下拉里。",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    training = snapshot["training"]
    print(f"快照：{OUTPUT}（{OUTPUT.stat().st_size / 1024 / 1024:.2f} MiB）")
    print(f"学校 {len(schools)} 所（含幼儿园 {sum(1 for s in schools if s['kindergarten'])} 所）")
    base = snapshot["base"]
    print(f"学生 {base.get('studentTotal')} 人 / 教职工 {base.get('teacherTotal')} 人"
          f"（非幼儿园教职工 {base.get('teacherTotalNonKinder')} 人）")
    print(f"研训学期 {len(training['terms'])} 个，默认 {training['defaultTerm']}")
    for term in training["terms"][:3]:
        kpi = term["kpi"]
        print(f"  {term['name']}: 活动 {kpi['activities']} 场（有签到 {kpi['activitiesWithSignData']} 场），"
              f"应参加 {kpi['expectedPersonTimes']} 人次，出勤 {kpi['attendedPersonTimes']} 人次，"
              f"出勤率 {kpi['attendanceRate']}，去重参训 {kpi['uniqueSignedTeachers']} 人，"
              f"总学时 {kpi['totalHours']}，组织者 {kpi['organizers']} 人")
    supervision = snapshot["supervision"]
    print(f"视导学期 {len(supervision['terms'])} 个，默认 {supervision['defaultTerm']}")
    for term in supervision["terms"][:2]:
        for group in ("校内听课", "视导听课"):
            stat = term["groups"].get(group)
            if not stat:
                continue
            ratings = "、".join(f"{name} {stat['ratings'][name]}" for name in RATING_ORDER)
            print(f"  {term['name']} · {group}: {stat['records']} 节，被听课教师 {stat['teachers']} 人，"
                  f"学校 {stat['schools']} 所，未评级 {stat['unrated']}｜{ratings}")
    print(f"\n待补口径 {len(gaps)} 项：")
    for item in gaps:
        print(f"  - {item}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
