# Spec：Spec／Story 整批 HTML 審閱、修訂與執行交接

Spec ID：`SPEC-BATCH-REVIEW`。需求整理日期：2026-09-17。

本文件將使用者提供的 review 開發包整理為需求基線，供契約設計與 ticket 拆分。
它不是已接受的 ADR、已批准執行的 Story，或功能已完成的證據。
本次授權涵蓋整理 spec 與建立 GitHub issues；不包含實作功能或啟動 Runner。
R-001 的 ADR／詳細契約需經人類審閱，後續工作再建立各自 Story 與 acceptance。

## 目標與使用者流程

使用者一次審閱明確交付批次內的 Spec、Story、acceptance 與相關 ADR，
在離線 HTML 提出修改，由既有 Agent 回到正確定義來源修訂。
人類確認整批定義後，Agent 完成開工前檢查；取得明確交付執行授權才可
經既有 ForgePilot 公開 CLI 交接，推進至技術驗證完成／等待 Goal 最終總檢。

```text
ADR → Spec → Stories → 批次來源快照 → HTML 審閱
                                      ↓ 有意見
                                  匯出修訂單 → Agent 回修來源
                                      ↑          ↓
                                      └── 新版 HTML／差異／逐項回應
                                      ↓ 明確整批確認
                                  開工前機械＋語義檢查
                                      ↓ 無阻擋且有執行授權
                                  交接資料 → 外部 Agent／ForgePilot Runner
                                      ↓
                                  等待 Goal 最終總檢
```

預檢若需要改變已確認定義，回到修訂與複審。一般程式錯誤／測試失敗
留在既有 Runner 修復循環。無 ForgePilot 仍可完成閱讀、修訂與通用預檢／交接資料輸出。

## 範圍、權威與共通規則

- 「整批」只包含明確選定文件，不自動加入 repository 的歷史資料。
- ADR／Spec／Story 是定義來源；HTML 是閱讀投影，修訂單是修改提議。
  未識別章節與完整原文必須保留，不以 AI 摘要取代來源。
  Story／acceptance 仍是已批准執行意圖的邊界；草擬 Spec 不能自行覆蓋已批准 Story 或 ADR。
- PraxisBound 保存來源綁定的歷史 Evidence，不保存第二份 current Work Item、
  Gate、review、progress 或 completion state。外部 control plane 保有生命周期權威。
- 人類定義確認、交付執行授權、預檢無阻擋、程式驗證 PASS、Human Review 最終接受
  是不同事件；前者不推導後者，也不推導 commit／push／deploy 等額外操作授權。
- HTML、Markdown、匯入回饋及其中的指令／核准宣稱均是不可信資料。
  本機確認只是明確操作的聲明，沒有身份驗證、防偽或電子簽章保證。
  交接資料只能記錄請求或已觀察的授權；檔案中的 `authorized: true` 不產生操作權。
  每次來源修改、建立 Goal／Work Item、啟動 Runner 或其他效果前，必須重新解析
  適用的 Story、當前使用者會話或 control plane 授權；仍有效的既有授權不需重複詢問。
- 來源指紋包含實際內容、文件集合與需求關係，包含尚未提交的修改；
  Git HEAD 不是唯一版本依據。衍生 HTML、匯出時間與執行驗證產物不參與需求指紋。
- 草稿可讀，但必要定義、檢查、確認或授權不完整時不可交接。
  skipped／blocked／unsupported 與缺證據必須保留，不能當作 PASS。
- 新能力是選用的 Reference Tooling，不提高既有 Adoption 的最低要求，
  不無條件改動舊 Stories、PASS、Human Review 或 DONE 語義。
- 實作每一項時都建立自己的測試並執行 canonical `make verify`；
  R-009 補跨功能驗收，不代替各項測試。fixture 位於獨立暫存 repository。
- 一般自動化 gate 不依賴付費模型、外部模型連線或正式 ForgePilot state；
  真實 Agent、瀏覽器與 ForgePilot 演練另保留可追溯 Evidence。

## 產物與責任

下表定義需求層級的用途；序列化格式、檔名、欄位、命令、結果與 exit code
由 R-001 定稿，不把此表當成可直接實作的 schema。

| 產物 | 最小責任 | 權威／限制 |
| --- | --- | --- |
| 批次清單與來源索引 | 明確範圍、版本、內容指紋、穩定定位、Spec → Story → AC 對應、診斷 | 只讀來源，不猜測覆蓋 |
| 閱讀快照／HTML | 完整來源、導航、診斷、版本、差異與回應 | 衍生投影，不直接回寫來源 |
| 修訂單 | 穩定意見 ID、目標與原文、來源版本、類型、建議與理由 | 單一可匯出／匯入格式，不是執行授權 |
| 逐項回應 | 每個修訂 ID 的處理、理由、定位與新版本 | 歷史 Evidence，不等同人類核准 |
| 整批定義確認 | 範圍、指紋、時間、未決／延後事項 | 來源變更失效；與執行授權分離 |
| 預檢報告 | 機械與語義觀察、基線、來源、問題、阻擋性、完整性 | 不是實作後驗證或語義正確性證明 |
| 開工交接資料 | 來源、確認、預檢、Stories、依賴、上下文、授權 | 不是 `protocol/handoff.md` 的已執行驗證 Evidence |
| 外部整合觀察 | 真實 Goal／Work Item ID 對應、公開 CLI 操作結果與部分失敗 | 以 ForgePilot 現況為準，不保存第二份即時狀態 |

## 既有契約與待決事項

1. [Lifecycle](../../../protocol/lifecycle.md) 與
   [Handoff](../../../protocol/handoff.md) 保持原權威。R-008 中查詢／寫入 ForgePilot
   是獲授權的外部 Agent 工作流程，不能讓 PraxisBound production code
   讀寫 `.forgepilot` 或重建 Runner。
2. ADR-003 與 [Architecture contract](../../../protocol/architecture.md)
   的架構分析非目標保留；R-007 的語義審閱由既有 Agent 執行，工具只檢查
   結構、定位及報告完整性。不得把架構分析器加入 PraxisBound。
3. [現行公開 CLI 契約](../../../docs/typescript-tooling/cli-contract.md) 與
   [已發布 JSON schema](../../../docs/typescript-tooling/result-envelope-v1.schema.json)
   是命令整合依據；ADR-007／008 尚標為 proposed，不能將其早期文字誤認為已發布 schema。
   R-001 必須決定新命令如何符合現行 JSON envelope、錯誤分類、結果優先序與 exits。
4. R-001 必須定稿：批次 manifest 與關係表示、穩定定位、指紋演算法／正規化、
   產物版本／相容性、修訂單格式、匯入上限與重複／衝突處理、來源過期比對、
   明確確認與執行授權如何分別取證，以及必要機械／語義檢查的完整性判定。
5. R-001／R-008 必須定義來源重查與外部效果之間的變動處置、重試識別、
   部分成功與無法確定結果的停止條件。ForgePilot 的 Candidate／乾淨工作樹／
   精確 revision 驗證需求，不能用 dirty working tree 的需求指紋取代；
   必要 commit 等操作仍需獨立授權，不足則阻擋並報告。
6. 建議命令 `praxisbound review render <batch> --output <review.html>` 與
   `READY_FOR_HANDOFF`／`BLOCKED`／`INCOMPLETE`／`STALE` 都是設計輸入，尚非公開功能。
   狀態語義需定稿，不得直接添加不符合現行 envelope 的頂層 status 值。
7. 預期新增選用功能為 **Additive**；本次只新增規劃文件，不修改 versioned surface
   或 `VERSION`。每張將修改 protocol／templates／公開 CLI 的 Story 仍須依
   [versioning](../../../protocol/versioning.md) 記錄實際分類；若產生 Breaking 影響，
   需另行決策及 migration guidance，不能沿用 Additive 宣稱。
8. [TST-016](../../stories/TST-016-forgepilot-integration-contract/story.md)
   只證明 packed CLI process consumer；它的可選真實 ForgePilot 觀察不證明本期整合。
   本期 R-008／009 仍要求版本明確的真實演練。公開介面缺口需明確提出後續
   ForgePilot issue；本期不修改 ForgePilot Runner 或其最終接受功能。

9. Repository 尚未定義一般 Spec artifact contract。R-001 必須決定 Spec 的表示方式、
   ADR／Spec／Story 的衝突處置與追溯規則；預設維持既有 Story 執行權威，
   不從本規劃文件直接推定新 Protocol 欄位、來源優先序或批准。
10. R-001 必須記錄安全與公開契約的風險、Trust Boundary Fields 與 Security Fixture Matrix；
    後續各 Story 依實際風險分類。涵蓋惡意內容、偽造授權、路徑跳脫、過期／重複輸入、
    大量／深層輸入、輸出失敗與外部結果不明等邊界；此處不預定數值限制或儲存實作。
11. R-005 的工作流程保持可由既有 coding agent 使用；若附 vendor-native Skill，
    依 [ADR-012](../../decisions/ADR-012-vendor-neutral-machine-consumable-adoption-path.md)
    保持選用與明確啟用，不成為 batch review 或 Adoption 的必要條件。

## 需求追溯與交付順序

R-001 → R-002 → R-003 → R-004 → R-005 → R-006 → R-007 → R-008 → R-009。
R-009 同時驗收 R-001～008 的完整交付。R-003 後先驗收閱讀體驗；
R-005 後演練修訂閉環；R-008 後才有完整交付執行路徑。

以下 R 編號對應原稿 PB-REVIEW-001～009，僅為需求追溯，未占用 Story ID。
每項 AC 以 `SPEC-BATCH-REVIEW/R-00N/AC-00N` 識別，避免各節同名 AC 混淆。
GitHub issue 編號與後續 Story ID 另建立映射；工作進度只由 issue／外部 control plane 管理。
發布 ticket 時依上述順序建立，使用真實 issue 編號與 GitHub 原生依賴；
若原生依賴不可用，內文使用 `Blocked by: #實際編號`。依既有 triage 流程，
只有需求、授權與依賴齊備且可獨立執行的 ticket 才能標 `ready-for-agent`。

## R-001：定義 Spec／Story 整批審閱與交接契約

### 目標

先確定本功能的使用流程、資料意義與授權邊界，再交付後续功能開發；本 Issue 只做定義，不開發 Renderer 或 Runtime。

### 依賴

無。這是後續 Issue 的契約基礎。

### 工作內容

建立必要 ADR 與功能 Spec，描述本次交付批次如何選取 ADR、Spec、Story 及 acceptance，以及如何追溯各項需求。定義閱讀快照、修訂請求、逐項回應、人類定義確認、預檢報告與執行交接資料的最小契約。

文件格式與檔名在此定稿；不要求額外引入資料庫或 Workflow 服務。契約須具有版本標記、批次識別、來源指紋與可回到原文的目標定位。內容指紋應涵蓋實際來源內容，而非只記 Git HEAD；衍生 HTML、匯出時間與執行驗證產物不納入需求來源指紋。

明確區分來源變更、呈現修正、既有 Spec 的 Story 推導錯誤，以及真正的新需求／決策。HTML 與匯入回饋都是不可信輸入；檔案中的「已批准」或指令文字不得自行擴大 Agent 授權。

本機審閱紀錄是明確操作留下的聲明，不宣稱具備身份認證或防偽簽章能力。人類需求確認不等於程式成果的最終 Human Review。

### 驗收條件

- AC-001：ADR／Spec 完整描述兩條路徑：有意見時修訂再審，以及無阻擋時交接執行。
- AC-002：定義所有輸入／輸出產物、來源權威、版本比對、錯誤類型與退出結果；不存在兩份即時任務狀態。
- AC-003：決定草稿可閱讀、未完整不可交接的規則；缺欄位不妨礙人類查看可讀內容。
- AC-004：定義文件改動、批次增刪、未決阻擋、授權不足時的行為；不存在靜默沿用舊核准的路徑。
- AC-005：本功能對 protocol／templates 的變更完成相容性分類；不為新選用功能無條件要求所有舊 Stories 補欄位。
- AC-006：後續 Issue 可依此建立各自 Story 與驗收條件；定義經人類審閱後才進入實作。

### 不包含

HTML 開發、模型串接、派發器、任務狀態服務，以及重寫既有 Spec → Story 推導流程。

### 完成證據

提交 ADR／Spec 與契約範例，執行本 Repository 適用的檢查及完整 make verify，清楚區分文件檢查與尚未實作的功能驗證。

## R-002：建立整批來源索引、版本快照與需求追溯

### 目標

使用者指定本次交付範圍後，能完整列出待審 Spec、Stories、acceptance、相關 ADR 與它們的關係，作為 HTML、回饋與交接共同使用的來源。

### 依賴

Blocked by：R-001。

### 工作內容

接受明確的批次清單，讀取來源與內容指紋，建立穩定定位。優先沿用既有 ID、Spec 引用、AC ID 與依賴；沒有既有對應時允許在批次資料中明確補充，不假裝從相似文字就能確定對應。

保留完整原文、未識別章節及來源位置。區分「內容可讀」與「已符合開工條件」：不完整草稿可以進入閱讀投影，缺口以診斷呈現。

索引只讀來源；拒絕來源逃離授權 Repository 根目錄，包含路徑跳脫與 symlink 指向外部的情況。輸出位置不得覆寫 canonical 文件。

### 驗收條件

- AC-001：一批可包含多份 Spec 與多張 Stories；結果只包含明確選定的交付範圍。
- AC-002：可追溯 Spec 條目 → Story → AC；無對應或無法判斷的項目明確列出，不自動標示完整覆蓋。
- AC-003：新增、刪除或修改來源會改變批次指紋；未提交修改亦能被偵測；只重新 Render 不改變需求指紋。
- AC-004：來源缺失、重複 ID、無效引用、未識別章節均有明確處置，不靜默刪除內容。
- AC-005：可閱讀的未完成草稿仍可產生索引，並標示尚缺定義；這些診斷會供後續預檢使用。
- AC-006：路徑跳脫、外部 symlink 與來源／輸出衝突被拒絕，原文件與既有成功輸出不受破壞。

### 測試與交付

涵蓋多 Spec／多 Story、dirty working tree、相同標題、繁體中文、失效引用、未識別章節及路徑安全 fixtures。新增測試納入 make verify，不另建第二個完成門檻。

## R-003：產生紙本感、離線可讀的 Spec／Story HTML 審閱版

### 目標

讓非執行者也能舒服閱讀整批需求，清楚判斷目標、範圍、規則與驗收，而不是只得到原始 Markdown 預覽。

### 依賴

Blocked by：R-002。

### 工作內容

加入本輪新增的 Render CLI 介面。建議命名為 `praxisbound review render <batch> --output <review.html>`，實際參數沿用 R-001 定稿的 CLI 契約；此命令目前是待實作提案。

輸出自包含 HTML，先呈現批次目標、來源版本、Spec／Story 目錄與需求對應，再提供完整文件。Story 區突出 Goal、Scope、Rules、Expected Errors、Constraints 與 Acceptance；原文仍可完整查閱，Renderer 不以 AI 改寫或自行摘要取代內容。

採紙本／編輯式排版、清楚章節、充足留白與繁體中文閱讀層次。加入頁內導航及列印樣式，支援長篇文件、長表格與程式碼。固定工具列與審閱控制不得出現在純閱讀列印版中。

### 驗收條件

- AC-001：從明確批次輸入產生一份 HTML，可從 Spec 導航到對應 Story／AC；完整原文及診斷均可取得。
- AC-002：以本機檔案直接開啟即可閱讀；不依賴 CDN、遠端字型、遠端圖片或網路 API，載入文件不發出外部請求。
- AC-003：於桌面與窄螢幕 fixture 可閱讀，鍵盤可操作導航；長表格與程式碼不使整頁失去可讀性。
- AC-004：於明確記錄的驗收瀏覽器，A4 列印預覽不裁掉必要內容；列印完整內容而非只印目前展開的部分。
- AC-005：顯示來源與閱讀快照標記；未執行的 AC 不被呈現為測試 PASS，閱讀次數與核取方塊不代表完成驗收。
- AC-006：來源或回饋中的 script、事件屬性、危險 URL 與嵌入式內容不能執行；安全顯示不破壞原文的閱讀意義。
- AC-007：Render 失敗不覆寫上次成功輸出；不修改來源文件，不隱含核准、執行 make verify 或啟動 Agent。

### 不包含

多主題選單、圖表生成、後端服務、原生 PDF 產製、簽核或派發功能。

### 測試與交付

提供代表性視覺 fixture、實際畫面與列印預覽檢視證據。自動化涵蓋內容完整性、離線載入、鍵盤操作、惡意內容與輸出失敗；測試納入 make verify。列印支援以實測瀏覽器為準，不宣稱所有瀏覽器像素一致。

## R-004：在 HTML 中批註、提出修改並匯出／還原修訂單

### 目標

使用者在讀到問題的位置直接提出意見，匯出一份 Agent 能追溯來源的修訂單，不必另寫長篇交辦 Prompt。

### 依賴

Blocked by：R-003。

### 工作內容

加入閱讀／審閱模式。以 Spec 條目、Story 區塊與 AC 為第一版定位單位，提供補充、建議改寫、新增要求及刪除建議；不必先做任意字元範圍的複雜文字選取。

保留原文並並列建議，修改提議不能直接覆寫正式內容。每項意見自動帶入穩定 ID、批次及來源版本、文件及章節定位、原文、修改類型、建議內容與理由。

支援一份具可機器解析欄位的閱讀式修訂單匯出，及同一格式的匯入還原；精確格式遵循 R-001。不讓兩份分別可編輯的匯出物成為互相衝突的輸入來源。

### 驗收條件

- AC-001：同一批次可對多份 Spec 與 Stories 留下意見，所有意見可在總覽定位回原文。
- AC-002：補充、改寫、新增與刪除建議保留不同語義；原文始終可見，刪除提議不把原始要求真正刪掉。
- AC-003：匯出後關閉頁面，再重新開啟 HTML 並匯入，可完整還原意見、關聯及原文；不依賴 localStorage 成為唯一保存方式。
- AC-004：儲存不可用、匯入格式錯誤或匯出失敗時有清楚提示；既有草稿不被清空或標成已成功保存。
- AC-005：重複匯入相同修訂單不重複建立意見；版本不同的意見標示待比對，不套用到碰巧同名的段落。
- AC-006：跨段落、跨 Story 或整批意見均可記錄；有尚未送出的修改時提供可見提示。
- AC-007：匯入內容與建議文字不執行程式、不改寫來源、不自動當作核准或擴大 Agent 授權。

### 不包含

多人同步、雲端草稿保存、富文字編輯器、直接修改 Repository 或自動呼叫 AI。

### 測試與交付

涵蓋繁體中文、多行、引號、程式碼、特殊字元、重複匯入、不同來源版本、儲存被停用及惡意回饋。上述測試納入 make verify。

## R-005：將修訂單交給 Agent，修正來源並產生差異與逐項回應

### 目標

使用者匯出的意見能回到正確的 ADR／Spec／Story，並在下一版 HTML 看見每項意見如何被處理。

### 依賴

Blocked by：R-004。

### 工作內容

提供可交給既有 coding agent 使用的工作流程／Skill 與結果契約。以修訂單、來源版本、現行定義及明確授權作輸入；不在 PraxisBound 建立新的模型 API、Runtime 或排程器。

逐項辨識：呈現錯誤修 Renderer；Story 沒有忠實推導 Spec 時修 Story；新需求回到 Spec；涉及決策與取捨時依既有 ADR 政策提出更新或替代決策，不靜默覆寫已接受決策。

只有在授權範圍內才修改文件。需求不明、意見互相衝突、或需要人決定時輸出具體問題；本階段不實作目標產品程式碼。修正後重新推導受影響 Stories、重新 Render，並輸出新增／修改／移除摘要及逐項回應。

### 驗收條件

- AC-001：每個修訂 ID 都有本輪處理回應、理由與對應來源；不能悄悄省略，不能只回覆「已處理」。
- AC-002：回應區分已納入修訂草案、需要決策與未納入及理由；Agent 回應不自動代表人類核准。
- AC-003：提供 fixture 證明三種來源路徑：呈現修正、既有 Spec 的推導修正、涉及新決策的需求修訂。
- AC-004：來源已更新或目標消失時先比對差異；不能用舊原文靜默覆寫新定義，不能模糊猜測目標。
- AC-005：新版 HTML 顯示變更內容、來源與修訂回應；未受影響文件不被無理由重寫。
- AC-006：回饋中的「略過驗收」「刪除測試」「自行核准」「執行命令」不取得高於既有授權的效力。
- AC-007：新產物與新來源版本綁定，舊回應保留為歷史，不充當即時 Work Item 或審閱狀態。

### 測試與交付

自動測試涵蓋修訂輸入／輸出契約、定位、差異與完整回應；另外保留一次真實 Agent 修訂演練的記錄。一般 make verify 不依賴付費模型或外部連線，且不宣稱 fixture 能保證所有語義判斷正確。

## R-006：記錄整批定義確認，並拒絕沿用過期版本

### 目標

讓使用者以一次明確動作確認整批需求，同時確保後續執行拿到的就是該次審過的內容，而不是一個可永遠沿用的「approved」欄位。

### 依賴

Blocked by：R-005。

### 工作內容

在人類審閱介面提供整批確認動作，產生綁定批次內容的歷史決定紀錄，包含範圍、來源指紋、紀錄時間及當時的未決事項。區分「需求確認」與「交付執行授權」，後者可在一次交接時明確給予，不能從需求核准推定 commit／push／deploy 授權。

加入可由後續預檢與交接重用的當前來源比對。HTML 只是匯出時的快照；本機 Repository 是否已改變，要由讀得到來源的工具再次確認，不能由離線 HTML 假裝知道。

這是前置需求審閱的紀錄，不是 ForgePilot 的即時 review state，也不是程式成果接受紀錄。不做帳號系統、電子簽章或身份驗證能力宣稱。

### 驗收條件

- AC-001：使用者可以一次確認批次全部定義，不必對每張 Story 操作獨立放行流程；閱讀進度不能替代明確確認。
- AC-002：存在未解決的阻擋意見時不能交付執行；非阻擋建議的延後處理須有明確記錄，不隱藏忽略。
- AC-003：任何納入批次的來源內容變動或批次增刪，會讓舊確認對當前版本失效；生成時間或重建 HTML 不造成假失效。
- AC-004：發現過期時列出受影響內容供複審，不能自動改成新版本已核准，也不要求重新閱讀所有未變更內容。
- AC-005：修改後保留舊紀錄為歷史；Agent 的回饋、文字宣稱或預檢結果不能自行創造人類確認。
- AC-006：紀錄不寫入 Story lifecycle、ForgePilot Work Item、Gate 或 DONE；需求確認不等於成果最終接受。

### 測試與交付

涵蓋來源內文變更、新增／刪除文件、dirty working tree、僅重 Render、未決阻擋及偽造核准文字。驗收測試納入 make verify。

## R-007：建立 AI 開工前檢查與結構化阻擋報告

### 目標

在人類已確認整批定義後，檢查是否具備開始執行的條件；有問題回到定義修訂，未發現阻擋才允許交接。這不是取代實作後的 make verify。

### 依賴

Blocked by：R-006。

### 工作內容

分開兩類檢查。機械檢查重用現有 Story／readiness／verification contract 能力，確認來源與審閱版本、需求引用、依賴缺失或循環、必要驗收規劃、執行授權及可檢查的環境條件。語義檢查由既有 AI Agent 依工作流程閱讀 Spec／Stories，提出需求漏拆、相互矛盾、驗收不足與待決事項。

PraxisBound 的工具驗證結構、對應與報告完整性；不宣稱機械驗證能證明 AI 對業務語義的判斷正確。兩種檢查結果分開列示，全部必需部分都完成才可交接；單一句「沒問題」、Agent exit 0 或空白結果均不夠。

檢查結果需綁定來源與相關檢查契約／基線，記錄來源定位、觀察、影響、阻擋性及建議處理。建議結果名稱為 READY_FOR_HANDOFF、BLOCKED、INCOMPLETE、STALE；在 R-001 定稿。

### 驗收條件

- AC-001：缺少必要文件、確認過期、明確依賴循環、未解決阻擋、必要條件未檢查或授權不足時，不輸出可交接結果。
- AC-002：AI 語義檢查未執行、報告空白／格式錯誤或來源不符時顯示 INCOMPLETE／STALE，而非默認通過。
- AC-003：每項問題都可追溯至來源與理由；非阻擋改善建議不強制推翻已審需求，不造成無止盡重設計。
- AC-004：檢查不擅自修改已確認的 Spec／Story；必要修改回到修訂與複審流程。
- AC-005：只檢查開工條件與適用的現有基線；不要求尚未實作的新功能測試在開工前通過，也不將預檢當作成果驗證。
- AC-006：明確區分機械結果與 Agent 語義觀察；「未發現阻擋」不宣稱沒有任何缺陷。
- AC-007：輸出可供 Agent 解析，並且本命令／檢查流程不寫 ForgePilot state、不自動啟動工作。

### 不包含

內建 LLM 供應商抽象、新的模型評分機制、另一套 make verify、直接修產品實作或新的 Scheduler。

### 測試與交付

以 fixtures 覆蓋完整、阻擋、缺報告、過期、必要檢查不支援與警告不阻擋等分支；對語義演練保留所用來源與實際觀察，不把模擬報告說成真實模型驗證。測試納入 make verify。

## R-008：輸出執行交接包並對接既有 ForgePilot

### 目標

將同一批已確認且預檢完成的 Spec／Stories 交給既有 ForgePilot，不要求使用者重新手抄 Story、依賴與開工說明，也不重做 Runner。

### 依賴

Blocked by：R-007。

### 工作內容

提供可選的交接輸出與 Agent 工作流程，交接資料包含批次範圍與來源、定義確認紀錄、預檢結果、Story 路徑、依賴、必要執行上下文與授權。與現有 verification handoff 區分，本資料是開工交接，不偽裝為已完成工作的 PASS 證據。

只有輸出資料時不操作 ForgePilot。若使用者已一次明確授權「交付執行」，工作流程在通過檢查後以 ForgePilot 既有公開 CLI 建立或核對 Goal 與 Work Items，選用 Goal review policy，建立正確依賴並啟動既有 Runner。不得直接修改 .forgepilot 內部狀態；不得增加平行的派發／修復迴圈。

Story ID 與 ForgePilot Work Item ID 必須分開，依實際建立結果建立對應。重試時先讀 ForgePilot 現況；如果無法確定某項是否成功建立，停止並報告，不盲目重複新增。

### 驗收條件

- AC-001：未安裝 ForgePilot 的環境仍可匯出通用交接資料；不把 ForgePilot 變成閱讀與審閱的必要依賴。
- AC-002：寫入 ForgePilot 與啟動 Runner 前再次讀取並比對相關來源；過期確認、過期預檢、缺少必要條件或執行授權時拒絕操作。
- AC-003：依正確順序建立工作，使用實際 Work Item IDs 表達依賴，不能把 Story ID 直接當作 Work Item ID。
- AC-004：同一批次重試不重複建立 Goal／Work Items；部分成功、部分失敗須明確回報，無法安全續接時不得啟動 Runner。
- AC-005：已一次授權且無阻擋後，可啟動既有 Runner 持續推進，不插入每張 Story 的新增人工確認。
- AC-006：執行後狀態由 ForgePilot 讀取，不回寫第二份 current status；不自行核准 review、不寫 VERIFIED／DONE、不略過 Gate。
- AC-007：不得假定 GOAL policy 已具備最終接受 command；本期依實測既有能力停在等待 Goal 總檢，不自動 merge／deploy。

### 不包含

修改 Runner 派發邏輯、Goal 最終核准功能、直接修改 ForgePilot state、重建任務資料庫。

### 測試與交付

以隔離 fixtures 驗證公開命令參數、依賴映射、授權邊界、重試與部分失敗；再以記錄版本的真實 ForgePilot 做整合演練。若公開介面確實不足，需記錄具體不相容點並另提 ForgePilot Issue，不以改寫 state 當作替代。一般單元／整合 gate 不需要模型付費呼叫。

## R-009：完成整批審閱到 ForgePilot 執行的端到端與安全驗收

### 目標

證明這些功能已形成可用的閉環，而不是只有數個各自能執行的命令。各子 Issue 已有自己的測試；本 Issue 補完整流程、跨功能安全與相容性，不把測試延後到最後才開始。

### 依賴

Blocked by：R-008；並依賴 R-001～007 交付。

### 工作內容

建立至少 2 份 Spec、4 張帶依賴 Stories 的獨立 fixture Repository，涵蓋成功路徑、定義修訂、開工阻擋、失敗修復、過期資料與重試。不以 PraxisBound 自己的真實工作樹或正式 ForgePilot 狀態當 fixture。

檢查來源及回饋內容的安全呈現、路徑與輸出邊界、離線存取、批註保存、來源追溯、未決意見、核准語義與依賴映射。建立桌面／窄螢幕／A4 的代表性視覺驗收，記錄真實測試瀏覽器。

更新 README 與使用指南：從 Render、提出意見、修訂、複審、預檢到交付執行；分別示範沒有 ForgePilot 的離線審閱，以及已安裝 ForgePilot 的可選整合。

### 驗收條件

- AC-001：成功演練整批閱讀 → 多處修訂 → 匯出／還原 → Agent 回修來源 → 新版差異 → 人類確認 → 預檢 → ForgePilot 交接。
- AC-002：真實 ForgePilot 整合中，各項工作由既有 Runner 派發與驗證；正常路徑不逐項等待人工，最後如實呈現技術驗證完成／等待 Goal 總檢。
- AC-003：修改已審來源、漏掉必要 Story、依賴循環、未執行必要檢查、過期回饋、未決阻擋與缺少授權都有拒絕／退回路徑。
- AC-004：惡意 Markdown／回饋、路徑跳脫、外部 symlink、輸出失敗、儲存停用及重複交接不造成腳本執行、資料外洩、來源破壞或重複任務。
- AC-005：代表性畫面與 A4 預覽實際檢視，必要內容未被裁掉；未被測試的瀏覽器能力不標成已支援。
- AC-006：新增可自動化檢查加入 canonical make verify，既有 shell／TypeScript 與範例契約不回歸；手動視覺／真實 Agent 演練另有可追溯觀察，不能用未執行的結果冒充 PASS。
- AC-007：完成報告區分預檢、實作驗證與最終接受；不把待最終審查說成全自動 DONE。

### 完成證據

保留測試命令、精確來源版本、實際結果、fixture 與 AC 對照、瀏覽器版本、畫面檢視紀錄、ForgePilot 整合版本，以及所有未通過或未執行項目。未完整時如實列出殘餘風險，不因局部成功關閉 Epic。

## 全局驗收與非目標

以 2 份 Spec、至少 4 張有依賴的 Stories 演練完整流程：整批閱讀、修改、
匯出還原、Agent 回修正確來源、新版差異與回應、人類確認、預檢與交接。
來源變更使舊確認失效；阻擋時不派發；已有執行授權且檢查完整時，既有 Runner
可推進到等待 Goal 最終總檢，正常路徑不逐張新增人工放行。

本期不做多人即時協作、帳號、電子簽章、HTML 直接回寫來源、雲端審稿、
多主題系統、原生 PDF 匯出、需求推導引擎、模型平台、新 Runtime／Runner、
ForgePilot Goal 最終接受、自動合併或部署。

## 來源與整理依據

- 使用者提供 `praxisbound-review-issues.md`（建立日期 2026-09-17）；
  SHA-256：`4110ad6b7db1681ba28258dd34078df3b4602f7985182750f2f18efd4c36b57f`。完整 9 項目標、工作內容、AC 與驗證要求保留於 R-001～009。
- PraxisBound 核對基線：`bccd30268fc00d95558b23f0cad60faecebca763`；
  `AGENTS.md`、`CONTEXT.md`、`docs/agents/`、上述契約與 TST-016。
- ForgePilot README 本機觀察基線：`f2ec4b51e217c60c149797d8e3999b9f685c9eaa`。
  README 有尚未提交的修改，本次引用的是工作樹文字，SHA-256：
  `120cb535cd4fa9c461093006cf99c56cc4789cb13ce2b9baa2f16bdfdee6189a`。
  它描述 `GOAL` policy、`forgepilot run` 與等待最終總檢的邊界；
  本次沒有執行 ForgePilot 整合或驗證其功能。
- [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)：
  不以 `file:` URL 的 localStorage 作為唯一保存路徑；R-004 要求匯出／匯入。

本文件的 repository 檢查不等於上述未實作功能的驗收。
