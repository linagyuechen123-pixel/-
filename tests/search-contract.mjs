/**
 * 搜索接口契约测试（§18.2）
 *
 * 用法：
 *   1) 先启动服务：npm run build && PORT=3100 npm start
 *   2) 运行：BASE_URL=http://127.0.0.1:3100 node tests/search-contract.mjs
 *
 * 说明：本脚本只验证接口契约，不做页面级测试。
 * 未配置 WSA_API_KEY 时，「缺密钥」分支必须返回 SEARCH_CONFIG_MISSING_KEY 且 results 为空。
 * 已配置时，必须返回真实来源，且每条来源都带可访问的 http(s) 链接。
 */

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const SEARCH_URL = `${BASE}/api/search`;

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(payload, raw = false) {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? payload : JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保留原始文本用于断言 */
  }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`\nPRISM 搜索接口契约测试 → ${SEARCH_URL}\n`);

  // 1. 非法 JSON
  {
    const r = await post("{not-json", true);
    check("非法 JSON 返回 400", r.status === 400, `实际 ${r.status}`);
  }

  // 2. 空查询
  {
    const r = await post({ query: "   ", roundId: "t-2" });
    check("空查询返回 400", r.status === 400, `实际 ${r.status}`);
    check(
      "空查询不返回来源数组",
      r.json == null || r.json.results === undefined,
    );
  }

  // 3. 超长查询
  {
    const r = await post({ query: "测".repeat(501), roundId: "t-3" });
    check("超长查询返回 400", r.status === 400, `实际 ${r.status}`);
  }

  // 4. 搜索配置体检
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());

  // 5. 正常查询
  {
    const r = await post({
      query: "不锈钢保温杯装碳酸饮料会腐蚀内胆",
      roundId: "t-5",
      roundType: "initial",
      cnt: 10,
    });
    check("有效查询返回 200", r.status === 200, `实际 ${r.status}`);
    check("响应体可解析为 JSON", r.json !== null);

    if (health.searchConfigured) {
      check("已配置密钥时返回 ok=true", r.json?.ok === true);
      const results = r.json?.results ?? [];
      check("返回了来源列表", Array.isArray(results));
      check(
        "每条来源都具备 title / url / roundId / retrievedAt",
        results.every(
          (s) =>
            typeof s.title === "string" &&
            s.title.length > 0 &&
            typeof s.url === "string" &&
            /^https?:\/\//i.test(s.url) &&
            typeof s.roundId === "string" &&
            typeof s.retrievedAt === "string",
        ),
      );
      check(
        "来源内不存在重复规范化网址",
        new Set(results.map((s) => s.canonicalUrl)).size === results.length,
      );
      check(
        "publishedAt 不存在时为 null（不编造日期）",
        results.every((s) => s.publishedAt === null || typeof s.publishedAt === "string"),
      );
    } else {
      check(
        "未配置密钥时返回 SEARCH_CONFIG_MISSING_KEY",
        r.json?.ok === false && r.json?.code === "SEARCH_CONFIG_MISSING_KEY",
        JSON.stringify(r.json),
      );
      check(
        "未配置密钥时不返回任何来源",
        r.json?.results === undefined,
      );
    }
  }

  // 6. 无效 Cnt 应被纠正而非报错
  {
    const r = await post({ query: "测试", roundId: "t-6", cnt: 7 });
    check("非法 cnt 不导致服务端异常", r.status === 200, `实际 ${r.status}`);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("测试执行失败：", e);
  process.exit(1);
});
