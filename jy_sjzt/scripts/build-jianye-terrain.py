#!/usr/bin/env python3
"""按建邺区界外接矩形裁卫星影像与高程图，供 hub-scene 的实景地形模式使用。

影像源 Esri World Imagery（z16），高程源 AWS Terrarium（z13）。两者都是墨卡托瓦片，
与 lib/education-map.ts 里 d3 geoMercator().fitWidth(1000) 的线性对齐方式一致：
裁出的图正好铺满区界外接矩形。

高程重编码为 8bit：0 = 区内最低海拔，255 = 区内最高海拔；hub-scene 用
TERRAIN_RELIEF 把这个 0..1 区间放大成世界单位（1 单位 ≈ 1 km），
所以脚本同时把实际高差写进 data/jianye-terrain-meta.json 供前端读取。
"""

from __future__ import annotations

import io
import json
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BOUNDARY = ROOT / "data" / "jianye-map.json"
OUT_DIR = ROOT / "public" / "images" / "terrain-jy"
META = ROOT / "data" / "jianye-terrain-meta.json"

IMAGERY_Z = 16
TERRAIN_Z = 13
IMAGERY_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
# 建邺是平原加江心洲，竖向夸张比玄武的 2.4 倍要收敛，否则水面和堤岸会被拉成山。
RELIEF_EXAGGERATION = 3.0


def tile_xy(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "jianye-edu-dashboard/0.1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def stitch(z: int, x0: int, y0: int, x1: int, y1: int, url: str, mode: str) -> Image.Image:
    coords = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    tiles: dict[tuple[int, int], Image.Image] = {}

    def load(coord: tuple[int, int]) -> tuple[tuple[int, int], Image.Image]:
        x, y = coord
        data = fetch(url.format(z=z, x=x, y=y))
        return coord, Image.open(io.BytesIO(data)).convert(mode)

    with ThreadPoolExecutor(max_workers=8) as pool:
        for coord, image in pool.map(load, coords):
            tiles[coord] = image

    width = (x1 - x0 + 1) * 256
    height = (y1 - y0 + 1) * 256
    canvas = Image.new(mode, (width, height))
    for (x, y), image in tiles.items():
        canvas.paste(image, ((x - x0) * 256, (y - y0) * 256))
    return canvas


def main() -> int:
    boundary = json.loads(BOUNDARY.read_text(encoding="utf-8"))
    coords = [point for ring in boundary["features"][0]["geometry"]["coordinates"] for ring_pts in ring for point in ring_pts]
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)
    print(f"建邺外接矩形：经 {west:.4f}~{east:.4f}，纬 {south:.4f}~{north:.4f}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    ix0, iy0 = tile_xy(west, north, IMAGERY_Z)
    ix1, iy1 = tile_xy(east, south, IMAGERY_Z)
    print(f"影像瓦片 z{IMAGERY_Z}: x {ix0}~{ix1}, y {iy0}~{iy1} = {(ix1 - ix0 + 1) * (iy1 - iy0 + 1)} 张")
    imagery = stitch(IMAGERY_Z, ix0, iy0, ix1, iy1, IMAGERY_URL, "RGB")
    # z16 原图 5600×7900 约 12MB，单文件内联吃不消；大屏上 1:1 像素也用不到这么密，降到一半。
    imagery = imagery.resize((imagery.width // 2, imagery.height // 2), Image.LANCZOS)
    imagery.save(OUT_DIR / "satellite.jpg", quality=82)
    print(f"  → {OUT_DIR / 'satellite.jpg'} {imagery.size}")

    tx0, ty0 = tile_xy(west, north, TERRAIN_Z)
    tx1, ty1 = tile_xy(east, south, TERRAIN_Z)
    print(f"高程瓦片 z{TERRAIN_Z}: x {tx0}~{tx1}, y {ty0}~{ty1} = {(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} 张")
    terrain = stitch(TERRAIN_Z, tx0, ty0, tx1, ty1, TERRAIN_URL, "RGB")
    raw = np.asarray(terrain, dtype=np.float64)
    elevation = raw[:, :, 0] * 256.0 + raw[:, :, 1] + raw[:, :, 2] / 256.0 - 32768.0
    low, high = float(elevation.min()), float(elevation.max())
    print(f"  海拔范围 {low:.1f} m ~ {high:.1f} m")

    span = max(high - low, 1.0)
    normalized = np.clip((elevation - low) / span * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(normalized, mode="L").save(OUT_DIR / "dem.png")
    print(f"  → {OUT_DIR / 'dem.png'}")

    META.write_text(
        json.dumps(
            {
                "imageryZoom": IMAGERY_Z,
                "terrainZoom": TERRAIN_Z,
                "bbox": [west, south, east, north],
                "elevationMin": round(low, 2),
                "elevationMax": round(high, 2),
                "reliefWorldUnits": round((high - low) / 1000.0 * RELIEF_EXAGGERATION, 4),
                "exaggeration": RELIEF_EXAGGERATION,
                "sources": ["Esri World Imagery", "AWS Terrarium"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"  → {META}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
