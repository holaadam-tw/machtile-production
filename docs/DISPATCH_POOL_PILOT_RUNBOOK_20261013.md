# 派工池接單 A01/A03 pilot RUNBOOK

範圍：車床課 A01、A03，一週。這份文件只定義上線與回滾順序；本 PR 不套正式 Supabase、不改 Factory、不合併或部署。

## 上線前 gate

1. 確認 mini-mes migration `20261007120000_dispatch_pool_items.sql`、`20261012153614_dispatch_pool_claim_step3.sql` 均已在目標環境通過 preflight／PGlite；後者必須包含 `MACHINE_NOT_IDLE`、eligible list、課別與原子 claim 檢查。先匯出 `machtile_dispatch_pool_private.claims`（若已有資料）再規劃任何 rollback。
2. 依既定 DB 變更程序套上述 migration；驗證 `dispatch_pool_claim(text,text)` 僅授權 `authenticated`，tenant 的 `claim_settings.enabled` 仍為 `false`。不要在同一步開旗標。
3. Factory 端確認 `FactoryDispatchPoolEnabled=true`，bridge 設定的 `enabled/apply`、來源 allowlist、同步延遲與錯誤佇列皆正常；先 dry-run，再用唯讀查詢確認車床課資料只帶 LATHE 且 eligible list 符合 BOM/APS。不得連工廠機做測試寫入。
4. 用受控設定把該 tenant 的 server claim gate 開啟；立即做唯讀驗證。APP 的 `dispatchPoolMachines` 此時仍須為 `[]`。
5. 合併 APP PR 才會上線，因此合併前再次確認 production 的其他未合併 PR 衝突已處理、資產 `?v=` 已更新、`dispatchPoolMachines: []`。合併後先驗證旗標關時沒有任何可按接單按鈕。
6. 最後才將 APP 與 Factory 同步旗標設為首波 `dispatchPoolMachines: ["A01", "A03"]`。不得開 A02/A04/A05、銑床課或 `"*"`。

## 一週 pilot 驗收

- 課別：A01/A03 只看到 LATHE；B01–B06 與非車床課帳號看不到車床池。
- eligible：同課但不在 `eligible_machine_codes` 的機台不能按；server 直接呼叫也回 `MACHINE_NOT_ELIGIBLE`。
- 空閒：機台 master 非 `idle`，或已有 pending/running/paused/waiting_inspection/abnormal 工序時不能接。
- 競爭：A01/A03 同時接同一張，恰好一台成功；另一台顯示「已被其他機台接走」，不得產生第二筆 claim/process。
- 旗標：APP allowlist 或 server tenant gate 任一關閉即不能接。
- 閉環：成功 claim 後 Factory consumer 將舊 MES 派工與池狀態推進；失敗有可追查錯誤且不重派。
- 退回：生管只由 Factory 的「退回池子」操作；bridge 同步後 APP 顯示「退回待接」，原 claim／稽核資料保留。
- 韌性：離線、重複按、舊頁面、重新登入、bridge 延遲與重啟不造成重複派工。
- 每日記錄：成功／搶輸／拒絕／同步錯誤數、最大同步延遲、人工介入、A01/A03 實際接單與退回樣本。

## 回滾

1. 先把 APP `dispatchPoolMachines` 改回 `[]`，確認所有接單按鈕 disabled；不回滾既有工單。
2. 將 tenant 的 `machtile_dispatch_pool_private.claim_settings.enabled=false`，阻斷舊頁面或直接 RPC。
3. 停止 Factory claim consumer／apply，但保留 bridge 只讀觀測與錯誤證據；若 source 同步也異常，再依 Factory runbook 關 `FactoryDispatchPoolEnabled`。
4. 生管在 Factory 逐筆處理已 claim 未落舊 MES 的項目；禁止直接刪除 `claims`、`work_orders` 或 `work_order_processes`。
5. migration rollback 只在 claims ledger 已匯出且為空／可安全保留時執行；既有 rollback 會以 `DISPATCH_POOL_CLAIM_EXPORT_REQUIRED` fail closed。沒有 owner 的正式 DB 授權不得執行。
6. APP 程式回滾到本 PR 前的完整 SHA；做只讀 smoke，確認原本待做池只讀、排程與報工未受影響。

## 停止條件

任一重複派工、跨課可見／可接、非 eligible 可接、忙機可接、claim 成功但 Factory/舊 MES 未閉環，立即關 APP 與 server gate並停止 pilot；保存 correlation/error code、時間、source key、機台代號與版本，不記 token 或敏感 payload。
