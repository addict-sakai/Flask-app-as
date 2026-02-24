/**
 * app_cont_work.js  –  請負出勤可能予定ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const WorkApp = (() => {

  /* ─── 内部状態 ─── */
  let _memberName   = "";
  let _memberUuid   = "";
  let _memberNumber = "";
  let _schedules    = {};   // { "2026-03-01": "OK" | "NG" | null }

  /* ─── 日本の祝日（固定 + 移動祝日） ─── */
  function _getHolidays(year) {
    const h = {};
    const add = (m, d, name) => { h[`${year}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`] = name; };

    // 固定祝日
    add(1,  1,  "元日");
    add(2,  11, "建国記念の日");
    add(2,  23, "天皇誕生日");
    add(4,  29, "昭和の日");
    add(5,  3,  "憲法記念日");
    add(5,  4,  "みどりの日");
    add(5,  5,  "こどもの日");
    add(8,  11, "山の日");
    add(11, 3,  "文化の日");
    add(11, 23, "勤労感謝の日");

    // ハッピーマンデー（第2月曜など）
    const nthMon = (m, n) => {
      let d = new Date(year, m - 1, 1);
      let count = 0;
      while (true) {
        if (d.getDay() === 1) { count++; if (count === n) break; }
        d.setDate(d.getDate() + 1);
      }
      return d;
    };
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

    h[fmt(nthMon(1, 2))] = "成人の日";
    h[fmt(nthMon(7, 3))] = "海の日";
    h[fmt(nthMon(9, 3))] = "敬老の日";
    h[fmt(nthMon(10,2))] = "スポーツの日";

    // 春分の日・秋分の日（近似式）
    const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    const shubun  = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    add(3, shunbun, "春分の日");
    add(9, shubun,  "秋分の日");

    // 振替休日（祝日が日曜なら翌月曜）
    const extras = {};
    for (const [dateStr, name] of Object.entries(h)) {
      const d = new Date(dateStr);
      if (d.getDay() === 0) {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        extras[fmt(next)] = name + "（振替）";
      }
    }
    return { ...h, ...extras };
  }

  /* ─── 初期化 ─── */
  function init() {
    document.getElementById("search-input").addEventListener("keydown", e => {
      if (e.key === "Enter") lookup();
    });
  }

  /* ─── 会員検索 ─── */
  async function lookup() {
    const query = document.getElementById("search-input").value.trim();
    if (!query) return;

    _clearAll();

    let data;
    try {
      const resp = await fetch("/api/work/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      data = await resp.json();
      if (!resp.ok) {
        _showAlert("search-error", data.error || "会員が見つかりません");
        return;
      }
    } catch {
      _showAlert("search-error", "通信エラーが発生しました");
      return;
    }

    _memberName   = data.full_name;
    _memberUuid   = data.uuid;
    _memberNumber = data.member_number;

    document.getElementById("member-name").textContent = data.full_name;
    document.getElementById("member-sub").textContent  = "No." + (data.member_number || "");
    document.getElementById("member-block").style.display = "block";
    document.getElementById("save-btn").disabled = false;

    // 既存データ取得してカレンダー描画
    await _loadSchedules();
  }

  /* ─── 既存スケジュール取得 ─── */
  async function _loadSchedules() {
    try {
      const resp = await fetch("/api/work/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: _memberUuid })
      });
      const data = await resp.json();
      _schedules = data || {};
    } catch {
      _schedules = {};
    }
    _renderCalendars();
  }

  /* ─── カレンダー描画（3ヶ月分） ─── */
  function _renderCalendars() {
    const container = document.getElementById("calendar-area");
    container.innerHTML = "";
    container.classList.add("visible");
    const ph = document.getElementById("calendar-placeholder");
    if (ph) ph.style.display = "none";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = 0; offset < 3; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const year  = d.getFullYear();
      const month = d.getMonth() + 1;
      container.appendChild(_buildMonthCalendar(year, month, today));
    }
  }

  /* ─── 月カレンダー生成 ─── */
  function _buildMonthCalendar(year, month, today) {
    const holidays = _getHolidays(year);
    const wrapper  = document.createElement("div");
    wrapper.className = "work-month-block";

    // タイトル
    const title = document.createElement("div");
    title.className   = "work-month-title";
    title.textContent = `${year}年${month}月`;
    wrapper.appendChild(title);

    // グリッド
    const grid = document.createElement("div");
    grid.className = "work-cal-grid";

    // 曜日ヘッダー（日〜土）
    const dows = ["日","月","火","水","木","金","土"];
    const dowClasses = ["--sun","","","","","","--sat"];
    dows.forEach((d, i) => {
      const th = document.createElement("div");
      th.className   = `work-cal-dow work-cal-dow${dowClasses[i]}`;
      th.textContent = d;
      grid.appendChild(th);
    });

    // 1日の曜日（日=0）
    const firstDow = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    // 空白セル
    for (let i = 0; i < firstDow; i++) {
      const empty = document.createElement("div");
      empty.className = "work-cal-cell is-empty";
      grid.appendChild(empty);
    }

    // 日付セル
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const cellDate = new Date(year, month - 1, day);
      const dow      = cellDate.getDay();
      const isPast   = cellDate < today;
      const isToday  = cellDate.getTime() === today.getTime();
      const isHoliday = !!holidays[dateStr];
      const isSun    = dow === 0;
      const isSat    = dow === 6;
      const status   = _schedules[dateStr] ?? null;

      const cell = document.createElement("div");
      cell.className = "work-cal-cell";
      if (isPast)    cell.classList.add("is-past");
      if (isToday)   cell.classList.add("is-today");
      if (isSun)     cell.classList.add("is-sunday");
      if (isSat)     cell.classList.add("is-saturday");
      if (isHoliday) cell.classList.add("is-holiday");
      if (status === "OK") cell.classList.add("status-ok");
      if (status === "NG") cell.classList.add("status-ng");

      // 日付数字
      const dayEl = document.createElement("span");
      dayEl.className   = "work-cal-day";
      dayEl.textContent = day;
      cell.appendChild(dayEl);

      // ステータス表示
      const statusEl = document.createElement("span");
      statusEl.className   = "work-cal-status";
      statusEl.textContent = status || "";
      cell.appendChild(statusEl);

      // 祝日名
      if (isHoliday) {
        const holEl = document.createElement("span");
        holEl.className   = "work-cal-holiday-name";
        holEl.textContent = holidays[dateStr];
        cell.appendChild(holEl);
      }

      // クリックで OK → NG → null → OK のサイクル
      if (!isPast) {
        cell.dataset.date = dateStr;
        cell.addEventListener("click", () => _cycleStatus(cell, dateStr));
      }

      grid.appendChild(cell);
    }

    wrapper.appendChild(grid);
    return wrapper;
  }

  /* ─── ステータスをサイクル ─── */
  function _cycleStatus(cell, dateStr) {
    const cur = _schedules[dateStr] ?? null;
    const next = cur === null ? "OK" : cur === "OK" ? "NG" : null;

    _schedules[dateStr] = next;

    // クラス更新
    cell.classList.remove("status-ok", "status-ng");
    if (next === "OK") cell.classList.add("status-ok");
    if (next === "NG") cell.classList.add("status-ng");

    const statusEl = cell.querySelector(".work-cal-status");
    if (statusEl) statusEl.textContent = next || "";
  }

  /* ─── 保存 ─── */
  async function save() {
    if (!_memberUuid) return;

    let data;
    try {
      const resp = await fetch("/api/work/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: _memberUuid, schedules: _schedules })
      });
      data = await resp.json();
      if (!resp.ok) {
        _showResult(data.error || "保存に失敗しました", "danger");
        return;
      }
    } catch {
      _showResult("通信エラーが発生しました", "danger");
      return;
    }

    _showResult("保存しました", "success");
  }

  /* ─── 終了（トップへ） ─── */
  function end() {
    window.location.href = "/";
  }

  /* ─── クリア ─── */
  function _clearAll() {
    _memberName = _memberUuid = _memberNumber = "";
    _schedules  = {};
    document.getElementById("member-block").style.display = "none";
    document.getElementById("save-btn").disabled = true;
    document.getElementById("calendar-area").classList.remove("visible");
    document.getElementById("calendar-area").innerHTML = "";
    const ph = document.getElementById("calendar-placeholder");
    if (ph) ph.style.display = "block";
    _hideResult();
    _hideAlert("search-error");
  }

  /* ─── アラート ─── */
  function _showAlert(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
  }
  function _hideAlert(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }

  /* ─── 結果メッセージ ─── */
  function _showResult(msg, type) {
    const el = document.getElementById("result-msg");
    el.textContent = msg;
    el.className   = `work-result-msg work-alert work-alert--${type}`;
    el.style.display = "block";
    if (type === "success") setTimeout(() => { el.style.display = "none"; }, 3000);
  }
  function _hideResult() {
    const el = document.getElementById("result-msg");
    if (el) el.style.display = "none";
  }

  return { init, lookup, save, end };

})();

document.addEventListener("DOMContentLoaded", () => WorkApp.init());
