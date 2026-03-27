/**
 * app_cont_unified.js  –  請負管理（日報 + 出勤予定）統合ページ
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const UnifiedApp = (() => {

  /* ─── 内部状態 ─── */
  let _memberName   = "";
  let _memberUuid   = "";
  let _memberNumber = "";
  let _editId       = null;

  // 日報
  let _reportYear  = 0;
  let _reportMonth = 0;

  // カレンダー（1か月）
  let _calYear  = 0;
  let _calMonth = 0;
  let _calData  = null;   // APIレスポンス（1か月分の全メンバーデータ）

  // 出勤予定
  let _schedules         = {};   // { "YYYY-MM-DD": "OK" | "NG" | null }
  let _originalSchedules = {};   // 未保存検出用スナップショット

  // 未保存確認
  let _pendingAction = null;


  /* ═══════════════════════
     初期化
  ═══════════════════════ */
  function init() {
    const today = new Date();
    _reportYear  = today.getFullYear();
    _reportMonth = today.getMonth() + 1;
    _calYear     = today.getFullYear();
    _calMonth    = today.getMonth() + 1;

    _updateReportMonthLabel();
    _updateCalMonthLabel();

    // 氏名入力のEnterキー
    document.getElementById("search-input")
      .addEventListener("keydown", e => { if (e.key === "Enter") searchByName(); });

    // passコード入力のEnterキー
    document.getElementById("pass-input")
      .addEventListener("keydown", e => { if (e.key === "Enter") verifyPass(); });

    // モーダル外クリックで閉じる
    ["register-modal-overlay","edit-modal-overlay",
     "members-popup-overlay","unsaved-modal-overlay","pass-modal-overlay"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", e => {
        if (e.target === e.currentTarget) {
          if (id === "register-modal-overlay") closeRegisterModal();
          else if (id === "edit-modal-overlay") closeModal();
          else if (id === "members-popup-overlay") closeMembersPopup();
          else if (id === "unsaved-modal-overlay") unsavedCancel();
          else if (id === "pass-modal-overlay") closePassModal();
        }
      });
    });

    window.addEventListener("beforeunload", e => {
      if (_hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ""; }
    });
  }


  /* ═══════════════════════
     未保存チェック
  ═══════════════════════ */
  function _hasUnsavedChanges() {
    const keys = new Set([...Object.keys(_schedules), ...Object.keys(_originalSchedules)]);
    for (const k of keys) {
      if ((_schedules[k] ?? null) !== (_originalSchedules[k] ?? null)) return true;
    }
    return false;
  }

  function _checkUnsaved(action) {
    if (!_hasUnsavedChanges()) { action(); return; }
    _pendingAction = action;
    document.getElementById("unsaved-modal-overlay").classList.add("open");
  }

  async function unsavedSaveAndContinue() {
    document.getElementById("unsaved-modal-overlay").classList.remove("open");
    await save();
    if (_pendingAction) { const a = _pendingAction; _pendingAction = null; a(); }
  }
  function unsavedDiscardAndContinue() {
    document.getElementById("unsaved-modal-overlay").classList.remove("open");
    _schedules = JSON.parse(JSON.stringify(_originalSchedules));
    if (_pendingAction) { const a = _pendingAction; _pendingAction = null; a(); }
  }
  function unsavedCancel() {
    document.getElementById("unsaved-modal-overlay").classList.remove("open");
    _pendingAction = null;
  }


  /* ═══════════════════════
     担当者検索（氏名検索 → リスト表示 → passコード確認）
  ═══════════════════════ */

  // passコード入力待ちのメンバー情報
  let _pendingPassMember = null;

  // QRコードボタン
  function openQr() {
    QRScanner.open((memberData) => {
      // QRから取得したuuidで/api/cont/lookupを呼び出し、_applyMemberへ
      _lookupByUuid(memberData.uuid);
    });
  }

  function closeQrScan() {
    QRScanner.close();
  }

  async function _lookupByUuid(uuid) {
    let data;
    try {
      const resp = await fetch('/api/cont/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: uuid }),
      });
      data = await resp.json();
      if (!resp.ok) { _showAlert('search-error', data.error || '会員が見つかりません'); return; }
    } catch { _showAlert('search-error', '通信エラーが発生しました'); return; }

    if (_hasUnsavedChanges() && _memberUuid && _memberUuid !== data.uuid) {
      _checkUnsaved(() => _applyMember(data));
      return;
    }
    _applyMember(data);
  }

  // 氏名で検索 → 候補リスト表示
  async function searchByName() {
    const query = document.getElementById("search-input").value.trim();
    if (!query) { _showAlert("search-error", "氏名を入力してください"); return; }
    _hideAlert("search-error");

    let data;
    try {
      const resp = await fetch("/api/cont/search_by_name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: query }),
      });
      data = await resp.json();
      if (!resp.ok) { _showAlert("search-error", data.error || "検索エラー"); return; }
    } catch { _showAlert("search-error", "通信エラーが発生しました"); return; }

    _renderNameList(data.members || []);
  }

  // 検索結果リストを描画
  function _renderNameList(members) {
    const listWrap = document.getElementById("search-result-list");
    const listEl   = document.getElementById("search-result-items");

    if (!members.length) {
      _showAlert("search-error", "担当者が見つかりません");
      listWrap.style.display = "none";
      return;
    }

    // innerHTML + onclick属性ではJSONエスケープが壊れるため、
    // DOM生成＋addEventListener方式で確実にクリックを処理する
    listEl.innerHTML = "";
    members.forEach(m => {
      const div = document.createElement("div");
      div.className = "uni-name-item";
      div.innerHTML = `<span>${_esc(m.full_name)}</span><span class="uni-name-item-arrow">›</span>`;
      div.addEventListener("click", () => selectNameItem(m));
      listEl.appendChild(div);
    });
    listWrap.style.display = "block";
  }

  // リストの行をクリック → passコードポップアップ
  function selectNameItem(member) {
    _pendingPassMember = member;
    document.getElementById("pass-modal-name").textContent = member.full_name;
    document.getElementById("pass-input").value = "";
    _hideAlert("pass-error");
    document.getElementById("pass-modal-overlay").classList.add("open");
    setTimeout(() => document.getElementById("pass-input").focus(), 100);
  }

  // passコード確認
  async function verifyPass() {
    const pass = document.getElementById("pass-input").value.trim();
    if (!pass || pass.length !== 4) {
      _showPassError("4桁の数字を入力してください");
      return;
    }
    if (!_pendingPassMember) return;

    let data;
    try {
      const resp = await fetch("/api/cont/verify_pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: _pendingPassMember.uuid, pass }),
      });
      data = await resp.json();
      if (!resp.ok) { _showPassError(data.error || "passコードが違います"); return; }
    } catch { _showPassError("通信エラーが発生しました"); return; }

    // 認証成功
    document.getElementById("pass-modal-overlay").classList.remove("open");
    document.getElementById("search-result-list").style.display = "none";
    _pendingPassMember = null;

    if (_hasUnsavedChanges() && _memberUuid && _memberUuid !== data.uuid) {
      _checkUnsaved(() => _applyMember(data));
      return;
    }
    _applyMember(data);
  }

  function closePassModal() {
    document.getElementById("pass-modal-overlay").classList.remove("open");
    _pendingPassMember = null;
    document.getElementById("pass-input").value = "";
    _hideAlert("pass-error");
  }

  function _showPassError(msg) {
    const el = document.getElementById("pass-error");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
  }

  // 旧lookup（QRコード・会員番号検索、後方互換として残す）
  async function lookup() {
    const query = document.getElementById("search-input").value.trim();
    if (!query) return;
    _hideAlert("search-error");

    let data;
    try {
      const resp = await fetch("/api/cont/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      data = await resp.json();
      if (!resp.ok) { _showAlert("search-error", data.error || "会員が見つかりません"); return; }
    } catch { _showAlert("search-error", "通信エラーが発生しました"); return; }

    if (_hasUnsavedChanges() && _memberUuid && _memberUuid !== data.uuid) {
      _checkUnsaved(() => _applyMember(data));
      return;
    }
    _applyMember(data);
  }

  async function _applyMember(data) {
    _memberName   = data.full_name;
    _memberUuid   = data.uuid;
    _memberNumber = data.member_number;

    // 担当者表示
    document.getElementById("member-name").textContent = data.full_name;
    document.getElementById("member-sub").textContent  = "No." + (data.member_number || "");
    document.getElementById("member-block").style.display = "block";
    document.getElementById("search-input").value = "";

    // メインコンテンツ（日報＋カレンダー）を表示
    document.getElementById("main-content").style.display = "block";

    // モーダルの担当者名
    document.getElementById("register-modal-name").textContent = data.full_name;
    document.getElementById("edit-modal-name").textContent     = data.full_name;

    // 当月リセット
    const today = new Date();
    _reportYear  = today.getFullYear();
    _reportMonth = today.getMonth() + 1;
    _calYear     = today.getFullYear();
    _calMonth    = today.getMonth() + 1;
    _updateReportMonthLabel();
    _updateCalMonthLabel();

    await loadMyReports();
    await _loadSchedulesAndCalendar();
  }


  /* ═══════════════════════
     担当者クリア
  ═══════════════════════ */
  function clearMember() { _checkUnsaved(_doClearMember); }

  function _doClearMember() {
    _memberName = _memberUuid = _memberNumber = "";
    document.getElementById("search-input").value = "";
    _hideAlert("search-error");
    document.getElementById("member-block").style.display = "none";
    document.getElementById("search-result-list").style.display = "none";

    // メインコンテンツを非表示
    document.getElementById("main-content").style.display = "none";

    document.getElementById("report-tbody").innerHTML =
      `<tr id="empty-row"><td colspan="6" class="cont-empty">
         <div class="cont-empty-icon">🪂</div>担当者を検索してください
       </td></tr>`;
    document.getElementById("stat-total").textContent = "—";

    document.getElementById("calendar-area").innerHTML = "";
    document.getElementById("calendar-placeholder").style.display = "none";

    _schedules = {};
    _originalSchedules = {};
    _calData = null;
    _hideResult();
  }


  /* ═══════════════════════
     日報：月ナビ
  ═══════════════════════ */
  function _updateReportMonthLabel() {
    document.getElementById("report-month-display").textContent =
      `${_reportYear}年${String(_reportMonth).padStart(2,"0")}月`;
  }

  function navigateReportMonth(delta) {
    _checkUnsaved(async () => {
      let m = _reportMonth + delta, y = _reportYear;
      if (m < 1)  { m = 12; y--; }
      if (m > 12) { m = 1;  y++; }
      _reportYear = y; _reportMonth = m;
      _updateReportMonthLabel();
      await loadMyReports();
    });
  }


  /* ═══════════════════════
     日報：読み込み・描画
  ═══════════════════════ */
  async function loadMyReports() {
    if (!_memberUuid) return;

    const tbody = document.getElementById("report-tbody");
    tbody.innerHTML =
      `<tr><td colspan="6" style="text-align:center;padding:20px;color:#bbb;">読み込み中…</td></tr>`;

    let data;
    try {
      const resp = await fetch(
        `/api/cont/my_reports?uuid=${encodeURIComponent(_memberUuid)}&year=${_reportYear}&month=${_reportMonth}`
      );
      data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
    } catch {
      tbody.innerHTML =
        `<tr><td colspan="6" class="cont-empty">読み込みエラーが発生しました</td></tr>`;
      return;
    }

    _renderReportTable(data.records || []);
  }

  function _renderReportTable(records) {
    const tbody = document.getElementById("report-tbody");
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = _isoDate(today);

    if (!records.length) {
      tbody.innerHTML =
        `<tr id="empty-row"><td colspan="6" class="cont-empty">
           <div class="cont-empty-icon">🪂</div>この月の記録はありません
         </td></tr>`;
      _syncStatTotal();
      return;
    }

    tbody.innerHTML = "";
    records.forEach(r => {
      const isToday = r.flight_date === todayStr;
      const tr = document.createElement("tr");
      if (isToday) tr.className = "is-today";
      tr.dataset.id           = r.id;
      tr.dataset.flightCount  = r.daily_flight     || 0;
      tr.dataset.location     = r.takeoff_location || "";
      tr.dataset.glider       = r.used_glider      || "";
      tr.dataset.size         = r.size             || "";
      tr.dataset.pilotHarness = r.pilot_harness    || "";
      tr.dataset.passHarness  = r.passenger_harness|| "";
      tr.dataset.nearMiss     = r.near_miss        || "";
      tr.dataset.improvement  = r.improvement      || "";
      tr.dataset.damaged      = r.damaged_section  || "";

      tr.innerHTML = `
        <td class="uni-td-date">${_fmtDate(r.flight_date)}</td>
        <td>${r.daily_flight || 0}</td>
        <td><span class="cont-chip cont-chip--loc">${_esc(r.takeoff_location || "—")}</span></td>
        <td>${_esc(r.used_glider || "—")}</td>
        <td>${_esc(r.size || "—")}</td>
        <td>${isToday
          ? `<button class="cont-btn-edit" onclick="UnifiedApp.openEditModal(${r.id})">編集</button>`
          : `<button class="cont-btn-edit" disabled>編集不可</button>`
        }</td>`;
      tbody.appendChild(tr);
    });
    _syncStatTotal();
  }

  function _syncStatTotal() {
    // 当月表示のときのみカウントを更新
    const today = new Date();
    if (_reportYear === today.getFullYear() && _reportMonth === today.getMonth() + 1) {
      const n = document.querySelectorAll("#report-tbody tr[data-id]").length;
      document.getElementById("stat-total").textContent = n;
    }
  }

  function _fmtDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00");
    const dow = ["日","月","火","水","木","金","土"][d.getDay()];
    return `${d.getMonth()+1}/${d.getDate()}（${dow}）`;
  }


  /* ═══════════════════════
     日報登録モーダル
  ═══════════════════════ */
  function openRegisterModal() {
    if (!_memberUuid) {
      alert("担当者を先に検索・選択してください");
      return;
    }

    // 当日既存チェック
    const todayStr = _isoDate(new Date());
    const existRow = document.querySelector(`#report-tbody tr[data-id]`);

    // 当月表示でない場合は当月に戻す
    const today = new Date();
    if (_reportYear !== today.getFullYear() || _reportMonth !== today.getMonth() + 1) {
      _reportYear = today.getFullYear();
      _reportMonth = today.getMonth() + 1;
      _updateReportMonthLabel();
      loadMyReports().then(() => {
        const todayRow = [...document.querySelectorAll("#report-tbody tr[data-id]")]
          .find(r => {
            const fd = r.querySelector(".uni-td-date");
            return r.classList.contains("is-today");
          });
        if (todayRow) {
          _showAlert("search-error", "本日の日報が既に登録されています。編集画面を開きます。");
          const errEl = document.getElementById("search-error");
          errEl.className = "cont-alert cont-alert--info";
          errEl.style.display = "block";
          openEditModal(+todayRow.dataset.id);
          return;
        }
        _openRegModal();
      });
      return;
    }

    const todayRow = document.querySelector("#report-tbody tr.is-today");
    if (todayRow) {
      _showAlert("search-error", "本日の日報が既に登録されています。編集画面を開きます。");
      const errEl = document.getElementById("search-error");
      errEl.className = "cont-alert cont-alert--info";
      errEl.style.display = "block";
      openEditModal(+todayRow.dataset.id);
      return;
    }
    _openRegModal();
  }

  function _openRegModal() {
    _resetRegForm();
    document.getElementById("register-modal-overlay").classList.add("open");
  }

  function closeRegisterModal() {
    document.getElementById("register-modal-overlay").classList.remove("open");
    _resetRegForm();
  }

  function _resetRegForm() {
    ["reg-flight-count","reg-near-miss","reg-improvement","reg-damaged"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.querySelectorAll("#register-modal-overlay .cont-opt-btn")
      .forEach(b => b.classList.remove("selected"));
    const rr = document.getElementById("register-result");
    if (rr) rr.style.display = "none";
  }


  /* ═══════════════════════
     日報登録実行
  ═══════════════════════ */
  async function register() {
    if (!_memberName) return;

    const payload = {
      uuid:              _memberUuid,
      name:              _memberName,
      daily_flight:      parseInt(document.getElementById("reg-flight-count").value) || 0,
      takeoff_location:  _getSelected("reg-grp-location"),
      used_glider:       _getSelected("reg-grp-glider"),
      size:              _getSelected("reg-grp-size"),
      pilot_harness:     _getSelected("reg-grp-pilot"),
      passenger_harness: _getSelected("reg-grp-pass"),
      near_miss:         document.getElementById("reg-near-miss").value.trim(),
      improvement:       document.getElementById("reg-improvement").value.trim(),
      damaged_section:   document.getElementById("reg-damaged").value.trim(),
    };

    let data;
    try {
      const resp = await fetch("/api/cont/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await resp.json();
      if (!resp.ok) { _showRegResult(data.error || "登録に失敗しました", "danger"); return; }
    } catch { _showRegResult("通信エラーが発生しました", "danger"); return; }

    _showRegResult(data.message || "登録しました ✓", "success");

    const today = new Date();
    _reportYear  = today.getFullYear();
    _reportMonth = today.getMonth() + 1;
    _updateReportMonthLabel();
    await loadMyReports();

    setTimeout(() => closeRegisterModal(), 1400);
  }


  /* ═══════════════════════
     日報編集モーダル
  ═══════════════════════ */
  function openEditModal(id) {
    _editId = id;
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;

    document.getElementById("modal-flight-count").value = row.dataset.flightCount || "0";

    ["modal-grp-location","modal-grp-glider","modal-grp-size","modal-grp-pilot","modal-grp-pass"]
      .forEach(g => document.querySelectorAll("." + g + " .cont-opt-btn").forEach(b => b.classList.remove("selected")));

    _preselectModal("modal-grp-location", row.dataset.location     || "");
    _preselectModal("modal-grp-glider",   row.dataset.glider       || "");
    _preselectModal("modal-grp-size",     row.dataset.size         || "");
    _preselectModal("modal-grp-pilot",    row.dataset.pilotHarness || "");
    _preselectModal("modal-grp-pass",     row.dataset.passHarness  || "");

    document.getElementById("modal-near-miss").value   = row.dataset.nearMiss    || "";
    document.getElementById("modal-improvement").value = row.dataset.improvement || "";
    document.getElementById("modal-damaged").value     = row.dataset.damaged     || "";

    document.getElementById("edit-modal-overlay").classList.add("open");
  }

  function _preselectModal(groupClass, value) {
    document.querySelectorAll("." + groupClass + " .cont-opt-btn").forEach(b => {
      if (b.dataset.val === value) b.classList.add("selected");
    });
  }

  function closeModal() {
    document.getElementById("edit-modal-overlay").classList.remove("open");
    _editId = null;
  }

  async function saveEdit() {
    if (!_editId) return;

    const payload = {
      daily_flight:      parseInt(document.getElementById("modal-flight-count").value) || 0,
      takeoff_location:  _getSelected("modal-grp-location"),
      used_glider:       _getSelected("modal-grp-glider"),
      size:              _getSelected("modal-grp-size"),
      pilot_harness:     _getSelected("modal-grp-pilot"),
      passenger_harness: _getSelected("modal-grp-pass"),
      near_miss:         document.getElementById("modal-near-miss").value.trim(),
      improvement:       document.getElementById("modal-improvement").value.trim(),
      damaged_section:   document.getElementById("modal-damaged").value.trim(),
    };

    let data;
    try {
      const resp = await fetch(`/api/cont/${_editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await resp.json();
      if (!resp.ok) { alert(data.error || "更新に失敗しました"); return; }
    } catch { alert("通信エラーが発生しました"); return; }

    await loadMyReports();
    closeModal();
  }


  /* ═══════════════════════
     カレンダー：月ナビ
  ═══════════════════════ */
  function _updateCalMonthLabel() {
    document.getElementById("cal-month-display").textContent =
      `${_calYear}年${String(_calMonth).padStart(2,"0")}月`;
  }

  function navigateCalMonth(delta) {
    _checkUnsaved(async () => {
      let m = _calMonth + delta, y = _calYear;
      if (m < 1)  { m = 12; y--; }
      if (m > 12) { m = 1;  y++; }
      _calYear = y; _calMonth = m;
      _updateCalMonthLabel();
      await _loadCalMonthData();
      _renderCalendar();
    });
  }


  /* ═══════════════════════
     出勤予定：読み込み
  ═══════════════════════ */
  async function _loadSchedulesAndCalendar() {
    try {
      const resp = await fetch("/api/work/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: _memberUuid }),
      });
      const d = await resp.json();
      _schedules = d || {};
    } catch { _schedules = {}; }
    _originalSchedules = JSON.parse(JSON.stringify(_schedules));

    await _loadCalMonthData();
    _renderCalendar();
  }

  async function _loadCalMonthData() {
    try {
      const resp = await fetch(`/api/cont_info/work_monthly?year=${_calYear}&month=${_calMonth}`);
      _calData = await resp.json();
    } catch { _calData = { days: [] }; }
  }


  /* ═══════════════════════
     カレンダー描画（1か月）
  ═══════════════════════ */
  function _renderCalendar() {
    const container = document.getElementById("calendar-area");
    container.innerHTML = "";

    const ph = document.getElementById("calendar-placeholder");
    if (ph) ph.style.display = "none";

    const today = new Date(); today.setHours(0,0,0,0);
    container.appendChild(_buildMonthCalendar(_calYear, _calMonth, today));
  }

  function _buildMonthCalendar(year, month, today) {
    const holidays = _getHolidays(year);

    // date → dayData のマップ
    const dayMap = {};
    ((_calData && _calData.days) || []).forEach(d => { dayMap[d.date] = d; });

    const wrapper = document.createElement("div");
    wrapper.className = "work-month-block";

    const grid = document.createElement("div");
    grid.className = "work-cal-grid uni-cal-grid";

    // 曜日ヘッダー
    ["日","月","火","水","木","金","土"].forEach((label, i) => {
      const th = document.createElement("div");
      th.className = "work-cal-dow"
        + (i===0 ? " work-cal-dow--sun" : i===6 ? " work-cal-dow--sat" : "");
      th.textContent = label;
      grid.appendChild(th);
    });

    const firstDow    = new Date(year, month-1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < firstDow; i++) {
      const e = document.createElement("div");
      e.className = "work-cal-cell is-empty";
      grid.appendChild(e);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr  = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const cellDate = new Date(year, month-1, day);
      const dow      = cellDate.getDay();
      const isPast   = cellDate < today;
      const isToday  = cellDate.getTime() === today.getTime();
      const isHoliday = !!holidays[dateStr];
      const dayData  = dayMap[dateStr] || { ok_count: 0, members: [] };
      const okCount  = dayData.ok_count || 0;
      const myStatus = _schedules[dateStr] ?? null;

      const cell = document.createElement("div");
      cell.className = "work-cal-cell uni-cal-cell";
      if (isPast)    cell.classList.add("is-past");
      if (isToday)   cell.classList.add("is-today");
      if (dow===0)   cell.classList.add("is-sunday");
      if (dow===6)   cell.classList.add("is-saturday");
      if (isHoliday) cell.classList.add("is-holiday");
      if (myStatus==="OK") cell.classList.add("status-ok");
      if (myStatus==="NG") cell.classList.add("status-ng");

      // 日付
      const dayEl = document.createElement("span");
      dayEl.className   = "work-cal-day";
      dayEl.textContent = day;
      cell.appendChild(dayEl);

      // OK人数バッジ
      const badge = document.createElement("span");
      badge.className = "uni-ok-badge" + (okCount > 0 ? " uni-ok-badge--active" : "");
      badge.textContent = okCount > 0 ? `${okCount}人` : "—";
      if (okCount > 0) {
        badge.addEventListener("click", e => {
          e.stopPropagation();
          _showMembersPopup(dateStr, dayData.members || []);
        });
      }
      cell.appendChild(badge);

      // 自分のステータス
      const statusEl = document.createElement("span");
      statusEl.className = "uni-my-status"
        + (myStatus==="OK" ? " uni-my-status--ok" : myStatus==="NG" ? " uni-my-status--ng" : "");
      statusEl.textContent = myStatus || "";
      cell.appendChild(statusEl);

      // 祝日名
      if (isHoliday) {
        const holEl = document.createElement("span");
        holEl.className   = "work-cal-holiday-name";
        holEl.textContent = holidays[dateStr];
        cell.appendChild(holEl);
      }

      // クリックでステータスサイクル
      if (!isPast) {
        cell.dataset.date = dateStr;
        cell.addEventListener("click", () => _cycleStatus(cell, dateStr, statusEl));
      }

      grid.appendChild(cell);
    }

    wrapper.appendChild(grid);
    return wrapper;
  }

  function _cycleStatus(cell, dateStr, statusEl) {
    const cur  = _schedules[dateStr] ?? null;
    const next = cur===null ? "OK" : cur==="OK" ? "NG" : null;
    _schedules[dateStr] = next;

    cell.classList.remove("status-ok","status-ng");
    if (next==="OK") cell.classList.add("status-ok");
    if (next==="NG") cell.classList.add("status-ng");

    statusEl.textContent = next || "";
    statusEl.className = "uni-my-status"
      + (next==="OK" ? " uni-my-status--ok" : next==="NG" ? " uni-my-status--ng" : "");
  }


  /* ═══════════════════════
     出勤可能者ポップアップ
  ═══════════════════════ */
  function _showMembersPopup(dateStr, members) {
    const d   = new Date(dateStr + "T00:00:00");
    const dow = ["日","月","火","水","木","金","土"][d.getDay()];
    document.getElementById("members-popup-date").textContent =
      `${d.getMonth()+1}月${d.getDate()}日（${dow}）の出勤可能者`;

    const okMembers = members.filter(m => m.status === "OK");
    const list = document.getElementById("members-popup-list");
    list.innerHTML = okMembers.length === 0
      ? `<p class="uni-members-empty">出勤可能者なし</p>`
      : okMembers.map(m => `
          <div class="uni-member-item">
            <span class="uni-member-dot"></span>
            <span class="uni-member-name">${_esc(m.name)}</span>
          </div>`).join("");

    document.getElementById("members-popup-overlay").classList.add("open");
  }

  function closeMembersPopup() {
    document.getElementById("members-popup-overlay").classList.remove("open");
  }


  /* ═══════════════════════
     出勤予定保存
  ═══════════════════════ */
  async function save() {
    if (!_memberUuid) {
      alert("担当者を先に検索・選択してください");
      return;
    }

    let data;
    try {
      const resp = await fetch("/api/work/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: _memberUuid, schedules: _schedules }),
      });
      data = await resp.json();
      if (!resp.ok) { _showResult(data.error || "保存に失敗しました", "danger"); return; }
    } catch { _showResult("通信エラーが発生しました", "danger"); return; }

    _originalSchedules = JSON.parse(JSON.stringify(_schedules));
    _showResult("予定を保存しました ✓", "success");

    // カレンダーを再読み込みして人数バッジを更新
    await _loadCalMonthData();
    _renderCalendar();
  }


  /* ═══════════════════════
     祝日計算
  ═══════════════════════ */
  function _getHolidays(year) {
    const h = {};
    const add = (m, d, name) => {
      h[`${year}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`] = name;
    };
    add(1,1,"元日"); add(2,11,"建国記念の日"); add(2,23,"天皇誕生日");
    add(4,29,"昭和の日"); add(5,3,"憲法記念日"); add(5,4,"みどりの日");
    add(5,5,"こどもの日"); add(8,11,"山の日"); add(11,3,"文化の日"); add(11,23,"勤労感謝の日");

    const nthMon = (m, n) => {
      let d = new Date(year, m-1, 1), c = 0;
      while (true) { if (d.getDay()===1) { c++; if (c===n) break; } d.setDate(d.getDate()+1); }
      return d;
    };
    const fmt = d =>
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

    h[fmt(nthMon(1,2))]="成人の日"; h[fmt(nthMon(7,3))]="海の日";
    h[fmt(nthMon(9,3))]="敬老の日"; h[fmt(nthMon(10,2))]="スポーツの日";

    const spr = Math.floor(20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4));
    const aut = Math.floor(23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4));
    add(3,spr,"春分の日"); add(9,aut,"秋分の日");

    const extras = {};
    for (const [ds, name] of Object.entries(h)) {
      const d = new Date(ds);
      if (d.getDay()===0) {
        const next = new Date(d); next.setDate(next.getDate()+1);
        extras[fmt(next)] = name + "（振替）";
      }
    }
    return { ...h, ...extras };
  }


  /* ═══════════════════════
     ユーティリティ
  ═══════════════════════ */
  function selectOpt(el, groupClass) {
    document.querySelectorAll("." + groupClass + " .cont-opt-btn")
      .forEach(b => b.classList.remove("selected"));
    el.classList.add("selected");
  }

  function _getSelected(groupClass) {
    const el = document.querySelector("." + groupClass + " .cont-opt-btn.selected");
    return el ? el.dataset.val : "";
  }

  function _isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function _showAlert(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = "cont-alert cont-alert--danger";
    el.style.display = "block";
  }
  function _hideAlert(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }

  function _showResult(msg, type) {
    const el = document.getElementById("result-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = `cont-result-msg cont-alert cont-alert--${type}`;
    el.style.display = "block";
    if (type === "success") setTimeout(() => { el.style.display = "none"; }, 3000);
  }
  function _hideResult() {
    const el = document.getElementById("result-msg");
    if (el) el.style.display = "none";
  }

  function _showRegResult(msg, type) {
    const el = document.getElementById("register-result");
    if (!el) return;
    el.textContent = msg;
    el.className = `cont-result-msg cont-alert cont-alert--${type}`;
    el.style.display = "block";
  }

  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return {
    init, lookup, searchByName, selectNameItem, verifyPass, closePassModal, openQr, closeQrScan,
    clearMember, selectOpt,
    register, closeRegisterModal, openRegisterModal,
    openEditModal, closeModal, saveEdit,
    navigateReportMonth, navigateCalMonth,
    save,
    closeMembersPopup,
    unsavedSaveAndContinue, unsavedDiscardAndContinue, unsavedCancel,
  };

})();

document.addEventListener("DOMContentLoaded", () => UnifiedApp.init());
