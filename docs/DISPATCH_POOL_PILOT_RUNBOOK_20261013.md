# 派工池接單 A01/A03 pilot RUNBOOK

範圍：車床課 A01、A03，一週。這份文件只定義上線與回滾順序；本 PR 不套正式 Supabase、不改 Factory、不合併或部署。

## 上線前 gate

1. 確認 mini-mes migration `20261007120000_dispatch_pool_items.sql`、`20261012153614_dispatch_pool_claim_step3.sql`、`20261013014604_dispatch_pool_return_step4.sql` 均已在目標環境通過 preflight／PGlite；必須包含 `MACHINE_NOT_IDLE`、eligible list、課別、原子 claim、planner/admin 退回及 claim→退回→重接。先匯出 `machtile_dispatch_pool_private.claims`（若已有資料）再規劃任何 rollback。
2. 依既定 DB 變更程序套上述 migration；先唯讀確認 RPC 與 ACL（預期兩列，owner 為 migration owner；`anon/service_role/PUBLIC` 無 execute）：
   ```sql
   select p.oid::regprocedure::text as rpc, pg_get_userbyid(p.proowner) as owner,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
          has_function_privilege('anon', p.oid, 'execute') as anon_execute,
          has_function_privilege('service_role', p.oid, 'execute') as service_role_execute
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.oid in (
     'public.dispatch_pool_claim(text,text)'::regprocedure,
     'public.dispatch_pool_return(text,text)'::regprocedure
   ) order by rpc;
   ```
   再確認目標 tenant gate 仍為 `false`；不要在同一步開旗標：
   ```sql
   select tenant_id, enabled, updated_at
   from machtile_dispatch_pool_private.claim_settings
   where tenant_id = '<TARGET_TENANT_UUID>'::uuid;
   ```
3. Factory 端確認 `FactoryDispatchPoolEnabled=true`，bridge 設定的 `enabled/apply`、來源 allowlist、同步延遲與錯誤佇列皆正常；先 dry-run，再用唯讀查詢確認車床課資料只帶 LATHE 且 eligible list 符合 BOM/APS。不得連工廠機做測試寫入。
4. 經 owner 另行核准正式 DB 寫入後，才可用明確 tenant 開 gate（不得省略 `where`），並立即反查一列；APP 的 `dispatchPoolMachines` 此時仍須為 `[]`：
   ```sql
   begin;
   update machtile_dispatch_pool_private.claim_settings
   set enabled=true, updated_at=clock_timestamp()
   where tenant_id='<TARGET_TENANT_UUID>'::uuid and enabled=false;
   commit;
   select tenant_id, enabled from machtile_dispatch_pool_private.claim_settings
   where tenant_id='<TARGET_TENANT_UUID>'::uuid;
   ```
5. 合併 APP PR 才會上線，因此合併前再次確認 production 的其他未合併 PR 衝突已處理、資產 `?v=` 已更新、`dispatchPoolMachines: []`。合併後先驗證旗標關時沒有任何可按接單按鈕。
6. 最後才將 APP 與 Factory 同步旗標設為首波 `dispatchPoolMachines: ["A01", "A03"]`。不得開 A02/A04/A05、銑床課或 `"*"`。

## 一週 pilot 驗收

- 課別：A01/A03 只看到 LATHE；B01–B06 與非車床課帳號看不到車床池。
- eligible：同課但不在 `eligible_machine_codes` 的機台不能按；server 直接呼叫也回 `MACHINE_NOT_ELIGIBLE`。
- 空閒：機台 master 非 `idle`，或已有 pending/running/paused/waiting_inspection/abnormal 工序時不能接。
- 競爭：A01/A03 同時接同一張，恰好一台成功；另一台顯示「已被其他機台接走」，不得產生第二筆 claim/process。
- 旗標：APP allowlist 或 server tenant gate 任一關閉即不能接。
- 閉環：成功 claim 後 Factory consumer 將舊 MES 派工與池狀態推進；失敗有可追查錯誤且不重派。
- 退回：以 planner 登入 APP，在已由池接單的機台卡或「選擇工單」池清單按「退回池子」，輸入原因；operator 畫面不得出現按鈕。退回後 process `machine_id`/`queue_order` 為 null、池列為 `waiting/returned`、第一筆 claim 有 `returned_by/return_reason/returned_at`；再由另一台 eligible idle 機台重接，必須新增第二筆 claim 且只剩一筆 active claim。已開工或已有報工必須拒絕。
- 退回唯讀驗收（以實際 source key 代入，不含 token）：
  ```sql
  select source_key, machine_id, claimed_by, claimed_at, returned_by, return_reason, returned_at
  from machtile_dispatch_pool_private.claims
  where tenant_id='<TARGET_TENANT_UUID>'::uuid and source_key='<SOURCE_KEY>'
  order by claimed_at;
  -- 預期兩筆：第一筆 returned_* 完整，第二筆 returned_at is null。
  select source_key, status, source_status, gone_at from public.dispatch_pool_items
  where tenant_id='<TARGET_TENANT_UUID>'::uuid and source_key='<SOURCE_KEY>';
  -- 重接後預期 gone；退回後、重接前預期 waiting/returned/gone_at null。
  ```
- 韌性：離線、重複按、舊頁面、重新登入、bridge 延遲與重啟不造成重複派工。
- 每日記錄：成功／搶輸／拒絕／同步錯誤數、最大同步延遲、人工介入、A01/A03 實際接單與退回樣本。

## 回滾

1. 先把 APP `dispatchPoolMachines` 改回 `[]`，確認所有接單按鈕 disabled；不回滾既有工單。
2. 經 owner 另行核准正式 DB 寫入後，以明確 tenant 關 gate，並反查 `enabled=false`；不得省略 `where`：
   ```sql
   update machtile_dispatch_pool_private.claim_settings
   set enabled=false, updated_at=clock_timestamp()
   where tenant_id='<TARGET_TENANT_UUID>'::uuid;
   select tenant_id, enabled from machtile_dispatch_pool_private.claim_settings
   where tenant_id='<TARGET_TENANT_UUID>'::uuid;
   ```
3. 停止 Factory claim consumer／apply，但保留 bridge 只讀觀測與錯誤證據；若 source 同步也異常，再依 Factory runbook 關 `FactoryDispatchPoolEnabled`。
4. 生管在 Factory 逐筆處理已 claim 未落舊 MES 的項目；禁止直接刪除 `claims`、`work_orders` 或 `work_order_processes`。
5. migration rollback 只在 claims ledger 已匯出且為空／可安全保留時執行；既有 rollback 會以 `DISPATCH_POOL_CLAIM_EXPORT_REQUIRED` fail closed。沒有 owner 的正式 DB 授權不得執行。
6. APP 程式回滾到本 PR 前的完整 SHA；做只讀 smoke，確認原本待做池只讀、排程與報工未受影響。

## 停止條件

任一重複派工、跨課可見／可接、非 eligible 可接、忙機可接、claim 成功但 Factory/舊 MES 未閉環，立即關 APP 與 server gate並停止 pilot；保存 correlation/error code、時間、source key、機台代號與版本，不記 token 或敏感 payload。
