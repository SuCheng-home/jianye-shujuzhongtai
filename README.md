# 建邺区教育数智中枢

建邺区教育大屏与配套数据快照。主应用位于 [`jy_sjzt/`](jy_sjzt/)，包含三个页面：

- `/` 教育数智中枢（总览、三维地图、应用中心、数字人）
- `/smart-campus` 应用运营
- `/app-usage` 应用使用情况

页面只读派生数据，不直接连接数据库；可导出为离线单文件 HTML。

## 快速开始

```bash
cd jy_sjzt
npm install
npm run dev          # http://localhost:3000
```

生产构建与单文件导出：

```bash
npm run build
npm run build:single   # dist/建邺区教育数智中枢.html
npm run build:campus   # dist/建邺区应用运营.html
npm run build:usage    # dist/建邺区应用使用情况.html
npm run build:yanxun   # public/ + dist/ 建邺区研训活动.html
```

## 数据

- 数据总入口：[`jy_sjzt/data/`](jy_sjzt/data/)
- 数据清单与口径：[`jy_sjzt/data/README.md`](jy_sjzt/data/README.md)
- 机器可读清单：[`jy_sjzt/data/manifest.json`](jy_sjzt/data/manifest.json)
- 数据来源覆盖：三库 91 张表、342 万行；大屏使用 25 张表
- 派生数据集：103 个扩展维度数据集 + 21 个智慧校园截图数据集
- 缺口与演示值：见数据说明与页面「?」标记

数据刷新：

```bash
cd jy_sjzt
npm run import:jianye    # 本地 MySQL → 主快照 + 扩展维度
npm run import:dimensions # 根目录 data/*.sql → 扩展维度
npm run data:manifest
npm run test:data
```

> 根目录 `data/`、`mysql-backups/` 中的原始 SQL 备份约 5 GB，含证件、工资、健康等敏感字段，**不进入 Git 仓库**。仓库只保留不含个人明细的聚合快照。

## 目录

```text
.
├── jy_sjzt/                 Next.js 大屏应用
│   ├── app/                 页面路由
│   ├── components/dashboard 大屏组件
│   ├── data/                数据快照与清单
│   ├── lib/                 数据视图与地图投影
│   ├── public/              运行时素材（地图影像、数字人、模型）
│   ├── scripts/             数据生成、校验与单文件打包
│   └── docs/                设计与验收记录
├── 教师视导/                旧玄武专题页（不入库）
├── 智慧校园/                智慧校园截图（已归档到 jy_sjzt/docs）
└── data/                    原始 SQL 备份（不入库）
```

## 技术栈

Next.js 16、React 19、TypeScript、Tailwind CSS 4、Recharts、three.js / react-three-fiber。

## 说明

- 地图底图：卫星影像 Esri World Imagery，高程 AWS Terrarium；区界阿里云 DataV GeoAtlas（320105）。
- 学校点位只展示已核准坐标的 34 所学校，其余学校保留在下拉中、不上图。
- 数字人使用本地 PAG 动画；问答需要部署页提供 `window.__JIANYE_ASSISTANT__`，未配置时只保留形象。
- 数据包含学校名称、研训活动与组织者姓名、视导学校等内部业务信息，建议仓库保持 Private。
