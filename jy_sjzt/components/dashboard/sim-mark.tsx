'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export const SIM_DATA_TITLE = '非正式数据，仅供参考！'

const TOOLTIP_FONT = 15

/** 界面整体按屏幕缩放（ScreenFit），提示框挂在 body 下，这里按同一比例缩放，字号才不会和界面脱节。 */
function uiScale() {
  const stage = document.querySelector<HTMLElement>('.bg-tech.absolute')
  if (!stage) return 1
  const base = Number.parseFloat(stage.style.width || '')
  return base > 0 ? stage.getBoundingClientRect().width / base : 1
}

/**
 * 非正式数据标记：小圆圈问号 + 悬停即时提示。
 * 提示框用 portal 挂到 body：面板有 clip-path / overflow-hidden 时也不会被裁掉。
 * 传 tip 时（如数据来源说明）先显示该行，再跟一行通用声明。
 */
export function SimMark({ className, tip }: { className?: string; tip?: string }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; scale: number; below: boolean } | null>(null)
  const lines = tip ? [tip, SIM_DATA_TITLE] : [SIM_DATA_TITLE]
  const boxWidth = Math.max(...lines.map((line) => line.length * TOOLTIP_FONT + 18))

  return (
    <>
      <span
        role="img"
        aria-label={tip ?? SIM_DATA_TITLE}
        onMouseEnter={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const scale = uiScale()
          // 靠近屏幕左右边缘时把提示框往回收，避免被裁掉
          const half = (boxWidth / 2) * scale
          const x = Math.min(Math.max(rect.left + rect.width / 2, half + 4), window.innerWidth - half - 4)
          setAnchor({
            x,
            // 顶部（如页头温度）上方放不下时改到下方显示
            y: rect.top < 44 * scale ? rect.bottom + 8 : rect.top - 8,
            scale,
            below: rect.top < 44 * scale,
          })
        }}
        onMouseLeave={() => setAnchor(null)}
        className={cn(
          'inline-flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-amber-300/70 text-[10px] leading-none font-bold text-amber-300/85 opacity-75 transition-opacity hover:opacity-100',
          className,
        )}
      >
        ?
      </span>
      {anchor &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[200] rounded border border-amber-300/70 bg-[#161204]/95 px-2 py-1 text-sm whitespace-nowrap text-amber-200 shadow-[0_6px_20px_rgba(0,0,0,0.55)]"
            style={{
              left: anchor.x,
              top: anchor.y,
              transform: `translate(-50%, ${anchor.below ? '0' : '-100%'}) scale(${anchor.scale})`,
              transformOrigin: anchor.below ? 'top center' : 'bottom center',
            }}
          >
            {tip && <span className="block font-bold">{tip}</span>}
            <span className={cn('block font-bold', tip && 'mt-0.5 text-xs font-semibold text-amber-200/75')}>{SIM_DATA_TITLE}</span>
          </span>,
          document.body,
        )}
    </>
  )
}
