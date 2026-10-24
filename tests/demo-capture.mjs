/**
 * PRISM 真实查询演示采集脚本
 *
 * 用途（§22.3）：驱动真实 Chrome 访问已部署站点，完成一次完整调查流程，
 * 并产出真实截图 + 真实调查记录 JSON。全程使用真实搜索接口，无任何静态数据。
 *
 * 用法：
 *   NODE_PATH=<puppeteer 安装目录>/node_modules node tests/demo-capture.mjs
 *
 * 依赖：puppeteer-core（仅用于驱动本机 Chrome，不随项目发布）
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

/**
 * puppeteer-core 不进项目依赖（§21.5：不为单个用途引入项目级依赖）。
 * 默认从 WorkBuddy 托管的 node workspace 加载，也可由 PUPPETEER_PATH 覆盖。
 */
const require_ = createRequire(import.meta.url);
const puppeteer = require_(
  process.env.PUPPETEER_PATH ||
    "C:/Users/lyc/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core",
);

const BASE =
  process.env.PRISM_BASE_URL ||
  "https://prism-evidence.app.workbuddy.host/?sharecode=EAKUMP27DH";
const CHROME =
  process.env.PRISM_CHROME_PATH ||
  "C:\\Users\\lyc\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const OUT = process.env.PRISM_DEMO_OUT || path.resolve("demo");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(s, i) {
  const safe = s.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 24);
  return `${String(i + 1).padStart(2, "0")}-${safe}`;
}

/** 页面里所有可点击元素中找出文案包含目标文本的按钮 */
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

async function shot(page, file) {
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function run() {
  if (!fs.existsSync(CHROME)) {
    throw new Error(`未找到 Chrome：${CHROME}`);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    defaultViewport: { width: 1440, height: 950, deviceScaleFactor: 2 },
  });

  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    throw new Error("请提供待核验说法作为命令行参数。");
  }

  const index = Number(process.env.PRISM_DEMO_INDEX || "0");
  const dir = path.join(OUT, slugify(query, index));
  fs.mkdirSync(dir, { recursive: true });
  const report = { query, steps: [], screenshots: [] };

  const page = await browser.newPage();
  page.on("pageerror", (e) => report.steps.push({ level: "pageerror", message: String(e) }));
  page.on("console", (m) => {
    if (m.type() === "error") report.steps.push({ level: "console", message: m.text() });
  });

  report.steps.push({ level: "info", message: `打开 ${BASE}` });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector("#claim-input", { timeout: 60_000 });

  // 首页：确认搜索服务状态条（带上当前链接参数，避免分享门禁拦截）
  const health = await page.evaluate(async () => {
    const r = await fetch(`/api/health${location.search}`);
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return { searchConfigured: false, raw: text.slice(0, 120) };
    }
  });
  report.searchConfigured = health.searchConfigured;
  report.steps.push({
    level: "health",
    message: `searchConfigured=${health.searchConfigured}${health.raw ? ` raw=${health.raw}` : ""}`,
  });
  if (!health.searchConfigured) throw new Error("服务端未配置搜索密钥，无法产生真实演示。");

  await page.type("#claim-input", query, { delay: 12 });
  await sleep(300);
  report.screenshots.push(await shot(page, path.join(dir, "01-home.png")));

  await clickByText(page, "button", "启动调查");
  await page.waitForFunction(
    () => location.pathname.startsWith("/investigate/"),
    { timeout: 60_000 },
  );
  report.steps.push({ level: "info", message: `进入 ${await page.url()}` });

  // 命题解剖室：等待子命题 textarea 出现
  await page.waitForSelector("textarea", { timeout: 120_000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("命题解剖室") &&
      document.querySelectorAll("textarea").length >= 2,
    { timeout: 150_000 },
  );
  await sleep(500);
  report.claims = await page.evaluate(() =>
    Array.from(document.querySelectorAll("textarea")).map((t) => t.value),
  );
  report.mode = await page.evaluate(() =>
    document.body.innerText.includes("规则化降级") ? "rule" : "model",
  );
  report.screenshots.push(await shot(page, path.join(dir, "02-claims.png")));

  await clickByText(page, "button", "确认范围并开始调查");

  // 证据调查室：等到至少出现 1 个已完成轮次
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("证据调查室") &&
      /完成|无结果|失败/.test(document.body.innerText),
    { timeout: 200_000 },
  );
  await sleep(1200);
  report.screenshots.push(await shot(page, path.join(dir, "03-searching.png")));

  // 报告页
  await page.waitForFunction(() => document.body.innerText.includes("来源列表"), {
    timeout: 300_000,
  });
  await sleep(1500);
  report.screenshots.push(await shot(page, path.join(dir, "04-report-top.png")));

  const sourcesBox = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("h2"));
    const found = nodes.find((n) => (n.textContent || "").includes("来源列表"));
    if (!found) return null;
    const r = found.getBoundingClientRect();
    return { y: window.scrollY + r.top - 120 };
  });
  if (sourcesBox) {
    await page.evaluate((y) => window.scrollTo(0, y), sourcesBox.y);
    await sleep(600);
    report.screenshots.push(await shot(page, path.join(dir, "05-sources.png")));
  }

  // 抽出真实调查记录，用于交叉验证：所有来源必须有真实 url
  const bundle = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith("prism:bundle:") || k.startsWith("prism:investigation:"),
    );
    if (!key) return null;
    return JSON.parse(localStorage.getItem(key) || "null");
  });

  if (bundle) {
    report.bundle = bundle;
  }

  fs.writeFileSync(
    path.join(dir, "record.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );

  await browser.close();

  const srcCount = report.bundle?.sources?.length ?? 0;
  const roundCount = report.bundle?.rounds?.length ?? 0;
  const status = report.bundle?.report?.resultStatus ?? "n/a";
  console.log(
    `[demo] 「${query}」 完成：${roundCount} 轮搜索 / ${srcCount} 条去重来源 / 结论=${status} / 模式=${report.mode}`,
  );
  console.log(`[demo] 输出目录：${dir}`);
}

run().catch((e) => {
  console.error("[demo] 失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
