# Agentflow 9.0.0 — 日常使用指南

[English](AG-GUIDE.md) · 繁體中文

agentflow 把你的需求、決定與答案留在專案裡，並保存足以在另一個工作階段接續的復原資訊。交代目標、成功的例子，以及不能改變的事即可。

Agentflow 9 穩定版的 skill 名稱是 `agentflow`。本指南說明日常用法；[速查表](CHEATSHEET.tw.md)列出全部指令、顧問與設定。

## 先完成一件小事

依[套件 README](https://github.com/agfnow/agentflow#install) 安裝 agentflow，再於專案目錄開啟程式代理並載入 skill。安裝與專案初始化是兩個步驟。

先交代一件具體工作：

```text
godev 修正 README.md 的安裝連結，並依目前檔案確認範例。
```

你正在對話的代理稱為「主代理」。它理解需求、協調其他代理、檢查成果並保存答案。小任務通常只需要開發筆記 devlog；較大的工作可能需要設計與 tracker。

首次初始化會建立缺少的設定與紀錄，保留既有檔案。它也會在根目錄 `AGENTS.md` 補上後續工作階段載入 agentflow 的指示；受委派代理只處理限定任務，不另啟工作流程。

你的程式代理必須支援並遵守這項指示。若未自動載入，請自行載入 skill 再送出 `godev`。找不到 skill 時會回報，不會默默安裝。

Git 可選。在尚未使用 Git 的資料夾，主代理會在初始化寫入前詢問是否建立儲存庫；未回答就等待，拒絕則繼續但不使用 Git。

若你同意初始化 Git，或符合首次設定條件的既有儲存庫尚無任何 commit，主代理會建立一次空白初始 commit。明確執行 `new-feature` 時，若 main 尚無 commit，也可使用同一做法。

即使 `auto-commit: off` 也可建立這筆初始 commit，但明確禁止 commit 時不會建立。已暫存與未追蹤檔案都會保留；首次交付只包含已驗證的任務／設定修改，原有無關內容須另經你授權才會納入。

已有 HEAD 就沿用。存在其他 refs 或 Git 狀態不安全時會停止初始提交；提交失敗則保留現場，停止設定或功能準備。禁止 commit 時仍可完成設定，但功能工作目錄需要先有 commit。初始提交本身不授權 push 或發布。

如果只啟動初始化、沒有交代任務，完成後會請你提出下一個需求。精確資格與復原方式見[代理初始化規則](../references/setup.md#first-time-setup)。

## 接續未完成的工作

在同一專案開啟代理，輸入 `godev`。主代理讀取目前需求、已保存問題與復原連結，核對實際檔案及執行中的操作後接續。

你可以在聊天回答，也可以填寫問題原位置的 `ans:`。空白答案、建議預設值與等待時間都不代表核准。

紀錄缺漏或不符時會回報，不會當作已驗證。沒有未完成工作時，主代理會請你交代下一個需求；閒置啟動不會安排 backlog 工作或新增紀錄。

筆記認領避免互相配合的工作階段同時寫入同一本筆記。遇到其他工作階段的認領，需要交接；標記很舊或沒有回應都不授權搶接。

詳見[代理復原與認領規則](../references/session.md#activate-and-recover)。

## 答案與紀錄在哪裡

預設紀錄目錄為 `.agentflow/`；`ag-dir` 可指定其他安全的專案相對路徑。新筆記通常採工作目錄的短名稱：資料夾 `a002` 會產生 `.agentflow/a002.devlog.md`。既有名稱與歷史會保留。

每輪有「提問」、「回覆」與 `A-001` 之類的識別碼。開頭的「狀態」透過「目前工作」連到未完成事項。你也可以直接在下一個提問填入需求，再啟動代理。

預設 `inline-reply: off`，完整答案留在回覆，聊天最後只顯示收據：

```text
→ 已更新: A-001 | .agentflow/a002.devlog.md
  (~/project/a002)
```

開啟該筆記即可閱讀答案。設為 `inline-reply: on` 可在聊天顯示完整答案；也能明確要求這次答案貼在聊天或終端。只討論未來輸出或單說「給我看」不會改變目的地。

必要通知、阻礙與實際功能交接仍會出現在聊天。包含收據在內的文字標籤，都遵循設定語系。

設計文件交代預期行為、應保留的保證與驗收方式。tracker 列出工作及「復原」資訊；兩者都按需要建立。

工作狀態為 `TODO`、`DOING`、`BLOCKED`、`DONE`。等待檢查、審查或交付時仍是 `DOING`；`DONE` 需要完成證據。

有用的檢查與除錯證據另存並連結，通常在 `.agentflow/.tmp/`。被引用的證據應長期保留，不要因目錄名稱就當暫存垃圾刪除。筆記保留答案、限制與復原連結，不塞入技術日誌。

筆記超過 750 行或你要求時，較早完成的輪次可移入相鄰的單一 `<notebook-stem>.archive.md`。未解決工作與最新完成輪次留在現行筆記。明確重新命名筆記時，也包含其封存檔並保留歷史。

`backlog.md` 保存未來工作：`proposed` 是建議，`deferred` 是已接受但延後。先請主代理檢視並選定事項，再執行；記在裡面不等於授權實作。

`sys-invariants.md` 保存後續修改必須維持的已接受保證。內容修改時，已保存答案與聊天都會有專節通知；只搬路徑則通知搬移。空白登錄表不代表已接受任何保證。

詳見[代理紀錄規則](../references/session.md#round-evidence)與[交付規則](../references/delivery.md)。

## 補充目前工作，或安排後續批次

一般後續訊息會修正或擴充目前工作。直接說明改變，以及它取代哪個先前限制。

想稍後再做，請另送一則訊息：

```text
append-rounds 更新安裝範例。
```

一則訊息就是一個後續批次，即使包含多項工作。`append-tasks` 是完全同義指令；兩者都不會新增 looper 工作。

主代理先完成目前回答、核准關卡與獲准交付，再以各自的提問／回覆處理每批。中斷後可用 `godev` 接續待辦批次；排入工作不會喚醒已停止的主代理。取消時請指明批次。

建立、合併與放棄功能請分開送出。批次混入功能生命週期操作時，既不暫存也不執行；請移除後另送其餘一般工作。

詳見[代理批次規則](../references/batches.md#append-rounds)。

## 這次交流不留紀錄

在訊息加入未引用的 `nolog:`、`noop:`、`off:` 或 `skip:`，這次交流就不讀寫工作流程筆記，也不納入後續摘要：

```text
nolog: 請在聊天說明這項設定。
```

已授權工作仍會執行；`noop:` 不是預演。下一則沒有標記的訊息恢復記錄。引用範例不會啟用標記或模式。

不留紀錄的 append 請求既不排入也不執行，請移除標記後重送。詳見[代理路由規則](../SKILL.md#route-before-records)。

## 選擇任務模式或顧問

一般工作不需要指定模式。主代理會依需求選擇足夠的調查、規劃與檢查。

`fast-lane <task>` 由主代理直接執行，略過一般委派、顧問、新設計／tracker、獨立審查與例行進度段落。仍保留需求記錄、復原、檢查、主代理審查及獲准交付。

`skip-review <task>` 保留一般規劃與執行，只把一般獨立審查改成主代理審查，也包含通常要求的風險邊界審查。

兩種模式都跟隨同一項明確任務，涵蓋修正與接續，完成後失效，不改專案設定。

單獨輸入指令時，須有明確的未完成工作；否則主代理會詢問任務或等待。

明確要求的計畫／審查、設定關卡與功能規則仍適用；`skip-review` 取代先前的審查要求，同一則或之後的新要求則優先。

`grill-me <topic>` 用來做需求訪談。主代理先查看背景，再用小輪問題釐清目標、假設與最值得質疑之處，並根據你的回答追問。

至少有一輪讓你確認或修正理解，重要意圖已清楚就停止。訪談授權討論，也能在 fast-lane 工作中要求使用。

`browfield <task>` 是針對陌生既有程式碼的八步驟，從探索與追溯規則，走到基準、規格、實作、驗證與保存。這個拼法就是指令名稱。

已有儲存庫不會自動啟用它。不必另裝 skill 或安排八位顧問；一般核准與審查仍適用。詳見[代理 brownfield 程序](../references/browfield.md)。

`advisors: requirements, explore` 可要求聚焦建議。主代理也能針對具體調查缺口選用顧問；建議不授權實作提案，也不要求每個角色另派一位代理。

針對明確的待發布候選版本，`advisors: final-audit` 會在檢查與組裝後評估就緒程度。GO 仍不等於發布授權。全部角色見[速查表](CHEATSHEET.tw.md#命令--依字母排序)；精確選用機制見[代理規則](../references/ag.md)。

## 規劃、檢查、審查與核准

說「先規劃，完成後等我決定」，會保存計畫但不授權實作。說「規劃後實作」，則在重要選擇與設定關卡處理完後允許繼續。

規劃先確保已接受的成果與限制，再找最簡單且足夠的做法。你提供目標與例子，主代理從專案推導技術路徑與檢查，只詢問重要未知事項。

`plan-mode` 預設 `optional`：小而可逆的工作通常不用設計；多項成果、委派或中斷接續需要 tracker；多部分行為變更需要設計。`must` 要求修改前具備兩者；`off` 不建新設計，但可建必要 tracker。已有契約與檢查仍適用。

`plan-order` 選擇已需要的計畫由誰撰寫，預設 `external`，不會增加規劃階段。

`3ways <request>` 由 Claude 提出主計畫、Codex 挑戰。主代理只在高信心且有證據的缺陷成立時修正主軸。三種觀點不代表一定要三個代理，規劃也不等於實作核准。

其他路徑使用外部 CLI、全新上下文的原生代理或主代理。路徑無法使用時依允許順序退回；明確的提供者、模型、effort、獨立性或唯讀要求仍有效。已選控制無效時需要決定，不會默默替換。

主代理先檢查成果。程式、操作提示、產品成果與可直接實作的契約，通常還要做成果審查；一般問答與例子由主代理檢查。

`review-order` 預設 `external`：對應提供者的 CLI、全新原生代理，最後才是揭露限制的主代理審查。可行時，獨立審查優先選擇與已知主計畫不同的模型家族，再考慮另一個已設定模型。重複或未知身分會揭露，不當作多樣性的證據。

主代理備援不能滿足必要獨立性。即使審查接受原始碼，缺少的必要檢查仍是未證明。

`gate-design: on` 要求實作前核准設計，與 `plan-mode: off` 衝突。`gate-tracker: on` 在有 tracker 時，要求核准已檢查成果後才做最終交付。

兩個關卡預設都是 off。空白答案不算核准；相同且未變的已核准結果不用反覆詢問。詳見[設定速查](CHEATSHEET.tw.md#agjson--switches--依字母排序)、[代理規劃](../references/planning.md#planning-modes-and-gates)與[審查規則](../references/review.md)。

## 分開開發一個功能

Git worktree 是同一儲存庫的另一個工作目錄，擁有自己的分支與檔案。送出 `new-feature search`，會準備 `.wts/ft-search`、分支 `feature/search` 與功能筆記。

main 工作目錄需要先有 commit。準備時可建立前述限定的空白初始 commit，原有無關檔案仍排除。建立本身不授權未交代的實作。

請照實際的編號交接訊息操作。Codex 與 Claude Code 使用 `/cd <feature-checkout>` 接著 `godev`，並提供指向實際功能筆記的編輯器建議。其他主機在該處重新開啟；工具裡執行 shell `cd` 不會切換主代理工作階段。

功能筆記預設位於其工作目錄內的 `.agentflow/features/search/search.devlog.md`。生命週期操作不存取 main 的根筆記、封存與認領，即使它們忙碌也一樣；實際 Git 衝突與目標功能認領仍需處理。

`merge-feature search` 會驗證並整合，保留工作目錄與分支，除非你明確加上 `and cleanup`。適用的核准關卡會在破壞性清理前完成；main 的無關檔案與暫存內容會保留。

`drop-feature search` 表示放棄功能。主代理先檢查未合併工作與本機檔案，再移入已驗證可復原的垃圾桶／資源回收筒，移除登錄與分支。無法證明可復原就停止，不改用永久刪除。

drop 在聊天回報，不需要永久退役紀錄。已有功能筆記時，移除前會將其狀態標為已放棄／已退役；不會建立替代筆記。

在目標功能內可省略 drop 的名稱，不用先切回 main。完成後照 main 交接繼續。已合併／放棄的功能已退役；部分失敗請用確切復原動作，不要重建路徑或重做整套操作。

建立與合併使用功能紀錄。精確交接與復原見[代理功能規則](../references/features.md)。

## 用選配 looper 執行多組工作

looper 將獲准工作分成獨立 worktree 群組。組內任務依序在全新工作階段執行，獨立群組可同時進行。一般單一任務不需要它。

交給主代理編號成果、例子與應保留的保證。`prepare-tasks <request>` 保存群組計畫、佇列及精確原始需求，再停止供你檢視。

預設執行根目錄是 `.agentflow/artifacts/A-NNN-<name>/planned/`，包含 `group-NNN.md`、`queue.json`、`request.md`，由「目前工作」連到。你不必手寫佇列 JSON。

`run-tasks` 執行或接續該連結佇列；`run-tasks <run-root>` 則明確指定。`handle-tasks <request>` 合併準備與執行。

先設定路徑：範本的 `looper-routes` 是空的。task、repair、acceptance 路徑選擇傳輸方式／提供者／目錄，共用 `model-family` 保存模型與 effort。選新任務路徑時優先考慮外部 CLI；明確的原生選擇與已有嘗試仍有約束力。

預設為 3 個工作群組、每組最多修復 2 次，由 `looper-limits` 設定。執行中的嘗試保留當初選擇，新嘗試採用本次啟動讀到的設定。CLI 每次嘗試上限 20 分鐘，逾時保留並阻擋未完成工作。

原生派工需要在線的主代理與結果信箱。關閉主代理不授權改用 CLI 或其他提供者。

相依群組等待前置群組完成檢查與整合。就緒群組依到達順序進入單一整合通道。有問題的群組暫停，其他獨立群組可繼續；透過主代理回答即可。

接續保留未完成修改，並先確認舊寫入者狀態。`request.md` 缺漏、變動或不安全時阻擋執行，不要默改已準備輸入來換工作。乾淨合併執行整體檢查，修復仍保留審查與驗收。

群組紀錄位於 `.aglite-records/`，不隨產品整合。工作目錄與紀錄在完成後仍保留；另行獲准清理前要保全被忽略的紀錄。執行本身不授權清理、push 或發布。

若從 shell 操作，依[代理 looper 契約](../references/looper.md)安裝 `agf`，使用 `agf loop run [run-root]` 或 `agf loop status [run-root]`。shell 省略路徑代表目前目錄，聊天 `run-tasks` 則跟隨「目前工作」。另見 [CLI／設定速查](CHEATSHEET.tw.md#looper-cli--依字母排序)與[保留檔案](../references/looper.md#retained-files)。

## 有意識地調整設定

設定放在 `<checkout>/<ag-dir>/ag.json`，通常是 `.agentflow/ag.json`。可以要求修改指定欄位，或自行編輯；缺少一般欄位會採預設值。目前設定 schema 是 13，與套件版本分開。

`use-lang` 控制新增的人類文字，包含範本標籤與收據。未設定時採作業系統語系，再以 `en-us` 備援；輸入使用哪種語言不會自行選定。明確的回答／成果語言要求優先。

原始輸入、歷史、機器語法與既有成果語言保持不變。改設定不會翻譯過去紀錄。

`auto-commit`、`auto-push` 預設 on，彼此獨立。不想自動交付時請要求兩者都 off；除非禁止 commit，前述限定的初始提交例外仍適用。

已驗證任務修改與你的其他修改分開提交，也受初始提交後的既有內容排除規則約束。Git 交付不授權部署、發布、對外訊息或無關修改。

`saving-mode` 必填，預設 off。遷移將缺少的值補為 off，保留已有 on/off。開啟時減少可省略文字／紀錄並重用證據；可理解性、要求的細節、必要檢查、關卡與復原仍保留。它不改模型或路徑。

`pipeline-roles` 與 `model-family` 為已選工作設定模型／effort，本身不啟動工作。已選設定不受支援時會阻擋，不默默替換。

Copilot 請先看[選擇速查](CHEATSHEET.tw.md#copilot-選擇)。連結的 [Copilot 代理規則](../references/copilot.md)說明傳輸控制；CLI 成功不代表原生編輯器支援已驗證。

全部值與預設值見[速查表](CHEATSHEET.tw.md#agjson--switches--依字母排序)，精確要求見[代理設定規則](../references/configuration.md#discovery-and-validation)。

## 遷移與安裝

[Agentflow 8 差異比較（英文）](agv8-aglite-comparison.md)說明保留的功能、移除的執行期強制檢查，以及遷移影響。

可相容的已知設定會保留使用者選擇進行遷移。未知／較新 schema、舊新欄位衝突與來源不明時，先等待決定。設定遷移不會默默搬移歷史或已安裝 skill。

辨識到 Agentflow 8 輸入才載入獨立程序。安全對照可自動執行，舊核准政策、認領衝突或無法保留的限制則等待。可辨識的舊欄位即使位於支援的較新標記下，仍要釐清。

確認 V8 來源且省略 `threeways` 層級時，保留有效的 `better`；明確層級維持不變。主代理更新設定與目前狀態，只移除已確認的舊專案 hooks／啟動單元，保留歷史、其他設定與可還原私人原始檔。

先前 aglite 的 schema 9–12 升到 13。缺少 `saving-mode` 時補 off，已有 on/off 保留。例如 `skip-wip: off` 對應 `omit-wip: off`，保留原意而非套用缺省預設。

先讀保存的結果，若已載入舊整合則重新啟動。舊執行中佇列／stream 需先完成或交接，不能直接變成新 looper 佇列。精確對照見[代理遷移規則](../references/legacy-migration.md)，以及[後續格式維護](../references/upkeep.md#automatic-migration)。

每個主機選一種安裝方式，依[套件 README](https://github.com/agfnow/agentflow#install) 的對應方式更新。安裝或更新後請開啟新工作階段。替換前須明確核准能保留未完成修改的具體做法，包含原始碼 checkout 或符號連結安裝。

`next_update_date` 到期時，主代理查詢一次 Agentflow 穩定版資訊，再排到兩個日曆日後。Agentflow 8.x 不是 v9 或先前 aglite beta 的升級版本。找到更新不授權替換或發布；詳見[代理版本查詢規則](../references/configuration.md#session-release-check)。

## 理解限制，並維護文件

agentflow 依靠主代理遵守指示。檔案已安裝、路徑正確，不代表自動探索、無人接手續作或所有主機都受支援。一般工作不需要 hooks 或背景執行器，looper 是限定的選配執行程式例外。

Windows looper 需要 Node.js 20+ 與 Git for Windows。請依[代理 Windows 規則](../references/windows.md)操作；其他平台的測試不證明原生 Windows 或提供者／編輯器行為。

瀏覽器流程預設使用 Stagehand 與 Browserbase `browse`，你的工具偏好與專案規則優先。主代理依[代理瀏覽器測試規則](../references/browser-testing.md)檢查實際行為與存取範圍。

行為改變時，相關現行文件、範例與翻譯一起更新。每個事實有權威來源，摘要對照檢查。沒有文件影響就不另建文件紀錄。

`advisors: product-docs` 可協助文件地圖、交接或重大落差。建議不授權發布，精確維護要求見[代理規則](../references/product-docs.md)。

## 尋找精確規則

完整查詢請用[速查表](CHEATSHEET.tw.md)。`gdd`、`devlog` 也能啟用 agentflow；日常建議用 `godev`。`show-diff` 要求呈現已驗證差異與原因，不授權額外修改。

[skill 入口](../SKILL.md)選擇程序；連結的 `references/*.md` 是壓縮後供代理使用的提示，不是人類操作手冊。需要精確權限或失敗規則時再查閱。

- [工作階段](../references/session.md)：輸入、復原、認領與 backlog。

- [規劃](../references/planning.md)：契約與核准關卡。

- [工作](../references/work.md)：任務模式與檢查。

- [審查](../references/review.md)：路徑、模型與獨立性。

- [交付](../references/delivery.md)：答案、Git 與封存。

- [功能](../references/features.md)：建立、整合、放棄與交接。

- [Looper](../references/looper.md)：分組執行與資料保留。

- [設定](../references/configuration.md)與[維護](../references/upkeep.md)：設定、遷移與替換。

- [共用專案規則](../references/project-rules.md)與[不變條件政策](../references/invariants.md)：常設限制與應保留保證。
