# PRISM｜证据折射室

基于**真实搜索**的沉浸式事实调查工具。输入一句待核验的说法（或上传截图），PRISM 会把它拆成可独立核验的子命题，调用元宝搜索执行多轮真实检索，区分支持 / 反对 / 背景 / 待核验证据，并生成一份每条结论都能追溯到原始网页的报告。

**PRISM 的核心承诺：真实、可追溯、可验证、可操作。证据不足时，它明确说证据不足。**

## 核心流程

```
提出问题 → 拆解命题 → 搜索证据 → 核验来源 → 形成结论 → 复核报告
```

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 15（App Router）+ TypeScript + Tailwind CSS v4 |
| 搜索 | 元宝搜索 SearchPro（服务端调用，密钥仅存服务端环境变量） |
| 大模型 | 云服务免密钥 LLM（浏览器端 SDK，用于命题拆分 / 证据判断 / 报告撰写） |
| OCR | Tesseract.js（浏览器本地执行，图片不上传服务端） |
| 交互动效 | CSS 自定义变量 + requestAnimationFrame（无重型 3D 依赖） |
| 存储 | 浏览器 localStorage（**首期不使用数据库**，见下方限制） |

## 本地启动

```bash
npm install
cp .env.example .env.local      # 填入 WSA_API_KEY
npm run dev                      # http://localhost:3000
```

生产构建与启动：

```bash
npm run build
npm start                        # next start -H 0.0.0.0，监听 $PORT
```

其他命令：

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
node tests/search-contract.mjs          # 搜索接口契约测试（需先启动服务）
node tests/mobile-check.mjs             # 移动端端到端验证（对已部署站点）
node tests/demo-record.mjs "<说法>"      # 录制完整调查流程演示视频
```

## 真实查询验证记录（2026-10-24）

已部署地址 `https://prism-evidence.app.workbuddy.host`，完成三次真实查询（材料与过程截图见 `demo/`，逐条记录见各目录 `record.json`）：

| 说法 | 搜索轮次 | 去重来源 | 结论状态 |
|---|---|---|---|
| 不锈钢保温杯装碳酸饮料会腐蚀内胆 | 12 | 104 | `conflicting`（与现有证据冲突） |
| 空腹喝牛奶会导致腹泻 | 9 | 69 | `partially_supported`（部分支持） |
| 微波炉加热塑料饭盒会释放致癌物质（截图 OCR 进入调查） | 12 | 114 | `conflicting`（与现有证据冲突） |

三次均运行于大模型模式（非规则化降级）；`record.json` 中每条来源均含真实可打开的 URL（抽验返回 HTTP 200）。

另有完整流程录屏 `demo/05-演示录屏/investigation.mp4`（38 秒 / 1440×900，真实 Chrome 驱动线上站点录制，无剪辑）与移动端端到端验证 `demo/04-移动端验证/`（390×844 真实 Chrome，9/9 通过）。

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `WSA_API_KEY` | 是 | 元宝搜索服务 API KEY。缺失时所有搜索返回 `SEARCH_CONFIG_MISSING_KEY`，系统**不会**回退到任何假数据 |
| `TENCENTCLOUD_WSA_APIKEY` | 否 | 官方同名变量的兼容读取项 |

`.env*` 已在 `.gitignore` 中忽略。密钥不会出现在前端产物、浏览器控制台或 Git 提交中。

## 搜索接口说明

服务端路由 `POST /api/search`：

```json
// 请求
{ "query": "金属饭盒不能放进微波炉加热", "roundId": "R-1-1", "roundType": "initial", "cnt": 10 }

// 成功
{ "ok": true, "results": [{ "id": "S-R-1-1-1", "title": "...", "url": "...", "snippet": "...",
  "siteName": "...", "publishedAt": null, "relevanceScore": 0.87, "query": "...",
  "roundId": "R-1-1", "retrievedAt": "2026-10-24T...", "canonicalUrl": "..." }] }

// 失败（不返回任何来源）
{ "ok": false, "code": "SEARCH_CONFIG_MISSING_KEY", "message": "..." }
```

上游为腾讯元宝搜索 `POST https://api.wsa.cloud.tencent.com/SearchPro`（`Action=SearchPro`，`Version=2025-05-08`，Bearer 鉴权）。结果位于 `Response.Pages`，元素为 JSON 字符串，需二次解析。错误码映射见 `lib/search/wsa.ts`。

> **字段使用约定**：`publishedAt` 仅来自搜索返回值，缺失即留空，系统不编造日期；`retrievedAt` 是本机获取时间，**不等同**于来源发布时间；`relevanceScore` 是搜索相关性，**不代表事实正确率**。

## 主要功能

- **P0** 首页输入、真实搜索、来源卡片、可点击原始链接、多轮调查、反证检索、证据分类、可追溯报告、真实错误状态、移动端可用
- **P1** 图片上传（PNG/JPG/JPEG/WebP ≤ 10MB）、OCR（中英文）、文本编辑与确认、截图发起调查、液态黑镜 / 双语透镜 / 蒙版揭示交互、手动证据分类（拖拽 + 下拉双通道）
- **P2** 持续盯梢：**未实现**，界面明确显示「未启用」（原因见下）

## 已知限制

1. **没有数据库。** 调查记录只保存在发起调查的浏览器 localStorage 中，不跨设备同步，清除浏览器数据后不可恢复；服务端仅在进程内存中缓存一份。
2. **没有服务端定时任务。** 持续盯梢需要「数据库 + 定时调度 + 通知渠道」三者齐备，当前部署环境不提供数据库与 cron，因此监控模块未启用，页面已如实标注，未使用手动刷新冒充自动监控。
3. **搜索配额。** 免费额度每月 2000 次（活动期可提升）；单次调查默认最多 12 次搜索、每子命题最多 3 轮，达上限会停止并说明原因。
4. **大模型降级。** 若大模型不可用，系统切换到规则化降级模式：规则模板拆分命题、结构化模板生成报告、所有证据标记为「待核验」，界面明确提示「未执行大模型语义推理」。
5. **OCR 精度。** Tesseract.js 对低分辨率、艺术字体图片识别率有限，识别结果必须经用户修正确认才进入调查。
6. **搜索结果不等于事实。** PRISM 只整理检索到的公开信息，来源摘要可能与原文存在偏差，所有结论请以打开后的原始网页为准。

## 目录结构

```
app/
  page.tsx                 首页：黑镜入口
  investigate/[id]/        调查工作台（命题解剖 → 证据调查 → 报告）
  report/[id]/             报告页（本地还原）
  upload/                  截图查证 + OCR
  monitor/                 监控中心（未启用状态说明）
  api/search/              单次真实搜索
  api/health/              搜索配置体检
components/                mirror / evidence / report / motion
lib/search/wsa.ts          元宝搜索接入与规范化
lib/investigation/         调查引擎编排 + 规则化降级
lib/llm/browser.ts         免密钥大模型封装
lib/storage/local.ts       本地持久化
types/prism.ts             共享数据模型
tests/                     契约测试 + 端到端演示采集脚本
demo/                      三次真实查询的截图与调查记录
```
