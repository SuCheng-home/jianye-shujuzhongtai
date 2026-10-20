'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import { DEFAULT_SCHOOL_ID, SCHOOL_DIRECTORY, type Scope } from '@/lib/dashboard-data'
import { cn } from '@/lib/utils'
import { SimMark } from './sim-mark'

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

type HeaderProps = {
  scope: Scope
  lastSchoolId: string
  statDate: string
  onScopeChange: (scope: Scope) => void
  onStatDateChange: (date: string) => void
}

function useNow() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function useFullscreen() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function toggle() {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
  }
  return { active, toggle }
}

export function DashboardHeader({ scope, lastSchoolId, statDate, onScopeChange, onStatDateChange }: HeaderProps) {
  const now = useNow()
  const fullscreen = useFullscreen()
  const selectValue = scope.level === 'school' ? scope.schoolId : 'district'

  function handleSelect(value: string) {
    onScopeChange(value === 'district' ? { level: 'district' } : { level: 'school', schoolId: value })
  }

  return (
    <header className="relative border-b border-primary/30 bg-linear-to-b from-[#0a2a66]/90 to-[#04112d]/80">
      <div className="flex items-center gap-4 px-4 py-2">
        <div className="command-brand relative shrink-0 py-2.5 pr-6 pl-4 whitespace-nowrap">
          <span className="command-brand-frame" aria-hidden />
          <h1 aria-label="建邺区教育数智中枢" className="command-title font-title relative flex items-baseline gap-1 text-[1.9rem] leading-none text-foreground">
            <span className="command-title-base">建邺区教育</span>
            <span className="header-hub text-[2.25rem]">数智中枢</span>
          </h1>
          <span className="command-brand-rail" aria-hidden />
        </div>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-3">
          <div role="group" aria-label="数据视角切换" className="flex rounded-md border border-border bg-secondary/70 p-0.5">
            {(
              [
                { level: 'district', label: '全区' },
                { level: 'school', label: '单校' },
              ] as const
            ).map((option) => {
              const active = scope.level === option.level
              return (
                <button
                  key={option.level}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    option.level === 'district'
                      ? onScopeChange({ level: 'district' })
                      : onScopeChange({ level: 'school', schoolId: lastSchoolId || DEFAULT_SCHOOL_ID })
                  }
                  className={cn(
                    'rounded px-3 py-1 text-sm font-bold whitespace-nowrap transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground shadow-[0_0_12px_rgb(34_211_238/0.5)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="relative">
            <label htmlFor="scope-select" className="sr-only">
              选择全区或学校
            </label>
            <select
              id="scope-select"
              value={selectValue}
              onChange={(e) => handleSelect(e.target.value)}
              className="h-8 w-44 appearance-none truncate rounded-md border border-border bg-secondary/70 pr-8 pl-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="district">建邺区（全区）</option>
              <optgroup label="辖区学校">
                {SCHOOL_DIRECTORY.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>

          <div className="relative">
            <label htmlFor="stat-date" className="sr-only">
              统计日期
            </label>
            <input
              id="stat-date"
              type="date"
              value={statDate}
              max={todayIso()}
              onChange={(e) => e.target.value && onStatDateChange(e.target.value)}
              className="h-8 rounded-md border border-border bg-secondary/70 px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [color-scheme:dark]"
            />
          </div>

          <button
            type="button"
            onClick={fullscreen.toggle}
            aria-pressed={fullscreen.active}
            title={fullscreen.active ? '退出全屏（Esc）' : '全屏'}
            className="flex size-8 items-center justify-center rounded-md border border-border bg-secondary/70 text-muted-foreground transition-colors hover:text-foreground"
          >
            {fullscreen.active ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
            <span className="sr-only">{fullscreen.active ? '退出全屏' : '全屏'}</span>
          </button>

          <div className="text-right leading-tight whitespace-nowrap">
            <p className="font-display text-xl font-bold tabular-nums text-foreground">
              {now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : '--:--:--'}
            </p>
            <p className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              {now ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${WEEKDAYS[now.getDay()]}` : ''}
              <SimMark className="size-3" tip="统计日期可切换；应用日使用人数与关注数据待接入" />
            </p>
          </div>
        </div>
      </div>
      <span aria-hidden className="absolute -bottom-px left-1/2 h-0.5 w-1/2 -translate-x-1/2 bg-linear-to-r from-transparent via-primary to-transparent" />
    </header>
  )
}
