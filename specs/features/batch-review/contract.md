# Contract：整批審閱與執行交接

Contract ID：`SPEC-BATCH-REVIEW/R-001`。狀態：已接受（accepted，人類審閱並合併 #94）。日期：2026-09-17。
修訂：2026-09-18，Review Projection 以需求為主軸的呈現（§18）、manifest `preface`（§3）與 Spec 章節詞彙（§5）；已接受（人類審閱 #100）。
修訂：2026-09-18，Review Projection 的審閱層（§19，R-004）；已接受（人類審閱 #103）。

本文件定稿 [spec.md](spec.md) R-001 要求的產物格式、指紋、定位、命令結果與授權邊界。
取捨與不可靜默推翻的邊界記錄於
[ADR-014](../../decisions/ADR-014-batch-review-is-projection-and-proposal-not-authority.md)；
詞彙以 [CONTEXT.md](../../../CONTEXT.md) 的 Batch Review 段為準。
本文件是 R-002～R-009 的實作依據；它不證明任何功能已實作。

機器可讀格式位於 [`schemas/`](schemas/)（JSON Schema 2020-12，共用定義在 `defs.schema.json`），
範例位於 [`examples/`](examples/)。範例中的 SHA-256 與 commit 為示意值，不對應任何真實檔案。
schema 與本文不一致時視為契約缺陷，回到修訂，不擇一沿用。

## 1. 兩條路徑

```text
index → render → （HTML 審閱，可匯出／還原修訂單）
   ├─ 有意見：review import 修訂單 → Agent 修訂來源並寫 Revision Response
   │          → index／render 新版（舊確認自動不適用）→ 再審
   └─ 無未解決阻擋意見：confirm（TTY）→ Agent 語義檢查 → preflight
          ├─ REVIEW_BLOCKED／INCOMPLETE／STALE → 回到修訂或補檢查
          └─ REVIEW_READY → packet → （已授權時）ForgePilot 公開 CLI
                                        → 等待 Goal 最終總檢
```

預檢需要改變已確認定義時一律回到修訂與複審（R-007 AC-004）。
程式錯誤／測試失敗屬於 ForgePilot Runner 的修復循環，不回到本流程。

## 2. 產物總表

| 產物 | 位置 | 產生者 | 權威 | 可變性 |
| --- | --- | --- | --- | --- |
| Batch Manifest | `specs/batches/<BATCH-ID>/batch.json` | 人或 Agent | 批次範圍與關係的唯一宣告 | 一般來源檔，納入指紋 |
| 來源（ADR／Spec／Story／acceptance） | manifest 所列路徑 | 人或 Agent | 定義來源；Story 為執行權威 | 一般來源檔，納入指紋 |
| Review Projection（HTML） | `render --output` | `review render` | 無；衍生投影 | 可重建，不納入指紋 |
| 修訂單匯出檔 | 使用者自選 | HTML 審閱頁 | 無；修改提議的載體 | 暫存；不被命令直接採計 |
| 已匯入修訂單 | `records/revisions-<sheet12>.json` | `review import` | 無；修改提議 | 只新增 |
| Revision Response 紀錄 | `records/responses-<to12>-<n>.json` | Agent 工作流程 | 歷史 Evidence | 只新增 |
| Definition Confirmation | `records/confirmation-<fp12>.json` | `review confirm` | 人類聲明（非身份驗證） | 只新增；同指紋只一份 |
| Semantic Report | 使用者自選，交給 `--semantic-report` | Agent 工作流程 | Agent 觀察 | 輸入；以 sha256 記入預檢紀錄 |
| Preflight Report | `records/preflight-<fp12>-<n>.json` | `review preflight`／`review packet` | 歷史 Evidence | 只新增 |
| Execution Packet | `records/packet-<fp12>-<n>.json` 及 `--output` | `review packet` | 開工輸入；記錄觀察到的授權來源 | 只新增 |
| 外部整合觀察 | `records/forgepilot-<fp12>-<n>.json` | Agent 工作流程 | 當次觀察；現況以 ForgePilot 為準 | 只新增 |

- `records/` 位於 `specs/batches/<BATCH-ID>/records/`。`<fp12>` 是 Requirement Fingerprint 前 12 個十六進位字元；
  `<to12>` 是回應紀錄 `toFingerprint` 的前 12 碼；`<sheet12>` 是已匯入 JSON 內容 sha256 的前 12 碼；
  `<n>` 從 1 起，同名已存在時遞增。
- 寫入一律排他建立（create-new）；任何既有檔案都不被改寫。`records/` 與其上層目錄任一段為 symlink 即拒絕寫入。
- 讀取紀錄時，檔名前綴必須等於內容中完整值的前 12 碼且內容通過 schema；否則該檔不被採計，並產生 `REVIEW_RECORD_INVALID` 診斷，不讓它默默生效。
- `specs/batches/` 是 batch review 的 Reference Tooling 慣例，不是 Protocol 目錄；未使用本功能的 Adoption 不需要它。
- 不存在 `current`、`latest`、`status` 或 lifecycle 欄位。任何紀錄「是否適用於現在」一律以當前來源重算指紋後比對。

## 3. Batch Manifest

Schema：[`schemas/batch-manifest.schema.json`](schemas/batch-manifest.schema.json)。
範例：[`examples/batch.json`](examples/batch.json)。

- `batchId` 沿用 Story ID 語法，可加 slug，且必須等於所在目錄名（`REVIEW_MANIFEST_INVALID`）。
- `sources` 依種類列出 repo 相對 POSIX 路徑：`adrs`、`specs`、`stories`。
  `stories` 指 Story 目錄，工具讀取其中的 `story.md` 與 `acceptance.md`；`task.md` 不納入（`protocol/story.md` 定義為非權威）。
  Story ID 取目錄名中符合 `protocol/story.md` ID 語法的前綴（例如 `RF-002-refund-approval` → `RF-002`）。
- Spec 條目：Spec 文件中以 `R-` 加三位以上數字開頭、後接空白、全形或半形冒號或行尾的第二級 ATX heading（`## R-001：...`）。
  內文、表格或其他層級 heading 中的 `R-NNN` 字樣不是條目。Spec AC 為該條目區塊內以 `- AC-NNN：` 或 `* AC-NNN:` 開頭的列。
- `requirements` 顯式列出 `Spec 條目 → Story`：`{ "spec", "anchor", "stories" }`。
  列入批次的 Spec 中每個條目都必須出現在 `requirements` 且 `stories` 非空，否則預檢判 `REVIEW_REQUIREMENT_UNMAPPED`；
  本批不交付的條目應把 Spec 移出批次或拆成另一份 Spec，而不是留空對應。
- `dependencies` 顯式列出 Story 依賴邊：`{ "story", "dependsOn" }`。
  Story `Dependencies` 散文提及、manifest 卻未宣告的批次內 Story 只產生 `REVIEW_DEPENDENCY_UNDECLARED`（非阻擋）。
- 不允許額外欄位、glob、repo 外路徑、`..`、絕對路徑或控制字元（`REVIEW_MANIFEST_INVALID`）；任一路徑段為 symlink 即 `REVIEW_PATH_UNSAFE`。
- 同一路徑出現兩次、Story ID 重複：`REVIEW_MANIFEST_INVALID`。`requirements`／`dependencies` 引用不在批次內的 Story：`REVIEW_STORY_UNKNOWN`。

- （修訂，R-003）`schemaVersion` 為 `1.0.0` 或 `1.1.0`；讀取端兩者皆接受，寫出的新 manifest 使用 `1.1.0`。
  `1.1.0` 只新增選填 `preface`：人撰寫的審閱導言（Review Preface），Markdown 字串，UTF-8 ≤ 4 KiB，
  超出為 `REVIEW_INPUT_TOO_LARGE`。它是 Review Projection 中唯一不取自來源文件的散文，
  屬 manifest 內容而隨之納入指紋（§4）；它不是摘要、不是定義來源，也不授予任何操作權。
  `1.0.0` manifest 出現 `preface` 為 `REVIEW_MANIFEST_INVALID`。

批次只包含 manifest 明確列出的檔案；工具不自動加入其他 ADR、Story 或歷史資料。

### 定義衝突與追溯

- 權威順序沿用既有契約：已接受 ADR 與已批准 Story 的執行意圖不被 Spec 覆蓋（ADR-014）。
  Spec 與 Story 不一致時，工具不擇一；語義預檢以 `contradiction` 類別回報，由修訂流程決定改哪一邊。
- 追溯鏈只有 `Spec 條目 → Story`（manifest）與 `Story → AC`（acceptance.md），沒有其他推斷路徑。

## 4. Requirement Fingerprint

```text
sourceDigest(path) = sha256(該檔原始 bytes)，小寫 hex
fingerprint = sha256(UTF-8(canonicalJson({
  "manifest": sourceDigest("specs/batches/<BATCH-ID>/batch.json"),
  "sources": [ { "path": <repo 相對 POSIX 路徑>, "sha256": <sourceDigest 或 null> }, ... ]
})))
```

- `sources` 包含 manifest 列出的每個 ADR、Spec，以及每個 Story 的 `story.md`、`acceptance.md`；
  依 `path` 的 UTF-8 bytes 升冪排序；不含 manifest 本身（已在 `manifest` 欄位）。
- `canonicalJson`：物件 key 依上列固定順序，無多餘空白，字串依 JSON 標準跳脫，非 ASCII 字元不跳脫，不含結尾換行。
- 不正規化換行、BOM 或 Unicode。CRLF 轉換會改變指紋並使舊確認不適用；這是如實反映位元組變動。
- 讀取的是工作樹內容，包含未提交修改。Git HEAD、render 時間、HTML、`records/` 與驗證產物都不參與。
- 必要來源缺失時，缺失檔以 `"sha256": null` 參與計算以便閱讀，結果帶 `REVIEW_SOURCE_MISSING`；
  含 `null` 的指紋不可用於 `confirm` 與 `packet`。

## 5. 穩定定位

定位（locator）為 `{ "path", "anchor", "blockSha256" }`，不使用行號或字元位移。

`anchor` 解析順序：

1. 顯式 ID：Spec 條目 `R-NNN`、Spec AC `R-NNN/AC-NNN`、acceptance 的 `AC-NNN`、Story 固定欄位名（如 `Rules`）、ADR 標題（`ADR-NNN`）。
2. 無顯式 ID 時使用 heading 路徑：各層 heading 文字以 ` > ` 連接。
3. 整份文件或整批：`#document` 或 `#batch`（此時 `path` 為 manifest 路徑）。

（修訂性澄清，R-002）沒有顯式 ID、也不落在任何已辨識錨點區塊內的 heading，仍以其 heading 路徑
（規則 2）納入索引，並回報一次非阻擋診斷 `REVIEW_SECTION_UNRECOGNIZED`；不因此從索引中省略任何來源內容。

（修訂，R-003）Spec 章節詞彙。下列 heading 視為已辨識，得到固定顯式錨點，不再回報
`REVIEW_SECTION_UNRECOGNIZED`；比對的是去除前後空白後的 heading 文字，不做大小寫以外的正規化：

| 位置 | heading 文字 | 錨點 | 投影用途 |
| --- | --- | --- | --- |
| Spec 第二級、非條目 | 以 `目標` 或 `Goal` 開頭 | `Goal` | 批次目標 |
| Spec 第二級、非條目 | 含 `非目標`，或以 `不包含`、`Non-goals`、`Out of Scope` 開頭 | `Non-goals` | 批次不包含 |
| Spec 條目內第三級 | `目標`／`Goal` | `R-NNN/Goal` | 需求目標 |
| Spec 條目內第三級 | `驗收條件`／`Acceptance` | `R-NNN/Acceptance` | 需求驗收所在區塊 |
| Spec 條目內第三級 | `不包含`／`Out of Scope` | `R-NNN/Non-goals` | 需求不包含 |
| Spec 條目內第三級 | `依賴`／`Dependencies` | `R-NNN/Dependencies` | 需求細節 |

`Goal`、`Non-goals` 在同一 Spec 出現一次以上，或同一條目內任一條目錨點重複時，依上一段回報
`REVIEW_ANCHOR_DUPLICATE`。未列入本表的第二級 heading 維持 heading 路徑錨點與 advisory 診斷；
條目內未列入本表的第三級 heading 仍是該條目的內容，以 heading 路徑定位，不產生診斷。
Spec AC `R-NNN/AC-NNN` 的解析不變。

`blockSha256` 是該錨點區塊原始 bytes 的 SHA-256：heading 錨點為該 heading 行起至下一個同級或更高級 heading 前；
AC 為其所在列；`#document` 為整檔；`#batch` 為當時批次指紋字串的 UTF-8 bytes。

匹配：錨點唯一且 `blockSha256` 相同為「一致」；錨點存在但 hash 不同、錨點重複或不存在為「待比對」。
「待比對」永不自動套用到相似或同名段落（R-004 AC-005、R-005 AC-004）。

（修訂性澄清，R-002）同一顯式錨點值在同一檔案內出現一次以上時，回報阻擋診斷
`REVIEW_ANCHOR_DUPLICATE`；該錨點值不解析到任何一次出現，兩者皆不視為已對應或已覆蓋。

## 6. 修訂單與 `review import`

Schema：[`schemas/revision-sheet.schema.json`](schemas/revision-sheet.schema.json)。
範例：[`examples/revision-sheet.md`](examples/revision-sheet.md)。

匯出檔格式：

- Markdown。唯一權威資料是一個 fenced 區塊：開頭行在第 0 欄且恰為 ```` ```praxisbound-revisions ````，
  結尾行在第 0 欄且恰為 ```` ``` ````；區塊內為 JSON。判斷 fence 時忽略行尾 `\r`（同 `protocol/story.md`）。
  tilde fence、縮排 fence、較長 backtick fence 都不是此區塊。
- 區塊外文字由匯出端產生、僅供閱讀；匯入不讀。匯出端把所有使用者文字以 `> ` 引用行輸出，
  使用者文字因此不可能在第 0 欄形成 fence；JSON 字串不含原始換行，區塊內也不可能出現 fence 行。
  （修訂性澄清，R-004）區塊外的 `quote`、`proposal`、`rationale` 只列前 200 個字元（Unicode 碼位），
  超過時以 `…` 收尾，並註明完整內容以 JSON 區塊為準；區塊外文字因此不會讓修訂單的大小隨意見文字倍增。
- 開頭行數量不是恰好一個、或區塊未閉合：`REVIEW_REVISION_SHEET_INVALID`，整份拒絕。

每則意見：`id`（`REV-` 加 26 字元 ULID）、`fingerprint`（提出時批次指紋）、`targets`（一或多個 locator；跨段／跨 Story 以多個 target，整批以 `#batch`）、
`quote`、`kind`、`blocking`、`proposal`、`rationale`、`createdAt`，選填 `supersedes`。

- `kind`：`supplement`（補充）、`rewrite`（建議改寫）、`add-requirement`（新增要求）、`delete`（刪除建議）。`delete` 只是提議，不移除原文。
- `blocking` 由人在 HTML 設定，預設 `true`。Agent 只能在回應中以 `blockingSuggestion` 建議。
  人要修改已匯入的意見（含阻擋性）時，在 HTML 建立新 ID 的意見並以 `supersedes` 指向被取代的 ID。

`praxisbound review import <manifest> <sheet>`：

1. 讀取並驗證區塊、schema 與上限（§13）；`batchId` 不符：`REVIEW_REVISION_SHEET_INVALID`。
   同一份修訂單內重複的 ID：同內容只保留一則，不同內容整份拒絕（`REVIEW_REVISION_CONFLICT`，列出 ID）。
2. 與全部已匯入修訂單比對意見 ID：同 ID 同內容 → 去重；同 ID 不同內容 → 整份拒絕（`REVIEW_REVISION_CONFLICT`，列出 ID）。
   去重之後，只對新意見檢查 `supersedes`：指向的 ID 必須存在於已匯入修訂單或本份修訂單，且尚未被其他意見取代；
   否則整份拒絕（`REVIEW_REVISION_CONFLICT`）。頁面每次匯出都包含全部意見，所以第二份修訂單會同時帶著 X 與取代 X 的 Y，
   X 在去重時已略過，Y 取代 X 不算重複取代。
3. 至少一則新意見時，把區塊 JSON 原樣寫入 `records/revisions-<sheet12>.json`；全部重複時不寫檔，outcome `success`，issue `REVIEW_REVISION_DUPLICATE`。
4. 意見 `fingerprint` 與當前指紋不同：仍寫入，issue `REVIEW_REVISION_STALE_TARGET`（「待比對」）。

（修訂性澄清，R-004）同內容的判定：只比較 schema 欄位（`id`、`fingerprint`、`targets`、`quote`、`kind`、
`blocking`、`proposal`、`rationale`、`createdAt`、`supersedes`），先做下列正規化再逐字比較：各層物件的鍵依鍵名
（UTF-16 碼元順序）排序，陣列保持原順序；`createdAt` 轉為標準 UTC 形式（大寫 `T`，小數秒去除尾端 `0`、全為 `0`
時省略，結尾 `Z`），所以 `…:00Z` 與 `…:00.000Z` 是同一時刻；閏秒依 RFC 3339 只在 UTC `23:59:60` 合法，
標準形式保留 `:60`，不折算成下一分鐘，所以 `2016-12-31T23:59:60Z` 與 `2017-01-01T00:00:00Z` 是不同內容；`quote`、`proposal`、`rationale` 中的 `\r\n` 與
單獨的 `\r` 視為 `\n`。其餘值逐字比較，有無 `supersedes` 即為不同內容。HTML 閱讀頁的還原（§19）與
`review import` 使用同一判定。

之後所有命令採計**全部**已匯入修訂單中未被 `supersedes` 取代的意見（「有效意見」）；沒有「最新一份」的概念。
HTML 內的匯出／還原（R-004）仍是閱讀頁功能，與 `review import` 分開。

## 7. Revision Response 紀錄

Schema：[`schemas/revision-responses.schema.json`](schemas/revision-responses.schema.json)。
範例：[`examples/records/responses.json`](examples/records/responses.json)。

- 綁定 `fromFingerprint`（修訂前）與 `toFingerprint`（修訂後），並列出所回應的已匯入修訂單 `revisionSheets`（sha256）。
  所有回應 `outcome` 皆非 `incorporated` 時兩指紋可相同；否則必須不同（`REVIEW_RESPONSE_INVALID`）。
- 所列修訂單中每個有效意見 ID 恰好一筆回應：
  - `route`：`presentation`（呈現修正）、`story-derivation`（Story 未忠實推導 Spec）、`spec-requirement`（新需求回到 Spec）、`decision`（涉及 ADR 取捨）。
  - `outcome`：`incorporated`（須有非空 `locators`）、`needs-decision`（須有 `question`）、`not-incorporated`。
  - `rationale` 必須非空；是否只是「已處理」類空話由人審閱，機械檢查不判斷。
  - `blockingSuggestion`：選填，只是建議。
- 缺漏或多出 ID：`REVIEW_RESPONSE_MISMATCH`。
- 意見「已解決」：存在一份 `toFingerprint` 等於當前指紋的有效回應紀錄，其中該意見 `outcome` 為 `incorporated`。
  `needs-decision`、`not-incorporated` 或回應綁定舊指紋都不算解決。
- 以 `route: decision` 處理的意見不得修改 `Status: accepted` 的 ADR 內容；只能新增替代 ADR 或回 `needs-decision`。
  此規則由人審閱差異確認，機械檢查不涵蓋（既有 ADR 的狀態行寫法不一致）。

## 8. Definition Confirmation

Schema：[`schemas/confirmation.schema.json`](schemas/confirmation.schema.json)。
範例：[`examples/records/confirmation.json`](examples/records/confirmation.json)。

`praxisbound review confirm <manifest>`：

1. stdin 或 stdout 任一不是 TTY：outcome `usage-error`、exit 2、issue `REVIEW_CONFIRM_REQUIRES_TTY`，不寫檔。
   不提供 `--yes`、環境變數或檔案輸入等非互動旁路。互動提示只寫 stderr；stdout 仍只有一個 JSON envelope。
2. 重算指紋；manifest 錯誤或路徑不安全 → `configuration-error`；來源缺失 → `failure`、exit 1、`REVIEW_SOURCE_MISSING`。
3. 存在未解決的阻擋意見 → `failure`、exit 1、`REVIEW_UNRESOLVED_BLOCKING`。
4. 顯示範圍、指紋與每則未解決的非阻擋意見；所有顯示的來源文字、路徑與意見內容先把控制字元（C0、C1、DEL、U+2028、U+2029）轉為可見跳脫形式。
   每則非阻擋意見須由人輸入 `defer` 與理由，否則中止。
5. 要求人輸入指紋前 8 碼；不符或中止 → `failure`、exit 1、`REVIEW_CONFIRM_ABORTED`，不寫檔。
6. 若 `records/confirmation-<fp12>.json` 已存在：內容完整指紋相同 → `success`、`REVIEW_CONFIRMATION_EXISTS`，不寫檔；
   不同 → `failure`、exit 1、`REVIEW_RECORD_COLLISION`，不寫檔。否則排他建立。

紀錄內容：`claim`（固定 `explicit-terminal-confirmation`）、`batchId`、`fingerprint`、`manifestSha256`、完整 `sources`、`confirmedAt`（UTC）、
`deferred`（意見 ID 與理由）、`revisionSheets`（當時採計的已匯入修訂單 sha256）。不含身份、簽章、授權或 lifecycle 欄位。

適用判定：存在 `fingerprint` 等於當前指紋的有效確認紀錄。不適用時，與 `confirmedAt` 最晚的有效確認比對 `sources`，
逐項列出 `REVIEW_SOURCE_ADDED`／`REVIEW_SOURCE_REMOVED`／`REVIEW_SOURCE_CHANGED`／`REVIEW_MANIFEST_CHANGED`（皆附 `path`）。
「最晚」只用來呈現差異，不代表權威。`render` 以同一比對把變動文件標示為「需複審」，未變動文件不標示；新指紋仍需整批重新 `confirm`。

`confirm` 之後才匯入的意見不改變確認紀錄；其中的阻擋意見會使預檢判 `REVIEW_BLOCKED`。

## 9. Semantic Report 與 `review preflight`

Schemas：[`schemas/semantic-report.schema.json`](schemas/semantic-report.schema.json)、
[`schemas/preflight-report.schema.json`](schemas/preflight-report.schema.json)。
範例：[`examples/semantic-report.json`](examples/semantic-report.json)、[`examples/records/preflight.json`](examples/records/preflight.json)。

Semantic Report 由 Agent 產生：綁定 `fingerprint`；批次內每張 Story 對四個類別各給結論
（`missing-split`、`contradiction`、`insufficient-acceptance`、`open-question`），結論為 `none` 或非空 issues；
記錄 `agent`（自述、未驗證）與 `observedAt`。

`praxisbound review preflight <manifest> [--semantic-report <file>] [--expect-fingerprint <sha256> --expect-revision <commit>]`：

| 檢查 | issue code | 結果 |
| --- | --- | --- |
| argv 合法；`--expect-*` 同時提供或同時省略 | 既有 usage 規則 | `usage-error`，exit 2 |
| manifest 可讀且合法、路徑安全、schemaVersion 支援 | `REVIEW_MANIFEST_INVALID`、`REVIEW_PATH_UNSAFE`、`REVIEW_SCHEMA_UNSUPPORTED` | `configuration-error`，exit 2 |
| 內部失敗 | 既有 CLI 規則 | `ERROR`，exit 3 |
| 來源存在 | `REVIEW_SOURCE_MISSING` | BLOCKED |
| `--expect-fingerprint` 等於當前指紋 | `REVIEW_PACKET_FINGERPRINT_MISMATCH` | STALE |
| `--expect-revision` 等於 HEAD | `REVIEW_PACKET_REVISION_MISMATCH` | STALE |
| 提供 `--expect-revision` 時：位於 git repository，批次來源與 manifest 無未提交／未追蹤修改 | `REVIEW_NOT_A_GIT_REPOSITORY`、`REVIEW_SOURCES_UNCOMMITTED` | BLOCKED |
| 確認適用於當前指紋 | `REVIEW_CONFIRMATION_STALE`（附 §8 差異）、`REVIEW_CONFIRMATION_MISSING` | STALE／INCOMPLETE |
| 各 Story 通過既有 `story check` | 沿用其 issue code | BLOCKED |
| 依賴無循環 | `REVIEW_DEPENDENCY_CYCLE` | BLOCKED |
| 依賴與對應只引用批次內 Story | `REVIEW_STORY_UNKNOWN` | BLOCKED |
| Spec 條目皆有 Story；Story 皆有 AC | `REVIEW_REQUIREMENT_UNMAPPED`、`REVIEW_ACCEPTANCE_MISSING` | BLOCKED |
| 對應的 Spec 條目在該 Spec 中實際存在（修訂性澄清，R-002） | `REVIEW_ANCHOR_UNKNOWN` | BLOCKED |
| 同一檔案內錨點不重複 | `REVIEW_ANCHOR_DUPLICATE` | BLOCKED |
| 無未解決阻擋意見 | `REVIEW_UNRESOLVED_BLOCKING` | BLOCKED |
| 非阻擋意見都已解決或在適用的確認中 defer | `REVIEW_REVISION_UNADDRESSED` | INCOMPLETE |
| 回應紀錄完整、合法 | `REVIEW_RESPONSE_MISMATCH`、`REVIEW_RESPONSE_INVALID` | INCOMPLETE |
| Semantic Report 已提供、大小合法、schema 合法、涵蓋每張 Story 與類別 | `REVIEW_SEMANTIC_MISSING`、`REVIEW_INPUT_TOO_LARGE`、`REVIEW_SEMANTIC_INVALID`、`REVIEW_SEMANTIC_COVERAGE` | INCOMPLETE |
| Semantic Report 指紋相符 | `REVIEW_SEMANTIC_STALE` | STALE |
| Semantic Report 含阻擋 issue | `REVIEW_SEMANTIC_BLOCKING` | BLOCKED |
| Semantic Report 含非阻擋 issue | `REVIEW_SEMANTIC_OBSERVATION` | 不影響結果 |
| 其他非阻擋診斷 | `REVIEW_DEPENDENCY_UNDECLARED`、`REVIEW_RECORD_INVALID`、`REVIEW_REVISION_STALE_TARGET`、`REVIEW_SECTION_UNRECOGNIZED`（修訂性澄清，R-002） | 不影響結果 |

- 優先序：`ERROR`／`*-error` > `REVIEW_STALE` > `REVIEW_BLOCKED` > `REVIEW_INCOMPLETE` > `REVIEW_READY`；全部 issues 仍列出。
- `--expect-fingerprint`／`--expect-revision` 由 `review packet` 與 Agent 工作流程在 ForgePilot 寫入前使用（§10、§11）。
- 預檢不執行 `make verify`、不要求尚未實作的測試通過，也不寫來源。
- manifest 合法時，每次執行都寫一份 Preflight Report；機械與語義診斷分列。`REVIEW_READY` 只表示未發現阻擋，不宣稱沒有缺陷。

## 10. Execution Packet 與 `review packet`

Schema：[`schemas/execution-packet.schema.json`](schemas/execution-packet.schema.json)。
範例：[`examples/records/packet.json`](examples/records/packet.json)。

`praxisbound review packet <manifest> --semantic-report <file> --output <file> [--attempt <n>] [--authorization-source <story|session|control-plane|none> --authorization-reference <text>]`：

1. 以當前 HEAD 為 `--expect-revision`、當前指紋為 `--expect-fingerprint`，執行與 `preflight` 完全相同的判定並寫一份新的 Preflight Report。
   非 `REVIEW_READY` 時不寫 packet，outcome 同預檢。
2. `REVIEW_READY` 時寫 `records/packet-<fp12>-<n>.json`，並以原子方式寫 `--output`。packet 參照本次新寫的 Preflight Report。
3. 內容：`batchId`、`fingerprint`、`revision`（HEAD）、`confirmation` 與 `preflight` 紀錄路徑及 sha256、`semanticReportSha256`、
   依拓撲排序（同層依 Story ID 字典序）的 `stories[{ id, path, dependsOn }]`、選填 `attempt`、`goalId`、`authorization`、`generatedAt`。
4. `goalId` = `<BATCH-ID>-<fp12>`；有 `--attempt <n>` 時為 `<BATCH-ID>-<fp12>-a<n>`。不做其他轉換。
   ForgePilot `f2ec4b5` 對 Goal ID 只要求非空；日後 ForgePilot 拒絕此格式時，工作流程停止並回報，不自行改寫 ID。
5. `authorization` 只記錄 `{ observedSource, reference }`，未提供時為 `none`。讀取 packet 的任何人或工具都不得把它當成授權；
   `none` 時仍可輸出 packet，但 Agent 工作流程不得據此產生外部效果。

`--attempt` 只應由人在 ForgePilot 內處理完舊 Goal（例如取消）後明確提供；工具不檢查也不推斷舊 Goal 狀態。
packet 不是 `protocol/handoff.md` 的 handoff，不含 verification 結果，也不宣稱任何工作已完成。

## 11. ForgePilot 整合規則（Agent 工作流程）

Schema：[`schemas/forgepilot-observation.schema.json`](schemas/forgepilot-observation.schema.json)。
範例：[`examples/records/forgepilot.json`](examples/records/forgepilot.json)。

僅透過 ForgePilot 公開 CLI；不讀寫 `.forgepilot`。已觀察的限制（ForgePilot `f2ec4b5`）：
Work Item ID 由 ForgePilot 指派、無冪等鍵、依賴只能在建立時宣告、除 `run status` 外無 JSON 輸出。

1. 解析 Execution Authorization；不足即停止（`authorization-missing`）。
2. 每個寫入動作前（`goal create`、每個 `work add`、`run`）執行
   `review preflight <manifest> --semantic-report <packet 所用報告> --expect-fingerprint <packet.fingerprint> --expect-revision <packet.revision>`，
   並確認該報告 sha256 等於 `packet.semanticReportSha256`；非 `REVIEW_READY` 或不符即停止（`preflight-not-ready`）。
3. `goal create --id <goalId> --title <batchId> --review-policy goal`。exit 非 0 → 停止；stderr 含 `already exists` 時為 `goal-exists`，否則 `step-failed`。不續建 Work Items。
4. 依 packet 順序 `work add --goal <goalId> --story <path> [--depends-on <本次取得的 WI ID> ...]`；依賴使用本次實際取得的 WI ID，不以 Story ID 代替。
5. 文字輸出解析界線：只解析兩種已文件化的行——`Goal <id> created`，以及 `work add` stdout 首行 `<WI-ID> <STATUS>`（`WI-ID` 符合 `^WI-[0-9]+$`）。
   exit 0 但解析不到 → 停止（`result-unknown`）。解析只用來取得本次剛建立的 ID，**從不**用來查找或續接先前的嘗試。
6. 任一步失敗或結果不明 → 停止，不啟動 Runner、不重試。恢復由人在 ForgePilot 內處理後，以新的 `--attempt` 重新產生 packet。
7. 全部成功後才 `run --goal <goalId> ...`；exit 0 回報為「等待 Goal 最終總檢」（`completed-awaiting-goal-review`），
   其他 exit 依 ForgePilot 意義如實回報（`run-stopped`），不寫 VERIFIED／DONE、不核准 review。
8. 無論成功或停止，每次嘗試結束都寫一份外部整合觀察紀錄。

重試識別與部分失敗的自動續接需要 ForgePilot 提供機器可讀查詢與冪等鍵；此缺口須另提 ForgePilot issue。

## 12. 命令、結果與 `data`

新增命令，皆使用既有 envelope（`schemaVersion` `1.0.0`）：

| 命令 | 成功 outcome | 其他 outcome |
| --- | --- | --- |
| `review index <manifest>` | `success` | `usage-error`、`configuration-error`、`ERROR` |
| `review render <manifest> --output <file>` | `success` | `failure`（輸出失敗）、`usage-error`、`configuration-error`、`ERROR` |
| `review import <manifest> <sheet>` | `success` | `failure`（格式錯誤、衝突、過大）、`usage-error`、`configuration-error`、`ERROR` |
| `review confirm <manifest>` | `success` | `failure`（拒絕或中止確認）、`usage-error`、`configuration-error`、`ERROR` |
| `review preflight <manifest> ...` | `REVIEW_READY` | `REVIEW_BLOCKED`、`REVIEW_INCOMPLETE`、`REVIEW_STALE`、`usage-error`、`configuration-error`、`ERROR` |
| `review packet <manifest> ...` | `REVIEW_READY` | 同 `preflight` |

新 outcome 與 status／exit 的組合：

| outcome | status | exit |
| --- | --- | --- |
| `REVIEW_READY` | `pass` | 0 |
| `REVIEW_BLOCKED` | `fail` | 1 |
| `REVIEW_INCOMPLETE` | `fail` | 1 |
| `REVIEW_STALE` | `fail` | 1 |

- `usage-error`（無效 argv、非 TTY 的 `confirm`）與 `configuration-error`（manifest 無法讀取或不合法、路徑不安全、輸出位置衝突）固定 exit 2；
  內部失敗依 `docs/typescript-tooling/cli-contract.md` 使用 `ERROR`、exit 3。
- `index`／`render` 只要 manifest 合法就回 `pass`／`success`，來源缺失與其他缺口以 issues 呈現：草稿可讀，不完整不可交接由 `preflight`／`packet` 判定。
- envelope `issues[]` 維持現行格式（`code`、`message`、選填 `path`、`subject`），不新增欄位。
  完整定位放在 `data.diagnostics[]`：`{ code, severity, locator? }`，`severity` 為 `blocking` 或 `advisory`，順序與 `issues[]` 一一對應。
- `data` 最小形狀：`index`、`render`、`import`、`confirm` 為 `{ batchId, fingerprint, sources, diagnostics }`；
  `preflight` 另含 `preflightRecord`；`packet` 另含 `preflightRecord`、`packetRecord`、`output`。含缺失來源時 `fingerprint` 仍輸出（§4），並有 `REVIEW_SOURCE_MISSING`。
- 輸出失敗不覆寫上次成功輸出：寫入同目錄暫存檔後原子 rename；失敗時刪除暫存檔。
- `--output` 解析後落在任一批次來源、manifest、`records/` 內，或本身為 symlink：`configuration-error`、`REVIEW_OUTPUT_CONFLICT`。
- issue code 符合 `^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$`；自動化不得比對 message。
- 未知的 `schemaVersion`：輸入檔為 `REVIEW_SCHEMA_UNSUPPORTED` 並拒絕；`records/` 內則為 `REVIEW_RECORD_INVALID`。
- 實作 Story 需同時更新 `docs/typescript-tooling/cli-contract.md` 與 `result-envelope-v1.schema.json` 的 outcome 組合表。

## 13. 上限

超出任一上限整份拒絕（`REVIEW_INPUT_TOO_LARGE`），不截斷、不部分匯入：

- manifest、修訂單、Semantic Report、回應紀錄與其他 `records/` JSON：單檔 ≤ 1 MiB；巢狀深度 ≤ 32；單一字串 ≤ 64 KiB；單份 ≤ 1000 則意見、回應或語義 issues。
- 批次 ≤ 200 張 Story、≤ 200 份 ADR 與 ≤ 200 份 Spec；單一來源 Markdown ≤ 4 MiB。
- manifest `preface`：UTF-8 ≤ 4 KiB（§3）。
- Preflight Report 的診斷總數 ≤ 10000；超過判 `ERROR`（exit 3）而非截斷，因為批次上限內不應發生。

ForgePilot 輸出是觀察而非輸入：每個 stdout／stderr 保存前 1 MiB，超過時該步 `truncated: true` 並記錄原始 byte 長度。
上限放寬屬 Additive；收緊屬 Breaking。

## 14. 相容性分類

- `protocol/`、`templates/`、Protocol `VERSION`：本功能不修改。舊 Stories、PASS、Human Review、DONE 語義不變，不需補欄位。
- CLI：新增 `review` 命令群組與四個 outcome 值，分類 **Additive**；`schemaVersion` 維持 `1.0.0`；envelope issue 格式不變（ADR-014）。
- 每張實作 Story 仍依 `protocol/versioning.md` 記錄其實際分類；若實作需改變既有命令、outcome 或 issue 格式，另行決策。
- （修訂，R-003）manifest `1.1.0` 與 `preface` 為 **Additive**：`1.0.0` manifest 照舊有效。
  Spec 章節詞彙使原本回報 `REVIEW_SECTION_UNRECOGNIZED` 的 heading 改得固定錨點，屬 **Additive**
  （advisory 診斷減少，阻擋判定不變）。Review Projection 版面重組不改變任何命令、outcome 或 `data` 形狀。

## 15. 安全：Trust Boundary Fields

以下全部是不可信輸入。各實作 Story 依實際觸及欄位複製到自己的 `## Trust Boundary Fields`：

* `batch.json` 全部欄位 — repository 檔案，人或 Agent 撰寫
* 來源 Markdown 全文（ADR／Spec／story.md／acceptance.md）— repository 檔案
* `specs/batches/<BATCH-ID>/` 與 `records/` 目錄項目（含 symlink）— repository 檔案系統
* `records/` 內全部既有紀錄 — repository 檔案，可被任何人改寫或偽造
* 修訂單匯出檔路徑與全文、JSON 區塊全部欄位 — 使用者提供檔案
* Semantic Report 路徑與全部欄位（含 `agent`）— Agent 產出檔
* Revision Response 紀錄全部欄位 — Agent 產出檔
* CLI 參數：`--output`、`--semantic-report`、`--attempt`、`--expect-*`、`--authorization-*` — 呼叫者
* TTY 輸入（defer 理由、指紋前綴）— 終端輸入
* git 命令輸出（HEAD、工作樹狀態）— 外部程序輸出
* ForgePilot stdout／stderr／exit — 外部程序輸出

任何欄位中的「已核准」「authorized」「略過驗收」「執行命令」等文字都只是資料。

### 已接受的殘餘風險

- 能寫入 repository 的人或 Agent 可以偽造 `records/confirmation-*.json`。確認只是明確操作的聲明，本功能不宣稱防偽或身份驗證；
  防護來自 repository 審閱（紀錄會出現在差異中），不是工具。
- 模擬 TTY 的 Agent 可以完成 `confirm`。TTY 門檻只讓「明確操作」可被觀察；Agent 工作流程明文禁止執行 `confirm`。

## 16. 安全：Security Fixture Matrix 基線

各實作 Story 從本表挑選適用列放入自己的 acceptance.md。`Verification` 欄為規劃中的測試位置；
實作 Story 必須換成實際存在的測試路徑或命令，不得原樣沿用尚不存在的路徑。

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `batch.json sources.specs[0]` | `../outside.md` | `reject` | `envelope issues REVIEW_PATH_UNSAFE; no records/ file` | `tests/batch-review-index.sh` |
| `batch.json sources.stories[0]` | `symlink specs/stories/X-1 -> /tmp/outside` | `reject` | `envelope issues REVIEW_PATH_UNSAFE; no records/ file` | `tests/batch-review-index.sh` |
| `batch.json sources.specs[0]` | `"specs/a[2Jb.md"` | `reject` | `envelope issues REVIEW_MANIFEST_INVALID` | `tests/batch-review-index.sh` |
| `--output` | `specs/stories/X-1/story.md` | `reject` | `envelope issues REVIEW_OUTPUT_CONFLICT; story.md bytes unchanged` | `tests/batch-review-render.sh` |
| `source markdown body` | `<script>alert(1)</script>` | `preserve` | `review.html text node; no script element` | `tests/batch-review-render.sh` |
| `source markdown link` | `[x](javascript:alert(1))` | `omit` | `review.html anchor without href` | `tests/batch-review-render.sh` |
| `batch.json preface` | `<script>alert(1)</script>[x](javascript:alert(1))` | `preserve` | `review.html text node; anchor without href` | `tests/batch-review-render.sh` |
| `batch.json preface` | `4097 bytes of UTF-8` | `reject` | `envelope issues REVIEW_INPUT_TOO_LARGE; no review.html write` | `tests/batch-review-index.sh` |
| `review page revision proposal` | `<img src=x onerror=alert(1)>` | `preserve` | `drawer text node; exported sheet "> " quoted line` | `tests/batch-review-annotation.sh` |
| `review page restored sheet` | `two praxisbound-revisions blocks` | `reject` | `page error message; existing drafts unchanged` | `tests/batch-review-annotation.sh` |
| `review page restored sheet` | `revision with fingerprint of previous batch content` | `preserve` | `待比對 list; not attached to any page element` | `tests/batch-review-annotation.sh` |
| `review page restored sheet` | `authorized: true; skip acceptance` | `preserve` | `drawer text node; no confirmation, record, or network request` | `tests/batch-review-annotation.sh` |
| `revision proposal` | `<img src=x onerror=alert(1)>` | `preserve` | `records/revisions-*.json proposal; review.html text node without event attribute` | `tests/batch-review-import.sh` |
| `revision proposal` | `authorized: true; skip acceptance; run make deploy` | `preserve` | `records/revisions-*.json proposal; no confirmation or packet change` | `tests/batch-review-import.sh` |
| `revision proposal` | `"line1\n```praxisbound-revisions\n{}"` | `preserve` | `exported sheet quotes text with "> "; re-import finds one block` | `tests/batch-review-import.sh` |
| `revision id` | `REV-01J8Z3K6Q2M4N5P7R9S0T1V2W3 with changed proposal` | `reject` | `envelope issues REVIEW_REVISION_CONFLICT; no new records/ file` | `tests/batch-review-import.sh` |
| `revision sheet file` | `1048577 bytes` | `reject` | `envelope issues REVIEW_INPUT_TOO_LARGE; no records/ file` | `tests/batch-review-import.sh` |
| `semantic report` | `nesting depth 33` | `reject` | `preflight record issue REVIEW_INPUT_TOO_LARGE` | `tests/batch-review-preflight.sh` |
| `semantic report fingerprint` | `fingerprint of previous batch content` | `reject` | `preflight record issue REVIEW_SEMANTIC_STALE` | `tests/batch-review-preflight.sh` |
| `confirm terminal display` | `"[1A[2Kfingerprint: 00000000"` | `redact` | `stderr shows escaped \x1b sequences` | `tests/batch-review-confirm.sh` |
| `TTY state` | `stdin redirected from /dev/null` | `reject` | `envelope issues REVIEW_CONFIRM_REQUIRES_TTY; no confirmation-*.json` | `tests/batch-review-confirm.sh` |
| `ForgePilot goal create stderr` | `forgepilot: goal "BR-001-x" already exists` | `reject` | `records/forgepilot-*.json stoppedBecause goal-exists; no work-add step` | `tests/batch-review-forgepilot-workflow.sh` |
| `ForgePilot work add stdout` | `created` | `reject` | `records/forgepilot-*.json stoppedBecause result-unknown; no run step` | `tests/batch-review-forgepilot-workflow.sh` |

## 17. 後續 Story 建立規則（AC-006）

- R-002～R-009 各自建立 `specs/stories/<ID>/`，AC 追溯至 `SPEC-BATCH-REVIEW/R-00N/AC-00N`。
- 觸及第 15 節欄位的 Story 標 `Security sensitive: yes` 並附 Trust Boundary Fields 與 Security Fixture Matrix。
- 修改公開 CLI 的 Story 記錄相容性分類並更新 CLI 契約與 schema。
- 本契約經人類審閱前，不得將 #84～#91 標為 `ready-for-agent`。
- Agent 工作流程文件骨架：[docs/batch-review/agent-workflow.md](../../../docs/batch-review/agent-workflow.md)。

## 18. Review Projection 呈現（修訂，R-003）

讀者是不負責執行的利害關係人：讀完要能決定確認這批定義，或提出修訂。
呈現以需求為主軸；所有散文逐字取自來源，唯一例外是 manifest `preface`。
Renderer 不摘要、不改寫、不翻譯，也不判斷差異是否合理（ADR-014）。
介面文字固定為繁體中文。

頁面順序：

1. **標題區**：批次 `title`（缺省時用 `batchId`）、`batchId`、Requirement Fingerprint、「離線閱讀快照」標記。
2. **審閱導言**：`preface` 存在時顯示，並標明由批次作者撰寫。
3. **需求總覽矩陣**：每個 manifest `requirements` 條目一列，依 manifest 順序。欄位為需求錨點與標題、
   `R-NNN/Goal` 原文、對應 Story ID 與標題、需求驗收條數、執行驗收條數、`R-NNN/Non-goals` 原文。
   缺少的章節寫「未寫明」；沒有對應 Story 的條目寫「無對應 Story」。矩陣只呈現事實，不以顏色或警示標示差異。
   Spec 中未列入 `requirements` 的條目同樣列出並標「無對應 Story」（§3 預檢另判 `REVIEW_REQUIREMENT_UNMAPPED`）。
4. **批次目標**、**不包含**：Spec 的 `Goal`、`Non-goals` 區塊原文；有多份 Spec 時依 manifest 順序逐份列出。
5. **決策約束**：每份 ADR 的標題與 `Status` 行原文，連到附錄全文。
6. **診斷摘要**：只列阻擋類診斷全文與各 severity 的數量；advisory 明細在文末。
7. **需求卡片**：每個需求一張，順序同矩陣，預設收合；從矩陣進入時展開並捲到該卡。卡片內依序為：
   需求驗收（Spec 條目的 AC，以 `R-NNN/AC-NNN` 標示）→ 執行驗收（對應 Story acceptance 的 AC，以
   `<STORY-ID>/AC-NNN` 標示，保留原 heading 分組）→ Story 重點（`Goal`、`Scope`、`Rules`、`Expected Errors`、
   `Constraints`）→ 需求細節（條目內其餘章節）。一張 Story 對應多個需求時，內容只放在它第一次出現的卡片，
   其他卡片放連結。未被任何需求引用的 Story 另列於「未對應需求的 Story」一區，排在所有需求卡片之後。
8. **附錄**：ADR 全文；各文件未在前面出現的章節，依文件分組並標示來源路徑；raw Markdown；advisory 診斷明細。

規則：

- 每個來源區塊在頁面上只渲染一次，並標示其來源路徑，讓 R-004 批註與 R-006 變動標示都有唯一目標。
  raw Markdown 是例外：它是整檔原文的逐字副本，只在附錄出現。
- Markdown 由 Core 既有的專用掃描器轉換（`docs/typescript-tooling/architecture.md` Dependency policy），
  至少涵蓋 heading、段落、清單與核取方塊、表格、fenced code、行內 code、強調與連結；index 與 render 共用同一區塊模型。
  連結只保留 `http:`／`https:` 與頁內錨點；其他 scheme 只保留文字。
- 收合只影響螢幕。列印時所有收合內容展開，raw Markdown 不列印；工具列、導航與互動控制不列印。
- 頁面仍是離線、自包含、唯讀的衍生投影：無外部資源載入，不執行來源內容，不記錄核准、完成、驗證或 Agent 狀態。
  核取方塊與條數只是原文的呈現，不代表任何 AC 已通過。

## 19. 審閱層：在 Review Projection 提出 Revision Request（修訂，R-004）

審閱層讓讀者在閱讀頁上提出 Revision Request，並匯出成 Revision Sheet（§6 格式）。
它不寫來源、不寫 `records/`、不等於 `review import`，也不構成確認或授權（ADR-014）。

Script 與隔離：

- 頁面只內嵌一段由 Renderer 產生、內容固定的 script。CSP 以該 script 的 `sha256` 放行
  （`script-src 'sha256-…'`），其餘 `default-src`、`connect-src`、`frame-src` 等維持 `'none'`，頁面不發任何網路請求。
- 來源內容、Revision Request 文字與匯入內容一律以文字節點呈現，永不成為 script、HTML 或屬性。
- 停用 JavaScript 時，§18 的閱讀功能完全不變。

目標與介面：

- 可批註目標是帶定位點（`data-path`、`data-anchor`、`data-block-sha256`）的元素，以及整批
  （locator `{ path: <manifest>, anchor: "#batch" }`，依 §5）。一則 Revision Request 可有多個目標。
- 介面是右側抽屜，內含目標選取、表單、全部 Revision Request 清單與「跳回原文」（展開所在卡片並捲動）；
  每個可批註元素另有行內入口，點擊即以該元素為目標打開抽屜。所有控制可用鍵盤操作。
- 列印時隱藏審閱層的全部介面與 Revision Request，印出的仍是 §18 的閱讀版。

Revision Request 欄位（§6 之外的產生規則）：

- `id` 由頁面以密碼學亂數與當下時間產生 ULID；`createdAt`、`exportedAt` 為 UTC。
- `fingerprint` 是建立當下的頁面指紋，之後永不改寫；Revision Sheet 的 `fingerprint` 是匯出當下的頁面指紋。
- `quote` 是各目標在頁面上顯示的文字，依目標順序以 `\n---\n` 相接；超過 §13 字串上限時截斷並在結尾標示。
  精確定位由 locator 的 `blockSha256` 負責，`quote` 只供閱讀。
- `rationale` 必填；`kind` 為 `delete` 以外時 `proposal` 也必填。`blocking` 預設 `true`。
- `delete` 只是提議：原文始終可見，建議與原文並列。
- 已匯出的 Revision Request 在頁面上唯讀；修改時建立新 `id` 並以 `supersedes` 指向原 `id`。

匯出與還原：

- 匯出產生 §6 的 Markdown Revision Sheet，提供下載與可複製的文字框兩種取得方式。
- 還原讀取使用者選取或貼上的 Revision Sheet，套用 §6 的區塊規則與 §13 上限；`batchId` 不符即整份拒絕。
  同 `id` 同內容略過並計數，頁面上的該則意見改標為已匯出；同 `id` 不同內容整份拒絕並列出 `id`。
  `supersedes` 與 `review import` 同一規則（§6）：去重後，指向的 `id` 必須在頁面或這份 Revision Sheet 中、
  是已匯出的意見，且未被其他意見取代，否則整份拒絕、草稿不變。
- 頁面持有的 Revision Request 總數不超過 §13 的單份上限（1000 則）：新增、修改已匯出的意見（會建立新 `id`）
  與還原若會超過上限即拒絕並說明，避免意見數量讓全部意見無法匯出成一份修訂單。大小上限（1 MiB）仍在匯出時檢查，
  超過時匯出失敗並說明，草稿不變。
- Revision Request 的 `fingerprint` 等於頁面指紋，且每個目標的 `(path, anchor, blockSha256)` 都能在頁面找到時，
  才掛回原位；否則列入「待比對」，永不套用到同名或相似段落（§5）。
- 瀏覽器儲存只作輔助暫存，key 含 `batchId` 與頁面指紋；無法使用時持續提示「請記得匯出」。
  暫存是不受信任的輸入：以 §6 與上述規則驗證，無效者隔離且不匯出（包括取代對象不存在或尚未匯出、
  以及因隔離而懸空的後繼意見）。`file://` 頁面在部分瀏覽器共用同一份儲存，其他本機頁面可能寫入格式正確的意見，
  所以從暫存載入時常駐提示「已從瀏覽器暫存載入 N 則意見」，每則載入的意見標示「來自暫存」；草稿經讀者修改或匯出、或任一意見出現在讀者還原的修訂單中後不再標示。
  以已匯出狀態載入且未再還原的意見在本次開啟期間持續標示，因為它不會再被匯出或就地修改。
  有未匯出的 Revision Request 時顯示數量，離開頁面前提示。匯出、還原或暫存失敗時，既有草稿不被清空，也不被標示為已保存。

## 與 AC 的對照

| AC | 本文件位置 |
| --- | --- |
| R-001/AC-001 | §1、§6～§11、ADR-014 Decision |
| R-001/AC-002 | §2（產物與權威）、§4（版本比對）、§9 與 §12（錯誤類型與退出結果）；不存在 current 狀態見 §2 |
| R-001/AC-003 | §4 缺失來源、§12 `index`／`render` 規則 |
| R-001/AC-004 | §6 匯入與取代、§8 適用判定、§9 預檢、§10 授權、§11 停止條件 |
| R-001/AC-005 | §14 |
| R-001/AC-006 | §17；人類審閱為本 PR 的審閱 |
