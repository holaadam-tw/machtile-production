(function (root) {
  "use strict";

  const STORAGE_KEY = "machtile.language";
  const DEFAULT_LANGUAGE = "zh-Hant";
  const SUPPORTED_LANGUAGES = [DEFAULT_LANGUAGE, "vi"];
  const warned = new Set();

  const dictionaries = {
    "zh-Hant": {
      takeover_stop_title: "確認停工", takeover_stop_qty_question: "這段做了幾件？良品／不良（必填，0 也要填）",
      takeover_good_qty: "良品", takeover_fail_qty: "不良", takeover_reason: "停工原因", takeover_allow_question: "允許其他機台接手？",
      takeover_must_tap: "請親自按是或否", takeover_note: "說明", takeover_confirm_stop: "確認停工", takeover_stop_sent: "停工已送出", takeover_stop_waiting: "已送出，等待工廠確認",
      takeover_new_order: "開工新訂單", takeover_old_order: "接手舊的工單", takeover_new_order_help: "從現有待做池選擇新訂單。", takeover_continue_new: "繼續開工新訂單",
      takeover_step: "第 {{step}} 道", takeover_done_remaining: "已做 {{done}}／剩下 {{remaining}}", takeover_take: "接手", takeover_none: "目前沒有可接手的工單",
      takeover_sent: "接手已送出", takeover_send_failed: "送出失敗，請稍後再試", yes: "是", no: "否", cancel: "取消", loading: "讀取中…",
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
      finish_close_applied_short: "少 {{quantity}} 件，已關站",
      finish_close_applied_detail: "完工報工已保留；舊 MES 已關站。",
      finish_close_rejected_title: "關站未完成",
      finish_close_zero_reported: "這一道還沒有報工數量，不能完工關站；請先報工",
      finish_close_lock_timeout: "這次沒有關成（系統忙），可以再按一次",
      finish_close_still_running: "這筆仍在生產中，沒有關站；請先停工再試。",
      finish_close_unknown: "完工報工已成功，但關站未完成；請核對舊 MES 狀態。",
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
      good_quantity: "良品數",
      counter_preview: "累計 {{current}}｜上次 {{baseline}}｜這次 {{delta}}{{message}}",
      counter_loading: "正在讀取今天的機台計數基準…",
      counter_load_error: "讀不到今天的機台計數基準，請確認連線後重開報工。",
      counter_current_required: "請填寫機台目前累計數。",
      counter_baseline_required: "今天尚無開工或報工基準；請先按開工，或手填基準。",
      counter_non_positive: "機台累計 {{current}} 必須大於上次 {{baseline}}；這次差額需大於 0。",
      counter_rate_warning: "照工時這段時間最多約 {{max}} 件，你報 {{quantity}} 件，請確認",
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
      login_timeout: "登入流程已逾時，請重新登入。"
    },
    vi: {
      takeover_stop_title: "Xác nhận dừng máy", takeover_stop_qty_question: "Công đoạn này đã làm bao nhiêu? Hàng tốt／hàng lỗi (bắt buộc, kể cả 0)",
      takeover_good_qty: "Hàng tốt", takeover_fail_qty: "Hàng lỗi", takeover_reason: "Lý do dừng", takeover_allow_question: "Cho phép máy khác tiếp nhận?",
      takeover_must_tap: "Vui lòng tự chọn Có hoặc Không", takeover_note: "Ghi chú", takeover_confirm_stop: "Xác nhận dừng", takeover_stop_sent: "Đã gửi lệnh dừng", takeover_stop_waiting: "Đã gửi, đang chờ nhà máy xác nhận",
      takeover_new_order: "Mở đơn hàng mới", takeover_old_order: "Tiếp nhận lệnh cũ", takeover_new_order_help: "Chọn đơn hàng mới trong danh sách chờ.", takeover_continue_new: "Tiếp tục mở đơn mới",
      takeover_step: "Công đoạn {{step}}", takeover_done_remaining: "Đã làm {{done}}／còn {{remaining}}", takeover_take: "Tiếp nhận", takeover_none: "Hiện không có lệnh có thể tiếp nhận",
      takeover_sent: "Đã gửi yêu cầu tiếp nhận", takeover_send_failed: "Gửi thất bại, vui lòng thử lại", yes: "Có", no: "Không", cancel: "Hủy", loading: "Đang tải…",
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
      finish_close_applied_short: "Thiếu {{quantity}} sản phẩm, đã đóng công đoạn", // _draft
      finish_close_applied_detail: "Báo cáo hoàn tất đã được lưu; công đoạn MES cũ đã đóng.", // _draft
      finish_close_rejected_title: "Chưa đóng được công đoạn", // _draft
      finish_close_zero_reported: "Công đoạn này chưa có số lượng báo cáo nên chưa thể hoàn tất và đóng công đoạn; vui lòng báo cáo trước.", // _draft
      finish_close_lock_timeout: "Lần này chưa đóng được vì hệ thống đang bận; bạn có thể bấm lại.", // _draft
      finish_close_still_running: "Mục này vẫn đang sản xuất nên chưa đóng công đoạn; vui lòng dừng máy rồi thử lại.", // _draft
      finish_close_unknown: "Báo cáo hoàn tất đã thành công nhưng chưa đóng được công đoạn; vui lòng kiểm tra trạng thái MES cũ.", // _draft
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
      good_quantity: "Số lượng đạt",
      counter_preview: "Tích lũy {{current}}｜Lần trước {{baseline}}｜Lần này {{delta}}{{message}}",
      counter_loading: "Đang đọc mốc bộ đếm máy hôm nay…",
      counter_load_error: "Không đọc được mốc bộ đếm máy hôm nay. Vui lòng kiểm tra kết nối rồi mở lại báo cáo.",
      counter_current_required: "Vui lòng nhập số tích lũy hiện tại của máy.",
      counter_baseline_required: "Hôm nay chưa có mốc bắt đầu hoặc báo cáo; hãy bấm bắt đầu hoặc nhập mốc thủ công.",
      counter_non_positive: "Số tích lũy {{current}} phải lớn hơn lần trước {{baseline}}; chênh lệch lần này phải lớn hơn 0.",
      counter_rate_warning: "Theo thời gian gia công, khoảng này tối đa khoảng {{max}} sản phẩm; bạn báo {{quantity}} sản phẩm, vui lòng kiểm tra",
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
