#!/usr/bin/env python3
"""生成研训大屏（教师发展大屏/yanxun.html）的数据块与学期配置。

用法：python3 xw_sjzs/scripts/build-yanxun-data.py

数据源：xw_sjzs/研训数据/研训活动统计(本区) (n).xls，每份导出一个学期（2020-2021-1 ~ 2026-2027-1）。
转换规则（与旧版数据逐字段对齐，已回归验证）：
  - 记录格式 [日期, 活动名称, 学段, 学科, 级别, 组织者, 学时, 应参加人数, 未出勤人数, 已出勤人数]；
    学段/学科/级别/组织者 为 YX_DICT 下标；学段、学科按升序去重（一场活动可涉及多个）。
  - 「全部」学科丢弃（沿用旧版）；平台历年更名的学科归一到现名（小学科学（自然）→小学科学 等）。
  - 记录按日期稳定升序排列（导出表按日期倒序，旧版即按升序入库）。
  - 清空的占位值（学时等）按 0 计。
  - 各学期教师总数/学段构成与参与教师估算写入 YX_META.terms，来源见 load_roster。

写回内容由 4 段标记界定，脚本做幂等替换：
  /*__YX_DATA_BEGIN__*/ … /*__YX_DATA_END__*/      数据块（YX_DICT / YX_SRC / YX_META / YX_DATA）
  /*__YX_TERMS_BEGIN__*/ … /*__YX_TERMS_END__*/    当前学期 SEM 与学期名/上学期映射
  /*__YX_TERMSTART_BEGIN__*/ … /*__YX_TERMSTART_END__*/  各学期开学周周一
  <!--__YX_MENU_BEGIN__--> … <!--__YX_MENU_END__--> 学期下拉菜单
"""
import glob
import json
import math
import re
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / 'xw_sjzs' / '研训数据'
TARGET = ROOT / '教师发展大屏' / 'yanxun.html'
ROSTER = ROOT / '教师数据报告' / '各年度骨干教师考核数据列表（20260926）_清洗版_含画像链接.xlsx'

# (学期键, 文件名序号)；2022-2023-1 的两份导出 (11)/(12) 逐字节相同，取一份
TERMS = [
    ('2020-2021-1', 16), ('2020-2021-2', 15), ('2021-2022-1', 14), ('2021-2022-2', 13),
    ('2022-2023-1', 11), ('2022-2023-2', 10), ('2023-2024-1', 9), ('2023-2024-2', 8),
    ('2024-2025-1', 7), ('2024-2025-2', 6), ('2025-2026-1', 5), ('2025-2026-2', 4),
    ('2026-2027-1', 3),
]

# 各学期开学周的周一。2020-2021-1 起据江苏/南京校历（开学日所在周的周一）：
# 2020-09-01、2021-02-22、2021-09-01（线上开学）、2022-02-14、2022-09-01、2023-02-06、
# 2023-09-04（官方推迟）、2024-02-21、2024-09-02、2025-02-13、2025-09-01、2026-03-02、
# 2026-09-01（8月31日报到）。
TERM_START = {
    '2020-2021-1': '2020-08-31', '2020-2021-2': '2021-02-22',
    '2021-2022-1': '2021-08-30', '2021-2022-2': '2022-02-14',
    '2022-2023-1': '2022-08-29', '2022-2023-2': '2023-02-06',
    '2023-2024-1': '2023-09-04', '2023-2024-2': '2024-02-19',
    '2024-2025-1': '2024-09-02', '2024-2025-2': '2025-02-10',
    '2025-2026-1': '2025-09-01', '2025-2026-2': '2026-03-02',
    '2026-2027-1': '2026-08-31',
}

SEG = ['幼教', '小学', '初中', '高中', '职教', '特教']
# 前 54 项沿用旧版顺序（YX_DATA 下标不变），新增项追加在末尾
SUBJ = [
    '幼儿教育', '小学数学', '小学语文', '高中英语', '高中数学', '高中物理', '初中英语', '初中语文',
    '心理教育', '高中地理', '初中化学', '初中数学', '小学道德与法治', '高中化学', '高中历史', '德育',
    '初中物理', '高中政治', '高中生物', '艺术或音乐美术(高中)', '高中语文', '小学体育与健康', '小学美术',
    '道德与法治(初中)', '初中音乐', '小学英语', '高中音乐', '小学音乐', '教育科研', '初中历史', '初中生物',
    '初中美术', '小学科学', '高中美术', '初中体育与健康', '初中信息科技', '初中地理', '小学信息科技',
    '小学劳动', '高中信息技术', '小学综合实践', '初中劳动', '通用技术(高中)', '高中体育与健康',
    '现代教育技术', '其它小学课程', '外语(职校)', '其它初中课程', '初中人防', '初中研究性学习',
    '初中社区服务与社会实践', '小学研究性学习', '小学社区服务与社会实践', '特教', '职教',
    '体育与健康',
]
LV = [
    ['区级', '区级', '区级'],
    ['市级（本区承办）', '市级·本区', '市级'],
    ['市级（非本区承办）', '市级·非本区', '市级'],
    ['省级（本区承办）', '省级·本区', '省级'],
    ['省级（非本区承办）', '省级·非本区', '省级'],
    ['市级', '市级', '市级'],
    ['省级', '省级', '省级'],
]
# 前 36 位沿用旧版顺序，新增创建人追加在末尾
CRE = [
    '张艳丽', '杨华', '任慧', '胡少希', '李琳', '王为忠', '方芳', '周海旸', '谭少春', '林卫华',
    '黄双雷', '王天文', '李紫燕', '黄莺', '冯凌', '周萍', '娄龙雁', '陆明明', '田红', '陈莉',
    '黄雅芸', '金晶', '张桂宁', '孟凡军', '郭翔', '赵凯宁', '张齐华', '冯静', '果松', '王彩燕',
    '余夕凯', '陈晓娟', '杨奇荣', '张雅琪', '李小满', '吴林汉',
    # 2026-10 新增（历史学期导出）
    '陆建源', '杨小军', '李静文', '章伟', '任洁', '宋云梅', '冉向捷', '苗茜', '项平', '丁青', '沈浩',
]

# 平台历年更名的学科归一到现名（旧版对 小学科学（自然） 即如此处理）
SUBJ_ALIAS = {
    '小学科学（自然）': '小学科学',
    '小学信息技术': '小学信息科技',
    '初中信息技术': '初中信息科技',
    '初中劳动与技术教育': '初中劳动',
    '小学劳动与技术教育': '小学劳动',
    '道德与法治(小学)': '小学道德与法治',
}

# 各学期教师总数 / 学段构成：取自《各年度骨干教师考核数据列表》按年度去重（见 load_roster）。
# 学年 N-(N+1) 用「年度 N」名册（年度 = 学年起始年；名册年龄按年度年末计算，2026 年度尚未考核）。
# 教师参与率的估算口径（源表无去重教师名单）：
# 参与教师数 = 该学期教师总数 × 0.895 × (1 - e^(-出勤人次/10000))，即接近 9 成的饱和曲线，
# 学期中途的导出（活动量小）按比例偏低。
FALLBACK_TEACHER_TOTAL = 5200
SEG_ORDER = ['幼教', '小学', '初中', '高中', '职教', '特教']
# 名册中非学校单位（机关/发展中心/跨区等）不计入教师总数与学段构成
ROSTER_EXCLUDE_KW = ('教育局', '督导室', '招办', '少年宫', '开放大学', '社区教育', '社教科',
                     '测试学校', '招生考试中心', '教师发展中心', '栖霞区', '秦淮区')
# 「中学」缺少「初级」字样时默认初中，以下按高中处理
ROSTER_HIGH_SCHOOL = ('第九中学', '第十三中学', '人民中学', '玄武高级中学', '南京体育学院附属学校')


def load_roster(path):
    """按年度去重统计教师总数与学段人数：{年度: {'total': n, 'seg': {学段下标: n}}}。"""
    import openpyxl

    def classify(unit):
        name = unit.strip().rstrip('.')
        if any(kw in name for kw in ROSTER_EXCLUDE_KW):
            return None
        if '幼儿园' in name or '实幼' in name:
            return '幼教'
        if '特殊教育' in name or '特教' in name:
            return '特教'
        if '中等专业' in name or '职业学校' in name:
            return '职教'
        if '小学' in name:
            return '小学'
        if '初级中学' in name:
            return '初中'
        if '中学' in name:
            return '高中' if any(kw in name for kw in ROSTER_HIGH_SCHOOL) else '初中'
        if '学校' in name:
            return '初中'      # 玄武外国语学校、紫东实验学校（九年一贯）等
        return None

    wb = openpyxl.load_workbook(str(path), read_only=True)
    ws = wb.worksheets[0]
    per_year = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        year = str(row[0]).strip()
        seg = classify(str(row[14]))
        if seg is None:
            continue
        bucket = per_year.setdefault(year, {'ids': set(), 'seg': {name: set() for name in SEG_ORDER}})
        bucket['ids'].add(str(row[1]))
        bucket['seg'][seg].add(str(row[1]))
    return {
        year: {
            'total': len(bucket['ids']),
            'seg': {str(SEG.index(name)): len(bucket['seg'][name]) for name in SEG_ORDER},
        }
        for year, bucket in per_year.items()
    }


def num(cell):
    try:
        return int(float(cell))
    except (TypeError, ValueError):
        return 0


def index_of(values, token, what, where):
    if token not in values:
        raise SystemExit(f'未知{what}「{token}」（{where}），请先补充字典')
    return values.index(token)


def parse_file(path):
    wb = xlrd.open_workbook(str(path))
    sh = wb.sheet_by_index(0)
    records = []
    for r in range(1, sh.nrows):
        name = str(sh.cell_value(r, 0)).strip()
        date = str(sh.cell_value(r, 2))[:10]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            raise SystemExit(f'{path.name} 第 {r + 1} 行时间无法解析：{sh.cell_value(r, 2)!r}')
        seg = sorted({index_of(SEG, t.strip(), '学段', path.name)
                      for t in str(sh.cell_value(r, 4)).split(',') if t.strip()})
        subj = set()
        for t in str(sh.cell_value(r, 5)).split(','):
            t = t.strip()
            if not t or t == '全部':
                continue
            t = SUBJ_ALIAS.get(t, t)
            subj.add(index_of(SUBJ, t, '学科', path.name))
        lv_name = str(sh.cell_value(r, 1)).strip()
        lv = next((i for i, item in enumerate(LV) if item[0] == lv_name), None)
        if lv is None:
            raise SystemExit(f'未知级别「{lv_name}」（{path.name}）')
        records.append([
            date, name, seg, sorted(subj), lv,
            index_of(CRE, str(sh.cell_value(r, 3)).strip(), '创建人', path.name),
            num(sh.cell_value(r, 8)), num(sh.cell_value(r, 11)),
            num(sh.cell_value(r, 12)), num(sh.cell_value(r, 13)),
        ])
    records.sort(key=lambda rec: rec[0])
    return records


def term_name(key):
    y1, y2, half = key.split('-')
    return f'{y1}-{y2}学年 {"第一" if half == "1" else "第二"}学期'


def js(value):
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return text.replace('</', '<\\/')


def replace_between(text, begin, end, body, where):
    start = text.index(begin) + len(begin)
    stop = text.index(end)
    return text[:start] + body + text[stop:]


def main():
    roster = load_roster(ROSTER)
    roster_years = sorted(int(y) for y in roster)

    def roster_of(key):
        year = int(key[:4])
        usable = [y for y in roster_years if y <= year] or roster_years
        return roster[str(max(usable))]

    data = {}
    src = {}
    term_meta = {}
    lines = []
    for key, order in TERMS:
        path = DATA_DIR / f'研训活动统计(本区) ({order}).xls'
        if not path.exists():
            raise SystemExit(f'缺少数据文件：{path}')
        records = parse_file(path)
        data[key] = records
        src[key] = path.name
        chu = sum(rec[9] for rec in records)
        teacher_total = roster_of(key)['total']
        part = min(teacher_total, round(teacher_total * 0.895 * (1 - math.exp(-chu / 10000))))
        term_meta[key] = {'total': teacher_total, 'seg': roster_of(key)['seg'], 'part': part}
        dates = [rec[0] for rec in records]
        lines.append(f' *   {term_name(key)} → {path.name}：{len(records)} 场，'
                     f'{min(dates)} ~ {max(dates)}（出勤 {chu} 人次；教师 {teacher_total} 人，参与教师估算 {part}）')
        print(f'{key:14s} {len(records):4d} 场  {min(dates)} ~ {max(dates)}  出勤 {chu:6d}  '
              f'教师 {teacher_total:5d}  参与估算 {part:5d}')

    missing = [key for key, _ in TERMS if key not in TERM_START]
    if missing:
        raise SystemExit(f'缺少开学周配置：{missing}')

    header = (
        '/* ================================================================\n'
        ' * 玄武区研训活动大屏 · 数据文件（由 xw_sjzs/scripts/build-yanxun-data.py 生成，勿手改）\n'
        ' * 数据源：xw_sjzs/研训数据/ 下各学期的《研训活动统计(本区)》xls（2022-2023-1 的两份导出重复，取一份）；\n'
        ' *   教师总数/学段构成取自《各年度骨干教师考核数据列表》（学年 N-(N+1) 用年度 N 名册，剔除非学校单位）\n'
        + '\n'.join(lines) + '\n'
        ' * 记录格式：[日期, 活动名称, 学段, 学科, 级别, 组织者, 学时, 应参加人数, 未出勤人数, 已出勤人数]\n'
        ' *   学段/学科/级别/组织者 为 YX_DICT 中的下标；学段、学科可能有多个下标（一场活动涉及多个）\n'
        ' * ================================================================ */'
    )
    dict_js = 'var YX_DICT=' + js({'seg': SEG, 'subj': SUBJ, 'lv': LV, 'cre': CRE}) + ';\n'
    meta_js = js({
        'teacherTotal': FALLBACK_TEACHER_TOTAL,
        'terms': term_meta,
    })
    data_block = (header + '\n' + dict_js +
                  'var YX_SRC=' + js(src) + ';\n' +
                  'var YX_META=' + meta_js + ';\n' +
                  'var YX_DATA=' + js(data) + ';\n')

    keys = [key for key, _ in TERMS]
    latest = keys[-1]
    sem_name = {key: term_name(key) for key in keys}
    prev = {keys[i]: keys[i - 1] for i in range(1, len(keys))}
    terms_body = (f"var SEM='{latest}',SEM_NAME=" + js(sem_name) + ';\n'
                  'var PREV=' + js(prev) + ';   /* 上学期（最早的学期没有源数据） */\n')
    termstart_body = 'var TERM_START=' + js({key: TERM_START[key] for key in keys}) + ';   /* 各学期开学周的周一 */\n'
    menu_body = ''.join(f'      <li data-t="{key}">{term_name(key)}</li>\n' for key in reversed(keys))

    html = TARGET.read_text(encoding='utf-8')
    html = replace_between(html, '/*__YX_DATA_BEGIN__*/', '/*__YX_DATA_END__*/', '\n' + data_block, '数据块')
    html = replace_between(html, '/*__YX_TERMS_BEGIN__*/', '/*__YX_TERMS_END__*/', '\n' + terms_body, '学期配置')
    html = replace_between(html, '/*__YX_TERMSTART_BEGIN__*/', '/*__YX_TERMSTART_END__*/',
                           '\n' + termstart_body, '开学周配置')
    html = replace_between(html, '<!--__YX_MENU_BEGIN__-->', '<!--__YX_MENU_END__-->', '\n' + menu_body + '      ', '学期菜单')
    html = re.sub(r'(<span id="termText">)[^<]*(</span>)', r'\g<1>' + term_name(latest) + r'\g<2>', html)
    TARGET.write_text(html, encoding='utf-8')
    print(f'\n共 {len(keys)} 个学期写入 {TARGET}（{len(html) / 1024:.0f} KB）')


if __name__ == '__main__':
    main()
