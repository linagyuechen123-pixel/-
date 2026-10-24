/**
 * PRISM 截图查证（OCR）真实流程演示采集
 *
 * 流程（§5.2 / §9）：
 *   1. 用 Chrome 渲染一张真实可 OCR 的截图素材（作为用户输入，不参与任何结论）
 *   2. 打开部署站点的 /upload 页
 *   3. 上传图片 → 浏览器本地 Tesseract OCR → 用户确认文本 → 进入标准调查流程
 *   4. 产出真实截图与调查记录 JSON
 *
 * 用法：node tests/demo-ocr-capture.mjs
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

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

const CLAIM_TEXT = "微波炉加热塑料饭盒会释放致癌物质";
const CLAIM_SOURCE = "某短视频科普账号";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shot(page, file) {
  return page.screenshot({ path: file, fullPage: false });
}

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

/** 用真实 Chrome 渲染一张截图素材（模拟用户提供的公开截图） */
async function makeMaterial(file) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    defaultViewport: { width: 720, height: 560, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:720px; height:560px; background:#f7f7f5; font-family:"Microsoft YaHei","PingFang SC",sans-serif; padding:44px 40px; }
    .avatar { width:44px; height:44px; border-radius:50%; background:#3d6fe0; color:#fff; font-size:20px; display:flex; align-items:center; justify-content:center; }
    .name { display:inline-block; margin-left:12px; font-size:17px; font-weight:600; color:#1c1c1c; vertical-align:middle; }
    .time { margin-left:12px; font-size:12px; color:#9a9a9a; vertical-align:middle; }
    .bubble { margin-top:20px; background:#ffffff; border-radius:10px; padding:26px 24px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
    .bubble p { font-size:22px; line-height:1.9; color:#222; }
    .foot { margin-top:26px; font-size:13px; color:#a0a0a0; }
  </style></head><body>
    <div><span class="avatar">科</span><span class="name">${CLAIM_SOURCE}</span><span class="time">10-22 21:14</span></div>
    <div class="bubble"><p>${CLAIM_TEXT}。塑料中的增塑剂和稳定剂在高温下会析出，长期如此对身体伤害很大，看完赶紧转发给家里人。</p></div>
    <p class="foot">转发 1.2 万 · 评论 834 · 赞 5.6 万</p>
  </body></html>`;
  await page.setContent(html, { waitUntil: "networkidle0" });
  await sleep(300);
  await shot(page, file);
  await browser.close();
  return file;
}

async function run() {
  if (!fs.existsSync(CHROME)) throw new Error(`未找到 Chrome：${CHROME}`);
  const dir = path.join(OUT, "03-截图查证-OCR");
  fs.mkdirSync(dir, { recursive: true });

  const report = { claim: CLAIM_TEXT, steps: [], screenshots: [] };

  // 1. 生成截图素材（这是"用户上传的图片"，不是系统产物）
  const material = await makeMaterial(path.join(dir, "00-screenshot-material.png"));
  report.screenshots.push(material);
  report.steps.push({ level: "info", message: `已生成截图素材 ${material}` });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    defaultViewport: { width: 1440, height: 950, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => report.steps.push({ level: "pageerror", message: String(e) }));

  const origin = BASE.replace(/\?.*$/, "").replace(/\/+$/, "");
  // 平台的分享门禁要求首个请求带 sharecode；先落地首页取得访问授权，
  // 之后的站内跳转与文本流程一致，不再重复携带参数。
  await page.goto(`${origin}/?sharecode=EAKUMP27DH`, {
    waitUntil: "networkidle2",
    timeout: 90_000,
  });
  await page.waitForSelector("#claim-input", { timeout: 60_000 });
  // 通过站内链接进入截图查证页（与真实用户路径一致）
  await clickByText(page, "a", "截图查证");
  await page.waitForFunction(() => location.pathname === "/upload", { timeout: 60_000 });
  await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
  report.screenshots.push(await shot(page, path.join(dir, "01-upload.png")));

  const input = await page.$('input[type="file"]');
  await input.uploadFile(material);
  await sleep(600);

  await clickByText(page, "button", "提取文字");
  report.steps.push({ level: "info", message: "OCR 已启动（浏览器本地 Tesseract）" });

  // 等待 OCR 完成：textarea 出现非空内容，且按钮不再显示「识别中」
  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea");
      const busy = (document.body.innerText || "").includes("识别中");
      return ta && ta.value.trim().length > 0 && !busy;
    },
    { timeout: 240_000, polling: 1500 },
  );
  await sleep(500);
  report.ocrText = await page.evaluate(
    () => document.querySelector("textarea")?.value ?? "",
  );
  report.screenshots.push(await shot(page, path.join(dir, "02-ocr.png")));

  // 用户确认：直接使用 OCR 识别文本（保持未经人工改写，体现真实流程）
  await clickByText(page, "button", "确认文本并开始调查");
  await page.waitForFunction(() => location.pathname.startsWith("/investigate/"), {
    timeout: 60_000,
  });

  // 平台的分享门禁在站内跳转时会丢掉 sharecode，导致调查页被拦截。
  // 草稿保存在 sessionStorage 中，这里补回参数重新落地同一调查页，流程完整衔接。
  const invUrl = page.url();
  const sep = invUrl.includes("?") ? "&" : "?";
  await page.goto(`${invUrl}${sep}sharecode=EAKUMP27DH`, {
    waitUntil: "networkidle2",
    timeout: 90_000,
  });

  try {
    await page.waitForSelector("textarea", { timeout: 120_000 });
  } catch (e) {
    const probe = await page.evaluate(() => ({
      url: location.href,
      text: (document.body.innerText || "").slice(0, 600),
      draftKeys: Object.keys(sessionStorage),
    }));
    await shot(page, path.join(dir, "debug-no-claims.png"));
    report.steps.push({ level: "error", message: JSON.stringify(probe) });
    fs.writeFileSync(path.join(dir, "record.json"), JSON.stringify(report, null, 2), "utf-8");
    throw new Error(`未进入命题解剖室：${JSON.stringify(probe)}`);
  }
  await page.waitForFunction(
    () => document.body.innerText.includes("命题解剖室") && document.querySelectorAll("textarea").length >= 2,
    { timeout: 150_000 },
  );
  await sleep(500);
  report.claims = await page.evaluate(() =>
    Array.from(document.querySelectorAll("textarea")).map((t) => t.value),
  );
  report.screenshots.push(await shot(page, path.join(dir, "03-claims.png")));

  await clickByText(page, "button", "确认范围并开始调查");
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("证据调查室") &&
      /完成|无结果|失败/.test(document.body.innerText),
    { timeout: 200_000 },
  );
  await sleep(1200);
  report.screenshots.push(await shot(page, path.join(dir, "04-searching.png")));

  await page.waitForFunction(() => document.body.innerText.includes("来源列表"), {
    timeout: 300_000,
  });
  await sleep(1500);
  report.screenshots.push(await shot(page, path.join(dir, "05-report-top.png")));

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
    report.screenshots.push(await shot(page, path.join(dir, "06-sources.png")));
  }

  report.bundle = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith("prism:bundle:") || k.startsWith("prism:investigation:"),
    );
    return key ? JSON.parse(localStorage.getItem(key) || "null") : null;
  });

  fs.writeFileSync(path.join(dir, "record.json"), JSON.stringify(report, null, 2), "utf-8");
  await browser.close();

  const b = report.bundle;
  console.log(
    `[ocr-demo] 「${CLAIM_TEXT}」 完成：OCR=${report.ocrText ? "成功" : "失败"} / ${b?.rounds?.length ?? 0} 轮搜索 / ${b?.sources?.length ?? 0} 条来源 / 结论=${b?.report?.resultStatus ?? "n/a"}`,
  );
}

run().catch((e) => {
  console.error("[ocr-demo] 失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
