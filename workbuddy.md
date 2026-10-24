# workbuddy.md — PRISM｜证据折射室 开发记录

> 本文件反映代码的实际状态，随开发同步更新。交接规范文档编号 PRISM-HO-001 v1.0。
> 最后更新：2026-10-24

- **GitHub 仓库**：https://github.com/linagyuechen123-pixel/-
- **线上作品**：https://prism-evidence.app.workbuddy.host/?sharecode=EAKUMP27DH （必须带 `sharecode` 参数）
- **参赛提交材料**：见仓库根目录 `SUBMISSION.md`（侦探赛道，截止 2026-10-25 16:00）

## 1. 项目背景与目标

PRISM 是面向 WaytoAGI 1024 超能 Coding 周末「侦探赛道」的作品，定位为**具有真实搜索能力的沉浸式事实调查工具**。

四项不可妥协的核心要求：

1. **真实搜索** —— 必须实际调用元宝搜索，生产环境不得使用静态结果冒充。
2. **证据可追溯** —— 每项关键结论都能关联到具体来源。
3. **不确定性透明** —— 明确区分「已确认 / 部分支持 / 相互冲突 / 证据不足」。
4. **交互服务于调查** —— 每个视觉效果对应真实操作或真实调查状态。

## 2. 当前架构

```
浏览器（客户端）
  ├─ 大模型调用（云服务 SDK，免密钥，仅浏览器端）
  │    负责任务：命题拆分、查询计划、证据关系判断、报告撰写
  └─ 调用 /api/search  ← 唯一触发真实搜索的通道
服务端（Node / Next.js Route Handler）
  └─ 持有 WSA_API_KEY → 调用元宝搜索 SearchPro → 规范化 → 返回结果
```

**关键架构决策**：大模型的 SDK 使用规范禁止用服务端路由代理模型调用，因此调查编排放在浏览器端；搜索因必须隐藏密钥而放在服务端。模型永不生成来源，所有来源 100% 来自 `/api/search` 的真实返回值。

### 主要目录

| 路径 | 职责 |
|---|---|
| `app/page.tsx` | 首页黑镜入口 |
| `app/investigate/[id]/` | 调查工作台：命题解剖 → 证据调查 → 报告 + 拖拽分类 |
| `app/report/[id]/` | 报告页（从 localStorage 还原） |
| `app/upload/` | 截图查证 + OCR |
| `app/monitor/` | 监控中心（未启用状态说明） |
| `app/api/search/` | 单次真实搜索 |
| `app/api/health/` | 搜索配置体检 |
| `lib/search/wsa.ts` | 元宝搜索接入、结果规范化、去重、错误映射 |
| `lib/investigation/runner.ts` | 调查引擎编排：计划 → 多轮 → 反证 → 证据 → 报告 |
| `lib/investigation/rules.ts` | 规则化降级模式（§7.6） |
| `lib/llm/browser.ts` | 免密钥大模型封装（流式收集 + JSON 校验） |
| `lib/storage/local.ts` | 本地持久化 + 服务端短时缓存 |
| `types/prism.ts` | 全项目共享数据模型 |

## 3. 核心数据模型

全部定义于 `types/prism.ts`，与规范 §12 对齐：

`Investigation` / `Claim` / `SearchRound` / `Source(SearchResult)` / `Evidence` / `Report` / `InvestigationBundle`

固定枚举（跨页面统一，不得另起别名）：

- 证据关系：`supports` / `contradicts` / `context` / `unverified`
- 结论状态：`supported` / `partially_supported` / `conflicting` / `insufficient_evidence`
- 调查状态：`draft` / `planning` / `searching` / `verifying` / `synthesizing` / `completed` / `partial` / `failed` / `cancelled`
- 轮次类型：`initial` / `official_source` / `counter_evidence` / `exception` / `follow_up`
- 调查模式：`model` / `rule`

## 4. 搜索服务接入方式

| 项 | 值 |
|---|---|
| 端点 | `POST https://api.wsa.cloud.tencent.com/SearchPro` |
| 鉴权 | `Authorization: Bearer ${WSA_API_KEY}` |
| 请求体 | `Action=SearchPro`、`Version=2025-05-08`、`Query`、`Mode`(默认 2)、`Cnt`(10/20/30/40/50)、可选 `Site` / `Freshness` / `Industry` |
| 结果路径 | `Response.Pages`，**元素为 JSON 字符串**，需二次 `JSON.parse` |
| 字段映射 | `title`→title、`url`→url、`passage`→snippet、`site`→siteName、`date`→publishedAt、`score`→relevanceScore |

字段使用纪律：缺失字段留 `null`，不编造；`retrievedAt` 是本机获取时间，不等于发布时间；`relevanceScore` 是相关性，不等于正确率。

**错误码映射**（`SEARCH_ERROR_CODES`）：`MISSING_KEY` / `UNAUTHORIZED` / `TIMEOUT` / `RATE_LIMITED` / `BAD_RESPONSE` / `NETWORK` / `EMPTY` / `INVALID_QUERY`。任何失败都只返回结构化错误，**不回退假数据**。

### 环境变量

- `WSA_API_KEY`（主）
- `TENCENTCLOUD_WSA_APIKEY`（兼容读取）
- `.env*` 已在 `.gitignore` 忽略；`.env.example` 只有键名与占位

## 5. 开发约定

1. **禁止静态数据冒充搜索结果。** 任何位置都不得出现「演示来源」。
2. **不得删除失败记录制造成功状态。** 失败的轮次保留 `status: failed` 并在报告「调查局限」中列出。
3. **区分用户分类与系统判断。** `Evidence.relation` 为系统判断，`Evidence.userRelation` 为用户手动分类，二者分开记录。
4. **未完成不得显示为完成。** `Report.incomplete = true` 时报告顶部必须显示醒目提示。
5. **搜索预算。** 每子命题最多 3 轮、整次调查最多 12 次（`MAX_ROUNDS_PER_CLAIM` / `MAX_TOTAL_SEARCHES`），达到上限停止并说明。
6. **模型输出必须经程序校验。** `lib/llm/browser.ts` 中每个调用都带 validator，schema 不符即回退或不采用。
7. **模型不得生成来源。** 报告相关的 prompt 明确要求「只允许引用用户给出的 sourceId」。
8. **共享类型。** 所有页面与组件复用 `types/prism.ts`。
9. **动画不阻断功能。** 所有关键操作都有非动画路径；`prefers-reduced-motion` 下关闭所有连续动画。

## 6. 测试要求与已执行结果

| 类型 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 通过（0 error） |
| 代码规范 | `npm run lint` | 通过（0 warning / 0 error） |
| 生产构建 | `npm run build` | 通过，7 条路由全部产出 |
| 契约测试 | `node tests/search-contract.mjs` | 12 项全部通过（含已配置密钥分支） |
| 移动端端到端 | `node tests/mobile-check.mjs` | 9/9 通过（390×844 真实 Chrome，对已部署站点） |
| 浏览器端到端（文本流程） | `node tests/demo-capture.mjs "<说法>"` | 已执行 2 次，均跑通全流程 |
| 浏览器端到端（OCR 流程） | `node tests/demo-ocr-capture.mjs` | 已执行，OCR 成功并完成调查 |

契约测试覆盖：非法 JSON、空查询、超长查询、缺密钥时的正确错误码、非法 `cnt`、以及**配置密钥后**的来源字段完整性与去重校验（`tests/search-contract.mjs` 会按 `/api/health` 结果自动切换断言分支）。

移动端测试覆盖：首页加载与搜索就绪、无横向溢出、可提交调查、子命题渲染、可触发多轮搜索、产出报告、外链可点且指向外部站点、无应用级 JS 异常。

> 移动端运行期会观察到 2 条 `/favicon.ico` 的 403，来自部署平台分享网关对不带 `sharecode` 请求的拦截（静态资源同样受限），属平台层噪音而非应用缺陷。测试脚本已把「资源层 403」与「JS 异常」分开统计，不合并计分。

**尚未执行**：真实 iOS / Android 设备上的触摸手势回归（尤其 DragEvent 拖拽；移动端已提供下拉菜单作为等效替代路径）；多浏览器兼容测试（仅 Chrome 验证过）。

### 生产环境真实性校验（2026-10-24）

部署地址 `https://prism-evidence.app.workbuddy.host`。每次演示后从 `record.json` 自动交叉核验：

| 演示 | 说法 | 轮次 | 去重来源 | 结论 | 无效 URL | 缺标题 |
|---|---|---|---|---|---|---|
| 01 | 不锈钢保温杯装碳酸饮料会腐蚀内胆 | 12 | 104 | `conflicting` | 0 | 0 |
| 02 | 空腹喝牛奶会导致腹泻 | 9 | 69 | `partially_supported` | 0 | 0 |
| 03 | 微波炉加热塑料饭盒会释放致癌物质（OCR 入） | 12 | 114 | `conflicting` | 0 | 0 |

三次均为 `mode: model`（大模型模式，非规则化降级）。来源链接抽验：`mengcheng.gov.cn`、`dayi.org.cn`、`cnr.cn` 三条均返回 HTTP 200。

## 7. 已完成的功能

### P0

| 编号 | 功能 | 实现位置 |
|---|---|---|
| P0-01 | 首页可输入并启动调查 | `app/page.tsx` |
| P0-02 | 后端调用元宝搜索 | `lib/search/wsa.ts` + `app/api/search/route.ts` |
| P0-03 | 来源展示真实字段 | `components/evidence/SourceCard.tsx` |
| P0-04 | 可打开原始链接（无效链接禁用并说明） | 同上 |
| P0-05 | 多轮调查 | `lib/investigation/runner.ts` |
| P0-06 | 支持 / 反对 / 背景 / 待核验整理 | `runner.ts` + SourceCard 下拉 + 拖拽区 |
| P0-07 | 可追溯报告 | `components/report/ReportView.tsx` |
| P0-08 | 真实错误状态 | 全链路错误码 + 调查室错误展示 |
| P0-09 | 移动端布局 | Tailwind 响应式 + 降级替代交互；**已实测**：390×844 真实 Chrome 端到端 9/9（见 §7） |
| P0-10 | 演示材料 | **已完成**：`demo/` 下 3 组真实截图 + `record.json`（真实轮次、来源、结论，来源链接均通过可打开性抽验） |

### P1

| 编号 | 功能 | 状态 |
|---|---|---|
| P1-01 | 图片上传与格式/大小校验 | 已完成（PNG/JPG/JPEG/WebP，≤10MB） |
| P1-02 | OCR（Tesseract.js，中英文，浏览器本地） | 已完成；识别失败给出明确状态并允许手输 |
| P1-03 | 识别文本可编辑 | 已完成 |
| P1-04 | 确认后进入调查流程 | 已完成（未确认不得启动） |
| P1-05 | 关键动画可触发 | 已完成：液态黑镜、双语透镜、蒙版揭示（含非动画查看按钮）、空间转场 |
| P1-06 | 证据分类可调整 | 已完成：拖拽 + 下拉菜单双通道 |

### P2 · 持续盯梢（已实现并端到端验证）

| 编号 | 功能 | 状态 |
|---|---|---|
| P2-01 | 报告页「盯住这个说法」建立盯梢目标与基线快照 | 已完成（`components/report/ReportView.tsx`） |
| P2-02 | 复查：用保存的查询词真实调用 `/api/search` | 已完成（`lib/investigation/watch.ts`） |
| P2-03 | 差异比对：新增来源 / 本次未再检索到 | 已完成，口径与基线一致（见下） |
| P2-04 | 模型对新增证据做增量判断（是否足以改变结论） | 已完成（`assessDeltaWithModel`） |
| P2-05 | 页面保持打开时按间隔自动复查 | 已完成（`app/monitor/page.tsx`，15/30/60/180 分钟） |
| P2-06 | 快照与盯梢列表本地持久化 | 已完成（`lib/storage/watch.ts`） |

**诚实边界（不得越线表述）**：部署环境没有数据库与服务端定时任务，自动复查只在页面保持打开时触发，关闭即停止；`/monitor` 页面顶部照实列出这四条边界。「本次未再检索到」不等于来源已删除——搜索引擎返回集合本身有波动，UI 里保留这层说明。

**关键设计决策**：基线快照只取「复查要用的那几条查询词」在原调查中实际检索到的来源，不是整次调查的全部来源。最初按全集做基线，导致基线 91 条 vs 复查 30 条，diff 稳定输出「新增 0 条」——口径不对等会让盯梢失去意义，已修正。

验证：见 §6 测试表 `watch-check.mjs`。

## 8. 已知问题与未完成项

1. **无数据库** —— 调查记录仅在浏览器 localStorage（服务端有一份进程内缓存，重启失效）。跨设备/清缓存后不可恢复，已在 UI 与 README 明确说明。
2. **无服务端定时任务 / 无数据库** —— 持续盯梢已实现为「页面打开时按间隔真实复查 + 本地快照比对」（见 P2），但**不是**服务端定时监控：关闭页面即停止，跨设备不可恢复。`/monitor` 页面已照实说明，不使用手动刷新冒充自动监控。
3. **证据卡片拖拽** 使用 HTML5 drag events，桌面端可用；移动端与键盘用户走下拉菜单（§16.1 要求已满足，但移动端尚无触摸拖拽）。
4. **OCR 语言包** 首次加载需下载 `chi_sim` 数据包（约 10–15MB），弱网环境首次识别较慢；失败时可手动输入兜底。
5. **大模型可用性依赖 Origin 匹配** —— 云服务校验应用来源，本地 `localhost` 可能触发 `auth_*` 错误，此时自动回落规则化降级模式并显式告知用户。
6. **平台分享门禁与站内跳转** —— 部署平台的分享门禁要求请求携带 `sharecode`；从 `/upload` 等子页面发起的站内跳转可能因参数丢失被拦为「链接不完整」。从分享链接正常进入首页后再操作则无此问题。演示脚本已按真实用户路径处理（先落首页）。
7. **沙箱开发环境构建目录** —— 本地沙箱对 `.next` 目录有权限守卫，本地构建用 `PRISM_DIST_DIR` 切换到隔离目录；部署平台侧使用标准 `.next`，构建正常。
8. **搜索摘要乱码片段** —— 个别上游来源的 passage 摘要中夹有少量非中文字符（上游数据问题），不影响结论判断，原始网页为准。
9. **首页「最近调查」入口** 使用 `<a>` 跳转 `/report/[id]`（会整页刷新），行为正常但与站内其他 Link 不一致，属可选优化项。

## 9. 下一步任务

1. 小红书 / 视频号公开分享：链接 `https://prism-evidence.app.workbuddy.host/?sharecode=EAKUMP27DH`（**必须带 `sharecode` 参数**，否则网关直接 403「链接不完整」），2026-10-25 23:59 前补填。
2. **移动端已用真实浏览器验证**（不再是需要真机回归的待办）：`node tests/mobile-check.mjs`，390×844 视口走通「提交 → 子命题 → 多轮搜索 → 报告 → 外链可点」，9/9 通过。
3. 可选优化：为 `/upload` 页的 OCR 进度补充阶段文案；把演示材料整理成短视频脚本。
