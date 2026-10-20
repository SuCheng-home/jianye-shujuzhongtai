#!/usr/bin/env node
/**
 * 从玄武研训原页派生建邺模板 templates/training.html。
 *
 * 只动四类内容，9 个面板、筛选、排序、滚动、联动与数字人位置一律原样保留：
 *   1) __YX_*__ 标记块内的数据（YX_DICT/YX_SRC/YX_META/YX_DATA/SEM/PREV/TERM_START/菜单）；
 *   2) 5 处品牌文案（标题、h1、机器人欢迎语、数据头注释、机器人兜底开场白）；
 *   3) 玄武扣子凭据与 session 常量（置空，不打包）；
 *   4) 4 处缺数安全补丁：教师基数兜底 5200 → null、partOf 去掉基数上限、
 *      KPI3 参与率与「未参与研训教师」在基数缺失时显示「—」而不是 0。
 * 活动名称里含 600+ 处「玄武」属真实业务数据，禁止替换。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(root, '..', '教师视导', 'yanxun.html')
const SNAPSHOT = path.join(root, 'data', 'jianye.generated.json')
const TEMPLATE = path.join(root, 'templates', 'training.html')

const SEG = ['幼教', '小学', '初中', '高中', '职教', '特教']
const SEG_CODE = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 9: 5 }

function fail(message) {
  throw new Error(message)
}

function replaceBetween(html, begin, end, body) {
  const start = html.indexOf(begin)
  const stop = html.indexOf(end)
  if (start < 0 || stop < 0 || stop < start) fail(`标记块缺失：${begin}`)
  return html.slice(0, start + begin.length) + body + html.slice(stop)
}

function replaceExact(html, from, to) {
  if (!html.includes(from)) fail(`替换锚点缺失：${from.slice(0, 60)}`)
  return html.replace(from, to)
}

function mondayOf(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day)
  return date
}

function iso(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** 开学周一 = 各活动「当周周一 − (weekid−1)×7 天」的众数；建邺源库带真实教学周，不用猜。 */
function termStartOf(activities) {
  const votes = new Map()
  for (const activity of activities) {
    if (!activity.weekid || !activity.date) continue
    const candidate = addDays(mondayOf(activity.date), -(activity.weekid - 1) * 7)
    const key = iso(candidate)
    votes.set(key, (votes.get(key) ?? 0) + 1)
  }
  let best = null
  let bestCount = 0
  for (const [key, count] of votes) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

function menuLabel(name) {
  return name.replace('学年', '学年 ')
}

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
const training = snapshot.training
const terms = training.terms

const subjects = training.dict.subjects
const subjIndex = new Map(subjects.map((name, index) => [name, index]))
const levels = training.dict.levels.map((name) => [name, name, name === '区级' ? '区级' : '市级及以上'])
const organizers = [...new Set(terms.flatMap((term) => term.activities.map((a) => a.sponsor).filter(Boolean)))]
const creIndex = new Map(organizers.map((name, index) => [name, index]))

const YX_DATA = {}
const META_TERMS = {}
const TERM_START = {}
const SEM_NAME = {}
const PREV = {}

for (const term of terms) {
  SEM_NAME[term.key] = menuLabel(term.name)
  if (term.prevKey) PREV[term.key] = term.prevKey
  META_TERMS[term.key] = {
    total: term.kpi.teacherBase,
    seg: {},
    part: term.kpi.uniqueSignedTeachers,
  }
  const start = termStartOf(term.activities)
  if (start) TERM_START[term.key] = start
  YX_DATA[term.key] = term.activities.map((activity) => {
    const ying = activity.expectedPersonTimes ?? 0
    const chu = activity.attendedPersonTimes ?? 0
    return [
      activity.date,
      activity.title,
      activity.stageCodes.map((code) => SEG_CODE[code]).filter((index) => index !== undefined),
      activity.subjects.map((name) => subjIndex.get(name)).filter((index) => index !== undefined),
      levels.findIndex((level) => level[0] === activity.levelName),
      activity.sponsor ? (creIndex.get(activity.sponsor) ?? 0) : 0,
      activity.hours ?? 0,
      ying,
      Math.max(0, ying - chu),
      chu,
    ]
  })
}

let html = fs.readFileSync(SOURCE, 'utf8')

/* 1) 数据块 */
html = replaceBetween(
  html,
  '/*__YX_DATA_BEGIN__*/',
  '/*__YX_DATA_END__*/',
  `\n/* 建邺区研训活动大屏 · 数据由 jy_sjzt/scripts/build-jianye-data.py 生成，勿手改 */\n` +
    `var YX_DICT=${JSON.stringify({ seg: SEG, subj: subjects, lv: levels, cre: organizers })};\n` +
    `var YX_SRC=${JSON.stringify(Object.fromEntries(terms.map((t) => [t.key, '建邺区教师发展管理平台'])))};\n` +
    `var YX_META={teacherTotal:null,terms:${JSON.stringify(META_TERMS)}};\n` +
    `var YX_DATA=${JSON.stringify(YX_DATA)};\n`,
)
html = replaceBetween(
  html,
  '/*__YX_TERMS_BEGIN__*/',
  '/*__YX_TERMS_END__*/',
  `\nvar SEM=${JSON.stringify(training.defaultTerm)},SEM_NAME=${JSON.stringify(SEM_NAME)};\n` +
    `var PREV=${JSON.stringify(PREV)};   /* 上学期（最早的学期没有源数据） */\n`,
)
html = replaceBetween(
  html,
  '/*__YX_TERMSTART_BEGIN__*/',
  '/*__YX_TERMSTART_END__*/',
  `\nvar TERM_START=${JSON.stringify(TERM_START)};   /* 各学期开学周的周一，由源库 weekid 反推 */\n`,
)
html = replaceBetween(
  html,
  '<!--__YX_MENU_BEGIN__-->',
  '<!--__YX_MENU_END__-->',
  `\n      ${terms.map((term) => `<li data-t="${term.key}">${SEM_NAME[term.key]}</li>`).join('\n      ')}\n      `,
)
html = replaceExact(html, `<span id="termText">${menuLabel(terms[0].name)}</span>`, `<span id="termText">${SEM_NAME[training.defaultTerm]}</span>`)

/* 2) 品牌 */
html = replaceExact(html, '<title>玄武区研训活动分析看板</title>', '<title>建邺区研训活动分析看板</title>')
html = replaceExact(html, '<h1>玄武区<em class="em">研训</em>活动分析看板</h1>', '<h1>建邺区<em class="em">研训</em>活动分析看板</h1>')
html = replaceExact(html, "welcome:'您好，我是<b>玄武教师发展 AI 助手</b>", "welcome:'您好，我是<b>建邺教师发展 AI 助手</b>")
html = replaceExact(html, "||'您好，我是<b>玄武数智督导 AI 助手</b>", "||'您好，我是<b>建邺数智督导 AI 助手</b>")

/* 3) 凭据与 session 常量：一律按模式清空，源码中不保存任何旧凭据 */
html = html.replace(/project:RC\.project\|\|\d+,/g, 'project:RC.project||0,')
html = html.replace(/defaultSession:RC\.defaultSession\|\|'[^']*',/g, "defaultSession:RC.defaultSession||'',")
html = html.replace(/lsKey:RC\.lsKey\|\|'[^']*',/g, "lsKey:RC.lsKey||'jy_yx_coze_session',")
html = html.replace(/channelToken:\s*'[^']*'/g, "channelToken: ''")
html = html.replace(/projectId:\s*'[^']*'/g, "projectId: ''")

/* 4) 缺数安全补丁 */
html = replaceExact(
  html,
  'var TEACHER_TOTAL=(window.YX_META&&YX_META.teacherTotal)||5200;   /* 兜底值 */',
  'var TEACHER_TOTAL=(window.YX_META&&YX_META.teacherTotal)||null;   /* 建邺无历史名册，不给兜底假基数 */',
)
html = replaceExact(
  html,
  'function teacherTotalOf(sem){var t=META_TERMS[sem];return (t&&t.total)||TEACHER_TOTAL}',
  'function teacherTotalOf(sem){var t=META_TERMS[sem];return (t&&t.total)||TEACHER_TOTAL}',
)
html = replaceExact(
  html,
  'return tot?Math.min(teacherTotalOf(sem),Math.round(base*f/tot)):0;',
  'return tot?Math.round(base*f/tot):0;   /* 建邺 part 为签到去重真实值，不再按基数封顶 */',
)
html = replaceExact(
  html,
  'var part=partOf(SEM,cur),total=teacherTotalOf(SEM),partRate=total?part*100/total:0;',
  'var part=partOf(SEM,cur),total=teacherTotalOf(SEM),partRate=total?part*100/total:null;',
)
html = replaceExact(
  html,
  `  document.getElementById('kD3').innerHTML=
    '<span class="ppl">参与 '+part.toLocaleString('en-US')+' / '+total.toLocaleString('en-US')+' 人</span>'
    +dHTML(pst?dDeltaPercent(partRate,ppr):null,'%');`,
  `  document.getElementById('kD3').innerHTML= total===null
    ? '<span class="ppl nn">参与 '+(part?part.toLocaleString('en-US'):'—')+' 人 · 应参训基数待补</span>'
    : '<span class="ppl">参与 '+part.toLocaleString('en-US')+' / '+total.toLocaleString('en-US')+' 人</span>'
      +dHTML(pst?dDeltaPercent(partRate,ppr):null,'%');`,
)
html = replaceExact(
  html,
  `'<span class="bg2"><i style="width:'+(x.nopart*100/max)+'%"></i></span>'+`,
  `'<span class="bg2"><i style="width:'+(x.tot?x.nopart*100/max:0)+'%"></i></span>'+`,
)
html = replaceExact(
  html,
  `'<span class="vv num">'+x.nopart.toLocaleString('en-US')+'<em> 人未参与</em></span>'+`,
  `'<span class="vv num">'+(x.tot?x.nopart.toLocaleString('en-US'):'—')+'<em>'+(x.tot?' 人未参与':'')+'</em></span>'+`,
)
html = replaceExact(
  html,
  `title="'+SEG[x.i]+' 教师 '+x.tot+' 人 · 参与约 '+x.part+' 人 · 未参与约 '+x.nopart+' 人（估算）"`,
  `title="'+(x.tot?SEG[x.i]+' 教师 '+x.tot+' 人 · 参与约 '+x.part+' 人 · 未参与约 '+x.nopart+' 人（估算）':SEG[x.i]+' 学段教师基数待补')+'">"`,
)

fs.mkdirSync(path.dirname(TEMPLATE), { recursive: true })
fs.writeFileSync(TEMPLATE, html, 'utf8')
console.log(`建邺研训模板：${TEMPLATE}（${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB）`)
console.log(`学期 ${terms.length} 个，默认 ${training.defaultTerm}；学科 ${subjects.length} 个；组织者 ${organizers.length} 人；TERM_START ${Object.keys(TERM_START).length} 个`)
