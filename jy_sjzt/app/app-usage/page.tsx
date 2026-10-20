import type { Metadata } from 'next'
import { AppUsage } from '@/components/dashboard/app-usage'

export const metadata: Metadata = {
  title: '建邺区应用使用情况',
  description: '建邺区智慧校园 14 个应用的使用情况：当日使用人数、近 30 日趋势、学校使用排行与模块功能。',
}

export default function AppUsagePage() {
  return <AppUsage />
}
