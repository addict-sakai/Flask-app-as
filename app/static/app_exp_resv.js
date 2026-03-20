/**
 * app_exp.js  –  体験予約ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const ExpApp = (() => {

  /* ════════════════════════════════════════
     状態管理
  ════════════════════════════════════════ */
  const S = {
    type:        "para",         // "para" | "camp"
    viewMode:    "all",          // "all" | "month" | "date" | "past"
    sortMode:    "reception",    // "reception" | "date_asc" (ALL時のみ選択可)
    monthSortMode: "date_asc",   // 当月・過去表示時のソート: "date_asc" | "date_desc"
    pastRange:   "",             // "" | "3m" | "6m" | "1y"
    filterDate:  "",             // カレンダークリック時の特定日
    calYear:     new Date().getFullYear(),
    calMonth:    new Date().getMonth() + 1,
    showCancel:  false,
    editingId:    null,
    focusedRowId: null,
    config:       {},
    calDays:      {},   // カレンダーデータキャッシュ（パイロット情報含む）
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
    _bindExpAppModal();
    _bindKeyboard();

    // config 一括取得
    try {
      S.config = await apiFetch("/api/exp/config");
      _populateSelects();
    } catch (e) {
      toast("設定データの取得に失敗しました", "error");
    }

    loadList();
    loadCalendar();
    loadUnlinkedCount();
    // 30秒ごとにリアルタイム更新
    setInterval(loadUnlinkedCount, 30000);

    // スタッフ管理画面からの遷移：?id=XX で予約編集モーダルを直接開く
    const _openId = new URLSearchParams(location.search).get("id");
    if (_openId) openModal(Number(_openId));
  }

  /* ════════════════════════════════════════
     ヘッダータブ
  ════════════════════════════════════════ */
  function _bindHeader() {
    document.querySelectorAll(".exp-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".exp-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        S.type       = btn.dataset.type;
        S.viewMode   = "all";
        S.filterDate = "";
        S.pastRange  = "";
        S.sortMode      = "reception";
        S.monthSortMode = "date_asc";
        document.querySelectorAll('input[name="pastRange"]').forEach(r => r.checked = false);
        _updateViewButtons();
        _updateSortVisibility();
        _updateMonthSortButtons();
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
    $("btnExpApp").addEventListener("click", () => {
      if (!$("btnExpApp").disabled) openExpAppModal();
    });

    // ALL / 当月 ボタン
    // 当日ボタン
    const btnViewToday = document.getElementById("btnViewToday");
    if (btnViewToday) {
      btnViewToday.addEventListener("click", () => {
        S.viewMode   = "date";
        S.filterDate = dateToISO(TODAY);
        S.pastRange  = "";
        _updateViewButtons();
        _updateSortVisibility();
        _updateMonthSortButtons();
        _updatePilotBtn();
        _focusCalendarToday();
        loadList();
      });
    }

    $("btnViewAll").addEventListener("click", () => {
      S.viewMode   = "all";
      S.filterDate = "";
      S.pastRange  = "";
      _updateViewButtons();
      _updateSortVisibility();
      _updateMonthSortButtons();
      _focusCalendarToday();
      loadList();
    });

    $("btnViewMonth").addEventListener("click", () => {
      S.viewMode   = "month";
      S.filterDate = "";
      S.pastRange  = "";
      _updateViewButtons();
      _updateSortVisibility();
      _updateMonthSortButtons();
      _focusCalendarToday();
      loadList();
    });

    // ソート（ALL時のみ有効）
    document.querySelectorAll('input[name="sortMode"]').forEach(r => {
      r.addEventListener("change", () => {
        S.sortMode = r.value;
        loadList();
      });
    });

    // 過去範囲
    document.querySelectorAll('input[name="pastRange"]').forEach(r => {
      r.addEventListener("change", () => {
        S.pastRange  = r.value;
        S.viewMode   = r.value ? "past" : "all";
        S.filterDate = "";
        _updateViewButtons();
        _updateSortVisibility();
        _updateMonthSortButtons();
        _focusCalendarToday();
        loadList();
      });
    });

    $("chkShowCancel").addEventListener("change", () => {
      S.showCancel = $("chkShowCancel").checked;
      loadList();
    });

    _updateViewButtons();
    _updateSortVisibility();
    _updateMonthSortButtons();

    // パイロットボタン
    const pilotBtn = document.getElementById("btnStatsPilot");
    if (pilotBtn) {
      pilotBtn.addEventListener("click", () => {
        const dayData = S.calDays[S.filterDate] || {};
        const names   = dayData.pilot_names || [];
        _showPilotPopup(pilotBtn, names, S.filterDate);
      });
    }

    // ソートボタン（ALL: sortMode、当月・過去: monthSortMode）
    ["btnSortReception","btnSortDateAsc","btnSortDateDesc"].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("click", () => {
        const sort = btn.dataset.sort;
        if (S.viewMode === "all") {
          S.sortMode = sort;
        } else {
          S.monthSortMode = sort;
        }
        _updateMonthSortButtons();
        loadList();
      });
    });
  }

  function _updateViewButtons() {
    const todayISO = dateToISO(TODAY);
    const btnToday = document.getElementById("btnViewToday");
    if (btnToday) btnToday.classList.toggle("active", S.viewMode === "date" && S.filterDate === todayISO);
    $("btnViewAll").classList.toggle("active",   S.viewMode === "all");
    $("btnViewMonth").classList.toggle("active", S.viewMode === "month");
    if (S.viewMode !== "past") {
      document.querySelectorAll('input[name="pastRange"]').forEach(r => r.checked = false);
    }
  }

  function _updateSortVisibility() {
    // sortSection は削除済みのため何もしない
  }

  /* カレンダーを当日の月へ移動し、当日セルを選択状態にする */
  function _focusCalendarToday() {
    if (S.calYear !== TODAY.getFullYear() || S.calMonth !== TODAY.getMonth() + 1) {
      S.calYear  = TODAY.getFullYear();
      S.calMonth = TODAY.getMonth() + 1;
      loadCalendar();
    } else {
      document.querySelectorAll(".cal-day--selected")
        .forEach(el => el.classList.remove("cal-day--selected"));
      document.querySelectorAll(".cal-day--today")
        .forEach(el => el.classList.add("cal-day--selected"));
    }
  }

    /* ソートボタングループの表示・アクティブ状態を更新（ALL / 当月 / 過去） */
  function _updateMonthSortButtons() {
    const group   = document.getElementById("statsSortGroup");
    const recBtn  = document.getElementById("btnSortReception");
    if (!group) return;

    const showGroup = (S.viewMode === "all" || S.viewMode === "month" || S.viewMode === "past");
    group.style.display = showGroup ? "" : "none";
    if (!showGroup) return;

    // 「登録順」ボタンは ALL のみ表示
    if (recBtn) recBtn.style.display = (S.viewMode === "all") ? "" : "none";

    // アクティブ状態を更新
    const activeSort = (S.viewMode === "all") ? S.sortMode : S.monthSortMode;
    ["btnSortReception","btnSortDateAsc","btnSortDateDesc"].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle("active", btn.dataset.sort === activeSort);
    });
  }

  /* ════════════════════════════════════════
     ② 未リンク人数（当日・予約番号 null）
  ════════════════════════════════════════ */
  async function loadUnlinkedCount() {
    try {
      const iso  = dateToISO(TODAY);
      const data = await apiFetch(`/api/exp/experience_apps/today?date=${iso}`);
      const items = data.items || [];
      const count = items.filter(it => !it.resv_no || it.resv_no.trim() === "").length;
      _renderUnlinkedBadge(count);
    } catch (e) {
      // 取得失敗時は何も変えない
    }
  }

  function _renderUnlinkedBadge(count) {
    const wrap  = document.getElementById("unlinkedWrap");
    const badge = document.getElementById("unlinkedBadge");
    const btn   = document.getElementById("btnExpApp");
    if (!wrap || !badge || !btn) return;

    wrap.style.display = "";
    if (count > 0) {
      badge.textContent = `未リンク ${count} 名`;
      badge.className   = "unlinked-badge unlinked-badge--warn";
      btn.disabled      = false;
      btn.style.opacity = "";
      btn.style.cursor  = "";
    } else {
      badge.textContent = "未リンク 0 名";
      badge.className   = "unlinked-badge unlinked-badge--zero";
      btn.disabled      = true;
      btn.style.opacity = "0.45";
      btn.style.cursor  = "not-allowed";
    }
  }

  /* ════════════════════════════════════════
     ⑥ 指定日モード：パイロットボタン制御
  ════════════════════════════════════════ */
  function _updatePilotBtn() {
    const btn = document.getElementById("btnStatsPilot");
    if (!btn) return;
    if (S.viewMode === "date" && S.filterDate) {
      const dayData = S.calDays[S.filterDate] || {};
      const pc = dayData.pilot_count || 0;
      btn.textContent  = `🧑‍✈️ ${pc}名`;
      btn.style.display = "";
    } else {
      btn.style.display = "none";
    }
  }

  function _showPilotPopup(anchor, names, dateStr) {
    // 既存ポップアップを削除
    document.querySelectorAll(".pilot-popup").forEach(el => el.remove());

    const pop = document.createElement("div");
    pop.className = "pilot-popup";

    const title = document.createElement("div");
    title.className   = "pilot-popup-title";
    title.textContent = `🧑‍✈️ 出勤可能パイロット（${dateStr}）`;
    pop.appendChild(title);

    if (names.length === 0) {
      const empty = document.createElement("div");
      empty.className   = "pilot-popup-empty";
      empty.textContent = "登録なし";
      pop.appendChild(empty);
    } else {
      names.forEach(name => {
        const item = document.createElement("div");
        item.className   = "pilot-popup-item";
        item.textContent = name;
        pop.appendChild(item);
      });
    }

    // ボタンの真下に表示
    const rect = anchor.getBoundingClientRect();
    pop.style.top  = (rect.bottom + 6) + "px";
    pop.style.left = rect.left + "px";
    document.body.appendChild(pop);

    // 外クリックで閉じる
    setTimeout(() => {
      document.addEventListener("click", function handler(e) {
        if (!pop.contains(e.target) && e.target !== anchor) {
          pop.remove();
          document.removeEventListener("click", handler);
        }
      });
    }, 0);
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
        <th>受付申込</th>
        <th>体験状態</th>
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
        <th>受付申込</th>
        <th>体験状態</th>
      `;
    }
  }

  /* ════════════════════════════════════════
     一覧ロード
  ════════════════════════════════════════ */
  async function loadList() {
    _updateTableHeader();

    const cancel = S.showCancel ? "1" : "0";
    let url  = `/api/exp/reservations?type=${S.type}&show_cancel=${cancel}`;
    let label = "";

    if (S.viewMode === "date" && S.filterDate) {
      // カレンダークリック → 特定日・集合時間順
      url   += `&date=${S.filterDate}&sort=meeting_asc`;
      label  = S.filterDate;

    } else if (S.viewMode === "month") {
      // 当月 → monthSortMode に従う
      const sp = S.monthSortMode === "date_desc" ? "date_desc" : "date_asc";
      url   += `&year=${S.calYear}&month=${S.calMonth}&sort=${sp}`;
      label  = `${S.calYear}年${S.calMonth}月`;

    } else if (S.viewMode === "past" && S.pastRange) {
      // 過去範囲 → monthSortMode に従う
      const today  = dateToISO(TODAY);
      const from   = _pastFromDate(S.pastRange);
      const sp     = S.monthSortMode === "date_desc" ? "date_desc" : "date_asc";
      url   += `&from_date=${from}&to_date=${today}&sort=${sp}`;
      label  = { "3m": "過去3か月", "6m": "過去半年", "1y": "過去1年" }[S.pastRange] || "";

    } else {
      // ALL → sortMode に従う
      let sortParam = "reception_desc";
      if (S.sortMode === "date_asc")  sortParam = "date_asc";
      if (S.sortMode === "date_desc") sortParam = "date_desc";
      url   += `&sort=${sortParam}`;
      label  = "ALL";
    }

    try {
      const data = await apiFetch(url);
      let items = data.items || [];
      // ALLモードは「体験完了」を非表示
      if (S.viewMode === "all") {
        items = items.filter(r => r.status !== "体験完了");
      }
      _renderList(items);
      const total  = items.length;
      const amount = items.reduce((s, r) => s + (r.charge_amount || 0), 0);
      $("statCount").textContent  = total;
      $("statAmount").textContent = amount.toLocaleString();
      $("statLabel").textContent  = label;
      _updateMonthSortButtons();
      _updatePilotBtn();
    } catch (e) {
      toast("一覧の取得に失敗: " + e.message, "error");
    }
  }

  function _pastFromDate(range) {
    const d = new Date(TODAY);
    if (range === "3m") d.setMonth(d.getMonth() - 3);
    else if (range === "6m") d.setMonth(d.getMonth() - 6);
    else if (range === "1y") d.setFullYear(d.getFullYear() - 1);
    return dateToISO(d);
  }


  /* 申込リンク件数バッジ */
  function _appLinkedBadge(r) {
    const n    = r.app_count || 0;
    const pax  = r.reservation_type === "para"
      ? (r.para?.pax_count ?? 0)
      : (r.camp?.adult_count ?? 0);
    if (n === 0) return `<span class="td-chip td-chip--pending">未</span>`;
    const cls  = n >= pax ? "td-chip--done" : "td-chip--ok";
    return `<span class="td-chip ${cls}">${n}名</span>`;
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

      const statusClass = {
        "受付未": "td-chip--pending", "受付済": "td-chip--ok",
        "体験完了": "td-chip--done",  "キャンセル": "td-chip--cancel"
      }[r.status] || "td-chip--pending";
      // 申込バッジ（左）・状況バッジ（右）
      const appCount = r.app_count || 0;
      const appBadge = appCount > 0
        ? `<span class="td-chip td-chip--app">${appCount}名申込済</span>`
        : `<span class="td-chip td-chip--app-none">申込未</span>`;
      const walkinTag = r.walk_in ? `<span class="td-chip td-chip--walkin">飛込</span>` : "";
      const badge = `<span class="td-chip ${statusClass}">${esc(r.status || "受付未")}</span>${walkinTag}`;

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
          <td>${appBadge}</td>
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
          <td>${appBadge}</td>
          <td>${badge}</td>
        `;
      }

      tr.innerHTML = cols;
      tr.dataset.id = r.id;

      // シングルクリック → 編集モーダル
      tr.addEventListener("click", () => {
        document.querySelectorAll("#resvTbody tr.row-focused")
          .forEach(el => el.classList.remove("row-focused"));
        tr.classList.add("row-focused");
        S.focusedRowId = r.id;
        openModal(r.id);
      });

      tbody.appendChild(tr);
    });

    // キーボードナビ（上下キー）
    $("resvTbody").onkeydown = null;  // 再バインド防止
  }

  /* ════════════════════════════════════════
     カレンダー
  ════════════════════════════════════════ */
  function _bindCalendar() {
    $("btnCalPrev").addEventListener("click", () => {
      S.calMonth--;
      if (S.calMonth < 1) { S.calMonth = 12; S.calYear--; }
      S.filterDate = "";
      if (S.viewMode === "date") { S.viewMode = "all"; _updateViewButtons(); _updateSortVisibility(); }
      loadList();
      loadCalendar();
    });
    $("btnCalNext").addEventListener("click", () => {
      S.calMonth++;
      if (S.calMonth > 12) { S.calMonth = 1; S.calYear++; }
      S.filterDate = "";
      if (S.viewMode === "date") { S.viewMode = "all"; _updateViewButtons(); _updateSortVisibility(); }
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
      S.calDays = data.days || {};
      _renderCalendar(S.calDays);
      _updatePilotBtn();
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

      const isSelected = (iso === S.filterDate);

      const cell = document.createElement("div");
      cell.className = [
        "cal-day",
        "cal-day--clickable",                          // 全日付クリック可能
        dayData  ? "cal-day--active"   : "",
        isToday  ? "cal-day--today"    : "",
        isSelected ? "cal-day--selected" : "",
        dow === 0 ? "cal-day--sun"     : "",
        dow === 6 ? "cal-day--sat"     : "",
      ].filter(Boolean).join(" ");

      const numEl = document.createElement("div");
      numEl.className   = "cal-day-num";
      numEl.textContent = d;
      cell.appendChild(numEl);

      // 予約件数バッジ（予約あり日のみ）
      if (dayData && dayData.count > 0) {
        const badge = document.createElement("div");
        badge.className   = `cal-badge${S.type === "camp" ? " cal-badge--camp" : ""}`;
        badge.textContent = `${dayData.count}件`;
        cell.appendChild(badge);
      }

      // パイロット出勤可能人数バッジ（パラタブのみ）
      if (S.type === "para") {
        const pc = dayData ? (dayData.pilot_count || 0) : 0;
        if (pc > 0) {
          const pb = document.createElement("div");
          pb.className   = "cal-pilot-badge";
          pb.textContent = `✈${pc}`;
          cell.appendChild(pb);
        }
      }

      // 全日付クリックで指定日表示（予約なしでも可）
      cell.addEventListener("click", () => {
        // 選択中フォーカスを更新
        document.querySelectorAll(".cal-day--selected")
          .forEach(el => el.classList.remove("cal-day--selected"));
        cell.classList.add("cal-day--selected");

        S.filterDate = iso;
        S.viewMode   = "date";
        _updateViewButtons();
        _updateSortVisibility();
        _updatePilotBtn();
        loadList();
      });

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

    _fillSelect($("fBookingSite"), c.para_site ?? [],     true);
    _fillSelect($("fPayment"),     c.para_payment ?? [],  true);
    _fillSelect($("fTicket"),      c.para_ticket ?? [],   true);
    // キャンプ 車両
    _fillSelect($("fV1Type"), c.camp_vehicle ?? [], true);
    _fillSelect($("fV2Type"), c.camp_vehicle ?? [], true);
    _fillSelect($("fV3Type"), c.camp_vehicle ?? [], true);

    // 保険料は config から取得（para_insurance[0].amount）
    const insFromCfg = (c.para_insurance && c.para_insurance[0]) ? Number(c.para_insurance[0].amount || 0) : 0;
    $("fInsurance").dataset.configDefault = insFromCfg;
    $("fInsurance").value = insFromCfg || 0;

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
    // ショート時間は非表示（削除済み）

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
  /* ────── キーボードナビ（テーブル行 上下 + Enter） ────── */
  function _bindKeyboard() {
    document.addEventListener("keydown", e => {
      // モーダルが開いている間は無効
      if ($("resvOverlay").style.display !== "none") return;
      const rows = [...document.querySelectorAll("#resvTbody tr[data-id]")];
      if (!rows.length) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const cur = rows.findIndex(r => r.classList.contains("row-focused"));
        let next = e.key === "ArrowDown" ? cur + 1 : cur - 1;
        next = Math.max(0, Math.min(rows.length - 1, next));
        rows.forEach(r => r.classList.remove("row-focused"));
        rows[next].classList.add("row-focused");
        rows[next].scrollIntoView({ block: "nearest" });
        S.focusedRowId = Number(rows[next].dataset.id);
      }
      if (e.key === "Enter" && S.focusedRowId) {
        openModal(S.focusedRowId);
      }
    });
  }

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
    $("fEmail").value    = "";
    $("fStaff").value    = "";
    $("fMemo").value     = "";
    $("fCharge").value   = "";
    $("fStatus").value = "受付未";
    $("fWalkIn").checked = false;
    // パラ
    $("fPax").value      = 1;
    $("fCourse").value   = "";
    $("fMeetingTime").value = "";

    $("fBookingSite").value = "";
    $("fPayment").value     = "";
    $("fTicket").value      = "";
    $("fPoint").value    = 0;
    $("fCoupon").value   = 0;
    $("fUpgrade").checked   = false;
    $("fShuttle").checked   = false;

    // 保険料の初期値（configデフォルト値）
    $("fInsurance").value = Number($("fInsurance").dataset?.configDefault || 0);
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
    $("fEmail").value    = data.email || "";
    $("fStaff").value    = data.staff || "";
    $("fMemo").value     = data.memo || "";
    $("fCharge").value   = data.charge_amount || 0;
    $("fStatus").value    = data.status   || "受付未";
    $("fWalkIn").checked  = !!data.walk_in;

    if (type === "para" && data.para) {
      const p = data.para;
      $("fPax").value         = p.pax_count ?? 1;
      $("fCourse").value      = p.course || "";
      $("fMeetingTime").value = p.meeting_time || "";

      $("fBookingSite").value = p.booking_site || "";
      $("fPayment").value     = p.payment_method || "";
      $("fTicket").value      = p.ticket_detail || "";
      $("fInsurance").value   = p.insurance_fee ?? 0;
      $("fPoint").value       = p.point_discount ?? 0;
      $("fCoupon").value      = p.coupon_discount ?? 0;
      $("fUpgrade").checked   = !!p.upgrade;
      $("fShuttle").checked   = !!p.shuttle;

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
      email:            $("fEmail").value.trim(),
      staff:            $("fStaff").value,
      memo:             $("fMemo").value.trim(),
      charge_amount:    parseInt($("fCharge").value) || 0,
      status:           $("fStatus").value,
      walk_in:          $("fWalkIn").checked,
      cancelled:        $("fStatus").value === "キャンセル",
    };

    if (type === "para") {
      body.para = {
        pax_count:       parseInt($("fPax").value) || 1,
        course:          $("fCourse").value,
        meeting_time:    $("fMeetingTime").value,
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
     体験申込 編集モーダル
  ════════════════════════════════════════ */

  /* course_exp の数値コードをコース名に変換 */
  const COURSE_EXP_MAP = {
    "1": "タンデム", "2": "ショート", "3": "セット",
    "tandem": "タンデム", "short": "ショート", "set": "セット",
  };
  function _courseExpLabel(val) {
    if (!val) return "—";
    return COURSE_EXP_MAP[String(val).toLowerCase()] || val;
  }

    /* datalist 入力と保存ボタンの状態を同期 */
  function _syncSaveBtn(inp, saveBtn) {
    const saved = saveBtn.dataset.saved;
    const cur   = inp.value.trim();
    if (cur !== saved) {
      saveBtn.textContent = "保存";
      saveBtn.classList.remove("app-save-btn--saved");
    } else {
      saveBtn.textContent = "保存済";
      saveBtn.classList.add("app-save-btn--saved");
    }
  }

    // 体験申込モーダルの対象日
  const AppModal = {
    date: new Date(),
    todayResvs: [],   // 当日予約一覧（セレクト用）
  };

  function _appDateISO() {
    return dateToISO(AppModal.date);
  }

  function _appDateLabel() {
    const DOW = ["日","月","火","水","木","金","土"];
    const d = AppModal.date;
    const todayISO = dateToISO(new Date());
    const suffix = _appDateISO() === todayISO ? " (今日)" : "";
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} (${DOW[d.getDay()]})${suffix}`;
  }

  async function openExpAppModal() {
    AppModal.date = new Date();
    $("expAppOverlay").style.display = "flex";
    requestAnimationFrame(() => $("expAppOverlay").classList.add("is-visible"));
    document.body.style.overflow = "hidden";
    await _loadAppModal();
  }

  function closeExpAppModal() {
    const overlay = $("expAppOverlay");
    overlay.classList.remove("is-visible");
    setTimeout(() => { overlay.style.display = "none"; }, 220);
    document.body.style.overflow = "";
  }

  function _bindExpAppModal() {
    $("btnAppClose").addEventListener("click",  closeExpAppModal);
    $("btnAppCancel").addEventListener("click", closeExpAppModal);
    $("expAppOverlay").addEventListener("click", e => {
      if (e.target === $("expAppOverlay")) closeExpAppModal();
    });
    $("btnAppPrev").addEventListener("click", async () => {
      AppModal.date.setDate(AppModal.date.getDate() - 1);
      AppModal.date = new Date(AppModal.date); // 参照更新
      await _loadAppModal();
    });
    $("btnAppNext").addEventListener("click", async () => {
      AppModal.date.setDate(AppModal.date.getDate() + 1);
      AppModal.date = new Date(AppModal.date);
      await _loadAppModal();
    });
    $("btnAppToday").addEventListener("click", async () => {
      AppModal.date = new Date();
      await _loadAppModal();
    });
  }

  async function _loadAppModal() {
    $("appDateLabel").textContent = _appDateLabel();
    $("appResultTbody").innerHTML = `<tr><td colspan="6" class="exp-empty">読み込み中…</td></tr>`;
    $("appFooterCount").textContent = "";

    const iso = _appDateISO();

    try {
      // 当日申込一覧 と 当日予約セレクト用 を並行取得
      const [appData, resvData] = await Promise.all([
        apiFetch(`/api/exp/experience_apps/today?date=${iso}`),
        apiFetch(`/api/exp/today_reservations?date=${iso}&type=para`),
      ]);

      AppModal.todayResvs = resvData.items || [];
      const items = appData.items || [];

      $("appFooterCount").textContent = `${items.length} 件`;
      _renderExpApps(items);

    } catch (e) {
      $("appResultTbody").innerHTML = `<tr><td colspan="6" class="exp-empty">取得失敗: ${esc(e.message)}</td></tr>`;
      toast(e.message, "error");
    }
  }

  function _renderExpApps(items) {
    const tbody = $("appResultTbody");
    tbody.innerHTML = "";

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="exp-empty">申込データなし</td></tr>`;
      return;
    }

    items.forEach((item, idx) => {
      const tr = document.createElement("tr");
      const selId     = `rnoSel_${item.id}`;
      const dlId      = `rnoList_${item.id}`;
      const cancelId  = `rnoCancel_${item.id}`;
      const saveId    = `rnoSave_${item.id}`;

      // 予約番号 datalist
      const dlOpts = AppModal.todayResvs.map(rv =>
        `<option value="${esc(rv.resv_no)}">${esc(rv.name)}　${esc(rv.course)}　${rv.pax_count}名</option>`
      ).join("");

      // キャンセル済みかどうか
      const isCancelled = (item.resv_no === "キャンセル");
      const cancelLabel = isCancelled ? "キャンセル済" : "キャンセル";
      const cancelCls   = isCancelled ? "app-cancel-btn app-cancel-btn--done" : "app-cancel-btn";

      tr.innerHTML = `
        <td class="td-dim">${idx + 1}</td>
        <td class="td-name">${esc(item.full_name)}
          <span class="td-dim" style="font-size:.75rem;display:block;">${esc(item.furigana)}</span>
        </td>
        <td class="td-dim" style="font-size:.75rem;">${esc(item.mobile_phone)}</td>
        <td class="td-dim">${esc(_courseExpLabel(item.course_exp))}</td>
        <td>
          <input id="${selId}" list="${dlId}" class="form-input form-input--rno"
                 value="${esc(item.resv_no || "")}" placeholder="— 未選択 —" autocomplete="off" />
          <datalist id="${dlId}">${dlOpts}</datalist>
        </td>
        <td class="app-action-cell">
          <button id="${saveId}" class="exp-btn btn-sm app-save-btn app-save-btn--saved"
                  data-id="${item.id}" data-sel="${selId}" data-saved="${esc(item.resv_no || "")}">保存済</button>
          <button class="${cancelCls} btn-sm"
                  data-id="${item.id}">${cancelLabel}</button>
        </td>
      `;

      const inp     = tr.querySelector(`#${selId}`);
      const saveBtn = tr.querySelector(`#${saveId}`);

      // ── datalist 再編集対応 ────────────────────────────────
      // フォーカス時: 入力を一時クリア → datalist が全件表示される
      inp.addEventListener("focus", () => {
        inp.dataset.prevVal = inp.value;
        inp.value = "";
      });
      // blur 時: 何も選択されていなければ元の値に戻す
      inp.addEventListener("blur", () => {
        setTimeout(() => {
          if (!inp.value.trim()) {
            inp.value = inp.dataset.prevVal || "";
          }
          // 保存ボタン状態を更新
          _syncSaveBtn(inp, saveBtn);
        }, 150); // setTimeout で datalist のクリックを先に処理させる
      });

      // 入力変更 → 保存ボタン状態を更新
      inp.addEventListener("input", () => _syncSaveBtn(inp, saveBtn));

      // 保存ボタン
      saveBtn.addEventListener("click", async () => {
        const appId   = saveBtn.dataset.id;
        const resv_no = inp.value.trim();
        try {
          await apiPut(`/api/exp/experience_apps/${appId}/link`, { resv_no });
          saveBtn.dataset.saved = resv_no;
          saveBtn.textContent   = "保存済";
          saveBtn.classList.add("app-save-btn--saved");
          toast("保存しました");
          loadList(); loadCalendar(); loadUnlinkedCount();
        } catch (err) {
          toast(err.message, "error");
        }
      });

      // キャンセルボタン
      tr.querySelector(".app-cancel-btn").addEventListener("click", async (e) => {
        const appId = e.currentTarget.dataset.id;
        const already = e.currentTarget.classList.contains("app-cancel-btn--done");
        const newVal  = already ? "" : "キャンセル";
        const label   = already ? "キャンセル解除" : "キャンセル";
        if (!already && !confirm(`${item.full_name} をキャンセルにしますか？`)) return;
        try {
          await apiPut(`/api/exp/experience_apps/${appId}/link`, { resv_no: newVal });
          toast(already ? "キャンセルを解除しました" : "キャンセルしました");
          await _loadAppModal();
          loadList(); loadCalendar(); loadUnlinkedCount();
        } catch (err) {
          toast(err.message, "error");
        }
      });

      tbody.appendChild(tr);
    });
  }

  /* ════════════════════════════════════════
     公開
  ════════════════════════════════════════ */
  return { init };

})();

document.addEventListener("DOMContentLoaded", () => ExpApp.init());
