(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HmcFixedStagingView = api;
})(globalThis, function () {
  "use strict";

  const MACHINES = Object.freeze({
    B01: Object.freeze({ name: "Mazak 1", tone: "blue" }),
    B02: Object.freeze({ name: "Mazak 2", tone: "teal" }),
  });

  // Inert until mounted by an approved host; no automatic connection or global config.
  function mount(root, controller) {
    const doc = root.ownerDocument;
    const el = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    let disposed = false;

    async function action(fn) {
      const promise = fn();
      render();
      await promise;
      if (!disposed) render();
    }

    const button = (text, fn, disabled = false, className = "") => {
      const element = el("button", text, className);
      element.type = "button";
      element.disabled = disabled;
      element.addEventListener("click", () => action(fn));
      return element;
    };

    function select(options, value) {
      const element = el("select");
      for (const [id, label] of options) {
        const option = el("option", label);
        option.value = id;
        element.append(option);
      }
      if (value !== undefined) element.value = value;
      return element;
    }

    function render() {
      if (disposed) return;
      const view = controller.snapshot();
      const activeMachine = view.scope?.machineCode || "B01";
      const machine = MACHINES[activeMachine] || MACHINES.B01;
      const blocked =
        view.busy ||
        view.unresolved ||
        ["DISABLED", "SIGNED_OUT", "CONTEXT_CHANGED"].includes(view.phase);

      root.replaceChildren();
      root.className = "hmc-fixed-root";

      const intro = el("header", undefined, "hmc-fixed-intro");
      const title = el("h2", "六盤固定工件");
      title.append(el("span", "Staging", "hmc-fixed-stage-badge"));
      intro.append(
        title,
        el("p", "先選機台，再選盤位。固定工件長期保留；有工單時才掛入。")
      );
      root.append(intro);

      const help = el("details", undefined, "hmc-fixed-help");
      help.append(el("summary", "操作與安全說明"));
      help.append(
        el(
          "p",
          "解除工單後固定配置仍保留。載入不是開工，也不增加產量。"
        ),
        el(
          "p",
          "目前沒有 IoT 即時盤況。保存時才會檢查人工回報是否在 8 小時內、此盤是否可操作及機台是否維修；未回報或資料過期時，請先由現場人員如實回報。"
        )
      );
      root.append(help);

      const messages = {
        DISABLED: "功能尚未啟用；未連線。",
        SIGNED_OUT: "請先登入。",
        CONTEXT_CHANGED:
          "登入或租戶已變更；畫面已清除。若有未明結果，須先核對原請求，不能重送。",
        NOT_LOADED: "請選機台與盤號。",
        LOADING: "讀取中…",
        READ_UNAVAILABLE: "無法讀取，不能判定為空盤。",
        CATALOG_UNAVAILABLE: "正式 ERP 料件主檔目前無法讀取；沒有改用工單清單，請稍後再試。",
        READY: "資料已讀取。",
        SAVING: "保存中，請勿重複送出。",
        RECONCILING: "查核原請求中…",
        OUTCOME_UNKNOWN: "原請求結果不明；禁止重送，請查核原請求。",
        STALE: "未套用變更；請重新讀取後核對。",
      };
      let statusText = view.code === "SAVED"
          ? "已確認保存成功。"
          : view.code === "RECOVERED_RELOAD_REQUIRED"
            ? "已查核原請求成功；請重新讀取最新盤位。"
            : messages[view.phase] || "目前不可操作。";
      if (view.phase === "CATALOG_UNAVAILABLE" && view.code !== view.phase) {
        statusText += `（診斷碼：${view.code}）`;
      }
      const status = el("p", statusText, "hmc-fixed-status");
      status.setAttribute("role", "status");
      root.append(status);

      if (view.catalog?.partCatalogSource) {
        const source = view.catalog.partCatalogSource;
        root.append(
          el(
            "p",
            `工件來源：正式 ERP 料件主檔（${source.machineCode} 製程）· 讀取時間 ${new Date(source.retrievedAtUtc).toLocaleString("zh-TW")}`,
            "hmc-fixed-source"
          )
        );
      }

      if (view.code === "PALLET_LOCKED") {
        root.append(
          el(
            "p",
            "未保存：盤況未確認、已過期、正在加工，或機台鎖定。請現場人員確認並如實回報，再重新讀取；勾選確認不能解除伺服器鎖。",
            "hmc-fixed-warning"
          )
        );
      }
      if (view.code === "RECOVERED_RELOAD_REQUIRED") {
        root.append(
          el(
            "p",
            "下方已顯示原請求成功時的配置，不保證是目前最新狀態。沒有重送、也沒有自動讀取；繼續修改前請按「重新讀取」。",
            "hmc-fixed-warning"
          )
        );
      }

      const machineTabs = el("nav", undefined, "hmc-fixed-machine-tabs");
      machineTabs.setAttribute("aria-label", "選擇機台");
      for (const [machineCode, details] of Object.entries(MACHINES)) {
        const isActive = activeMachine === machineCode;
        const tab = button(
          `${machineCode} ${details.name}`,
          () =>
            controller.select({
              machineCode,
              palletNo: isActive ? view.scope?.palletNo || 1 : 1,
            }),
          blocked,
          `hmc-fixed-machine-tab is-${details.tone}`
        );
        tab.dataset.machineTab = machineCode;
        tab.setAttribute("aria-pressed", String(isActive));
        machineTabs.append(tab);
      }
      root.append(machineTabs);

      const machinePanel = el(
        "section",
        undefined,
        `hmc-fixed-machine-panel is-${machine.tone}`
      );
      const machineHeader = el("div", undefined, "hmc-fixed-machine-header");
      machineHeader.append(
        el("strong", `${activeMachine} ${machine.name}`),
        el("span", "選擇要設定的交換盤")
      );
      machinePanel.append(machineHeader);

      const palletTabs = el("nav", undefined, "hmc-fixed-pallet-tabs");
      palletTabs.setAttribute("aria-label", `${activeMachine} 六盤`);
      for (let palletNo = 1; palletNo <= 6; palletNo += 1) {
        const isActive = view.scope?.machineCode === activeMachine && view.scope?.palletNo === palletNo;
        const tab = button(
          `盤 ${palletNo}`,
          () => controller.select({ machineCode: activeMachine, palletNo }),
          blocked,
          "hmc-fixed-pallet-tab"
        );
        tab.dataset.palletTab = String(palletNo);
        tab.setAttribute("aria-label", `${activeMachine} 盤 ${palletNo}`);
        tab.setAttribute("aria-pressed", String(isActive));
        palletTabs.append(tab);
      }
      machinePanel.append(palletTabs);
      root.append(machinePanel);

      const toolbar = el("div", undefined, "hmc-fixed-toolbar");
      if (view.scope) {
        toolbar.append(
          button("重新讀取", () => controller.select(view.scope), blocked, "hmc-fixed-secondary")
        );
      }
      if (view.unresolved) {
        toolbar.append(
          button(
            "查核原請求（不重送）",
            () => controller.reconcile(),
            view.busy || view.phase === "CONTEXT_CHANGED",
            "hmc-fixed-secondary"
          )
        );
      }
      if (toolbar.childElementCount) root.append(toolbar);
      if (view.unresolved) {
        root.append(
          el(
            "p",
            "網路可能中斷，但剛才的操作可能已保存。先查原結果，不要再按一次或清除瀏覽器資料；不會保存你的密碼。",
            "hmc-fixed-warning"
          )
        );
      }

      if (!view.state) {
        // Keep the selected pallet and its entry visible during source errors,
        // without claiming the pallet is empty or enabling a write path.
        if (view.scope) {
          const unavailable = el("section", undefined, `hmc-fixed-content is-${machine.tone}`);
          const heading = el("header", undefined, "hmc-fixed-content-header");
          heading.append(el("h3", `${view.scope.machineCode} · 盤 ${view.scope.palletNo}`));
          unavailable.append(
            heading,
            el(
              "p",
              view.phase === "CATALOG_UNAVAILABLE"
                ? "料件來源尚未驗證，暫不能選擇品號或保存；請按「重新讀取」。既有配置不會因此清除。"
                : "盤位資料尚未驗證，不能判定為空盤或新增配置。",
              "hmc-fixed-warning"
            ),
            button("新增固定位置", () => {}, true, "hmc-fixed-add")
          );
          root.append(unavailable);
        }
        return;
      }

      const content = el("section", undefined, `hmc-fixed-content is-${machine.tone}`);
      const contentHeader = el("header", undefined, "hmc-fixed-content-header");
      contentHeader.append(
        el("h3", `${view.scope.machineCode} · 盤 ${view.scope.palletNo}`),
        el("span", `${view.state.slots.length} 個固定位置 · 版本 ${view.state.revision}`)
      );
      content.append(contentHeader);

      if (!view.state.slots.length) {
        content.append(
          el("p", "已確認此盤尚無固定配置。", "hmc-fixed-empty")
        );
      }

      for (const slot of view.state.slots) {
        const row = el("article", undefined, "hmc-fixed-slot");
        row.dataset.slot = slot.slotId;
        const slotHeader = el("header", undefined, "hmc-fixed-slot-header");
        slotHeader.append(el("h4", `${slot.part.partNo} · ${slot.part.name}`));
        if (slot.order) slotHeader.append(el("span", "已掛工單", "hmc-fixed-order-badge"));
        row.append(
          slotHeader,
          el(
            "p",
            `常駐製程／模具：${slot.part.operationName || "未指定製程"} · ${slot.fixtureName || "（未填模具）"}`,
            "hmc-fixed-slot-meta"
          ),
          el(
            "p",
            slot.order?.orderNo || "尚未載入工單（固定工件與模具保留）",
            "hmc-fixed-slot-order"
          )
        );
        const slotActions = el("div", undefined, "hmc-fixed-slot-actions");
        slotActions.append(
          button(
            slot.order ? "解除本次工單" : "載入本次工單",
            () => controller.beginEdit(slot.order ? "unbind" : "bind", slot.slotId),
            !view.canWrite
          ),
          button(
            "修改固定配置",
            () => controller.beginEdit("configure", slot.slotId),
            !view.canWrite || !!slot.order,
            "hmc-fixed-secondary"
          )
        );
        row.append(slotActions);
        content.append(row);
      }

      content.append(
        button(
          "新增固定位置",
          () => controller.beginEdit("add"),
          !view.canWrite,
          "hmc-fixed-add"
        )
      );
      root.append(content);

      if (!view.edit) return;

      const edit = view.edit;
      const slot = view.state.slots.find((candidate) => candidate.slotId === edit.slotId);
      const form = el("section", undefined, "hmc-fixed-editor");
      form.dataset.editor = String(edit.key);
      form.append(
        el(
          "h3",
          {
            add: "新增固定配置",
            configure: "修改固定配置",
            bind: "選擇本次工單",
            unbind: "解除工單，保留固定工件與模具",
          }[edit.type]
        )
      );
      const label = (text, input) => {
        const element = el("label", text);
        element.append(input);
        form.append(element);
      };

      let part;
      let operation;
      let fixture;
      let order;
      if (["add", "configure"].includes(edit.type)) {
        // 2026-09-12 owner decision: part number comes from the formal ERP CNC
        // part/semi-finished catalog; process and fixture remain optional.
        const available = Array.isArray(view.catalog.availableParts)
          ? view.catalog.availableParts
          : [];
        const picker = el("div", undefined, "hmc-fixed-part-picker");
        const partLabel = el("label", "工件品號");
        part = el("input");
        part.type = "search";
        part.value = slot?.part.partNo || "";
        part.placeholder = "輸入品號或品名";
        part.autocomplete = "off";
        part.spellcheck = false;
        part.required = true;
        part.setAttribute("role", "combobox");
        part.setAttribute("aria-autocomplete", "list");
        part.setAttribute("aria-expanded", "false");
        const results = el("div", undefined, "hmc-fixed-part-options");
        results.id = `hmc-fixed-part-options-${edit.key}`;
        results.setAttribute("role", "listbox");
        results.hidden = true;
        part.setAttribute("aria-controls", results.id);
        let pickerOpen = false;
        const closePicker = () => {
          pickerOpen = false;
          results.hidden = true;
          part.setAttribute("aria-expanded", "false");
        };
        const renderPartOptions = () => {
          const query = part.value.trim().toLocaleLowerCase();
          const matches = query
            ? available.filter((item) =>
                `${item.partNo} ${item.name}`.toLocaleLowerCase().includes(query)
              )
            : available;
          results.replaceChildren();
          if (!matches.length) {
            results.append(
              el(
                "p",
                available.length
                  ? "找不到符合的工件"
                  : "目前沒有可選品號；請先確認工單或品項主檔來源。",
                "hmc-fixed-part-empty"
              )
            );
          } else {
            for (const item of matches.slice(0, 50)) {
              const option = el("button", undefined, "hmc-fixed-part-option");
              option.type = "button";
              option.setAttribute("role", "option");
              option.setAttribute("aria-selected", String(part.value === item.partNo));
              option.append(el("strong", item.partNo), el("span", item.name));
              option.addEventListener("pointerdown", (event) => event.preventDefault());
              option.addEventListener("click", () => {
                part.value = item.partNo;
                closePicker();
                part.focus();
              });
              option.addEventListener("keydown", (event) => {
                const options = Array.from(results.querySelectorAll('[role="option"]'));
                const index = options.indexOf(option);
                if (event.key === "ArrowDown" && options[index + 1]) {
                  event.preventDefault();
                  options[index + 1].focus();
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  (options[index - 1] || part).focus();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closePicker();
                  part.focus();
                }
              });
              results.append(option);
            }
            if (matches.length > 50) {
              results.append(
                el("p", `目前顯示前 50 筆，共 ${matches.length} 筆；請再輸入關鍵字。`, "hmc-fixed-part-limit")
              );
            }
          }
          results.hidden = !pickerOpen;
          part.setAttribute("aria-expanded", String(pickerOpen));
        };
        part.addEventListener("focus", () => {
          pickerOpen = true;
          renderPartOptions();
        });
        part.addEventListener("input", () => {
          pickerOpen = true;
          renderPartOptions();
        });
        part.addEventListener("keydown", (event) => {
          if (event.key === "Escape") closePicker();
          if (event.key === "ArrowDown") {
            pickerOpen = true;
            renderPartOptions();
            const first = results.querySelector('[role="option"]');
            if (first) {
              event.preventDefault();
              first.focus();
            }
          }
        });
        part.addEventListener("blur", () =>
          root.ownerDocument.defaultView.setTimeout(() => {
            if (!picker.contains(root.ownerDocument.activeElement)) closePicker();
          }, 0)
        );
        partLabel.append(part);
        picker.append(partLabel, results);
        form.append(picker);
        operation = el("input");
        operation.value = slot?.part.operationName || "";
        operation.maxLength = 60;
        label("製程（選填，例 N1／N2）", operation);
        fixture = el("input");
        fixture.value = slot?.fixtureName || "";
        fixture.maxLength = 120;
        label("模具／夾具（選填）", fixture);
      }
      if (edit.type === "bind") {
        const candidates = view.catalog.orders.filter(
          (item) =>
            item.machineCode === view.scope.machineCode &&
            item.partNo === slot.part.partNo &&
            item.status === "open"
        );
        order = select([
          ["", "請選工單"],
          ...candidates.map((item) => [item.id, item.orderNo]),
        ]);
        label("本次工單", order);
        if (!candidates.length) {
          form.append(el("p", "目前沒有本機台同品號的可掛工單。"));
        }
      }

      const confirmed = el("input");
      confirmed.type = "checkbox";
      label("我已核對機台、盤號、位置及本次內容", confirmed);
      const palletConfirmed = el("input");
      palletConfirmed.type = "checkbox";
      label("我已在現場確認此盤未加工，現在可進行本次配置或掛單變更", palletConfirmed);
      form.append(
        el("p", "此確認只適用本次操作，不是機台自動偵測，也不取代現場安全程序。")
      );
      for (const input of [part, operation, fixture, order, confirmed, palletConfirmed].filter(Boolean)) {
        input.disabled = !view.canWrite;
      }
      const formActions = el("div", undefined, "hmc-fixed-editor-actions");
      formActions.append(
        button("取消", () => controller.cancel(), view.busy || view.unresolved, "hmc-fixed-secondary"),
        button(
          "確認保存",
          () =>
            controller.save(edit.key, {
              confirmed: confirmed.checked,
              palletConfirmed: palletConfirmed.checked,
              ...(part
                ? {
                    partNo: part.value,
                    operationName: operation.value,
                    fixtureName: fixture.value,
                  }
                : {}),
              ...(order ? { orderId: order.value } : {}),
            }),
          !view.canWrite
        )
      );
      form.append(formActions);
      if (view.code === "CONFIRMATION_REQUIRED") {
        form.append(el("p", "請完整核對並勾選確認。"));
      }
      if (view.code === "PART_UNKNOWN" || view.code === "INVALID_COMMAND") {
        form.append(el("p", "請選擇工件品號；製程與模具為選填。"));
      }
      if (view.code === "MANUAL_PALLET_CONFIRMATION_REQUIRED") {
        form.append(el("p", "請先到現場確認此盤未加工，並勾選本次盤況確認。"));
      }
      root.append(form);
    }

    render();
    return Object.freeze({
      render,
      dispose() {
        disposed = true;
        root.replaceChildren();
      },
    });
  }

  return Object.freeze({ mount });
});
