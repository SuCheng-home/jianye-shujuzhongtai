# 总览与应用运营：改造前基线（玄武现版）

冻结时间：2026-10-15。本文件记录 `jy_sjzt` 改造前的实际结构，作为「总览重做」和「应用运营升级」的对照基线与验收依据。
行号以冻结时的文件为准，改动后会漂移，核对时以内容为准。

配套基线：`baseline-yanxun.md`（研训原版）、`baseline-dudao.md`（视导原版及下钻）。

---

## 一、页面与路由现状

| 路由 | 入口文件 | 组件 | 说明 |
|---|---|---|---|
| `/` | [app/page.tsx](../../app/page.tsx) | `Dashboard` | 总览（数智中枢） |
| `/smart-campus` | [app/smart-campus/page.tsx](../../app/smart-campus/page.tsx) | `SmartCampusStandalone` → `SmartCampus` | 智慧校园看板，即待升级为「应用运营」的页面 |

- [ ] 建邺版必须仍是这两个独立页面 + 研训/视导/协同/体育四个独立专题，不得改成主屏弹层或同页切换。
- [ ] `SmartCampusStandalone` 目前只是 `SmartCampus` 的空壳包装（8 行），注释说明「本页不开放问答」；升级时确认这层包装是留是删。

## 二、缩放与全屏现状

[components/dashboard/screen-fit.tsx](../../components/dashboard/screen-fit.tsx)

- 设计基准 **1320 × 780**，`scale = min(vw/1320, vh/780)`，`fixed inset-0` + `origin-top-left` 变换，通过 `ScreenFitScaleContext` 向外暴露比例。
- `SimMark` 的 tooltip 用 portal 挂到 body，并按 `uiScale()`（读 `.bg-tech.absolute` 的实际宽度 ÷ style.width）同步缩放。
- **当前没有任何全屏开关**，也没有 Esc 处理。

- [ ] 建邺版新增「⛶ 全屏」按钮 + Esc 退出，做成显式开关（用户既有偏好：不默认隐藏任何东西）。
- [ ] 新增统计日期控件后必须复测 `ScreenFit` 在 1920×1080 / 1440×900 / ~1700×772 / 窄窗口下不溢出。
- [ ] `SimMark` 的 portal 缩放逻辑要在新布局下仍然对得上（它依赖 `.bg-tech.absolute` 这个选择器）。

## 三、总览现版布局（必须改掉的部分）

[components/dashboard/dashboard.tsx](../../components/dashboard/dashboard.tsx)

```
常量：SIDEBAR_WIDTH=292  MAIN_GUTTER=12  CANVAS_HORIZONTAL_INSET=292*2+12*4=632  ROBOT_CLEARANCE=196
grid-template-columns: 292px minmax(0,1fr) 292px
```

| 位置 | 现内容 | 建邺版目标 |
|---|---|---|
| 顶栏 | `DashboardHeader` | 加统计日期、全屏；保留区级/校级 + 学校下拉 |
| 左栏上 | `OverviewStats`「数据总览」4 卡 | 改为「教育与接入概况」：学校、师生、应用 |
| 左栏下（区级） | 两个 `StageDistribution`：教师学段分布、学生学段分布 | 改为「每日使用人数趋势」+「当日应用使用排行」 |
| 左栏下（校级） | `TodayActivity`「骨干与职称结构」6 项 | 同上，按学校联动 |
| 中栏 | `HubScene` 3D 地图（`absolute inset-0 z-0`）+ `StageOverlay` | 上部地图、下部应用中心 |
| 右栏 | `SceneApps`「场景应用」10 张图片磁贴，行高 `minmax(0,1fr) 196px` | 上：学生/教师/家长三行关注卡；下：数字人 |
| 屏级 | `DigitalHuman` 固定右下角 | 移入右栏下方，保留真实 PAG |

- [ ] 左22% / 中55% / 右23% 的新比例落地，不再用固定 292px 双栏。
- [ ] `CANVAS_HORIZONTAL_INSET` 与 `ROBOT_CLEARANCE` 是喂给 3D 相机取景的，改栏宽后必须同步重算，否则地图会偏或被面板压住（`CameraRig`/`fitSamples` 依赖它）。
- [ ] 应用磁贴移到地图下方后，中栏 `absolute inset-0` 的 3D 画布不能再覆盖整个中栏，需要给下部应用中心留出真实高度。
- [ ] 左右栏都带 `key={scope}-${scopeKey}` 触发 `animate-in fade-in`，切换学校时的淡入动画要保留。

### 3.1 场景磁贴现状

[components/dashboard/scene-apps.tsx](../../components/dashboard/scene-apps.tsx) + [lib/dashboard-data.ts:363](../../lib/dashboard-data.ts#L363)

- 10 个磁贴：智慧校园、15分钟教育圈、数智督导、研训活动、教师发展、数智作业、智慧体育、数智课堂诊断、数智报告、AI平台。
- 每个只有 `{ key, name, image }`，图片在 `public/images/scenes/*.png`。
- **磁贴是纯展示，不跳转**（`div` 而非 `a`/`button`，源码注释明写「场景磁贴只做展示，不跳转」）。

- [ ] 建邺版应用中心必须是真实业务应用：按 `appCode` 显示名称、当日使用人数、近7日趋势；有真实启动地址才给链接，地址未提供不猜。
- [ ] 四个专题导航要与业务应用卡在视觉上分开标识，且**不得把「专题页面访问数」冒充业务应用使用人数**。
- [ ] 现有 10 张 `scenes/*.png` 是宣传图，不是应用图标；沿用前需确认是否与建邺应用清单对得上，对不上就换成图标 + 名称，不放装饰大图。

### 3.2 顶栏现状

[components/dashboard/header.tsx](../../components/dashboard/header.tsx)

- 品牌：`command-brand` 框 + `command-title`，文字拆两段「玄武区教育」/「数智中枢」，`aria-label="玄武区教育数智中枢"`。
- 控件：区级/校级 `role="group"` 切换（校级回落到 `lastSchoolId`）、`#scope-select` 学校下拉（`玄武区（全区）` + `optgroup 辖区学校`）、时钟（每秒刷新）+ 日期星期 + `CloudSun 22°C` + `SimMark`。
- **无统计日期选择器，无全屏按钮。**

- [ ] 标题与 aria-label、下拉首项全部换建邺。
- [ ] 新增统计日期控件，与总览应用统计联动；研训/视导内部继续用各自原学期选择，**不把日运营与学期统计混成一个筛选**。
- [ ] 新增全屏按钮 + Esc。
- [ ] `22°C` 天气是写死的假值且带 `SimMark`；建邺版要么接真实天气要么删掉，不能继续写死。
- [ ] 地图点校 / 学校下拉 / 区级校级切换三者联动已存在于 `handleScopeChange`，新增的日期与应用统计要挂进同一条联动链。

## 四、数字人现状（保留形象，拆开问答）

[components/dashboard/digital-human.tsx](../../components/dashboard/digital-human.tsx)

加载链路：
1. `loadRobot()` —— 模块级 `robotLoad` 单例，`fetch('/xuanwu-robot.js')` 后 `new Function(code)()`；先判断 `document.getElementById('robot')` 是否已存在，主屏与智慧校园提醒面板共用同一个 `#robot` 节点。
2. `setupRobot()` —— 把 `#robot` 钉成 190×190、`bottom:40px`，`classList.remove('hide')` 直接展开（脚本默认态是收起小圆钮），同时把内部 `<canvas>` 也改成 190×190（libpag 初始化会把行内尺寸钉成 216px，只改外框会画面偏右、下方「AI 数据助手」标签对不上中线）；并 `#robotGhost` 移除 `on`。
3. `mountAssistantHost()` —— 隐藏 `#chatPop` 内的 `.ch-msgs/.ch-pre/.ch-in`，插入 `#cozeAssistantHost` 与状态层（状态文字 + 重新连接按钮）。
4. `runScript('/coze-web-sdk.js')` 后 `cozeWebSDK.init({ projectId, container, theme:'dark', refreshToken, onProjectInfoLoaded, onTokenInvalid, onNetworkError, onNotify })`，30 秒超时。

资源：
- `public/xuanwu-robot.js`（3.47MB，libpag 机器人动画，PAG 素材已内联其中；源码内出现 `1_bmp.pag`、`this.pag` 等字样）。
- `public/coze-web-sdk.js`（3.2KB）。
- `jy_sjzt/合成 1_bmp.pag` 是仓库根的独立 PAG 素材文件。
- **`public/` 下没有单独的 `.pag` 文件**，动画不依赖外部 pag 请求。

**凭据风险：** [digital-human.tsx:13-16](../../components/dashboard/digital-human.tsx#L13) 的 `COZE_ASSISTANT` 把扣子 `projectId` 与 `channelToken` 明文写死在源码里，`ROBOT_TITLE`/状态文字也写死「玄武教师数据智能体」。

- [ ] 建邺成品**不打包**这组扣子 projectId / channelToken；改造时把配置抽到建邺侧的独立入口，源码与产物里都不得残留玄武令牌（本文件按约定不记录令牌值）。
- [ ] 外观/动作与问答连接必须拆开：接口未接通时保留 PAG 形象与本地展示行为，不伪造回答、不把本地数据发给玄武或任何第三方。
- [ ] 保留 `loadRobot()` 的全局单例语义，避免总览与应用运营页两处挂载把脚本跑两遍。
- [ ] 190×190 / `bottom:40px` / canvas 同步尺寸这三个魔法值是为玄武右栏 196px 让位算出来的；建邺右栏高度变了要重新对位，且必须同时改外框和 canvas。
- [ ] 研训/视导原页里已有的数字人位置尽量保留，只换地区品牌与连接。
- [ ] 离线验收：断网打开产物，PAG 动画仍要能动；「离线形象展示」不得说成「已完成 AI 接入」，在线问答单独验收。

## 五、智慧校园页现状（应用运营的复用基础）

[components/dashboard/smart-campus.tsx](../../components/dashboard/smart-campus.tsx)

```
header 62px：campus-brand（School 徽标 + 「玄武区智慧校园数据看板」）+ 空占位 + CampusClock（学期标签「2026学年秋季学期」/时间/日期 · 玄武区）
main grid-cols-[326px_minmax(0,1fr)_326px]
  左 aside  grid-rows-[0.9fr_1fr_1.34fr]：UserOverview / AttentionPanel / VisitTrendPanel
  中        grid-rows-[84px_minmax(0,1fr)_168px]：campus-kpi-row(4 卡) / CampusFusion / CampusReminder
  右 aside  grid-rows-[1fr_1.12fr_1.02fr]：应用情况(CategoryDonut) / 应用使用情况(Ranking) / ActivityPanel
```

中栏 4 张 KPI：学校总数、日均访问次数（近7日）、日均访问人次（近7日）、应用使用记录（万条）。

**没有任何筛选控件**：无全区/单校切换、无学校下拉、无日期、无应用选择。终端筛选只在 `VisitTrendPanel` 内部有一个（全部/移动/电脑端）。

- [ ] 建邺应用运营页必须补：全区/单校、学校、具体日期、近7日/30日、应用；终端筛选仅在源数据支持时提供。
- [ ] `SEMESTER_LABEL`、页面标题、`CampusClock` 里的「· 玄武区」全部换建邺。
- [ ] 主屏（总览）展示核心摘要，本页提供完整清单与趋势；两处不得重复造组件。

### 5.1 可直接复用的组件

[components/dashboard/smart-campus-charts.tsx](../../components/dashboard/smart-campus-charts.tsx)

| 组件 | 现状 | 复用要求 |
|---|---|---|
| `CampusPanel` | 标题 + 图标 + `sources` 解析失败态 + `note` + `action` | 原样搬，只换传入数据 |
| `MissingData` | 虚线框 + 「—」圆标 + 标题 + 说明 | 缺数留位的统一形态 |
| `FeatureState` | 小徽标（`解析失败` / 普通） | 原样 |
| `Segmented` | `campus-seg` 分段按钮 | 原样，用于口径/角色切换 |
| `Ranking` | 排序取前 N、进度条、`selected`/`onSelect` 联动、`value:null` 时宽度按 0 | 原样，接「当日使用人数」排行 |
| `AttentionPanel` | **只渲染 `ATTENTION_STATS`，即全区学生 + 全区教师两个饼**（已关注/未关注），中心显示 `percent` 字符串 | 必须改成数据驱动，补齐家长，并支持按学校切换 |
| `CategoryDonut` | 应用分类环形图 + 图例 + 中心总数 | 原样 |
| `ActivityPanel` | 学校活跃柱状图，`activeCount`/`activeUsers` 切换，取前 7 所，`BarTick` 旋转 -30° | 原样；注意它是**无日期无应用维度**的累计值 |
| `VisitTrendPanel` | 面积图，`count`/`users` × `all`/`mobile`/`pc` 六种字段组合，`connectNulls={false}` | 原样；`connectNulls=false` 已满足「缺日不补 0、保留断点」 |

- [ ] 统一组件时一律复用这里的原实现，不要另写替代品（用户既有偏好：以主屏原版为准）。
- [ ] `ActivityPanel` 里的 `ACTIVITY_SHORT_NAMES` 是玄武 7 所学校的硬编码简称映射，建邺需替换或改为数据驱动。
- [ ] `Ranking` 的 `value: null` 目前渲染成「未提供」文字 + 0 宽度条，符合缺数要求，保留。

### 5.2 数据结构现状

[lib/smart-campus-data.ts](../../lib/smart-campus-data.ts) ← [lib/smart-campus.generated.json](../../lib/smart-campus.generated.json)（80KB）

| 数据集 | 规模 | 粒度 | 能否支撑「每日应用使用人数」 |
|---|---|---|---|
| `users` | 1 条 | 全区 | 含 `allStudent/allTeacher/allParent/allUser` 与 `allAttend*`/`allNoAttend*`/`*Percent`，**家长字段已存在** |
| `installations` | 100 条 | 应用 | `moduleCode/name/schoolCount/statisticsCode`，无日期 |
| `usages` | 9 条 | 应用 | `creationCount/readerCount`，**累计创建记录，非日活** |
| `visits` | 7 条 | 日期 × 全区（`schoolId:0`） | 逐日 `loginTotal/loginUsersTotal` + 移动端/电脑端拆分，**无学校维度、无应用维度** |
| `leave` | 汇总 + rows | 学校 | 请假学生/教师数 |
| `roster` | 69 条 | 学校 | `schoolId/name/stage/organizationCode`（含校区与非学校机构） |
| `activity` | 78 条 | 学校 | `activeUsers/activeCount`，**无日期、无应用** |
| `attention` | 68 条 | 学校 | `clientType`（企微）、`grade`，`teacher/student/parent` 各含 `total/followed/percent` |
| `sources` | 8 条 | — | 每个源文件的加载状态与错误，驱动 `sourceIssue` |

**核心缺口（与方案第五节一致）：** `visits` 有逐日人数但无「学校 × 应用」；`activity` 有学校但无日期与应用；`usages` 是累计创建记录。三者**无法拼接**成用户要求的「每日应用使用人数」。

- [ ] `attention` 已有校级三角色（含家长）的 total/followed/percent，`AttentionPanel` 却只用全区 `users` 的学生+教师两项 —— 必须改成读 `attention` 并支持全区/单校切换。
- [ ] [smart-campus-data.ts:48](../../lib/smart-campus-data.ts#L48) 的 `usageByCode = new Map(usages.map(row => [row.moduleCode, row]))` 是**单值 Map**，同一 `moduleCode` 多校/多日会互相覆盖；建邺版必须改成按「日期 + 范围 + 学校 + 应用」的完整粒度索引。
- [ ] 全区某应用人数必须跨校去重、平台整体人数必须跨应用跨校去重，都不能由分项相加得出；需要源端单独提供聚合值。
- [ ] 多日每日人数相加是累计人次，不是期间去重人数；7 日去重人数须源端单独提供。
- [ ] 移动端 + 电脑端人数不能相加（`visits` 里两者可能重复）。
- [ ] 关注率分母为 0 或未提供时显示「—」，不得显示 0%。全区关注率不得对各校比例取平均。
- [ ] 家长多孩/关联多校时须按统一用户标识去重；缺去重依据时由源端单独给全区聚合。
- [ ] 「关注」的来源沿用原系统定义（`attention.clientType` = 企微），**不得用登录、绑定账号、课堂抬头率替代**。
- [ ] `formatValue` 目前把 `null/undefined/''` 一律输出「未提供」；建邺版方案要求缺数显示「—」，需要统一这两种表述（真实 0 必须正常显示 0）。

## 六、必须停用的估算与模拟数据

| 位置 | 内容 | 处置 |
|---|---|---|
| [lib/smart-campus-demo.ts](../../lib/smart-campus-demo.ts) | `campusDemoCounters` 以固定纪元 `2026-10-13` 起、每秒 +2.4 条伪造「应用使用记录」增长，喂给 `CampusFusion` | 建邺版禁用模拟增长 |
| [lib/smart-campus-categories.ts](../../lib/smart-campus-categories.ts) | `OTHER_APPS = 12` 为编辑口径硬编码，`APP_TOTAL_COUNT = CAMPUS_APPS.length + 12`；分类靠三组写死的 `moduleCode` 集合 | 应用总数与分类改为数据驱动，不得再靠加常量凑 |
| [lib/dashboard-data.ts:134](../../lib/dashboard-data.ts#L134) | `STUDENT_TEACHER_RATIO` 按学段师生比估算校级学生数，`getSchoolDashboard` 在名册缺数时回退使用 | 建邺版禁用；缺数显示「—」 |
| [lib/dashboard-data.ts:468](../../lib/dashboard-data.ts#L468) | 校级面板强行追加「全区骨干占比」「全区高级职称」两行 | 校级只放该校数据，不与全区值混排 |
| [lib/education-map.ts:79](../../lib/education-map.ts#L79) | 缺坐标学校回退到 `fallbackCenter`（区中心伪点），仅 `console.warn` | 移除伪点；缺坐标学校保留下拉入口但不上图 |
| [lib/dashboard-data.ts:109](../../lib/dashboard-data.ts#L109) | `TEACHER_DATA` 整块来自《玄武区教师队伍状况分析报告》，含折算口径 | 不得作为建邺数据，需换建邺主数据 |

- [ ] `SimMark`（「?」徽标 + 悬停「非正式数据，仅供参考！」）机制保留：凡不能确认的数字逐处标注，宁可多标，不能只靠页脚声明。
- [ ] 建邺版接真实值后，对应位置的 `SimMark` 应随之去掉；仍为估算/公开统计的继续保留标记。

## 七、地图现状

[lib/education-map.ts](../../lib/education-map.ts) + [components/dashboard/hub-scene.tsx](../../components/dashboard/hub-scene.tsx)（923 行）

- 区界 `lib/xuanwu-boundary.json`、湖面 `lib/xuanwu-lake.json`（OSM WGS84 / ODbL）；环方向需反转以适配 d3 球面投影。
- `MAP_WORLD_WIDTH=14`、`MAP_THICKNESS=0.8`、`BRAIN_HEIGHT=6.6`；`geoMercator().fitWidth(1000)` 后线性映射到场景坐标。
- 卫星影像 `/images/terrain/satellite.jpg`（Esri World Imagery z16）+ 高程 `/images/terrain/dem.png`（AWS Terrarium z13），按区界外接矩形裁切；**高程归一化写死 0=0m、255=446m（紫金山头陀岭）**，`TERRAIN_RELIEF=1.05` 约 2.4 倍竖向夸张。
- `hub-scene.tsx` 主要构件：`DistrictBody`、`useTerrainHeight`（读 DEM 像素）、`useDistrictMask`（区界掩膜 alphaTest 裁切）、`TerrainSurface`（含等高线 shader）、`Lake`（`LAKE_Y`）、`Platform`（三层台阶底座）、`Socket`、`OrbitRings`、`Brain`（`public/models/brain.glb`）、`DataStreams`、`SchoolMarker`（六边形基座 + 光柱 + Billboard 校徽 + `Html` 悬浮卡）、`CameraRig`（按 `horizontalInset` 自动推拉取景）、`fitSamples`。渲染锁 `RENDER_FPS=30`、`RENDER_PIXEL_BUDGET=3_200_000`。
- 学校点位来自 `SCHOOL_DIRECTORY`（43 所玄武学校）× `lib/school-locations.ts` 坐标 × `lib/school-logos.ts` 校徽/简称。
- `CONVERGENCE_SCHOOLS = SCHOOL_MAP_POINTS.filter((_, i) => i % 4 === 0)` —— 数据流汇聚点是**按下标取模挑的**，非真实业务含义。

- [ ] 换成建邺区界与水系（`lib/jianye-map.json`），移除玄武地形；建邺地势与紫金山不同，DEM 归一化上限与 `TERRAIN_RELIEF` 必须重新核定，不能沿用 446m。
- [ ] 学校名录、坐标、校徽全部换建邺核准数据；`SCHOOL_LOCATIONS` 的键必须与名录名称完全一致，否则点位回退（改造后应直接不上图）。
- [ ] `CONVERGENCE_SCHOOLS` 的取模挑选要么改为有业务含义的口径，要么去掉数据流特效，不得冒充真实汇聚关系。
- [ ] 建邺版地图点位、学校下拉、全区/单校切换三者联动；点校后应用清单、当日使用人数、趋势、排行、三角色关注一起变化。
- [ ] `terrain/satellite.jpg`、`terrain/dem.png`、`models/brain.glb`、`images/logos/*.png` 都在 `build-single-html.mjs` 的内联清单里，替换素材后同步更新该清单（`sips` 压缩质量参数按新图重调）。

## 八、导出链路现状

[scripts/build-single-html.mjs](../../scripts/build-single-html.mjs)

- `NEXT_STATIC_EXPORT=1 npm run build` → `out/`；把 CSS/JS/字体/图片/GLB 全部转 data URI 内联；`inlineCss` 会剔除 `Noto Sans SC` 的 100+ 个 `@font-face` 子集（4.7MB），改用系统字体栈。
- `patchTurbopackRuntime` 给内联脚本补 `data-chunk-src`，并修补 `getAttribute("src")` / `new URL(e.src)` 两处 turbopack 运行时逻辑（内联脚本无 src 会取到 null 报错）。
- 首段注入 `chunkGuard`：拦截 `document.head.appendChild`，把对 `/_next/static/chunks/` 的外链请求直接回调 `onload`。
- 第 4 步无条件内联 `public/xuanwu-robot.js` 与 `public/coze-web-sdk.js`，把 `/xuanwu-robot.js`、`/coze-web-sdk.js` 两个 URL 替换成 `data:text/javascript;base64,...`（`DigitalHuman` 是 fetch 后 `new Function` 执行，不能直接内联 `<script>`，会被 App Router body 水合清掉）。
- 产物：`dist/玄武区教育数智中枢.html`（`npm run build:single`）、`dist/智慧校园.html`（`npm run build:campus`）。`--campus` 会跳过 scenes/terrain/brain.glb/logos 的内联。
- 收尾扫描残留 `/_next/` 引用，`benign()` 白名单外的会 `process.exitCode = 1`。
- 现有 `dist/` 还留着 `xw_sjzs.html`、`xw_yxhd.html`、`xw_zhxy.html` 与六张智慧校园截图（1366/1920/2560）。

[scripts/build-yanxun-html.mjs](../../scripts/build-yanxun-html.mjs)

- 源路径写死 `../教师发展大屏/yanxun.html` —— **该目录已不存在**，研训源文件现在位于 `教师视导/yanxun.html`（4.09MB，2026-10-13）；同目录也有 `title-bg.svg`。当前 `npm run build:yanxun` 必然失败。
- 脚本会校验 `<title>玄武区研训活动分析看板</title>`，并拒绝含跨页切换代码（`data-xw-swipe`/`__XW_SWITCH_SCREEN__`/`__XW_SCREENS__`/`xw-screen`）的源文件；把 `url('title-bg.svg')` 替换成 base64；输出到 `public/`、`dist/`、`out/`（若存在）三处，文件名 `玄武区研训活动.html`。

- [ ] 修正研训源路径断链（指向 `教师视导/yanxun.html` 或迁移后的 `templates/training.html`），标题校验串同步换建邺。
- [ ] `build-single-html.mjs` 扩展为输出总览、应用运营、四业务专题及视导原子页；各文件内联必要资源，同目录相对链接互跳。
- [ ] 第 4 步的扣子 SDK 内联要按建邺配置改造，**旧问答凭据不得打包**。
- [ ] `package.json` scripts 需相应新增；现有 `build:campus`/`build:yanxun`/`import:campus`/`check:campus` 保留或改名要一次说清。
- [ ] 离线交付：断网逐个打开产物，验证资源、真实数字人动画、建邺地图与相对链接全部可用，不要求用户另起数据库或 Web 服务。

## 九、其他现状备忘

- `public/images/` 下有 `scenes-archive/`、`logos-archive/`、`map-terrain.png`、`xuanwu-map-3d.png`、`xuanwu-map-reference.png`、`markers/`、`brain.png`、`brain-ai.png` 等玄武素材；替换建邺时确认哪些仍被引用，未被引用的不要打进产物。
- [components/dashboard/school-emblem.ts](../../components/dashboard/school-emblem.ts) 用 `.replace(/^玄武区?/, '')` 生成校徽文字回退，建邺需改前缀。
- `components/dashboard/campus-fusion.tsx` 里有写死的 `<text ...>玄武区</text>` 地球标签；`campus-reminder.tsx` 是数字人应用提醒面板（与 `DigitalHuman` 共用 `#robot`）。
- 项目使用 pnpm（`packageManager: pnpm@12.3.4`），Next 16.3.3 + React 19 + recharts 3 + @react-three/fiber 9 + three 0.186。
- `AGENTS.md` 提示这是**有破坏性变更的 Next.js 版本**，写代码前先读 `node_modules/next/dist/docs/` 下对应指南，不要凭训练数据里的旧 API 写。
- 类型检查必须独立执行 `npx tsc --noEmit --incremental false`，不得以「忽略类型错误的构建通过」代替。
