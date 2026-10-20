'use client'

import { useCallback, useState } from 'react'

import { AppCenter } from '@/components/dashboard/app-center'
import { DashboardHeader } from '@/components/dashboard/header'
import { DigitalHuman } from '@/components/dashboard/digital-human'
import { HubScene } from '@/components/dashboard/hub-scene'
import { ScreenFit } from '@/components/dashboard/screen-fit'
import { StageOverlay } from '@/components/dashboard/stage-overlay'
import { AttentionCards, DistrictBasePanel, UsageRankingPanel, UsageTrendPanel } from '@/components/dashboard/ops-panels'
import { DEFAULT_SCHOOL_ID, type SchoolStage, type Scope } from '@/lib/dashboard-data'
import type { MapStyle } from '@/lib/education-map'

/** 总览三栏：左 22% / 中 55% / 右 23%。三维画布只占中栏上半，数字人进右栏下半。 */
const COLUMNS = '22fr minmax(0,55fr) 23fr'
const MAP_ROW = 'minmax(0,1fr)'
const APP_ROW = '212px'
const ROBOT_ROW = '236px'

export function Dashboard() {
  const [scope, setScope] = useState<Scope>({ level: 'district' })
  const [lastSchoolId, setLastSchoolId] = useState<string | null>(null)
  const [statDate, setStatDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stageFilter, setStageFilter] = useState<SchoolStage | null>(null)
  const [mapStyle, setMapStyle] = useState<MapStyle>('tech')

  const onScopeChange = useCallback((next: Scope) => {
    setScope(next)
    if (next.level === 'school') setLastSchoolId(next.schoolId)
  }, [])
  const onStatDateChange = useCallback((next: string) => setStatDate(next), [])

  const activeSchoolId = scope.level === 'school' ? scope.schoolId : null

  return (
    <ScreenFit>
      <div className="flex h-full min-h-0 flex-col">
        <DashboardHeader
          scope={scope}
          lastSchoolId={lastSchoolId ?? DEFAULT_SCHOOL_ID}
          statDate={statDate}
          onScopeChange={onScopeChange}
          onStatDateChange={onStatDateChange}
        />
        <main className="grid min-h-0 flex-1 gap-3 p-3" style={{ gridTemplateColumns: COLUMNS }}>
          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: `auto ${MAP_ROW} ${MAP_ROW}` }}>
            <DistrictBasePanel scope={scope} />
            <UsageTrendPanel scope={scope} />
            <UsageRankingPanel scope={scope} />
          </section>

          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: `${MAP_ROW} ${APP_ROW}` }}>
            <div className="relative min-h-0 overflow-hidden rounded-md">
              <HubScene
                activeSchoolId={activeSchoolId}
                stageFilter={stageFilter}
                mapStyle={mapStyle}
                horizontalInset={0}
                onSchoolSelect={(id) => onScopeChange({ level: 'school', schoolId: id })}
              />
              <StageOverlay
                stageFilter={stageFilter}
                onStageFilterChange={setStageFilter}
                mapStyle={mapStyle}
                onMapStyleChange={setMapStyle}
              />
            </div>
            <AppCenter />
          </section>

          <section className="grid min-h-0 gap-3" style={{ gridTemplateRows: `${MAP_ROW} ${ROBOT_ROW}` }}>
            <AttentionCards scope={scope} />
            <div id="robot-host" className="relative min-h-0 overflow-hidden rounded-md border border-dashed border-white/15">
              <DigitalHuman hostId="robot-host" size={210} />
            </div>
          </section>
        </main>
      </div>
    </ScreenFit>
  )
}
