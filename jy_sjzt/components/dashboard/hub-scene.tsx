'use client'

import { Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Grid, Html, Line, OrbitControls, useCursor, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import {
  CONVERGENCE_SCHOOLS,
  DISTRICT_RINGS,
  LAKE_POLYGONS,
  MAP_LEGEND,
  MAP_THICKNESS,
  MAP_WORLD_DEPTH,
  MAP_WORLD_WIDTH,
  SCHOOL_MAP_POINTS,
  TERRAIN_DEM,
  TERRAIN_IMAGERY,
  type MapStyle,
  type ScenePoint,
  type SchoolMapPoint,
  type SchoolMapStage,
} from '@/lib/education-map'
import { getSchoolTeacherProfile, type ProfileItem } from '@/lib/dashboard-data'
import { SCHOOL_LOGOS } from '@/lib/school-logos'
import { BRAIN_CENTER_Y, BRAIN_HALF_WIDTH, BRAIN_TOP_Y, NeuralBrain } from './neural-brain'
import { getSchoolEmblem } from './school-emblem'
import { ScreenFitScaleContext } from './screen-fit'

/** 场景里全是慢速自转与流光，30fps 看不出差别，而每帧的 JS 与绘制成本是持续占用 CPU 的主因。 */
const RENDER_FPS = 30
// 整屏 CSS 缩放后仍按实际显示尺寸绘制，最高约 320 万像素，避免 4K/Retina 无限增加填充量。
const RENDER_PIXEL_BUDGET = 3_200_000

const PLATFORM_RADIUS = MAP_WORLD_WIDTH * 0.54
const PARTICLES_PER_STREAM = 4
const SOCKET_Y = MAP_THICKNESS + 0.02
/** 紫金山 446 m 按约 2.4 倍竖向夸张后的最大起伏（世界单位，1 单位 ≈ 1 km）。 */
const TERRAIN_RELIEF = 1.05
const TERRAIN_BASE_Y = MAP_THICKNESS + 0.035
const STAGE_COLORS = Object.fromEntries(MAP_LEGEND.map((entry) => [entry.key, entry.color])) as Record<
  SchoolMapPoint['stage'],
  string
>
const STAGE_LABELS = Object.fromEntries(MAP_LEGEND.map((entry) => [entry.key, entry.label])) as Record<
  SchoolMapPoint['stage'],
  string
>

type SceneProps = {
  activeSchoolId: string | null
  stageFilter: SchoolMapStage | null
  mapStyle: MapStyle
  /** 画布两侧被侧栏遮住的总宽度（CSS px），相机会把场景装进剩余的中央区域。 */
  horizontalInset: number
  onSchoolSelect: (schoolId: string) => void
}

function useRadialTexture(inner: string, outer = 'rgba(0,0,0,0)') {
  return useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(1, outer)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [inner, outer])
}

function circlePoints(radius: number, segments = 128): [number, number, number][] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]
  })
}

function DistrictBody() {
  const geometry = useMemo(() => {
    const shapes = DISTRICT_RINGS.map(
      (ring) => new THREE.Shape(ring.map((point) => new THREE.Vector2(point.x, -point.z))),
    )
    const extruded = new THREE.ExtrudeGeometry(shapes, {
      depth: MAP_THICKNESS,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 1,
    })
    extruded.computeBoundingBox()
    return extruded
  }, [])
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 28), [geometry])
  const outline = useMemo(
    () =>
      DISTRICT_RINGS.map((ring) =>
        ring.map((point) => [point.x, MAP_THICKNESS + 0.06, point.z] as [number, number, number]),
      ),
    [],
  )

  const topMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#3a8bff',
      emissive: '#0b3f9c',
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.25,
    })
  }, [])

  const sideMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1f6fe6',
        emissive: '#0a3a95',
        emissiveIntensity: 0.9,
        roughness: 0.25,
        metalness: 0.2,
        transparent: true,
        opacity: 0.88,
      }),
    [],
  )

  return (
    <group>
      <mesh geometry={geometry} material={[topMaterial, sideMaterial]} rotation={[-Math.PI / 2, 0, 0]} />
      <lineSegments geometry={edges} rotation={[-Math.PI / 2, 0, 0]}>
        <lineBasicMaterial color="#7dd3fc" transparent opacity={0.5} toneMapped={false} />
      </lineSegments>
      {outline.map((ring, index) => (
        <group key={index}>
          <Line points={ring} color="#38bdf8" lineWidth={7} transparent opacity={0.22} toneMapped={false} />
          <Line points={ring} color="#c9f9ff" lineWidth={1.8} toneMapped={false} />
        </group>
      ))}
    </group>
  )
}

type HeightAt = (x: number, z: number) => number

/** 读取高程图像素，返回场景坐标处的地形抬升（世界单位）。 */
function useTerrainHeight(): HeightAt {
  const dem = useTexture(TERRAIN_DEM)
  const sampler = useMemo(() => {
    const image = dem.image as HTMLImageElement
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height)
    return (x: number, z: number) => {
      const u = THREE.MathUtils.clamp(x / MAP_WORLD_WIDTH + 0.5, 0, 1)
      const v = THREE.MathUtils.clamp(z / MAP_WORLD_DEPTH + 0.5, 0, 1)
      const px = u * (width - 1)
      const py = v * (height - 1)
      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const x1 = Math.min(x0 + 1, width - 1)
      const y1 = Math.min(y0 + 1, height - 1)
      const sample = (x: number, y: number) => data[(y * width + x) * 4]
      const top = THREE.MathUtils.lerp(sample(x0, y0), sample(x1, y0), px - x0)
      const bottom = THREE.MathUtils.lerp(sample(x0, y1), sample(x1, y1), px - x0)
      return (THREE.MathUtils.lerp(top, bottom, py - y0) / 255) * TERRAIN_RELIEF
    }
  }, [dem])
  return sampler
}

/** 区界掩膜：白色为区内，供卫星地形 alphaTest 裁切成区界形状。 */
function useDistrictMask() {
  return useMemo(() => {
    const width = 1024
    const height = Math.round((width * MAP_WORLD_DEPTH) / MAP_WORLD_WIDTH)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    for (const ring of DISTRICT_RINGS) {
      ring.forEach((point, index) => {
        const px = (point.x / MAP_WORLD_WIDTH + 0.5) * width
        const py = (point.z / MAP_WORLD_DEPTH + 0.5) * height
        if (index === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.closePath()
    }
    ctx.fill('evenodd')
    return new THREE.CanvasTexture(canvas)
  }, [])
}

/** 真实卫星影像贴在按高程起伏的网格上，并用区界掩膜裁切。 */
function TerrainSurface({ heightAt, mapStyle }: { heightAt: HeightAt; mapStyle: MapStyle }) {
  const imagery = useTexture(TERRAIN_IMAGERY)
  const gl = useThree((state) => state.gl)
  const mask = useDistrictMask()
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(MAP_WORLD_WIDTH, MAP_WORLD_DEPTH, 280, 240)
    const position = plane.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < position.count; index++) {
      position.setZ(index, heightAt(position.getX(index), -position.getY(index)))
    }
    plane.computeVertexNormals()
    return plane
  }, [heightAt])
  const material = useMemo(() => {
    imagery.colorSpace = THREE.SRGBColorSpace
    imagery.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    imagery.needsUpdate = true
    const satellite = mapStyle === 'satellite'
    const material = new THREE.MeshStandardMaterial({
      map: satellite ? imagery : null,
      emissiveMap: satellite ? imagery : null,
      emissive: satellite ? '#ffffff' : '#06366f',
      emissiveIntensity: satellite ? 0.4 : 0.6,
      alphaMap: mask,
      alphaTest: 0.5,
      roughness: 0.9,
      metalness: 0,
      color: satellite ? '#ffffff' : '#0954a0',
    })
    if (!satellite) {
      // 网格与等高线直接由同一份 DEM 网格生成，不再使用带虚构山脉的装饰图片。
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPosition;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPosition = position;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPosition;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            vec2 grid = vTerrainPosition.xy * 3.0;
            vec2 gridDistance = abs(fract(grid - 0.5) - 0.5) / max(fwidth(grid), vec2(0.0001));
            float gridLine = 1.0 - min(min(gridDistance.x, gridDistance.y), 1.0);
            float level = vTerrainPosition.z / 0.07;
            float contourDistance = abs(fract(level - 0.5) - 0.5) / max(fwidth(level), 0.0001);
            float contour = (1.0 - min(contourDistance, 1.0)) * smoothstep(0.08, 0.2, vTerrainPosition.z);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.65, 0.9), max(gridLine * 0.18, contour * 0.5));
          `)
      }
      material.customProgramCacheKey = () => 'dem-tech-contours-v1'
    }
    return material
  }, [imagery, mask, mapStyle, gl])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => mask.dispose(), [mask])

  return <mesh geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, TERRAIN_BASE_Y, 0]} />
}

const LAKE_Y = TERRAIN_BASE_Y + 0.015

/** 水面：深色湖面 + 发光湖岸线。建邺水系矢量缺失，当前数据为空，保留实现待接入。 */
function Lake({ heightAt }: { heightAt: HeightAt }) {
  const geometry = useMemo(() => {
    const shapes = LAKE_POLYGONS.map(([outer, ...holes]) => {
      const shape = new THREE.Shape(outer.map((point) => new THREE.Vector2(point.x, -point.z)))
      shape.holes = holes.map((ring) => new THREE.Path(ring.map((point) => new THREE.Vector2(point.x, -point.z))))
      return shape
    })
    const surface = new THREE.ShapeGeometry(shapes)
    const position = surface.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < position.count; index++) {
      position.setZ(index, heightAt(position.getX(index), -position.getY(index)))
    }
    return surface
  }, [heightAt])
  const shorelines = useMemo(
    () =>
      LAKE_POLYGONS.flat().map((ring) => ring.map((point) => [point.x, LAKE_Y + heightAt(point.x, point.z) + 0.01, point.z] as [number, number, number])),
    [heightAt],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <group>
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, LAKE_Y, 0]}>
        <meshBasicMaterial color="#021a45" transparent opacity={0.85} toneMapped={false} />
      </mesh>
      {shorelines.map((ring, index) => (
        <Line key={index} points={ring} color="#67e8f9" lineWidth={1.2} transparent opacity={0.8} toneMapped={false} />
      ))}
    </group>
  )
}

const PEDESTAL_STEP_HEIGHT = 0.36
const PEDESTAL_STEPS = [
  { y: -PEDESTAL_STEP_HEIGHT, radius: PLATFORM_RADIUS * 1.06, opacity: 0.6 },
  { y: -PEDESTAL_STEP_HEIGHT * 2, radius: PLATFORM_RADIUS * 1.14, opacity: 0.45 },
]

function Platform() {
  const glow = useRadialTexture('rgba(34,211,238,0.55)')
  const dashedOuter = useRef<THREE.Group>(null)
  const dashedInner = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (dashedOuter.current) dashedOuter.current.rotation.y = clock.elapsedTime * 0.08
    if (dashedInner.current) dashedInner.current.rotation.y = -clock.elapsedTime * 0.14
  })
  const outerRing = useMemo(() => circlePoints(PLATFORM_RADIUS * 1.1), [])
  const innerRing = useMemo(() => circlePoints(PLATFORM_RADIUS * 1.03), [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
        <planeGeometry args={[PLATFORM_RADIUS * 3.2, PLATFORM_RADIUS * 3.2]} />
        <meshBasicMaterial map={glow} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {PEDESTAL_STEPS.map((step) => (
        <group key={step.y} position={[0, step.y, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[step.radius, 96]} />
            <meshBasicMaterial color="#051c4c" transparent opacity={step.opacity} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <ringGeometry args={[step.radius - 0.05, step.radius, 128]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} toneMapped={false} />
          </mesh>
          <mesh position={[0, PEDESTAL_STEP_HEIGHT / 2, 0]}>
            <cylinderGeometry args={[step.radius, step.radius, PEDESTAL_STEP_HEIGHT, 96, 1, true]} />
            <meshBasicMaterial color="#0b3d94" transparent opacity={0.42} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <circleGeometry args={[PLATFORM_RADIUS, 96]} />
        <meshBasicMaterial color="#072a6b" transparent opacity={0.72} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <ringGeometry args={[PLATFORM_RADIUS - 0.08, PLATFORM_RADIUS, 128]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <ringGeometry args={[PLATFORM_RADIUS * 1.16, PLATFORM_RADIUS * 1.16 + 0.03, 128]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <group ref={dashedOuter}>
        <Line points={outerRing} color="#67e8f9" lineWidth={2.4} dashed dashSize={1.6} gapSize={0.8} transparent opacity={0.8} toneMapped={false} />
      </group>
      <group ref={dashedInner}>
        <Line points={innerRing} color="#93c5fd" lineWidth={1.2} dashed dashSize={0.3} gapSize={0.3} transparent opacity={0.6} toneMapped={false} />
      </group>
      <Grid
        position={[0, -0.08, 0]}
        args={[80, 80]}
        cellSize={1.2}
        cellThickness={0.6}
        cellColor="#0d3d84"
        sectionSize={6}
        sectionThickness={1}
        sectionColor="#1a5cc4"
        fadeDistance={42}
        fadeStrength={2.6}
        infiniteGrid
      />
    </group>
  )
}

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float fade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
    float stripes = 0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 3.2);
    float alpha = fade * (0.32 + 0.4 * stripes) * uStrength;
    gl_FragColor = vec4(uColor, alpha);
  }
`

/** 大脑正下方的地图中心投影：发光盘 + 旋转虚线环 + 呼吸光晕。 */
function Socket({ lift }: { lift: number }) {
  const glow = useRadialTexture('rgba(103,232,249,0.9)')
  const dashed = useRef<THREE.Group>(null)
  const disc = useRef<THREE.MeshBasicMaterial>(null)
  const ringPoints = useMemo(() => circlePoints(0.95, 96), [])
  useFrame(({ clock }) => {
    if (dashed.current) dashed.current.rotation.y = clock.elapsedTime * 0.6
    if (disc.current) disc.current.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4))
  })
  return (
    <group position={[0, SOCKET_Y + lift, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.4, 3.4]} />
        <meshBasicMaterial map={glow} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.62, 48]} />
        <meshBasicMaterial ref={disc} color="#22d3ee" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.56, 0.64, 64]} />
        <meshBasicMaterial color="#a5f3fc" transparent opacity={0.95} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <group ref={dashed} position={[0, 0.012, 0]}>
        <Line points={ringPoints} color="#7dd3fc" lineWidth={1.6} dashed dashSize={0.42} gapSize={0.22} transparent opacity={0.85} toneMapped={false} />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <ringGeometry args={[1.28, 1.31, 96]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** 围绕大脑的两条倾斜轨道环，各自缓慢反向旋转。 */
function OrbitRings() {
  const ringA = useRef<THREE.Group>(null)
  const ringB = useRef<THREE.Group>(null)
  const points = useMemo(() => circlePoints(2.7, 96), [])
  useFrame(({ clock }) => {
    if (ringA.current) ringA.current.rotation.y = clock.elapsedTime * 0.35
    if (ringB.current) ringB.current.rotation.y = -clock.elapsedTime * 0.28
  })
  return (
    <group>
      <group rotation={[Math.PI / 2.4, 0, 0.35]}>
        <group ref={ringA}>
          <Line points={points} color="#67e8f9" lineWidth={1.4} dashed dashSize={1.1} gapSize={0.45} transparent opacity={0.7} toneMapped={false} />
        </group>
      </group>
      <group rotation={[Math.PI / 2.9, 0, -0.55]}>
        <group ref={ringB}>
          <Line points={points} color="#a5f3fc" lineWidth={1} dashed dashSize={0.25} gapSize={0.35} transparent opacity={0.5} toneMapped={false} />
        </group>
      </group>
    </group>
  )
}

/** 3D 神经大脑（内嵌 AI 核心）+ 轨道环 + 地图中心投影。 */
function Brain({ socketLift }: { socketLift: number }) {
  return (
    <group>
      <NeuralBrain />
      <group position={[0, BRAIN_CENTER_Y, 0]}>
        <OrbitRings />
      </group>
      <Socket lift={socketLift} />
      <pointLight position={[0, BRAIN_CENTER_Y - 1, 0]} intensity={55} distance={18} color="#22d3ee" />
    </group>
  )
}

function DataStreams({ sources, heightAt }: { sources: ScenePoint[]; heightAt: HeightAt }) {
  const dot = useRadialTexture('rgba(255,255,255,1)')
  const curves = useMemo(
    () =>
      sources.map(
        (point) =>
          // 各校数据沿上拱弧线直接汇入大脑中心（AI 核心）。
          new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(point.x, MAP_THICKNESS + 0.05 + heightAt(point.x, point.z), point.z),
            new THREE.Vector3(point.x * 0.55, BRAIN_CENTER_Y * 0.55, point.z * 0.55),
            new THREE.Vector3(0, BRAIN_CENTER_Y, 0),
          ),
      ),
    [sources, heightAt],
  )
  const paths = useMemo(
    () => curves.map((curve) => curve.getPoints(48).map((p) => [p.x, p.y, p.z] as [number, number, number])),
    [curves],
  )
  const count = curves.length * PARTICLES_PER_STREAM
  const positions = useMemo(() => new Float32Array(count * 3), [count])
  const offsets = useMemo(
    () =>
      Float32Array.from({ length: count }, (_, index) => {
        const streamIndex = Math.floor(index / PARTICLES_PER_STREAM)
        const slot = index % PARTICLES_PER_STREAM
        return (slot / PARTICLES_PER_STREAM + streamIndex * 0.173) % 1
      }),
    [count],
  )
  const points = useRef<THREE.Points>(null)
  const scratch = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock }) => {
    const attribute = points.current?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute) return
    for (let index = 0; index < count; index++) {
      const curve = curves[Math.floor(index / PARTICLES_PER_STREAM)]
      const t = (clock.elapsedTime * 0.2 + offsets[index]) % 1
      curve.getPoint(t, scratch)
      attribute.setXYZ(index, scratch.x, scratch.y, scratch.z)
    }
    attribute.needsUpdate = true
  })

  return (
    <group>
      {paths.map((path, index) => (
        <Line key={index} points={path} color="#38bdf8" lineWidth={1} transparent opacity={0.32} toneMapped={false} />
      ))}
      <points ref={points} key={count}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={dot}
          color="#c7fbff"
          size={0.34}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  )
}

type CardMode = 'active' | 'hover'

function SchoolLogoPreview({ name }: { name: string }) {
  const src = SCHOOL_LOGOS[name]
  const [failed, setFailed] = useState(false)
  return src && !failed ? (
    <img
      src={src}
      alt={`${name}学校标识`}
      className="size-14 shrink-0 rounded-full bg-white/95 object-contain p-0.5"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-sky-300/30 px-1 text-center text-[10px] leading-tight text-sky-200/70">
      {failed ? '校徽加载失败' : '校徽未提供'}
    </span>
  )
}

function SchoolCard({
  point,
  profile,
  mode,
}: {
  point: SchoolMapPoint
  profile: ProfileItem[] | null
  mode: CardMode
}) {
  const color = STAGE_COLORS[point.stage]
  // 靠近地图东西两侧的点位，卡片向画面中央展开，避免被侧栏面板或左上角概况卡盖住。
  const side = point.x < -MAP_WORLD_WIDTH * 0.2 ? 'west' : point.x > MAP_WORLD_WIDTH * 0.2 ? 'east' : 'center'
  const transform =
    side === 'west' ? 'translate(20%, -100%)' : side === 'east' ? 'translate(-88%, -100%)' : 'translate(-50%, -100%)'

  return (
    <div
      className={`w-[188px] overflow-hidden rounded-md border bg-[#061a3f]/92 backdrop-blur-sm ${
        mode === 'active'
          ? 'border-cyan-300/80 shadow-[0_0_22px_rgba(34,211,238,0.45)]'
          : 'border-sky-300/50 shadow-[0_0_16px_rgba(34,211,238,0.3)]'
      }`}
      style={{ transform }}
    >
      <div className="flex items-center gap-2 border-b border-cyan-400/25 px-2.5 py-2">
        <SchoolLogoPreview key={point.name} name={point.name} />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug font-bold text-balance text-cyan-50">{point.name}</p>
          <span
            className="mt-1 inline-block rounded-sm px-1 py-px text-[10px] font-semibold"
            style={{ color, border: `1px solid ${color}66`, backgroundColor: `${color}1f` }}
          >
            {STAGE_LABELS[point.stage]}
          </span>
        </div>
      </div>
      {profile ? (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 px-2.5 py-1.5">
          {profile.map((item) => (
            <div key={item.key} className="flex flex-col whitespace-nowrap">
              <dt className="text-[10px] text-sky-200/70">{item.label}</dt>
              <dd className="font-display text-sm leading-none font-bold text-cyan-100 tabular-nums">
                {item.value}
                {item.unit && <span className="ml-0.5 text-[10px] font-semibold text-primary">{item.unit}</span>}
              </dd>
              {item.note && <dd className="mt-0.5 text-[9px] leading-none text-cyan-200/60">{item.note}</dd>}
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-2.5 py-2 text-[11px] text-sky-200/70">校级师资数据暂未接入</p>
      )}
    </div>
  )
}

type MarkerProps = {
  point: SchoolMapPoint
  active: boolean
  dimmed: boolean
  cardMode: CardMode | null
  onSelect: (schoolId: string) => void
  onHover: (schoolId: string | null) => void
  baseY: number
}

/** 学校点位：地面六边形基座 + 细光柱 + 悬浮的圆形校徽（始终面向相机）。 */
function SchoolMarker({ point, active, dimmed, cardMode, onSelect, onHover, baseY }: MarkerProps) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const color = STAGE_COLORS[point.stage]
  const emblem = useMemo(() => getSchoolEmblem(point.name, color), [point.name, color])
  const badge = useRef<THREE.Group>(null)
  const ripple = useRef<THREE.Mesh>(null)
  const iconMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const profile = useMemo(() => getSchoolTeacherProfile(point.name), [point.name])
  const emphasis = active || hovered
  const stemHeight = active ? 1.5 : 0.55
  const iconY = stemHeight + 0.3
  const iconSize = emphasis ? 0.78 : 0.56
  const alpha = dimmed ? 0.35 : 1

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (badge.current) badge.current.position.y = iconY + Math.sin(t * 1.4 + point.z) * 0.04
    if (iconMaterial.current) iconMaterial.current.opacity = alpha
    if (ripple.current) {
      const phase = (t * (emphasis ? 0.7 : 0.35) + point.x * 0.37) % 1
      ripple.current.scale.setScalar(1 + phase * (emphasis ? 2.4 : 1.6))
      ;(ripple.current.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * (emphasis ? 0.85 : 0.4) * alpha
    }
  })

  return (
    <group position={[point.x, baseY, point.z]}>
      <mesh
        position={[0, iconY, 0]}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(point.id)
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
          onHover(point.id)
        }}
        onPointerOut={() => {
          setHovered(false)
          onHover(null)
        }}
      >
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.32, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.22 * alpha} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.3, 0.36, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.95 * alpha} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={ripple} rotation={[-Math.PI / 2, 0, Math.PI / 6]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.32, 0.35, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>

      <mesh position={[0, stemHeight / 2, 0]}>
        <cylinderGeometry args={[0.014, 0.03, stemHeight, 8, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={(active ? 0.95 : 0.6) * alpha} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      <group ref={badge} position={[0, iconY, 0]}>
        <Billboard>
          <mesh scale={[iconSize * 1.18, iconSize * 1.18, 1]} position={[0, 0, -0.01]}>
            <circleGeometry args={[0.5, 40]} />
            <meshBasicMaterial color={color} transparent opacity={0.35 * alpha} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh scale={[iconSize, iconSize, 1]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial ref={iconMaterial} map={emblem} transparent alphaTest={0.05} depthWrite={false} toneMapped={false} />
          </mesh>
        </Billboard>
      </group>

      {cardMode && (
        <Html position={[0, iconY + 0.45, 0]} zIndexRange={[30, 10]} style={{ pointerEvents: 'none' }}>
          <SchoolCard point={point} profile={profile} mode={cardMode} />
        </Html>
      )}
    </group>
  )
}

function Stage({ activeSchoolId, stageFilter, mapStyle, onSchoolSelect }: Omit<SceneProps, 'horizontalInset'>) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const heightAt = useTerrainHeight()
  const visiblePoints = useMemo(
    () => (stageFilter ? SCHOOL_MAP_POINTS.filter((point) => point.stage === stageFilter) : SCHOOL_MAP_POINTS),
    [stageFilter],
  )
  const active = visiblePoints.find((point) => point.id === activeSchoolId)

  const sources = useMemo(() => {
    // 筛选学段时，汇聚光流也只从该学段的学校出发。
    const base = stageFilter ? visiblePoints.filter((_, index) => index % 2 === 0) : CONVERGENCE_SCHOOLS
    return active && !base.includes(active) ? [...base, active] : base
  }, [active, stageFilter, visiblePoints])

  return (
    <group>
      <Platform />
      <DistrictBody />
      <TerrainSurface heightAt={heightAt} mapStyle={mapStyle} />
      {mapStyle === 'tech' && <Lake heightAt={heightAt} />}
      <Brain socketLift={heightAt(0, 0) + 0.05} />
      <DataStreams sources={sources} heightAt={heightAt} />
      {visiblePoints.map((point) => {
        const isActive = point.id === activeSchoolId
        const cardMode: CardMode | null = isActive ? 'active' : point.id === hoveredId ? 'hover' : null
        return (
          <SchoolMarker
            key={point.id}
            point={point}
            active={isActive}
            dimmed={Boolean(active) && !isActive}
            cardMode={cardMode}
            onSelect={onSchoolSelect}
            onHover={setHoveredId}
            baseY={TERRAIN_BASE_Y + heightAt(point.x, point.z)}
          />
        )
      })}
    </group>
  )
}

// 约 34° 俯角：比之前更贴近参考图的低视角，地图侧壁与台阶层次更明显。
const CAMERA_DIRECTION = new THREE.Vector3(0, 14.5, 21.5).normalize()
// 留出边距，保证悬停卡片和左上角区域概况卡不会被裁切或压住地图。
const FIT_MARGIN = 0.8

type ControlsLike = { target: THREE.Vector3; minDistance: number; maxDistance: number; update: () => void }

/** 用于取景的采样点：底座主环 + 最外层台阶前缘 + 大脑顶部/两侧，保证整组场景装进中央可视区。 */
function fitSamples() {
  const rim = circlePoints(PLATFORM_RADIUS * 0.98, 24).map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const lowest = PEDESTAL_STEPS[PEDESTAL_STEPS.length - 1]
  return [
    ...rim,
    new THREE.Vector3(0, lowest.y, lowest.radius),
    new THREE.Vector3(0, BRAIN_TOP_Y + 0.3, 0),
    new THREE.Vector3(-BRAIN_HALF_WIDTH, BRAIN_CENTER_Y, 0),
    new THREE.Vector3(BRAIN_HALF_WIDTH, BRAIN_CENTER_Y, 0),
  ]
}

/** ��据画布尺寸与两侧遮挡宽度，自动把相机推远/拉近，让地图在任何分辩率下都填满中央区域。 */
function CameraRig({ horizontalInset }: { horizontalInset: number }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const size = useThree((state) => state.size)
  const controls = useThree((state) => state.controls) as unknown as ControlsLike | null
  const samples = useMemo(fitSamples, [])

  useLayoutEffect(() => {
    const usableX = Math.max(0.25, (size.width - horizontalInset) / size.width) * FIT_MARGIN
    const usableY = FIT_MARGIN
    const target = new THREE.Vector3(0, 2.5, 0)
    const up = new THREE.Vector3()
    const ndc = new THREE.Vector3()
    let distance = 30
    // r3f 在父级 effect 里才同步 aspect，这里先手动更新，避免用旧比例取景。
    camera.aspect = size.width / size.height

    for (let pass = 0; pass < 6; pass++) {
      camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance).add(target)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()

      let maxX = 0
      let minY = Infinity
      let maxY = -Infinity
      for (const sample of samples) {
        ndc.copy(sample).project(camera)
        maxX = Math.max(maxX, Math.abs(ndc.x))
        minY = Math.min(minY, ndc.y)
        maxY = Math.max(maxY, ndc.y)
      }
      const ratio = Math.max(maxX / usableX, (maxY - minY) / 2 / usableY)
      distance *= ratio

      const halfHeightWorld = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      up.set(0, 1, 0).applyQuaternion(camera.quaternion)
      target.addScaledVector(up, ((maxY + minY) / 2) * halfHeightWorld)
    }

    if (controls) {
      controls.target.copy(target)
      controls.minDistance = distance * 0.7
      controls.maxDistance = distance * 1.45
      controls.update()
    }
  }, [camera, controls, size.width, size.height, horizontalInset, samples])

  return null
}

/**
 * 自己驱动渲染循环：限帧到 RENDER_FPS，进入校园页卸载地图时取消循环（frameloop="never" 下 r3f 不会自己渲染）。
 * advance 的时间戳按秒传——r3f 在该模式下会把它直接写进 clock.elapsedTime，与场景里所有 useFrame 的口径一致。
 */
function RenderGate() {
  const advance = useThree((state) => state.advance)
  const clock = useThree((state) => state.clock)

  useEffect(() => {
    const frameMs = 1000 / RENDER_FPS
    let time = clock.elapsedTime
    let last = performance.now()
    let handle = requestAnimationFrame(function loop(now) {
      handle = requestAnimationFrame(loop)
      if (now - last < frameMs - 2) return
      // 停帧后恢复时间隔可能很大，夹住 delta 免得流光粒子一帧飞出轨迹
      time += Math.min(0.1, (now - last) / 1000)
      last = now
      advance(time, true)
    })
    return () => cancelAnimationFrame(handle)
  }, [advance, clock])

  return null
}

/** CSS transform 不会改变 R3F 的布局尺寸，需补偿缩放倍率并限制绘制像素总量。 */
function RenderResolution({ displayScale, onDprChange }: { displayScale: number; onDprChange: (dpr: number) => void }) {
  const size = useThree((state) => state.size)

  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      if (!size.width || !size.height) return
      const density = Math.min(window.devicePixelRatio || 1, 1.5)
      const budgetDpr = Math.sqrt(RENDER_PIXEL_BUDGET / (size.width * size.height))
      onDprChange(Math.min(displayScale * density, budgetDpr, 2.5))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [displayScale, size.width, size.height, onDprChange])

  return null
}

export function HubScene({ activeSchoolId, stageFilter, mapStyle, horizontalInset, onSchoolSelect }: SceneProps) {
  const [dpr, setDpr] = useState(1)
  const displayScale = useContext(ScreenFitScaleContext)
  return (
    <Canvas
      flat
      dpr={dpr}
      // r3f 的内部循环关掉，改由 RenderGate 按 RENDER_FPS 手动推进，进入校园页时卸载停帧。
      frameloop="never"
      camera={{ position: [0, 14.5, 21.5], fov: 31, near: 0.1, far: 160 }}
      // 外层 ScreenFit 用 transform 缩放整屏，必须按 offsetWidth/Height 取布局尺寸，否则画布会被拉伸或裁切。
      resize={{ scroll: false, debounce: { scroll: 50, resize: 0 }, offsetSize: true }}
      // 清晰度由 RenderResolution 按显示尺寸控制；保持关闭 MSAA，控制显存与填充成本。
      gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
      fallback={
        <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
          建邺区教育地图三维场景需要 WebGL 支持
        </div>
      }
    >
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.45}
        zoomSpeed={0.5}
        minPolarAngle={0.5}
        maxPolarAngle={1.25}
      />
      <CameraRig horizontalInset={horizontalInset} />
      <RenderResolution displayScale={displayScale} onDprChange={setDpr} />
      <RenderGate />
      <ambientLight intensity={1.1} color="#8bb8ff" />
      <directionalLight position={[8, 14, 10]} intensity={1.8} color="#d6ebff" />
      <directionalLight position={[-10, 6, -6]} intensity={0.6} color="#3b82f6" />
      <Suspense fallback={null}>
        <Stage activeSchoolId={activeSchoolId} stageFilter={stageFilter} mapStyle={mapStyle} onSchoolSelect={onSchoolSelect} />
      </Suspense>
    </Canvas>
  )
}
