# Agentflow v8.3 — 日常使用指南

[English](AG_GUIDE.md) · 繁體中文

[在 YouTube 觀看 Agentflow 介紹影片](https://youtu.be/0dp_HnqX0ms)。

Agentflow 幫你的 AI 助理準備一本專案筆記。你交代的事情、做過的決定、目前進度和最後結果，都會留在一起。明天再回來，或換一個新的對話，助理就有紀錄可以接著做。

- **直接說你想做什麼。** 在能讀寫檔案、執行指令並保留工作狀態的助理裡開啟專案，輸入 `godev`，再用平常說話的方式交代工作。Codex 和 Claude 保留原有整合；其他助理可用明確安全 host ID 和手動記錄方式使用 通用核心流程。

- **到筆記裡看結果。** 助理完成後會告訴你檔案位置，通常是 `.agentflow/devlog.md`。

- **不懂就直接問助理。** 「這件事要怎麼用 Agentflow skill 來做？」通常是最快得到適合自己專案的答案的方法，不需要先背下整份指南。

## 1. 先準備好工具

你需要具備檔案、指令和狀態保存能力的助理，以及 Node.js 18 或更新版本。Codex 和 Claude 有已驗證的整合；其他助理使用 通用核心流程，不會自動宣稱是已驗證的產品整合。要保留 Git 版本紀錄、建立獨立的功能工作區，或使用某些安裝方式時，才需要 Git。一般資料夾即使還不是 Git 儲存庫，也能使用專案筆記；Agentflow 不會自行幫你建立儲存庫。

每個進行中的筆記回合只由一個工作階段寫入。另一個工作階段會在修改需求或進度前停止，即使 streams 已關閉也一樣。通用助理必須保留唯一的 `--session <id>`，並在啟動、記錄輸入、寫入進度和完成回合時，與 `--host <id>` 一起傳入；新的獨立工作階段要使用新的 ID。原生助理使用目前工作階段的身分；指令環境沒有提供時，需明確傳入該身分。

若上一回合已完成並釋放所有權，你先填好下一個連號 Ask，再要求 Agentflow 啟動或繼續，啟動程序就會取得該 Ask 的所有權，不必再次確認。沒有這項釋放紀錄的舊版未完成筆記，或仍由其他工作階段持有的 Ask，則先執行 `agf owner inspect --notebook <path>`，再依你的接手授權執行 `agf owner adopt --notebook <path> --ask <A-NNN> --expect <token|unowned> --sha256 <hash> --host <host> --session <id>`，填入剛查到的值。既有授權即可，不必重問；Agentflow 不會因閒置時間或程序停止而自動接手。

在終端機輸入以下指令，安裝 skill：

```sh
npx skills add agfnow/agentflow
```

依畫面選擇你使用的 AI 助理，以及只安裝在這個專案，還是供所有專案使用。安裝後開啟新的助理對話，讓它載入 skill。Claude Code 也能透過外掛安裝，方式請看[公開版 README](https://github.com/agfnow/agentflow#install)。

如果你使用 Codex，Agentflow 維護者依自己的使用經驗，建議選擇 **`gpt-5.6-sol/low` 作為表現最穩定的控場模型**。也就是模型選 `gpt-5.6-sol`，推理程度選 `low`，由它負責和你對話、安排工作。這是本專案的使用建議，仍可依任務與帳號可用的模型調整。[OpenAI 官方模型文件](https://developers.openai.com/api/docs/models/gpt-5.6-sol)也確認這個模型支援 `low` 推理程度。

想確認安裝是否正常，可以請助理執行 `agf setup`。它會列出目前可用的工具；`agf setup --fix` 則會先備份 shell 設定，再補上缺少的指令捷徑。選用的協作助理無法使用，不一定代表安裝失敗。如果助理在安裝 hooks 後提醒你重新啟動，照做一次即可；hooks 是用來記錄訊息、檢查工作是否完成的小型整合程式。

### 定期更新 skill

如果你是用 `npx skills add` 安裝，建議定期執行：

```sh
npx skills update agentflow
```

目前的 CLI 是依**已安裝的 skill 名稱**更新，所以這裡填 `agentflow`；`agfnow/agentflow` 是 `skills add` 使用的安裝來源。`npx skills update agfnow/agentflow` 這種填入來源的寫法，不是目前依名稱更新的語法。全域安裝可加上 `-g`；專案內安裝則在該專案資料夾執行，並加上 `-p`。詳見 [Skills 更新說明](https://github.com/vercel-labs/skills#skills-update)。

想省去每週手動更新的麻煩，可以請助理協助設定 macOS 或 Linux 的 **crontab 工作排程**。以下範例會在每週一上午 9 點更新全域安裝的 Agentflow：

```cron
PATH=/absolute/node/bin:/usr/local/bin:/usr/bin:/bin
0 9 * * 1 /absolute/node/bin/npx --yes skills update agentflow -g -y >> /absolute/path/agentflow-update.log 2>&1
```

先把範例路徑換成你實際使用的 Node.js 目錄，以及可寫入的紀錄檔位置，再用 `crontab -e` 加入排程。若是專案內安裝，排程要先進入該專案，並把 `-g` 改成 `-p`。設定前先手動試跑一次，之後查看紀錄確認是否成功；更新後請開啟新的助理對話。

## 2. 交代第一件事

在助理對話中輸入：

```text
godev
幫我改寫歡迎頁，讓第一次來的人也看得懂。
保留現有連結，做好後先讓我看過，不要上傳。
```

助理會記下你的要求，完成你交代的工作，做必要檢查，再把回覆寫進筆記。過程中，你會看到簡短的進度說明；完成後，點開最後訊息提到的筆記即可。

- **還沒交代工作：** 如果 Ask 仍然是空的，單獨輸入 `godev` 可能只會收到「Development workflow ready.」。接著再說明任務就好。

- **接續沒做完的工作：** 如果 Ask 已經有你的請求，`godev` 會讀取內容並繼續。在使用中的對話裡，也可以說 `continue` 或 `next`。

- **直接編輯筆記：** 把要求填在檔案最下方空白的 Ask 區塊，儲存後輸入 `godev`。已完成的提問與回覆請保留原樣。

- **調整方向或停止：** 直接說要改哪裡，或停止哪件事。追問通常會接在尚未完成的任務裡；「停止這項任務」才會取消該工作。請助理解釋原因，不等於請它順手修改。

## 3. 筆記要怎麼看

每個 **Ask** 都是一輪任務對話，對應的 **Reply** 就是助理的答覆。像 `A-012` 這樣的編號，讓你容易找到同一輪的提問與回覆。

- 最上方的 **STATUS** 列出最近記錄的結果、待辦事項和下一步。真正的專案設定保存在 `ag.json`，STATUS 只用來掌握進度。

- **RUN** 記下重要進展。工作進行較久時，助理會在投入工作滿十分鐘後補上 **WIP** 進度摘要，說明已完成、正在做，以及還沒做的事情。`log-verbosity: off` 會省略之後的 RUN 和 WIP，`wip` 會保留 WIP 但省略 RUN，`all` 則維持預設行為。每個層級都會保留 Ask 和完整 Reply，也會保留 tracker、審查、測試及其他證據檢查；檢查點的時間間隔與頁尾只會描述實際允許並寫入的紀錄。

- **[SUMMARY]** 讓你快速看結果。**[FINAL REPORT]** 依照你提出要求的原始順序，交代哪些成功、哪些失敗、哪些仍有限制，以及做過什麼檢查。

- **Questions** 裡若有空白的 `- ans:`，表示有事情需要你決定。可以在對話中回答，也可以直接填寫、儲存，再請助理繼續。若筆記連到計畫文件裡的問題，就到該文件回答。

助理接續工作時，會先檢查你已填過的答案。建議答案只是建議，`ans:` 留白不代表同意。

啟動與擷取提示時，筆記超過 1,000 行或達到 768 KiB，就會自動把符合條件的已完成對話移到旁邊的封存檔。每個對話都先核對位元組與雜湊，再移除原本的副本；目前任務與含有行內答案的對話仍保留。若有已回答的對話阻止壓縮，它後面的所有對話也會一起留在目前筆記。需要手動復原時，以目前的工作階段身分執行 `agf compact --notebook <目前筆記>`。筆記或單一未完成對話超過 1 MiB 仍可繼續使用；每次提交的訊息與草稿仍有各自的大小限制。

所有主機的輸入收據都改放在設定工作資料夾的 `.tmp/`。手動擷取不會寫入 `.codex/` 或 `.claude/`；原本放在那裡的收據仍可讀取，以保留去重與工作範圍紀錄。

## 4. 依需要選擇做法

通常只要說清楚任務，助理就會選擇合適的做法。想指定處理方式時，可以用以下指令：

- **小事簡單做：** `fast-lane 修正 README.md 的錯字。` 這一件事由目前的助理自己處理，略過大型開發流程、委派、新功能工作區和 另一位助理審查。必要檢查、進度紀錄與自行審查仍會保留；任務完成後，這個模式就結束。

- **先看計畫：** 「先做一份計畫，等我看過再開始實作。」助理會儲存計畫，停下來等你確認。

- **請另一個角度看計畫：** `threeways` 或 `3ways` 會安排一次獨立評論，再由目前的助理回應。討論完不代表已核准實作。

- **檢查完成的成果：** 在要求裡加上 `cross-check`，就會請另一位唯讀審查者（reviewer）檢查。例如：「修好設定驗證，再 cross-check 結果。」

- **走完整開發流程：** `ag` 或 `agentflow` 會在 `allow-ag` 允許時，要求依序處理需求、規格、實作和驗收。`all-in` 則會連選用的顧問都一起納入，因此需要更多工作，也可能增加模型呼叫。

- **由目前的助理執行：** 說 `no delegation` 即可。這不會取消必要檢查或獨立審查。

- **看清楚改了什麼：** 加上 `show-diff`，回覆就會逐項說明修改理由，並列出容易對照的差異：`-` 是刪除的行，`+` 是新增的行。單純要求看差異，不代表授權修改。

Agentflow 應該只完成你交代的範圍，有現成做法就優先沿用。必要檢查是工作的一部分；要重跑已通過的測試，必須有原因。其他順便想到的改善，應先列為建議，等你決定。

一般工作可直接傳送任務說明，不必另存 brief 檔案。排程或需要恢復的工作、要求檔案的啟動工具，以及使用者指定的審查紀錄仍須保存檔案。重要審查的完整任務說明，應在可持續保留的對話、派工紀錄或檔案中保存一次。

## 5. 哪些事情需要你點頭

一般工作只要要求明確，就包含完成任務所需的步驟。如果你說「先做好讓我檢查，不要上傳」，助理應完成本機工作，等你同意後才上傳。

難以回復的改動，需要更清楚的確認。計畫會描述一般使用者的操作旅程、哪些功能必須維持正常，以及哪些具體例子能證明成果符合要求。**Invariants** 是必須守住的承諾；**Acceptance criteria** 則是判斷工作有沒有做好的驗收條件。

- `Design Go: <7-hex-commit-prefix>` 用來核准重大工作的指定計畫版本。助理會提供你需要填入的版本識別碼。

- `Result Go: <implementation commit>` 用來核准交付已檢查的重大工作成果。

- 回答計畫裡的問題，和同意開始實作，是兩件不同的事。

如果不想一直被例行選項打斷，可以使用 `auto-reply: on`。平常維持關閉、只想讓這一批已同意的工作自動採用安全預設答案時，可以用 `keep-going`；這批工作結束後會關閉。若兩種指令一起用，請說清楚最後要保留哪個設定。

這兩種方式都不會代替 Design Go 或 Result Go。如果希望你不在時也能完成已談好的任務，可以在目前的 Ask 加上 `away: gates`，授權助理在必要證據都通過後提供這兩項核准。它不會擴大範圍、接受失敗的檢查，或另外授權不可逆的操作與對外傳訊。

例如，工作範圍已經談好時，可以這樣說：

```text
keep-going
away: gates
完成目前 Ask 裡已談好的任務，例行選項採用安全的預設答案。
必要證據通過後，再提供 Design Go 和 Result Go。
這項任務完成後，把 auto-reply 恢復為 off。
```

## 6. 審查結果代表什麼

`cross-check` 會針對已儲存的實作版本，分別回答：

- **Outcome：** 有沒有做出你要的結果？

- **Minimality：** 能不能刪除或合併某個部分，或沿用現有行為，就同樣滿足要求？

- **Conformance：** 有沒有遵守已同意的範圍與規則？

每一項會標示 `PASS` 或 `BLOCKING`。`Minimality: BLOCKING` 表示有更簡單、也足以完成任務的做法。計畫中的 **Minimality check** 會在動手前先問同樣的問題。目前的助理也會親自檢查成果，技術紀錄稱為 **host gate**。

依改動性質，審查深度分成 `narrow`、`targeted`、`full`。加上 `stronger` 可提高一級。仍適用的通過紀錄可以沿用，不會因為審查較深入就自動重跑所有測試；實作改變後，相關審查證據也要更新。完整流程中符合條件的驗收，可以直接算作最後審查，不用重複做一次。

一般資訊性文件可能只需要目前助理自行檢查；操作指引、程式行為或重要證據的改動，則可能需要 另一位助理審查。你可以說「這一輪略過 另一位助理審查」，或使用 `skip-review: <原因>`；必要測試、助理的自行審查，以及適用的核准步驟仍會保留。

## 7. 同時做兩個功能，互不干擾

**功能工作區（feature stream）** 讓一個功能有自己的資料夾和筆記。在 Git 專案中，它會使用分支，也就是另一條版本紀錄，以及 worktree，也就是存放該分支檔案的另一個資料夾。把檔案分開，能減少兩個對話互相覆寫的情況。

1. 在助理對話中輸入 `new-feature: login-page`。

2. Agentflow 建好工作區後，會提供接續指令。先離開目前的助理，在一般終端機執行該指令，再於新的對話中輸入 `godev`。

3. 接著使用該功能自己的筆記，通常放在 `.agentflow/features/login-page/`。主專案會保留指向它的紀錄。

4. 準備把功能帶回主專案時，在功能對話裡說 `merge-back`。助理會透過有檢查機制的流程，準備並完成合併。

5. 回到主專案後，可用 `cleanup:login-page` 移除已完成的暫存分支和資料夾，筆記與工作文件會留下。尚未交付的工作可能會先被合併。若確定要放棄尚未合併的工作，才使用需要確認的 `agf ditch login-page`。

沒有 Git 也能做一般筆記工作。非程式的獨立對話筆記可以不建立分支，但 `new-feature:` 建立功能工作區時需要 Git。工作區也不等於安全沙箱。

<details>

<summary>功能合併遇到問題時</summary>

- `agf finish --prep` 會把主分支的變更帶進功能分支，並停在交付之前。`agf finish --deliver` 則要等收尾紀錄與必要檢查完成後，才能交付。

- 如果準備階段回報衝突，它已經中止該次合併。請留在功能分支，讓助理整理並提交正確的合併結果，再重試 `finish --prep`。這時不要使用 `git merge --continue`，也不要跳到交付步驟。

- 未提交的檔案、已變動的分支版本、不相符的資料夾或紀錄，都可能讓交付暫停。請依回報的復原方式處理；合併被拒絕，不代表已經合併完成。

</details>

- **Git 操作較慢時：** 用 `git-timeout-ms: 120000` 將每個 Git 指令的兩分鐘上限存入適用的 `ag.json`。此選用設定接受正整數毫秒數，預設為 30000（30 秒）。有效的環境變數 `AGF_GIT_TIMEOUT_MS` 可暫時覆蓋設定；無效值會回到專案設定，再回到預設值。例如 `AGF_GIT_TIMEOUT_MS=120000 agf finish --prep`。逾時時遠端操作結果可能尚未確定，重試前應先確認工具回報的狀態。

- **Git 預設分支：** Agentflow 先讀取 Git 設定 `agentflow.default-branch`，其次使用本機快取的 `origin/HEAD`，最後才尋找本機既有的 `main` 或 `master`。自訂預設分支可執行 `git config --local agentflow.default-branch trunk`，將 `trunk` 換成已存在的本機分支。執行 `git config --local --unset agentflow.default-branch` 可移除指定值。要將遠端目前的預設分支更新至本機快取，執行 `git remote set-head origin -a`；若 Git 回報目標不存在，先 fetch。啟動和提交保護檢查不會連線。這項 Git 設定不屬於 `ag.json`。

## 8. 用一句話調整設定

輸入 `settings` 可以查看目前設定與可選值。要修改時，送出一行指令，例如 `lang: zh-tw`，助理就會驗證並儲存到適用的 `ag.json`。通常不需要自己編輯 JSON。

- **語言：** `lang: en` 或 `lang: zh-tw` 控制 AI 撰寫的回覆、紀錄、文件、註解和提交訊息。你的原話會保留，也能替單一文件另指定語言。

- **例行回答：** `auto-reply: on|off` 控制是否自動採用安全的預設答案。

- **進度紀錄：** `log-verbosity: off|wip|all` 預設為 `all`。例如 `log-verbosity: wip` 會保留檢查點，但省略之後的 RUN。

- **Reply 顯示：** `inline-reply: on|off` 預設為 `off`。例如 `inline-reply: on` 會在成功收尾或交付後顯示已保存的完整 Reply；`off` 會保留「路徑已更新」的確認訊息。這個開關獨立於 `log-verbosity`。

- **開發流程：** `allow-ag: on|ask|off` 分別表示允許、先詢問、禁止啟動流程。三種設定下都能直接處理一般工作，輸入 `ag` 不會蓋過 `off`。

- **功能工作區：** `streams: ask|always|off` 控制一般要求開新功能工作區時，是否先詢問、自動建立，或只提示而不建立。明確的 `new-feature:` 仍會直接提出建立要求。

- **協作政策：** `allowed-worker: ["external", "internal", "host"]` 是沒有順序意義的 JSON 權限清單。host 會依每項工作的情境、交接成本、可用的平行工作、能力和 owner 限制，選擇符合條件的允許 kind，並記錄簡短理由。若有多個符合條件的 kind，且尚未提供 host 的選擇，selector 會回傳 `selection-required` 和可選方案，讓 host 自行選擇；若只有一個符合條件的 kind，系統可以直接選用。`external` 使用已檢查的指令配方，`internal` 把凍結的 brief 交給目前助理真正提供的 native tool，`host` 直接由目前工作階段執行。新專案預設三者都可用；v7 遷移會先保留 `["external", "host"]`，直到你明確選擇新政策。

- **審查政策：** `review-policy: prefer-independent|require-independent` 決定在獨立審查路徑確認無法使用後，是否可用清楚標記的 目前助理自行審查 收尾。它不會改變執行權限，也不能繞過明確要求獨立審查、全新對話脈絡 或強制唯讀的工作。

- **工具家族：** `cli-provider: on|off` 只篩選 external profile。`on` 接受已設定且可用的家族；`off` 需要已知的目前 `host-family`，未知家族不會匹配。internal 和 host 路徑依各自能力判斷。

- **筆記位置：** `target-doc: .agentflow/shop.devlog.md` 會提出由系統處理的重新命名。這項操作需要 Git，會先移動筆記與封存檔，再更新設定和轉址連結。舊位置會留下指引。

<details>

<summary>其他設定與模型選擇</summary>

- `workspace-dir` 指定專案內的紀錄資料夾，通常是 `.agentflow`。[工作文件位置](../SKILL.md#task-artifact-locations)說明筆記、功能工作區、產出文件和任務佇列的路徑。

- `ask-names: on|off` 控制是否在新的 Ask 標題加上提問者姓名。

- `large-work-minutes` 預設為 120，可設為 1–10080，代表流程判斷大型工作的時間門檻。

- `completion-cleanup` 預設為 `off`。啟用後，對話結束時可以把已完成、未使用且超過 30 天的輔助紀錄移到垃圾桶。目前使用中或仍需要的證據會保留。

- `completion-cleanup-interval-days` 預設為 7，可設為 1–365，控制兩次成功清理的間隔，和「紀錄至少存放 30 天」是不同條件。

- 設定檔使用 `"schema-version": 8`。新專案採用上述 worker 和 review 預設值；worker 陣列的順序沒有執行意義。既有 v7 檔案只在開啟時以保守方式原子遷移，保留原有效政策，除非你明確選擇加入新預設值。

- `pipeline-roles` 把 requirements、codewalk、explore、spike、spec、implementation、security-scan、acceptance、cross-check、learn 對應到模型等級或 `off`。關閉必要角色後，完整流程就無法執行。

- `external-workers` 保存選用 external profile 的指令，以及 `best`、`better`、`basic`、`cheap` 各等級使用的模型與推理程度。這些是本機設定名稱，不是通用的模型排名。native tool 或 host 可能只能沿用繼承的模型與推理程度；必須記下實際身分和限制，不要宣稱使用了設定中的等級。

- 可以請助理協助調整像 `codex-default.basic: <model>/<effort>` 這樣的設定。如果你明確指定的模型無法使用，助理必須先問過，才能換成別的模型。

</details>

## 9. 找專業顧問，或執行事先排好的工作

較大的工作可以請顧問針對特定問題協助判斷。例如：「使用 `advisors: requirements, codewalk, spec`，釐清這次修改要怎麼配合現有專案。」請說明要解決哪個不確定的地方；是否能使用顧問，仍受 `allow-ag` 控制。

需要把工作排成佇列時，`make-plans` 會保存計畫，並**停在實作之前**。看過後，可以用 `run-plans` 執行現有佇列；`run-looper` 則會啟動文件指定的循序執行工具。每次只跑一份計畫，失敗或被修改的計畫會留下來，供你檢查。

<details>

<summary>顧問、協作助理與任務佇列參考</summary>

- **直接處理（direct route）：** 明確、可回復的工作，由目前助理處理；交接划算時，也能委派範圍清楚的工作。

- **指定顧問（selected-advisor route）：** 只使用能回答具名重要問題的顧問。可用名稱為 requirements、codewalk、explore、spike、spec、security-scan、acceptance、learn。

- **完整流程（full-pipeline route）：** 需要需求、規格、實作和獨立驗收；既有專案也要先了解現況。程式導讀若已涵蓋現況調查，可用 shared-coverage marker 記錄共用的查核結果。`all-in` 會要求所有選用顧問。

- **暫時無法繼續（blocked route）：** 助理會說明待決定的事項、缺少的能力或失敗的檢查，同時繼續其他不受影響、已授權的工作。

- 顧問名稱必須使用指定的小寫拼法。空白項目、尾逗號、非字串值和不認識的名稱，都會在任何 advisor 啟動前被拒絕。重複名稱依輸入順序去除，執行時仍遵守相依性；只選 requirements 不會取消後續已授權的實作與驗證。

- host 會在 `allowed-worker` 允許且符合條件的 kind 中選擇 transport。External 使用 `external-runner-v1` 的獨立、沒有遠端連線設定的暫存 Git 複本；internal 使用目前助理真正提供的 native tool handle；host 留在目前工作階段。主要助理會檢查變更後才接受結果。複本或 native tool 可見性都不是安全沙箱，程序正常結束或送出訊息也不等於任務成功。符合檔案、指令和狀態保存條件的助理可使用 通用核心流程；Codex 和 Claude 的啟動與 hook 整合保留回歸測試。Native 完成與中斷流程已在 Codex 實測；其他具名 native 整合尚未實測。

- 每個審查階段最多啟動三次協作助理；程序尚未啟動前的一次前置檢查失敗不計入。沒有新輸出不代表卡住。你的停止指令優先，取消後不能未經同意自行重啟。

- `agf-looper --tasks-dir <path>` 用來指定佇列。系統產生的佇列包含 `plan-NNN.md` 和用來偵測計畫變動的 `.queue-generation.json`；手寫佇列則使用計畫檔及筆記中的完成證據。驗證通過後，計畫才會移到 `planned/done/`。

- `--show-output` 顯示協作助理的輸出，`--dump` 則會保存。使用 `--reset` 前，先確認相關程序已停止；它只清除停止狀態，仍要另行執行才能接續。Standalone looper 只有已檢查的 external 能力；external 不可用或被禁止時，會保留佇列待辦並交回互動式 host，不會自行建立第二套排程器。計畫執行者不能再啟動協作助理或另一套 Agentflow 流程。詳見[佇列執行參考](../references/looper.md)。

</details>

## 10. 中斷後怎麼接著做

開啟同一個專案，輸入 `godev`。助理會先閱讀目前的 Ask、你已填寫的答案、進度紀錄與相關專案狀態，再繼續工作。若不確定目前情況，可以問：「哪些已經完成、哪些還沒做，接下來該做什麼？」

- **協作助理中途停止：** 主要助理會先檢查保存的輸出和變更，再決定結果能否接受。沒有新訊息，或結束碼是零，都不足以單獨證明成功。

- **設定遺失或無效：** 請助理解釋需要怎麼修復。既有設定不能靠 STATUS 猜回來。v7 檔案只在開啟時遷移，既有選擇會保留，除非你明確選擇新 worker 和 review 預設值。

- **不同 skill 好像互相衝突：** 可以要求 `agf skills audit`。這個指令會列出找得到的 skill，準備唯讀評估資料，本身不修改檔案，也不呼叫模型；再由助理解釋確定的衝突與處理建議。

- **只想在本機完成：** 請在要求裡說清楚。沒有 Git 時只做本機交付；有 Git 時，Agentflow 通常會提交有意義的工作，並在設有遠端儲存庫時推送，除非你限制交付範圍。它會保留無關的修改，也不會強制推送。

<details>

<summary>輔助紀錄是什麼</summary>

- 筆記保存你的要求、即時 RUN 事件、決定與回覆，讓工作可以接續。拆成多項任務時，也會使用進度追蹤表。新時間戳記使用本機時間，格式為 `YYYY-MM-DD HH:MM:SS ±HHMM`；RUN 與 WIP 標題會附上 Ask 編號。

- WIP 會列出 **Finished**、**Running now**、**Still to do**、**Next work action**。`Still to do: None.` 表示該清單已沒有待辦事項。這些說明用來掌握進度，本身不代表成果已通過驗證。

- 新的 Codex Reply 會使用目前對話最新記錄的模型與推理程度。證據缺少或衝突時，會標成 `codex/unknown`；Claude 目前還沒有可驗證的推理程度擷取方式。舊回覆不會被重新標記。

- 完成檢查需要的輔助資料放在工作資料夾的 `.tmp/`，新的 Reply 不會再混入自動產生的證據連結與雜湊值。這些本機檔案不納入 Git，複製儲存庫時不會一起帶走。證據遺失或損壞不能算通過；需要重新查核時，請先還原已移到垃圾桶的紀錄。

- 封存檔變大後，不會再觸發原本收尾讀取的 1 MiB 限制。修正後重試會分段讀取封存檔；內容未變、已驗證的重試則沿用現有證據。封存歷史仍保留原樣。

- 完整操作細節請看 [SKILL.md](../SKILL.md)、[指令參考](../scripts/README.md)和[收尾規則](../references/closeout.md)。評測結果只適用於受測的助理、模型與環境，不保證之後每一項任務都能得到相同結果。

</details>
