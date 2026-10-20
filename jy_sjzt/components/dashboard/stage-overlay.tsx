import { MousePointerClick } from 'lucide-react'
import { countByStage, SCHOOL_STAGES, type SchoolStage } from '@/lib/dashboard-data'
import type { MapStyle } from '@/lib/education-map'
import { cn } from '@/lib/utils'
import { SimMark } from './sim-mark'

type Props = {
  stageFilter: SchoolStage | null
  onStageFilterChange: (stage: SchoolStage | null) => void
  mapStyle: MapStyle
  onMapStyleChange: (style: MapStyle) => void
}

const MAP_STYLE_OPTIONS: { value: MapStyle; label: string }[] = [
  { value: 'satellite', label: '实景地形' },
  { value: 'tech', label: '科技蓝' },
]

export function StageOverlay({ stageFilter, onStageFilterChange, mapStyle, onMapStyleChange }: Props) {
  return (
    <div className="pointer-events-none relative flex min-h-0 flex-col justify-between">
      <div className="flex items-start justify-end gap-3">
        <div className="flex flex-col items-end gap-2">
          <p className="mt-1 flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs whitespace-nowrap text-muted-foreground backdrop-blur-sm">
            <MousePointerClick className="size-3.5 shrink-0 text-primary" aria-hidden />
            悬停点位查看师资 · 点击切换校级视图
          </p>
          <div
            role="radiogroup"
            aria-label="地图底图"
            className="pointer-events-auto flex rounded-md border border-border/70 bg-card/70 p-0.5 backdrop-blur-md"
          >
            {MAP_STYLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mapStyle === option.value}
                onClick={() => onMapStyleChange(option.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors',
                  mapStyle === option.value
                    ? 'bg-primary/20 text-primary shadow-[inset_0_0_0_1px] shadow-primary/50'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <StageFilter value={stageFilter} onChange={onStageFilterChange} />
        <Compass />
      </div>
    </div>
  )
}

/** 与左侧面板拉开间距（栏内贴左会被数据总览等面板的投影/装饰压住）。 */
function StageFilter({ value, onChange }: { value: SchoolStage | null; onChange: (stage: SchoolStage | null) => void }) {
  return (
    <fieldset className="pointer-events-auto ml-6 rounded-lg border border-border/70 bg-card/70 p-1.5 backdrop-blur-md">
      <legend className="sr-only">按学段筛选学校点位</legend>
      <div className="mb-1 flex items-center justify-between gap-3 px-0.5">
        <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground">
          学段筛选
          <SimMark className="size-3" />
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={cn(
            'rounded px-1.5 py-px text-[10px] font-semibold transition-colors',
            value === null ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          全部
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {SCHOOL_STAGES.map((stage) => {
          const active = value === stage.key
          return (
            <button
              key={stage.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : stage.key)}
              className={cn(
                'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-left whitespace-nowrap transition-all',
                active
                  ? 'border-current bg-white/10 text-foreground shadow-[0_0_14px_var(--stage-color)]'
                  : 'border-border/70 bg-secondary/40 text-muted-foreground hover:border-primary/50 hover:text-foreground',
              )}
              style={{ '--stage-color': stage.color, ...(active ? { borderColor: stage.color } : {}) } as React.CSSProperties}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: stage.color, boxShadow: `0 0 8px ${stage.color}` }}
              />
              <span className="text-xs font-semibold">{stage.label}</span>
              <span className="font-display ml-auto text-xs font-bold tabular-nums" style={{ color: stage.color }}>
                {countByStage(stage.key)}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function Compass() {
  return (
    <svg viewBox="0 0 80 80" className="size-[60px] text-primary" role="img" aria-label="指北针">
      <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <circle cx="40" cy="40" r="26" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="2 4" />
      <polygon points="40,14 45,40 40,36 35,40" fill="currentColor" />
      <polygon points="40,66 45,40 40,44 35,40" fill="currentColor" fillOpacity="0.3" />
      <polygon points="14,40 40,35 36,40 40,45" fill="currentColor" fillOpacity="0.3" />
      <polygon points="66,40 40,35 44,40 40,45" fill="currentColor" fillOpacity="0.3" />
      <text x="40" y="9" textAnchor="middle" fontSize="9" fontWeight="700" fill="#e3efff">N</text>
      <text x="40" y="78" textAnchor="middle" fontSize="8" fill="#86a3cf">S</text>
      <text x="5" y="43" textAnchor="middle" fontSize="8" fill="#86a3cf">W</text>
      <text x="75" y="43" textAnchor="middle" fontSize="8" fill="#86a3cf">E</text>
    </svg>
  )
}
