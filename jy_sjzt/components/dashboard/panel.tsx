import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type PanelProps = {
  title: string
  icon: LucideIcon
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function Panel({ title, icon: Icon, action, className, children }: PanelProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col rounded-md border border-border/80 bg-card/55 shadow-[inset_0_0_40px_rgb(34_211_238/0.05)] backdrop-blur-sm',
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -top-px -left-px size-3 border-t-2 border-l-2 border-primary" />
      <span aria-hidden className="pointer-events-none absolute -top-px -right-px size-3 border-t-2 border-r-2 border-primary" />
      <span aria-hidden className="pointer-events-none absolute -bottom-px -left-px size-3 border-b-2 border-l-2 border-primary/60" />
      <span aria-hidden className="pointer-events-none absolute -right-px -bottom-px size-3 border-r-2 border-b-2 border-primary/60" />
      <header className="relative flex items-center justify-between gap-2 border-b border-border/70 bg-linear-to-r from-primary/20 via-primary/5 to-transparent px-3 py-2">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-wider text-foreground">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary ring-1 ring-primary/40">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="truncate">{title}</span>
        </h2>
        {action && <div className="flex shrink-0 items-center">{action}</div>}
        <span aria-hidden className="absolute bottom-0 left-4 h-px w-28 bg-linear-to-r from-primary to-transparent" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
    </section>
  )
}
