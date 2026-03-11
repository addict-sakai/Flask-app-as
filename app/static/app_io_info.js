/**
 * app_io_info.js  –  入下山管理ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 *
 * 変更点 (v3):
 *  - 分類フィルター選択 → 当日・当月にリセットして日別表示に戻る
 *  - カレンダー表示も現在のフィルター（分類/山チン/備考/個人）に連動
 *  - カレンダーに月合計人数を表示
 */

const InfoApp = (() => {

  /* ════════════════════════════════════════
     状態管理
  ════════════════════════════════════════ */
  const S = {
    currentDate:    new Date(),
    calYear:        new Date().getFullYear(),
    calMonth:       new Date().getMonth() + 1,
    classFilter:    "all",        // 分類フィルター: all|会員|スクール|ビジター
    mode:           "daily",      // "daily" | "special"
    specialType:    "all",        // "all"|"yamachin"|"comment"|"member"
    specialPeriod:  "3m",
    memberQuery:    "",
    editingId:      null,
    calPopupOpen:   false,
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
     現在の全フィルター状態を反映する
  ════════════════════════════════════════ */
  function _calendarUrl() {
    let url = `/api/io/info/calendar?year=${S.calYear}&month=${S.calMonth}`;
    url += `&type=${S.specialType}`;
    url += `&period=${S.specialPeriod}`;
    url += `&filter=${encodeURIComponent(S.classFilter)}`;
    if (S.specialType === "member" && S.memberQuery) {
      url += `&query=${encodeURIComponent(S.memberQuery)}`;
    }
    return url;
  }

  /* ════════════════════════════════════════
     カレンダー サマリーラベル更新
  ════════════════════════════════════════ */
  function _updateCalSummaryLabel() {
    const labels  = { all: "合計", yamachin: "山チン合計", comment: "備考あり合計", member: "個人合計" };
    const classLb = S.classFilter !== "all" ? `（${S.classFilter}）` : "";
    const typeLb  = labels[S.specialType] ?? "合計";
    $("calSummaryLabel").textContent = typeLb + classLb;
  }

  /* ════════════════════════════════════════
     初期化
  ════════════════════════════════════════ */
  function init() {
    _bindSidebar();
    _bindDateNav();
    _bindMonthNav();
    _bindDetailModal();
    _bindCalPopup();
    loadDailyView();
    loadCalendar();
  }

  /* ════════════════════════════════════════
     サイドバー イベント
  ════════════════════════════════════════ */
  function _bindSidebar() {

    // ── 分類フィルター：当日・当月にリセットして日別に戻る ──
    document.querySelectorAll(".sf-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sf-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        S.classFilter  = btn.dataset.filter;

        // 特殊フィルターをリセット → 通常の分類フィルター表示に
        S.specialType  = "all";
        S.specialPeriod= "3m";
        S.memberQuery  = "";
        document.querySelectorAll(".sp-btn").forEach(b => b.classList.remove("active"));

        // 当日・当月にリセット
        S.currentDate = new Date(TODAY);
        S.calYear     = TODAY.getFullYear();
        S.calMonth    = TODAY.getMonth() + 1;

        _returnToDaily();
        loadCalendar();
      });
    });

    // ── 山チン・備考 期間ボタン（分類フィルター無視でALL表示） ──
    document.querySelectorAll(".sp-btn[data-type]").forEach(btn => {
      btn.addEventListener("click", () => {
        const type   = btn.dataset.type;
        const period = btn.dataset.period;

        document.querySelectorAll(`.sp-btn[data-type="${type}"]`)
          .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        S.specialType   = type;
        S.specialPeriod = period;
        // 山チン・備考はクラスフィルターを適用しない
        loadSpecialFilter(type, period, "", "all");
        loadCalendar();
      });
    });

    // ── 個人 期間ボタン（クリックで即検索） ──
    document.querySelectorAll("#memberPeriodGroup .sp-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const q = $("memberQueryInput").value.trim();
        if (!q) {
          toast("会員番号またはQRコードを入力してください", "error");
          return;
        }
        document.querySelectorAll("#memberPeriodGroup .sp-btn")
          .forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        S.memberQuery   = q;
        S.specialType   = "member";
        S.specialPeriod = btn.dataset.period;
        loadSpecialFilter("member", btn.dataset.period, q, S.classFilter);
        loadCalendar();
      });
    });

    // Enter で個人検索
    $("memberQueryInput").addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const active = document.querySelector("#memberPeriodGroup .sp-btn.active");
      if (active) active.click();
      else toast("期間ボタン（3ヶ月/半年/1年）を選択してください", "error");
    });
  }

  /* ─── 日別表示に戻る（内部用） ──────────────────────────── */
  function _returnToDaily() {
    S.mode = "daily";
    $("filterLabelBar").style.display = "none";
    $("col-date").style.display       = "none";
    loadDailyView();
  }

  /* ════════════════════════════════════════
     日付ナビ
  ════════════════════════════════════════ */
  function _bindDateNav() {
    $("btnPrevDay").addEventListener("click", () => {
      S.currentDate.setDate(S.currentDate.getDate() - 1);
      // カレンダーの月も合わせる
      S.calYear  = S.currentDate.getFullYear();
      S.calMonth = S.currentDate.getMonth() + 1;
      _returnToDaily();
      loadCalendar();
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
  }

  function _updateDateNav() {
    $("dateNavTitle").textContent = formatDateJP(S.currentDate);
    $("btnNextDay").disabled      = isSameDay(S.currentDate, TODAY);
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
      (S.calYear > now.getFullYear());
  }

  /* ════════════════════════════════════════
     日別ビュー ロード
  ════════════════════════════════════════ */
  async function loadDailyView() {
    S.mode = "daily";
    _updateDateNav();
    $("filterLabelBar").style.display = "none";
    $("col-date").style.display       = "none";

    const dateStr = dateToISO(S.currentDate);
    try {
      const data = await apiFetch(
        `/api/io/info/daily?date=${dateStr}&filter=${encodeURIComponent(S.classFilter)}`
      );
      _renderDailyTable(data.records, false);
      _updateStats(data.total, data.in_count, data.out_count);
    } catch (e) {
      toast("データの取得に失敗しました: " + e.message, "error");
    }
  }

  /* ════════════════════════════════════════
     特殊フィルター ロード
  ════════════════════════════════════════ */
  async function loadSpecialFilter(type, period, memberQuery = "", classFilter = S.classFilter) {
    S.mode = "special";
    _updateDateNav();

    const labels  = { yamachin: "山チン", comment: "備考あり", member: "個人" };
    const periods = { "3m": "過去3ヶ月", "6m": "過去半年", "1y": "過去1年" };
    const nameStr = type === "member"
      ? `個人（${esc(memberQuery)}）`
      : labels[type] ?? type;

    $("filterLabelText").textContent  = `${nameStr} ／ ${periods[period] ?? period}`;
    $("filterLabelBar").style.display = "block";
    $("col-date").style.display       = "";

    let url = `/api/io/info/special?type=${type}&period=${period}&filter=${encodeURIComponent(classFilter)}`;
    if (type === "member" && memberQuery) url += `&query=${encodeURIComponent(memberQuery)}`;

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

    if (!records || records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="info-empty">
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
      if (e.key === "Escape") {
        if (S.calPopupOpen) closeCalPopup();
        else closeDetailModal();
      }
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

    $("detYamachin").checked = !!r.yamachin;
    $("detComment").value    = r.comment ?? "";

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
      yamachin: $("detYamachin").checked,
      comment:  $("detComment").value.trim(),
    };
    try {
      await apiPut(`/api/io/info/record/${S.editingId}`, payload);
      toast("保存しました");
      closeDetailModal();
      if (S.mode === "daily") {
        loadDailyView();
      } else {
        const cf = S.specialType === "member" ? S.classFilter : "all";
        loadSpecialFilter(S.specialType, S.specialPeriod, S.memberQuery, cf);
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
      // 月合計表示
      $("calMonthTotal").textContent = data.month_total ?? "—";
    } catch (e) {
      toast("カレンダーの取得に失敗しました: " + e.message, "error");
    }
  }

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
      cell.className = [
        "cal-day",
        dayData   ? "cal-day--has-records" : "",
        isToday   ? "cal-day--today"       : "",
        dow === 0 ? "cal-day--sun"         : "",
        dow === 6 ? "cal-day--sat"         : "",
      ].filter(Boolean).join(" ");

      const numEl = document.createElement("div");
      numEl.className   = "cal-day-num";
      numEl.textContent = d;
      cell.appendChild(numEl);

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

        cell.addEventListener("click", () => openCalPopup(dateISO));
      }

      grid.appendChild(cell);
    }
  }

  /* ════════════════════════════════════════
     カレンダーポップアップ
  ════════════════════════════════════════ */
  function _bindCalPopup() {
    $("btnCalPopupClose").addEventListener("click", closeCalPopup);
    $("calPopupOverlay").addEventListener("click", e => {
      if (e.target === $("calPopupOverlay")) closeCalPopup();
    });
  }

  async function openCalPopup(dateISO) {
    // 現在のフィルター状態をすべてAPIに渡す
    let url = `/api/io/info/date-members?date=${dateISO}`;
    url += `&type=${S.specialType}`;
    url += `&filter=${encodeURIComponent(S.classFilter)}`;
    if (S.specialType === "member" && S.memberQuery) {
      url += `&query=${encodeURIComponent(S.memberQuery)}`;
    }

    let data;
    try {
      data = await apiFetch(url);
    } catch (e) {
      toast("データの取得に失敗しました: " + e.message, "error");
      return;
    }
    _renderCalPopup(dateISO, data.members);

    const overlay = $("calPopupOverlay");
    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    document.body.style.overflow = "hidden";
    S.calPopupOpen = true;
  }

  function closeCalPopup() {
    const overlay = $("calPopupOverlay");
    overlay.classList.remove("is-visible");
    setTimeout(() => { overlay.style.display = "none"; }, 200);
    document.body.style.overflow = "";
    S.calPopupOpen = false;
  }

  function _renderCalPopup(dateISO, members) {
    const d     = new Date(dateISO + "T00:00:00");
    const wdays = ["日", "月", "火", "水", "木", "金", "土"];
    $("calPopupDate").textContent =
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${wdays[d.getDay()]}）`;

    const body = $("calPopupBody");
    body.innerHTML = "";

    if (!members || members.length === 0) {
      body.innerHTML = `<p class="cal-popup-empty">記録がありません</p>`;
      return;
    }

    members.forEach(m => {
      const row = document.createElement("div");
      row.className = "cal-popup-row";

      const statusBadge = m.status === "入山中"
        ? `<span class="cal-popup-badge cal-popup-badge--in">入山中</span>`
        : `<span class="cal-popup-badge cal-popup-badge--out">下山済</span>`;

      const yamaBadge = m.yamachin
        ? `<span class="cal-popup-badge cal-popup-badge--yama">山チン</span>`
        : "";

      row.innerHTML = `
        <div class="cal-popup-name">${esc(m.full_name)}</div>
        <div class="cal-popup-meta">${esc(m.member_class ?? "—")} / ${esc(m.course_name ?? "—")}</div>
        ${statusBadge}
        ${yamaBadge}
      `;

      // 行クリック → ポップアップを閉じて詳細モーダルを開く
      row.addEventListener("click", () => {
        closeCalPopup();
        setTimeout(() => openDetailModal(m), 220);
      });

      body.appendChild(row);
    });
  }

  /* ════════════════════════════════════════
     公開インターフェース
  ════════════════════════════════════════ */
  return { init };

})();

document.addEventListener("DOMContentLoaded", () => InfoApp.init());
