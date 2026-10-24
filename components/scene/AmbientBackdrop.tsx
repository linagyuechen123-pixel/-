/**
 * 全站环境背景层
 *
 * 主页面用真正的 3D 藤蔓（components/scene/VineScene），子页面用轻量的 CSS 环境层：
 * 深色虚空 + 顶部冷光 + 底部微光 + 极淡网格 + 缓慢漂移的雾。
 * 不引入 WebGL，避免多个子页面同时开 3D 造成卡顿。
 */

export default function AmbientBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 虚空底色 */}
      <div className="absolute inset-0 bg-[var(--prism-void)]" />

      {/* 顶部冷光：像从很高处漏下来的光 */}
      <div
        className="absolute inset-x-0 -top-[18%] h-[46vh] opacity-70"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 100%, rgba(107,184,255,0.16) 0%, rgba(107,184,255,0) 70%)",
        }}
      />

      {/* 底部微光：来自「深不见底」的藤蔓根部 */}
      <div
        className="absolute inset-x-0 -bottom-[22%] h-[52vh] opacity-80"
        style={{
          background:
            "radial-gradient(65% 100% at 50% 100%, rgba(216,255,117,0.10) 0%, rgba(216,255,117,0) 72%)",
        }}
      />

      {/* 极淡网格：科技感的空间基准 */}
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(244,240,232,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(244,240,232,0.055) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
          maskImage:
            "radial-gradient(120% 90% at 50% 30%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%)",
          WebkitMaskImage:
            "radial-gradient(120% 90% at 50% 30%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* 缓慢漂移的雾：给静态页面一点呼吸 */}
      <div
        className="prism-ambient-mist absolute -inset-x-1/4 top-1/4 h-[60vh] opacity-30"
        style={{
          background:
            "radial-gradient(45% 50% at 50% 50%, rgba(140,180,235,0.14) 0%, rgba(140,180,235,0) 70%)",
        }}
      />

      {/* 底部暗角，把视线压回内容 */}
      <div
        className="absolute inset-x-0 bottom-0 h-[26vh]"
        style={{
          background:
            "linear-gradient(180deg, rgba(9,11,16,0) 0%, rgba(9,11,16,0.86) 100%)",
        }}
      />
    </div>
  );
}
