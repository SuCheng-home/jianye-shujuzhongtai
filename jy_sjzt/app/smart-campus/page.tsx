import type { Metadata } from 'next'
import { SmartCampus } from '@/components/dashboard/smart-campus'

export const metadata: Metadata = {
  title: '建邺区应用运营',
  description: '建邺区智慧校园应用运营：全区/单校应用使用分析、逐日访问趋势、应用清单与三角色关注。',
}

export default function SmartCampusPage() {
  return <SmartCampus />
}
