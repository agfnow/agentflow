# Agentflow v9.1.2

[English](README.md) · **繁體中文**

讓程式代理把需求、決定與答案留在專案裡。下次開啟對話時，就能從紀錄接著做，不必重新交代所有背景。

這是 Agentflow 9 穩定版。第 8 版保留於 [agfnow/agentflow-v8](https://github.com/agfnow/agentflow-v8)；要明確選用 v8，請執行 `npx skills add agfnow/agentflow-v8 --skill agentflow`。v9 以主代理指示取代一般 helper／hook 執行程式；升級前請先看 [v8 差異比較（英文）](skills/agentflow/docs/agv8-agv9-comparison.md)。

## 安裝

使用能讀寫檔案、執行命令的程式助理。每個主機選一種安裝方式，避免同時載入多份。

使用 [Skills CLI](https://github.com/vercel-labs/skills) 時，在終端機執行：

```sh
npx skills add agfnow/agentflow --skill agentflow
```

依提示選擇助理。預設安裝在目前專案；要讓各專案共用，請加上 `-g`。

[Skills CLI 安裝工具](https://github.com/vercel-labs/skills#install-a-skill)需要 Node.js 22.20 以上版本。一般筆記工作沒有額外的 agentflow 執行程式要安裝。

要用 [Claude Code 外掛](https://code.claude.com/docs/en/discover-plugins)，在 Claude Code 輸入：

```text
/plugin marketplace add agfnow/agentflow
/plugin install agentflow@agentflow
```

安裝或更新後，重新開啟助理對話。助理本身要支援並遵守 skill 指示；檔案安裝成功不代表每個主機都已驗證能自動載入。

## 先交代一件小事

在專案目錄開啟助理，輸入：

```text
godev 改善歡迎頁面。保留現有連結，發佈前先讓我檢查。
```

首次使用時，agentflow 會補上缺少的設定與紀錄，保留既有檔案。資料夾還不是 Git 專案時，會先問你要不要建立 Git repo。

符合設定條件且尚無 commit 的儲存庫，會建立一次空白初始 commit，保留暫存／未追蹤內容。明確禁止 commit 時優先；初始提交本身不授權 push。[指南](skills/agentflow/docs/AG-GUIDE.tw.md#先完成一件小事)說明首次交付排除範圍與失敗處理。

也可先在目標目錄執行 `agf init [--lang zh-TW]`，不經模型建立 Git 與可編輯的 Agentflow 筆記。需要 Node 20+、Git 與可用的提交身分；英文與繁體中文可用；單獨的 `zh` 會保留並使用繁體中文，其他中文語系使用繁體中文並儲存 `zh-tw`；其他有效語系自動使用英文，並儲存 `use-lang: en-us` 供後續流程使用。完整既有專案略過且不改寫，不完整或衝突狀態則停止。命令只提交設定變更且不執行 Git hooks，不 push、不安裝 shell。

缺少 Codex／Claude 時，looper 路由保持空白待設定，一般主代理工作仍可執行。詳見[初始化指南](skills/agentflow/docs/AG-GUIDE.tw.md#先完成一件小事)。

初始化也會在根目錄 `AGENTS.md` 補上主代理預設載入 agentflow 的指示。原有規則會保留；受委派的代理只處理自己的限定任務。

下次開啟同一個專案，輸入 `godev` 即可接續。有未完成工作就繼續，有核准關卡就等你決定，沒有工作就請你提出下一個需求。

預設完整答案保存在筆記裡，聊天只留下收據，例如：

```text
→ 已更新: A-001 | .agentflow/example.devlog.md
  (/path/to/example)
```

開啟收據中的檔案就能看答案。想在聊天看到完整答案，可設定 `inline-reply: on`，或明確要求這次把答案貼在聊天；人類閱讀的標籤與收據依 `use-lang` 顯示。

## 常用選擇

- 一般追加訊息會調整目前工作，直接說明要改什麼即可。

- 用 `append-rounds <工作>` 或完全相同的別名 `append-tasks <工作>`，把一批工作排到後面。目前工作與交付完成後，每批會有自己的提問與回覆。

- `fast-lane <工作>` 由主代理直接處理；`skip-review <工作>` 由主代理自行審查。必要檢查與你明確要求的核准仍保留。

- `grill-me <主題>` 讓代理先訪談；`3ways <需求>` 讓 Claude／Codex 各自獨立盲寫、交互辯論，再由 Codex 最終整合／技術決斷（保留異議，只有雙方接受相同內容才算共識）；`advisors: <名稱>` 取得聚焦建議。提出計畫或建議不代表已核准實作。

- 訊息含未加引號的 `nolog:`、`noop:`、`off:` 或 `skip:`，這一輪就不留下流程紀錄，但工作仍可執行。帶這些標記的追加批次不會排入，也不會執行。

[日常使用指南](skills/agentflow/docs/AG-GUIDE.tw.md)說明怎麼選；[速查表](skills/agentflow/docs/CHEATSHEET.tw.md)列出完整指令、顧問、設定與預設值。

## 與 main 分開開發

`new-feature <名稱>` 會準備獨立的 Git worktree。依回傳的交接步驟切換後，再開始實作。

`merge-feature <名稱>` 驗證並整合成果，預設保留分支與工作目錄；要清理時，明確加上 `and cleanup`。`drop-feature <名稱>` 則是在檢查本機工作後，以可復原方式放棄該功能。

建立與合併使用功能自己的紀錄；放棄功能只在聊天回報。三個指令都不存取 main 的根筆記與認領。

實際 Git 衝突與其他工作階段對目標功能的認領仍須處理。

詳見[功能流程](skills/agentflow/references/features.md)。這些操作需要 Git。

## 終端機功能 CLI

想直接在終端機操作時，可用功能 CLI。它需要 Node.js 20+、Git（合併需 2.38+，以使用 `merge-tree --write-tree`）與唯一且現行的標準專案設定；設定需遷移或有歧義時，會停止並交由主代理處理。這些指令不存取 main 的根筆記、封存或認領。

即使主線的最終檔案排除了根筆記本，原始功能 commits 仍保留在歷史中。若尚未發布的功能歷史包含受保護的根紀錄，CLI 會停止自動 push，交由擁有者處理該歷史；不會改寫歷史。

私人設定的繼承副本若與主線設定不同，CLI 會停止並請主代理處理；不會覆寫主線的私人副本。

CLI 筆記寫入支援英文與繁體中文；其他語系會在變更前停止，交由主代理依設定語系撰寫。終端機原始診斷可使用英文。

- `agf drop-feature [name] [--abandon]`（別名 `dropft`）預設只移除已合併、且沒有已追蹤、未追蹤或忽略檔案資料的功能。加上 `--abandon` 才明確允許放棄未提交或未合併內容。目標認領與 Git 鎖定仍會阻擋移除。

  若保留的 CLI 合併留下生命週期紀錄，請依提示執行 `agf merge-feature <name> --cleanup`；其他本機資料仍須先處理。

- `agf merge-feature [name] [--cleanup] [--check '<JSON argv>'] [--include <checkout-relative-path>]`（別名 `mergeft`）整合功能，保留 main 無關檔案／暫存內容，並排除根紀錄。預設保留工作目錄與分支，加上 `--cleanup` 才清理。可重複提供 `--check` 的字面引數陣列，例如 `--check '["node","--test"]'`，不經 shell 解譯。未指定時使用合併候選內容根 package.json 的 test；兩者都沒有時仍會合併，並明確標示未設定儲存庫檢查。選定的檢查會在候選內容與整合後的 main 執行，失敗仍會阻擋完成。

  可重複加上 `--include <checkout-relative-path>`，明確授權只提交指定的未提交工作檔案與功能紀錄。產品檔案有未提交變更卻未獲此授權時會停止，並顯示 `--include` 續作方式；其他檔案與暫存項目保持不變，不會掃入所有檔案。

- `agf new-feature <name> [--open]`（別名 `newft`）從 main 已提交版本建立受管理工作目錄與功能筆記，保留 main 未提交工作。可續作完全吻合的未完成準備，不重複歷史。`--open` 開啟該筆記；編輯器啟動失敗只警告，已建立功能仍保留。

  設定 `ag.json` 頂層 `default-editor`（預設 `"vscode"`，執行 `code`）為執行檔名稱或路徑；筆記路徑以單一字面參數傳入，沿用終端機輸入輸出。

  相對編輯器路徑以功能工作目錄為準；使用 `--open` 前，請先檢視儲存庫設定。

- `agf shell <zsh|bash|powershell>` 輸出呼叫端目錄切換函式，供檢閱／複製；不會安裝或升級綁定。

merge／drop 只有在自己的已登錄受管理功能內才可省略名稱。程序已結束或認領已過期，都不會自動轉移所有權。已退役功能不能繼續開發。失敗或結果不明時保留復原資訊；先檢查並依確切下一步處理，不要重複破壞性操作。

真正的合併衝突由 Codex 在獨立候選工作目錄處理。`workspace-write` 限制寫入，不能證明作業系統層級的讀取隔離；解析器仍可能讀取較廣範圍。候選工作區排除根紀錄，指示禁止存取外部內容，並不代表 main 無法讀取。

CLI 會在整合前獨立檢查變更路徑、未解決項目與必要測試。缺少關卡核准或擁有者決定時，停止交由主代理續作；程序成功不代表合併正確。

必要檢查由操作者選擇；候選檢查在只有追蹤檔案的獨立工作目錄執行，沒有原本安裝的相依套件。適用時可依序提供 `--check '["npm","ci"]' --check '["npm","test"]'`。每個選定的檢查與衝突解析各有 10 分鐘上限；逾時會阻擋完成並保留恢復狀態。Gitlink 有變更時會在生效前停止，交由主代理處理。

`auto-commit` 與 `auto-push` 預設都是 on，合併可提交並推送 MAIN。沒有遠端時略過推送；只有一個遠端可使用，選擇有歧義時停止。這不授權發佈版本。

已確定停止、且尚未整合的檢查／解析器失敗，修正後可明確重新要求執行。不明、未停止或 main 部分生效的結果需主代理釐清，不會隱含重試。Windows 的 `--open` 需要可直接執行的編輯器；預設值可能因 `code.cmd` 啟動限制只回報警告，成功建立的功能仍保留。

要自動切換呼叫端目錄，請檢閱 `agf shell <zsh|bash|powershell>` 輸出的函式。符合條件的首次設定會新增缺少的綁定；既有綁定需明確要求升級。詳見 [shell 設定](skills/agentflow/references/setup.md#agf-command-setup)。函式保留一般輸出，只讀取獨立且成功的目的地檔案。

建立與移除結果的各輸出區塊之間會空一行。成功建立並切換目錄後，目前產生的函式會建議在該處開啟 coding agent，省略 `cd` 指令。既有綁定在明確升級前，仍會顯示接續操作指令。

直接執行 Node／套件指令則顯示一次已加引號的 `cd` 指令，並建議切換後開啟代理；終端機流程不需要 coding agent 的 `/cd`。

macOS 是主要平台，清理使用已驗證可復原的垃圾桶。Windows 為盡力支援：明確功能清理／drop 可永久刪除確切目標；必要的功能 CLI 記帳也可刪除確切 UUID 自有認領與目的地檔案，不涵蓋他人認領或其他檔案；沒有 Windows 實測就仍屬未驗證。

Linux 無法證明自有認領可復原移除時，可在工作開始前拒絕執行，不只在清理時停止。這些例外僅適用此功能 CLI，不改變聊天指令或 looper 清理規則。詳見[完整功能規則](skills/agentflow/references/features.md#terminal-cli)。

## 選用的批次執行

把想完成的結果與例子交給主代理。`prepare-tasks <需求>` 會分組、保存佇列並停下來，讓你先看規劃。

儲存的準備結果會列出兩種執行方式：終端機先輸入 `agf looper status <run-root>`、再輸入 `agf looper run <run-root>`，或直接在對話輸入 `run-tasks`；其中會代入實際 run-root。

`run-tasks` 執行或接續那份佇列；`handle-tasks <需求>` 則把準備與執行接在一起。

每組使用獨立 worktree，組內每個任務都開新的工作階段。相依組別會等前面的整合通過；準備好的組別則依序進入同一條整合通道。

新設定會偵測支援的 Codex／Claude CLI 並填入三種路由，兩者皆有時優先選 Codex。既有設定不變；執行前須補齊缺少的路由。設定都放在 `ag.json`，包括同時工作組數（預設 3）與修復次數（預設 2）；佇列只保存進度及每次嘗試實際採用的設定。

選擇新任務路由時，優先考慮 CLI。你明確選定的原生路由仍保留；關掉主代理後，不會默默改用 CLI。

選用 looper 需要 Node.js 20+ 與 Git。要使用 shell 入口，可執行 `npm install -g <resolved-skill>`，再用 `agf looper run [run-root]` 或 `agf looper status [run-root]`。

`run` 在 stderr 顯示進度，並在 stdout 顯示最終結果：結束代碼 0 表示完成、2 表示受阻或停止、1 表示錯誤。有已儲存狀態的執行會儲存附導覽的最新 `<run-root>/results.md`，並保留 `evidence/run-<time>-<UUID>.txt` 歷史摘要，列出輸出、阻礙與下一步；`status` 只讀取當前狀態，不改動檔案。詳見[進度與結果規則](skills/agentflow/references/looper.md#progress-and-results)。

報告只是衍生結果，可能落後於執行中佇列；外來或已編輯的 `results.md` 會保留並警告。群組受阻時，單純重跑不會解除阻礙；請主代理診斷、傳入實際回答或技術修正，再繼續同一佇列。參閱[復原操作步驟](skills/agentflow/docs/AG-GUIDE.tw.md#查看結果並繼續失敗的群組)。

區塊與進度事件間保留空行。含時間戳記的進度分成兩欄：第一欄是時間，第二欄是訊息。折行文字與審查者資訊都對齊訊息欄，並依終端機目前寬度換行。管線保留完整的懸掛縮排文字行；狀態與儲存報告保留完整的指令及路徑。

清理需要明確選用：完成後輸入 `agf looper cleanup <run-root>`，或在 `agf looper run` 加上 `--cleanup`。

只清理已完成且停止寫入的工作。成果、分支及佇列／原始請求／群組計畫保留；報告（含 `results.md`）、回答、任務紀錄與其他 run-root 額外檔案移至可復原的垃圾桶。要保留完整歷史，請勿清理。

目前清理需要 macOS，以及同磁碟區內可存取的垃圾桶。工作成功但清理失敗時，以代碼 1 結束；先解決阻礙，再重試人工清理指令。預設執行及受阻／停止的執行都保留暫存資料；詳見[清理安全限制](skills/agentflow/references/looper.md#explicit-cleanup)。

CLI 任務透過協調程序轉送原有的獨立審查，保留任務沙箱與已設定的全新審查者。受阻結果包含代理證據與執行位置；執行或結果解析失敗會將 `failure.json` 保留在執行紀錄旁。

問題會暫停所屬組別，其他獨立組別可繼續。保留的 worktree 與證據可供復原；清理、推送與發佈仍各自需要授權。

執行前請看[looper 規則](skills/agentflow/references/looper.md)與[設定](skills/agentflow/references/looper.md#looper-settings)。

## 升級 Agentflow 專案

先完成或安全交接舊版仍在跑的代理、stream 與佇列，並保留它們的紀錄。舊佇列不能只改檔名就當成新 looper 任務。

遇到可辨識的 Agentflow 8 專案時，主代理才載入獨立遷移提示。可安全對照的內容會自動升成 schema 13；無法直接保留的限制、舊核准規則或不明認領，會先請你做具體決定。

遷移會更新專案設定與目前狀態，移除確認屬於舊版的專案 hooks 或啟動指示，並留下可還原的私人備份。對話歷史與其他工具的設定會保留。

agentflow 的 schema 9、10、11、12 也能升級。缺少必填的 `saving-mode` 時會補上 `off`，既有有效值保持不變。

例如 `skip-wip: off` 會變成 `omit-wip: off`，保留原本意思。

共用或全域整合需要先確認授權範圍。若目前工作階段已載入舊 hooks，請重開助理，讀完保存的遷移結果再接續。

詳見[日常遷移說明](skills/agentflow/docs/AG-GUIDE.tw.md#遷移與安裝)與[遷移提示](skills/agentflow/references/legacy-migration.md)。這是專案格式遷移；替換已安裝的 skill 仍是另一項明確操作。

### 從 Claude Code 舊外掛切換

v8 與 v9 都使用 `agentflow@agentflow`，快取的市集來源可能仍指向 v8。請先在 `/plugin` → Installed 與市集設定確認版本、來源及安裝範圍。確定要把使用者範圍的 v8 外掛換成 v9 時，可使用 Claude Code CLI：

```sh
claude plugin uninstall agentflow@agentflow --scope user
claude plugin marketplace remove agentflow
claude plugin marketplace add agfnow/agentflow
claude plugin install agentflow@agentflow --scope user
```

若實際安裝於專案或本機範圍，請改用 `project` 或 `local`。先前 beta 的 `aglite@aglite` 也須先在原安裝範圍停用，再啟用 v9。完成後重開對話；此次發布不會自動替換任何已安裝內容。

v8 與 v9 也共用 `agentflow` 技能名稱及 `.agentflow/` 專案目錄。同一主機／專案只啟用其中一版。若要繼續用 v8，請先從 `agfnow/agentflow-v8` 明確重裝或重新綁定來源，再使用仍記錄舊來源網址的更新工具。舊工作與 hooks 須等安全遷移完成才退役，不要讓兩版同時處理同一專案。

## 設定與限制

專案設定放在 `<checkout>/<ag-dir>/ag.json`，預設目錄是 `.agentflow`。設定使用 schema 13，與套件版本 9.1.2 分開。

`use-lang` 控制新寫的文字；`plan-mode` 決定何時建立規劃文件；`plan-order`、`review-order` 則決定已需要的規劃或審查由誰處理。一般規劃在支援的路徑控制內，優先由 Claude 起草，再由 Codex 質疑、修正與最終整合。已選控制不受支援時會停下來，不默默換模型。

`auto-commit`、`auto-push` 預設都是 `on`。想只保留本機修改，開始前先確認這兩項；它們不代表可發佈或部署。

版本查詢依排定日期查看 Agentflow 穩定版。Agentflow 8.x 不是 v9 或先前 aglite beta 的升級版本；替換安裝內容仍須取得同意。

流程依賴主代理遵守指示。Windows、編輯器與提供者各自需要實測；另一個平台或 CLI 成功，不代表全部都已通過。

更多內容：[繁體中文指南](skills/agentflow/docs/AG-GUIDE.tw.md)、[English guide](skills/agentflow/docs/AG-GUIDE.md)、[速查表](skills/agentflow/docs/CHEATSHEET.tw.md)、[Copilot 選擇](skills/agentflow/docs/CHEATSHEET.tw.md#copilot-選擇)、[更新紀錄](CHANGELOG.md)。
