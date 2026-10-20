#!/usr/bin/env node
/** 导出现有研训看板并内联标题背景，不注入跨页手势或模拟业务数据。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 研训原页曾放在 ../教师发展大屏/，该目录已不存在；现与视导原页同在 ../教师视导/。
const CANDIDATE_SOURCES = [
  path.join(root, 'templates', 'training.html'),
  path.join(root, '..', '教师视导', 'yanxun.html'),
  path.join(root, '..', '教师发展大屏', 'yanxun.html'),
]
const source = CANDIDATE_SOURCES.find((candidate) => fs.existsSync(candidate))
if (!source) {
  throw new Error(`未找到研训源文件，已尝试：\n  ${CANDIDATE_SOURCES.join('\n  ')}`)
}
const outputName = source.endsWith('training.html') ? '建邺区研训活动.html' : '玄武区研训活动.html'
let html = fs.readFileSync(source, 'utf8')
const expectedTitle = source.endsWith('training.html')
  ? '<title>建邺区研训活动分析看板</title>'
  : '<title>玄武区研训活动分析看板</title>'
if (!html.includes(expectedTitle)) {
  throw new Error(`研训源文件标题不符（期望 ${expectedTitle}），停止导出`)
}
if (/data-xw-swipe|__XW_SWITCH_SCREEN__|__XW_SCREENS__|xw-screen/.test(html)) {
  throw new Error('研训源文件仍包含跨页切换代码，停止导出')
}
const titleBackgroundPath = [
  path.join(path.dirname(source), 'title-bg.svg'),
  path.join(root, '..', '教师视导', 'title-bg.svg'),
].find((candidate) => fs.existsSync(candidate))
if (!titleBackgroundPath) throw new Error('未找到 title-bg.svg，无法内联顶栏背景')
const titleBackground = fs.readFileSync(titleBackgroundPath).toString('base64')
html = html.replaceAll("url('title-bg.svg')", `url('data:image/svg+xml;base64,${titleBackground}')`)
const directories = ['public', 'dist']
if (fs.existsSync(path.join(root, 'out'))) directories.push('out')
for (const directory of directories) {
  const target = path.join(root, directory, outputName)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, html, 'utf8')
  console.log(`研训独立 HTML：${target}（${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB）`)
}
