'use client'

import { createContext, useEffect, useState } from 'react'

export const ScreenFitScaleContext = createContext(1)

const BASE_WIDTH = 1320
const BASE_HEIGHT = 780

type Fit = { scale: number; width: number; height: number }

function measure(): Fit {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const scale = Math.min(vw / BASE_WIDTH, vh / BASE_HEIGHT)
  return { scale, width: vw / scale, height: vh / scale }
}

export function ScreenFit({ children }: { children: React.ReactNode }) {
  const [fit, setFit] = useState<Fit | null>(null)

  useEffect(() => {
    const update = () => setFit(measure())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <div
        className="bg-tech absolute top-0 left-0 origin-top-left"
        style={
          fit
            ? { width: fit.width, height: fit.height, transform: `scale(${fit.scale})` }
            : { width: BASE_WIDTH, height: BASE_HEIGHT, visibility: 'hidden' }
        }
      >
        <ScreenFitScaleContext.Provider value={fit?.scale ?? 1}>
          {children}
        </ScreenFitScaleContext.Provider>
      </div>
    </div>
  )
}
