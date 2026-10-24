/**
 * 全站页面转场。
 * App Router 的 template 会在每次导航时重新挂载，因此这里能稳定触发进入动画，
 * 不必在每个页面里各写一遍。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="prism-page-enter">{children}</div>;
}
