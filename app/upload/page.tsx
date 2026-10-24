"use client";

/**
 * 截图查证（§4.1 E / §9）
 * - 格式与大小校验（PNG / JPG / JPEG / WebP，≤10MB）
 * - Tesseract.js 在浏览器本地识别，原图不上传服务端（§9.2）
 * - 必须用户确认后才进入调查流程
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker } from "tesseract.js";
import Link from "next/link";
import PageNav from "@/components/nav/PageNav";
import AmbientBackdrop from "@/components/scene/AmbientBackdrop";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const ACCEPTED_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_BYTES = 10 * 1024 * 1024;

type Stage = "idle" | "ocr" | "done" | "error";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [text, setText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (f: File | null) => {
    setError(null);
    setText("");
    setConfidence(null);
    setStage("idle");
    if (!f) {
      setFile(null);
      setPreview(null);
      return;
    }
    const extOk = ACCEPTED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext));
    if (!ACCEPTED.includes(f.type) && !extOk) {
      setError("不支持的文件格式。仅支持 PNG、JPG、JPEG、WebP。");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`图片超过 ${MAX_BYTES / 1024 / 1024} MB 上限，请压缩后重试。`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const runOcr = async () => {
    if (!file) return;
    setBusy(true);
    setStage("ocr");
    setProgress(0);
    setError(null);
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      worker = await createWorker("chi_sim+eng", 1, {
        logger: (m: { status?: string; progress?: number }) => {
          if (m.progress != null) setProgress(Math.round(m.progress * 100));
        },
      });
      const { data } = await worker.recognize(file);
      const recognized = (data.text ?? "").trim();
      setText(recognized);
      setConfidence(typeof data.confidence === "number" ? data.confidence : null);
      setStage("done");
      if (recognized.length === 0) {
        setStage("error");
        setError("未能从图片中识别出文字。你可以在下方手动输入需要核验的内容。");
      }
    } catch (e) {
      setStage("error");
      setError(
        `OCR 执行失败：${e instanceof Error ? e.message : String(e)}。请改用手动输入。`,
      );
    } finally {
      if (worker) await worker.terminate().catch(() => {});
      setBusy(false);
    }
  };

  const startInvestigation = () => {
    const claim = text.trim();
    if (claim.length === 0) {
      setError("请先写出需要核验的说法（OCR 结果或手动输入均可）。");
      return;
    }
    if (claim.length > 300) {
      setError("待核验内容请控制在 300 字以内。");
      return;
    }
    const id = `INV-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    sessionStorage.setItem(
      `prism:draft:${id}`,
      JSON.stringify({
        claim,
        origin: "screenshot",
        imagePreview: preview,
        ocrText: claim,
      }),
    );
    router.push(`/investigate/${id}`);
  };

  return (
    <main className="relative mx-auto w-full max-w-[1000px] px-6 py-8 md:px-8">
      <AmbientBackdrop />
      <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <PageNav />
        <Link href="/" className="flex items-baseline gap-3">
          <span className="display-serif text-[20px] tracking-[0.18em]">PRISM</span>
          <span className="label-en">Evidence Observatory</span>
        </Link>
        <span className="label-en ml-auto">Screenshot intake</span>
      </header>

      <h1 className="display-serif text-[clamp(1.8rem,4vw,2.6rem)]">截图查证</h1>
      <p className="mt-3 max-w-[70ch] text-[14px] leading-[1.85] text-[var(--prism-silver)]">
        上传一张公开截图，系统会提取其中的文字。识别结果必须经过你的确认和修正后才会进入调查流程——OCR 文本本身不被视为已核验事实。图片在浏览器本地处理，不会上传到服务端。
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="glass-panel p-5">
          <div className="label-en">图片 / Image</div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => inputRef.current?.click()}
            className="mt-3 flex min-h-[180px] cursor-pointer flex-col items-center justify-center border border-dashed border-[var(--prism-hairline-strong)] px-4 py-6 text-center transition-colors hover:border-[var(--prism-accent)]"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="用户上传截图预览"
                className="max-h-[220px] w-auto"
              />
            ) : (
              <p className="text-[13px] text-[var(--prism-silver-dim)]">
                点击选择图片，或拖拽到此处
                <br />
                支持 PNG / JPG / JPEG / WebP，单张 ≤ 10 MB
              </p>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="hidden"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runOcr}
              disabled={!file || busy}
              className="border border-[var(--prism-accent)] bg-[var(--prism-accent)] px-5 py-2.5 text-[13px] text-[var(--prism-void)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:border-[var(--prism-hairline)] disabled:bg-transparent disabled:text-[var(--prism-silver-dim)]"
            >
              {busy ? `识别中 ${progress}%` : "提取文字 / OCR"}
            </button>
            {file ? (
              <button
                type="button"
                onClick={() => pick(null)}
                className="border border-[var(--prism-hairline)] px-5 py-2.5 text-[13px] text-[var(--prism-silver)] hover:border-[#ff6b6b] hover:text-[#ff6b6b]"
              >
                移除图片
              </button>
            ) : null}
          </div>

          {file ? (
            <p className="mt-3 text-[12px] text-[var(--prism-silver-dim)]">
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          ) : null}
        </section>

        <section className="glass-panel p-5">
          <div className="flex items-center justify-between">
            <span className="label-en">识别文本 / OCR text</span>
            {stage === "ocr" ? <span className="label-en">{progress}%</span> : null}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            maxLength={2000}
            placeholder="OCR 结果会出现在这里；也可以直接手动粘贴需要核验的文字。"
            className="mt-3 w-full resize-y border border-[var(--prism-hairline)] bg-transparent p-3 text-[14px] leading-[1.8] outline-none focus:border-[var(--prism-accent)]"
          />

          {confidence != null ? (
            <p className="mt-2 text-[12px] text-[var(--prism-silver-dim)]">
              OCR 置信度 {confidence.toFixed(1)}%（仅表示识别清晰度，不代表文字内容的真实程度）
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 text-[13px] text-[#ff6b6b]">{error}</p>
          ) : null}

          <button
            type="button"
            onClick={startInvestigation}
            disabled={text.trim().length === 0}
            className="mt-5 w-full border border-[var(--prism-accent)] bg-[var(--prism-accent)] px-5 py-3 text-[13px] uppercase tracking-[0.14em] text-[var(--prism-void)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:border-[var(--prism-hairline)] disabled:bg-transparent disabled:text-[var(--prism-silver-dim)]"
          >
            确认文本并开始调查
          </button>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--prism-silver-dim)]">
            确认后，这段文本会被当作待核验的原始说法进入标准调查流程：拆分子命题 → 多轮真实搜索 → 证据整理 → 生成可追溯报告。
          </p>
        </section>
      </div>
    </main>
  );
}
