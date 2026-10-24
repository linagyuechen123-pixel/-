/**
 * 演示录屏（截图查证 OCR 流程）
 *
 * 与 demo-record.mjs 相同的定格截图 + ffmpeg 合成方案，
 * 但走的是 /upload 上传 → 浏览器本地 OCR → 确认文本 → 调查 → 报告这条路径。
 *
 * 用法：PRISM_RECORD_OUT=demo/05-演示录屏 node tests/demo-ocr-record.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const WORKSPACE_MODULES =
  "C:/Users/lyc/.workbuddy/binaries/node/workspace/node_modules";
const puppeteer = require(
  path.join(WORKSPACE_MODULES, "puppeteer-core/lib/esm/puppeteer/puppeteer-core.js"),
);

const CHROME =
  process.env.PRISM_CHROME_PATH ||
  "C:\\Users\\lyc\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = "https://prism-evidence.app.workbuddy.host";
const SHARE = "?sharecode=EAKUMP27DH";

const OUT = path.resolve(
  process.env.PRISM_RECORD_OUT ||
    path.join(process.cwd(), "demo", "05-演示录屏"),
);

const CLAIM_TEXT = "微波炉加热塑料饭盒会释放致癌物质";
const CLAIM_SOURCE = "某短视频科普账号";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, selector, texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = (await page.evaluate((el) => el.textContent || "", h)).trim();
    if (list.some((x) => t.includes(x))) {
      await h.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(400);
      await h.click();
      return true;
    }
  }
  return false;
}

/** 用真实 Chrome 渲染一张截图素材（模拟用户提供的公开截图） */
async function makeMaterial(file, browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 560, deviceScaleFactor: 2 });
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
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

if (!fs.existsSync(CHROME)) throw new Error(`未找到 Chrome：${CHROME}`);
fs.mkdirSync(OUT, { recursive: true });

const mp4Path = path.join(OUT, "investigation-ocr.mp4");
const framesDir = path.join(OUT, "frames-ocr");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

let FFMPEG = null;
try {
  FFMPEG = require(path.join(WORKSPACE_MODULES, "ffmpeg-static"));
} catch {
  FFMPEG = null;
}
if (FFMPEG && fs.existsSync(FFMPEG)) {
  process.env.PATH = `${path.dirname(FFMPEG)}${path.delimiter}${process.env.PATH}`;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});

const log = [];
let recording = true;
let captureLoop = Promise.resolve();
let frameList = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  let frameIdx = 0;
  captureLoop = (async () => {
    while (recording) {
      try {
        const p = path.join(framesDir, `${String(++frameIdx).padStart(5, "0")}.jpg`);
        await page.screenshot({ path: p, type: "jpeg", quality: 78 });
        frameList.push(p);
      } catch {
        // 单帧失败不影响整体
      }
      await sleep(900);
    }
  })();

  await page.goto(`${ORIGIN}/${SHARE}`, {
    waitUntil: "networkidle2",
    timeout: 90_000,
  });
  try {
    await page.waitForSelector("#claim-input", { timeout: 90_000 });
  } catch (err) {
    const probe = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyHead: (document.body.innerText || "").slice(0, 400),
    }));
    console.error("首页未就绪，诊断：", JSON.stringify(probe));
    throw err;
  }
  await sleep(1500);
  log.push("t0 打开首页");

  // 素材单独用另一个页面渲染，避免污染录制帧序列
  const material = await makeMaterial(
    path.join(OUT, "00-screenshot-material.png"),
    browser,
  );

  await clickByText(page, "a", "截图查证");
  await page.waitForFunction(() => location.pathname === "/upload", {
    timeout: 60_000,
  });
  await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
  await sleep(800);
  log.push("t1 进入截图查证页");

  const input = await page.$('input[type="file"]');
  await input.uploadFile(material);
  await sleep(1200);
  log.push("t2 上传一张短视频截图");

  await clickByText(page, "button", "提取文字");
  log.push("t3 浏览器本地 OCR 开始识别");

  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea");
      const busy = (document.body.innerText || "").includes("识别中");
      return ta && ta.value.trim().length > 0 && !busy;
    },
    { timeout: 300_000, polling: 1500 },
  );
  await sleep(1500);
  const ocrText = await page.evaluate(
    () => document.querySelector("textarea")?.value ?? "",
  );
  log.push(`t4 OCR 完成：${ocrText.slice(0, 30)}…`);

  await clickByText(page, "button", "确认文本并开始调查");
  await page.waitForFunction(() => location.pathname.startsWith("/investigate/"), {
    timeout: 60_000,
  });

  // 分享门禁会丢 sharecode，补回参数重新落地
  const invUrl = page.url();
  if (!invUrl.includes("sharecode=")) {
    const sep = invUrl.includes("?") ? "&" : "?";
    await page.goto(`${invUrl}${sep}sharecode=EAKUMP27DH`, {
      waitUntil: "networkidle2",
      timeout: 90_000,
    });
  }

  await page.waitForSelector("textarea", { timeout: 150_000 });
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("命题解剖室") &&
      document.querySelectorAll("textarea").length >= 2,
    { timeout: 180_000 },
  );
  await sleep(1500);
  log.push("t5 命题解剖室：识别出的说法被拆成子命题");

  await clickByText(page, "button", "确认范围并开始调查");
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("证据调查室") &&
      /完成|无结果|失败/.test(document.body.innerText),
    { timeout: 240_000 },
  );
  await sleep(1500);
  log.push("t6 证据调查室：多轮真实搜索");

  await page.waitForFunction(() => document.body.innerText.includes("来源列表"), {
    timeout: 360_000,
  });
  await sleep(1800);
  log.push("t7 调查报告与来源列表生成");

  await page.evaluate(async () => {
    const total = document.body.scrollHeight;
    for (let y = 0; y < total; y += 420) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 320));
    }
  });
  await sleep(1500);

  recording = false;
  await captureLoop;
  console.log(`录制结束，共 ${frameList.length} 帧`);
} catch (e) {
  console.error("FATAL", e);
} finally {
  recording = false;
  await browser.close();
}

let ffmpegBin = null;
try {
  ffmpegBin = require(path.join(WORKSPACE_MODULES, "ffmpeg-static"));
} catch {
  ffmpegBin = null;
}

const frameCount = fs.existsSync(framesDir)
  ? fs.readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).length
  : 0;

const meta = {
  claim: CLAIM_TEXT,
  flow: "screenshot-ocr",
  startedAt: new Date().toISOString(),
  origin: ORIGIN,
  log,
  frames: frameCount,
  mp4: null,
  note: "真实 Chrome 驱动公开站点，上传截图 → 本地 OCR → 多轮真实搜索 → 报告，定格截图序列合成，无剪辑、无预置数据。",
};

const { execFileSync } = await import("node:child_process");

if (ffmpegBin && frameCount > 1) {
  try {
    execFileSync(
      ffmpegBin,
      [
        "-y",
        "-framerate", "3",
        "-i", path.join(framesDir, "%05d.jpg"),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-vf", "scale=1440:-2",
        "-movflags", "+faststart",
        mp4Path,
      ],
      { stdio: "pipe" },
    );
    meta.mp4 = path.relative(process.cwd(), mp4Path).replace(/\\/g, "/");
    meta.fps = 3;
    meta.durationSec = Number((frameCount / 3).toFixed(1));
    console.log("MP4 已生成 →", mp4Path);
  } catch (e) {
    meta.ffmpegError = String(e.stderr ?? e).slice(0, 400);
    console.error("转码失败", e.message);
  }
} else {
  meta.ffmpegError = ffmpegBin ? "帧数不足" : "ffmpeg-static 不可用";
}

fs.writeFileSync(
  path.join(OUT, "recording-meta-ocr.json"),
  JSON.stringify(meta, null, 2),
  "utf8",
);

if (meta.mp4) {
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
    console.log("已清理中间帧");
  } catch (e) {
    console.log(`中间帧保留在 ${framesDir}（清理未成功：${String(e.message).slice(0, 80)}）`);
  }
}

const size = (p) =>
  fs.existsSync(p) ? `${(fs.statSync(p).size / 1024 / 1024).toFixed(1)}MB` : "缺失";
console.log("\n=== SUMMARY ===");
log.forEach((l) => console.log(" ", l));
console.log(`帧数: ${frameCount}   mp4: ${size(mp4Path)}  时长约: ${Math.round(frameCount / 3)}s`);
