import { geoMercator, geoPath } from 'd3-geo'
import type { FeatureCollection, MultiPolygon } from 'geojson'
import rawBoundary from '@/data/jianye-map.json'
import rawSchoolPoints from '@/data/jianye-school-points.json'
import terrainMeta from '@/data/jianye-terrain-meta.json'
import { JIANYE_SCHOOL_OPTIONS, type JianyeSchool } from './jianye-data'
import type { SchoolStage } from './dashboard-data'

// 区界来自阿里云 DataV GeoAtlas（WGS84），与核准校点同一坐标系。
// 数据按 GeoJSON 右手环方向存储，D3 的球面投影要求相反方向，否则会绘制整片地球。
const boundary: FeatureCollection<MultiPolygon> = {
  type: 'FeatureCollection',
  features: rawBoundary.features.map((feature) => ({
    type: 'Feature',
    properties: feature.properties,
    geometry: {
      type: 'MultiPolygon',
      coordinates: feature.geometry.coordinates.map((polygon) =>
        polygon.map((ring) => [...ring].reverse()),
      ),
    },
  })),
}

/** 三维场景中地图的宽度（世界单位），其他尺寸都以此为基准。 */
export const MAP_WORLD_WIDTH = 14
export const MAP_THICKNESS = 0.8
export const BRAIN_HEIGHT = 6.6
export const BRAIN_PORT_HEIGHT = 4.1

const PROJECTED_WIDTH = 1000
const projection = geoMercator().fitWidth(PROJECTED_WIDTH, boundary)
const [[minX, minY], [maxX, maxY]] = geoPath(projection).bounds(boundary)
const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
const unitsPerPixel = MAP_WORLD_WIDTH / (maxX - minX)

export const MAP_WORLD_DEPTH = (maxY - minY) * unitsPerPixel

export type ScenePoint = { x: number; z: number }

/** 地图底图：科技风发光地图，或真实卫星影像 + 高程地形。 */
export type MapStyle = 'tech' | 'satellite'

/**
 * 建邺的卫星影像（Esri World Imagery z16）与高程（AWS Terrarium z13）由
 * scripts/build-jianye-terrain.py 按区界外接矩形裁好，墨卡托投影与本文件的
 * d3 geoMercator 线性对齐。高程已归一化：0 = 区内最低海拔，255 = 最高海拔，
 * 实际高差与竖向夸张见 data/jianye-terrain-meta.json。
 */
export const TERRAIN_IMAGERY = '/images/terrain-jy/satellite.jpg'
export const TERRAIN_DEM = '/images/terrain-jy/dem.png'
export const TERRAIN_RELIEF = terrainMeta.reliefWorldUnits

/** 投影像素坐标 → 场景平面坐标（x 向右，z 朝向观众）。 */
function toScene(x: number, y: number): ScenePoint {
  return { x: (x - center.x) * unitsPerPixel, z: (y - center.y) * unitsPerPixel }
}

function projectCoordinate(coordinate: [number, number]) {
  const projected = projection(coordinate)
  if (!projected) throw new Error(`坐标无法投影：${coordinate.join(',')}`)
  return toScene(projected[0], projected[1])
}

/** 区界轮廓（场景坐标），每个元素为一个闭合环。 */
export const DISTRICT_RINGS: ScenePoint[][] = boundary.features
  .flatMap((feature) => feature.geometry.coordinates)
  .flatMap((polygon) => polygon)
  .map((ring) => ring.map(([lon, lat]) => projectCoordinate([lon, lat])))

export type SchoolMapStage = SchoolStage

const CATEGORY_STAGE: Record<string, SchoolMapStage> = {
  小学: 'primary',
  初中: 'junior',
  高中: 'senior',
  职业学校: 'vocational',
  特殊教育: 'special',
}

export const MAP_LEGEND: { key: SchoolMapStage; label: string; color: string }[] = [
  { key: 'primary', label: '小学', color: '#34d399' },
  { key: 'junior', label: '初中', color: '#fbbf24' },
  { key: 'senior', label: '高中', color: '#38bdf8' },
  { key: 'vocational', label: '职业学校', color: '#a78bfa' },
  { key: 'special', label: '特殊教育', color: '#f472b6' },
]

export type SchoolMapPoint = Pick<JianyeSchool, 'code' | 'name' | 'category'> &
  ScenePoint & { id: string; stage: SchoolMapStage }

const approvedPoints = rawSchoolPoints as unknown as Record<string, [number, number] | undefined>

/**
 * 只上核准过坐标的学校。签到 GPS 推不出校位（八成集中在同一活动场地），
 * 所以不做任何估算落点；data/jianye-school-points.json 里没有的学校只进下拉、不上地图。
 */
export const SCHOOL_MAP_POINTS: SchoolMapPoint[] = JIANYE_SCHOOL_OPTIONS.flatMap((school) => {
  const coord = approvedPoints[school.code]
  if (!Array.isArray(coord) || coord.length !== 2) return []
  const stage = CATEGORY_STAGE[school.category] ?? CATEGORY_STAGE[school.stages[0] ?? ''] ?? 'primary'
  return [{ id: school.code, code: school.code, name: school.name, category: school.category, stage, ...projectCoordinate(coord as [number, number]) }]
})

/** 建邺没有湖泊矢量数据：Lake 组件保留，数据为空，不画假湖。 */
export const LAKE_POLYGONS: ScenePoint[][][] = []

/** 数据流汇聚点必须有业务含义；建邺暂无口径，先不给假汇聚。 */
export const CONVERGENCE_SCHOOLS: SchoolMapPoint[] = []
