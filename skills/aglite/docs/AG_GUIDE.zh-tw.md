# aglite 0.3.0 — 日常使用指南

[English](AG_GUIDE.md) · 繁體中文

0.3.0 發佈版（2026-10-15）。安裝及從 Agentflow 外掛切換的方式見[套件 README](https://github.com/agfnow/aglite/blob/main/README.zh-tw.md#claude-code-從-agentflow-改用-aglite)。不會自動遷移既有 Agentflow 設定與歷史。

## 開始與接續

首次使用時載入 aglite，輸入 `godev` 並說明需求。初始化或既有專案下次實際工作時，會在根目錄 `AGENTS.md` 補上僅供面向用戶的主代理於工作階段開始時預設使用 `aglite` skill 的指示，由該代理透過自身支援的技能機制尋找、載入並遵循，不限定品牌、路徑或安裝範圍；找不到時回報缺少技能，不假設檔案路徑或自動安裝；受委派的 worker／審查者依限定任務工作，不啟用流程。主機遵循此指示時，之後的用戶工作階段便會自動載入／接續，仍尊重用戶明確指定的啟用或停用方式。`godev` 仍可手動開始／接續。小任務通常只需筆記與一般檢查；較複雜的任務才需要設計及追蹤文件，任務文件只在需要或明確要求時建立。新的工作階段輸入 `godev`，便會從目前 Ask 與連結紀錄復原工作。工作流程證據保留在既有 tracker；沒有 tracker 時，簡短檢查留在 Proven 或已啟用的 RUN；需要保留且會擠滿筆記的細節才放入 `<ag-dir>/.tmp/A-NNN.md`，從 Current 及產生該紀錄的 Ask（Reply 之前）連結供復原／審查。其他筆記使用 `<ag-dir>/.tmp/<notebook-basename>/A-NNN.md`，標明筆記／Ask 身分，確認命名空間的紀錄屬於同一筆記；遇到衝突時選安全且未使用的位置。雖稱 `.tmp`，仍被連結的紀錄必須保留，不自動刪除或忽略。建立／連結前檢查 Git 忽略規則；必要時改用 artifacts 中未使用且不被忽略的位置，納入已授權的交付。沿用既有紀錄，不逐輪建立空檔，每項事實只留一份。Reply 保留答案及影響判斷的限制；面向使用者的獨立驗證報告仍須明確要求。詳見 [Round evidence](../SKILL.md#round-evidence)。

追蹤文件依序放簡短目標與整體進度、**Tasks（待辦事項）**、**Recovery（復原資訊）**，最後才是驗證／審查更新。每項先以方括號顯示狀態，例如 `- [DOING] T-1 — 改善追蹤文件可讀性`，其餘細節使用有標籤的巢狀項目。狀態為 `TODO`（尚未開始）、`DOING`（進行中，包含等待檢查／審查／交付）、`BLOCKED`（無法繼續，須寫明阻礙）、`DONE`（已證明完成）。事項維持固定 ID 順序；Recovery 標示目前事項與下一步。

新專案預設使用 `.agentflow/<簡短目錄名>.devlog.md`，例如 `a002/` 專案使用 `.agentflow/a002.devlog.md`。名稱取自實體 checkout 根目錄（非 Git 專案取原始工作階段資料夾），不取 Git 子目錄；保留既有明確名稱與歷史。STATUS 保留目前復原資訊，每輪依序為 Ask、啟用的 RUN/WIP、Reply 與下一個 Ask。每個新 Ask 標題前放一行獨立的 `---`，前後各留一行空白，初始與功能筆記亦同；既有歷史維持不變。可直接填寫下一個 Ask 再啟用；問題答案可寫在聊天或對應 `ans:` 欄位。空白答案與建議預設值不代表同意。舊紀錄保留；超過 750 行或明確要求封存時，將較早已完成輪次依序附加至唯一相鄰的 `<notebook-stem>.archive.md`，保留既有封存內容、未解決事項與最近已完成輪次，不按時期拆成編號檔。明確要求 notebook 更名時，也將該封存檔更名（`devlog.archive.md` → `notes.archive.md`）；移動前檢查所有目的地，保留歷史位元組並更新現行連結。自訂封存檔歸屬不明或歷史連結須修改時，先請用戶決定。

完整成果存於 Reply；工作完成且 `inline-reply: off` 時，聊天只顯示 `→ Updated: A-NNN | <notebook>`，下一行以兩個空白起頭，顯示括號內的工作目錄；完成說明留在紀錄中。必要通知、明確要求顯示完整答案、未完成工作說明與 feature 交接仍保留例外。`inline-reply: on` 顯示完整答案。在已確認的 Git repo 中，若指定筆記與設定的 ag-dir 都不存在，且無既有歷史或退役紀錄，啟用時即主動初始化 aglite，完成初始化交付後在聊天請使用者提出下個請求，取代簡短收據；不留紀錄與 feature 規則仍優先。其他閒置啟用只讀取必要狀態後請使用者提出下個請求，不建立或更新筆記、設定或 claim。

用戶請求保留原文（憑證須遮蔽），每個以空行分隔的文字段落前加上 `+ `；同一件事的相關段落可只在第一段加上前綴。保留程式碼區塊內文與既有 `+ ` 前綴，各組之間留一行空白，不加入獨立的 `--`、引言前綴或結尾分隔線。既有紀錄保留原格式，除非使用者要求修正。

每次呼叫 Codex `spawn_agent` 都明確設定 `fork_turns: "none"`，並在任務訊息提供所有必要背景；即使未覆寫 model／effort，也不繼承 host 對話。

共用保障放在 skill 的 [專案規則基準](../references/project-rules.md)，沿用既有 backlog／不變條件規定。所有專案 agent／審查者讀取基準與適用的專案覆寫規則；讀取本身不啟動工作流程。根目錄 `AGENTS.md` 只補缺少的啟用及探索指示，保留原有內容；現有專案相對 skill 路徑失效時，回報並提出修正，不默認有效或改寫；單獨讀取規則基準仍不啟用 aglite。基準可來自已安裝 skill、已確認的 checkout 內參照或 host 提供的完整原文；基準不可用時，暫緩共用紀錄寫入與不變條件／審查驗收；提示缺口並繼續其他獨立且獲准的工作。用戶撰寫的專案例外優先於預設；保留下來的自動產生內容仍依現行 skill 定義。`<ag-dir>/rules.md` 為選用的專案例外規則，初始化不建立或覆寫。保留既有權威／自訂路徑與指示；已引用的契約缺失時須先釐清。Main／根目錄初始化從附帶範本預先建立缺少的 backlog、空白不變條件登錄檔，以及含 `.gitkeep` 的 `artifacts/`、`features/`、`.tmp/` 目錄。設定檔仍放 checkout 根目錄，筆記放已解析的位置，不整批覆蓋現有紀錄。沿用既有／自訂權威紀錄，拒絕不安全路徑，以排他方式建立檔案；空範本不代表任務或不變條件授權。初始化以外，只在首次有可追蹤項目／獲准保證時補建相應紀錄。封存、每輪文件及實際 feature worktree 仍按需建立。受管理的 feature 初始化只建立自己的設定／筆記，沿用繼承的共用紀錄。建立空白登錄檔仍使用不變條件通知標題，註明尚無獲准的 ID。其他 backlog 僅作去重來源，除非你指定採用。紀錄路徑依設定的 ag-dir，不隨 notebook／feature 位置改變；不自動搬移。

討論或提問中具體的未來工作記入 `backlog.md`，標為 **proposed**；用戶已接受但延後的工作標為 **deferred**。每項保留來源、目標、未完成原因、預估工作量或下一個決策；記錄不代表實作授權。新增或重大修改項目時提示用戶並提供 ID、狀態、原因與連結。Host 在實際工作復原、相關決策／修正／延後及結束前核對相關項目，新增／去重或更新，保留其他未完成工作。完成並驗證或用戶明確取消後，先在 notebook 記錄結果／取消，再移除該項；不因時間或沉默推定取消。不在閒置啟用時維護，也不定時掃描。

提醒配合決策時機：工作復原時提示相關依賴或範圍重疊；結束時的 Questions 只針對影響目前工作的未解決選擇提醒 backlog 項目，附 B-NNN 連結與建議預設值，未變動項目不會僅為提醒而重複列出。明確要求檢視 backlog 或建議下一項工作時，列出簡短的優先候選清單，說明理由、依賴與預估工作量；由你選定後才安排。閒置啟用時不掃描或安排 backlog 工作；定時提醒須經你明確要求。

任務首次讀取時，保留每份權威登錄檔的實體路徑與獨立的原始位元組／SHA-256 基準；檔案缺失則記錄不存在。復原時保留原始基準，中斷前將所需原始位元組或可取回快照的參照存入既有復原證據。寫入共用紀錄前及結束時重新比對，檢視包含格式在內的所有差異；記錄已接受的修改，不替換原始基準。外來修改須核對來源／授權，不覆寫或默認採用。缺少基準／原始位元組時揭露證據限制，不宣稱未變；雜湊只證明與基準的位元組相同。不新增自我雜湊、旁檔、hook 或執行程式。詳見[不變條件政策](../references/invariants.md#discover-and-reconcile)。

系統登錄檔內容有任何修改時，儲存的 Reply 與聊天結尾均須用獨立的 **System invariant changes** 標題列出受影響 ID、修改與原因，即使 `inline-reply: off` 也要顯示。標題是固定識別字；只移動路徑則用 **System invariant relocation** 分別在 Reply 與聊天說明。必要通知放在簡短收據之前，feature 交接也須包含。

## 易讀回答與按需檢查

Reply 只引用每題第一段，最多 100 個字元（含空白與標點），省略文字時加上 `...`。Ask 保留完整輸入；每題與修正仍須回答。[寫作指引](../references/writing.md) 要求先說結論與行動，使用白話及簡短項目，保留重要限制。刪除重複內容；列出多份文件時使用內縮的 `-` 項目，各自獨立一行，項目間空一行。

未完成工作、授權與復原狀態保留在 tracker；沒有 tracker 時放在 Current。下一個 Ask 放附標籤的復原連結，不重複狀態內容。[Git 交付](../references/configuration.md#git-delivery) 保留 claim、重試與失敗處理的保障。

- **Windows：** 平台相關工作讀取 [Windows 指引](../references/windows.md)。清理須遵守刪除政策，先證明垃圾桶／資源回收筒可復原；不可改用永久刪除。

- **瀏覽器：** 自動化程式碼預設用 Stagehand，Chrome 操作用 Browserbase 的 `browse` CLI（[官方 browser skill](https://github.com/browserbase/skills/blob/main/skills/browser/SKILL.md)）；用戶／專案偏好可覆寫。[瀏覽器測試](../references/browser-testing.md) 規範任務專屬本機無介面工作階段、存取保障及實際操作證據，供 host 驗證與 acceptance 審查。

- **資安：** 既有 [security-scan advisor](../references/advisors/security-scan.md) 按風險選擇原始碼／相依套件／機密檢查，記錄可重現證據，區分疑似／已確認問題與未涵蓋範圍。執行服務測試或上傳原始碼仍需適用授權；不宣稱符合金融法規。

## 選擇需要的模式

- **直接完成：** `fast-lane 修正 README.md 的錯字` 適用一個明確任務，持續到完成，包含後續訊息與復原。略過顧問、一般委派、新增設計／追蹤文件、一般獨立審查與例行 RUN/WIP；仍由主代理審查、驗證及記錄需求／Reply，遵守明確計畫／審查、設定檢查點與功能生命週期規則。既有復原紀錄維持更新。單獨輸入 `fast-lane` 需有未完成任務，不會關閉空白 Ask。

- **單次 host 審查：** `skip-review 修正 README.md 的錯字` 讓一個明確任務只用 host 審查，豁免一般獨立審查，包含 skill 的風險邊界要求。其他步驟與設定維持。此指令取代同一工作先前的使用者審查要求；同則或後續訊息的明確審查要求優先。覆蓋持續到完成，包含後續訊息與復原，完成即失效。單獨輸入時使用無歧義的未完成任務；有歧義則詢問，沒有任務則等待且不保留覆蓋。引用範例不啟用；切換前須處理仍在執行的 reviewer。

同一工作流程分開判斷四件事：是否需要顧問、是否需要設計／tracker、是否委派，以及使用哪個受支援模型。選擇其中一項不代表其他項也必須執行。設計必備內容留在[主代理規則](../SKILL.md#records-and-review)，成果審查清單留在 [review.md](../references/review.md#inspect-the-finished-result)。Spec 針對明確的契約缺口推理；acceptance 沿用同一次成果審查。

- **聚焦顧問：** 主代理在需求或證據浮現須結構化調查的實質問題時，主動列明問題，並在相依工作前選用相關顧問。`advisors: requirements, explore` 可明確指定角色。名稱有 `requirements`、`codewalk`、`explore`、`spike`、`spec`、`security-scan`、`acceptance`、`final-audit`、`learn`、`product-docs`。一般任務不載入顧問提示；選用顧問只授權任務範圍內的建議，不代表額外實作授權。主代理依證據缺口調整深度，問題釐清後即停止。

- **最終稽核：** 使用 `advisors: final-audit`，或以自然語言要求在發佈前稽核明確的候選版本。主代理也可針對已接受發佈工作中的明確就緒證據缺口選用；專案規模或工作完成本身不會觸發。[final-audit 顧問](../references/advisors/final-audit.md) 在一般檢查及候選組裝後，檢驗系統互動與實際交付產物。較早的聚焦建議只回報該缺口的發現、涵蓋範圍與限制，不給就緒判定；一般 review 要求仍走成果審查。沿用 `acceptance` 代理設定及符合條件的成果審查，保留尚未涵蓋的義務。缺少必要產物演練仍為未證實／NO-GO；GO 不授權發佈。不新增指令、強制階段或開關。

- **漸進訪談：** 需要探索實質意圖時，requirements 角色先讀背景與專案證據，主代理再提出相互連貫的小輪問題，通常一至三題，提供選項、影響與建議。依回答決定追問，以具體例子檢驗矛盾；決策留在既有紀錄，不另建訪談歷史。直到實作／驗證不再需要猜測重要意圖即停止，沉默／預設值不代表同意。`grill-me [主題]` 即使尚未偵測缺口也明確要求此流程；至少進行一輪，請用戶確認或修正推定目標、關鍵假設與最重要的相關質疑，再於需求明確時停止；單獨輸入時沿用明確的目前主題，否則詢問主題且不保留模式，引用範例不啟用。此明確訪談要求優先於 fast-lane 的顧問略過，其他規則保留；不新增持續開關、強制 worker／文件或額外實作授權。問題沿用既有回答位置；`inline-reply: off` 時請到儲存的 notebook／design 閱讀並回答。詳見 [requirements](../references/advisors/requirements.md)。

- **挑戰方案：** `3ways` 比較主代理方案與較簡單替代方案。不論 `review-order`，先嘗試不同模型家族的審查者（Codex ↔ Claude）；只有記錄無法使用或失敗原因後，才退回全新脈絡的同家族審查者，仍須遵守明確審查要求。記錄主代理決定；不代表實作核准。

- **不留紀錄：** 未加引號的 `nolog:`、`noop:`、`off:` 或 `skip:` 排除該次交流的需求、進度、答案及後續摘要。引用範例不會觸發；下一則未標記訊息恢復記錄。

說「先規劃，等我確認」可要求檢查點；說「規劃後實作」則授權兩者，除非仍有重要決策未定。想法與審查建議不代表額外修改、發佈、對外傳訊或清理授權。

## 專案設定

`ag.json` 位於 Git 根目錄，非 Git 專案則在原始資料夾；若有 schema-version，必須為 `aglite-5`；不支援的 schema 會停止相依工作。缺少 review-order 採預設值。缺少欄位採預設值，已識別欄位的值無效時停止相依工作。可請主代理修改指定設定，或自行編輯。[設定參考](../references/configuration.md) 為正式規則。

- **路徑：** `ag-dir` 預設 `.agentflow`；`notebook-name` 僅為其下的檔名，預設 `<簡短目錄名>.devlog.md`，可省略此鍵；轉為 ASCII 小寫，連續非英數字元換成 `-`，去除頭尾 `-`，名稱主體取前 32 字元再去除尾端 `-`；空白主體使用 `devlog.md`。初始化會將產生的名稱寫入新設定。拒絕不安全檔名／路徑；明確指定筆記與 feature 路由仍依各自規則。搬移使用中的筆記需授權交接。

- **輸出／語言：** `inline-reply: off`、`skip-asker: on`；`use-lang` 預設取作業系統語系，再以 `en-us` 備援。代理的聊天與書寫依設定語系，不因輸入語言而改變；只有明確指定回覆／成果語言的指令可覆蓋。安裝範本的 `en-us` 會在首次初始化換成偵測語系。

- **進度：** 缺少欄位時 `skip-run: on`、`skip-wip: on`；附帶範本設為 `skip-run: on`、`skip-wip: off`，新初始化專案略過例行 RUN，啟用每十個活躍分鐘的 WIP。略過這些區段仍須在其他紀錄保留復原資訊。

- **計畫／審查：** `skip-plan: off`。計畫依需求規模建立；程式、操作提示、產品成果與可實作契約經 host 驗證後需審查，問答與示例則由 host 檢查。`review-order: external-first`（預設）依序使用另一家 CLI → 全新脈絡原生代理 → 明確標示的 host 自審；`native-first` 交換兩條獨立路徑的順序；`host-only` 直接由 host 審查，不探查 worker。選到第一條可用且符合要求的路徑即停止；fallback 前記錄路徑不可用的原因。所選 model／effort 設定無效或不受支援時，須取得決定。必要獨立審查（含 skill 未豁免的風險邊界規則）與使用者明確要求的審查限制優先於所有順序；同則或後續訊息的明確要求優先於 `skip-review` 指令；無相容路徑時，審查維持待處理。使用 `skip-review [task]` 可指定單次 host 審查。

- **檢查點：** `gate-design: off`、`gate-tracker: off`；設為 `on` 即加入正式規則中的核准關卡。空白答案與經過時間不代表核准。

- **Git：** `auto-commit: on`、`auto-push: on`。已驗證任務修改與使用者修改分開提交，推送需有安全且明確的遠端／分支。若兩者都不要，請設為 `off`。這些設定不授權部署或修改無關 repo；非 Git 資料夾不會自動初始化 Git。

- **代理模型：** `pipeline-roles` 指定已選工作的 tier；`model-family.<provider>.<tier>` 統一儲存 `model/effort` 字串，以最後一個斜線分割。catalog 可新增 `gemini`、`openrouter` 或自訂名稱；依實際主機／提供者設定或使用者明確選擇取用。Codex/openai 與 Claude Code/claude 僅為附帶例子，不是主機白名單；外部 profile 以 `model-family` 參照同一份對照，CLI command 另外保留。tier 值以附帶設定為準。獨立成果審查使用 `acceptance`；未設定角色繼承 transport 預設值。缺少、模糊或不支援的已選值會阻止委派，不默默替換；使用者明確指定欄位優先。設定的組合須由主機控制項同時支援 model 與 effort；未設定角色繼承主機預設值。設定不啟動工作。見[代理設定](../references/configuration.md#worker-settings)。

筆記所有權是必要流程。主代理以工作階段身分獨占建立每份筆記的 `.owner` 標記；他人的、格式錯誤或不符輪次的標記會阻止任務執行。不可只因標記過舊或程序無動靜就刪除他人標記，需明確授權清除／交接。這只能協調遵守規則的代理，不能限制任意編輯器。

審查只在必要時複製：工具可能修改原始檔時，使用沒有 remote 的拋棄式 checkout；需要穩定快照時，固定來源。已有強制唯讀存取或停用工具並提供精確文字時，不重複複製。外部審查的工具存取須排除敏感／未獲准的檔案；無法強制限制直接存取時，改提供獲准的來源副本或精確文字。接受／重用審查前核對來源身分；有變動的路徑須重新檢查。記錄理由、來源身分與實際限制；複製保護原始檔，不隔離憑證／網路，也不是作業系統沙箱。

## 分開開發功能

`new-feature <name>` 在 `.wts/ft-<name>` 建立 `feature/<name>` Git worktree。請在該工作目錄開啟新的助理工作階段；筆記為 `.agentflow/features/<name>/<name>.devlog.md`，實際路徑依設定。準備指令不授權未指定的功能實作。從 main 建立時不取得或改寫 main 的筆記 claim，也不在 main 記錄建立過程；另一個 session 的 claim 保持不動。已持有 main claim 的建立者先保存原工作的接續狀態並釋放自己的 claim。Git 清單取代 feature ledger／索引；準備與交接在 feature 筆記結束，指定的實作需求放入下一個 Ask。部分建立而缺少筆記時，須明確重送 `new-feature`，不得推定工作；同名退役歷史須改用新名稱。merge/drop 仍協調必要的 main／feature claim。

`merge-feature <name>` 驗證並整合完成工作，除非明確要求清理，否則保留 worktree／分支；加上「and cleanup」才授權退役該工作目錄並刪除已合併本機分支。`drop-feature <name>` 檢查未合併及本機資料後放棄指定功能，依刪除政策將工作目錄移至已驗證的垃圾桶／資源回收筒，並刪除分支。已合併或放棄的功能工作階段不得繼續開發；後續工作或已授權復原需新的 main 工作階段。生命週期操作前請讀[功能規則](../references/features.md)。

## 安裝、更新與限制

使用 `npx skills add agfnow/aglite --skill aglite` 從公開 repo 安裝，選擇主機與範圍後開啟新工作階段。Skills CLI 安裝以 `npx skills update aglite` 更新，範圍加 `-g` 或 `-p`。[現行 CLI 文件](https://github.com/vercel-labs/skills#skills-update) 說明這些指令。Claude Code 外掛方式與更新設定見[公開 README](https://github.com/agfnow/aglite#install)及[官方外掛文件](https://code.claude.com/docs/en/discover-plugins)。每個主機選一種安裝方式。

不需要 setup 指令、hooks、發佈程式或排程器。完成與復原仍依賴主代理遵守指示；缺少驗證仍屬未證明。符號連結與檔案檢查不代表已驗證所有主機／平台的自動載入或無人值守執行。

## 產品文件

已接受的變更若影響使用者、貢獻者或維護者的現行文件，須在同一變更更新相關文件；fast-lane／skip-review 亦適用。各類專案沿用既有產品概覽、手冊／速查、技術入口及 agent 指引，不強制固定文件組；無文件影響就不新增紀錄。每個變動事實有一個文件權責來源，並檢查相關摘要、翻譯及教學。多文件專案可沿用索引，或使用設定的 `<ag-dir>/doc-ledger.md`（預設 `.agentflow/doc-ledger.md`）；公開文件不得依賴私有索引連結。

對明確的產品全貌、首次文件組、交接或重大文件落差，可用 `advisors: product-docs`。選取只授權建議，不授權全面改寫或發布。內附角色預設為 `better`；未設定時沿用 host 預設。檢查受影響的矛盾、連結、範例及必要操作／散布版本；缺少必要證據仍屬未證實。不保證持續同步，也不強制全面稽核。詳見[維護規則](../references/product-docs.md)與[顧問](../references/advisors/product-docs.md)。
