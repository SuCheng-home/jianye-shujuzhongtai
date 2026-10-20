'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MAP_THICKNESS } from '@/lib/education-map'

/** 现成的大脑网格（bytezpro/threejs-brain-animation，MIT），长轴沿 x，y 向上。 */
const BRAIN_MODEL_URL = '/models/brain.glb'
/** 大脑三向半径：模型按 x 向长度缩放到这里，其余两向随模型比例。 */
export const BRAIN_RADII = { x: 2.35, y: 1.45, z: 1.7 }
export const BRAIN_CENTER_Y = MAP_THICKNESS + 3.45
export const BRAIN_TOP_Y = BRAIN_CENTER_Y + BRAIN_RADII.y + 0.35
export const BRAIN_HALF_WIDTH = BRAIN_RADII.x + 0.35
/** 脑干在此高度以下回到中轴线，外层螺旋光纤从插座一直包裹到这里。 */
export const BRAIN_STEM_AXIS_Y = BRAIN_CENTER_Y - 2.0

const NODE_STRIDE = 6
const NEIGHBOURS = 3
const MAX_EDGE_LENGTH = 1.0
const PULSE_COUNT = 56
const HUB_EVERY = 9

useGLTF.preload(BRAIN_MODEL_URL)

type BrainGeometry = {
  shell: THREE.BufferGeometry
  nodes: THREE.Vector3[]
  stemRoot: THREE.Vector3
}

/** 读取 GLB 中的大脑网格，居中并缩放到 BRAIN_RADII，同时抽取一部分顶点作为神经节点。 */
function useBrainGeometry(): BrainGeometry {
  const { scene } = useGLTF(BRAIN_MODEL_URL)
  return useMemo(() => {
    let source: THREE.BufferGeometry | null = null
    scene.traverse((child) => {
      if (!source && (child as THREE.Mesh).isMesh) source = (child as THREE.Mesh).geometry
    })
    const shell = mergeVertices((source ?? new THREE.SphereGeometry(1, 32, 24)).clone())
    shell.computeBoundingBox()
    const box = shell.boundingBox!
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = (BRAIN_RADII.x * 2) / size.x
    shell.translate(-center.x, -center.y, -center.z)
    shell.scale(scale, scale, scale)
    shell.computeVertexNormals()
    shell.computeBoundingBox()

    const position = shell.attributes.position as THREE.BufferAttribute
    const nodes: THREE.Vector3[] = []
    for (let index = 0; index < position.count; index += NODE_STRIDE) {
      nodes.push(new THREE.Vector3().fromBufferAttribute(position, index))
    }
    // 脑干从模型底面中央略偏后处接出。
    const stemRoot = new THREE.Vector3(-0.25, shell.boundingBox!.min.y + 0.15, 0)
    return { shell, nodes, stemRoot }
  }, [scene])
}

type Network = {
  nodes: THREE.Vector3[]
  edges: [number, number][]
  adjacency: number[][]
  nodePositions: Float32Array
  hubPositions: Float32Array
  edgePositions: Float32Array
}

/** 把皮层上的每个节点与最近的几个节点相连，得到神经网络图。 */
function buildNetwork(nodes: THREE.Vector3[]): Network {
  const edges: [number, number][] = []
  const seen = new Set<string>()
  const adjacency: number[][] = nodes.map(() => [])
  const candidates: { index: number; distance: number }[] = []
  nodes.forEach((node, index) => {
    candidates.length = 0
    nodes.forEach((other, otherIndex) => {
      if (otherIndex === index) return
      const distance = node.distanceTo(other)
      if (distance <= MAX_EDGE_LENGTH) candidates.push({ index: otherIndex, distance })
    })
    candidates.sort((a, b) => a.distance - b.distance)
    for (const candidate of candidates.slice(0, NEIGHBOURS)) {
      const key = index < candidate.index ? `${index}-${candidate.index}` : `${candidate.index}-${index}`
      if (seen.has(key)) continue
      seen.add(key)
      const edgeIndex = edges.push([index, candidate.index]) - 1
      adjacency[index].push(edgeIndex)
      adjacency[candidate.index].push(edgeIndex)
    }
  })

  const regular: number[] = []
  const hubs: number[] = []
  nodes.forEach((node, index) => {
    const target = index % HUB_EVERY === 0 ? hubs : regular
    target.push(node.x, node.y, node.z)
  })
  const edgePositions = new Float32Array(edges.length * 6)
  edges.forEach(([a, b], index) => {
    edgePositions.set([nodes[a].x, nodes[a].y, nodes[a].z, nodes[b].x, nodes[b].y, nodes[b].z], index * 6)
  })

  return {
    nodes,
    edges,
    adjacency,
    nodePositions: Float32Array.from(regular),
    hubPositions: Float32Array.from(hubs),
    edgePositions,
  }
}

const fresnelVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const fresnelFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - facing, 3.0);
    float alpha = 0.012 + rim * (0.3 + uPulse * 0.12);
    gl_FragColor = vec4(uColor * (0.8 + rim * 0.6), alpha);
  }
`

function useGlowTexture() {
  return useMemo(() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(canvas)
  }, [])
}

/** 把 “AI” 字样绘制成贴图，嵌在大脑核心，避免依赖外部字体文件。 */
function useAiTexture() {
  return useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, size, size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 132px "Rajdhani", "Noto Sans SC", "Segoe UI", sans-serif'
    ctx.shadowColor = 'rgba(34,211,238,1)'
    ctx.shadowBlur = 30
    ctx.fillStyle = '#7dd3fc'
    ctx.fillText('AI', size / 2, size / 2 + 6)
    ctx.shadowBlur = 8
    ctx.fillStyle = '#f0fdff'
    ctx.fillText('AI', size / 2, size / 2 + 6)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])
}

function HologramShell({ geometry, color }: { geometry: THREE.BufferGeometry; color: string }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(color) }, uPulse: { value: 0 } }), [color])
  useFrame(({ clock }) => {
    if (material.current) material.current.uniforms.uPulse.value = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.4)
  })
  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={fresnelVertex}
        fragmentShader={fresnelFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

/** 沿神经连线随机游走的信号脉冲。 */
function SignalPulses({ network }: { network: Network }) {
  const glow = useGlowTexture()
  const points = useRef<THREE.Points>(null)
  const positions = useMemo(() => new Float32Array(PULSE_COUNT * 3), [])
  const state = useMemo(() => {
    const edge = new Int32Array(PULSE_COUNT)
    const progress = new Float32Array(PULSE_COUNT)
    const forward = new Int8Array(PULSE_COUNT)
    const speed = new Float32Array(PULSE_COUNT)
    for (let index = 0; index < PULSE_COUNT; index++) {
      edge[index] = Math.floor(Math.random() * network.edges.length)
      progress[index] = Math.random()
      forward[index] = Math.random() > 0.5 ? 1 : -1
      speed[index] = 0.9 + Math.random() * 1.4
    }
    return { edge, progress, forward, speed }
  }, [network])
  const scratch = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const attribute = points.current?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute) return
    for (let index = 0; index < PULSE_COUNT; index++) {
      state.progress[index] += delta * state.speed[index]
      if (state.progress[index] >= 1) {
        const [a, b] = network.edges[state.edge[index]]
        const arrived = state.forward[index] === 1 ? b : a
        const options = network.adjacency[arrived]
        const nextEdge = options[Math.floor(Math.random() * options.length)]
        state.edge[index] = nextEdge
        state.forward[index] = network.edges[nextEdge][0] === arrived ? 1 : -1
        state.progress[index] = 0
      }
      const [a, b] = network.edges[state.edge[index]]
      const from = state.forward[index] === 1 ? network.nodes[a] : network.nodes[b]
      const to = state.forward[index] === 1 ? network.nodes[b] : network.nodes[a]
      scratch.lerpVectors(from, to, state.progress[index])
      attribute.setXYZ(index, scratch.x, scratch.y, scratch.z)
    }
    attribute.needsUpdate = true
  })

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={glow}
        color="#ffffff"
        size={0.2}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}

/** 大脑核心：嵌入的 “AI” 字样 + 旋转线框多面体 + 内核光晕。 */
function AiCore() {
  const ai = useAiTexture()
  const glow = useGlowTexture()
  const cage = useRef<THREE.Mesh>(null)
  const label = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (cage.current) {
      cage.current.rotation.y = t * 0.5
      cage.current.rotation.x = Math.sin(t * 0.3) * 0.4
    }
    if (label.current) label.current.opacity = 0.85 + 0.15 * Math.sin(t * 2.1)
  })
  return (
    <group position={[0.15, 0.05, 0]}>
      <sprite scale={[2.6, 2.6, 1]}>
        <spriteMaterial map={glow} color="#22d3ee" transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <mesh>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={cage}>
        <icosahedronGeometry args={[0.82, 1]} />
        <meshBasicMaterial color="#67e8f9" wireframe transparent opacity={0.45} depthWrite={false} toneMapped={false} />
      </mesh>
      <Billboard>
        <mesh>
          <planeGeometry args={[1.25, 1.25]} />
          <meshBasicMaterial ref={label} map={ai} transparent depthWrite={false} depthTest={false} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  )
}

/**
 * 全 3D 的神经大脑：现成大脑网格作全息外壳 + 沿网格的皮层神经网络 + 脑干。
 * 整体缓慢自转，脑干下端在中轴线上，与地图中心的插座和脊髓光纤衔接。
 */
export function NeuralBrain() {
  const glow = useGlowTexture()
  const group = useRef<THREE.Group>(null)
  const { shell, nodes } = useBrainGeometry()
  const network = useMemo(() => buildNetwork(nodes), [nodes])

  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.elapsedTime * 0.16
  })

  return (
    <group position={[0, BRAIN_CENTER_Y, 0]}>
      <group ref={group}>
        <HologramShell geometry={shell} color="#38bdf8" />
        <mesh geometry={shell}>
          <meshBasicMaterial color="#0ea5e9" wireframe transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>

        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[network.edgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#4cc9ff" transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>

        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[network.nodePositions, 3]} />
          </bufferGeometry>
          <pointsMaterial map={glow} color="#a5f3fc" size={0.09} sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </points>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[network.hubPositions, 3]} />
          </bufferGeometry>
          <pointsMaterial map={glow} color="#ffffff" size={0.2} sizeAttenuation transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </points>

        <SignalPulses network={network} />
        <AiCore />
      </group>
      <sprite scale={[7, 5.6, 1]} position={[0, 0, -0.2]}>
        <spriteMaterial map={glow} color="#0ea5e9" transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  )
}
