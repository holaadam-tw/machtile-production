# 工單管理／機台卡片工序選擇（2026-10-05）

## 配套與上線順序

配套後端：holaadam-tw/machtile-mini-mes [PR #92](https://github.com/holaadam-tw/machtile-mini-mes/pull/92)，必須採用已回覆本輪審查的最新 head（同道派工橋改機台例外，不是原始版）。

1. Owner 審查並授權後，先套 #92 的 `supabase/migrations/20261005060352_work_order_process_guard.sql`。套前核對函式版本、保存完整定義及 ACL；migration 對來源漂移會停止，不可改雜湊繞過。
2. 確認 RPC 工序保護生效，再核准合併本前端 PR 到 main。不可先合前端而讓舊 RPC 繼續預設 N1／接受已報工搬移。
3. 本次只交 PR；未合併、未部署、未套正式 migration，也未連正式資料庫。

## 行為

- 工單管理列出已存在的全部工序：N（實際 process_order）、名稱、機台／委外、狀態、已報量；不補猜舊 MES 未同步的路線。
- 使用現有 batch_report_progress＋cardProgress 的去重口徑：舊 MES 結算＋待回寫；沒有舊結算才用 App 累計，不把兩邊加兩次。
- 更新既有工單先選工序，再送 `process_id`＋`process_order`；新工單也明確送正整數步序。已報工停用改機台，RPC 拒絕時顯示原因，報量／原工序不重建。
- 卡片「選擇工單」沿用排程板管理權限，分「這台身上的工序」與「未排機（同課）」；維修／停用無入口。
- 未排機採既有排程板候選條件，再排除委外、已完成及課別不明。課別沿用 machines 主檔部門／機台類型的既有正規化；工序依既有名稱明示車床／車削／lathe、銑床／銑削／加工中心／mill 等辨識。泛稱 CNC 加工不推測課別，不依 A/B 代碼造能力設定。
- 選取前重新讀資料並確認仍可派；只送選定工序＋這台原有未完成工序，不把其餘未排機一起派過來。
- `machine_queue_reorder` 第①張成為卡片目前工單；刷新仍保留。舊「切換顯示」仍只影響當次畫面，不寫入。
- 機台／工序資料讀取失敗不可當作可派；後端拒絕已有報工搬移時，顯示保護原因。
- app.js／styles.css URL 版本更新為 `20261005-process-identity-r2`。
- 本輪審查修正：空白製程名稱沿用所選工序原名；機台清單失敗／原 machine_id 對不到清單時，顯示讀取錯誤且停用送出，不當作未排機、不取消指派。舊表單遲到回應不能覆寫新表單。

## 本機驗證

```powershell
$env:MACHTILE_PLAYWRIGHT_MODULE='<existing-playwright-install>\index.mjs'
node --check app.js
node workOrderProcess.browser.test.mjs
node workOrders.browser.test.mjs
node cardPick.browser.test.mjs
Get-ChildItem -File *Core.test.js | ForEach-Object { node $_.Name; if ($LASTEXITCODE -ne 0) { throw $_.Name } }
git diff --check
```

- 新工序／卡片整合：38 PASS、0 FAIL（含原名稱保留、機台讀取失敗、整頁重載保持、連點不重送）。
- 更新舊工單測試：91 PASS、0 FAIL。原自動帶第一台的斷言改為先選工序；已報 N1 鎖定、未報 N2 改派、取消確認不送出；瀏覽與查詢不寫入。
- 原卡片測試：76 PASS、0 FAIL。
- 11 支 Core 測試：655 PASS、0 FAIL；app.js 語法與 diff check 通過。
- #92 記憶體 SQL 測試46 PASS：多道缺步序拒絕、偽造步序／跨租戶／權限拒絕、App／legacy 報工保護、橋同道改機台／取消派機、legacy N2保留、新N3新增、正式queue完整快照驗證、rollback精確恢復。
- 瀏覽器使用 localhost 靜態頁與攔截的假 API；零正式網域請求。新截圖皆 TEST-* 假品號，留本機 `output/playwright/process-identity/`，不納入 PR。

## 範圍／剩餘風險／回滾

程式檔只有 app.js、index.html、styles.css；測試只改 workOrders.browser.test.mjs、新增 workOrderProcess.browser.test.mjs。沒有改 config.js、既有報工節點／品檢打卡板、auth、schema、依賴或派工橋。原 checkout 使用者本地變更保留。

未在正式帳號／瀏覽器重跑事故，不宣稱已線上修復；真實多連線競態與正式函式當下版本仍須上線前核對。未知課別故意不顯示，不建立工序↔機台能力表。

尚未部署無需正式回滾。若未來上線需回退，先回退前端 commit，再由 owner 執行 #92 的 `supabase/rollbacks/20261005060352_work_order_process_guard.rollback.sql`；rollback 核對修後來源，不刪工單、工序或報工資料。不可直接刪除有報工列修復畫面。
