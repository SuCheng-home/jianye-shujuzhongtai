'use client'

import { useEffect } from 'react'

/**
 * 数字人：外观与动作复用 libpag 真实动画（public/jianye-robot.js，由玄武 robot.js 派生、
 * 已把玄武会话 lsKey/defaultSession 置空），问答连接与形象展示彻底拆开。
 *
 * 玄武旧智能体的 projectId / channelToken 不进入建邺代码与产物。建邺问答接通前，
 * 页面只保留形象与本地展示行为：不伪造回答，也不把本地数据发给任何第三方。
 * 接通方式：部署页在 window.__JIANYE_ASSISTANT__ 上提供 { projectId, channelToken }，
 * 本组件检测到才加载扣子 SDK；离线打开时该对象不存在，形象照常。
 */
const ROBOT_TAG = '数智中枢助手'
const ROBOT_TITLE = '建邺教师数据智能体 · AI 问答'

type JianyeAssistantConfig = { projectId: string; channelToken: string }

type CozeSdk = {
  init: (options: Record<string, unknown>) => void
  destroy?: () => void
  updateToken?: (token: string) => void
}

declare global {
  interface Window {
    AI_ROBOT_CFG?: Record<string, unknown>
    cozeWebSDK?: CozeSdk
    __JIANYE_ASSISTANT__?: JianyeAssistantConfig
  }
}

let robotLoad: Promise<void> | null = null

/**
 * 数字人脚本全局只执行一次：主屏数字人与智慧校园提醒面板共用同一个 #robot 节点，
 * 两处同时挂载也不会把脚本跑两遍。
 */
export function loadRobot() {
  robotLoad ??= (async () => {
    if (document.getElementById('robot')) return
    const response = await fetch('/jianye-robot.js')
    if (!response.ok) throw new Error(`加载失败：/jianye-robot.js`)
    // eslint-disable-next-line no-new-func
    new Function(await response.text())()
  })().catch((error: unknown) => {
    robotLoad = null
    throw error
  })
  return robotLoad
}

/**
 * 让外链脚本以数据 URI 形式内联时也能加载：统一取源码后在全局作用域执行。
 * 单文件版会把脚本 URL 替换成 data:text/javascript 地址，直接同步执行会触发水合不匹配，因此这里在水合完成后执行。
 */
async function runScript(url: string, ready: () => boolean) {
  if (ready()) return
  const response = await fetch(url)
  if (!response.ok) throw new Error(`加载失败：${url}`)
  const code = await response.text()
  // eslint-disable-next-line no-new-func
  new Function(code)()
}

/**
 * 数字人放进给定容器（总览右栏下方）：脚本默认把 #robot 固定到屏幕右下角，
 * 这里搬进容器并改成容器内绝对定位。canvas 要跟着外框一起改：libpag 初始化时
 * 把行内尺寸钉成 216px，只改外框会让画面偏右、标签对不上机器人中线。
 */
function placeRobot(host: HTMLElement | null, size: number) {
  const robot = document.getElementById('robot')
  if (!robot) return
  robot.classList.remove('hide')
  if (host) {
    host.appendChild(robot)
    robot.style.position = 'absolute'
    robot.style.right = '6px'
    robot.style.bottom = '6px'
  } else {
    robot.style.position = 'fixed'
    robot.style.right = '22px'
    robot.style.bottom = '40px'
  }
  robot.style.width = `${size}px`
  robot.style.height = `${size}px`
  const canvas = robot.querySelector('canvas')
  if (canvas) {
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
  }
  document.getElementById('robotGhost')?.classList.remove('on')
}

/** 仅在部署页提供建邺智能体配置时挂载问答区；否则只保留形象。 */
function mountAssistantHost() {
  const pop = document.getElementById('chatPop')
  if (!pop || pop.querySelector('#cozeAssistantHost')) return null

  for (const selector of ['.ch-msgs', '.ch-pre', '.ch-in']) {
    const node = pop.querySelector<HTMLElement>(selector)
    if (node) node.style.display = 'none'
  }

  const host = document.createElement('div')
  host.id = 'cozeAssistantHost'
  host.style.cssText = 'flex:1 1 auto;min-height:0;position:relative;display:flex;flex-direction:column;'
  host.innerHTML =
    '<div id="cozeAssistantStatus" role="status" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#bfe8ff;font-size:13.5px;letter-spacing:1px;text-align:center;padding:0 32px">' +
    '<span id="cozeAssistantStatusText">正在连接建邺教师数据智能体…</span>' +
    '<button id="cozeAssistantRetry" type="button" style="display:none;height:32px;padding:0 20px;font-size:13px;letter-spacing:2px;cursor:pointer;color:#04263c;background:linear-gradient(180deg,#5fe6ff,#18a6e0);border:0;border-radius:4px;font-weight:700">重新连接</button>' +
    '</div>'
  const header = pop.querySelector('.ch-h')
  if (header?.nextSibling) pop.insertBefore(host, header.nextSibling)
  else pop.appendChild(host)
  return host
}

type DigitalHumanProps = {
  /** 传入容器 id 时数字人放进该容器（总览右栏）；不传则固定屏幕右下角。 */
  hostId?: string
  size?: number
}

export function DigitalHuman({ hostId, size = 190 }: DigitalHumanProps) {
  useEffect(() => {
    let cancelled = false

    window.AI_ROBOT_CFG = {
      tag: ROBOT_TAG,
      title: ROBOT_TITLE,
    }

    async function setup() {
      await loadRobot()
      if (cancelled) return
      placeRobot(hostId ? document.getElementById(hostId) : null, size)

      const config = window.__JIANYE_ASSISTANT__
      if (!config) return
      /* connect 是函数声明会被提升，收窄不进入闭包，这里另取一个已收窄的常量 */
      const cfg: JianyeAssistantConfig = config

      const assistantHost = mountAssistantHost()
      if (!assistantHost) return
      const host = assistantHost

      await runScript('/coze-web-sdk.js', () => Boolean(window.cozeWebSDK))
      if (cancelled) return

      const status = host.querySelector<HTMLElement>('#cozeAssistantStatus')
      const statusText = host.querySelector<HTMLElement>('#cozeAssistantStatusText')
      const retry = host.querySelector<HTMLButtonElement>('#cozeAssistantRetry')
      const iframeHost = document.createElement('div')
      iframeHost.style.cssText = 'flex:1 1 auto;min-height:0;'
      let started = false
      let timer = 0

      /* 用 style.display 控制显隐：状态层的内联 display:flex 会压过 [hidden] */
      function showError(message: string) {
        window.clearTimeout(timer)
        if (statusText) statusText.textContent = message
        if (status) status.style.display = 'flex'
        if (retry) retry.style.display = ''
      }

      function connect() {
        window.clearTimeout(timer)
        if (status) status.style.display = 'flex'
        if (retry) retry.style.display = 'none'
        if (statusText) statusText.textContent = '正在连接建邺教师数据智能体…'
        timer = window.setTimeout(() => showError('连接超时，请检查网络后点击重新连接。'), 30000)

        const sdk = window.cozeWebSDK
        if (!sdk) {
          showError('智能体加载失败，请点击重新连接。')
          return
        }
        if (started) {
          const frame = iframeHost.querySelector('iframe')
          if (frame) frame.src = frame.src
          return
        }
        try {
          host.appendChild(iframeHost)
          sdk.init({
            projectId: cfg.projectId,
            container: iframeHost,
            theme: 'dark',
            refreshToken: () => Promise.resolve(cfg.channelToken),
            onProjectInfoLoaded: () => {
              window.clearTimeout(timer)
              if (status) status.style.display = 'none'
            },
            onTokenInvalid: () => showError('智能体访问授权已失效，请更新建邺智能体渠道 Token。'),
            onNetworkError: () => showError('暂时无法连接智能体，请检查网络后重试。'),
            onNotify: (note: { level?: string; message?: string; error?: string } | undefined) => {
              const detail = `${note?.message ?? ''} ${note?.error ?? ''}`
              if (detail.includes('authentication is invalid') || detail.includes('"status":401')) {
                showError('智能体访问授权已失效，请更新建邺智能体渠道 Token 后重新连接。')
              } else if (note?.level === 'error') {
                showError(`智能体暂时不可用${note.message ? `：${note.message}` : ''}，请稍后重新连接。`)
              }
            },
          })
          started = true
        } catch {
          showError('智能体加载失败，请点击重新连接。')
        }
      }

      retry?.addEventListener('click', connect)
      connect()
    }

    setup().catch(() => {
      // robot.js 加载失败时保持页面其余功能可用，不打断主界面
    })

    return () => {
      cancelled = true
    }
  }, [hostId, size])

  return null
}
