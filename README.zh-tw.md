# Agentflow v9.0.0

[English](README.md) · **繁體中文**

讓程式代理把需求、決定與答案留在專案裡。下次開啟對話時，就能從紀錄接著做，不必重新交代所有背景。

這是 Agentflow 9 穩定版。第 8 版保留於 [agfnow/agentflow-v8](https://github.com/agfnow/agentflow-v8)；要明確選用 v8，請執行 `npx skills add agfnow/agentflow-v8 --skill agentflow`。v9 以主代理指示取代一般 helper／hook 執行程式；升級前請先看 [v8 差異比較（英文）](skills/agentflow/docs/agv8-aglite-comparison.md)。

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

- `grill-me <主題>` 讓代理先訪談；`3ways <需求>` 由 Claude 主導規劃、Codex 挑戰具體缺陷；`advisors: <名稱>` 取得聚焦建議。提出計畫或建議不代表已核准實作。

- 訊息含未加引號的 `nolog:`、`noop:`、`off:` 或 `skip:`，這一輪就不留下流程紀錄，但工作仍可執行。帶這些標記的追加批次不會排入，也不會執行。

[日常使用指南](skills/agentflow/docs/AG-GUIDE.tw.md)說明怎麼選；[速查表](skills/agentflow/docs/CHEATSHEET.tw.md)列出完整指令、顧問、設定與預設值。

## 與 main 分開開發

`new-feature <名稱>` 會準備獨立的 Git worktree。依回傳的交接步驟切換後，再開始實作。

`merge-feature <名稱>` 驗證並整合成果，預設保留分支與工作目錄；要清理時，明確加上 `and cleanup`。`drop-feature <名稱>` 則是在檢查本機工作後，以可復原方式放棄該功能。

建立與合併使用功能自己的紀錄；放棄功能只在聊天回報。三個指令都不存取 main 的根筆記與認領。

實際 Git 衝突與其他工作階段對目標功能的認領仍須處理。

詳見[功能流程](skills/agentflow/references/features.md)。這些操作需要 Git。

## 選用的批次執行

把想完成的結果與例子交給主代理。`prepare-tasks <需求>` 會分組、保存佇列並停下來，讓你先看規劃。

`run-tasks` 執行或接續那份佇列；`handle-tasks <需求>` 則把準備與執行接在一起。

每組使用獨立 worktree，組內每個任務都開新的工作階段。相依組別會等前面的整合通過；準備好的組別則依序進入同一條整合通道。

執行前先設定路由，附帶範本的路由是空的。設定都放在 `ag.json`，包括同時工作組數（預設3）與修復次數（預設2）；佇列只保存進度及每次嘗試實際採用的設定。

選擇新任務路由時，優先考慮 CLI。你明確選定的原生路由仍保留；關掉主代理後，不會默默改用 CLI。

選用 looper 需要 Node.js 20+ 與 Git。要使用 shell 入口，可執行 `npm install -g <resolved-skill>`，再用 `agf loop run [run-root]` 或 `agf loop status [run-root]`。

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

專案設定放在 `<checkout>/<ag-dir>/ag.json`，預設目錄是 `.agentflow`。設定使用 schema 13，與套件版本 9.0.0 分開。

`use-lang` 控制新寫的文字；`plan-mode` 決定何時建立規劃文件；`plan-order`、`review-order` 則決定已需要的規劃或審查由誰處理。已選控制不受支援時會停下來，不默默換模型。

`auto-commit`、`auto-push` 預設都是 `on`。想只保留本機修改，開始前先確認這兩項；它們不代表可發佈或部署。

版本查詢依排定日期查看 Agentflow 穩定版。Agentflow 8.x 不是 v9 或先前 aglite beta 的升級版本；替換安裝內容仍須取得同意。

流程依賴主代理遵守指示。Windows、編輯器與提供者各自需要實測；另一個平台或 CLI 成功，不代表全部都已通過。

更多內容：[繁體中文指南](skills/agentflow/docs/AG-GUIDE.tw.md)、[English guide](skills/agentflow/docs/AG-GUIDE.md)、[速查表](skills/agentflow/docs/CHEATSHEET.tw.md)、[Copilot 選擇](skills/agentflow/docs/CHEATSHEET.tw.md#copilot-選擇)、[更新紀錄](CHANGELOG.md)。
