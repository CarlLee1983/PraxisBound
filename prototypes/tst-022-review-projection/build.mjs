// PROTOTYPE — 拋棄式。依 Q1–Q21 以需求為主軸的 Review Projection，
// 三種結構不同的呈現，以 ?variant=A|B|C 切換：
//   A 編輯式長文、B 總覽矩陣＋逐條展開、C Spec／Story 並排對照。
// 讀取真實 BR-TST-022 批次來源；不是產品程式碼，不做錯誤處理。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = process.argv[2];
const OUT = process.argv[3];
const read = (p) => readFileSync(join(REPO, p), "utf8");

// 範例導言（Q15 的 Review Preface；真實批次尚無此欄位）
const PREFACE =
  "本批次交付整批審閱的前兩步：先把選定文件建成可追溯的來源索引（R-002），再把索引投影成離線可讀的 HTML 審閱版（R-003）。請優先確認 R-003 的**需求驗收**與 TST-022 的**執行驗收**是否一致。";

const BATCH = {
  id: "BR-TST-022",
  title: "整批審閱：來源索引與 HTML 審閱版",
  fingerprint: "9ce346291036b25bcb610b4c15b64b38eb46fae55eecd495a5a8562cb6cda3e4",
  adrs: ["specs/decisions/ADR-014-batch-review-is-projection-and-proposal-not-authority.md"],
  spec: "specs/features/batch-review/spec.md",
  stories: {
    "TST-021": "specs/stories/TST-021-batch-review-source-index",
    "TST-022": "specs/stories/TST-022-batch-review-render",
  },
  requirements: [
    { anchor: "R-002", stories: ["TST-021"] },
    { anchor: "R-003", stories: ["TST-022"] },
  ],
};

// ---------- Markdown 子集 ----------
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
    /^https?:\/\//.test(u) ? `<a href="${u}">${t}</a>` : `<span class="ref" title="${u}">${t}</span>`,
  );
  return out;
}
const joinLines = (lines) =>
  lines.reduce((acc, l) => {
    const t = l.trim();
    if (!acc) return t;
    return /[\x21-\x7e]$/.test(acc) && /^[\x21-\x7e]/.test(t) ? `${acc} ${t}` : acc + t;
  }, "");

function md(src, shift = 0) {
  const lines = src.replace(/\s+$/, "").split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(`<pre class="code"><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = Math.min(6, h[1].length + shift);
      html.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, , ...body] = rows;
      html.push(
        `<div class="table-scroll"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+/;
    if (li.test(line)) {
      const ordered = /\d+\./.test(line.match(li)[2]);
      const items = [];
      while (i < lines.length && (li.test(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length))) {
        if (li.test(lines[i])) items.push([lines[i].replace(li, "")]);
        else items[items.length - 1].push(lines[i]);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${items
          .map((it) => {
            const text = joinLines(it).replace(/^\[ \]\s*/, "☐ ").replace(/^\[x\]\s*/i, "☑ ");
            return `<li>${inline(text)}</li>`;
          })
          .join("")}</${tag}>`,
      );
      continue;
    }
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    html.push(`<p>${inline(joinLines(para))}</p>`);
  }
  return html.join("\n");
}

// ---------- 來源切分 ----------
function sections(src, level) {
  const re = new RegExp(`^${"#".repeat(level)}\\s+(.*)$`);
  const out = [];
  let cur = { title: null, lines: [] };
  let inFence = false;
  for (const l of src.split("\n")) {
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(re);
    if (m) { out.push(cur); cur = { title: m[1].trim(), lines: [] }; }
    else cur.lines.push(l);
  }
  out.push(cur);
  return out.map((s) => ({ title: s.title, body: s.lines.join("\n").trim() }));
}

const specSrc = read(BATCH.spec);
const specTop = sections(specSrc, 2);
const specGoal = specTop.find((s) => s.title?.startsWith("目標"));
const specNonGoals = specTop.find((s) => s.title?.includes("非目標"));
const specR = Object.fromEntries(
  specTop.filter((s) => /^R-\d+/.test(s.title ?? "")).map((s) => {
    const id = s.title.match(/^R-\d+/)[0];
    const subs = Object.fromEntries(sections(s.body, 3).filter((x) => x.title).map((x) => [x.title, x.body]));
    return [id, { id, title: s.title.replace(/^R-\d+[：:]\s*/, ""), subs }];
  }),
);
const specOther = specTop.filter(
  (s) => s.title && s !== specGoal && s !== specNonGoals && !/^R-\d+/.test(s.title),
);

function acList(body) {
  const acs = [];
  for (const l of body.split("\n")) {
    const m = l.match(/^[-*]\s+(?:\[[ x]\]\s+)?(AC-\d+)[：:]\s*(.*)$/);
    if (m) acs.push({ id: m[1], text: [m[2]] });
    else if (/^\s+\S/.test(l) && acs.length) acs[acs.length - 1].text.push(l);
  }
  return acs.map((a) => ({ id: a.id, text: joinLines(a.text) }));
}

const FOCUS = ["Goal", "Scope", "Rules", "Expected Errors", "Constraints"];
const stories = Object.fromEntries(
  Object.entries(BATCH.stories).map(([id, dir]) => {
    const s = read(`${dir}/story.md`);
    const a = read(`${dir}/acceptance.md`);
    const secs = sections(s, 2).filter((x) => x.title);
    const acSecs = sections(a, 2).filter((x) => x.title);
    const acGroups = acSecs.filter((x) => /^AC-|\bAC-\d+/.test(x.body) && acList(x.body).length);
    return [
      id,
      {
        id,
        dir,
        title: s.match(/^#\s+Story:\s*(.*)$/m)[1],
        focus: FOCUS.map((f) => secs.find((x) => x.title === f)).filter(Boolean),
        rest: secs.filter((x) => !FOCUS.includes(x.title)),
        acGroups: acGroups.map((g) => ({ title: g.title, acs: acList(g.body) })),
        acRest: acSecs.filter((x) => !acGroups.includes(x)),
      },
    ];
  }),
);

const adrs = BATCH.adrs.map((p) => {
  const src = read(p);
  return {
    path: p,
    title: src.match(/^#\s+(.*)$/m)[1],
    status: (src.match(/^\*\s+Status:\s*(.*)$/m) ?? [, "unknown"])[1],
    body: src.replace(/^#\s+.*\n/, ""),
  };
});

const FOCUS_ZH = { Goal: "目標", Scope: "範圍", Rules: "規則", "Expected Errors": "預期錯誤", Constraints: "限制" };
const docBadge = (p) => `<span class="doc">${esc(p)}</span>`;
const reqs = BATCH.requirements.map((r) => ({ ...r, spec: specR[r.anchor] }));
const firstOwner = {};
for (const r of reqs) for (const s of r.stories) firstOwner[s] ??= r.anchor;

// ---------- 共用片段 ----------
function summary() {
  const need = reqs
    .map(
      (r) =>
        `<li><a href="#req-${r.anchor}"><b>${r.anchor}</b> ${esc(r.spec.title)}</a><span class="muted"> → ${r.stories
          .map((s) => `${s}（執行驗收 ${stories[s].acGroups.flatMap((g) => g.acs).length} 條）`)
          .join("、")}；需求驗收 ${acList(r.spec.subs["驗收條件"] ?? "").length} 條</span></li>`,
    )
    .join("");
  return `
  <header class="cover">
    <p class="kicker">離線閱讀快照 · 非核准、非驗收紀錄</p>
    <h1>${esc(BATCH.title)}</h1>
    <p class="muted">批次 ${BATCH.id} · Requirement Fingerprint <code class="fp">${BATCH.fingerprint.slice(0, 12)}…</code></p>
    <section class="preface"><h2>審閱導言</h2><p class="label">由批次作者撰寫（Review Preface）</p>${md(PREFACE)}</section>
    <section><h2>批次目標</h2>${docBadge(`${BATCH.spec} › ${specGoal.title}`)}${md(specGoal.body)}</section>
    <section><h2>本批需求</h2><ul class="reqlist">${need}</ul></section>
    <section><h2>不包含</h2>${docBadge(`${BATCH.spec} › ${specNonGoals.title}`)}${md(specNonGoals.body)}</section>
    <section><h2>決策約束</h2><ul>${adrs.map((a) => `<li><a href="#adr-${esc(a.path)}">${esc(a.title)}</a> <span class="status">${esc(a.status)}</span></li>`).join("")}</ul></section>
    <section class="diag-summary"><h2>診斷</h2><p>阻擋 0 · 提示 17（<a href="#diagnostics">見文末</a>）</p></section>
  </header>`;
}

function acTable(acs, prefix, cls) {
  return `<ol class="acs ${cls}">${acs.map((a) => `<li><span class="acid">${prefix}/${a.id}</span><span>${inline(a.text)}</span></li>`).join("")}</ol>`;
}
function reqAcs(r) {
  return acTable(acList(r.spec.subs["驗收條件"] ?? ""), r.anchor, "req-ac");
}
function storyAcs(sid) {
  return stories[sid].acGroups
    .map((g) => `<h5 class="acgroup">${esc(g.title)}</h5>${acTable(g.acs, sid, "exec-ac")}`)
    .join("");
}
function storyFocus(sid, shift = 3) {
  return stories[sid].focus
    .map((f) => `<div class="focus"><h4>${FOCUS_ZH[f.title]} <span class="en">${f.title}</span></h4>${md(f.body, shift)}</div>`)
    .join("");
}
function reqDetails(r) {
  const extra = Object.entries(r.spec.subs).filter(([k]) => !["目標", "驗收條件", "不包含"].includes(k));
  return extra.map(([k, v]) => `<h4>${esc(k)}</h4>${md(v, 3)}`).join("");
}

function appendix() {
  const restStory = Object.values(stories)
    .map(
      (s) => `<details class="doc-rest"><summary>${esc(s.dir)}/story.md 其餘章節（${s.rest.map((x) => x.title).join("、")}）</summary>
      ${s.rest.map((x) => `<h4>${esc(x.title)}</h4>${md(x.body, 3)}`).join("")}</details>
      <details class="doc-rest"><summary>${esc(s.dir)}/acceptance.md 其餘章節（${s.acRest.map((x) => x.title).join("、")}）</summary>
      ${s.acRest.map((x) => `<h4>${esc(x.title)}</h4>${md(x.body, 3)}`).join("")}</details>`,
    )
    .join("");
  const unbatched = Object.values(specR).filter((r) => !BATCH.requirements.some((x) => x.anchor === r.id));
  return `<section class="appendix" id="appendix"><h2>附錄</h2>
    ${adrs.map((a) => `<details class="doc-rest" id="adr-${esc(a.path)}"><summary>${esc(a.title)}（全文）</summary>${md(a.body, 1)}</details>`).join("")}
    <details class="doc-rest"><summary>${esc(BATCH.spec)} 其餘章節（${specOther.map((s) => s.title).join("、")}）</summary>
      ${specOther.map((s) => `<h4>${esc(s.title)}</h4>${md(s.body, 3)}`).join("")}</details>
    <details class="doc-rest"><summary>${esc(BATCH.spec)} 中本批未納入的需求（${unbatched.map((r) => r.id).join("、")}）</summary>
      ${unbatched.map((r) => `<h4>${r.id} ${esc(r.title)}</h4>${Object.entries(r.subs).map(([k, v]) => `<h5>${esc(k)}</h5>${md(v, 4)}`).join("")}`).join("")}</details>
    ${restStory}
    <details class="raw no-print"><summary>原始 Markdown（不列印）</summary>
      ${[BATCH.spec, ...BATCH.adrs, ...Object.values(BATCH.stories).flatMap((d) => [`${d}/story.md`, `${d}/acceptance.md`])]
        .map((p) => `<h4>${esc(p)}</h4><pre class="code"><code>${esc(read(p))}</code></pre>`)
        .join("")}</details>
    <details class="doc-rest" id="diagnostics"><summary>診斷：提示 17 條（REVIEW_SECTION_UNRECOGNIZED）</summary>
      <p class="muted">原型未重跑 index；正式版會列出每條診斷與位置。</p></details>
  </section>`;
}

// ---------- 變體 A：編輯式長文 ----------
function variantA() {
  const body = reqs
    .map(
      (r) => `<article class="req" id="req-${r.anchor}">
      <p class="kicker">需求 ${r.anchor}</p><h2>${esc(r.spec.title)}</h2>
      ${docBadge(`${BATCH.spec} › ${r.anchor}`)}
      <h3>目標</h3>${md(r.spec.subs["目標"] ?? "", 3)}
      <h3>需求驗收 <span class="en">Requirement Acceptance</span></h3>${reqAcs(r)}
      ${r.spec.subs["不包含"] ? `<h3>不包含</h3>${md(r.spec.subs["不包含"], 3)}` : ""}
      ${r.stories
        .map((sid) =>
          firstOwner[sid] !== r.anchor
            ? `<p>Story <a href="#story-${sid}">${sid}</a> 已在 ${firstOwner[sid]} 展開。</p>`
            : `<section class="story" id="story-${sid}"><h3>Story ${esc(stories[sid].title)}</h3>${docBadge(`${stories[sid].dir}/story.md`)}
               ${storyFocus(sid)}
               <h3>執行驗收 <span class="en">Execution Acceptance</span></h3>${docBadge(`${stories[sid].dir}/acceptance.md`)}${storyAcs(sid)}</section>`,
        )
        .join("")}
      <details class="doc-rest"><summary>需求細節：${Object.keys(r.spec.subs).filter((k) => !["目標", "驗收條件", "不包含"].includes(k)).join("、")}</summary>${reqDetails(r)}</details>
    </article>`,
    )
    .join("");
  const toc = `<nav class="toc no-print" aria-label="目錄"><p class="kicker">目錄</p><ol>
    <li><a href="#top-A">批次摘要</a></li>${reqs.map((r) => `<li><a href="#req-${r.anchor}">${r.anchor} ${esc(r.spec.title)}</a></li>`).join("")}<li><a href="#appendix">附錄</a></li></ol></nav>`;
  return `<div class="va">${toc}<main><div id="top-A">${summary()}</div>${body}${appendix()}</main></div>`;
}

// ---------- 變體 B：總覽矩陣＋逐條展開 ----------
function variantB() {
  const rows = reqs
    .map(
      (r) => `<tr><th><a href="#b-${r.anchor}">${r.anchor}</a><div class="small">${esc(r.spec.title)}</div></th>
      <td>${md(r.spec.subs["目標"] ?? "")}</td>
      <td>${r.stories.map((s) => `<b>${s}</b><div class="small">${esc(stories[s].title.replace(/^TST-\d+\s*/, ""))}</div>`).join("")}</td>
      <td class="num">${acList(r.spec.subs["驗收條件"] ?? "").length}</td>
      <td class="num">${r.stories.map((s) => stories[s].acGroups.flatMap((g) => g.acs).length).join(" / ")}</td>
      <td>${r.spec.subs["不包含"] ? md(r.spec.subs["不包含"]) : '<span class="muted">未寫明</span>'}</td></tr>`,
    )
    .join("");
  const matrix = `<section class="matrix"><h2>需求總覽</h2><div class="table-scroll"><table>
    <thead><tr><th>需求</th><th>目標（原文）</th><th>Story</th><th>需求驗收</th><th>執行驗收</th><th>不包含（原文）</th></tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
  const cards = reqs
    .map(
      (r) => `<details class="card" id="b-${r.anchor}" open><summary><span class="kicker">${r.anchor}</span> ${esc(r.spec.title)}</summary>
      <div class="tabs">
        <section><h3>需求驗收</h3>${reqAcs(r)}</section>
        ${r.stories.map((sid) => `<section><h3>${sid} 執行驗收</h3>${storyAcs(sid)}</section><section><h3>${sid} Story 重點</h3>${storyFocus(sid)}</section>`).join("")}
        <section><h3>需求細節</h3>${reqDetails(r)}</section>
      </div></details>`,
    )
    .join("");
  const cover = summary().replace(/<section><h2>本批需求<\/h2>[\s\S]*?<\/section>/, "");
  return `<main class="vb">${cover}${matrix}${cards}${appendix()}</main>`;
}

// ---------- 變體 C：Spec／Story 並排對照 ----------
function variantC() {
  const body = reqs
    .map((r) =>
      r.stories
        .map(
          (sid) => `<article class="pair" id="req-${r.anchor}">
      <h2><span class="kicker">${r.anchor} ↔ ${sid}</span><br>${esc(r.spec.title)}</h2>
      <div class="grid">
        <div class="col spec"><p class="colhead">需求（Spec）</p>${docBadge(`${BATCH.spec} › ${r.anchor}`)}
          <h3>目標</h3>${md(r.spec.subs["目標"] ?? "", 3)}</div>
        <div class="col exec"><p class="colhead">執行（Story ${sid}）</p>${docBadge(`${stories[sid].dir}/story.md`)}
          <h3>目標 <span class="en">Goal</span></h3>${md(stories[sid].focus.find((f) => f.title === "Goal")?.body ?? "", 3)}</div>
        <div class="col spec"><h3>需求驗收</h3>${reqAcs(r)}</div>
        <div class="col exec"><h3>執行驗收</h3>${storyAcs(sid)}</div>
        <div class="col spec"><h3>不包含</h3>${r.spec.subs["不包含"] ? md(r.spec.subs["不包含"], 3) : '<p class="muted">未寫明</p>'}</div>
        <div class="col exec"><h3>範圍 <span class="en">Scope</span></h3>${md(stories[sid].focus.find((f) => f.title === "Scope")?.body ?? "", 3)}</div>
      </div>
      <details class="doc-rest"><summary>${sid} 規則、預期錯誤、限制</summary>${stories[sid].focus
        .filter((f) => !["Goal", "Scope"].includes(f.title))
        .map((f) => `<h4>${FOCUS_ZH[f.title]}</h4>${md(f.body, 3)}`)
        .join("")}</details>
      <details class="doc-rest"><summary>${r.anchor} 需求細節</summary>${reqDetails(r)}</details>
    </article>`,
        )
        .join(""),
    )
    .join("");
  return `<main class="vc">${summary()}${body}${appendix()}</main>`;
}

const CSS = `
:root{--ink:#24211c;--muted:#6f675c;--paper:#f7f4ee;--rule:#d8d0c3;--accent:#8a5a2b;--spec:#2f5d7c;--story:#7a4b1f}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.8 "Iowan Old Style","Noto Serif TC","Songti TC",serif}
code,pre{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.86em}
p code,li code,td code{background:#ece6da;padding:.05em .3em;border-radius:3px}
h1,h2,h3,h4,h5{font-family:"PingFang TC","Noto Sans TC",system-ui,sans-serif;line-height:1.35}
h1{font-size:2.1rem;margin:.2rem 0 .6rem}h2{font-size:1.45rem;margin-top:3rem}h3{font-size:1.08rem;margin-top:1.8rem}h4{font-size:1rem}
a{color:#1e4e6e}.muted{color:var(--muted)}.small{font-size:.85em;color:var(--muted)}
.kicker{font:600 .78rem/1.4 system-ui,sans-serif;letter-spacing:.08em;color:var(--accent);margin:0}
.en{font:400 .78rem system-ui,sans-serif;color:var(--muted);margin-left:.4em}
.doc{display:inline-block;font:.72rem/1.4 ui-monospace,Menlo,monospace;color:var(--muted);border:1px solid var(--rule);border-radius:3px;padding:.05rem .4rem;margin:.2rem 0;overflow-wrap:anywhere}
.label{font:.8rem system-ui,sans-serif;color:var(--muted);margin:0}
.fp{overflow-wrap:anywhere}.status{font:600 .75rem system-ui,sans-serif;color:#2e6b3a;border:1px solid #9cc3a4;border-radius:10px;padding:0 .5em}
.cover section{border-top:1px solid var(--rule);margin-top:1.6rem}.cover h2{margin-top:1.2rem;font-size:1.15rem}
.preface{background:#fffaf0;border-left:4px solid var(--accent);padding:.2rem 1.2rem .6rem}
.reqlist li{margin:.4rem 0}.reqlist a{text-decoration:none}
pre.code{background:#ece6da;padding:1rem;overflow-x:auto;white-space:pre;line-height:1.5}
.table-scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:.9em}
th,td{border-bottom:1px solid var(--rule);padding:.5rem .6rem;text-align:left;vertical-align:top}td p{margin:0}
ol.acs{list-style:none;padding:0}ol.acs li{display:grid;grid-template-columns:8.5em 1fr;gap:.8rem;padding:.45rem 0;border-bottom:1px dotted var(--rule)}
.acid{font:600 .8rem/1.9 ui-monospace,Menlo,monospace;overflow-wrap:anywhere}.req-ac .acid{color:var(--spec)}.exec-ac .acid{color:var(--story)}
.acgroup{margin:1rem 0 0;color:var(--muted);font-size:.85rem}
.focus{border-left:3px solid var(--rule);padding-left:1rem;margin:1rem 0}.focus h4{margin:.2rem 0}
details.doc-rest,details.raw{border:1px solid var(--rule);border-radius:4px;padding:.4rem .9rem;margin:.8rem 0;background:#fbf9f5}
summary{cursor:pointer;font:600 .9rem system-ui,sans-serif;color:var(--muted)}
.story{margin-top:2rem;padding-top:.5rem;border-top:2px solid var(--story)}
.req{border-top:3px double var(--rule);margin-top:4rem}
/* A */
.va{display:grid;grid-template-columns:16rem minmax(0,46rem);gap:3rem;padding:3rem 2rem;justify-content:center}
.toc{position:sticky;top:1.5rem;align-self:start;font:.9rem/1.6 system-ui,sans-serif}.toc ol{padding-left:1.2rem}
/* B */
.vb,.vc{max-width:64rem;margin:0 auto;padding:3rem 2rem}
.matrix td,.matrix th{font-size:.88rem;line-height:1.6}.num{text-align:center;font:600 1.1rem system-ui}
.card{border:1px solid var(--rule);background:#fff;border-radius:6px;padding:1rem 1.4rem;margin:1.5rem 0}
.card>summary{font-size:1.1rem;color:var(--ink)}
/* C */
.pair{margin-top:4rem;border-top:3px double var(--rule)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 2rem}
.col{padding:.4rem 1rem;border-top:1px solid var(--rule)}.col.spec{background:#f1f5f8}.col.exec{background:#faf3ea}
.colhead{font:700 .8rem system-ui,sans-serif;letter-spacing:.06em;margin:.4rem 0 0}.spec .colhead{color:var(--spec)}.exec .colhead{color:var(--story)}
.col ol.acs li{grid-template-columns:1fr;gap:0}
/* 切換列（原型用） */
#switcher{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#111;color:#fff;border-radius:999px;padding:.4rem .6rem;display:flex;gap:.6rem;align-items:center;font:600 .85rem system-ui;box-shadow:0 4px 16px #0005;z-index:9}
#switcher button{background:#333;color:#fff;border:0;border-radius:999px;width:2rem;height:2rem;cursor:pointer}
@media (max-width:760px){.va{grid-template-columns:minmax(0,1fr);padding:1.5rem 1rem}.toc{position:static}.vb,.vc{padding:1.5rem 1rem}.grid{grid-template-columns:1fr}ol.acs li{grid-template-columns:1fr;gap:0}}
@media print{#switcher,.no-print{display:none!important}body{background:#fff;font-size:11pt}.va{display:block;padding:0}.vb,.vc{padding:0}pre.code{white-space:pre-wrap}details{border:0}.card{border:0}}
`;

const variants = { A: ["編輯式長文", variantA()], B: ["總覽矩陣＋逐條展開", variantB()], C: ["Spec／Story 並排對照", variantC()] };
const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PROTOTYPE · ${BATCH.id} 審閱版</title><style>${CSS}</style></head><body>
${Object.entries(variants).map(([k, [, v]]) => `<div class="variant" data-variant="${k}" hidden>${v.replace(/ id="/g, ` id="${k}-`).replace(/href="#/g, `href="#${k}-`)}</div>`).join("\n")}
<div id="switcher"><button id="prev" aria-label="上一個">←</button><span id="label"></span><button id="next" aria-label="下一個">→</button></div>
<script>
const names=${JSON.stringify(Object.fromEntries(Object.entries(variants).map(([k, [n]]) => [k, n])))};const keys=Object.keys(names);
function show(k){document.querySelectorAll('.variant').forEach(v=>v.hidden=v.dataset.variant!==k);document.getElementById('label').textContent=k+' — '+names[k];
const u=new URL(location);u.searchParams.set('variant',k);history.replaceState(null,'',u)}
let cur=new URLSearchParams(location.search).get('variant');if(!keys.includes(cur))cur='A';show(cur);
const step=d=>{cur=keys[(keys.indexOf(cur)+d+keys.length)%keys.length];show(cur)};
document.getElementById('prev').onclick=()=>step(-1);document.getElementById('next').onclick=()=>step(1);
addEventListener('keydown',e=>{if(e.target.closest('input,textarea,[contenteditable]'))return;if(e.key==='ArrowLeft')step(-1);if(e.key==='ArrowRight')step(1)});
let opened=[];addEventListener('beforeprint',()=>{opened=[...document.querySelectorAll('details:not([open]):not(.raw)')];opened.forEach(d=>d.open=true)});
addEventListener('afterprint',()=>{opened.forEach(d=>d.open=false)});
</script></body></html>`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
