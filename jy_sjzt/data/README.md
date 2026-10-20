# 建邺大屏数据包

这是建邺区教育数智中枢及其应用运营、应用使用页的数据总入口。页面只读本目录的派生快照，不直接连接数据库。

## 一、文件清单

| 文件 | 大小 | 作用 | 生成 / 维护 | 页面使用 |
|---|---:|---|---|---|
| `jianye-overview.generated.json` | 42 KB | 学校名录、师生基数、研训与视导学期汇总 | `scripts/build-jianye-data.py` | 总览、应用运营、应用使用 |
| `jianye.generated.json` | 2.7 MB | 研训活动、视导记录的全量聚合明细 | `scripts/build-jianye-data.py` | 生成研训页与扩展维度 |
| `jianye-dimensions.generated.json` | 2.1 MB | 14 张事实表与 8 张字典/名录表参与聚合，产出 103 个维度数据集 | `scripts/build-jianye-dimensions.py` | 离线分析；不进入首页 JS 包 |
| `smart-campus.generated.json` | 107 KB | 智慧校园平台三张截图的可读值与派生值（21 个数据集） | `scripts/build-smart-campus-data.py` | 应用运营、应用使用 |
| `smart-campus.source.json` | 34 KB | 截图人工录入源、置信度与区域坐标 | 人工核对截图 | 生成脚本的输入 |
| `jianye-map.json` | 3.5 KB | 建邺区 GeoJSON 边界（DataV GeoAtlas 320105） | 地图底图 | 三维地图 |
| `jianye-school-points.json` | 5.4 KB | 34 个已核准校点的 WGS84 经纬度 | 公开地图检索 + 人工核准 | 三维地图点位 |
| `jianye-terrain-meta.json` | 288 B | 卫星影像 / DEM 裁切范围、高程区间、竖向夸张 | `scripts/build-jianye-terrain.py` | 卫星地形模式 |
| `source-inventory.json` | 12 KB | 三库全部 91 张表的行数、大屏使用标记 | 导入核对结果 | 补数范围确认 |
| `manifest.json` | 13 KB | 本目录所有文件的哈希、规模、数据集统计 | `scripts/build-data-manifest.py` | 数据审计 |

`manifest.json` 是可机器读取的总清单；补数后运行 `npm run data:manifest` 更新。

## 二、原始数据覆盖范围

三库共 **91 张表、3,424,518 行**，已完成逐表导入行数核对；大屏实际使用 **25 张**。

| 数据库 | 表数 | 行数 | 导入文件 | 大屏使用 |
|---|---:|---:|---|---:|
| `u_st_jkxt` | 19 | 275,196 | `u_st_jkxt.sql`（99 MB） | 12 张 |
| `u_st_wyxt` | 36 | 2,697,439 | `u_st_wyxt.sql`（3.4 GB） | 8 张 |
| `u_st` | 36 | 451,883 | `u_st.sql`（92 MB） | 5 张 |

### 已接入的 25 张源表

- **基础名册与机构**：`jdts_organization`、`jdts_organizationcategory`、`jdts_organizationtype`、`jdts_js`、`jdts_xs`、`jdts_classinfo`、`c_subject`、`c_grade`、`jdts_infodic`、`jdts_infodicitem`
- **课程资源**：`c_course`、`c_lesson`
- **研训**：`v_oa_education_plan_jy`、`v_oa_education_plan_sign_record_jy`
- **视导**：`v_supervision_record_jy`
- **教育协同**：`v_bulletin_jy`、`v_document_flow_jy`、`v_triple_review_jy`、`v_assessment_project_jy`、`v_assessment_project_result_jy`
- **体育与成长**：`st_aizhty_project`、`st_aizhty_sport_result`、`st_wyydzhty_assessment`、`t_wyyd_zhty_student_scores`、`st_xsry_student_honor`

另有 66 张表未被大屏聚合（如 `v_certificate_jy`、`v_employee_salaries_jy`、`v_disease_report_jy` 等），行数与字段清单见 `source-inventory.json`。这些表涉及证件、工资、健康等敏感信息，**原始数据不进入仓库**。

原始 SQL 备份位于仓库根目录的 `data/`、`mysql-backups/`，合计约 5 GB，已在 `.gitignore` 中排除。需要补数时，把对应 `.sql` 放回根目录 `data/`，或设置 `JY_DB_*` / `MYSQL_PWD` 连接本地 MySQL。

## 三、103 个扩展维数据集

`jianye-dimensions.generated.json` 按「源表 × 分组维度」拆分，共 103 个数据集：

| 来源 | 数据集数 | 纳入记录 | 说明 |
|---|---:|---:|---|
| 教职工名册 | 9 | 7,446 | 学校、性别、学科、学历、职称、学段、岗位状态、名册状态、学校×学科 |
| 学生名册 | 6 | 44,474 | 学校、学段、年级、性别、状态、学校×年级 |
| 班级档案 | 5 | 1,887 | 学校、学段、年级、学校×年级、班级类型 |
| 课程 / 课时资源 | 11 | 5,749 | 学科、年级、状态、类型、组织、月份、交叉表 |
| 通知 / 发文 / 三审 | 21 | 6,645 | 类型、状态、单位、部门、月份等 |
| 评比项目与评分项 | 10 | 22,964 | 分类、级别、结果状态、月份等 |
| 体育测评 / 成绩 | 19 | 446,151 | 学校、年级、项目、等级、月份、项目×日期 |
| 学生荣誉 | 8 | 156 | 学校、年级、荣誉等级、证书、奖项、学期、月份 |
| 研训汇总 | 7 | 5,541 | 学期、月份、周、级别、学校、学段、学科 |
| 视导汇总 | 7 | 3,036 | 学期、类型、月份、学段、评级、分组、学校评级、课程 |

每个数据集都带 `dimensions`（筛选项）、`metrics`（单位与公式）、`totalRecords`、`note`（口径限制）和 `rows`（可直接绘图）。文件顶部 `usage` 说明了缺失值、日期质量、隐私边界与刷新命令。

## 四、智慧校园截图数据

`smart-campus.generated.json` 来自三张平台截图（`docs/smart-campus/wxj1.png` ~ `wxj3.png`），共 21 个数据集：

- 可读实测：学校 / 用户 / 关注概览、近 7 日访问、学校分类、模块安装、30 天请假曲线、请假汇总、可见学校请假表、学校活跃度。
- 明确缺口：角色三角人数、7 日去重人数、分模块使用人数、活跃度统计时段等，保留 `null`，不补 0。
- 页面上的分模块趋势、排行、角色构成中，凡平台未提供的数值都是**固定演示值**，在 `lib/smart-campus-modules.ts` / `lib/smart-campus-usage.ts` 中生成，并在页面逐处加「?」标记；不属于本目录的实测数据。

## 五、数据缺口与演示值

`jianye-overview.generated.json` 的 `gaps` 记录了 16 项口径缺口，主要包括：

1. 「学校 × 应用 × 日期」使用人数、平台日活、三角色关注数据三库均不存在；应用运营页保留模块位置并显示「—」。
2. 教育协同、体育与成长已有源表，但首页快照尚未接入（扩展维度已提供聚合）。
3. 最新学期只有活动安排、没有签到；出勤率与教师参与率按实际覆盖场次计算。
4. 视导评级为「优秀 / 良好 / 合格 / 不合格」，不折算为原版 A 课率；视导学校 UUID 与学校名录尚未建立映射。
5. 满意度、综合督导问题数、学科维度等无可靠数据源，保留空态。

## 六、刷新方式

```bash
cd jy_sjzt

# 从本地 MySQL 重新生成主快照 + 扩展维度（需要 JY_DB_PASSWORD 或 MYSQL_PWD）
npm run import:jianye

# 只从根目录 data/*.sql 重建扩展维度（不连库）
npm run import:dimensions

# 重新生成截图数据 / 数据总清单
npm run import:campus
npm run data:manifest

# 数据自检
npm run check:dimensions
npm run test:data
```

## 七、隐私与发布

- 派生快照不含身份证号、手机号、家庭住址、个人成绩、健康或工资明细。
- 仍包含学校名称、教职工人数、研训活动名称及组织者姓名、视导学校名称等内部业务信息。
- 原始 SQL、导入备份、证书 / 工资 / 疾病表**不得**提交到公开仓库；建议 GitHub 仓库设为 Private。
- `public/玄武区研训活动.html`、`public/建邺区研训活动.html`（生成产物）、`public/xuanwu-robot.js` 与 `教师视导/` 下的旧玄武页面含历史会话或渠道配置，已在 `.gitignore` 中排除，不要重新加入。
