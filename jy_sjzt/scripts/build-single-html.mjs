#!/usr/bin/env node
/**
 * 生成“单文件 HTML”版大屏。
 *
 * 步骤：
 *   1) NEXT_STATIC_EXPORT=1 静态导出 Next.js（产物在 out/）；
 *   2) 把 CSS、JS、字体、图片、3D 模型全部内联为 data URI，外链脚本一个不剩；
 *   3) 内联数字人（jianye-robot.js）与扣子 Web SDK，双击 HTML 即可打开；
 *   4) 把页面间路由链接重写成同目录单文件名，离线互跳不依赖服务器。
 *
 * 用法：npm run build:single / build:campus / build:usage
 * 产物：dist/建邺区教育数智中枢.html、dist/建邺区应用运营.html、dist/建邺区应用使用情况.html
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'out')
const distDir = path.join(root, 'dist')
const tmpDir = path.join(os.tmpdir(), `sjzs-single-${process.pid}`)
const skipBuild = process.argv.includes('--skip-build')
const campusOnly = process.argv.includes('--campus') || process.argv.includes('--usage')

/** 页面模式：入口、产物名、是否内联 3D 素材、路由链接重写表。 */
const PAGE = process.argv.includes('--usage')
  ? {
      entry: 'app-usage.html',
      output: '建邺区应用使用情况.html',
      inline3dAssets: false,
      rewrites: { '/smart-campus?from=usage': '建邺区应用运营.html?from=usage' },
    }
  : process.argv.includes('--campus')
    ? {
        entry: 'smart-campus.html',
        output: '建邺区应用运营.html',
        inline3dAssets: false,
        rewrites: { '/app-usage?app=': '建邺区应用使用情况.html?app=' },
      }
    : {
        entry: 'index.html',
        output: '建邺区教育数智中枢.html',
        inline3dAssets: true,
        rewrites: {},
      }
const entryFile = PAGE.entry
const OUTPUT_NAME = PAGE.output

/* ---------- 1. 静态导出构建 ---------- */
console.log('[1/4] 静态导出构建 …')
if (!skipBuild) execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NEXT_STATIC_EXPORT: '1' },
})
if (!fs.existsSync(path.join(outDir, entryFile))) {
  throw new Error(`未找到 out/${entryFile}，静态导出失败`)
}

/* ---------- 2. 资源压缩 + data URI ---------- */
console.log('[2/4] 压缩图片并生成 data URI …')
fs.mkdirSync(tmpDir, { recursive: true })

function sips(input, output, format, quality) {
  execSync(
    `sips -s format ${format}${quality ? ` -s formatOptions ${quality}` : ''} ${JSON.stringify(input)} --out ${JSON.stringify(output)}`,
    { stdio: 'ignore' },
  )
  return output
}

function encode(file) {
  return fs.readFileSync(file).toString('base64')
}

/** 路径 → { mime, base64 }；图片先经 sips 压缩以控制单文件体积。 */
function buildAssetMap() {
  const map = new Map()
  if (PAGE.inline3dAssets) {
  const images = [
    { url: '/images/terrain-jy/satellite.jpg', file: 'images/terrain-jy/satellite.jpg', jpegQuality: 82 },
    { url: '/images/terrain-jy/dem.png', file: 'images/terrain-jy/dem.png' },
  ]

  for (const item of images) {
    const source = path.join(root, 'public', item.file)
    if (!fs.existsSync(source)) {
      console.warn(`  跳过缺失资源：${item.url}`)
      continue
    }
    if (item.jpegQuality) {
      const target = path.join(tmpDir, `${item.file.replace(/[\\/]/g, '_')}.jpg`)
      sips(source, target, 'jpeg', item.jpegQuality)
      // 已压缩过的原图重编码可能反而更大，取体积小的一份。
      if (fs.statSync(target).size < fs.statSync(source).size) {
        map.set(item.url, { mime: 'image/jpeg', base64: encode(target) })
      } else {
        const mime = item.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
        map.set(item.url, { mime, base64: encode(source) })
      }
    } else {
      map.set(item.url, { mime: 'image/png', base64: encode(source) })
    }
    console.log(`  ${item.url} → ${item.jpegQuality ? 'jpeg' : '原格式'} ${(map.get(item.url).base64.length / 1365).toFixed(0)} KB`)
  }

  const model = path.join(root, 'public/models/brain.glb')
  map.set('/models/brain.glb', { mime: 'model/gltf-binary', base64: encode(model) })

  // 学校校徽（lib/school-logos.ts 里的 /images/logos/*.png）：一并内联，单文件里地图点位才不会丢图。
  }

  for (const icon of ['icon.svg', 'icon-light-32x32.png', 'icon-dark-32x32.png', 'apple-icon.png']) {
    const file = path.join(root, 'public', icon)
    if (!fs.existsSync(file)) continue
    if (icon.endsWith('.svg')) {
      const svg = fs.readFileSync(file, 'utf8')
      map.set(`/${icon}`, { mime: 'image/svg+xml;utf8', base64: Buffer.from(svg, 'utf8').toString('base64') })
    } else {
      map.set(`/${icon}`, { mime: 'image/png', base64: encode(file) })
    }
  }
  return map
}

const assetMap = buildAssetMap()

function dataUri(asset) {
  return `data:${asset.mime};base64,${asset.base64}`
}

/* ---------- 3. 内联 HTML ---------- */
console.log('[3/4] 内联 HTML / CSS / JS …')
let html = fs.readFileSync(path.join(outDir, entryFile), 'utf8')

function readOut(assetPath) {
  return fs.readFileSync(path.join(outDir, assetPath.replace(/^\//, '')), 'utf8')
}

/** 内联脚本时转义 </script（JS 字符串里等价写作 <\/script），否则 HTML 解析器会提前收尾。 */
function escapeInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script')
}

function escapeInlineStyle(css) {
  return css.replace(/<\/style/gi, '<\\/style')
}

/** @font-face 与其它 CSS 里的字体路径（绝对或相对 ../media/）一并转 data URI。 */
function inlineCss(css) {
  // 中文字库（Noto Sans SC）为 100+ 个 unicode-range 子集、合计 4.7MB，且同一文件被多处 @font-face 引用，
  // 内联后体积成倍放大；单文件里改由系统字体渲染（字体栈已含 PingFang SC / 微软雅黑）。
  const withoutCjk = css.replace(/@font-face\{font-family:(?:"|')?Noto Sans SC[^}]*\}/g, '')
  return withoutCjk.replace(/url\((?:['"])?(?:\.\.\/media\/|\/_next\/static\/media\/)([^)"']+)(?:['"])?\)/g, (_match, name) => {
    const file = path.join(outDir, '_next/static/media', name)
    if (!fs.existsSync(file)) return _match
    const ext = path.extname(file).slice(1)
    const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : 'application/octet-stream'
    return `url(data:${mime};base64,${encode(file)})`
  })
}

html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_match, href) =>
  `<style>${escapeInlineStyle(inlineCss(readOut(href)))}</style>`,
)

let scriptCount = 0
// turbopack 运行时用 script.getAttribute('src') 作为分块标识，内联脚本没有 src 会取到 null 而报错；
// 这里补一个 data-chunk-src 兜底（见下方 PATCH_RUNTIME），保持分块标识与原始 URL 一致。
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (_match, _before, src, _after) => {
  const code = escapeInlineScript(patchTurbopackRuntime(readOut(src)))
  scriptCount += 1
  return `<script data-chunk-src="${src}">${code}</script>`
})

/** 兼容内联脚本没有 src 的情况：分块标识回退到 data-chunk-src，资源前缀按同源路径解析。 */
function patchTurbopackRuntime(code) {
  return code
    .replace(
      /if\(e\)return\{src:e\.getAttribute\("src"\)\}/g,
      'if(e)return{src:e.getAttribute("src")||(e.dataset&&e.dataset.chunkSrc)}',
    )
    .replace(
      /new URL\(e\.src\)/g,
      'new URL(e.src||new URL((e.dataset&&e.dataset.chunkSrc)||"/",location.href).href)',
    )
}

// 预加载提示指向的 _next 资源在单文件里已内联，删掉避免 404。
html = html.replace(/<link[^>]*rel="(?:preload|modulepreload)"[^>]*href="\/_next\/[^"]*"[^>]*>/g, '')

// 页面里出现的资源路径统一替换成 data URI。RSC 数据把引号转义为 \"，因此直接按裸路径替换。
function replaceAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement)
}

for (const [url, asset] of assetMap) {
  html = replaceAll(html, url, dataUri(asset))
}

// RSC 数据里还会按 URL 预载样式，样式已内联进 <style>，这里换成空样式表避免多余请求。
for (const match of [...html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9._-]+\.css/g)]) {
  html = replaceAll(html, match[0], 'data:text/css;base64,')
}

// RSC 数据里还会按 URL 预载字体，把这些字体也一并内联，避免单文件出现失效引用。
for (const match of [...html.matchAll(/\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2/g)]) {
  const file = path.join(outDir, match[0].replace(/^\//, ''))
  if (!fs.existsSync(file)) continue
  html = replaceAll(html, match[0], `data:font/woff2;base64,${encode(file)}`)
}

/* ---------- 4. 内联数字人与扣子 SDK ---------- */
console.log(campusOnly ? '[4/4] 内联数字人与扣子智能体（独立页） …' : '[4/4] 内联数字人与扣子智能体 …')
{
// 数字人脚本由 DigitalHuman 在水合完成后 fetch 后执行；单文件里把这两个地址换成 data: 源码，
// 直接内联 <script> 会被 App Router 的 body 水合当成多余节点清掉。
// 中枢与校园独立页都带数字人，两份产物都要做这步替换。
const robotCode = fs.readFileSync(path.join(root, 'public/jianye-robot.js'), 'utf8')
const sdkCode = fs.readFileSync(path.join(root, 'public/coze-web-sdk.js'), 'utf8')
for (const [url, code] of [
  ['/jianye-robot.js', robotCode],
  ['/coze-web-sdk.js', sdkCode],
]) {
  const uri = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`
  html = replaceAll(html, `"${url}"`, `"${uri}"`)
  html = replaceAll(html, `'${url}'`, `'${uri}'`)
}
}

// 单文件里所有 chunk 都已内联；保留资源加载守卫，研训单独导出，不注入大屏源码或切换事件。
const chunkGuard = `(function(){var append=document.head.appendChild.bind(document.head);document.head.appendChild=function(node){try{if(node&&node.tagName==="SCRIPT"&&typeof node.src==="string"&&node.src.indexOf("/_next/static/chunks/")!==-1){setTimeout(function(){try{node.onload&&node.onload(new Event("load"));}catch(e){}},0);return node;}}catch(e){}return append(node);};})();`
const prelude = chunkGuard
html = html.replace(/<script( data-chunk-src="[^"]*")?>/, (match) => `${match}${escapeInlineScript(prelude)}`)

// 页面间跳转：把 Next 路由换成同目录单文件名（带查询串的精确匹配，不会误伤 chunk 路径）。
for (const [from, to] of Object.entries(PAGE.rewrites)) {
  html = replaceAll(html, from, to)
}

fs.mkdirSync(distDir, { recursive: true })
const target = path.join(distDir, OUTPUT_NAME)
fs.writeFileSync(target, html, 'utf8')

const leftovers = [...html.matchAll(/\/_next\/[a-zA-Z0-9_./-]+/g)].map((m) => m[0])
/** 这些只是运行时内部字符串（图片 loader 配置、分块标识），不会真的发起外链请求。 */
const benign = (url) =>
  url.includes('/_next/static/immutable') ||
  url === '/_next/image' ||
  url === '/_next/static/chunks/' ||
  /\/_next\/static\/chunks\/[^/]+\.(js|css)$/.test(url)
const realLeftovers = [...new Set(leftovers)].filter((url) => !benign(url))
console.log(`\n内联脚本 ${scriptCount} 个，资源 ${assetMap.size} 项${campusOnly ? '，独立页与真实数据已打包。' : '，数字人与扣子 SDK 已内联。'}`)
console.log(`产物：${target}（${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB）`)
if (realLeftovers.length > 0) {
  console.warn(`⚠ 仍有未内联的 _next 引用 ${realLeftovers.length} 处：`)
  for (const item of realLeftovers.slice(0, 12)) console.warn(`   ${item}`)
  process.exitCode = 1
} else {
  console.log('✓ 全部资源已内联，无外链依赖')
}

fs.rmSync(tmpDir, { recursive: true, force: true })
