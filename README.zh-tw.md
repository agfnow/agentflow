# aglite v0.3.1

[English](README.md) · **繁體中文**

讓程式開發助理用專案筆記保留需求、決策、驗證證據與結果，換一個工作階段也能接續。aglite 依任務需要使用計畫、顧問與成果審查。

一般工作流程由主代理遵循 Markdown 指示。選用的 [looper](skills/aglite/references/looper.md) 提供經明確授權、依已登錄任務佇列運作的 Node.js 協調程式；不含 hooks 或發佈程式。aglite 是開發期間的 beta 名稱，正式版將成為 Agentflow 9。

Looper 的路由與上限統一放在 `ag.json`；佇列保存指令、進度與每次嘗試實際採用的設定證據。task／repair 共用 `implementation`；review 與再次驗收共用 `acceptance`。範本的路由是空的，執行前須先設定；詳見[設定規則](skills/aglite/references/configuration.md#looper-settings)。

選用的 [brownfield 指引](skills/aglite/references/browfield.md)提供八步驟，協助在不熟悉的既有程式碼中新增已授權功能。可輸入 `browfield <任務>` 或明確要求採用，或由主代理針對明確且重要的探索／回歸保護需求選用；僅因專案已有程式碼，不會自動啟用。仍遵循 aglite 原有模式、核准與紀錄，按需重用顧問方法，不必另裝 skill。

## 選用的平行群組執行

[Looper](skills/aglite/references/looper.md) 平行處理就緒群組，各組依序啟動新的普通任務代理。`prepare-tasks <request>` 準備 `queue.json`、`planned/request.md` 與 `planned/group-NNN.md` 後停止；`run-tasks` 執行 Current 連結的佇列；`handle-tasks <request>` 結合準備與執行。主代理從你的預期成果及專案證據推導技術細節。

預設同時處理 3 組，修復預算為 2 次。就緒群組依先後順序進入單一整合通道；乾淨且檢查通過的合併不另啟代理，修復仍須審查與驗收。普通工作流程及審查設定保留。

可用 `depends_on` 列出較早群組；下游等它們檢查並整合完成，才帶著前置產出啟動。等待不占工作名額，已啟動工作樹保留原始基底。


原生派工需要在線的主代理；CLI 任務工作階段支援 Codex／Claude。

問題只阻擋所屬群組，其他獨立群組繼續；回答主代理即可交回協調程式。

群組紀錄與產品整合隔離。

以 `npm install -g <resolved-skill>` 安裝零相依套件啟動器。

主代理啟動 `agf loop run [run-root]`；`agf loop status [run-root]` 讀取已儲存的進度與問題。

shell 根目錄預設為目前目錄，缺少佇列會報錯；聊天指令 `run-tasks` 則解析 Current。

復原會保留工作，核對舊寫入者與 Git 效果。

沒有常駐服務、另設提升步驟，也不因此授權清理、推送或發佈。執行前請讀執行契約。

## 安裝

使用能讀寫檔案與執行指令的助理。[Skills CLI](https://github.com/vercel-labs/skills) 支援 Codex、Claude Code 等主機：

```sh
npx skills add agfnow/aglite --skill aglite
```

選擇助理與專案／全域安裝範圍。安裝工具及選用的 looper 需要 Node.js；一般筆記工作不需要。版本管理與功能 worktree 需要 Git；一般筆記也可用在既有非 Git 資料夾。

Claude Code 也可用[外掛市集指令](https://code.claude.com/docs/en/discover-plugins)：

```text
/plugin marketplace add agfnow/aglite
/plugin install aglite@aglite
```

安裝或更新後，開啟新的助理工作階段。每個主機選一種安裝方式，避免重複載入。接著輸入：

```text
godev
改善歡迎頁，保留既有連結；發佈前先讓我審閱。
```

## Claude Code 從 Agentflow 改用 aglite

先完成或保存目前 Agentflow 工作的接續狀態，再於 Claude Code 輸入：

```text
/plugin disable agentflow@agentflow
/plugin marketplace add agfnow/aglite
/plugin install aglite@aglite
```

開啟 `/plugin` → Installed，確認 Agentflow 已停用、aglite 已在預期範圍啟用，再開新的工作階段。外掛預設安裝於 user 範圍，project／local 設定可能覆蓋它。若要指定範圍，可在 shell 執行 `claude plugin disable agentflow@agentflow --scope user` 與 `claude plugin install aglite@aglite --scope user`；需要時將 `user` 換成 `project` 或 `local`。詳見[外掛範圍](https://code.claude.com/docs/en/discover-plugins#choose-an-install-scope)。

停用外掛會保留其檔案與筆記歷史，不會停用另行手動安裝的 Agentflow skill，也不會改寫仍要求 Agentflow 的專案指示。既有專案請先檢查這些項目；不提供 Agentflow 設定／歷史的自動遷移或向下相容。保留舊紀錄，明確指定要接續的筆記。每個主機只選一種 aglite 安裝方式。

## 日常使用

[指令與設定速查（英文）](skills/aglite/docs/CHEATSHEET.md)

- `godev` 啟用工作流程或接續未完成工作；已確認的 Git repo 若無指定筆記、設定的 ag-dir、歷史或退役紀錄，即主動初始化，無需先提供任務；不留紀錄與 feature 規則優先。其他閒置啟用請使用者提出下個請求，不寫入檔案。

- 到結尾收據指向的筆記閱讀結果。預設聊天結尾為 `Updated: A-NNN | <notebook>`，下一行為工作目錄；將 `inline-reply` 設為 `on` 可在聊天顯示已儲存的完整回覆。

- `fast-lane [task]` 讓一個任務由主代理直接完成，略過顧問、新增設計／追蹤文件、一般獨立審查與例行 RUN/WIP；仍保留主代理審查、必要驗證及明確檢查點。

- `advisors: requirements, codewalk` 選用推理顧問；只載入相關提示，不會因此取得額外實作授權。

- `3ways` 指定 Claude 根據完整脈絡與可唯讀存取的核准原始碼／既有計畫主導規劃，Codex 負責挑戰／審查；只有經證據確認的高信心缺陷才改動 Claude 主軸。不代表實作授權。成果審查依 `review-order`，必要獨立性仍需獨立工具。

- 未加引號的 `nolog:`、`noop:`、`off:` 或 `skip:` 讓該次交流不留工作流程紀錄；下一則未標記訊息恢復記錄。

目前設定使用 JSON 整數 `schema-version: 9`，設定 schema 與套件版本分開。每次讀取時自動遷移已知舊設定，保留有效的使用者選擇、未知欄位與註解鍵。未知／較新 schema、有歧義或會遺失設定的變更須先取得決定；缺少的欄位沿用最新預設值。詳見[遷移規則](skills/aglite/references/configuration.md#automatic-migration)。

規劃預設為 `external`，依 `external → native → host` 降級；明確指定 `3ways` 則從上一階開始。無效設定與明確限制仍優先。版本檢查使用 `ag.json` 的 UTC 日期 `next_update_date`，到期才查 Agentflow，查詢後排至兩天後。aglite 是 Agentflow 9 的 beta 名稱，8.x 不視為更新。覆寫前須核准並保留 WIP。詳見[版本檢查](skills/aglite/references/configuration.md#session-release-check)。

已有需要的規劃（含任務分組與規劃建議）預設遵循 `plan-order: external`。

路徑無法使用時，先記錄原因，再依 `3ways`（Claude 計畫／Codex 挑戰）→ `external`（Claude CLI 計畫）→ `native`（全新原生規劃代理）→ `host`（目前主代理、不探查 worker）降級。

各路徑在確實支援時優先採 Claude；其他作者與未完成的挑戰須如實標示。所選設定無效，或違反明確提供者／model／effort／獨立性／唯讀限制時，仍須停止相依工作。設定本身不新增計畫或階段。

預設包含適用時自動提交／推送，以及實際工作所需的筆記所有權。`review-order: external`（預設）依序使用另一家 CLI → 全新脈絡原生代理 → 明確標示的 host 自審；`native` 交換兩條獨立路徑的順序；`host` 直接由 host 審查，不探查 worker。

已有需要的獨立審查若已知主要計畫作者，host 會先選不同模型家族，再選其他受支援的已設定模型，優先於一般路徑／等級預設；任務明訂的硬性限制仍優先。同家族／模型仍可審查，但須揭露限制。詳見[規劃與審查模型多樣性](skills/aglite/references/review.md#inspect-the-finished-result)。

選到第一條可用且符合要求的路徑即停止；fallback 前記錄路徑不可用的原因。所選 model／effort 設定無效或不受支援時，須取得決定。

必要獨立審查（含 skill 未豁免的風險邊界規則）與使用者明確要求的審查限制優先於所有順序；同則或後續訊息的明確要求優先於 `skip-review` 指令；無相容路徑時，審查維持待處理。

`skip-review [task]` 指定一個任務只用 host 審查，豁免一般獨立審查，包含 skill 的風險邊界要求；其他步驟／設定維持。此指令取代同一工作先前的使用者審查要求；同則或後續訊息的明確審查要求優先。覆蓋包含後續訊息與復原，完成即失效；這是指令，不是設定開關。若只要本機修改，請告訴助理。控制項與檢查點由專案 `ag.json` 設定；想法本身不代表實作、發佈或刪除授權。

## 更新與限制

Skills CLI 安裝以技能名稱更新；全域範圍加 `-g`，專案範圍加 `-p`：

```sh
npx skills update aglite
```

外掛安裝依 Claude Code 的市集／外掛更新設定處理；維護者符號連結則跟隨本機原始碼。

一般筆記工作仰賴主代理遵守指示。選用的 looper 可在協調程式持續運作時接續已選定的 CLI 工作；原生代理派工仍需在線的主代理。

協作工作階段使用所有權標記；衝突需明確交接。缺少必要工具或驗證仍屬未解決，不代表已保證各主機／平台相容。

請讀[日常使用指南](skills/aglite/docs/AG_GUIDE.zh-tw.md)、[英文指南](skills/aglite/docs/AG_GUIDE.md)、[設定參考](skills/aglite/references/configuration.md)與[更新紀錄](CHANGELOG.md)。