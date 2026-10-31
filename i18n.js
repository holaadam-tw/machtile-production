(function (root) {
  "use strict";

  const STORAGE_KEY = "machtile.language";
  const DEFAULT_LANGUAGE = "zh-Hant";
  const SUPPORTED_LANGUAGES = [DEFAULT_LANGUAGE, "vi"];
  const warned = new Set();

  const dictionaries = {
    "zh-Hant": {
      outsource_receipt_question: "上一道〈{{step}}〉委外還沒收貨，回來幾件？",
      outsource_receipt_material_question: "上一道『{{step}}（{{vendor}}）』的素材收到了嗎？",
      outsource_receipt_count_question: "上一道『{{step}}（{{vendor}}）』委外回來幾件？",
      outsource_receipt_multi_step: "連續 {{count}} 道委外，每一道都會收這個數量",
      outsource_receipt_received: "收到了",
      outsource_receipt_stale: "委外單剛被別人改過，請重新預覽",
      outsource_receipt_previous_step: "上一道",
      outsource_receipt_doc4: "委外單：{{numbers}}",
      outsource_receipt_quantity: "實際回來件數",
      outsource_receipt_note: "填實際回來的件數，系統會先收貨再報工",
      outsource_receipt_confirm: "確認收貨並報工",
      outsource_receipt_range: "請輸入 1 到 {{max}} 件。",
      outsource_receipt_cancelled: "已取消；本次沒有代收貨或報工。",
      outsource_receipt_not_expected: "現況已更新，不需要代收貨；系統會重新送出報工。",
      simple_report_summary: "這次報：{{process}}（第 {{step}} 道）・已報 {{reported}}", simple_report_summary_nostep: "這次報：{{process}}・已報 {{reported}}", simple_report_summary_fail: "這次報：{{process}}（第 {{step}} 道）・已報 {{reported}}（含不良 {{fail}}）", simple_report_summary_nostep_fail: "這次報：{{process}}・已報 {{reported}}（含不良 {{fail}}）", simple_report_flow_open: "▸流程", simple_report_flow_close: "▾流程", simple_report_total_label: "機台目前總數（這張單）", simple_report_total_label_defect: "機台目前總數（這張單，含不良）", simple_report_defect_qty: "這次不良幾件", simple_report_reason: "原因", simple_report_old_order_note: "請寫一句為什麼報這張單", simple_report_hint: "這次良品 {{good}} 件、不良 {{bad}} 件", simple_report_hint_waiting: "填機台數字後，這裡會顯示這次良品幾件", simple_report_hint_invalid: "機台數字不對，請確認是這張單的數字", simple_report_operator: "報工人：", simple_report_operator_starter: "（開工的人）", simple_report_operator_none: "未選報工人", simple_report_change_operator: "換人", simple_report_change_operator_done: "收起", simple_report_waiting: "工廠計算中… {{seconds}} 秒", simple_report_sending: "送出中，請稍候…", simple_report_sending_button: "送出中…", simple_report_resubmit: "重新送出", simple_report_ack_submit: "確認沒錯，送出", simple_report_cancelled: "已取消，沒有收貨也沒有報工。", simple_report_timeout: "工廠沒有回應，請再按一次送出。", simple_report_unconfirmed: "上一筆還沒確認有沒有報進去，請先不要重送，請通知主管。", simple_report_done: "上一筆已報工完成。", simple_report_tech: "技術細節", simple_block_qty_exceeds: "這次數量比可以報的還多，請確認機台數字是這張單的。", simple_block_stock_short: "素材庫存不夠，沒有報進去，請通知生管。", simple_block_not_started: "這台還沒開工，請先按開工再報工。", simple_block_closed: "這一道已經結束，不能再報，請通知生管。", simple_block_changed: "工單剛有變動，請再按一次送出。", simple_block_reason_required: "有不良品時，請選不良原因。", simple_block_note_required: "請寫一句原因再送出。", simple_block_qty_invalid: "數量不對，請確認機台數字。", simple_block_disabled: "這台目前不能用平板報工，請通知主管。", simple_block_receipt: "上一道委外還沒收貨，沒有報進去，請通知生管。", simple_block_unavailable: "平板報工暫時不能用，請通知主管。", simple_block_generic: "這次沒有報進去，請通知主管。", simple_soft_old_order: "同一個料號已經有比較新的工單。確定要報這張，請寫一句原因再按送出。", simple_soft_high_fail: "這次不良比較多，數字沒錯就再按一次送出。", simple_soft_exceeds_order: "這次會超過工單數量，數字沒錯就再按一次送出。", simple_soft_duplicate: "這個數字跟剛剛報的一樣，確定是新做的就再按一次送出。", simple_soft_auto_pull: "這次會自動先領素材，數字沒錯就再按一次送出。", simple_soft_receipt: "上一道委外還沒確認收貨，數字沒錯就再按一次送出。", simple_soft_generic: "請確認數字沒錯，再按一次送出。",
      batch_total_label: "機台目前總數", batch_added_qty: "本次增加 +{{quantity}} 件", batch_added_split: "這次良品 {{good}} 件、不良 {{fail}} 件", batch_added_waiting: "輸入後顯示本次增加", batch_total_below_reported: "總數不能少於已報 {{reported}} 件", batch_defect_toggle: "有不良品", batch_technical_details: "技術資訊", batch_submit_all: "一次全部送出", batch_submit_all_count: "一次全部送出（{{count}} 台）", batch_report_hint: "只要填<strong>機台目前顯示數</strong>，系統自動算這次增加；有不良再勾「有不良品」。完工請在機台卡上按。",
      start_backfill_confirm: "機台顯示 {{machine}} 件、系統只記 {{reported}} 件。按確認開工會同時補報 {{gap}} 件（算前一班未報）",
      start_backfill_button: "確認開工並補報 {{gap}} 件",
      start_backfill_edit: "回去改數字",
      start_backfill_unavailable: "暫時無法核對本道累計已報數量；本次只開工、不自動補報，請改按「報工」。",
      start_qty_less_warning: "機台數字比系統少，請確認機台上是這張單的數字",
      start_backfill_rejected: "開工未套用，差額沒有補報；請改按報工。",
      start_backfill_failed: "開工已套用，但補報尚未完成；請改按報工並告知主管。",
      takeover_stop_title: "確認停工", takeover_stop_qty_question_total: "這一道目前良品總數（含已報 {{done}} 件）", takeover_good_qty_total: "良品（這一道目前總數）", takeover_machine_total: "機台目前總數（這張單，含不良）", takeover_this_fail_qty: "這次不良幾件", takeover_stop_qty_question_machine: "填機台上這張單目前的總數（系統已報 {{done}} 件，含不良）", takeover_fail_qty_total: "不良（這一道目前總數）", takeover_fail_qty_unreported: "不良（還沒報的件數）", takeover_stop_add_qty: "這次會新增：良品 {{good}} 件、不良 {{fail}} 件", takeover_stop_add_qty_waiting: "填完數量後會顯示這次新增件數", takeover_stop_total_less_than_done: "總數不能少於已報 {{done}} 件", takeover_stop_fail_total_less_than_done: "不良總數不能少於已報 {{done}} 件", takeover_stop_progress_unavailable: "讀不到這一道的最新進度，請重新整理後再試", takeover_stop_report_pending: "剛報的還在處理，請稍後再停工", takeover_stop_dup_question: "這個數量跟剛才報的很像，確定是另外做的嗎？", takeover_stop_dup_confirm: "確定送出", takeover_stop_dup_edit: "改數量", takeover_stop_dup_ack_unsupported: "伺服器還不能接受「確定送出」，請按「改數量」重新填（沒有就填 0）或找生管",
      takeover_good_qty: "良品", takeover_fail_qty: "不良", takeover_reason: "停工原因", takeover_allow_question: "允許其他機台接手？", takeover_missing_required: "請完成紅框標示的必填問題", start_qty_gap_warning: "機台顯示 {{machine}} 件、系統只記 {{reported}} 件，有 {{gap}} 件還沒報；停工或完工時填總數會自動補上", overtime_continue_question: "{{shiftEnd}} 之後有沒有繼續加工？", overtime_start_question: "請確認加班起點（HH:MM）", overtime_time_invalid: "加班起點格式不正確，請用 HH:MM",
      takeover_must_tap: "請親自按是或否", takeover_note: "說明", takeover_confirm_stop: "確認停工", takeover_stop_sent: "停工已送出", takeover_stop_waiting: "已送出，等待工廠確認",
      takeover_new_order: "開工新訂單", takeover_old_order: "接手舊的工單", takeover_new_order_help: "從現有待做池選擇新訂單。", takeover_continue_new: "繼續開工新訂單",
      takeover_step: "第 {{step}} 道", takeover_done_remaining: "已做 {{done}}／剩下 {{remaining}}", takeover_take: "接手", takeover_idle_action: "接手停工單", takeover_none: "目前沒有可接手的停工單",
      takeover_sending: "傳送中…", takeover_sent: "已送出，等待工廠確認", takeover_send_failed: "送出失敗，請稍後再試", takeover_stop_report_rejected_generic: "這次停工沒有成功，件數沒有送出，請重新整理後再試，仍不行請找生管", yes: "是", no: "否", cancel: "取消", loading: "讀取中…",
      takeover_confirm_message: "從 {{source}} 接手 {{order}} 第 {{step}} 道；{{source}} 已做 {{done}}，{{target}} 接手剩下 {{remaining}}。確定接手？",
      takeover_taken_notice: "{{order}} 已由 {{machine}} 接手（{{who}}、{{time}}）",
      language_label: "語言",
      language_zh_hant: "繁中",
      language_vi: "Tiếng Việt",
      login_title: "MachTile 統一登入",
      login_checking: "正在檢查登入狀態…",
      login_redirect_hint: "已登入會直接進入，未登入會前往統一登入。",
      monitor_title: "機台即時狀態",
      field_report: "現場回報",
      batch_department_denied: "此帳號沒有這個課別的報工權限",
      report: "報工",
      start_work: "開工",
      overtime_start_work: "加班開工",
      card_qty_syncing: "剛報工，同步中",
      card_qty_sync_slow: "同步較慢，請稍後重新整理",
      start_unconfirmed_retry: "上次開工尚未確認，請確認後再按",
      stop_work: "停工",
      batch_command_title: "批次開工／停工",
      batch_start: "批次開工",
      batch_stop: "批次停工",
      batch_command_none: "請至少勾選一台可操作的機台",
      batch_command_no_orders: "此課別目前沒有可操作的工單",
      batch_command_sending: "逐台送出中…",
      lathe_single_operator_draft: "車床報工一次只能選一位報工人員，請取消其他人員後再送出。",
      select_work_order: "選擇工單",
      details: "完整單",
      machine_details: "機台詳情",
      machine_status: "機台 · {{status}}",
      work_order_status: "工單 · {{status}}",
      current_work_order: "目前工單",
      no_work_order: "無工單指派中",
      can_assign_work_order: "可安排新工單",
      check_machine_status: "請確認機台狀態",
      progress: "完成進度",
      due_date: "交期",
      order_detail_route_title: "這張單的流程",
      order_detail_route_count: "共 {{count}} 道、點開看完整路線",
      order_detail_current_process: "目前製程",
      order_detail_priority: "優先級",
      order_detail_inspection: "品檢",
      order_detail_reports_title: "這張單的報工紀錄",
      order_detail_report_count: "{{count}} 筆（最多 20 筆）",
      order_detail_no_data: "無資料",
      order_detail_time: "時間",
      order_detail_machine: "機台",
      order_detail_person: "人",
      order_detail_quantity: "件數",
      order_detail_source: "來源",
      order_detail_source_tablet: "平板",
      order_detail_qty_value: "良品 {{good}} · 不良 {{bad}}",
      order_detail_completed: "完成",
      order_detail_planned: "計畫",
      outsource_status_summary: "委外：{{vendor}} 送 {{sent}}／回 {{returned}}（未回 {{unconfirmed}}）",
      outsource_status_vendor_missing: "廠商無資料",
      outsource_status_closed_without_receipt: "已關閉未收貨 {{quantity}}",
      outsource_status_sent_date: "送出日 {{date}}",
      outsource_status_stock_deduction: "會自動扣倉庫料",
      order_detail_route_restricted: "此角色不顯示完整製程路線（由管理者／主管／排程在「製程路線顯示」設定）。",
      order_detail_role_setting: "依角色設定",
      order_detail_drawing_no: "圖號",
      order_detail_unassigned: "未排機",
      order_detail_not_reported: "尚未回報",
      order_detail_completion_rate: "完成率",
      order_detail_progress_value: "{{done}} / {{total}} 件",
      order_detail_progress_aria: "工單完成進度 {{percent}}%",
      order_detail_inspection_required: "需要品檢",
      order_detail_inspection_not_required: "未要求",
      order_detail_program_title: "程式與加工基準",
      order_detail_history_summary: "近 {{years}} 年 {{runs}} 次",
      order_detail_current_program: "目前 CNC 程式",
      order_detail_hash: "雜湊",
      order_detail_previous_version: "上次版本",
      order_detail_no_history_version: "無歷史版本",
      order_detail_changed_lines: "{{count}} 行差異",
      order_detail_pure_cycle: "純加工時間",
      order_detail_excludes_handling: "不含上下料",
      order_detail_baseline: "標準基準",
      order_detail_pending_baseline: "待建立",
      order_detail_daily_capacity: "每日可加工",
      order_detail_pieces: "{{count}} 件",
      order_detail_daily_capacity_note: "以 8 小時純加工估算",
      order_detail_estimated_duration: "預估工期",
      order_detail_days: "{{count}} 天",
      order_detail_duration_note: "未含上下料與等待",
      unassigned: "未派工",
      report_entry_advice: "報工入口與建議",
      assignment_help: "指派說明",
      open_report_page: "開啟報工頁",
      handling_advice: "處理建議",
      dispatch_pool_same_department: "待做池（同課）",
      dispatch_pool_count: "待做池：目前 {{count}} 張可接",
      dispatch_pool_title: "待做池",
      close: "關閉",
      claim: "接單",
      claiming: "接單中…",
      claim_processing: "接單處理中",
      claim_success: "接單成功，工單已進入這台機台。",
      release_claim: "釋放接單",
      release_claiming: "釋放中…",
      release_claim_success: "已釋放接單，這張單可重新接單。",
      pool_load_error: "待做池讀取失敗，請重新整理。",
      pool_refreshing: "更新中…",
      pool_refresh_failed_stale: "清單可能不是最新（更新失敗，可再按一次）",
      pool_empty: "目前沒有同課待接的工序。",
      pool_syncing_after_finish: "剛完工，工單同步中，約 {{seconds}} 秒後自動重新整理。",
      pool_sync_slow_after_finish: "剛完工，工單同步時間較久，請稍後重新開啟選單。",
      pool_department_missing: "這台沒有設定車床課／銑床課，不列待做池。",
      pool_note: "生管放進池子、還沒派機台的工序，依緊急程度 → 交期 → APS 預計開始排序；空閒且在可做清單、並已開 pilot 的機台才能接單。",
      data_time: "資料時間 {{time}}",
      quantity_due_aps: "數量 {{quantity}} · 交期 {{due}} · APS 預計開始 {{start}}",
      eligible_machines: "可做機台 {{machines}}",
      not_in_list: "（{{machine}} 不在清單）",
      returned_waiting_claim: "退回待接",
      pool_return_factory_note: "已派到工廠，退回請找生管（Factory 總覽）",
      work_start_first: "首次開工",
      daily_start: "今日開工",
      finish_work: "收工/完工",
      finish_button: "完工",
      finish_screen_eyebrow: "完工回報",
      finish_screen_title: "完工",
      finish_screen_hint: "填寫良品與不良數；有不良時必須選擇原因。",
      finish_total_good: "這一道總完成數（良品）",
      finish_reported_qty: "已報 {{quantity}} 件",
      finish_total_help: "填這一道從頭到尾的良品總數；系統只補報尚未回報的差額。",
      counter_qty_help: "報工請照機台計數器填累計數量",
      finish_work_hint: "開啟收工／完工回報；目前不直接關閉舊 MES 工站",
      finish_close_applied: "已關站",
      finish_close_applied_short: "少 {{quantity}} 件，已關站並依實做數入庫",
      finish_close_applied_detail: "完工報工已保留；舊 MES 已關站。",
      finish_close_rejected_title: "關站未完成",
      finish_close_zero_reported: "這一道還沒有報工數量，不能完工關站；請先報工",
      finish_close_lock_timeout: "這次沒有關成（系統忙），可以再按一次",
      finish_close_still_running: "這筆仍在生產中，沒有關站；請先停工再試。",
      finish_close_unknown: "完工報工已成功，但關站未完成；請核對舊 MES 狀態。",
      short_completion_question: "實做數少於計畫（差 {{quantity}} 件）：短交完工？",
      short_completion_material: "材料短少",
      short_completion_scrap: "報廢",
      short_completion_none: "不短交（選填）",
      short_completion_other: "其他",
      short_completion_note: "請說明原因（最多 500 字）",
      short_completion_reason_required: "請選擇短交原因。",
      short_completion_other_note_required: "選擇其他時必須填寫說明（最多 500 字）。",
      short_completion_disabled: "短交完工尚未開放，未關站。",
      short_completion_not_needed: "實做數未少於計畫，不需短交完工。",
      short_completion_reason_invalid: "短交原因或說明不符合規則，未關站。",
      short_completion_warning: "下一道已有人接，數量未調整，請通知生管。",
      standard_finish_same_title: "下一道可在這台接著做",
      standard_finish_same_body: "下一道 {{name}}（{{class}}）已可接單。",
      standard_finish_other_title: "下一道交給其他課別",
      standard_finish_other_body: "下一道 {{name}}（{{class}}）不在這台加工。",
      standard_finish_outsource_title: "下一道為委外加工",
      standard_finish_outsource_body: "下一道 {{name}} 將交由委外流程處理。",
      standard_finish_last_title: "這是最後一道",
      standard_finish_last_body: "此工單的所有加工步驟已完成。",
      standard_finish_qty: "可做 {{available}}／計畫 {{plan}} 件",
      standard_finish_claim: "接下一道",
      standard_finish_claiming: "正在請工廠派到這台…",
      standard_finish_claim_success: "接單成功，可以直接開工。",
      standard_finish_combo_title: "接下一道並開工",
      standard_finish_combo_question: "第 {{done}} 道已完工。要接第 {{next}} 道（共 {{total}} 道，可做 {{available}} 件）並馬上開工嗎？",
      standard_finish_combo_claim_start: "接並開工",
      standard_finish_combo_claim_only: "只接，稍後開工",
      standard_finish_combo_decline: "不接",
      standard_finish_combo_zero: "上一道良品數為 0，可接不可報。",
      standard_finish_combo_success: "已接單並開工。",
      standard_finish_combo_start_failed: "已接單，開工未成功，請按開工",
      standard_finish_combo_sync_failed: "已接單，但工單狀態尚未同步，請按開工。",
      standard_finish_retry: "重試接單",
      standard_finish_network_error: "連線中斷，尚未確認是否接單；請重試。",
      standard_finish_already_claimed_machine: "下一道已由 {{machine}} 接走，請選其他工單。",
      standard_finish_already_claimed: "下一道已被其他機台接走，請選其他工單。",
      standard_finish_not_eligible: "這台機不能接這一道，請選其他工單。",
      standard_finish_stale: "下一道資料已更新，請重新完工或選其他工單。",
      standard_finish_disabled: "接下一道功能尚未開放，請選其他工單。",
      standard_finish_claim_failed: "接下一道失敗，請選其他工單。",
      standard_finish_sync_pending: "同步中，請稍後",
      takeover_sync_pending: "已接手，資料同步中，請稍候幾秒再看",
      pick_order: "選工單",
      pick_order_new: "新工單",
      pick_order_old: "舊工單",
      pick_order_note: "選了只是把單掛到這台，還沒開始；要開始做請再按「開工」。",
      pick_order_none: "目前沒有可做的工單",
      replace_stopped_sent_press_start: "已改掛，請按開工",
      pick_order_confirm: "把 {{order}} 第 {{step}} 道掛到 {{machine}}？（掛上後要再按開工才算開始）",
      standard_finish_start: "開工",
      standard_finish_other_order: "選其他工單",
      abnormal_report: "異常回報",
      inspection_status_loading: "檢驗狀態讀取中",
      inspection_status_error: "檢驗狀態讀取失敗",
      inspection_status_missing: "今日未檢驗",
      inspection_status_skipped: "今日免檢",
      inspection_status_fail: "今日檢驗異常 {{time}}",
      inspection_status_pass: "今日已檢驗 {{time}}",
      inspection_status_open_abnormal: "前往異常回報",
      machine_current_counter: "機台目前累計數",
      machine_order_total: "機台目前顯示總數（這張單）",
      report_total_preview_plain: "系統已報 {{reported}} → 送出後 = {{total}}；這次良品 {{good}} 件、不良 {{fail}} 件",
      report_total_preview: "系統已報 {{reported}} → 送出後 = {{total}}；這次良品 {{good}} 件、不良 {{fail}} 件（良品其中 {{backfill}} 件是前一班未報）",
      report_total_unavailable: "暫時無法核對已報數量，請稍後再按",
      counter_zero_report: "本次增加 0 件，不需報工。",
      good_quantity: "良品數",
      counter_preview: "累計 {{current}}｜上次 {{baseline}}｜這次 {{delta}}{{message}}",
      counter_loading: "正在讀取今天的機台計數基準…",
      counter_load_error: "讀不到今天的機台計數基準，請確認連線後重開報工。",
      counter_current_required: "請填寫機台目前累計數。",
      counter_baseline_required: "今天尚無開工或報工基準；請先按開工，或手填基準。",
      counter_non_positive: "機台累計 {{current}} 必須大於上次 {{baseline}}；這次差額需大於 0。",
      counter_rate_warning: "照工時這段時間最多約 {{max}} 件，你報 {{quantity}} 件，請確認",
      report_qty_jump_confirm: "這次加 {{quantity}} 件，比預估多很多，確定是這張單的數字？",
      home_overtime_title: "今晚已有動作的機台",
      home_overtime_note: "加班不需開工，報工後才會出現。",
      home_overtime_empty: "目前沒有 17:30 以後有實際動作的機台。",
      overtime_start_active: "加班開工中 {{time}} 起",
      counter_manual_help: "今天找不到開工或報工基準。請先按開工；若現場已有紙本基準，可手填並隨本次報工記錄。",
      report_fail_reason_label: "不良原因（有不良時必選）",
      report_fail_reason_placeholder: "選擇不良原因",
      report_fail_reason_required: "有不良數時，需選擇不良原因",
      report_fail_reason_other_note_required: "選擇其他不良原因時，備註必須填寫一句說明",
      report_fail_reason_note_label: "其他原因說明",
      required: "必填",
      optional: "選填",
      submit_report: "送出報工",
      preview_and_submit: "預覽並送出",
      reload_guard_config: "重新載入設定",
      pause_work: "暫停加工",
      open_camera: "開啟相機拍照",
      no_photo: "尚未拍照",
      common_timeout: "連線逾時，請稍後重試。",
      common_error: "發生錯誤，請稍後重試。",
      // 組裝站平板報工（assemblyReport.js，owner 2026-10-31）
      asm_title: "組裝站報工",
      asm_entry: "組裝報工（{{stations}}）",
      asm_flag_off: "組裝站平板報工尚未開放。",
      asm_hint: "站上每一張單各自按：開工 → 報工（這次完成幾件）→ 完工。同一次可勾好幾位報工人。",
      asm_demo: "示範模式：不會寫入任何資料。",
      asm_refresh: "重新整理",
      asm_load_failed: "讀取失敗",
      asm_role_note: "報工要用作業員帳號登入；這個帳號只能看。",
      asm_no_operators: "還沒有任何人員對照到舊 MES 工號，請管理者先補上工號對照。",
      asm_order_count: "站上目前 {{count}} 張單",
      asm_no_orders: "站上目前沒有派工的單。",
      asm_line_all: "全部",
      asm_line_valve: "閥件測試",
      asm_line_pump: "幫浦測試",
      asm_line_other: "未分類",
      asm_state_running: "生產中",
      asm_state_stopped: "停工",
      asm_state_notStarted: "未開工",
      asm_step: "第 {{step}} 道",
      asm_reported: "已報 良 {{good}}・不良 {{fail}}／訂 {{total}}",
      asm_missing_identity: "缺舊 MES 對照（{{fields}}），這張單先不能在平板操作，請通知管理者。",
      asm_report_closed: "工廠尚未開放這一站的平板報工。",
      asm_report_unavailable: "報工設定還沒同步，暫時不能報工。",
      asm_start: "開工",
      asm_start_confirm: "確認開工",
      asm_report: "報工",
      asm_finish: "完工",
      asm_good_label: "這次完成幾件（良品）",
      asm_bad_label: "這次不良幾件",
      asm_finish_question: "{{order}} 在這一站全部做完了？最後這次有做的件數一起填（沒有就留空）。",
      asm_finish_good_label: "最後這次完成幾件（良品，沒有就留空）",
      asm_operators_label: "報工人（可複選，每人選自己的名字）",
      asm_me: "我",
      asm_submit: "送出報工",
      asm_finish_submit: "確認完工關站",
      asm_sending: "送出中，請稍候…",
      asm_previewing: "工廠核對中…",
      asm_writing: "工廠寫入中…",
      asm_closing: "關站中…",
      asm_result_unknown: "結果還沒回來，請不要重按，請看電子紙或問生管。",
      asm_pending_report: "這張單還有報工在送出中，請等它送完再報。",
      asm_needs_confirm: "需要確認，請看上面的提示。",
      asm_ack_confirm: "確認沒錯，送出",
      asm_ack_cancelled: "已取消，這次沒有報工。",
      asm_report_failed: "沒有報進去：",
      asm_applied: "✓ 已報工：良品 {{good}}、不良 {{bad}}（報工人：{{names}}）",
      asm_applied_late: "舊 MES 已記這筆報工（回報太晚），不要再按；請看電子紙或問生管確認。",
      asm_record_unconfirmed: "（App 紀錄還沒確認，請勿重送數量）",
      asm_closed: "已完工關站。",
      asm_close_failed: "關站沒有完成：",
      asm_err_qty_invalid: "數量要是 0 以上的整數。",
      asm_err_qty_required: "請填這次完成幾件（或不良幾件）。",
      asm_err_reason_required: "有不良品時，請選不良原因。",
      asm_err_note_required: "請寫一句原因再送出。",
      asm_err_note_too_long: "說明不可超過 500 字。",
      asm_err_operator_required: "請勾選報工人（至少一位）。",
      asm_err_operator_too_many: "報工人最多 10 位。",
      asm_block_qty_exceeds: "這次數量比可以報的還多，請確認件數。",
      asm_block_qty_invalid: "數量不對，請確認件數。",
      asm_block_not_started: "這張單還沒開工，請先按開工再報工。",
      login_timeout: "登入流程已逾時，請重新登入。"
    },
    vi: {
      outsource_receipt_question: "Công đoạn trước 〈{{step}}〉 thuê ngoài chưa nhận hàng. Đã về bao nhiêu sản phẩm?",
      outsource_receipt_material_question: "Đã nhận vật liệu từ công đoạn trước “{{step}}（{{vendor}}）” chưa?",
      outsource_receipt_count_question: "Công đoạn trước “{{step}}（{{vendor}}）” thuê ngoài đã về bao nhiêu sản phẩm?",
      outsource_receipt_multi_step: "Có {{count}} công đoạn thuê ngoài liên tiếp; mỗi công đoạn sẽ nhận cùng số lượng này",
      outsource_receipt_received: "Đã nhận",
      outsource_receipt_stale: "Phiếu thuê ngoài vừa được người khác thay đổi; vui lòng xem trước lại",
      outsource_receipt_previous_step: "công đoạn trước",
      outsource_receipt_doc4: "Phiếu thuê ngoài: {{numbers}}",
      outsource_receipt_quantity: "Số lượng thực tế đã về",
      outsource_receipt_note: "Nhập số lượng thực tế đã về; hệ thống sẽ nhận hàng trước rồi mới báo công",
      outsource_receipt_confirm: "Xác nhận nhận hàng và báo công",
      outsource_receipt_range: "Vui lòng nhập từ 1 đến {{max}} sản phẩm.",
      outsource_receipt_cancelled: "Đã hủy; lần này chưa nhận hàng hộ và chưa báo công.",
      outsource_receipt_not_expected: "Trạng thái đã cập nhật, không cần nhận hàng hộ; hệ thống sẽ gửi lại báo công.",
      simple_report_summary: "Lần này báo: {{process}} (công đoạn {{step}}) · Đã báo {{reported}}", simple_report_summary_nostep: "Lần này báo: {{process}} · Đã báo {{reported}}", simple_report_summary_fail: "Lần này báo: {{process}} (công đoạn {{step}}) · Đã báo {{reported}} (gồm {{fail}} hàng lỗi)", simple_report_summary_nostep_fail: "Lần này báo: {{process}} · Đã báo {{reported}} (gồm {{fail}} hàng lỗi)", simple_report_flow_open: "▸Quy trình", simple_report_flow_close: "▾Quy trình", simple_report_total_label: "Tổng số hiện tại trên máy (phiếu này)", simple_report_total_label_defect: "Tổng số hiện tại trên máy (phiếu này, gồm hàng lỗi)", simple_report_defect_qty: "Lần này bao nhiêu hàng lỗi", simple_report_reason: "Lý do", simple_report_old_order_note: "Hãy ghi một câu lý do báo phiếu này", simple_report_hint: "Lần này hàng tốt {{good}}, hàng lỗi {{bad}}", simple_report_hint_waiting: "Nhập số trên máy, ở đây sẽ hiện số hàng tốt lần này", simple_report_hint_invalid: "Số trên máy không đúng; hãy kiểm tra đây là số của phiếu này", simple_report_operator: "Người báo: ", simple_report_operator_starter: " (người bắt đầu)", simple_report_operator_none: "Chưa chọn người báo", simple_report_change_operator: "Đổi người", simple_report_change_operator_done: "Thu gọn", simple_report_waiting: "Nhà máy đang tính… {{seconds}} giây", simple_report_sending: "Đang gửi, vui lòng chờ…", simple_report_sending_button: "Đang gửi…", simple_report_resubmit: "Gửi lại", simple_report_ack_submit: "Đã kiểm tra đúng, gửi", simple_report_cancelled: "Đã hủy, chưa nhận hàng và chưa báo công.", simple_report_timeout: "Nhà máy không phản hồi, hãy bấm gửi lại.", simple_report_unconfirmed: "Chưa xác nhận lần trước đã báo được chưa; đừng gửi lại, hãy báo quản lý.", simple_report_done: "Lần trước đã báo công xong.", simple_report_tech: "Chi tiết kỹ thuật", simple_block_qty_exceeds: "Số lượng lần này nhiều hơn số được báo; hãy kiểm tra số trên máy là của phiếu này.", simple_block_stock_short: "Không đủ phôi trong kho nên chưa báo được; hãy báo bộ phận kế hoạch.", simple_block_not_started: "Máy này chưa bắt đầu; hãy bấm bắt đầu rồi mới báo công.", simple_block_closed: "Công đoạn này đã kết thúc, không báo thêm được; hãy báo bộ phận kế hoạch.", simple_block_changed: "Phiếu vừa thay đổi; hãy bấm gửi lại.", simple_block_reason_required: "Khi có hàng lỗi, hãy chọn lý do lỗi.", simple_block_note_required: "Hãy ghi một câu lý do rồi gửi.", simple_block_qty_invalid: "Số lượng không đúng; hãy kiểm tra số trên máy.", simple_block_disabled: "Máy này hiện không báo công bằng máy tính bảng được; hãy báo quản lý.", simple_block_receipt: "Công đoạn thuê ngoài trước chưa nhận hàng nên chưa báo được; hãy báo bộ phận kế hoạch.", simple_block_unavailable: "Báo công bằng máy tính bảng tạm thời không dùng được; hãy báo quản lý.", simple_block_generic: "Lần này chưa báo được; hãy báo quản lý.", simple_soft_old_order: "Mã hàng này đã có phiếu mới hơn. Nếu chắc chắn báo phiếu này, hãy ghi lý do rồi bấm gửi.", simple_soft_high_fail: "Lần này hàng lỗi nhiều; nếu số đúng hãy bấm gửi lại.", simple_soft_exceeds_order: "Lần này vượt số lượng phiếu; nếu số đúng hãy bấm gửi lại.", simple_soft_duplicate: "Số này giống lần vừa báo; nếu chắc là làm mới hãy bấm gửi lại.", simple_soft_auto_pull: "Lần này sẽ tự động lĩnh phôi trước; nếu số đúng hãy bấm gửi lại.", simple_soft_receipt: "Công đoạn thuê ngoài trước chưa xác nhận nhận hàng; nếu số đúng hãy bấm gửi lại.", simple_soft_generic: "Hãy kiểm tra số đúng rồi bấm gửi lại.",
      batch_total_label: "Tổng số hiện tại trên máy", batch_added_qty: "Lần này tăng +{{quantity}} sản phẩm", batch_added_split: "Lần này {{good}} hàng tốt, {{fail}} hàng lỗi", batch_added_waiting: "Nhập số để xem lượng tăng lần này", batch_total_below_reported: "Tổng số không được nhỏ hơn {{reported}} sản phẩm đã báo", batch_defect_toggle: "Có hàng lỗi", batch_technical_details: "Thông tin kỹ thuật", batch_submit_all: "Gửi tất cả một lần", batch_submit_all_count: "Gửi tất cả một lần ({{count}} máy)", batch_report_hint: "Chỉ cần nhập <strong>số hiện tại trên máy</strong>; hệ thống tự tính lượng tăng. Nếu có hàng lỗi, hãy chọn “Có hàng lỗi”. Hoàn tất công việc trên thẻ máy.",
      start_backfill_confirm: "Máy hiển thị {{machine}} sản phẩm, hệ thống chỉ ghi {{reported}}. Khi xác nhận bắt đầu, hệ thống sẽ báo bù {{gap}} sản phẩm (tính cho ca trước chưa báo)",
      start_backfill_button: "Xác nhận bắt đầu và báo bù {{gap}}",
      start_backfill_edit: "Quay lại sửa số lượng",
      start_backfill_unavailable: "Tạm thời không thể đối chiếu tổng số đã báo của công đoạn này; lần này chỉ bắt đầu, không tự động báo bù. Hãy dùng nút báo sản lượng.", /* _draft */
      start_qty_less_warning: "Số trên máy thấp hơn hệ thống; hãy xác nhận đây là số của đúng phiếu này",
      start_backfill_rejected: "Lệnh bắt đầu không được áp dụng nên chưa báo bù; hãy dùng nút báo sản lượng.",
      start_backfill_failed: "Đã bắt đầu nhưng chưa hoàn tất báo bù; hãy báo sản lượng và báo quản lý.", /* _draft */
      takeover_stop_title: "Xác nhận dừng máy", takeover_stop_qty_question_total: "Tổng số hàng tốt hiện tại của công đoạn này (bao gồm {{done}} cái đã báo)", takeover_good_qty_total: "Hàng tốt (tổng hiện tại của công đoạn)", takeover_machine_total: "Tổng số hiện trên máy (đơn này, gồm hàng lỗi)", takeover_this_fail_qty: "Lần này bao nhiêu hàng lỗi", takeover_stop_qty_question_machine: "Nhập tổng số hiện trên máy của đơn này (hệ thống đã báo {{done}} cái, gồm hàng lỗi)", takeover_fail_qty_total: "Hàng lỗi (tổng hiện tại của công đoạn)", takeover_fail_qty_unreported: "Hàng lỗi (số chưa báo)", takeover_stop_add_qty: "Lần này sẽ thêm: {{good}} hàng tốt, {{fail}} hàng lỗi", takeover_stop_add_qty_waiting: "Sau khi nhập số lượng sẽ hiển thị số được thêm lần này", takeover_stop_total_less_than_done: "Tổng số không được nhỏ hơn {{done}} cái đã báo", takeover_stop_fail_total_less_than_done: "Tổng hàng lỗi không được nhỏ hơn {{done}} cái đã báo", takeover_stop_progress_unavailable: "Không đọc được tiến độ mới nhất của công đoạn này. Vui lòng tải lại rồi thử lại", takeover_stop_report_pending: "Báo cáo vừa gửi vẫn đang được xử lý. Vui lòng chờ rồi mới dừng máy", takeover_stop_dup_question: "Số lượng này giống với lần vừa báo, có chắc là làm thêm riêng không?", takeover_stop_dup_confirm: "Xác nhận gửi", takeover_stop_dup_edit: "Sửa số lượng", takeover_stop_dup_ack_unsupported: "Máy chủ chưa nhận được \"Xác nhận gửi\", vui lòng bấm \"Sửa số lượng\" để nhập lại (không có thì điền 0) hoặc báo bộ phận kế hoạch", /* _draft */
      takeover_good_qty: "Hàng tốt", takeover_fail_qty: "Hàng lỗi", takeover_reason: "Lý do dừng", takeover_allow_question: "Cho phép máy khác tiếp nhận?", takeover_missing_required: "Vui lòng hoàn tất các mục bắt buộc được đánh dấu đỏ", start_qty_gap_warning: "Máy hiển thị {{machine}} sản phẩm, hệ thống chỉ ghi {{reported}}, còn {{gap}} sản phẩm chưa báo; nhập tổng số khi dừng hoặc hoàn tất sẽ tự động bù", overtime_continue_question: "Sau {{shiftEnd}} có tiếp tục gia công không?", overtime_start_question: "Xác nhận giờ bắt đầu tăng ca (HH:MM)", overtime_time_invalid: "Giờ bắt đầu tăng ca không hợp lệ, vui lòng dùng HH:MM", /* _draft */
      takeover_must_tap: "Vui lòng tự chọn Có hoặc Không", takeover_note: "Ghi chú", takeover_confirm_stop: "Xác nhận dừng", takeover_stop_sent: "Đã gửi lệnh dừng", takeover_stop_waiting: "Đã gửi, đang chờ nhà máy xác nhận",
      takeover_new_order: "Mở đơn hàng mới", takeover_old_order: "Tiếp nhận lệnh cũ", takeover_new_order_help: "Chọn đơn hàng mới trong danh sách chờ.", takeover_continue_new: "Tiếp tục mở đơn mới",
      takeover_step: "Công đoạn {{step}}", takeover_done_remaining: "Đã làm {{done}}／còn {{remaining}}", takeover_take: "Tiếp nhận", takeover_idle_action: "Tiếp nhận lệnh đã dừng", takeover_none: "Hiện không có lệnh đã dừng có thể tiếp nhận", /* _draft */
      takeover_sending: "Đang gửi…", takeover_sent: "Đã gửi, đang chờ nhà máy xác nhận", takeover_send_failed: "Gửi thất bại, vui lòng thử lại", takeover_stop_report_rejected_generic: "Dừng máy chưa thành công, số lượng chưa được gửi. Vui lòng tải lại rồi thử lại; nếu vẫn lỗi hãy báo bộ phận kế hoạch", /* _draft */ yes: "Có", no: "Không", cancel: "Hủy", loading: "Đang tải…",
      takeover_confirm_message: "Tiếp nhận {{order}}, công đoạn {{step}} từ {{source}}; {{source}} đã làm {{done}}, {{target}} tiếp tục {{remaining}} còn lại. Xác nhận tiếp nhận?",
      takeover_taken_notice: "{{order}} đã được {{machine}} tiếp nhận ({{who}}, {{time}})",
      language_label: "Ngôn ngữ",
      language_zh_hant: "繁中",
      language_vi: "Tiếng Việt",
      login_title: "Đăng nhập hợp nhất MachTile",
      login_checking: "Đang kiểm tra trạng thái đăng nhập…",
      login_redirect_hint: "Nếu đã đăng nhập, bạn sẽ vào thẳng hệ thống; nếu chưa, hệ thống sẽ chuyển đến trang đăng nhập.",
      monitor_title: "Trạng thái máy theo thời gian thực",
      field_report: "Báo cáo tại hiện trường",
      batch_department_denied: "Tài khoản này không có quyền báo cáo cho bộ phận này", // _draft
      report: "Báo cáo",
      start_work: "Bắt đầu",
      overtime_start_work: "Bắt đầu tăng ca",
      card_qty_syncing: "Vừa báo công, đang đồng bộ",
      card_qty_sync_slow: "Đồng bộ chậm, vui lòng tải lại sau",
      start_unconfirmed_retry: "Lần mở máy trước chưa được xác nhận, vui lòng kiểm tra rồi bấm lại",
      stop_work: "Dừng máy",
      batch_command_title: "Bắt đầu / dừng hàng loạt", // _draft
      batch_start: "Bắt đầu hàng loạt", // _draft
      batch_stop: "Dừng hàng loạt", // _draft
      batch_command_none: "Vui lòng chọn ít nhất một máy có thể thao tác", // _draft
      batch_command_no_orders: "Hiện không có lệnh sản xuất có thể thao tác trong bộ phận này", // _draft
      batch_command_sending: "Đang gửi lần lượt…", // _draft
      lathe_single_operator_draft: "Báo cáo máy tiện chỉ được chọn một người vận hành. Vui lòng bỏ chọn những người khác rồi gửi lại.", // _draft
      select_work_order: "Chọn lệnh sản xuất",
      details: "Xem đầy đủ",
      machine_details: "Chi tiết máy",
      machine_status: "Máy · {{status}}",
      work_order_status: "Lệnh · {{status}}",
      current_work_order: "Lệnh hiện tại",
      no_work_order: "Chưa có lệnh được giao",
      can_assign_work_order: "Có thể giao lệnh mới",
      check_machine_status: "Vui lòng kiểm tra trạng thái máy",
      progress: "Tiến độ hoàn thành",
      due_date: "Hạn giao",
      order_detail_route_title: "Quy trình của lệnh này",
      order_detail_route_count: "Tổng {{count}} công đoạn · mở để xem toàn bộ quy trình",
      order_detail_current_process: "Công đoạn hiện tại",
      order_detail_priority: "Mức ưu tiên",
      order_detail_inspection: "Kiểm tra chất lượng",
      order_detail_reports_title: "Lịch sử báo cáo của lệnh này",
      order_detail_report_count: "{{count}} mục (tối đa 20)",
      order_detail_no_data: "Không có dữ liệu",
      order_detail_time: "Thời gian",
      order_detail_machine: "Máy",
      order_detail_person: "Người",
      order_detail_quantity: "Số lượng",
      order_detail_source: "Nguồn",
      order_detail_source_tablet: "Máy tính bảng",
      order_detail_qty_value: "Tốt {{good}} · Lỗi {{bad}}",
      order_detail_completed: "Hoàn thành",
      order_detail_planned: "Kế hoạch",
      outsource_status_summary: "Gia công ngoài: {{vendor}} gửi {{sent}} / nhận {{returned}} (chưa nhận {{unconfirmed}})",
      outsource_status_vendor_missing: "Không có dữ liệu nhà cung cấp",
      outsource_status_closed_without_receipt: "Đã đóng, chưa nhận {{quantity}}",
      outsource_status_sent_date: "Ngày gửi {{date}}",
      outsource_status_stock_deduction: "Sẽ tự động trừ vật liệu trong kho",
      order_detail_route_restricted: "Vai trò này không hiển thị toàn bộ quy trình (do quản trị viên, quản lý hoặc điều độ thiết lập trong “Hiển thị quy trình”).",
      order_detail_role_setting: "Theo cài đặt vai trò",
      order_detail_drawing_no: "Số bản vẽ",
      order_detail_unassigned: "Chưa xếp máy",
      order_detail_not_reported: "Chưa báo cáo",
      order_detail_completion_rate: "Tỷ lệ hoàn thành",
      order_detail_progress_value: "{{done}} / {{total}} sản phẩm",
      order_detail_progress_aria: "Tiến độ hoàn thành lệnh {{percent}}%",
      order_detail_inspection_required: "Cần kiểm tra chất lượng",
      order_detail_inspection_not_required: "Không yêu cầu",
      order_detail_program_title: "Chương trình và chuẩn gia công",
      order_detail_history_summary: "{{runs}} lần trong {{years}} năm gần đây",
      order_detail_current_program: "Chương trình CNC hiện tại",
      order_detail_hash: "Mã băm",
      order_detail_previous_version: "Phiên bản trước",
      order_detail_no_history_version: "Không có phiên bản lịch sử",
      order_detail_changed_lines: "Khác {{count}} dòng",
      order_detail_pure_cycle: "Thời gian gia công thuần",
      order_detail_excludes_handling: "Không gồm thời gian gá và tháo phôi",
      order_detail_baseline: "Chuẩn tiêu chuẩn",
      order_detail_pending_baseline: "Chờ thiết lập",
      order_detail_daily_capacity: "Sản lượng mỗi ngày",
      order_detail_pieces: "{{count}} sản phẩm",
      order_detail_daily_capacity_note: "Ước tính theo 8 giờ gia công thuần",
      order_detail_estimated_duration: "Thời gian dự kiến",
      order_detail_days: "{{count}} ngày",
      order_detail_duration_note: "Không gồm thời gian gá, tháo phôi và chờ đợi",
      unassigned: "Chưa giao máy",
      report_entry_advice: "Lối vào báo cáo và gợi ý",
      assignment_help: "Hướng dẫn giao việc",
      open_report_page: "Mở trang báo cáo",
      handling_advice: "Gợi ý xử lý",
      dispatch_pool_same_department: "Danh sách chờ (cùng bộ phận)",
      dispatch_pool_count: "Danh sách chờ: hiện có {{count}} phiếu có thể nhận",
      dispatch_pool_title: "Danh sách chờ",
      close: "Đóng",
      claim: "Nhận việc",
      claiming: "Đang nhận việc…",
      claim_processing: "Đang xử lý nhận việc",
      claim_success: "Nhận việc thành công. Lệnh đã được đưa vào máy này.",
      release_claim: "Giải phóng nhận việc",
      release_claiming: "Đang giải phóng…",
      release_claim_success: "Đã giải phóng nhận việc; phiếu này có thể được nhận lại.",
      pool_load_error: "Không tải được danh sách chờ. Vui lòng làm mới.",
      pool_refreshing: "Đang cập nhật…",
      pool_refresh_failed_stale: "Danh sách có thể chưa mới nhất (cập nhật thất bại, hãy thử mở lại).",
      pool_empty: "Hiện không có công đoạn chờ nhận trong cùng bộ phận.",
      pool_syncing_after_finish: "Vừa hoàn công, đang đồng bộ lệnh, khoảng {{seconds}} giây nữa sẽ tự làm mới.",
      pool_sync_slow_after_finish: "Vừa hoàn công, đồng bộ lệnh đang chậm, vui lòng mở lại danh sách sau.",
      pool_department_missing: "Máy này chưa được gán bộ phận tiện/phay nên không hiển thị danh sách chờ.",
      pool_note: "Các công đoạn do điều độ đưa vào danh sách nhưng chưa giao máy được sắp theo mức khẩn cấp → hạn giao → thời gian APS dự kiến bắt đầu; chỉ máy đang rảnh, đủ điều kiện và đã bật pilot mới có thể nhận việc.",
      data_time: "Thời gian dữ liệu {{time}}",
      quantity_due_aps: "Số lượng {{quantity}} · Hạn giao {{due}} · APS dự kiến bắt đầu {{start}}",
      eligible_machines: "Máy phù hợp {{machines}}",
      not_in_list: "（{{machine}} không có trong danh sách）",
      returned_waiting_claim: "Trả lại, chờ nhận",
      pool_return_factory_note: "Đã giao đến nhà máy; muốn trả lại, vui lòng liên hệ bộ phận kế hoạch (Tổng quan Factory)", // _draft
      work_start_first: "Bắt đầu lần đầu",
      daily_start: "Bắt đầu hôm nay",
      finish_work: "Kết thúc / Hoàn tất",
      finish_button: "Hoàn tất",
      finish_screen_eyebrow: "Báo cáo hoàn tất", // _draft
      finish_screen_title: "Hoàn tất", // _draft
      finish_screen_hint: "Nhập số lượng đạt và lỗi; khi có sản phẩm lỗi phải chọn nguyên nhân.", // _draft
      finish_total_good: "Tổng số hoàn thành của công đoạn này (đạt)", // _draft
      finish_reported_qty: "Đã báo {{quantity}} sản phẩm", // _draft
      finish_total_help: "Nhập tổng số sản phẩm đạt của toàn bộ công đoạn; hệ thống chỉ báo bổ sung phần chênh lệch chưa báo.", // _draft
      counter_qty_help: "Khi báo cáo, hãy nhập số tích lũy trên bộ đếm máy", // _draft
      finish_work_hint: "Mở báo cáo kết thúc; hiện chưa đóng công đoạn MES cũ trực tiếp", // _draft
      finish_close_applied: "Đã đóng công đoạn", // _draft
      finish_close_applied_short: "Thiếu {{quantity}} sản phẩm, đã đóng công đoạn và nhập kho theo số thực làm", // _draft
      finish_close_applied_detail: "Báo cáo hoàn tất đã được lưu; công đoạn MES cũ đã đóng.", // _draft
      finish_close_rejected_title: "Chưa đóng được công đoạn", // _draft
      finish_close_zero_reported: "Công đoạn này chưa có số lượng báo cáo nên chưa thể hoàn tất và đóng công đoạn; vui lòng báo cáo trước.", // _draft
      finish_close_lock_timeout: "Lần này chưa đóng được vì hệ thống đang bận; bạn có thể bấm lại.", // _draft
      finish_close_still_running: "Mục này vẫn đang sản xuất nên chưa đóng công đoạn; vui lòng dừng máy rồi thử lại.", // _draft
      finish_close_unknown: "Báo cáo hoàn tất đã thành công nhưng chưa đóng được công đoạn; vui lòng kiểm tra trạng thái MES cũ.", // _draft
      short_completion_question: "Số thực tế ít hơn kế hoạch (thiếu {{quantity}} sản phẩm): hoàn tất giao thiếu?", // _draft
      short_completion_material: "Thiếu vật liệu", // _draft
      short_completion_scrap: "Phế phẩm", // _draft
      short_completion_none: "Không thiếu hàng (tùy chọn)", // _draft
      short_completion_other: "Khác", // _draft
      short_completion_note: "Vui lòng ghi lý do (tối đa 500 ký tự)", // _draft
      short_completion_reason_required: "Vui lòng chọn lý do giao thiếu.", // _draft
      short_completion_other_note_required: "Khi chọn Khác, phải nhập mô tả (tối đa 500 ký tự).", // _draft
      short_completion_disabled: "Chức năng hoàn tất giao thiếu chưa được bật; công đoạn chưa đóng.", // _draft
      short_completion_not_needed: "Số thực tế không ít hơn kế hoạch; không cần giao thiếu.", // _draft
      short_completion_reason_invalid: "Lý do hoặc mô tả giao thiếu không hợp lệ; công đoạn chưa đóng.", // _draft
      short_completion_warning: "Công đoạn tiếp theo đã được nhận; số lượng chưa điều chỉnh. Vui lòng báo kế hoạch sản xuất.", // _draft
      standard_finish_same_title: "Có thể tiếp tục công đoạn kế tiếp trên máy này",
      standard_finish_same_body: "Công đoạn kế tiếp {{name}} ({{class}}) đã sẵn sàng để nhận.",
      standard_finish_other_title: "Công đoạn kế tiếp thuộc bộ phận khác",
      standard_finish_other_body: "Công đoạn kế tiếp {{name}} ({{class}}) không được gia công trên máy này.",
      standard_finish_outsource_title: "Công đoạn kế tiếp là gia công ngoài",
      standard_finish_outsource_body: "Công đoạn kế tiếp {{name}} sẽ được xử lý theo quy trình gia công ngoài.",
      standard_finish_last_title: "Đây là công đoạn cuối",
      standard_finish_last_body: "Tất cả các công đoạn của lệnh sản xuất này đã hoàn tất.",
      standard_finish_qty: "Có thể làm {{available}} / kế hoạch {{plan}} sản phẩm",
      standard_finish_claim: "Nhận công đoạn kế tiếp",
      standard_finish_claiming: "Đang yêu cầu nhà máy giao cho máy này…",
      standard_finish_claim_success: "Đã nhận việc; có thể bắt đầu ngay.",
      standard_finish_combo_title: "Nhận công đoạn kế tiếp và bắt đầu",
      standard_finish_combo_question: "Công đoạn {{done}} đã hoàn tất. Nhận công đoạn {{next}} (tổng {{total}} công đoạn, có thể làm {{available}} sản phẩm) và bắt đầu ngay?",
      standard_finish_combo_claim_start: "Nhận và bắt đầu",
      standard_finish_combo_claim_only: "Chỉ nhận, bắt đầu sau",
      standard_finish_combo_decline: "Không nhận",
      standard_finish_combo_zero: "Số lượng đạt của công đoạn trước là 0; có thể nhận nhưng không thể báo sản lượng.",
      standard_finish_combo_success: "Đã nhận việc và bắt đầu.",
      standard_finish_combo_start_failed: "Đã nhận việc nhưng chưa bắt đầu thành công; vui lòng bấm Bắt đầu",
      standard_finish_combo_sync_failed: "Đã nhận việc nhưng trạng thái lệnh chưa đồng bộ; vui lòng bấm Bắt đầu.",
      standard_finish_retry: "Thử nhận lại",
      standard_finish_network_error: "Mất kết nối; chưa xác nhận được việc nhận đơn. Vui lòng thử lại.",
      standard_finish_already_claimed_machine: "Công đoạn kế tiếp đã được máy {{machine}} nhận; vui lòng chọn lệnh khác.", // _draft
      standard_finish_already_claimed: "Công đoạn kế tiếp đã được máy khác nhận; vui lòng chọn lệnh khác.", // _draft
      standard_finish_not_eligible: "Máy này không thể nhận công đoạn này; vui lòng chọn lệnh khác.", // _draft
      standard_finish_stale: "Dữ liệu công đoạn kế tiếp đã thay đổi; vui lòng hoàn tất lại hoặc chọn lệnh khác.", // _draft
      standard_finish_disabled: "Chức năng nhận công đoạn kế tiếp chưa được mở; vui lòng chọn lệnh khác.", // _draft
      standard_finish_claim_failed: "Không thể nhận công đoạn kế tiếp; vui lòng chọn lệnh khác.", // _draft
      standard_finish_sync_pending: "Đang đồng bộ, vui lòng đợi", // _draft
      takeover_sync_pending: "Đã tiếp nhận, dữ liệu đang đồng bộ, vui lòng đợi vài giây rồi xem lại", // _draft
      pick_order: "Chọn lệnh", // _draft
      pick_order_new: "Lệnh mới", // _draft
      pick_order_old: "Lệnh cũ", // _draft
      pick_order_note: "Chọn lệnh chỉ gắn lệnh vào máy này, chưa bắt đầu; muốn bắt đầu làm hãy bấm “Bắt đầu”.", // _draft
      pick_order_none: "Hiện không có lệnh nào để làm", // _draft
      replace_stopped_sent_press_start: "Đã đổi lệnh, vui lòng bấm Bắt đầu", // _draft
      pick_order_confirm: "Gắn lệnh {{order}} công đoạn {{step}} vào máy {{machine}}? (Sau khi gắn phải bấm “Bắt đầu” mới tính là bắt đầu)", // _draft
      standard_finish_start: "Bắt đầu",
      standard_finish_other_order: "Chọn lệnh khác",
      abnormal_report: "Báo cáo bất thường",
      inspection_status_loading: "Đang tải trạng thái kiểm tra", // _draft
      inspection_status_error: "Không thể tải trạng thái kiểm tra", // _draft
      inspection_status_missing: "Hôm nay chưa kiểm tra", // _draft
      inspection_status_skipped: "Hôm nay được miễn kiểm tra", // _draft
      inspection_status_fail: "Kiểm tra hôm nay bất thường {{time}}", // _draft
      inspection_status_pass: "Hôm nay đã kiểm tra {{time}}", // _draft
      inspection_status_open_abnormal: "Mở báo cáo bất thường", // _draft
      machine_current_counter: "Số tích lũy hiện tại của máy",
      machine_order_total: "Tổng số hiện đang hiển thị trên máy (đơn này)",
      report_total_preview_plain: "Hệ thống đã báo {{reported}} → sau khi gửi = {{total}}; lần này {{good}} hàng tốt, {{fail}} hàng lỗi",
      report_total_preview: "Hệ thống đã báo {{reported}} → sau khi gửi = {{total}}; lần này {{good}} hàng tốt, {{fail}} hàng lỗi (trong số hàng tốt có {{backfill}} sản phẩm ca trước chưa báo)",
      report_total_unavailable: "Tạm thời không thể đối chiếu số lượng đã báo, vui lòng bấm lại sau",
      counter_zero_report: "Lần này tăng 0 sản phẩm, không cần báo.",
      good_quantity: "Số lượng đạt",
      counter_preview: "Tích lũy {{current}}｜Lần trước {{baseline}}｜Lần này {{delta}}{{message}}",
      counter_loading: "Đang đọc mốc bộ đếm máy hôm nay…",
      counter_load_error: "Không đọc được mốc bộ đếm máy hôm nay. Vui lòng kiểm tra kết nối rồi mở lại báo cáo.",
      counter_current_required: "Vui lòng nhập số tích lũy hiện tại của máy.",
      counter_baseline_required: "Hôm nay chưa có mốc bắt đầu hoặc báo cáo; hãy bấm bắt đầu hoặc nhập mốc thủ công.",
      counter_non_positive: "Số tích lũy {{current}} phải lớn hơn lần trước {{baseline}}; chênh lệch lần này phải lớn hơn 0.",
      counter_rate_warning: "Theo thời gian gia công, khoảng này tối đa khoảng {{max}} sản phẩm; bạn báo {{quantity}} sản phẩm, vui lòng kiểm tra",
      report_qty_jump_confirm: "Lần này thêm {{quantity}} sản phẩm, nhiều hơn dự kiến rất nhiều. Bạn có chắc đây là số của lệnh này không?",
      home_overtime_title: "Máy đã có thao tác tối nay",
      home_overtime_note: "Tăng ca không cần bấm bắt đầu; máy sẽ xuất hiện sau khi báo công.",
      home_overtime_empty: "Hiện không có máy có thao tác thực tế sau 17:30.",
      overtime_start_active: "Đang làm tăng ca từ {{time}}",
      counter_manual_help: "Không tìm thấy mốc bắt đầu hoặc báo cáo hôm nay. Hãy bấm bắt đầu trước; nếu hiện trường có mốc trên giấy, có thể nhập tay và lưu cùng báo cáo này.",
      report_fail_reason_label: "Lý do lỗi (bắt buộc khi có sản phẩm lỗi)", // _draft
      report_fail_reason_placeholder: "Chọn lý do lỗi", // _draft
      report_fail_reason_required: "Khi có số lượng lỗi, phải chọn lý do lỗi.", // _draft
      report_fail_reason_other_note_required: "Khi chọn Khác, phải ghi một câu giải thích trong phần ghi chú.", // _draft
      report_fail_reason_note_label: "Giải thích lý do khác", // _draft
      required: "Bắt buộc",
      optional: "Không bắt buộc",
      submit_report: "Gửi báo cáo",
      preview_and_submit: "Xem trước và gửi",
      reload_guard_config: "Tải lại cấu hình",
      pause_work: "Tạm dừng gia công",
      open_camera: "Mở camera chụp ảnh",
      no_photo: "Chưa chụp ảnh",
      common_timeout: "Kết nối quá thời gian. Vui lòng thử lại sau.",
      common_error: "Đã xảy ra lỗi. Vui lòng thử lại sau.",
      asm_title: "Báo công trạm lắp ráp",
      asm_entry: "Báo công lắp ráp ({{stations}})",
      asm_flag_off: "Báo công trạm lắp ráp bằng máy tính bảng chưa mở.",
      asm_hint: "Mỗi phiếu trên trạm bấm riêng: Bắt đầu → Báo công (lần này làm xong bao nhiêu) → Hoàn thành. Có thể chọn nhiều người báo công.",
      asm_demo: "Chế độ demo: không ghi dữ liệu nào.",
      asm_refresh: "Tải lại",
      asm_load_failed: "Đọc dữ liệu thất bại",
      asm_role_note: "Báo công cần đăng nhập bằng tài khoản công nhân; tài khoản này chỉ xem.",
      asm_no_operators: "Chưa có nhân viên nào được liên kết mã MES cũ; hãy nhờ quản lý thêm liên kết mã nhân viên.",
      asm_order_count: "Trên trạm hiện có {{count}} phiếu",
      asm_no_orders: "Trên trạm hiện không có phiếu được giao.",
      asm_line_all: "Tất cả",
      asm_line_valve: "Kiểm tra van",
      asm_line_pump: "Kiểm tra bơm",
      asm_line_other: "Chưa phân loại",
      asm_state_running: "Đang sản xuất",
      asm_state_stopped: "Tạm dừng",
      asm_state_notStarted: "Chưa bắt đầu",
      asm_step: "Công đoạn {{step}}",
      asm_reported: "Đã báo tốt {{good}} · lỗi {{fail}} / đặt {{total}}",
      asm_missing_identity: "Thiếu liên kết MES cũ ({{fields}}); phiếu này tạm chưa thao tác trên máy tính bảng được, hãy báo quản lý.",
      asm_report_closed: "Nhà máy chưa mở báo công bằng máy tính bảng cho trạm này.",
      asm_report_unavailable: "Cài đặt báo công chưa đồng bộ, tạm thời chưa báo công được.",
      asm_start: "Bắt đầu",
      asm_start_confirm: "Xác nhận bắt đầu",
      asm_report: "Báo công",
      asm_finish: "Hoàn thành",
      asm_good_label: "Lần này làm xong bao nhiêu (hàng tốt)",
      asm_bad_label: "Lần này bao nhiêu hàng lỗi",
      asm_finish_question: "{{order}} đã làm xong hết ở trạm này? Điền luôn số làm lần cuối (không có thì để trống).",
      asm_finish_good_label: "Lần cuối làm xong bao nhiêu (hàng tốt, không có thì để trống)",
      asm_operators_label: "Người báo công (chọn nhiều được, mỗi người chọn tên mình)",
      asm_me: "Tôi",
      asm_submit: "Gửi báo công",
      asm_finish_submit: "Xác nhận hoàn thành và đóng trạm",
      asm_sending: "Đang gửi, vui lòng chờ…",
      asm_previewing: "Nhà máy đang kiểm tra…",
      asm_writing: "Nhà máy đang ghi…",
      asm_closing: "Đang đóng trạm…",
      asm_result_unknown: "Chưa có kết quả; đừng bấm lại, hãy xem giấy điện tử hoặc hỏi bộ phận kế hoạch.",
      asm_pending_report: "Phiếu này còn báo công đang gửi; hãy chờ gửi xong rồi báo.",
      asm_needs_confirm: "Cần xác nhận, hãy xem thông báo bên trên.",
      asm_ack_confirm: "Đã kiểm tra đúng, gửi",
      asm_ack_cancelled: "Đã hủy, lần này chưa báo công.",
      asm_report_failed: "Chưa báo được: ",
      asm_applied: "✓ Đã báo công: tốt {{good}}, lỗi {{bad}} (người báo: {{names}})",
      asm_applied_late: "MES cũ đã ghi lần báo này (phản hồi chậm); đừng bấm lại, hãy xem giấy điện tử hoặc hỏi kế hoạch.",
      asm_record_unconfirmed: "(Bản ghi App chưa xác nhận; đừng gửi lại số lượng)",
      asm_closed: "Đã hoàn thành và đóng trạm.",
      asm_close_failed: "Chưa đóng trạm được: ",
      asm_err_qty_invalid: "Số lượng phải là số nguyên từ 0 trở lên.",
      asm_err_qty_required: "Hãy điền số làm xong lần này (hoặc số hàng lỗi).",
      asm_err_reason_required: "Khi có hàng lỗi, hãy chọn lý do lỗi.",
      asm_err_note_required: "Hãy ghi một câu lý do rồi gửi.",
      asm_err_note_too_long: "Ghi chú không quá 500 ký tự.",
      asm_err_operator_required: "Hãy chọn người báo công (ít nhất một người).",
      asm_err_operator_too_many: "Tối đa 10 người báo công.",
      asm_block_qty_exceeds: "Số lượng lần này nhiều hơn số được báo; hãy kiểm tra lại.",
      asm_block_qty_invalid: "Số lượng không đúng; hãy kiểm tra lại.",
      asm_block_not_started: "Phiếu này chưa bắt đầu; hãy bấm Bắt đầu rồi mới báo công.",
      login_timeout: "Quá thời gian đăng nhập. Vui lòng đăng nhập lại."
    }
  };

  function storedLanguage() {
    try {
      const value = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
    } catch (_) { return DEFAULT_LANGUAGE; }
  }

  let language = storedLanguage();

  function interpolate(value, params) {
    return String(value).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => (
      Object.prototype.hasOwnProperty.call(params || {}, key) ? String(params[key]) : `{{${key}}}`
    ));
  }

  function t(key, params) {
    let value = dictionaries[language] && dictionaries[language][key];
    if (value == null) {
      value = dictionaries[DEFAULT_LANGUAGE][key];
      if (!warned.has(key)) {
        warned.add(key);
        if (root.console && typeof root.console.warn === "function") root.console.warn(`[i18n] Missing ${language} translation: ${key}; using zh-Hant.`);
      }
    }
    if (value == null) {
      if (!warned.has(`unknown:${key}`)) {
        warned.add(`unknown:${key}`);
        if (root.console && typeof root.console.warn === "function") root.console.warn(`[i18n] Unknown translation key: ${key}.`);
      }
      return key;
    }
    return interpolate(value, params || {});
  }

  function applyDocument(doc) {
    if (!doc) return;
    doc.documentElement.lang = language;
    doc.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
    doc.querySelectorAll("[data-i18n-aria-label]").forEach((node) => { node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel)); });
    const select = doc.getElementById("machtileLanguageSelect");
    if (select) select.value = language;
  }

  function setLanguage(next, options) {
    if (!SUPPORTED_LANGUAGES.includes(next)) return false;
    language = next;
    try { if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* storage unavailable */ }
    applyDocument(root.document);
    if (options && options.reload && root.location && typeof root.location.reload === "function") root.location.reload();
    return true;
  }

  const api = { t, setLanguage, getLanguage: () => language, applyDocument, dictionaries, STORAGE_KEY, DEFAULT_LANGUAGE };
  root.MachTileI18n = api;
  root.machtileT = t;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => applyDocument(root.document), { once: true });
    else applyDocument(root.document);
  }
})(typeof window !== "undefined" ? window : globalThis);
