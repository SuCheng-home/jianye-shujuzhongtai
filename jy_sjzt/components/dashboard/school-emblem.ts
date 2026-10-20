import * as THREE from 'three'
import { SCHOOL_LOGOS, SCHOOL_SHORT_NAMES } from '@/lib/school-logos'

const SIZE = 256
const cache = new Map<string, THREE.Texture>()

function shortNameOf(name: string) {
  if (SCHOOL_SHORT_NAMES[name]) return SCHOOL_SHORT_NAMES[name]
  const core = name
    .replace(/^南京市?/, '')
    .replace(/^建邺区?/, '')
    .replace(/(附属)?(幼儿园|小学|初级中学|中学|中等专业学校|学校).*$/, '')
  return core.slice(0, 2) || name.slice(0, 2)
}

function drawArcText(ctx: CanvasRenderingContext2D, text: string, radius: number, centerAngle: number, spread: number, inward: boolean) {
  const chars = [...text]
  const step = chars.length > 1 ? spread / (chars.length - 1) : 0
  const start = centerAngle - spread / 2
  chars.forEach((char, index) => {
    const angle = start + step * index
    ctx.save()
    ctx.translate(SIZE / 2 + Math.cos(angle) * radius, SIZE / 2 + Math.sin(angle) * radius)
    ctx.rotate(angle + (inward ? Math.PI / 2 : -Math.PI / 2))
    ctx.fillText(char, 0, 0)
    ctx.restore()
  })
}

/** 按学校名称绘制校徽风格的圆形徽章（外环校名 + 中心简称），用作没有真实校徽时的默认图标。 */
function drawEmblem(name: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const c = SIZE / 2

  ctx.beginPath()
  ctx.arc(c, c, 124, 0, Math.PI * 2)
  ctx.fillStyle = '#f8fbff'
  ctx.fill()
  ctx.lineWidth = 8
  ctx.strokeStyle = color
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(c, c, 84, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  const ringName = name.replace(/^南京市/, '')
  const nameChars = [...ringName].length
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${nameChars > 12 ? 17 : 21}px "Noto Sans SC", "PingFang SC", sans-serif`
  drawArcText(ctx, ringName, 104, -Math.PI / 2, Math.min(Math.PI * 1.25, nameChars * 0.2), false)

  ctx.font = '700 12px "Noto Sans SC", sans-serif'
  drawArcText(ctx, 'XUANWU · NANJING', 106, Math.PI / 2, 1.5, true)

  for (const angle of [Math.PI * 0.18, Math.PI * 0.82]) {
    ctx.beginPath()
    ctx.arc(c + Math.cos(angle) * 104, c + Math.sin(angle) * 104, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  const short = shortNameOf(name)
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 ${short.length >= 3 ? 44 : 58}px "Noto Sans SC", "PingFang SC", sans-serif`
  ctx.fillText(short, c, c + 3)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** 优先加载 lib/school-logos.ts 中配置的真实校徽，否则生成默认徽章。 */
export function getSchoolEmblem(name: string, color: string) {
  const key = `${name}|${color}`
  const cached = cache.get(key)
  if (cached) return cached
  const logo = SCHOOL_LOGOS[name]
  let texture: THREE.Texture
  if (logo) {
    texture = new THREE.TextureLoader().load(logo)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
  } else {
    texture = drawEmblem(name, color)
  }
  cache.set(key, texture)
  return texture
}
