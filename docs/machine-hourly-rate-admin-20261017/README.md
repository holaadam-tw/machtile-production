# 機台時率管理：owner 套用說明

此資料夾是待套用 SQL，網站部署不會自動執行。Codex 未連正式 DB、未執行 SQL。

套用前請 owner 在正式 Supabase 專案確認備份與目標 project ref，再於已設定正式連線字串的 PowerShell 執行：

```powershell
psql "$env:MACHTILE_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f .\docs\machine-hourly-rate-admin-20261017\migration.sql
```

套用後重新整理 APP，以管理員登入「管理 → 機台主檔：時率」。主管、排程、作業員都不會看到入口，強制呼叫 RPC 也會得到 `FORBIDDEN`。

需要回退 RPC 時（不會回復已儲存的機台時率與 audit 歷史）：

```powershell
psql "$env:MACHTILE_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f .\docs\machine-hourly-rate-admin-20261017\rollback.sql
```
