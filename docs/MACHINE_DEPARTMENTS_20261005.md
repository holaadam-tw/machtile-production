# App 課別鎖定

PR only；不合併、不部署、不連正式庫。上線順序：mini-mes #92 → #93 → 課別 backend membership+enforcement migration＋Jev caller-scoped reads → login-center 課別管理頁及本 App PR。

App 讀 machine_department_context，以目前 server-owned 課別而非 JWT role 決定「全部／車床課／銑床課」可選项。
單課鎖定該課；兩課可切換但不增加「全部」；planner 以上保留全部。
取消全部提示「此帳號沒有任何課別，請管理員設定」，不還原本機預設機台。
真正授權由 backend RPC/RLS 防護，不以隱藏按鈕代替。

新機台課別必填；編輯保存真實 department_id，不能從 machine_type 推測。
NULL 課別由 backend 對現場隱藏，生管以上顯示「未設定課別」。
初次載入與 GET 刷新機台／課別讀取失敗 fail closed；成功讀到權限變更時清掉舊工單、額外卡片、報工／佇列／進度／TV 快取。POST 前重驗 RPC 失敗則保留當前卡片、選單與開啟的報工表單，提示「本次未送出；已保留表單，請重試」，完全不送出寫入。保留表單不等於授權寫入；下次仍須重驗。
登出及課別切換的 generation 保護避免遲到的舊請求回填；電視牆不能由固定 11 格重造未授權機台。
以已合 main 的 #60／#61 前端為整合來源，保留 processFlowCore.js 及工單工序選擇；index.html 的 app.js／styles.css／流程元件 ?v= 已更新。不修改示範模式業務邏輯。
工序名未知時可用既有指派機台的 department 後備；未知且未指派不提供預排；機台 type 不作課別後備。伺服器同樣保護由 #94 新 migration 提供，已安装 #93 檔案凍結。

## 驗證

```powershell
$env:MACHTILE_PLAYWRIGHT_MODULE='<本機Playwright index.mjs>'
node machineDepartments.browser.test.mjs
node --check app.js
$tests = @(Get-ChildItem -File -Filter '*Core.test.js' | ForEach-Object Name)
node --test $tests
```

1440/390 真正 index.html+app.js 合成 HTTP fixture：78/78 PASS、0 JS errors。
涵蓋單課／兩課實際點擊／全取消／生管、偽造全部按鈕、查詢失敗、TV 過期資料、登出遲到回應、新增機台必填與保存欄位。
所有 API 僅 fake backend route.fulfill，本機主機只接受 GET，其他網路一律阻擋。
本輪補齊 workOrders、batchReport、tvWall、cardPick 四套 RPC mock；工單管理 91/91、批次報工 60/60、TV 75/75、卡片選取 77/77 PASS；整合 main c5cc6bd2 並加入交辦任務 3 後，工序選擇／預排整合 85/85 PASS（包含卡片與完整路線送出前 context 故障保留表單且不寫入）。Core suite 12 個測試檔全過，流程元件內含 38/38 斷言。所有截圖用 TEST 合成資料；只附任務 3 五張去識別截圖，其他本機輸出不入 PR。
未執行登入真正帳號、未進行正式報工或派工；須在 owner 套 backend 後作隔離角色驗收。

## 回退

未部署：關閉 PR 或另建 revert。已部署：回前一前端資產版本，保留 backend 權限（舊 UI 不可繞過）；若 backend 也回退，先退 UI／管理頁／Edge，再執行 backend 的 enforcement_review→process_flow_department_fallback→membership rollback。#93 原 migration 不修改或重跑。
