'use client'

import { Boxes } from 'lucide-react'
import { CAMPUS_BLOCKS, CAMPUS_MODULES, campusBlock } from '@/lib/smart-campus-modules'
import { Panel } from './panel'

/** 中下：应用中心。智慧校园 14 个应用模块卡片，按业务板块配色；悬浮查看主要功能。 */
export function AppCenter() {
  return (
    <Panel
      title="应用中心"
      icon={Boxes}
      className="h-full min-h-0"
      action={<div className="flex items-center gap-3">
        {CAMPUS_BLOCKS.map((block) => (
          <span key={block.key} className="flex items-center gap-1 text-[10px] whitespace-nowrap text-muted-foreground">
            <i className="size-1.5 rounded-full" style={{ background: block.color }} aria-hidden />
            {block.name}
          </span>
        ))}
      </div>}
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_168px] gap-3">
        <ul className="grid auto-rows-fr grid-cols-4 gap-1.5">
          {CAMPUS_MODULES.map((item) => {
            const block = campusBlock(item.block)
            return (
              <li
                key={item.key}
                title={`${item.name}：${item.functions}`}
                className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded border border-white/10 bg-secondary/20 px-2 py-1"
                style={{ borderLeft: `2px solid ${block.color}` }}
              >
                <item.icon className="size-3.5 shrink-0" style={{ color: block.color }} aria-hidden />
                <span className="truncate text-xs text-foreground/90">{item.shortName ?? item.name}</span>
              </li>
            )
          })}
        </ul>
        <TopicNav />
      </div>
    </Panel>
  )
}

/** 四个独立业务专题入口。专题页面访问数不冒充业务应用使用人数。 */
const TOPICS: { key: string; label: string; href: string | null }[] = [
  { key: 'training', label: '研训活动', href: null },
  { key: 'supervision', label: '教学视导', href: null },
  { key: 'collaboration', label: '教育协同', href: null },
  { key: 'sports', label: '体育与成长', href: null },
]

function TopicNav() {
  return (
    <nav aria-label="业务专题" className="flex min-h-0 flex-col gap-2">
      <p className="shrink-0 text-xs font-bold tracking-wider text-muted-foreground">业务专题</p>
      {TOPICS.map((topic) =>
        topic.href ? (
          <a
            key={topic.key}
            href={topic.href}
            className="flex flex-1 items-center justify-center rounded-md border border-primary/40 bg-[#030d27] text-sm font-bold text-cyan-100 transition-colors hover:border-cyan-300"
          >
            {topic.label}
          </a>
        ) : (
          <span
            key={topic.key}
            title="专题大屏迁移中，完成后此处直接跳转独立页面"
            className="flex flex-1 cursor-not-allowed items-center justify-center rounded-md border border-dashed border-primary/25 bg-secondary/10 text-sm font-bold text-muted-foreground/70"
          >
            {topic.label}
          </span>
        ),
      )}
    </nav>
  )
}
