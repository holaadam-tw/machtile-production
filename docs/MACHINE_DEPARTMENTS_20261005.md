# App 課別鎖定

PR only；不合併、不部署、不連正式庫。上線順序：mini-mes #92 → #93 → 課別 backend membership+enforcement migration＋Jev caller-scoped reads → login-center 課別管理頁及本 App PR。

App 讀 machine_department_context，以目前 server-owned 課別而非 JWT role 決定「全部／車床課／銑床課」可選项。
單課鎖定該課；兩課可切換但不增加「全部」；planner 以上保留全部。
取消全部提示「此帳號沒有任何課別，請管理員設定」，不還原本機預設機台。
真正授權由 backend RPC/RLS 防護，不以隱藏按鈕代替。

新機台課別必填；編輯保存真實 department_id，不能從 machine_type 推測。
NULL 課別由 backend 對現場隱藏，生管以上顯示「未設定課別」。
機台／課別讀取失敗 fail closed；重驗權限時清掉舊工單、額外卡片、報工／佇列／進度／TV 快取。
登出及課別切換的 generation 保護避免遲到的舊請求回填；電視牆不能由固定 11 格重造未授權機台。
未修改 styles.css，index.html 的 app.js ?v= 已 bump；不修改示範模式業務邏輯。

## 驗證

```powershell
$env:MACHTILE_PLAYWRIGHT_MODULE='<本機Playwright index.mjs>'
node machineDepartments.browser.test.mjs
node --check app.js
$tests = @(Get-ChildItem -File -Filter '*Core.test.js' | ForEach-Object Name)
node --test $tests
```

1440/390 真正 index.html+app.js 合成 HTTP fixture：66/66 PASS、0 JS errors。
涵蓋單課／兩課實際點擊／全取消／生管、偽造全部按鈕、查詢失敗、TV 過期資料、登出遲到回應、新增機台必填與保存欄位。
所有 API 僅 fake backend route.fulfill，本機主機只接受 GET，其他網路一律阻擋。
Core suite 11 個 test files PASS；首次／今日開工瀏覽器回歸 40/40（只補合成課別 context 回應，首件檢查業務不變）；截圖為合成資料，留 output/playwright 本機，不入 PR。
未執行登入真正帳號、未進行正式報工或派工；須在 owner 套 backend 後作隔離角色驗收。

## 回退

未部署：關閉 PR 或另建 revert。已部署：回前一前端資產版本，保留 backend 權限（舊 UI 不可繞過）；若 backend 也回退，先退 UI／管理頁／Edge，再執行 backend 的 enforcement→membership rollback。
