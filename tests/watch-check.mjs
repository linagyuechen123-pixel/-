/**
 * 持续盯梢端到端验证脚本
 *
 * 真实驱动 Chrome 完成：一次完整调查 → 报告页「盯住这个说法」→ 监控中心「立即复查」
 * → 核对复查结果（新增来源 / 未再检索到 / 增量判断 / 外链可点）。
 * 复查走的 /api/search 是真实元宝搜索，不做任何预置数据。
 *
 * 用法：
 *   PRISM_BASE_URL=http://127.0.0.1:3111 node tests/watch-check.mjs "待核验说法"
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const puppeteer = require_(
  process.env.PUPPETEER_PATH ||
    "C:/Users/lyc/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core",
);

const BASE = process.env.PRISM_BASE_URL || "http://127.0.0.1:3111";
const CHROME =
  process.env.PRISM_CHROME_PATH ||
  "C:\\Users\\lyc\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const OUT = process.env.PRISM_WATCH_OUT || path.resolve("demo/06-持续盯梢");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, t) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.find((n) => (n.textContent || "").includes(t)) || null;
    },
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`未找到包含「${text}」的 ${selector}`);
  await el.click();
}

async function run() {
  if (!fs.existsSync(CHROME)) throw new Error(`未找到 Chrome：${CHROME}`);
  fs.mkdirSync(OUT, { recursive: true });

  const query = process.argv.slice(2).join(" ").trim();
  if (!query) throw new Error("请提供待核验说法作为命令行参数。");

  const report = { query, steps: [], screenshots: [], checks: [] };
  const check = (name, ok, note) => {
    report.checks.push({ name, ok, note });
    console.log(`${ok ? "  [PASS]" : "  [FAIL]"} ${name}${note ? ` — ${note}` : ""}`);
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 950, deviceScaleFactor: 2 },
  });

  const page = await browser.newPage();
  page.on("pageerror", (e) =>
    report.steps.push({ level: "pageerror", message: String(e) }),
  );

  const shot = async (name) => {
    const f = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: f });
    report.screenshots.push(f);
    return f;
  };

  // 1. 首页发起调查
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.waitForSelector("#claim-input", { timeout: 60_000 });
  const health = await page.evaluate(async () => {
    const r = await fetch(`/api/health${location.search}`);
    return JSON.parse(await r.text());
  });
  report.searchConfigured = health.searchConfigured;
  if (!health.searchConfigured)
    throw new Error("服务端未配置搜索密钥，无法产生真实复查。");
  check("搜索服务已配置", true, `searchConfigured=${health.searchConfigured}`);

  await page.type("#claim-input", query, { delay: 10 });
  await sleep(300);
  await clickByText(page, "button", "启动调查");
  await page.waitForFunction(() => location.pathname.startsWith("/investigate/"), {
    timeout: 60_000,
  });

  // 2. 命题解剖 → 开始调查
  await page.waitForSelector("textarea", { timeout: 150_000 });
  await page.waitForFunction(
    () => document.querySelectorAll("textarea").length >= 2,
    { timeout: 180_000 },
  );
  await clickByText(page, "button", "确认范围并开始调查");

  // 3. 等到报告出现
  await page.waitForFunction(() => document.body.innerText.includes("来源列表"), {
    timeout: 420_000,
  });
  await sleep(1200);

  // 4. 报告页点「盯住这个说法」
  const watchBtn = await page.evaluateHandle(() => {
    const nodes = Array.from(document.querySelectorAll("button"));
    return nodes.find((n) => (n.textContent || "").includes("盯住这个说法")) || null;
  });
  const hasWatchBtn = !!watchBtn.asElement();
  check("报告页出现「盯住这个说法」", hasWatchBtn);
  if (!hasWatchBtn) throw new Error("报告页没有盯梢入口。");
  await watchBtn.asElement().click();
  await sleep(400);
  const watchedText = await page.evaluate(
    () => document.body.innerText.includes("已在盯梢列表"),
  );
  check("点击后进入已盯梢状态", watchedText);

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("prism:watch:targets");
    if (!raw) return null;
    const list = JSON.parse(raw);
    const t = list[0];
    return {
      count: list.length,
      claim: t.claim,
      queries: t.queries,
      snapshotUrls: t.snapshots[0].sourceUrls.length,
      resultStatus: t.snapshots[0].resultStatus,
    };
  });
  check(
    "盯梢目标已写入本地存储",
    !!stored && stored.count >= 1 && stored.queries.length > 0,
    stored ? `${stored.queries.length} 条复查查询词 / 初始快照 ${stored.snapshotUrls} 条来源` : "",
  );
  report.watchTarget = stored;
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("h2")).find((n) =>
      (n.textContent || "").includes("持续盯梢"),
    );
    el?.scrollIntoView({ block: "center" });
  });
  await sleep(400);
  await shot("01-report-watch");

  // 5. 监控中心
  await page.goto(`${BASE}/monitor`, { waitUntil: "networkidle2", timeout: 120_000 });
  // dev 模式首次编译该路由需要时间，必须等页面真正渲染出内容再断言
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("持续盯梢") &&
      (document.body.innerText.includes("立即复查") ||
        document.body.innerText.includes("还没有盯梢目标")),
    { timeout: 180_000, polling: 500 },
  );
  await sleep(600);
  const claimOnPage = await page.evaluate(() => {
    const raw = localStorage.getItem("prism:watch:targets");
    const t = JSON.parse(raw)[0];
    return document.body.innerText.includes(t.claim);
  });
  check("监控中心列出盯梢目标", claimOnPage);
  await shot("02-monitor-list");

  // 6. 立即复查（真实搜索）
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("prism:watch:targets"))[0].snapshots.length,
  );
  await clickByText(page, "button", "立即复查");
  report.steps.push({ level: "info", message: "已点击立即复查，等待真实检索" });

  await page.waitForFunction(
    (n) => {
      const raw = localStorage.getItem("prism:watch:targets");
      if (!raw) return false;
      const t = JSON.parse(raw)[0];
      return t.snapshots.length > n && !!t.lastDiff;
    },
    { timeout: 300_000, polling: 1000 },
    before,
  );
  await sleep(1500);

  const diff = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem("prism:watch:targets"))[0];
    return {
      lastDiff: t.lastDiff,
      snapshotCount: t.snapshots.length,
      lastCheckedAt: t.lastCheckedAt,
    };
  });
  report.diff = diff;
  report.steps.push({
    level: "diff",
    message: `时间窗 ${diff.lastDiff.freshness} 内新增 ${diff.lastDiff.newSources.length} 条来源 / 失败 ${diff.lastDiff.failedCount} 次`,
  });

  check(
    "复查执行了真实搜索",
    diff.snapshotCount === before + 1 && diff.lastDiff.failedCount < diff.lastDiff.searchCount,
    `执行 ${diff.lastDiff.searchCount} 次查询，失败 ${diff.lastDiff.failedCount} 次`,
  );
  check(
    "新增来源均带可点击外链",
    diff.lastDiff.newSources.length === 0 ||
      diff.lastDiff.newSources.every((s) => /^https?:\/\//.test(s.url)),
    `${diff.lastDiff.newSources.length} 条新增来源`,
  );
  if (diff.lastDiff.assessment) {
    report.steps.push({
      level: "assessment",
      message: `增量判断 changed=${diff.lastDiff.assessment.changed}：${diff.lastDiff.assessment.reason}`,
    });
    check(
      "模型对新增证据给出增量判断",
      diff.lastDiff.assessment.reason.length > 0,
      diff.lastDiff.assessment.changed ? "判定足以影响结论" : "判定不足以改变结论",
    );
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await shot("03-monitor-diff");

  report.jsErrors = report.steps.filter((s) => s.level === "pageerror").length;
  check("无页面级 JS 异常", report.jsErrors === 0, `${report.jsErrors} 条`);

  await browser.close();

  fs.writeFileSync(
    path.join(OUT, "watch-record.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );

  const failed = report.checks.filter((c) => !c.ok).length;
  console.log(
    `\n[watch] ${report.checks.length - failed}/${report.checks.length} 项通过 · 输出目录 ${OUT}`,
  );
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("[watch] 失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
