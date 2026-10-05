# 共用製程流程條（A 前端；PR only）

依賴／上線順序：#92 migration → mini-mes #93 migration → 本 PR 前端。先合 #60（本分支基底）及 SoftNet #768 派工工序名後上線；本次不合併、不部署、不套庫。main 有分支保護，本 PR 只推功能分支。

套用機台卡片、工單管理現有製程清單、排程板卡片。processFlowCore.js 同一 renderer：真實 process_order／process_name、machine_code（缺少委外廠商資料明示「委外廠商無資料」，不以名稱猜代號）、狀態、batch_report_progress 含舊 MES＋待回寫的已報量／工單量。current 用 process ID 或唯一 running；多個 running 不猜。路線缺漏不補假工序，查詢失敗不顯示假 0。手機長路線在元件內橫向捲動、目前道居前，不讓頁面溢出。

同課下一道可選可用機台並呼叫 #93 machine_queue_append，一次原子追加尾端、不重送整台 queue。App 不寫舊 MES，已報工／委外／課別不明／維修停用不能預排；伺服器再次檢查（前端只是提示）。progress 或 audit 讀取失敗時不提供預排操作。既有 machine_queue_reorder「選目前工單」功能不變。

client request UUID 在網路結果不確定時保留；雙擊一筆 in-flight，同 UUID 重送交給 server idempotency；成功後重新讀路線及 queue。若 server 成功但畫面更新失敗，明示「已預排」並停用重送按鈕。process_assignment_events 僅讀，實際 legacy_reassigned 才顯示「已依舊 MES 改派」；未確認不假報改派。

## 驗證（全假資料，本機瀏覽器）

```powershell
node processFlowCore.test.js
node --check app.js
$env:MACHTILE_PLAYWRIGHT_MODULE='D:\Codex\MachTile\.test-deps-hmc-20260913\node_modules\playwright\index.mjs'
node workOrderProcess.browser.test.mjs
```

Core 25/25；實際 index.html/app.js + 假 API 的 browser 63/63（同時重跑 #60 原有驗證）。含 8 道、委外、已完成、1440/390、不溢出、預排同課選項、reported 拒絕、雙擊／重試、順序不歸零、legacy override、audit 缺表 fail-closed、外部網路封鎖。fake HTTP 的寫入僅 Playwright route.fulfill；沒有連任何真實 Supabase 或 DB。

index 的 app.js/styles.css ?v 已 bump，新增 core 在 app.js 前載入。既有首件檢查／今日品檢打卡／報工 payload／舊 MES 回寫沒有改動。

### 假資料截圖

![卡片與排程流程條 1440](./_evidence/process-flow/process-flow-1440.png)
![卡片與排程流程條 390](./_evidence/process-flow/process-flow-390.png)
![工單管理 1440](./_evidence/process-flow/steps-desktop.png)
![工單管理 390](./_evidence/process-flow/steps-mobile.png)

## 限制／回滾

目前 MachTile 既有工序表沒有橋接委外廠商代號來源；只能對已提供 supplier_code 的資料顯示代號，正常讀取缺少時明示無資料。#93 尚未套庫時預排自動不可用。完整路線只取既有列，不承諾未同步的後續工序。

回滾前端至本 PR 前的 #60 commit fd37ffe537a30dc24cc6b34aa7d627a524fc8597；如另需回滾 schema，先停前端預排再由 owner 按 #93 rollback，保留 audit 歷史。不合併、不部署，沒有正式資料可回復。
