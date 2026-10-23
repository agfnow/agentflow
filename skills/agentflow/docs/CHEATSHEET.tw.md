# Agentflow 速查表

[English](CHEATSHEET.md) · 繁體中文

以下依字母排序的聊天命令是專案擁有者給代理的指示，並非 shell 命令。使用時不加引號。Looper 另有 [shell CLI](#looper-cli--依字母排序)。詳細說明：[指南](AG-GUIDE.tw.md)、[設定（configuration.md，第 1 行）](../references/configuration.md)、[功能分支（features.md，第 1 行）](../references/features.md)。

擷取擁有者輸入：每個文字段落前加上 `+ `；相關段落可共用第一個前綴。保留程式碼內文、既有前綴與歷史；各組之間以空白行分隔，不放獨立的 `--`。[擷取規則（session.md，第 5 行）](../references/session.md#activate-and-recover)。

Codex 子代理：每次 `spawn_agent` 都明確設定 `fork_turns: "none"`；在任務訊息中提供所有必要背景。[委派（review.md，第 32 行）](../references/review.md#give-one-bounded-assignment)。

工作流程證據放在 devlog 之外。把有用的技術檢查、審查發現、不變條件核對與除錯證據存入連結的證據文件；devlog 保留結果、回答、必要通知與復原指引。

有用的新證據存入 `<ag-dir>/.tmp/A-NNN.md`，並在 Reply 前，從 Current 與產生該證據的 Ask 連結。其他筆記使用 `<ag-dir>/.tmp/<notebook-basename>/A-NNN.md`；重用前先確認筆記與 Ask 身分。

既有的明確儲存位置仍具權威性。建立證據前先檢查 Git 忽略規則；若位置衝突，選擇安全、未使用且未被忽略的位置，並將證據納入已授權的交付。

中斷前，從 Current 直接連結續作必要證據，或透過追蹤文件的 Recovery 區段連結。說明用途與下一個安全動作；工作未完成時，STATUS Current 保留主要復原連結。

續作時先讀取這些連結，確認身分與即時狀態，再進行依賴它們的工作。缺漏或不符的證據仍視為未證實；只有檔名不能作證。

遵循舊有 Ask 連結，但不要複製到新 Ask。新 Ask 放擁有者輸入，Current 與追蹤文件承載復原連結。

保留連結的證據與歷史。不自動刪除、不自動加入忽略規則，也不要求每輪都有檔案；每項事實只記一次。

生命週期復原還須保留已授權的操作／清理範圍、避免重複重試所需的精確參照、最後已證實結果、待通過的核准關卡／路徑更新，以及下一個安全動作。多條未完成工作線共用一份追蹤文件；若豁免建立追蹤文件，則在 Current 放置標明用途的證據連結。

復原與證據位置須遵循完整的[每輪證據規則（session.md，第 45 行）](../references/session.md#round-evidence)。

Codex／Claude Code 交接使用 `/cd <destination>`，再執行 `godev`；每個 Codex／Claude Code 介面都必須以選定語言，依範本的三個編號步驟顯示建立成功：已建立的分支／工作樹、續作命令，以及使用實際設定之功能筆記路徑的編輯器開啟建議。

建立時的路徑以已驗證的來源工作階段目錄為基準，必要時改用絕對路徑；筆記路徑須明確標示。其他交接使用絕對路徑；已授權但未完成的清理須提供精確復原命令。

開始目的地工作前，先確認主代理所在目錄、Git／設定與筆記所有權；shell 的 `cd` 不會切換工作階段。其他主代理須在目的地重新開啟。

合併／捨棄必須提供編號的結果與下一步。步驟 1 可含簡短縮排段落或子項目，但須保留必要事實與步驟順序。

成功且驗證通過的合併，其編輯器建議指向 main 已設定的根筆記；只用中繼資料確認，不讀取或修改筆記。捨棄功能時，只有在 Trash 外確認仍存在功能筆記，才提供該建議。

以 main 為根的工作階段須明確留在 main；部分完成的清理使用精確復原命令，合併失敗則留在原工作目錄。

不得簡化成只有命令的區塊。其他主代理仍使用編號範本，並提供重新啟動指示。

## 選用的 browfield 流程

當功能需要有系統地探索不熟悉的既有程式碼時，使用 `browfield <task>`，或要求八步驟的既有程式碼開發程序。主代理也可因已指出的重大探索／回歸保護需求而選用；單憑儲存庫已存在不會啟動此流程。

選用後，[內附參考文件（browfield.md，第 1 行）](../references/browfield.md) 提供探索、規則追溯、影響／風險排序、基準行為確認、規格、實作、驗證與保全程序。既有 agentflow 模式、核准關卡、紀錄與審查仍適用；顧問方法僅依需要重用。不需另裝技能，也不需依序執行八位顧問。

<a id="commands--alphabetical"></a>

## 命令 — 依字母排序

- **`3ways`** — Claude 在完整背景及已核准的來源／先前計畫讀取權限下撰寫主計畫；Codex 提出質疑／審查。除非證實有高度確信的缺陷，否則保留 Claude 的計畫。

  此命令為單一計畫選擇 3ways，不受 review-order 影響；路徑不可用時降級並如實標示，明確限制仍優先。不代表實作核准。[規劃路徑（review.md，第 54 行）](../references/review.md#planning-routes)。

- **`advisors: <names>`** — 對於已指出、需要有系統調查的重大問題，主代理會在相依工作前選擇顧問；此命令可明確指定，例如 `advisors: requirements, explore`。可用角色：

  - `acceptance` — 套用標準最終審查清單；重用符合需求的必要審查。

  - `codewalk` — 梳理不熟悉的程式碼。

  - `explore` — 比較替代方案／風險。

  - `final-audit` — 一般檢查／組裝完成後、對外發布前，稽核候選版本是否就緒：使用 `advisors: final-audit`，或以自然語言要求稽核已指明的發布候選版本；主代理自行選用時，須指出已接受發布工作中的缺口。重用 `acceptance` 設定／審查；不因規模或完成狀態自動觸發。

    聚焦諮詢只回報缺口、涵蓋範圍與限制，不判定是否就緒；必要成品演練缺失視為未證實／NO-GO；GO 不授予發布權限。[提示文件（final-audit.md，第 1 行）](../references/advisors/final-audit.md)。

  - `learn` — 調查經驗教訓／失敗。

  - `product-docs` — 處理已指出的產品文件對照、首套文件、交接或重大文件偏差缺口；僅提供建議，內附層級為 `better`，角色缺漏時依繼承規則處理。[提示文件（product-docs.md，第 1 行）](../references/advisors/product-docs.md)。

  - `requirements` — 釐清意圖／成功條件；需要探索或由 `grill-me` 指定時，以證據為基礎進行相互銜接的多輪訪談。

  - `security-scan` — 檢視信任邊界；選擇原始碼／相依套件／機密資訊檢查，記錄可重現的發現與涵蓋範圍。

  - `spec` — 解決既有設計中已指出的契約缺口；不另建第二份規格。

  - `spike` — 針對一個未知事項進行實驗。

- **`append-rounds <work>`** — 以此命令開頭的訊息，排入一批稍後工作；多個任務仍算同一批。將輸入與順序保留在追蹤文件的 Pending batches，位於目前 Ask 之外；沒有追蹤文件時，放在 Current 連結的證據中。

  目前 Reply、核准關卡與交付完成後，每批各以自己的 Ask／Reply 執行；一般訊息則調整目前工作。只有命令而沒有內容時，要求重新傳送工作；引號中的範例不會執行。

  不留紀錄或包含生命週期操作的批次要求，一律不排入也不執行；請移除不留紀錄標記後重送一般工作，或移除生命週期要求後重送其餘工作，待準備好時再單獨傳送生命週期命令。排入的命令／模式只在輪到該批時適用。

  輪到的批次，即使工作小或直接，只要可分離，都優先交由全新原生實作代理執行；fast-lane／明確執行者選擇優先。主代理保有佇列、所有權宣告、驗收與交付責任。執行代理設定、備援與追蹤文件規則仍遵循連結中的批次規則。

  沒有目前工作、待處理批次或未結交付，且最後 Ask 為空時，直接從該 Ask 開始；否則排入同一個 Current 連結的待處理區段。以 `godev` 續作；不喚醒主代理，也不預留未來 ID。[批次規則（batches.md，第 1 行）](../references/batches.md#append-rounds)。

- **`append-tasks <work>`** — `append-rounds` 的完全相同別名：所有批次規則均適用，擷取輸入時保留你輸入的拼法。它新增稍後的 Ask／Reply 批次，不會將任務加入 looper 佇列。[批次規則（batches.md，第 1 行）](../references/batches.md#append-rounds)。

- **`browfield [task]`** — 在 agentflow 中，為不熟悉既有程式碼的已授權功能選用八步驟流程。未指定內容時，使用明確的目前任務，否則詢問是哪個任務；不保存常駐設定，也不自行創造工作。[程序（browfield.md，第 1 行）](../references/browfield.md)。

- **`devlog`** — 啟動 agentflow；開始／續作優先使用 `godev`。

- **`drop-feature <name>`** — 放棄功能；檢查本機工作，將工作目錄移至已驗證的 Trash／資源回收筒，刪除分支。在目標工作樹內執行（此時名稱可省略）；先移除工作樹，再用 `/cd <absolute-main-checkout>` 與 `godev` 交接。

  在聊天中回報；不建立永久退役紀錄、不存取根筆記，也不 commit／push。允許目標筆記不存在；目標所有權宣告／Git 鎖定仍適用。不以永久刪除作為備援。

- **`fast-lane [task]`** — 單一任務由主代理直接執行；略過顧問、一般委派／獨立審查、新設計／追蹤文件與例行 RUN／WIP。

- **`gdd`** — 啟動別名；優先使用 `godev`。

- **`godev [request]`** — 開始／續作；初始化符合條件的新資料夾，非 Git 專案設定前先詢問是否建立 Git 儲存庫；閒置時詢問工作內容。

- **`grill-me [topic]`** — 明確要求自適應需求訪談：先檢查證據，進行相互銜接的多輪提問並提供替代方案／建議，再依回答追問，準備充分時停止。至少一輪由擁有者確認／修正推定成果、關鍵假設及最有力的相關質疑。

  未指定內容時，使用明確的目前主題，否則詢問主題；不保存常駐模式。引號中的提及不會觸發。既有回答路由仍適用；不授予實作權限。

- **`handle-tasks <request>`** — 準備群組，可選擇依賴較早群組，再執行其佇列；結合 `prepare-tasks` 與 `run-tasks`。[契約（looper.md，第 23 行）](../references/looper.md#prepare-and-route)。

- **`merge-feature <name>`** — 只使用功能專屬紀錄／所有權宣告來驗證並合併；排除 main 根筆記／封存檔／所有權宣告的變更。保留工作目錄／分支；加上 `and cleanup` 才在必要核准關卡通過後將兩者退役。main 的筆記／所有權宣告不構成阻礙；Git 衝突／鎖定仍適用。

- **`new-feature <name>`** — 在 `feature/<name>` 上準備 `.wts/ft-<name>`，不存取 main 的根筆記／封存檔／所有權宣告，即使它們屬於目前工作階段也一樣；不做 main 進度檢查／釋放所有權，也不建退役登錄表。

  在功能筆記記錄準備工作，然後在每個 Codex／Claude Code 介面顯示完整的本地化三步驟建立交接（其他主代理保留編號步驟與重新啟動指示）。以 Git 清冊取代登錄表／索引。不執行未指明的實作。

  main 沒有 HEAD 時，只能建立[限定空白初始 commit](../references/setup.md#empty-bootstrap)；禁止或失敗就停止準備。保留無關暫存／未追蹤內容，不存取 main 筆記，也不 push。

- **`nolog: <request>`** — 不留紀錄地執行／回答；本次互動不寫入紀錄，也不納入之後的摘要。

- **`noop: <request>`** — 同 `nolog:`；仍會執行。

- **`off: <request>`** — 同 `nolog:`。

- **`prepare-tasks <request>`** — 在 `<ag-dir>/artifacts/A-NNN-<name>/` 下準備由 Current 連結的 `planned/queue.json`、`planned/request.md` 與 `planned/group-NNN.md`，然後停止。run-root 為 `planned/`。

- **`run-tasks [run-root]`** — 開始／續作 Current 連結的已準備佇列；明確指定的根目錄優先。選擇任務路徑時優先使用 CLI；主代理啟動協調器，並處理擁有者回答或明確選定的原生派工。

- **`show-diff`** — 顯示已驗證的檔案差異與理由；只改變呈現方式。

- **`skip: <request>`** — 同 `nolog:`。

- **`skip-review [task]`** — 單一任務只由主代理審查；保留規劃與檢查，豁免一般獨立審查及其風險邊界規則。

`grill-me` 會明確選用訪談，即使 fast-lane 略過顧問也適用，其餘規則保留；不保存常駐設定，也不強制新增執行代理／文件。`fast-lane` 與 `skip-review` 持續到任務完成，續作時也適用；未帶內容使用時，必須有未完成工作。兩者都不改設定。

主代理檢查、明確要求的計畫／審查、核准關卡與功能規則仍適用。`skip-review` 取代先前審查要求；同一訊息或後續明確審查要求優先。不留紀錄別名僅影響一次互動。

<a id="looper-cli"></a>

## Looper CLI — 依字母排序

以 `npm install -g <resolved-skill>` 安裝；此零相依套件會註冊 `agf`。[執行契約（looper.md，第 1 行）](../references/looper.md)。

- **`agf loop run [run-root]`** — 開始／續作已準備佇列；由主代理啟動。

- **`agf loop status [run-root]`** — 讀取已存的群組／任務總數、目前任務、完成／就緒／整合狀態與問題，不派工也不修改；同時觀察協調器為存活／已停止或不確定／不存在。

Shell 根目錄預設為 cwd；缺少 `queue.json` 會報錯。聊天命令 `run-tasks` 則從 Current 解析。佇列 schema 2 與 `ag.json` schema 13 相互獨立。

`request` 是相對於 run-root 的檔案路徑（通常為 `request.md`）；必要的 `request_sha256` 保全準備當時精確的 UTF-8 要求內容。準備時一併 commit 該檔案。輸入缺漏／為空／不安全／遭變更時，在取得所有權宣告前就阻擋執行／續作；status 同時回報輸入錯誤與進度。Schema 1 的內嵌要求須明確轉換，不得默默採納。

面向擁有者的主代理讀取 `ag.json` 頂層的 `next_update_date`（UTC `YYYY-MM-DD`；缺漏／null 代表到期）。該日期前不發出版本查詢；到期時只檢查 [Agentflow 穩定版資訊](https://github.com/agfnow/agentflow/releases)，然後將下次檢查排在兩個日曆日後，即使查詢失敗也一樣。

受委派代理／隔離的 looper 工作階段，以及不留紀錄互動，兩者皆不執行。Agentflow 9 穩定版接續先前的 aglite beta；Agentflow 8.x 絕不是兩者的升級版本。替換安裝（包括轉移至 9+）仍需核准，並保留來源的未完成工作。參閱[版本檢查（configuration.md，第 29 行）](../references/configuration.md#session-release-check)。

只有佇列 JSON 管理排程／進度；只有 `ag.json` 管理可編輯設定。

在 `looper-routes.task`、`repair`、`acceptance` 設定傳輸方式／供應者／目錄；task／repair 重用 `implementation`，審查／重新驗收重用 `acceptance`。

設定 `looper-limits.max-workers`（預設 3）、`max-repairs`（預設 2）。[設定（looper.md，第 5 行）](../references/looper.md#looper-settings)。

執行前先設定路徑；內附路徑維持空白。為 `handle-tasks`／`run-tasks` 選擇任務路徑時，優先使用 `cli`，包括在 Codex 主代理上，由協調器透過 `codex exec` 啟動的 Codex CLI 任務；保留明確的原生選擇，不得默默改用備援。

每次嘗試將實際選擇存為證據；續作同一次嘗試時保留該選擇，新嘗試則使用本次呼叫的設定。

各群組使用獨立且固定的工作樹，依序啟動全新的一般任務工作階段，保留工作流程／審查／執行者設定。選用的 `depends_on` 列出不重複的較早群組；在其已檢查的整合完成前等待，不占名額／建立工作樹，之後從最新已檢查目標開始。狀態列出尚未滿足的 ID；已開始的基底保持不變。

原生派工需要仍在執行的主代理；CLI 工作階段支援 Codex／Claude／Copilot，不得默默替換。

每個 CLI 任務使用全新、短期的程序與限定背景，不繼承對話，也不續用工作階段；它在群組隔離工作樹內的下一個任務啟動前結束。

Codex task／repair 命令保留 workspace-write 限制及已允許的對外網路；父程序的 `CODEX_SANDBOX_NETWORK_DISABLED=1` 會保留網路封鎖。

群組紀錄留在 `.aglite-records/`，排除於產品整合之外。

就緒群組透過涵蓋整個目標的單一通道，以 FIFO 順序合併。乾淨且檢查通過的合併不新增代理；修復仍保留獨立審查、驗收與檢查。

問題會阻擋所屬群組；向主代理回答時，其他獨立群組仍繼續。

續作保留未完成工作，並先證明舊寫入者已停止；未解決的原生嘗試，必須先由主代理證明已停止，才可被新嘗試取代。尚未確定停止的寫入者保留所有權宣告／名額。每個 CLI 嘗試在 20 分鐘後逾時，保留未完成工作並阻擋續行。不授予群組核准關卡、分波、最終核准關卡、晉升、清理、push 或發布權限。

## 常用做法

諮詢、建立設計／追蹤文件、委派與模型選擇，是同一工作流程中的不同決定。已確定需要的規劃遵循 `plan-order`，包含 prepare-tasks 分組；這不會新增計畫或顧問階段。必要契約仍見[主代理規則（planning.md，第 1 行）](../references/planning.md)，最終審查檢查見 [review.md（review.md，第 82 行）](../references/review.md#inspect-the-finished-result)；選用顧問提供聚焦推理。

規劃順序：足以達成成果 → 已接受範圍 → 最精簡方案；保留目的與保證，說明增刪理由，並計入主代理注意力／復原成本。[主代理規則（planning.md，第 1 行）](../references/planning.md) 涵蓋架構檢查、各別職責決策與選用技術資訊蒐集；[審查（review.md，第 82 行）](../references/review.md#inspect-the-finished-result) 使用原始輸入及明確差異。執行已授權檢查；只詢問尚未解決的權限／成果／限制選擇。

這些檢查不新增文件、必要替代方案或審查階段；若無新的衝突證據，不重新開啟已定決策。

- **小幅修改：** `fast-lane fix the README typo`。

- **Claude 主導計畫：** `3ways plan <topic>`。

- **先規劃，再暫停：**「先規劃並等待。」

- **續作／回答：** `godev`；在聊天或已存問題的 `ans:` 欄位回答。

- **未來工作：** 要求檢視待辦清單；執行前先選定。已選定的稍後工作，每批以獨立訊息傳送 `append-rounds <work>`。

  每批完成時保存其 Reply；最終回條指出最近完成的 Ask，或在 inline-on 時，於回條前依序顯示所有本次新完成的 Reply；每個新完成批次的必要通知也依序包含。

- **重新命名／封存：** 超過 750 行或依要求，將較早已完成輪次依序附加到相鄰的單一 `<notebook-stem>.archive.md`；保留既有歷史、未解決工作及最近完成輪次。不建立編號分期檔案。明確重新命名筆記時，封存檔也一併更名。

- **新資料夾：** `godev`；Git 可選：設定寫入前先在聊天詢問（即使 `inline-reply: off` 也一樣），除非先前已明確選定。同意則初始化 Git；不同意則繼續但不使用 Git；未回答則等待。失敗須檢查後復原；核准不涵蓋既有無關檔案、遠端與發布。

  主動設定要求尚未選定筆記，且沒有已設定的 ag-dir、歷史或退役情形。[設定（setup.md，第 9 行）](../references/setup.md#first-time-setup) 建立缺漏的 main／根待辦清單／空白登錄表，以及 `artifacts/`、`features/`、`.tmp/` 預留目錄；調整根設定／解析後筆記，保留既有／自訂紀錄，拒絕不安全路徑。受管理的功能初始化重用共用紀錄，只建立設定／筆記。

  核准初始化 Git，或符合條件的既有無 commit 儲存庫首次設定，會建立一次空白初始 commit，保留暫存／未追蹤內容，即使 auto-commit 為 off 也一樣。明確禁止時略過；其他 refs、不安全 Git 狀態或提交失敗則停止。已有 HEAD 就沿用。首次交付排除原有無關內容，除非另經授權；初始提交本身不授權 push。詳見[空白初始提交](../references/setup.md#empty-bootstrap)。

  建立空白登錄表仍須發出不變條件通知，且不含已接受 ID。封存檔、每輪文件與實際工作樹仍按需要建立。不留紀錄／功能規則優先；不自動初始化 Git，也不複製 rules.md。

- **登錄表比較：** 任務首次讀取時，保留每份權威登錄表的實體路徑與原始精確位元組／SHA-256 基準（或不存在的狀態）；復原時沿用，並在中斷前，將必要位元組／可取回快照參照存入既有證據。

  寫入共用紀錄與結案前進行比較；檢查全部內容／格式差異，保留原始基準，記錄已接受更新。協調他人變更，不覆寫也不默默採納；缺少基準／位元組時，仍須揭露證明限制。內容變更須發必要通知；僅移動路徑須發搬移通知。

  雜湊相同只證明位元組相同；不新增自我雜湊、旁存檔或執行程式。[政策（invariants.md，第 5 行）](../references/invariants.md#discover-and-reconcile)。

- **專案規則：** 工作／審查前讀取[共用基準（project-rules.md，第 1 行）](../references/project-rules.md)，以及選用的本機規則；讀取本身不會啟動工作流程。

  設定時，或既有專案下一次工作階段，補上缺漏的預設啟動指示：僅面向擁有者的主代理在工作階段開始時，透過該代理支援的技能機制探索、載入並遵循 `agentflow` 技能；不固定主代理、路徑或安裝範圍。不可用時，回報缺少技能，不猜路徑也不自動安裝。

  保留擁有者覆寫；既有專案相對技能目標失效時，回報並提出修正建議，不得默默接受／改寫。受委派的執行代理／審查者不得因這項指示啟動流程。主代理遵循啟動指示時，之後擁有者工作階段不需再輸入 `godev`。

  基準可讀自已安裝／經驗證的儲存庫內來源，或主代理提供的文字；產生的啟動指示只點名技能，探索方式留給主代理。保留既有覆寫／自訂路徑；基準缺漏時，延後共用紀錄寫入及不變條件或審查接受，回報缺口並繼續可獨立進行的已授權工作。

- **追蹤標籤：** 使用 `TODO`（未開始）、`DOING`（進行中，含檢查／審查／交付）、`BLOCKED`（無法續行，指出阻礙）與 `DONE`（已證實完成），例如 `- [DOING] T-1 — Update activation`。任務 ID 維持順序；依序放目標／進度、Tasks、Recovery，再放證據連結／更新細節。[追蹤契約（planning.md，第 1 行）](../references/planning.md)。

- **Ask 輪次：** 每個新 Ask 標題前加獨立的 `---`，前後各留一空白行，初始與功能筆記也適用；保留既有歷史。參閱[筆記規則（delivery.md，第 5 行）](../references/delivery.md#notebook-and-delivery)。

- **回答／報告：** [以徹底理解為先（writing.md，第 1 行）](../references/writing.md)：簡潔、格式與術語都服務於理解。先講結論，用詞平實。

  每次交付前，檢查目標讀者能否不靠猜測或開啟連結，就說明結果、相關責任、意義與必要決定／動作；有缺口就釐清或改寫。

  使用簡短、單一概念的段落或項目，通常 1–3 個短句，以空白行分隔；每段先講重點。交付前拆分過長／多概念區塊；單一密集長項目也不合格。

  僅供機器使用的文件／技能提示可大幅精簡，但不得遺失要求、例外、防護、精確性或正確性；混合文件依各部分讀者套用規則。

  已存 Markdown 行號連結使用 `path#<line-number>`，不得使用 `path:<line-number>`，路徑相對於文件，例如 `[features.md (features.md, line 31)](../references/features.md#31)`；章節連結保留命名錨點。聊天遵循主代理連結要求；沒有此要求時，使用經驗證、相對於工作目錄根的路徑及 `#<line-number>`，若主代理無法解析相對目標則用絕對路徑。

  聊天不得使用相對報告位置的 `../`。含空白的目標以 `<...>` 包住。

  Reply／子要求引文：只取第一段，最多 100 個 Unicode 碼位（含空白／標點），不得拆開組合字元（字素）；只要省略文字就加上 `...`。保留原樣反引號，不加反斜線跳脫；若截斷造成未成對反引號，就截在該反引號之前。保留憑證遮蔽與完整 Ask 輸入。

  刪除重複；多份文件以巢狀 `-` 項目列出，項目間留空白行。

  每份報告先交代結論、主要發現、適用建議／決策與重大限制，再放細節；必要開頭內容要拆分，不能刪減，並保持完整。事後檢討／根因報告也先交代原因／預防建議。

  將寫作指引傳給受委派的報告作者。

  做出後果重大的選擇前（包括變更已接受成果、保證或擁有者選定設計），先說明要求／目前做法與替代做法、各由誰執行、保留／變更／失去哪些能力，以及對目標的影響；指出衝突，區分已測行為與假設／範例。

  若不熟悉背景的讀者無法重述工作與後果，先改寫再提問；尊重已定決策。

- **未完成交接：** 將工作／授權／復原保留在追蹤文件，沒有追蹤文件時則放 Current；從 STATUS Current 連結主要復原資訊，新 Ask 除擁有者輸入外保持空白，並遵循舊有 Ask 連結。[Git 交付（delivery.md，第 40 行）](../references/delivery.md#git-delivery) 保留所有權宣告／重試／失敗防護。

- **已結束輪次的所有權釋放：** 確認 Reply 加上下一個 Ask；讓任務所屬執行代理／操作收妥，並在交還控制前保存未完成授權、精確身分與下一個動作。未結輪次的暫停與功能生命週期例外仍各依其規則。釋放不代表完成或核准。繼續前重新取得所有權並重讀。

  參閱[所有權、身分與拒絕規則（session.md，第 31 行）](../references/session.md#notebook-ownership)及[先前交付的分離規則（delivery.md，第 40 行）](../references/delivery.md#git-delivery)。

- **Windows：** [平台／執行環境指引（windows.md，第 1 行）](../references/windows.md)；原生／明確指定的 Node 進入點，以及經驗證的 npm Node shim，使用字面 argv；Copilot stdin 處理長提示，CRLF 位元組保持原樣，程序觀察不明時保留所有權宣告。不支援的自訂包裝程式須明確指定進入點。原生 Windows 執行需要自己的證據。

  替代清理方式須證明可在同一磁碟區回收／還原，且必須拒絕永久刪除實際工作目錄。

- **網頁檢查：** 預設使用 Stagehand 自動化程式碼與 Browserbase `browse` CLI Chrome 操作（[官方瀏覽器技能](https://github.com/browserbase/skills/blob/main/skills/browser/SKILL.md)）；擁有者／專案偏好可覆寫。[瀏覽器測試（browser-testing.md，第 1 行）](../references/browser-testing.md) 涵蓋自有本機／無頭工作階段、存取防護與實際操作流程證據。不新增顧問或權限。

<a id="agjson--switches--alphabetical"></a>

## `ag.json` → `switches` — 依字母排序

以下格式：**值 → 效果；缺少鍵時的預設值**。明確編輯指定鍵。既有／新專案的設定都位於 `<checkout>/<ag-dir>/ag.json`；預設為 `.agentflow`。探索時比對檔案所在目錄與其宣告的 ag-dir，遇到歧義就停止。

設定可能包含私人值。主代理在本機檢查，只回報必要的非機密欄位或雜湊／狀態；不印出完整設定或 hook 檔案。

有提供 `schema-version` 時，必須是 JSON 整數 `13`；未來修訂獨立於套件版本遞增。必填的 `saving-mode` 接受 `on|off`；設定／遷移只在缺少時補上 `off`，保留有效值，遇到無效值就停止。其他缺少欄位使用預設值；讀取完整的目前版本不寫入任何內容。 已安裝 skill 的[內附範本](../assets/.agentflow/ag.json)定義目標；較新的 schema 會停止，與遠端發佈版本無關。

面向擁有者的主代理讀取時，會遷移已知舊版，保留有效選擇與未知／註解鍵。未知／較新 schema，以及有歧義或有損的變更，都需要決定。

根目錄或舊預設位置若僅有一份舊設定，可在持有所有權的遷移下，安全搬到已設定的 ag-dir。多個來源或候選會停止遷移，即使內容相同也一樣。

即使標記為支援的目前 schema，舊欄位仍須對應／釐清；未知或較新標記仍停止。只有確認 V8 來源才推定缺少的舊預設值：缺少的 `threeways` 補為 `better`，保留明確層級。原始資料留在 Git／設定探索之外的私人備份；證據只放安全參照。

可辨識的 Agentflow 8 設定使用獨立的[舊版遷移（legacy-migration.md，第 1 行）](../references/legacy-migration.md)；只有無損且已授權的情況自動繼續。不支援的舊核准／限制、所有權、佇列或整合決定，會暫停受影響遷移。

Schema 9／10／11／12 與 `aglite-5` 遷移至 13，並補齊必填的 saving-mode；舊省略鍵保留原意。

舊 `skip-plan: off` 改為 `plan-mode: optional`；`on` 改為 `off`，後者允許建立需要的追蹤文件。參閱[遷移（upkeep.md，第 5 行）](../references/upkeep.md#automatic-migration)。

- **`ag-dir`** — 安全的工作目錄相對路徑 → 設定與紀錄位置；預設 `.agentflow`。不得透過 `..`／符號連結越界。明確編輯可安全搬移設定；搬移紀錄須另有授權。

- **`auto-commit`** — `on`：commit 已驗證工作，擁有者修改分開處理；`off`：不自動建立交付 commit。預設 `on`。

  符合條件的首次設定或明確在 main 執行 new-feature，也授權在已驗證且無任何 commit 的儲存庫建立一次空白初始 commit，即使此設定為 off；明確禁止 commit 時優先。初始提交本身不授權 push。

- **`auto-push`** — `on`：將已授權 commit push 至已驗證的遠端／分支；`off`：不自動 push。預設 `on`；不會啟用 commit。

- **`gate-design`** — `on`：實作前等待設計核准；`off`：不新增核准關卡。預設 `off`；在 optional／must 下要求有設計；與 `plan-mode: off` 衝突，並停止相依工作等待選擇。

- **`gate-tracker`** — `on`：最終交付前等待已檢查結果獲核准；`off`：不新增核准關卡。預設 `off`；沒有追蹤文件 → 沒有此關卡。功能整合前提仍適用。

- **`inline-reply`** — `on`：在聊天顯示完整已存回答；`off`：簡短回條。預設 `off`；只有明確要求在聊天／終端顯示回答時才可顯示。「Show me」、輸出範例與未來輸出方式變更都不算。

  靜默驗證已存回答；明確顯示回答與 `on` 仍以兩行回條結尾。通知、未完成工作、設定前 Git 選擇、無任務設定與實際功能交接，仍遵循各自操作規則；假設性交接保留在已存回答中。

- **`notebook-name`** — ag-dir 下的安全檔名 → 筆記；預設 `<short-dirname>.devlog.md`，由實體工作目錄根／工作階段資料夾產生：轉為小寫 ASCII，連續非英數字元換成 `-`，修剪，主檔名上限 32 字元，再修剪尾端 `-`；空值 → `devlog.md`。新設定保存產生的名稱。

  不可含路徑或 `.owner` 後綴；明確／功能路由優先。

- **`omit-asker`** — `on`：新 Ask 標題省略擁有者名稱；`off`：包含名稱。預設 `on`。

- **`omit-run`** — `on`：省略 RUN 里程碑；`off`：記錄里程碑。預設 `on`；證據另存。

- **`omit-wip`** — `on`：復原資訊另存；`off`：每十個活躍分鐘、脈絡重設前及未完成交接前，寫入 WIP。預設 `on`，設定範本為 `off`。

- **`plan-mode`** — `must`：實際任務編輯前先有 design.md + tracker.md；`optional`：需要時建立（預設）；`off`：不建新設計，需要時可建追蹤文件。

  既有契約／檢查／審查仍必須遵循；閒置／不留紀錄／設定／生命週期／問答／排入批次，不會只因這項設定而建立紀錄。

  擁有者明確任務指示與 fast-lane 建立豁免優先。Gate-design on + off 時停止，等待設定選擇。

- **`plan-order`** — 適用於已確定需要的規劃，包括撰寫／修訂計畫與任務分組的諮詢；預設 `external`。訪談／蒐集證據沿用一般諮詢規則。Fast-lane 由主代理規劃，除非你明確選擇其他任務規劃路徑。Claude 可用時由其主導；Codex 質疑具體缺陷。

  從選定值開始，記錄經檢查的失敗：`3ways → external → native → host`、`external → native → host` 或 `native → host`；`host` 是終點。`native` 代表內部全新脈絡規劃。無效設定與明確限制仍會阻擋不相容備援：

  - `3ways` — Claude 主計畫 → Codex 質疑／審查 → 主代理裁定。

  - `external` — Claude CLI 規劃者；不自動安排 Codex 質疑。

  - `native` — 全新原生規劃者；只有支援時才優先 Claude，標明實際供應者。

  - `host` — 目前主代理直接規劃；不探測執行代理。

- **`review-order`** — 一般順序；對於已要求的獨立審查，[規劃者多樣性（review.md，第 82 行）](../references/review.md#inspect-the-finished-result) 優先選用與已知主要規劃者不同的模型家族，其次選另一個已設定且支援的模型。主代理可揭露後重新選擇一般預設；任務層級硬性限制優先，同家族／模型仍可使用，但須揭露限制。

  - `external` — 對應方 CLI → 全新脈絡原生代理 → 標明的主代理備援；預設。

  - `native` — 原生代理 → 對應方 CLI → 主代理備援。

  - `host` — 主代理直接審查；不探測執行代理。

- **`saving-mode`** — `on`：載入[節省模式（saving-mode.md，第 1 行）](../references/saving-mode.md)，使用最低充分文字／紀錄、減少選用文件並重用有效證據；`off`：一般行為。必填；設定／遷移的預設值為 `off`，保留既有值。例行 100–200 詞是彈性目標；明確細節要求、理解、防護、必要紀錄／檢查／審查、核准關卡與交付物優先。不變更模型／路徑，也不追溯補回。

- **`use-lang`** — 語系標籤，例如 `en-us`、`zh-TW` → 每個新的人類可讀字串的語言，包括範本／骨架標籤、通知及回條的 `Updated`；預設為偵測到的作業系統語系，其次 `en-us`。英文提示／素材提供語意。

  `zh-TW` 將 `STATUS` 呈現為 `狀態`、`Questions`／`None` 為 `問題`／`無`、WIP 的 `Checkpoint` 為 `進度檢查`，回條的 `Updated` 為 `已更新`；`en-us` 保持英文。

  STATUS 欄位標籤也依語系呈現：`Checkout` 變成 `工作目錄`，`Current` 變成 `目前工作`。英文欄位名是待翻譯範例，不是固定符記。重用語系標籤；保留機器符記、輸入／歷史及既有成品語言。

  明確指定目標語言優先；只有輸入語言不會切換語系。[語系政策（configuration.md，第 5 行）](../references/configuration.md#discovery-and-validation)。

規劃／審查限制與必要獨立性優先於路由。所選模型／推理強度不受支援時，需要決定。空白回答／預設值不構成核准。Git 開關不授予發布權限。規劃代理使用選定顧問角色，否則使用 `threeways`；質疑使用 `threeways`，結果審查／final-audit 使用 `acceptance`。

缺少原生角色時繼承主代理預設；缺少外部角色時使用傳輸預設；選用的 looper 角色／路徑必須設定；內附／根角色包含 `product-docs: better`。執行代理模型／層級選擇：[執行代理設定（review.md，第 11 行）](../references/review.md#worker-settings)。

為規劃者多樣性考慮其他模型前，先驗證選定審查路徑的一般設定。所選設定缺漏、無效或不受支援時需要決定；不可換模型來繞過。

多樣性比較的是實際主要規劃者與審查者。換別名或推理強度值，不足以證明不同家族／模型；身分未知或重複仍可接受，但須揭露限制。

明確的任務供應者／模型／推理強度、隱私、唯讀與獨立性要求優先。可用的獨立路徑先於主代理備援；主代理審查不能證明獨立性，在 host 順序下仍要求獨立審查時，使用全新原生脈絡。

Looper 路徑與已存嘗試選擇保留其明確設定。參閱[審查選擇（review.md，第 82 行）](../references/review.md#inspect-the-finished-result)。

## Copilot 選擇

對於 Copilot 主代理或選定路徑，載入 [Copilot（copilot.md，第 1 行）](../references/copilot.md)。

選用的 `native-workers` 將 `planner`、`challenger`、`implementation`、`acceptance` 綁定至 `{ "model-family": "catalog", "agent": "optional-verified-preset" }`。配對留在目錄中；角色選擇層級；任務覆寫先於驗證。

未綁定時保留目前解析方式。明確 looper 路徑與已存嘗試優先。

選定的外部設定檔與 looper 路徑支援 `copilot`；預設 Codex↔Claude 路由保持不變。經驗證的 Copilot 工作階段可共用傳輸方式，但須有全新獨立脈絡，並優先採用觀察到的家族／模型多樣性；家族未知／重複須揭露。

指定模型／推理強度需要實際支援的控制方式；原生編輯器證據、CLI 結果與供應者實際推理強度是不同觀察。原生主代理不存在時，不得用 CLI 替代。[執行代理 schema（review.md，第 11 行）](../references/review.md#worker-settings)。

## 產品文件

已接受的行為變更須同步更新受影響的維護中指引，包括 fast-lane／skip-review；沒有影響就不新增文件紀錄。沿用既有頁面的讀者角色，每項變動事實只有一個負責來源，並檢查摘要／範例／翻譯。

選用的多文件對照：既有索引或 `<ag-dir>/doc-ledger.md`，預設 `.agentflow/doc-ledger.md`；私人對照不得成為發布內容的相依項目。檢查受影響矛盾、連結及必要操作流程／發送內容；缺少證據仍視為未證實。一般主代理更新不需顧問／完整稽核；`advisors: product-docs` 要求聚焦建議。[維護（product-docs.md，第 1 行）](../references/product-docs.md)。
