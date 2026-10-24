/**
 * 演示录屏：真实 Chrome 驱动线上站点，完整走一次调查全流程。
 *
 * 与截图不同，录屏能证明「搜索是实时发生的」而非静态图片。
 * 产出 WebM → 用 ffmpeg-static 转 MP4。
 *
 * 用法：node tests/demo-record.mjs "<待核验说法>"
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

const claim = process.argv[2] || "不锈钢保温杯装碳酸饮料会腐蚀内胆";
const OUT = path.resolve(
  process.env.PRISM_RECORD_OUT ||
    path.join(process.cwd(), "demo", "05-演示录屏"),
);

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

if (!fs.existsSync(CHROME)) throw new Error(`未找到 Chrome：${CHROME}`);
fs.mkdirSync(OUT, { recursive: true });

const mp4Path = path.join(OUT, "investigation.mp4");
const framesDir = path.join(OUT, "frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

// puppeteer 的 screencast 内部直接 spawn "ffmpeg"，平台上没有系统级 ffmpeg，
// 这里把 ffmpeg-static 提供的可执行文件所在目录注入 PATH，让它能被找到。
let FFMPEG = null;
try {
  FFMPEG = require(path.join(WORKSPACE_MODULES, "ffmpeg-static"));
} catch {
  FFMPEG = null;
}
if (FFMPEG && fs.existsSync(FFMPEG)) {
  process.env.PATH = `${path.dirname(FFMPEG)}${path.delimiter}${process.env.PATH}`;
  console.log("ffmpeg →", FFMPEG);
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

/** 失败时把页面真实状态 dump 出来，便于定位，而不是只留一句超时 */
async function dumpState(page, label) {
  try {
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      textarea: document.querySelectorAll("textarea").length,
      bodyHead: (document.body.innerText || "").slice(0, 600),
    }));
    console.error(`\n--- 诊断 @${label} ---`);
    console.error(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error("诊断失败", e.message);
  }
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // 不用 puppeteer 的 screencast（实测会拖垮页面、导致点击进入调查后子命题迟迟不出现）；
  // 改为定格截图序列 + ffmpeg 合成，稳定性由主流程自己保证。
  let frameIdx = 0;
  let failCount = 0;
  captureLoop = (async () => {
    while (recording) {
      try {
        const p = path.join(
          framesDir,
          `${String(++frameIdx).padStart(5, "0")}.jpg`,
        );
        await page.screenshot({ path: p, type: "jpeg", quality: 78 });
        frameList.push(p);
        if (frameList.length % 30 === 0) console.log(`  帧 ${frameList.length}`);
      } catch (err) {
        failCount += 1;
        if (failCount <= 3) console.error("截图失败:", err.message);
      }
      await sleep(900);
    }
  })();

  log.push(`t0 打开首页`);

  await page.goto(`${ORIGIN}/${SHARE}`, {
    waitUntil: "networkidle2",
    timeout: 90_000,
  });
  await page.waitForSelector("#claim-input", { timeout: 60_000 });
  await sleep(2000);

  await page.type("#claim-input", claim, { delay: 45 });
  await sleep(1400);
  log.push(`t1 输入命题「${claim}」`);

  await clickByText(page, "button", "启动调查");
  await page.waitForFunction(
    () => location.pathname.startsWith("/investigate/"),
    { timeout: 60_000 },
  );

  // 平台分享门禁在站内跳转时会丢掉 sharecode，调查页会被网关 403 成「链接不完整」。
  // 草稿已存在 sessionStorage，补回参数重新落地同一 URL，流程即可完整衔接。
  const invUrl = page.url();
  if (!invUrl.includes("sharecode=")) {
    const sep = invUrl.includes("?") ? "&" : "?";
    log.push("t2b 站内跳转丢了 sharecode，带参数重新落地调查页");
    await page.goto(`${invUrl}${sep}sharecode=EAKUMP27DH`, {
      waitUntil: "networkidle2",
      timeout: 90_000,
    });
  }

  // 命题解剖室：等子命题 textarea 出现（含 LLM 拆分耗时，给足 150s）
  try {
    await page.waitForSelector("textarea", { timeout: 120_000 });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("命题解剖室") &&
        document.querySelectorAll("textarea").length >= 2,
      { timeout: 150_000 },
    );
  } catch (e) {
    await dumpState(page, "子命题未出现");
    throw e;
  }
  await sleep(1800);
  log.push("t2 命题解剖室：查看自动拆分的子命题");

  await clickByText(page, "button", "确认范围并开始调查");
  log.push("t3 进入证据调查室，开始多轮真实搜索");

  // 第一轮搜索结果出现
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("证据调查室") &&
      /完成|无结果|失败/.test(document.body.innerText),
    { timeout: 200_000 },
  );
  await sleep(1500);

  // 报告与来源列表（整轮多轮搜索，上限 300s）
  await page.waitForFunction(
    () => document.body.innerText.includes("来源列表"),
    { timeout: 300_000 },
  );
  await sleep(1800);
  log.push("t4 多轮搜索完成，调查报告与来源列表已生成");

  // 缓慢滚动报告，让来源列表进入画面
  await page.evaluate(async () => {
    const total = document.body.scrollHeight;
    for (let y = 0; y < total; y += 420) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 320));
    }
  });
  log.push("t5 滚动展示证据与来源列表");
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

// 转 MP4
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
  claim,
  startedAt: new Date().toISOString(),
  origin: ORIGIN,
  log,
  frames: frameCount,
  mp4: null,
  note: "真实 Chrome 驱动公开站点，定格截图序列合成视频，无剪辑、无预置数据。",
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

// 先落盘元信息，再做清理：清理失败（如沙箱批量删除守卫）不影响任何产物
fs.writeFileSync(
  path.join(OUT, "recording-meta.json"),
  JSON.stringify(meta, null, 2),
  "utf8",
);

if (meta.mp4) {
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
    console.log("已清理中间帧");
  } catch (e) {
    console.log(`中间帧保留在 ${framesDir}（自动清理未成功：${e.message?.slice(0, 80)}）`);
  }
}

const size = (p) => (fs.existsSync(p) ? `${(fs.statSync(p).size / 1024 / 1024).toFixed(1)}MB` : "缺失");
console.log("\n=== SUMMARY ===");
log.forEach((l) => console.log(" ", l));
console.log(`帧数: ${frameCount}   mp4: ${size(mp4Path)}  时长约: ${Math.round(frameCount / 3)}s`);
