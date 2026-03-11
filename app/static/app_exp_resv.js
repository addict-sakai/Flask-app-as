/**
 * app_exp.js  –  体験予約ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const ExpApp = (() => {

  /* ════════════════════════════════════════
     状態管理
  ════════════════════════════════════════ */
  const S = {
    type:        "para",     // "para" | "camp"
    calYear:     new Date().getFullYear(),
    calMonth:    new Date().getMonth() + 1,
    filterDate:  "",
    showCancel:  false,
    editingId:   null,       // null=新規, number=編集
    config:      {},         // APIから取得した設定値
  };

  const TODAY = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  /* ════════════════════════════════════════
     ユーティリティ
  ════════════════════════════════════════ */
  const $ = id => document.getElementById(id);

  const esc = s => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function fmtMoney(n) {
    return n == null ? "—" : Number(n).toLocaleString() + " 円";
  }

  function dateToISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  async function apiFetch(url) {
    const res  = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiPut(url, body) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function toast(msg, type = "success") {
    const el = document.createElement("div");
    el.className   = `toast-msg toast-msg--${type}`;
    el.textContent = msg;
    $("toastZone").appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /* ════════════════════════════════════════
     初期化
  ════════════════════════════════════════ */
  async function init() {
    _bindHeader();
    _bindSidebar();
    _bindCalendar();
    _bindModal();

    // config 一括取得
    try {
      S.config = await apiFetch("/api/exp/config");
      _populateSelects();
    } catch (e) {
      toast("設定データの取得に失敗しました", "error");
    }

    loadList();
    loadCalendar();
  }

  /* ════════════════════════════════════════
     ヘッダータブ
  ════════════════════════════════════════ */
  function _bindHeader() {
    document.querySelectorAll(".exp-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".exp-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        S.type     = btn.dataset.type;
        S.filterDate = "";
        $("filterDate").value = "";
        loadList();
        loadCalendar();
        _updateTableHeader();
      });
    });
  }

  /* ════════════════════════════════════════
     サイドバー
  ════════════════════════════════════════ */
  function _bindSidebar() {
    $("btnNewResv").addEventListener("click", () => openModal(null));

    $("filterDate").addEventListener("change", () => {
      S.filterDate = $("filterDate").value;
      if (S.filterDate) {
        const d = new Date(S.filterDate);
        S.calYear  = d.getFullYear();
        S.calMonth = d.getMonth() + 1;
        _updateSideMonthLabel();
      }
      loadList();
    });

    $("btnClearDate").addEventListener("click", () => {
      S.filterDate = "";
      $("filterDate").value = "";
      loadList();
    });

    $("btnSideMonthPrev").addEventListener("click", () => {
      S.calMonth--;
      if (S.calMonth < 1) { S.calMonth = 12; S.calYear--; }
      _updateSideMonthLabel();
      loadList();
      loadCalendar();
    });

    $("btnSideMonthNext").addEventListener("click", () => {
      S.calMonth++;
      if (S.calMonth > 12) { S.calMonth = 1; S.calYear++; }
      _updateSideMonthLabel();
      loadList();
      loadCalendar();
    });

    $("chkShowCancel").addEventListener("change", () => {
      S.showCancel = $("chkShowCancel").checked;
      loadList();
    });

    _updateSideMonthLabel();
  }

  function _updateSideMonthLabel() {
    $("sideMonthLabel").textContent = `${S.calYear}/${String(S.calMonth).padStart(2,"0")}`;
  }

  /* ════════════════════════════════════════
     テーブルヘッダー
  ════════════════════════════════════════ */
  function _updateTableHeader() {
    const thead = $("tableHeaderRow");
    if (S.type === "para") {
      thead.innerHTML = `
        <th>予約番号</th>
        <th>予約日</th>
        <th>名前</th>
        <th>人数</th>
        <th>コース</th>
        <th>集合時間</th>
        <th>支払</th>
        <th>請求金額</th>
        <th>担当</th>
        <th>状態</th>
      `;
    } else {
      thead.innerHTML = `
        <th>予約番号</th>
        <th>予約日</th>
        <th>名前</th>
        <th>サイト</th>
        <th>大人</th>
        <th>テント</th>
        <th>タープ</th>
        <th>請求金額</th>
        <th>担当</th>
        <th>状態</th>
      `;
    }
  }

  /* ════════════════════════════════════════
     一覧ロード
  ════════════════════════════════════════ */
  async function loadList() {
    _updateTableHeader();
    let url = `/api/exp/reservations?type=${S.type}&show_cancel=${S.showCancel ? "1" : "0"}`;
    if (S.filterDate) {
      url += `&date=${S.filterDate}`;
    } else {
      url += `&year=${S.calYear}&month=${S.calMonth}`;
    }

    try {
      const data = await apiFetch(url);
      _renderList(data.items);

      // 統計
      const total  = data.items.length;
      const amount = data.items.reduce((s, r) => s + (r.charge_amount || 0), 0);
      $("statCount").textContent  = total;
      $("statAmount").textContent = amount.toLocaleString();
      const lb = S.filterDate
        ? S.filterDate
        : `${S.calYear}年${S.calMonth}月`;
      $("statLabel").textContent = lb;

    } catch (e) {
      toast("一覧の取得に失敗: " + e.message, "error");
    }
  }

  function _renderList(items) {
    const tbody = $("resvTbody");
    tbody.innerHTML = "";

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="10" class="exp-empty">
          <span class="exp-empty-icon">🪂</span>予約がありません
        </td></tr>`;
      return;
    }

    items.forEach(r => {
      const tr = document.createElement("tr");
      if (r.cancelled) tr.classList.add("is-cancelled");

      const badge = r.cancelled
        ? `<span class="td-chip td-chip--cancel">キャンセル</span>`
        : `<span class="td-chip td-chip--${r.reservation_type}">${r.reservation_type === "para" ? "受付中" : "受付中"}</span>`;

      let cols = "";
      if (S.type === "para") {
        const p = r.para || {};
        cols = `
          <td class="td-resv-no">P-${String(r.reservation_no).padStart(4,"0")}</td>
          <td>${esc(r.reservation_date || "—")}</td>
          <td class="td-name">${esc(r.name)}</td>
          <td>${esc(p.pax_count ?? "—")}名</td>
          <td>${esc(p.course || "—")}</td>
          <td class="td-dim">${esc(p.meeting_time || "—")}</td>
          <td class="td-dim">${esc(p.payment_method || "—")}</td>
          <td class="td-amount">${(r.charge_amount || 0).toLocaleString()}</td>
          <td class="td-dim">${esc(r.staff || "—")}</td>
          <td>${badge}</td>
        `;
      } else {
        const c = r.camp || {};
        cols = `
          <td class="td-resv-no">C-${String(r.reservation_no).padStart(4,"0")}</td>
          <td>${esc(r.reservation_date || "—")}</td>
          <td class="td-name">${esc(r.name)}</td>
          <td>${esc(c.site_type || "—")}</td>
          <td>${esc(c.adult_count ?? 0)}名</td>
          <td>${esc(c.tent_count ?? 0)}張</td>
          <td>${esc(c.tarp_count ?? 0)}</td>
          <td class="td-amount">${(r.charge_amount || 0).toLocaleString()}</td>
          <td class="td-dim">${esc(r.staff || "—")}</td>
          <td>${badge}</td>
        `;
      }

      tr.innerHTML = cols;
      tr.addEventListener("click", () => openModal(r.id));
      tbody.appendChild(tr);
    });
  }

  /* ════════════════════════════════════════
     カレンダー
  ════════════════════════════════════════ */
  function _bindCalendar() {
    $("btnCalPrev").addEventListener("click", () => {
      S.calMonth--;
      if (S.calMonth < 1) { S.calMonth = 12; S.calYear--; }
      _updateSideMonthLabel();
      loadList();
      loadCalendar();
    });
    $("btnCalNext").addEventListener("click", () => {
      S.calMonth++;
      if (S.calMonth > 12) { S.calMonth = 1; S.calYear++; }
      _updateSideMonthLabel();
      loadList();
      loadCalendar();
    });
  }

  async function loadCalendar() {
    $("calMonthLabel").textContent = `${S.calYear}年${S.calMonth}月`;
    try {
      const data = await apiFetch(
        `/api/exp/calendar?type=${S.type}&year=${S.calYear}&month=${S.calMonth}`
      );
      $("calMonthCount").textContent  = data.month_count ?? "—";
      $("calMonthAmount").textContent = (data.month_amount ?? 0).toLocaleString();
      _renderCalendar(data.days);
    } catch (e) {
      toast("カレンダー取得に失敗: " + e.message, "error");
    }
  }

  function _renderCalendar(days) {
    const grid = $("calendarGrid");
    grid.innerHTML = "";
    const wdays = ["日","月","火","水","木","金","土"];
    const wdClasses = ["sun","","","","","","sat"];

    wdays.forEach((w, i) => {
      const el = document.createElement("div");
      el.className   = `cal-weekday ${wdClasses[i]}`;
      el.textContent = w;
      grid.appendChild(el);
    });

    const firstDay = new Date(S.calYear, S.calMonth - 1, 1);
    const startDow = firstDay.getDay();
    const lastDay  = new Date(S.calYear, S.calMonth, 0).getDate();
    const todayISO = dateToISO(TODAY);

    for (let i = 0; i < startDow; i++) {
      const b = document.createElement("div");
      b.className = "cal-day cal-day--empty";
      grid.appendChild(b);
    }

    for (let d = 1; d <= lastDay; d++) {
      const dateObj = new Date(S.calYear, S.calMonth - 1, d);
      const iso     = dateToISO(dateObj);
      const dow     = dateObj.getDay();
      const dayData = days[iso];
      const isToday = iso === todayISO;

      const cell = document.createElement("div");
      cell.className = [
        "cal-day",
        dayData  ? "cal-day--active" : "",
        isToday  ? "cal-day--today"  : "",
        dow === 0 ? "cal-day--sun"   : "",
        dow === 6 ? "cal-day--sat"   : "",
      ].filter(Boolean).join(" ");

      const numEl = document.createElement("div");
      numEl.className   = "cal-day-num";
      numEl.textContent = d;
      cell.appendChild(numEl);

      if (dayData && dayData.count > 0) {
        const badge = document.createElement("div");
        badge.className   = `cal-badge${S.type === "camp" ? " cal-badge--camp" : ""}`;
        badge.textContent = `${dayData.count}件`;
        cell.appendChild(badge);

        cell.addEventListener("click", () => {
          S.filterDate = iso;
          $("filterDate").value = iso;
          loadList();
        });
      }

      grid.appendChild(cell);
    }
  }

  /* ════════════════════════════════════════
     select 要素を config で初期化
  ════════════════════════════════════════ */
  function _populateSelects() {
    const c = S.config;

    // 担当
    _fillSelect($("fStaff"),       c.staff ?? [],         true);
    // パラ
    _fillSelect($("fCourse"),      c.para_course ?? [],   false);
    _fillSelect($("fMeetingTime"), c.para_time ?? [],     true);
    _fillSelect($("fShortTime"),   c.para_short ?? [],    true);
    _fillSelect($("fBookingSite"), c.para_site ?? [],     true);
    _fillSelect($("fPayment"),     c.para_payment ?? [],  true);
    _fillSelect($("fTicket"),      c.para_ticket ?? [],   true);
    // キャンプ 車両
    _fillSelect($("fV1Type"), c.camp_vehicle ?? [], true);
    _fillSelect($("fV2Type"), c.camp_vehicle ?? [], true);
    _fillSelect($("fV3Type"), c.camp_vehicle ?? [], true);

    $("fInsurance").value = 0;  // 体験の保険料はフォームで手入力

    // コース変更 → 保険チェック / ショート表示 / 金額再計算
    $("fCourse").addEventListener("change", _onCourseChange);

    // チケット変更 → 保険料制御
    $("fTicket").addEventListener("change", _onTicketChange);

    // 数値変更で再計算
    ["fPax","fInsurance","fPoint","fCoupon"].forEach(id => {
      $(id).addEventListener("input", _calcPara);
    });
    $("fCourse").addEventListener("change", _calcPara);

    // キャンプ再計算
    ["fAdult","fChild","fTent","fTarp",
     "fV1Count","fV2Count","fV3Count",
     "fV1Type","fV2Type","fV3Type"].forEach(id => {
      $(id).addEventListener("input",  _calcCamp);
      $(id).addEventListener("change", _calcCamp);
    });
    document.querySelectorAll('input[name="site_type"]').forEach(r => {
      r.addEventListener("change", _onSiteChange);
    });

    // 再計算ボタン
    $("btnRecalc").addEventListener("click", () => {
      if (S.type === "para") _calcPara();
      else                   _calcCamp();
    });
  }

  function _fillSelect(sel, items, withEmpty = true) {
    sel.innerHTML = "";
    if (withEmpty) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "—";
      sel.appendChild(opt);
    }
    items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.label;
      opt.dataset.amount = item.amount ?? 0;
      opt.textContent = item.amount
        ? `${item.label}（${Number(item.amount).toLocaleString()}円）`
        : item.label;
      sel.appendChild(opt);
    });
  }

  /* コース変更ハンドラ */
  function _onCourseChange() {
    const course = $("fCourse").value;
    // ショート時間の表示制御
    $("shortTimeWrap").style.display = (course === "ショート") ? "" : "none";
    _calcPara();
  }

  /* チケット変更ハンドラ：パウチャー以外は保険料0 */
  function _onTicketChange() {
    const ticket = $("fTicket").value;
    if (ticket && ticket !== "パウチャー") {
      $("fInsurance").value = 0;
    } else {
      // チケットなし or パウチャー → 保険料はそのまま（手入力）
    }
    _calcPara();
  }

  /* サイト変更：フリーサイト②のみ車両セクション表示 */
  function _onSiteChange() {
    const site = document.querySelector('input[name="site_type"]:checked')?.value || "";
    $("vehicleSection").style.display = (site === "フリーサイト②") ? "" : "none";
    _calcCamp();
  }

  /* ════════════════════════════════════════
     パラ料金計算
     ((コース金額 + 保険料) × 人数) - ポイント - クーポン
     ただしチケットでパウチャー以外は保険料0
  ════════════════════════════════════════ */
  function _calcPara() {
    const sel     = $("fCourse");
    const selOpt  = sel.options[sel.selectedIndex];
    const courseAmt  = Number(selOpt?.dataset?.amount || 0);
    const pax        = Math.max(0, parseInt($("fPax").value) || 0);

    // チケット判定
    const ticket    = $("fTicket").value;
    const isPaucher = (!ticket || ticket === "" || ticket === "パウチャー");
    const insPerPax = isPaucher ? (parseInt($("fInsurance").value) || 0) : 0;

    const courseTotal = (courseAmt + insPerPax) * pax;
    const point       = parseInt($("fPoint").value)  || 0;
    const coupon      = parseInt($("fCoupon").value) || 0;
    const total       = Math.max(0, courseTotal - point - coupon);

    $("calcCourseAmt").textContent = `${courseAmt.toLocaleString()} × ${pax} = ${(courseAmt * pax).toLocaleString()}`;
    $("calcInsAmt").textContent    = isPaucher
      ? `${insPerPax.toLocaleString()} × ${pax} = ${(insPerPax * pax).toLocaleString()}`
      : "— (保険なし)";
    $("calcPointAmt").textContent  = `-${point.toLocaleString()}`;
    $("calcCouponAmt").textContent = `-${coupon.toLocaleString()}`;
    $("calcTotal").textContent     = `${total.toLocaleString()} 円`;

    $("fCharge").value = total;
  }

  /* ════════════════════════════════════════
     キャンプ料金計算
  ════════════════════════════════════════ */
  function _calcCamp() {
    const cfg  = S.config;
    const site = document.querySelector('input[name="site_type"]:checked')?.value || "";

    // 大人単価
    const adultPrice = (cfg.camp_adult && cfg.camp_adult[0]) ? Number(cfg.camp_adult[0].amount || 0) : 0;
    const tentPrice  = (cfg.camp_tent_wd && cfg.camp_tent_wd[0]) ? Number(cfg.camp_tent_wd[0].amount || 0) : 0;
    const tarpPrice  = (cfg.camp_tarp  && cfg.camp_tarp[0])  ? Number(cfg.camp_tarp[0].amount  || 0) : 0;

    const adults = parseInt($("fAdult").value) || 0;
    const tents  = parseInt($("fTent").value)  || 0;
    const tarps  = parseInt($("fTarp").value)  || 0;

    const adultAmt = adults * adultPrice;
    const tentAmt  = tents  * tentPrice;
    const tarpAmt  = tarps  * tarpPrice;

    $("calcAdultAmt").textContent = `${adultPrice.toLocaleString()} × ${adults} = ${adultAmt.toLocaleString()}`;
    $("calcTentAmt").textContent  = `${tentPrice.toLocaleString()} × ${tents} = ${tentAmt.toLocaleString()}`;
    $("calcTarpAmt").textContent  = `${tarpPrice.toLocaleString()} × ${tarps} = ${tarpAmt.toLocaleString()}`;

    let vehicleAmt = 0;
    if (site === "フリーサイト②") {
      [[1,2,3]].flat().forEach(n => {
        const vType  = $(`fV${n}Type`).value;
        const vCount = parseInt($(`fV${n}Count`).value) || 0;
        const vItem  = (cfg.camp_vehicle || []).find(v => v.label === vType);
        const vPrice = vItem ? Number(vItem.amount || 0) : 0;
        vehicleAmt  += vCount * vPrice;
      });
    }

    $("calcVehicleAmt").textContent = site === "フリーサイト②"
      ? vehicleAmt.toLocaleString()
      : "— (車両なし)";
    $("calcVehicleRow").style.display = site === "フリーサイト②" ? "" : "none";

    const total = adultAmt + tentAmt + tarpAmt + vehicleAmt;
    $("calcCampTotal").textContent = `${total.toLocaleString()} 円`;
    $("fCharge").value = total;
  }

  /* ════════════════════════════════════════
     モーダル
  ════════════════════════════════════════ */
  function _bindModal() {
    $("btnModalClose").addEventListener("click",  closeModal);
    $("btnModalCancel").addEventListener("click", closeModal);
    $("btnModalSave").addEventListener("click",   saveResv);
    $("resvOverlay").addEventListener("click", e => {
      if (e.target === $("resvOverlay")) closeModal();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeModal();
    });
  }

  async function openModal(id) {
    S.editingId = id;
    _resetForm();

    if (id) {
      // 編集モード：既存データを取得してフォームに反映
      try {
        const data = await apiFetch(`/api/exp/reservations/${id}`);
        _fillForm(data);
        $("modalTitle").textContent = "予約編集";
        $("btnModalSave").textContent = "更新";
      } catch (e) {
        toast("データ取得に失敗: " + e.message, "error");
        return;
      }
    } else {
      // 新規モード
      $("modalTitle").textContent = "新規予約";
      $("btnModalSave").textContent = "登録";
      _showTypeFields(S.type);
      _setModalBadge(S.type);
      // 今日の日付をセット
      $("fResvDate").value = dateToISO(TODAY);
    }

    const overlay = $("resvOverlay");
    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const overlay = $("resvOverlay");
    overlay.classList.remove("is-visible");
    setTimeout(() => { overlay.style.display = "none"; }, 220);
    document.body.style.overflow = "";
    S.editingId = null;
  }

  function _resetForm() {
    $("fResvDate").value = "";
    $("fName").value     = "";
    $("fPhone").value    = "";
    $("fStaff").value    = "";
    $("fMemo").value     = "";
    $("fCharge").value   = "";
    $("fCancelled").checked = false;
    // パラ
    $("fPax").value      = 1;
    $("fCourse").value   = "";
    $("fMeetingTime").value = "";
    $("fShortTime").value   = "";
    $("fBookingSite").value = "";
    $("fPayment").value     = "";
    $("fTicket").value      = "";
    $("fPoint").value    = 0;
    $("fCoupon").value   = 0;
    $("fUpgrade").checked   = false;
    $("fShuttle").checked   = false;
    $("shortTimeWrap").style.display = "none";
    // 保険料の初期値
    const c = S.config;
    $("fInsurance").value = 0;
    // キャンプ
    $("fAdult").value = 1;
    $("fChild").value = 0;
    $("fTent").value  = 0;
    $("fTarp").value  = 0;
    $("fV1Type").value = ""; $("fV1Count").value = 0;
    $("fV2Type").value = ""; $("fV2Count").value = 0;
    $("fV3Type").value = ""; $("fV3Count").value = 0;
    document.querySelector('input[name="site_type"][value="フリーサイト①"]').checked = true;
    $("vehicleSection").style.display = "none";
  }

  function _fillForm(data) {
    const type = data.reservation_type;
    _showTypeFields(type);
    _setModalBadge(type);

    $("fResvDate").value = data.reservation_date || "";
    $("fName").value     = data.name || "";
    $("fPhone").value    = data.phone || "";
    $("fStaff").value    = data.staff || "";
    $("fMemo").value     = data.memo || "";
    $("fCharge").value   = data.charge_amount || 0;
    $("fCancelled").checked = !!data.cancelled;

    if (type === "para" && data.para) {
      const p = data.para;
      $("fPax").value         = p.pax_count ?? 1;
      $("fCourse").value      = p.course || "";
      $("fMeetingTime").value = p.meeting_time || "";
      $("fShortTime").value   = p.short_time || "";
      $("fBookingSite").value = p.booking_site || "";
      $("fPayment").value     = p.payment_method || "";
      $("fTicket").value      = p.ticket_detail || "";
      $("fInsurance").value   = p.insurance_fee ?? 0;
      $("fPoint").value       = p.point_discount ?? 0;
      $("fCoupon").value      = p.coupon_discount ?? 0;
      $("fUpgrade").checked   = !!p.upgrade;
      $("fShuttle").checked   = !!p.shuttle;
      $("shortTimeWrap").style.display = (p.course === "ショート") ? "" : "none";
      _calcPara();
    }

    if (type === "camp" && data.camp) {
      const c = data.camp;
      const siteRadio = document.querySelector(`input[name="site_type"][value="${c.site_type}"]`);
      if (siteRadio) siteRadio.checked = true;
      $("fAdult").value    = c.adult_count ?? 0;
      $("fChild").value    = c.child_count ?? 0;
      $("fTent").value     = c.tent_count  ?? 0;
      $("fTarp").value     = c.tarp_count  ?? 0;
      $("fV1Type").value   = c.vehicle1_type  || "";
      $("fV1Count").value  = c.vehicle1_count ?? 0;
      $("fV2Type").value   = c.vehicle2_type  || "";
      $("fV2Count").value  = c.vehicle2_count ?? 0;
      $("fV3Type").value   = c.vehicle3_type  || "";
      $("fV3Count").value  = c.vehicle3_count ?? 0;
      $("vehicleSection").style.display = (c.site_type === "フリーサイト②") ? "" : "none";
      _calcCamp();
    }
  }

  function _showTypeFields(type) {
    $("paraFields").style.display = (type === "para") ? "" : "none";
    $("campFields").style.display = (type === "camp") ? "" : "none";
  }

  function _setModalBadge(type) {
    const badge = $("modalBadge");
    badge.textContent = type === "para" ? "パラ" : "キャンプ";
    badge.className   = type === "para"
      ? "exp-modal-badge"
      : "exp-modal-badge exp-modal-badge--camp";
  }

  /* ════════════════════════════════════════
     保存
  ════════════════════════════════════════ */
  async function saveResv() {
    if (!$("fResvDate").value) { toast("予約日を入力してください", "error"); return; }
    if (!$("fName").value.trim()) { toast("名前を入力してください", "error"); return; }

    const type = S.editingId
      ? (document.querySelector(".exp-modal-badge")?.textContent === "キャンプ" ? "camp" : "para")
      : S.type;

    const body = {
      reservation_type: type,
      reservation_date: $("fResvDate").value,
      name:             $("fName").value.trim(),
      phone:            $("fPhone").value.trim(),
      staff:            $("fStaff").value,
      memo:             $("fMemo").value.trim(),
      charge_amount:    parseInt($("fCharge").value) || 0,
      cancelled:        $("fCancelled").checked,
    };

    if (type === "para") {
      body.para = {
        pax_count:       parseInt($("fPax").value) || 1,
        course:          $("fCourse").value,
        meeting_time:    $("fMeetingTime").value,
        short_time:      $("fShortTime").value,
        booking_site:    $("fBookingSite").value,
        payment_method:  $("fPayment").value,
        ticket_detail:   $("fTicket").value,
        insurance_fee:   parseInt($("fInsurance").value) || 0,
        point_discount:  parseInt($("fPoint").value) || 0,
        coupon_discount: parseInt($("fCoupon").value) || 0,
        upgrade:         $("fUpgrade").checked,
        shuttle:         $("fShuttle").checked,
      };
    } else {
      body.camp = {
        site_type:      document.querySelector('input[name="site_type"]:checked')?.value || "",
        adult_count:    parseInt($("fAdult").value) || 0,
        child_count:    parseInt($("fChild").value) || 0,
        tent_count:     parseInt($("fTent").value)  || 0,
        tarp_count:     parseInt($("fTarp").value)  || 0,
        vehicle1_type:  $("fV1Type").value,
        vehicle1_count: parseInt($("fV1Count").value) || 0,
        vehicle2_type:  $("fV2Type").value,
        vehicle2_count: parseInt($("fV2Count").value) || 0,
        vehicle3_type:  $("fV3Type").value,
        vehicle3_count: parseInt($("fV3Count").value) || 0,
      };
    }

    try {
      if (S.editingId) {
        await apiPut(`/api/exp/reservations/${S.editingId}`, body);
        toast("更新しました");
      } else {
        const res = await apiPost("/api/exp/reservations", body);
        toast(`予約番号 ${type === "para" ? "P" : "C"}-${String(res.reservation_no).padStart(4,"0")} で登録しました`);
      }
      closeModal();
      loadList();
      loadCalendar();
    } catch (e) {
      toast("保存に失敗: " + e.message, "error");
    }
  }

  /* ════════════════════════════════════════
     公開
  ════════════════════════════════════════ */
  return { init };

})();

document.addEventListener("DOMContentLoaded", () => ExpApp.init());
