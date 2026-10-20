import type { Metadata, Viewport } from 'next'
import { Noto_Sans_SC, Rajdhani } from 'next/font/google'
import './globals.css'

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-rajdhani',
})

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-noto-sc',
  preload: false,
})

export const metadata: Metadata = {
  title: '建邺区教育数智中枢',
  description: '建邺区教育数智中枢：汇聚辖区学校教育数据，展示学校分布与教育概况，支持区级与校级数据视角切换。',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#030b1f',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className={`${rajdhani.variable} ${notoSansSC.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
