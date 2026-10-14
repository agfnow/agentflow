# aglite v0.3.0

[English](README.md) · **繁體中文**

讓程式開發助理用專案筆記保留需求、決策、驗證證據與結果，換一個工作階段也能接續。aglite 依任務需要使用計畫、顧問與成果審查。

所有步驟由主代理直接遵循 Markdown 指示執行；套件不含 hooks、執行器或可執行輔助程式。aglite 與 Agentflow 分開發佈。

## 安裝

使用能讀寫檔案與執行指令的助理。[Skills CLI](https://github.com/vercel-labs/skills) 支援 Codex、Claude Code 等主機：

```sh
npx skills add agfnow/aglite --skill aglite
```

選擇助理與專案／全域安裝範圍。安裝工具需要 Node.js，aglite 工作流程本身不需要。版本管理與功能 worktree 需要 Git；一般筆記也可用在既有非 Git 資料夾。

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

停用外掛會保留其檔案與筆記歷史，不會停用另行手動安裝的 Agentflow skill，也不會改寫仍要求 Agentflow 的專案指示。既有專案請先檢查這些項目；不提供設定／歷史的自動遷移或向下相容。保留舊紀錄，明確指定要接續的筆記。每個主機只選一種 aglite 安裝方式。

## 日常使用

[指令與設定速查（英文）](skills/aglite/docs/CHEATSHEET.md)

- `godev` 啟用工作流程或接續未完成工作；已確認的 Git repo 若無指定筆記、設定的 ag-dir、歷史或退役紀錄，即主動初始化，無需先提供任務；不留紀錄與 feature 規則優先。其他閒置啟用請使用者提出下個請求，不寫入檔案。

- 到結尾收據指向的筆記閱讀結果。預設聊天結尾為 `Updated: A-NNN | <notebook>`，下一行為工作目錄；將 `inline-reply` 設為 `on` 可在聊天顯示已儲存的完整回覆。

- `fast-lane [task]` 讓一個任務由主代理直接完成，略過顧問、新增設計／追蹤文件、一般獨立審查與例行 RUN/WIP；仍保留主代理審查、必要驗證及明確檢查點。

- `advisors: requirements, codewalk` 選用推理顧問；只載入相關提示，不會因此取得額外實作授權。

- `3ways` 要求實作前挑戰方案。成果審查依 `review-order`；明確要求的獨立審查需要可用的獨立代理工具。

- 未加引號的 `nolog:`、`noop:`、`off:` 或 `skip:` 讓該次交流不留工作流程紀錄；下一則未標記訊息恢復記錄。

預設包含適用時自動提交／推送，以及實際工作所需的筆記所有權。`review-order: external-first`（預設）依序使用另一家 CLI → 全新脈絡原生代理 → 明確標示的 host 自審；`native-first` 交換兩條獨立路徑的順序；`host-only` 直接由 host 審查，不探查 worker。選到第一條可用且符合要求的路徑即停止；fallback 前記錄路徑不可用的原因。所選 model／effort 設定無效或不受支援時，須取得決定。必要獨立審查（含 skill 未豁免的風險邊界規則）與使用者明確要求的審查限制優先於所有順序；同則或後續訊息的明確要求優先於 `skip-review` 指令；無相容路徑時，審查維持待處理。`skip-review [task]` 指定一個任務只用 host 審查，豁免一般獨立審查，包含 skill 的風險邊界要求；其他步驟／設定維持。此指令取代同一工作先前的使用者審查要求；同則或後續訊息的明確審查要求優先。覆蓋包含後續訊息與復原，完成即失效；這是指令，不是設定開關。若只要本機修改，請告訴助理。控制項與檢查點由專案 `ag.json` 設定；想法本身不代表實作、發佈或刪除授權。

## 更新與限制

Skills CLI 安裝以技能名稱更新；全域範圍加 `-g`，專案範圍加 `-p`：

```sh
npx skills update aglite
```

外掛安裝依 Claude Code 的市集／外掛更新設定處理；維護者符號連結則跟隨本機原始碼。

aglite 仰賴主代理遵守指示，不提供強制完成機制或無人值守排程。協作工作階段使用所有權標記；衝突需明確交接。缺少必要工具或驗證仍屬未解決，不代表已保證各主機／平台相容。

請讀[日常使用指南](skills/aglite/docs/AG_GUIDE.zh-tw.md)、[英文指南](skills/aglite/docs/AG_GUIDE.md)、[設定參考](skills/aglite/references/configuration.md)與[更新紀錄](CHANGELOG.md)。
