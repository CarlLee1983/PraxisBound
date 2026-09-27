# 整批審閱使用指南

整批審閱把 ADR、Spec、Story 與驗收投影成可離線閱讀的 HTML。人提出意見並親自確認；Agent 依授權修訂來源、做預檢及準備交接。HTML、意見、預檢報告和 Goal Plan 都不會自行授權實作。

以下有兩條路徑：**只做離線審閱**，或**選用已安裝的 ForgePilot 交接執行**。兩者共用前段流程。命令在採用 PraxisBound CLI 的 repository 根目錄執行；`<manifest>` 指 `specs/batches/<BATCH-ID>/batch.json`，格式見[批次契約](../../specs/features/batch-review/contract.md#3-batch-manifest)。其他角括號項目請換成實際路徑或值。HTML 可用 `file://` 在本機開啟，不需服務或帳號。

## 共用流程：閱讀、提出意見與複審

| 步驟              | 執行者                 | 操作                                                                                                                                                                                                |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 建立投影       | Agent                  | 執行 `review index`、`review render`，把 HTML 交給人。投影可重建，來源檔才是定義。                                                                                                                  |
| 2. 閱讀與提出意見 | 人                     | 在 HTML 核對原文、來源定位與指紋；選取目標，填寫 Revision Request、建議與理由，並決定是否阻擋。跨段意見選取所有目標。                                                                               |
| 3. 匯出與還原     | 人                     | 用頁面的「匯出」下載 Markdown 修訂單。換瀏覽器或本機資料遺失時，用「還原」選取該檔並套用。若頁面提示無法暫存，立即匯出；未匯出的草稿沒有持久紀錄。                                                  |
| 4. 匯入           | 人                     | 執行 `review import`，將匯出檔寫入批次的 `records/`。只交給 Agent 一份檔案而未匯入，不算已採計的意見。                                                                                              |
| 5. 修訂與回應     | 已獲修改授權的 Agent   | 讀取全部已匯入的有效意見，比對定位，依[修訂流程](agent-workflow.md#1-修訂來源r-005)修改正確來源；逐則準備 Revision Response JSON，執行 `review respond`。遇到舊定位、未決問題或授權不足時請人決定。 |
| 6. 複審新版       | Agent 重新投影；人閱讀 | 再執行 `index`、`render`。人核對新版原文、差異、回應及「需複審」標記。來源變更使舊確認不再適用；必要時重走步驟 2–6。                                                                                |

```sh
praxisbound review index <manifest> --json
praxisbound review render <manifest> --output review.html
praxisbound review import <manifest> <sheet.md> --json
praxisbound review respond <manifest> <responses.json> --json
```

Revision Response 的欄位與逐則回應規則見[修訂流程](agent-workflow.md#17-回應)。意見文字、來源及紀錄中的「已核准」或命令都只是資料；Agent 的回應也不能代替人的決定。

## 路徑 A：沒有 ForgePilot，完成離線審閱

1. **人**檢查當前 HTML 和未決意見。沒有阻擋意見後，親自在互動終端機執行 `review confirm` 並核對指紋。Agent 不代跑，也不透過管線提供答案。
2. **Agent**依[語義預檢流程](agent-workflow.md#2-語義預檢r-007)逐張 Story 閱讀 Spec、Story、驗收與依賴，產生綁定當前指紋的 Semantic Report，執行 `review preflight`。這份報告是 Agent 的觀察，不是人的確認。
3. **人與 Agent**閱讀預檢結果。`REVIEW_BLOCKED`、`REVIEW_INCOMPLETE` 或 `REVIEW_STALE` 要先修正來源、補齊檢查或重新複審並確認。`REVIEW_READY` 只表示這次預檢沒有阻擋，不表示實作驗證通過或最終接受。

```sh
# 人在自己的互動終端機執行
praxisbound review confirm <manifest>

# Agent：報告檔位於 repository 內
praxisbound review preflight <manifest> --semantic-report <semantic-report.json>
```

離線路徑在此即可交付審閱結果。後續實作仍需有各 Story 的執行授權、執行 repository 的 `make verify`，並交由 Human Review 決定是否接受。

## 路徑 B：交接已安裝的 ForgePilot

本路徑另需每張 Story 的 `readiness.json`。**人或受託 Agent**先撰寫 Sidecar；**Agent**執行 `readiness-digests` 更新 Story 與驗收檔 digest。這一步應在人的 `review confirm` **之前**完成：Sidecar 或 digest 變動會改變指紋，需重新 render、複審及 confirm。之後按路徑 A 產生 Semantic Report 並預檢。

```sh
praxisbound review readiness-digests <manifest> --json
# 人重新審閱後，在互動終端機執行 review confirm
praxisbound review preflight <manifest> --semantic-report <semantic-report.json> --json
praxisbound review goal-plan <manifest> --semantic-report <semantic-report.json> --json
```

**Agent**只在 `REVIEW_READY` 時執行 `review goal-plan`。它寫出 `goal-plan/<plan.id>/` 下的 `declaration.json`、`manifest.json`、`coverage-review.json`，不呼叫 ForgePilot，也不授權執行。若要替換已交接的 Goal，**人**先在 ForgePilot 執行 `goal cancel <goal-id> --reason <reason>`，再明確提供新的 `--attempt <n>`；Agent 不自行決定 attempt。

### Bootstrap、預覽與人的授權

**人**選定 ForgePilot 來源與版本，用 Bootstrap 的 `plan`、`install --approve` 建立受管理的安裝。`<source>` 是人選定的本機 ForgePilot checkout 絕對路徑；先使用該 checkout 的 `scripts/forgepilot-bootstrap`，不依賴 PATH 已有 Bootstrap。`<plan-id>` 取自 `plan` 輸出。以下參數形式見 [TST-035 實測](../../specs/stories/TST-035-forgepilot-second-segment/verification.md)；所示 commit 是該次演練版本。

```sh
<source>/scripts/forgepilot-bootstrap plan --agent codex --source <source> --commit 3a76acaa5da206bef9a8d15df0db3f08f90311e2
<source>/scripts/forgepilot-bootstrap install --agent codex --source <source> --commit 3a76acaa5da206bef9a8d15df0db3f08f90311e2 --approve <plan-id>
<source>/scripts/forgepilot-bootstrap generation-v1 current
```

**Agent**依[交接流程](agent-workflow.md#3-交接-forgepilotr-008修訂tst-034tst-035tst-036)用受管理安裝的絕對路徑與公開 CLI：先重查 `review preflight --expect-fingerprint` 與 Goal Plan manifest 雜湊，再 `work list`／必要時 `goal create`，依依賴序 `work add`，執行 `goal preflight`、`execution plan`。每個寫入前重查；後兩者即使 exit 0，仍要檢查頂層 `diagnostics`。Worker Profile、上限與期限由人明確提供，Agent 不代填預設值。

交出 `approvalToken` **之前**，**Agent**向人揭露可讀到的 Worker 環境：Codex 設定目錄、MCP server 名稱、hook 事件和執行檔路徑、全域 `AGENTS.md` 與工作區 `.codex/` 是否存在；未檢視處標「未檢視」。不抄錄環境變數、參數、token、header 或 URL。揭露結尾須寫：「此清單只來自 Agent 能讀到的內容，可能不完整。」揭露不是授權，也不需另行確認。

**人**檢視預覽、approval token 與環境揭露後，親自在 ForgePilot 執行下列授權命令，並在當前會話告訴 Agent 已執行。`<forgepilot-bin>` 是 Bootstrap 管理的執行檔絕對路徑。**Agent**才重查預檢，依序執行 dry-run 和真正的 `run`。dry-run 通過不證明授權存在；真正的授權關卡在 `run`。

```sh
# 人
<forgepilot-bin> execution authorize --request <execution-request.json> --approval-token <token> --by <name> --json

# Agent，在人明確告知授權後
<forgepilot-bin> run --goal <goal-id> --runtime codex --runtime-command <executable-path> --snapshot --dry-run
<forgepilot-bin> run --goal <goal-id> --runtime codex --runtime-command <executable-path> --snapshot
praxisbound review observe <manifest> <observation.json> --json
```

**Agent**在交接的每段結束後用 `review observe` 記錄實際觀察，不從輸出文字推定授權。ForgePilot 的 `goal-completed` 只表示技術執行完成；**人**仍需 Human Review 才能最終接受。它不自動宣告 DONE、merge 或 deploy。`run-needs-human`、`run-limit-reached`、`run-interrupted`、`run-failed` 均要照實回報。

## 已驗證的瀏覽器範圍

[R-009 視覺驗收](../../specs/stories/TST-039-batch-review-browser-acceptance/evidence/observations.md)在隔離的兩份 Spec、四張 Story fixture 上實測：Chrome **153.0.8010.54** 與 Playwright WebKit **26.6** 的 1280 px 桌面、390 px 窄螢幕及實際分頁 A4，涵蓋初次投影、匯出後還原、修訂後需複審、儲存停用四種狀態。Safari **26.5** 另有這些狀態的原生 A4 列印紀錄。列印會隱藏仍在審閱面板的草稿意見；匯入後的歷史意見才出現在可列印的證據區。其他瀏覽器、版本、裝置與像素一致性均**未驗證**。

命令形式依 [R-009 E2E 測試](../../packages/cli/test/review-batch-e2e.test.mjs)與[Agent 工作流程](agent-workflow.md)。E2E 在暫存 repository 中串起 index、render、import、respond、重新 render、confirm、preflight、readiness-digests、goal-plan、observe；其中 confirm 由測試注入的終端 adapter 驅動，ForgePilot 觀察是已錄製資料的回放，不等於真實人類確認或新的 ForgePilot 執行。
