/**
 * app_io_info.js  –  入下山管理ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 *
 * 変更点 (v6 / 2026-03-25):
 *  - カレンダー日付クリック → ポップアップ廃止
 *    ・クリックした日付を S.currentDate にセット
 *    ・リスト（日別テーブル）にその日の入下山者を日付列付きで表示
 *    ・クリックしたカレンダーマスに cal-day--selected クラスを付与
 *  - 日付ナビ（前日/翌日/当日）変更時も _updateCalFocus() で
 *    カレンダーの選択マスを連動して移動する
 *  - S.calPopupOpen / _bindCalPopup / openCalPopup / closeCalPopup /
 *    _renderCalPopup をすべて削除
 */

const InfoApp = (() => {

  /* ════════════════════════════════════════
     状態管理
  ════════════════════════════════════════ */
  const S = {
    currentDate:   new Date(),
    calYear:       new Date().getFullYear(),
    calMonth:      new Date().getMonth() + 1,
    classFilter:   "all",
    mode:          "daily",   // "daily" | "special"
    specialType:   "all",
    specialPeriod: "3m",
    memberQuery:   "",
    memberUUID:    "",
    chkYamachin:   false,
    chkComment:    false,
    editingId:     null,
    suggestTimer:  null,
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

  function dateToISO(d) {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dy}`;
  }

  function formatDateJP(d) {
    const wdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${wdays[d.getDay()]}）`;
  }

  function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth()    === d2.getMonth()    &&
           d1.getDate()     === d2.getDate();
  }

  async function apiFetch(url) {
    const res  = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiPut(url, body) {
    const res = await fetch(url, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
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
     カレンダー用 URL 生成
  ════════════════════════════════════════ */
  function _calendarUrl() {
    let url = `/api/io/info/calendar?year=${S.calYear}&month=${S.calMonth}`;
    url += `&type=${S.specialType}`;
    url += `&period=${S.specialPeriod}`;
    url += `&filter=${encodeURIComponent(S.classFilter)}`;
    if (S.specialType.startsWith("member") && S.memberQuery) {
      url += `&query=${encodeURIComponent(S.memberQuery)}`;
      if (S.memberUUID) url += `&uuid=${encodeURIComponent(S.memberUUID)}`;
    }
    return url;
  }

  /* ════════════════════════════════════════
     カレンダーサマリーラベル
  ════════════════════════════════════════ */
  function _updateCalSummaryLabel() {
    const typeLabel = {
      all:                 "合計",
      yamachin:            "山チン合計",
      comment:             "備考あり合計",
      member:              "個人合計",
      member_yamachin:     "個人（山チン）合計",
      member_comment:      "個人（備考あり）合計",
      member_yama_comment: "個人（山チン・備考）合計",
    };
    const classLabel = {
      all:"", 年会員:"（年会員）", 冬季会員:"（冬季会員）",
      スクール:"（スクール）", ビジター:"（ビジター）",
      yamachin:"", comment:"", member:"",
    };
    const tl = typeLabel[S.specialType] ?? "合計";
    const cl = classLabel[S.classFilter] ?? "";
    $("calSummaryLabel").textContent = tl + cl;
  }

  /* ════════════════════════════════════════
     初期化
  ════════════════════════════════════════ */
  function init() {
    _bindFilterSelect();
    _bindMemberPanel();
    _bindDateNav();
    _bindMonthNav();
    _bindDetailModal();
    loadDailyView();
    loadCalendar();
  }

  /* ════════════════════════════════════════
     分類フィルター（select）
  ════════════════════════════════════════ */
  function _bindFilterSelect() {
    $("classFilterSelect").addEventListener("change", e => {
      const val = e.target.value;
      S.classFilter = val;

      // 当日・当月にリセット
      S.currentDate = new Date(TODAY);
      S.calYear     = TODAY.getFullYear();
      S.calMonth    = TODAY.getMonth() + 1;

      if (val === "member") {
        $("memberSearchPanel").style.display = "flex";
        S.specialType   = "member";
        S.specialPeriod = $("memberPeriodSelect").value;
        S.memberQuery   = "";
        S.memberUUID    = "";
        _hideMemberSuggest();
        $("memberNameInput").value = "";
        _hideFilterLabel();
        $("col-date").style.display = "none";
        _renderDailyTable([], false);
        _updateStats(0, null, null);
        _updateDateNav();

      } else if (val === "yamachin" || val === "comment") {
        $("memberSearchPanel").style.display = "none";
        S.specialType   = val;
        S.specialPeriod = "all";
        S.memberQuery   = "";
        S.memberUUID    = "";
        loadSpecialAll(val);
        loadCalendar();

      } else {
        $("memberSearchPanel").style.display = "none";
        S.specialType   = "all";
        S.specialPeriod = "3m";
        S.memberQuery   = "";
        S.memberUUID    = "";
        _returnToDaily();
        loadCalendar();
      }
    });
  }

  /* ════════════════════════════════════════
     個人検索パネル
  ════════════════════════════════════════ */
  function _bindMemberPanel() {
    const nameInput = $("memberNameInput");
    const periodSel = $("memberPeriodSelect");
    const chkYama   = $("chkMemberYamachin");
    const chkCmt    = $("chkMemberComment");

    nameInput.addEventListener("input", () => {
      clearTimeout(S.suggestTimer);
      const q = nameInput.value.trim();
      if (q.length < 1) { _hideMemberSuggest(); return; }
      S.suggestTimer = setTimeout(() => _fetchSuggest(q), 260);
    });

    nameInput.addEventListener("keydown", e => {
      if (e.key === "Enter")  { _hideMemberSuggest(); _runMemberSearch(); }
      if (e.key === "Escape") { _hideMemberSuggest(); }
    });

    periodSel.addEventListener("change", () => {
      S.specialPeriod = periodSel.value;
      if (S.memberQuery) _runMemberSearch();
    });

    chkYama.addEventListener("change", () => {
      S.chkYamachin = chkYama.checked;
      if (S.memberQuery) _runMemberSearch();
    });
    chkCmt.addEventListener("change", () => {
      S.chkComment = chkCmt.checked;
      if (S.memberQuery) _runMemberSearch();
    });

    document.addEventListener("click", e => {
      if (!$("memberSearchPanel")?.contains(e.target)) {
        _hideMemberSuggest();
      }
    });
  }

  async function _fetchSuggest(q) {
    try {
      const data = await apiFetch(`/api/io/info/member_suggest?q=${encodeURIComponent(q)}`);
      _showSuggest(data.members || []);
    } catch {
      _hideMemberSuggest();
    }
  }

  function _showSuggest(list) {
    const ul = $("memberSuggest");
    ul.innerHTML = "";
    if (list.length === 0) { ul.style.display = "none"; return; }
    list.forEach(m => {
      const li = document.createElement("li");
      li.className   = "ms-suggest-item";
      li.textContent = m.full_name + (m.member_number ? `（${m.member_number}）` : "");
      li.addEventListener("mousedown", e => {
        e.preventDefault();
        $("memberNameInput").value = m.full_name;
        S.memberQuery = m.full_name;
        S.memberUUID  = m.uuid || "";
        _hideMemberSuggest();
        _runMemberSearch();
      });
      ul.appendChild(li);
    });
    ul.style.display = "block";
  }

  function _hideMemberSuggest() {
    const ul = $("memberSuggest");
    if (ul) ul.style.display = "none";
  }

  function _runMemberSearch() {
    const q = $("memberNameInput").value.trim();
    if (!q) { toast("氏名を入力してください", "error"); return; }

    S.memberQuery   = q;
    S.specialPeriod = $("memberPeriodSelect").value;
    S.chkYamachin   = $("chkMemberYamachin").checked;
    S.chkComment    = $("chkMemberComment").checked;

    let subtype;
    if      (S.chkYamachin && S.chkComment) subtype = "member_yama_comment";
    else if (S.chkYamachin)                 subtype = "member_yamachin";
    else if (S.chkComment)                  subtype = "member_comment";
    else                                    subtype = "member";

    S.specialType = subtype;
    loadSpecialFilter(subtype, S.specialPeriod, q);
    loadCalendar();
  }

  function _returnToDaily() {
    S.mode = "daily";
    _hideFilterLabel();
    $("col-date").style.display = "none";
    loadDailyView();
  }

  function _hideFilterLabel() {
    $("filterLabelBar").style.display = "none";
  }

  /* ════════════════════════════════════════
     日付ナビ
  ════════════════════════════════════════ */
  function _bindDateNav() {

    $("btnPrevDay").addEventListener("click", () => {
      S.currentDate.setDate(S.currentDate.getDate() - 1);
      S.calYear  = S.currentDate.getFullYear();
      S.calMonth = S.currentDate.getMonth() + 1;
      _returnToDaily();        // リストを更新
      loadCalendar();          // カレンダー月が変わる場合は再描画
    });

    $("btnNextDay").addEventListener("click", () => {
      if (!isSameDay(S.currentDate, TODAY)) {
        S.currentDate.setDate(S.currentDate.getDate() + 1);
        S.calYear  = S.currentDate.getFullYear();
        S.calMonth = S.currentDate.getMonth() + 1;
        _returnToDaily();
        loadCalendar();
      }
    });

    $("btnToday").addEventListener("click", () => {
      if (isSameDay(S.currentDate, TODAY)) return;

      S.currentDate = new Date(TODAY);
      S.calYear     = TODAY.getFullYear();
      S.calMonth    = TODAY.getMonth() + 1;

      const cf = S.classFilter;
      if (cf === "yamachin" || cf === "comment") {
        loadSpecialAll(cf);
      } else if (cf === "member") {
        if (S.memberQuery) _runMemberSearch();
        else {
          _hideFilterLabel();
          $("col-date").style.display = "none";
          _renderDailyTable([], false);
          _updateStats(0, null, null);
        }
      } else {
        _returnToDaily();
      }
      _updateDateNav();
      loadCalendar();
    });
  }

  /* ─── 日付ナビ UI 更新 ───────────────────────────────── */
  function _updateDateNav() {
    $("dateNavTitle").textContent = formatDateJP(S.currentDate);
    $("btnNextDay").disabled = isSameDay(S.currentDate, TODAY);
    $("btnToday").disabled   = isSameDay(S.currentDate, TODAY);
  }

  /* ─── カレンダーのフォーカスを currentDate のマスに移動 ── */
  function _updateCalFocus() {
    // 前の選択を解除
    document.querySelectorAll(".cal-day--selected").forEach(el => {
      el.classList.remove("cal-day--selected");
    });

    // 表示中の月と currentDate が一致する場合のみハイライト
    const iso = dateToISO(S.currentDate);
    const cell = document.querySelector(`.cal-day[data-date="${iso}"]`);
    if (cell) {
      cell.classList.add("cal-day--selected");
      // スクロールしてセルを見えるところに
      cell.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /* ════════════════════════════════════════
     月ナビ
  ════════════════════════════════════════ */
  function _bindMonthNav() {
    $("btnPrevMonth").addEventListener("click", () => {
      S.calMonth--;
      if (S.calMonth < 1) { S.calMonth = 12; S.calYear--; }
      loadCalendar();
    });
    $("btnNextMonth").addEventListener("click", () => {
      const now = new Date();
      if (S.calYear < now.getFullYear() ||
          (S.calYear === now.getFullYear() && S.calMonth < now.getMonth() + 1)) {
        S.calMonth++;
        if (S.calMonth > 12) { S.calMonth = 1; S.calYear++; }
        loadCalendar();
      }
    });
  }

  function _updateMonthNav() {
    $("monthNavTitle").textContent = `${S.calYear}年${S.calMonth}月`;
    const now = new Date();
    $("btnNextMonth").disabled =
      (S.calYear === now.getFullYear() && S.calMonth >= now.getMonth() + 1) ||
      S.calYear > now.getFullYear();
  }

  /* ════════════════════════════════════════
     日別ビュー ロード（項3）
  ════════════════════════════════════════ */
  async function loadDailyView() {
    S.mode = "daily";
    _updateDateNav();
    _hideFilterLabel();
    $("col-date").style.display = "none";

    const filterVal = ["all","年会員","冬季会員","スクール","ビジター"].includes(S.classFilter)
      ? S.classFilter : "all";
    const dateStr = dateToISO(S.currentDate);

    try {
      const data = await apiFetch(
        `/api/io/info/daily?date=${dateStr}&filter=${encodeURIComponent(filterVal)}`
      );
      _renderDailyTable(data.records, false);
      _updateStats(data.total, data.in_count, data.out_count);
    } catch (e) {
      toast("データの取得に失敗しました: " + e.message, "error");
    }
    // リスト更新後にカレンダーフォーカスも更新
    _updateCalFocus();
  }

  /* ════════════════════════════════════════
     山チン / 備考あり：全件表示（項2）
  ════════════════════════════════════════ */
  async function loadSpecialAll(type) {
    S.mode          = "special";
    S.specialType   = type;
    S.specialPeriod = "all";
    _updateDateNav();

    const labelMap = { yamachin: "山チン　全期間", comment: "備考あり　全期間" };
    $("filterLabelText").textContent  = labelMap[type] ?? type;
    $("filterLabelBar").style.display = "block";
    $("col-date").style.display       = "";

    try {
      const data = await apiFetch(
        `/api/io/info/special?type=${encodeURIComponent(type)}&period=all&filter=all`
      );
      _renderDailyTable(data.records, true);
      _updateStats(data.count, null, null);
    } catch (e) {
      toast("フィルター取得に失敗しました: " + e.message, "error");
    }
  }

  /* ════════════════════════════════════════
     特殊フィルター ロード（個人系: 項5〜8）
  ════════════════════════════════════════ */
  async function loadSpecialFilter(type, period, memberQuery = "") {
    S.mode = "special";
    _updateDateNav();

    const periodLabel = {
      all: "全期間", "3m": "過去３か月", "6m": "過去半年", "1y": "過去１年",
    };
    const pl = periodLabel[period] ?? period;
    let labelStr;
    if      (type === "member")             labelStr = `個人（${esc(memberQuery)}） ／ ${pl}`;
    else if (type === "member_yamachin")    labelStr = `個人（${esc(memberQuery)}）山チンあり ／ ${pl}`;
    else if (type === "member_comment")     labelStr = `個人（${esc(memberQuery)}）備考あり ／ ${pl}`;
    else if (type === "member_yama_comment")labelStr = `個人（${esc(memberQuery)}）山チン or 備考あり ／ ${pl}`;
    else                                    labelStr = type;

    $("filterLabelText").textContent  = labelStr;
    $("filterLabelBar").style.display = "block";
    $("col-date").style.display       = "";

    let url = `/api/io/info/special?type=${encodeURIComponent(type)}&period=${encodeURIComponent(period)}&filter=all`;
    if (memberQuery) url += `&query=${encodeURIComponent(memberQuery)}`;
    if (S.memberUUID) url += `&uuid=${encodeURIComponent(S.memberUUID)}`;

    try {
      const data = await apiFetch(url);
      _renderDailyTable(data.records, true);
      _updateStats(data.count, null, null);
    } catch (e) {
      toast("フィルター取得に失敗しました: " + e.message, "error");
    }
  }

  /* ════════════════════════════════════════
     テーブル描画
  ════════════════════════════════════════ */
  function _renderDailyTable(records, showDate) {
    const tbody = $("dailyTbody");
    tbody.innerHTML = "";
    $("col-date").style.display = showDate ? "" : "none";

    if (!records || records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="info-empty">
            <div class="info-empty-icon">🪂</div>
            記録がありません
          </td>
        </tr>`;
      return;
    }

    records.forEach(r => {
      const tr = document.createElement("tr");

      const statusChip = r.status === "入山中"
        ? `<span class="status-chip status-chip--in">入山中</span>`
        : `<span class="status-chip status-chip--out">下山済</span>`;

      const yamachinMark = r.yamachin
        ? `<span class="mark-yamachin">⚠</span>`
        : `<span class="mark-none">—</span>`;

      const nyuzanMark = r.entrance_fee_paid
        ? `<span class="mark-nyuzan mark-nyuzan--paid">✔</span>`
        : `<span class="mark-nyuzan mark-nyuzan--unpaid">未</span>`;

      const commentMark = r.comment
        ? `<span class="mark-comment">💬</span>`
        : `<span class="mark-none">—</span>`;

      const dateTd = showDate
        ? `<td class="info-td-mono">${esc(r.entry_date ?? "")}</td>`
        : `<td style="display:none;"></td>`;

      tr.innerHTML = `
        ${dateTd}
        <td class="info-td-name">${esc(r.full_name)}</td>
        <td class="info-td-dim">${esc(r.member_class ?? "—")}</td>
        <td class="info-td-dim">${esc(r.course_name ?? "—")}</td>
        <td>${esc(r.glider_name ?? "—")}</td>
        <td>${statusChip}</td>
        <td>${nyuzanMark}</td>
        <td>${yamachinMark}</td>
        <td>${commentMark}</td>
      `;

      tr.addEventListener("click", () => openDetailModal(r));
      tbody.appendChild(tr);
    });
  }

  function _updateStats(total, inCnt, outCnt) {
    $("stat-total").textContent = total  ?? "—";
    $("stat-in").textContent    = inCnt  ?? "—";
    $("stat-out").textContent   = outCnt ?? "—";
  }

  /* ════════════════════════════════════════
     詳細モーダル
  ════════════════════════════════════════ */
  function _bindDetailModal() {
    $("btnDetailClose").addEventListener("click",  closeDetailModal);
    $("btnDetailCancel").addEventListener("click", closeDetailModal);
    $("btnDetailSave").addEventListener("click",   saveDetail);
    $("detailOverlay").addEventListener("click", e => {
      if (e.target === $("detailOverlay")) closeDetailModal();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeDetailModal();
    });
  }

  function openDetailModal(r) {
    S.editingId = r.id;

    $("det-class").textContent        = r.member_class   ?? "";
    $("det-name").textContent         = r.full_name      ?? "—";
    $("det-number").textContent       = r.member_number  ?? "—";
    $("det-course").textContent       = r.course_name    ?? "—";
    $("det-glider").textContent       = r.glider_name    ?? "—";
    $("det-glider-color").textContent = r.glider_color   ?? "—";
    $("det-insurance").textContent    = r.insurance_type ?? "—";
    $("det-radio").textContent        = r.radio_type     ?? "—";
    $("det-license").textContent      = r.license        ?? "—";
    $("det-reglimit").textContent     = r.reglimit_date  ?? "—";
    $("det-repack").textContent       = r.repack_date    ?? "—";
    $("det-date").textContent         = r.entry_date     ?? "—";

    $("det-in").textContent = r.in_time ?? "—";
    $("det-out").innerHTML  = r.out_time
      ? `<span class="det-chip det-chip--out">${esc(r.out_time)}</span>`
      : `<span style="color:#ccc;">未下山</span>`;

    $("detEntranceFeePaid").checked   = !!r.entrance_fee_paid;
    $("detYamachinConfirmed").checked = !!r.yamachin_confirmed;
    $("detYamachin").checked          = !!r.yamachin;
    $("detComment").value             = r.comment ?? "";

    const overlay = $("detailOverlay");
    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    document.body.style.overflow = "hidden";
  }

  function closeDetailModal() {
    const overlay = $("detailOverlay");
    overlay.classList.remove("is-visible");
    setTimeout(() => { overlay.style.display = "none"; }, 220);
    document.body.style.overflow = "";
    S.editingId = null;
  }

  async function saveDetail() {
    if (!S.editingId) return;
    const payload = {
      entrance_fee_paid:  $("detEntranceFeePaid").checked,
      yamachin_confirmed: $("detYamachinConfirmed").checked,
      yamachin:           $("detYamachin").checked,
      comment:            $("detComment").value.trim(),
    };
    try {
      await apiPut(`/api/io/info/record/${S.editingId}`, payload);
      toast("保存しました");
      closeDetailModal();
      if (S.mode === "daily") {
        loadDailyView();
      } else if (S.classFilter === "yamachin" || S.classFilter === "comment") {
        loadSpecialAll(S.classFilter);
      } else {
        loadSpecialFilter(S.specialType, S.specialPeriod, S.memberQuery);
      }
      loadCalendar();
    } catch (e) {
      toast("保存に失敗しました: " + e.message, "error");
    }
  }

  /* ════════════════════════════════════════
     カレンダー
  ════════════════════════════════════════ */
  async function loadCalendar() {
    _updateMonthNav();
    _updateCalSummaryLabel();

    try {
      const data = await apiFetch(_calendarUrl());
      _renderCalendar(data.days);
      $("calMonthTotal").textContent = data.month_total ?? "—";
    } catch (e) {
      toast("カレンダーの取得に失敗しました: " + e.message, "error");
    }
    // カレンダー描画後にフォーカスを当てる
    _updateCalFocus();
  }

  /* ─── カレンダーグリッド描画 ─────────────────────────── */
  function _renderCalendar(days) {
    const grid = $("calendarGrid");
    grid.innerHTML = "";

    const weekdays  = ["日", "月", "火", "水", "木", "金", "土"];
    const wdClasses = ["sun", "", "", "", "", "", "sat"];

    weekdays.forEach((w, i) => {
      const el = document.createElement("div");
      el.className   = `cal-weekday ${wdClasses[i]}`;
      el.textContent = w;
      grid.appendChild(el);
    });

    const firstDay = new Date(S.calYear, S.calMonth - 1, 1);
    const startDow = firstDay.getDay();
    for (let i = 0; i < startDow; i++) {
      const blank = document.createElement("div");
      blank.className = "cal-day cal-day--empty";
      grid.appendChild(blank);
    }

    const lastDay  = new Date(S.calYear, S.calMonth, 0).getDate();
    const todayISO = dateToISO(TODAY);

    for (let d = 1; d <= lastDay; d++) {
      const dateObj = new Date(S.calYear, S.calMonth - 1, d);
      const dateISO = dateToISO(dateObj);
      const dow     = dateObj.getDay();
      const dayData = days[dateISO];
      const isToday = dateISO === todayISO;

      const cell = document.createElement("div");
      // data-date 属性を必ず付与（フォーカス連動で使用）
      cell.dataset.date = dateISO;
      cell.className = [
        "cal-day",
        dayData   ? "cal-day--has-records" : "",
        isToday   ? "cal-day--today"       : "",
        dow === 0 ? "cal-day--sun"         : "",
        dow === 6 ? "cal-day--sat"         : "",
      ].filter(Boolean).join(" ");

      // 日付数字
      const numEl = document.createElement("div");
      numEl.className   = "cal-day-num";
      numEl.textContent = d;
      cell.appendChild(numEl);

      // 入山人数バッジ・山チンドット
      if (dayData && dayData.count > 0) {
        const badge = document.createElement("div");
        badge.className   = "cal-count-badge";
        badge.textContent = `${dayData.count}人`;
        cell.appendChild(badge);

        if (dayData.yamachin_cnt > 0) {
          const dot = document.createElement("div");
          dot.className = "cal-yamachin-dot";
          dot.title     = `山チン ${dayData.yamachin_cnt}件`;
          cell.appendChild(dot);
        }
      }

      /* ── カレンダーマスのクリックイベント ──────────────────
         ・ポップアップは表示しない
         ・その日付を currentDate にセット
         ・通常分類フィルターなら日別リストを更新
         ・山チン/備考あり/個人（special）モードの場合は
           リストはそのまま、フォーカスのみ移動
         ・カレンダー月を日付に合わせて同期
      ──────────────────────────────────────────────────── */
      cell.addEventListener("click", () => {
        // 選択日を更新
        S.currentDate = new Date(dateObj);
        S.calYear     = S.currentDate.getFullYear();
        S.calMonth    = S.currentDate.getMonth() + 1;

        // フォーカス移動（即時）
        document.querySelectorAll(".cal-day--selected").forEach(el => {
          el.classList.remove("cal-day--selected");
        });
        cell.classList.add("cal-day--selected");

        // 日付ナビ表示を更新
        _updateDateNav();

        // リスト更新
        const cf = S.classFilter;
        if (cf === "yamachin" || cf === "comment") {
          // 特殊フィルターは日付に関係なく全件なのでリストは変えない
          // （日付ナビの表示だけ変わる）
        } else if (cf === "member") {
          // 個人モード：リストはそのまま（特定期間の全件表示）
        } else {
          // 通常分類 → その日の日別リストを表示
          S.mode = "daily";
          _hideFilterLabel();
          $("col-date").style.display = "none";

          const filterVal = ["all","年会員","冬季会員","スクール","ビジター"].includes(cf)
            ? cf : "all";

          apiFetch(`/api/io/info/daily?date=${dateToISO(S.currentDate)}&filter=${encodeURIComponent(filterVal)}`)
            .then(data => {
              _renderDailyTable(data.records, false);
              _updateStats(data.total, data.in_count, data.out_count);
            })
            .catch(e => toast("データの取得に失敗しました: " + e.message, "error"));
        }
      });

      grid.appendChild(cell);
    }
  }

  /* ════════════════════════════════════════
     公開インターフェース
  ════════════════════════════════════════ */
  return { init };

})();

document.addEventListener("DOMContentLoaded", () => InfoApp.init());
