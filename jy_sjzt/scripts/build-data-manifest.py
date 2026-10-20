#!/usr/bin/env python3
"""汇总 data/ 下的可用数据集，生成 data/manifest.json（不查询数据库、不打包页面）。"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

FILES = [
    ("jianye-overview.generated.json", "屏幕运行时汇总", "scripts/build-jianye-data.py",
     "lib/jianye-data.ts → 总览 / 应用运营 / 应用使用页", "学校名录、师生基数、研训与视导学期汇总"),
    ("jianye.generated.json", "生成用主快照", "scripts/build-jianye-data.py",
     "scripts/build-jianye-dimensions.py、scripts/build-jianye-training.mjs", "研训活动与视导记录的全量聚合明细"),
    ("jianye-dimensions.generated.json", "离线维度快照", "scripts/build-jianye-dimensions.py",
     "离线分析与补数；不进入首页 JS 包", "103 个按来源表拆分的维度数据集"),
    ("jianye-map.json", "地图区界", "scripts/build-jianye-terrain.py 沿用", "lib/education-map.ts",
     "建邺区 GeoJSON 边界（DataV GeoAtlas 320105）"),
    ("jianye-school-points.json", "地图校点", "人工核准 + 公开地图核对", "lib/education-map.ts",
     "学校统一代码 → WGS84 经纬度；未核准学校不上图"),
    ("jianye-terrain-meta.json", "地形元数据", "scripts/build-jianye-terrain.py", "lib/education-map.ts",
     "卫星影像与 DEM 的裁切范围、高程区间和竖向夸张"),
    ("smart-campus.generated.json", "屏幕运行时截图数据", "scripts/build-smart-campus-data.py",
     "lib/smart-campus-data.ts → 应用运营 / 应用使用页", "智慧校园平台三张截图的可读值、派生值与缺口"),
    ("smart-campus.source.json", "截图人工录入源", "人工核对截图", "scripts/build-smart-campus-data.py",
     "截图读数、置信度与来源区域，供生成脚本使用"),
    ("source-inventory.json", "原始库表清单", "三库导入核对", "数据说明与补数范围确认",
     "三库全部 91 张表的行数与大屏使用标记；不含原始数据"),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def dataset_summary(dimensions: dict) -> dict:
    by_table: dict[str, dict] = {}
    by_status = Counter()
    for key, dataset in dimensions.get("datasets", {}).items():
        table = dataset.get("sourceTable", "未知")
        item = by_table.setdefault(table, {"datasets": 0, "records": 0, "keys": []})
        item["datasets"] += 1
        item["records"] += dataset.get("totalRecords") or 0
        item["keys"].append(key)
        by_status[dataset.get("dataStatus", "未知")] += 1
    return {
        "total": len(dimensions.get("datasets", {})),
        "byStatus": dict(by_status),
        "bySourceTable": [
            {"sourceTable": table, **{k: v for k, v in item.items() if k != "keys"},
             "exampleKeys": item["keys"][:3]}
            for table, item in sorted(by_table.items(), key=lambda pair: (-pair[1]["records"], pair[0]))
        ],
    }


def source_summary(inventory: dict) -> dict:
    databases = inventory.get("databases", {})
    tables = [table for db in databases.values() for table in db.get("tables", {}).values()]
    return {
        "databases": len(databases),
        "tables": len(tables),
        "usedTables": sum(1 for table in tables if table.get("used")),
        "rows": sum(db.get("totalRows", 0) for db in databases.values()),
        "rawDumpsInRepo": False,
        "note": inventory.get("note"),
    }


def main() -> int:
    overview = load("jianye-overview.generated.json")
    smart = load("smart-campus.generated.json")
    dimensions = load("jianye-dimensions.generated.json")
    inventory = load("source-inventory.json")

    files = []
    for name, role, generator, consumers, description in FILES:
        path = DATA / name
        files.append({
            "path": f"data/{name}",
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
            "role": role,
            "generator": generator,
            "consumers": consumers,
            "description": description,
        })

    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "district": overview["meta"]["district"],
        "isSimulated": False,
        "note": "本清单只描述 data/ 内的派生数据；原始 SQL 备份、构建产物与未引用素材不进入仓库。",
        "sources": source_summary(inventory),
        "files": files,
        "datasets": dataset_summary(dimensions),
        "smartCampus": {
            "datasets": len(smart.get("datasets", {})),
            "screenshots": [item["fileName"] for item in smart.get("meta", {}).get("source", [])],
            "simulated": False,
            "gaps": [gap["id"] for gap in smart.get("meta", {}).get("gaps", [])],
            "uncertainties": [item["id"] for item in smart.get("meta", {}).get("uncertainties", [])],
        },
        "runtimeGaps": overview.get("gaps", []),
        "dataStatus": {
            "generated": "由脚本从源库或人工核对数据生成，页面对应数值不再手改。",
            "derived": "按已声明公式派生；不覆盖原始读数。",
            "simulated": "演示值必须在页面逐处标注；本清单文件本身不含模拟数据。",
            "missing": "源数据未提供时保留 null，页面显示「—」，不以 0 代替。",
        },
    }
    target = DATA / "manifest.json"
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {target} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
