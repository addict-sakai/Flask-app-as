/**
 * app_exp_status.js  –  体験状況ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const StatusApp = (() => {

  /* ═══════════════════════════════════════
     状態管理
  ═══════════════════════════════════════ */
  const S = {
    currentDate: new Date(),   // 表示中の日付
    data:        null,         // 最後にロードしたデータ
    config:      {},           // { staff:[], meeting_time:[], short_time:[] }
    walkinType:  "para",       // 飛び込みモーダルの種別
    editingId:   null,         // 詳細モーダルの対象 ID
  };

  const STATUS_LIST  = ["受付未", "受付済", "体験完了", "キャンセル"];
  const STATUS_CLASS = {
    "受付未": "status-badge--未",
    "受付済": "status-badge--済",
    "体験完了": "status-badge--完了",
    "キャンセル": "status-badge--cancel",
  };

  /* ═══════════════════════════════════════
     ユーティリティ
  ═══════════════════════════════════════ */
  const $ = id => document.getElementById(id);

  const esc = s =>
    String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fmtDateLabel(d) {
    const DOW = ["日", "月", "火", "水", "木", "金", "土"];
    const dw = DOW[d.getDay()];
    const today = toISO(new Date());
    const suffix = toISO(d) === today ? " (今日)" : "";
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} (${dw})${suffix}`;
  }

  function shiftDate(d, days) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + days);
    return nd;
  }

  async function apiFetch(url) {
    const res  = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
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

  /* ═══════════════════════════════════════
     初期化
  ═══════════════════════════════════════ */
  async function init() {
    _bindHeader();
    _bindWalkinModal();
    _bindDetailModal();
    _bindPilotModal();
    _bindSchoolDetailModal();

    // 設定を取得してモーダルのセレクトを準備
    try {
      S.config = await apiFetch("/api/exp_status/config");
      _populateConfigSelects();
    } catch (e) {
      toast("設定データの取得に失敗", "warn");
    }

    await loadDay(S.currentDate);
  }

  /* ═══════════════════════════════════════
     ヘッダーのバインド
  ═══════════════════════════════════════ */
  function _bindHeader() {
    $("btnPrevDay").addEventListener("click", () => {
      S.currentDate = shiftDate(S.currentDate, -1);
      loadDay(S.currentDate);
    });
    $("btnNextDay").addEventListener("click", () => {
      S.currentDate = shiftDate(S.currentDate, +1);
      loadDay(S.currentDate);
    });
    $("btnToday").addEventListener("click", () => {
      S.currentDate = new Date();
      loadDay(S.currentDate);
    });
  }

  /* ═══════════════════════════════════════
     設定値をセレクトに反映
  ═══════════════════════════════════════ */
  function _populateConfigSelects() {
    const { staff = [], meeting_time = [] } = S.config;

    // 飛び込みモーダル
    _fillSelect("wStaff",       staff,        "— 担当なし —");
    _fillSelect("wMeetingTime", meeting_time, "—");

    // 詳細モーダル
    _fillSelect("dStaff", staff, "—");
  }

  function _fillSelect(id, values, placeholder) {
    const sel = $(id);
    if (!sel) return;
    const cur = sel.value;
    // 先頭のプレースホルダー以外を削除
    while (sel.options.length > 1) sel.remove(1);
    sel.options[0].textContent = placeholder;
    sel.options[0].value       = "";
    values.forEach(v => {
      const opt = new Option(v, v);
      sel.appendChild(opt);
    });
    sel.value = cur || "";
  }

  /* ═══════════════════════════════════════
     日別データのロード
  ═══════════════════════════════════════ */
  async function loadDay(d) {
    $("dateLabel").textContent = fmtDateLabel(d);
    $("stLoading").style.display = "block";
    $("stMain").querySelectorAll(".st-section").forEach(el => el.remove());

    try {
      const data = await apiFetch(`/api/exp_status/daily?date=${toISO(d)}`);
      S.data = data;
      $("stLoading").style.display = "none";
      renderAll(data);
    } catch (e) {
      $("stLoading").textContent = "読み込みに失敗しました";
      toast(e.message, "error");
    }
  }

  /* ═══════════════════════════════════════
     全セクション描画
  ═══════════════════════════════════════ */
  function renderAll(data) {
    const main = $("stMain");

    // タンデム
    main.appendChild(
      buildSection({
        id:      "secTandem",
        icon:    "🪂",
        title:   "タンデム",
        items:   data.tandem,
        cols:    ["集合時間", "名前", "電話", "コース", "人数", "状況", "備考"],
        rowFn:   rowPara,
        walkin:  null,
        pilots:  data.pilots,
        paxTotal: data.tandem_pax_total,
      })
    );

    // ショート
    main.appendChild(
      buildSection({
        id:     "secShort",
        icon:   "⛷",
        title:  "ショート",
        items:  data.short,
        cols:   ["時間(AM/PM)", "名前", "電話", "コース", "人数", "状況", "備考"],
        rowFn:  rowShort,
        walkin: null,
        paxTotal: data.short_pax_total,
      })
    );

    // スクール
    main.appendChild(
      buildSection({
        id:     "secSchool",
        icon:   "📚",
        title:  "スクール",
        items:  data.school,
        cols:   ["名前", "コース", "入山", "下山", "状況", "備考"],
        rowFn:  rowSchool,
        walkin:  null,
        clickFn: openSchoolDetail,
      })
    );

    // キャンプ
    main.appendChild(
      buildSection({
        id:     "secCamp",
        icon:   "⛺",
        title:  "キャンプ",
        items:  data.camp,
        cols:   ["名前", "サイト", "大人", "子供", "テント", "タープ", "車", "状況", "備考"],
        rowFn:  rowCamp,
        walkin: null,
      })
    );
  }

  /* ─── セクション DOM 構築 ──────────────────────────── */
  function buildSection({ id, icon, title, items, cols, rowFn, walkin, pilots, paxTotal, clickFn = openDetail }) {
    const sec = document.createElement("div");
    sec.className = "st-section";
    sec.id = id;

    // ── ヘッダー
    const hdr = document.createElement("div");
    hdr.className = "st-section-header";
    hdr.innerHTML = `
      <span class="st-section-icon">${icon}</span>
      <h2 class="st-section-title">${esc(title)}</h2>
      ${paxTotal != null ? `<span class="st-section-count">${paxTotal} 名</span>` : ""}
      <span class="st-section-count">${items.length} 件</span>
    `;

    // パイロットバッジ（タンデムのみ）
    if (pilots) {
      const pb = document.createElement("button");
      pb.className   = "pilot-badge";
      pb.textContent = `✈ 出勤パイロット ${pilots.length} 名`;
      pb.addEventListener("click", () => showPilotModal(pilots));
      hdr.appendChild(pb);
    }

    // 飛び込みボタン
    if (walkin) {
      const wb = document.createElement("button");
      wb.className   = "walkin-btn";
      wb.textContent = "＋ 飛び込み";
      wb.addEventListener("click", () => openWalkin(walkin));
      hdr.appendChild(wb);
    }

    // ── テーブル
    const wrap = document.createElement("div");
    wrap.className = "st-table-wrap";

    const table = document.createElement("table");
    table.className = "st-table";

    // thead
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr>`;
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement("tbody");
    if (items.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "st-empty-row";
      tr.innerHTML = `<td colspan="${cols.length}">予約なし</td>`;
      tbody.appendChild(tr);
    } else {
      items.forEach(item => {
        const tr = rowFn(item);
        tr.addEventListener("click", (e) => {
          if (e.target.classList.contains("status-badge")) return;
          clickFn(item);
        });
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    sec.appendChild(hdr);
    sec.appendChild(wrap);
    return sec;
  }

  /* ─── ステータスバッジ DOM 生成 ───────────────────── */
  function makeStatusBadge(item) {
    const btn = document.createElement("button");
    btn.className   = `status-badge ${STATUS_CLASS[item.status] || "status-badge--未"}`;
    btn.textContent = item.status || "受付未";
    btn.dataset.id  = item.id;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showStatusDropdown(e, item);
    });
    return btn;
  }

  /* ─── 行ビルダー：パラ（タンデム）─────────────────── */
  function rowPara(item) {
    const tr = document.createElement("tr");
    const memo_icon = item.memo ? '<span class="memo-icon">✎</span>' : "";
    const shuttle   = item.shuttle ? ' <span title="送迎">🚐</span>' : "";

    const td = (cls, html) => `<td class="${cls}">${html}</td>`;
    tr.innerHTML = `
      ${td("td-time",   esc(item.meeting_time) || "—")}
      ${td("td-name",   esc(item.name) + shuttle)}
      ${td("td-phone",  esc(item.phone) || "—")}
      ${td("td-course", esc(item.course))}
      ${td("td-pax",    esc(item.pax_count))}
      <td class="td-status"></td>
      ${td("td-memo",   memo_icon + esc(item.memo))}
    `;
    tr.querySelector(".td-status").appendChild(makeStatusBadge(item));
    return tr;
  }

  /* ─── 行ビルダー：ショート ────────────────────────── */
  function rowShort(item) {
    const tr = document.createElement("tr");
    // ショートはミーティング時間の代わりに AM/PM で表示
    const time = item.short_time || item.meeting_time || "—";
    const memo_icon = item.memo ? '<span class="memo-icon">✎</span>' : "";

    const td = (cls, html) => `<td class="${cls}">${html}</td>`;
    tr.innerHTML = `
      ${td("td-time",   esc(time))}
      ${td("td-name",   esc(item.name))}
      ${td("td-phone",  esc(item.phone) || "—")}
      ${td("td-course", esc(item.course))}
      ${td("td-pax",    esc(item.pax_count))}
      <td class="td-status"></td>
      ${td("td-memo",   memo_icon + esc(item.memo))}
    `;
    tr.querySelector(".td-status").appendChild(makeStatusBadge(item));
    return tr;
  }

  /* ─── 行ビルダー：スクール（io_flightデータ）──────── */
  function rowSchool(item) {
    const tr = document.createElement("tr");
    const comment_icon = item.comment ? '<span class="memo-icon">✎</span>' : "";
    const ioStatusCls  = item.io_status === "下山済" ? "status-badge--完了" : "status-badge--済";
    const td = (cls, html) => `<td class="${cls}">${html}</td>`;
    tr.innerHTML = `
      ${td("td-name",   esc(item.full_name))}
      ${td("td-course", esc(item.course_name) || "—")}
      ${td("td-time",   esc(item.in_time)  || "—")}
      ${td("td-time",   esc(item.out_time) || "—")}
      <td><span class="status-badge ${ioStatusCls}">${esc(item.io_status)}</span></td>
      ${td("td-memo",   comment_icon + esc(item.comment))}
    `;
    return tr;
  }

  /* ─── 行ビルダー：キャンプ ────────────────────────── */
  function rowCamp(item) {
    const tr = document.createElement("tr");
    const memo_icon = item.memo ? '<span class="memo-icon">✎</span>' : "";
    const carIcon   = item.has_vehicle ? "🚗" : "—";
    const td = (cls, html) => `<td class="${cls}">${html}</td>`;
    tr.innerHTML = `
      ${td("td-name",  esc(item.name))}
      ${td("",         esc(item.site_type) || "—")}
      ${td("td-pax",   esc(item.adult_count))}
      ${td("td-pax",   esc(item.child_count))}
      ${td("td-pax",   esc(item.tent_count))}
      ${td("td-pax",   esc(item.tarp_count))}
      ${td("",         carIcon)}
      <td class="td-status"></td>
      ${td("td-memo",  memo_icon + esc(item.memo))}
    `;
    tr.querySelector(".td-status").appendChild(makeStatusBadge(item));
    return tr;
  }

  /* ═══════════════════════════════════════
     ステータスドロップダウン
  ═══════════════════════════════════════ */
  let _activeDropdown = null;

  function showStatusDropdown(e, item) {
    closeStatusDropdown();

    const rect = e.target.getBoundingClientRect();
    const div  = document.createElement("div");
    div.className = "status-dropdown";
    div.style.top  = (rect.bottom + window.scrollY + 4) + "px";
    div.style.left = (rect.left + window.scrollX) + "px";

    STATUS_LIST.forEach(s => {
      const btn = document.createElement("button");
      btn.className   = "status-dropdown-item" + (s === item.status ? " active" : "");
      btn.textContent = s;
      btn.addEventListener("click", async () => {
        closeStatusDropdown();
        await updateStatus(item, s);
      });
      div.appendChild(btn);
    });

    document.body.appendChild(div);
    _activeDropdown = div;

    // 外クリックで閉じる
    setTimeout(() => {
      document.addEventListener("click", closeStatusDropdown, { once: true });
    }, 10);
  }

  function closeStatusDropdown() {
    if (_activeDropdown) {
      _activeDropdown.remove();
      _activeDropdown = null;
    }
  }

  /* ─── ステータス更新 API ────────────────────────────── */
  async function updateStatus(item, newStatus) {
    try {
      await apiPut(`/api/exp_status/${item.id}/status`, { status: newStatus });

      // data を更新してセクションを再描画
      _updateItemStatus(item.id, newStatus);
      toast("ステータスを更新しました");
    } catch (e) {
      toast(e.message, "error");
    }
  }

  function _updateItemStatus(id, newStatus) {
    // S.data 内の全セクションを更新してから再描画
    ["tandem", "short", "school", "camp"].forEach(key => {
      if (!S.data[key]) return;
      S.data[key].forEach(item => {
        if (item.id === id) item.status = newStatus;
      });
    });
    // ページを再描画
    $("stMain").querySelectorAll(".st-section").forEach(el => el.remove());
    $("stLoading").style.display = "none";
    renderAll(S.data);
  }

  /* ═══════════════════════════════════════
     スクール詳細モーダル（入下山管理と同じ）
  ═══════════════════════════════════════ */
  function _bindSchoolDetailModal() {
    const overlay = $("schoolDetailOverlay");
    if (!overlay) return;   // HTML未更新時はスキップ（クラッシュ防止）
    $("btnSchDetailClose").addEventListener("click",  closeSchoolDetail);
    $("btnSchDetailCancel").addEventListener("click", closeSchoolDetail);
    $("btnSchDetailSave").addEventListener("click",   saveSchoolDetail);
    overlay.addEventListener("click", e => {
      if (e.target === overlay) closeSchoolDetail();
    });
  }

  function openSchoolDetail(item) {
    const overlay = $("schoolDetailOverlay");
    if (!overlay) {
      toast("HTMLファイルを最新版に差し替えてください", "warn");
      return;
    }
    try {
      S.editingId = item.id;

      $("sch-class").textContent        = item.member_class   ?? "";
      $("sch-name").textContent         = item.full_name      ?? "—";
      $("sch-number").textContent       = item.member_number  ?? "—";
      $("sch-course").textContent       = item.course_name    ?? "—";
      $("sch-glider").textContent       = item.glider_name    ?? "—";
      $("sch-glider-color").textContent = item.glider_color   ?? "—";
      $("sch-insurance").textContent    = item.insurance_type ?? "—";
      $("sch-radio").textContent        = item.radio_type     ?? "—";
      $("sch-license").textContent      = item.license        ?? "—";
      $("sch-reglimit").textContent     = item.reglimit_date  ?? "—";
      $("sch-repack").textContent       = item.repack_date    ?? "—";
      $("sch-date").textContent         = item.entry_date     ?? "—";

      $("sch-in").textContent = item.in_time ?? "—";
      $("sch-out").innerHTML  = item.out_time
        ? `<span class="det-chip det-chip--out">${esc(item.out_time)}</span>`
        : `<span style="color:#ccc;">未下山</span>`;

      $("schYamachin").checked = !!item.yamachin;
      $("schComment").value    = item.comment ?? "";

      overlay.style.display = "flex";
      requestAnimationFrame(() => overlay.classList.add("is-visible"));
    } catch (err) {
      console.error("openSchoolDetail error:", err);
      toast("詳細の表示に失敗しました", "error");
    }
  }

  function closeSchoolDetail() {
    const overlay = $("schoolDetailOverlay");
    if (overlay) {
      overlay.classList.remove("is-visible");
      setTimeout(() => { overlay.style.display = "none"; }, 220);
    }
    S.editingId = null;
  }

  async function saveSchoolDetail() {
    if (!S.editingId) return;
    const yamEl = $("schYamachin");
    const comEl = $("schComment");
    if (!yamEl || !comEl) return;
    const payload = {
      yamachin: yamEl.checked,
      comment:  comEl.value.trim(),
    };
    try {
      await apiPut(`/api/io/info/record/${S.editingId}`, payload);
      closeSchoolDetail();
      toast("保存しました");
      await loadDay(S.currentDate);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  /* ═══════════════════════════════════════
     飛び込みモーダル
  ═══════════════════════════════════════ */
  function _bindWalkinModal() {
    $("btnWalkinClose").addEventListener("click",  closeWalkin);
    $("btnWalkinCancel").addEventListener("click", closeWalkin);
    $("btnWalkinSave").addEventListener("click",   saveWalkin);
    $("walkinOverlay").addEventListener("click", e => {
      if (e.target === $("walkinOverlay")) closeWalkin();
    });

    // コース変更でフィールド切り替え
    $("wCourse").addEventListener("change", _updateWalkinCourseFields);
  }

  function _updateWalkinCourseFields() {
    const course = $("wCourse").value;
    const isShort = course === "ショート";
    $("wTimeWrap").style.display = isShort ? "none" : "";
  }

  function openWalkin(section) {
    S.walkinType = (section === "camp") ? "camp" : "para";
    const isPara = S.walkinType === "para";

    $("walkinBadge").textContent = isPara ? "パラ" : "キャンプ";
    $("walkinTitle").textContent = `飛び込み登録 — ${section === "tandem" ? "タンデム" : section === "short" ? "ショート" : section === "camp" ? "キャンプ" : ""}`;

    // パラ / キャンプ でフィールド切り替え
    $("wCourseWrap").style.display = isPara ? "" : "none";
    $("wPaxWrap").style.display    = isPara ? "" : "none";
    $("wTimeWrap").style.display   = isPara ? "" : "none";
    $("wSiteWrap").style.display   = isPara ? "none" : "";
    $("wAdultWrap").style.display  = isPara ? "none" : "";
    $("wChildWrap").style.display  = isPara ? "none" : "";

    // コースの初期値
    if (isPara) {
      const courseVal = section === "short" ? "ショート" : "タンデム";
      $("wCourse").value = courseVal;
      _updateWalkinCourseFields();
    }

    // フォームリセット
    ["wName", "wPhone", "wMemo"].forEach(id => { $(id).value = ""; });
    $("wPax").value   = "1";
    $("wAdult") && ($("wAdult").value = "1");
    $("wChild") && ($("wChild").value = "0");

    $("walkinOverlay").style.display = "flex";
    $("wName").focus();
  }

  function closeWalkin() {
    $("walkinOverlay").style.display = "none";
  }

  async function saveWalkin() {
    const name = $("wName").value.trim();
    if (!name) { toast("名前を入力してください", "warn"); return; }

    const isPara = S.walkinType === "para";
    const body = {
      reservation_type: S.walkinType,
      reservation_date: toISO(S.currentDate),
      name,
      phone: $("wPhone").value.trim(),
      staff: $("wStaff").value,
      memo:  $("wMemo").value.trim(),
    };

    if (isPara) {
      body.para = {
        course:       $("wCourse").value,
        pax_count:    parseInt($("wPax").value) || 1,
        meeting_time: $("wMeetingTime").value,
      };
    } else {
      body.camp = {
        site_type:   $("wSite").value,
        adult_count: parseInt($("wAdult").value) || 1,
        child_count: parseInt($("wChild").value) || 0,
        tent_count:  0,
        tarp_count:  0,
      };
    }

    try {
      await apiPost("/api/exp_status/walkin", body);
      closeWalkin();
      toast("飛び込み登録しました");
      await loadDay(S.currentDate);  // 再読み込み
    } catch (e) {
      toast(e.message, "error");
    }
  }

  /* ═══════════════════════════════════════
     詳細・編集モーダル
  ═══════════════════════════════════════ */
  function _bindDetailModal() {
    $("btnDetailClose").addEventListener("click",  closeDetail);
    $("btnDetailCancel").addEventListener("click", closeDetail);
    $("btnDetailSave").addEventListener("click",   saveDetail);
    $("detailOverlay").addEventListener("click", e => {
      if (e.target === $("detailOverlay")) closeDetail();
    });
  }

  function openDetail(item) {
    S.editingId = item.id;

    // バッジ
    $("detailBadge").textContent = item.reservation_type === "para" ? "パラ" : "キャンプ";

    // タイトル
    const title = item.name
      ? `No.${item.reservation_no}　${item.name}`
      : `No.${item.reservation_no}`;
    $("detailTitle").textContent = title;

    // 読み取り専用情報
    const infoGrid = $("detailInfoGrid");
    infoGrid.innerHTML = "";
    const addInfo = (label, value) => {
      infoGrid.insertAdjacentHTML("beforeend",
        `<span class="detail-info-label">${esc(label)}</span>` +
        `<span class="detail-info-value">${esc(value || "—")}</span>`
      );
    };

    addInfo("電話", item.phone);
    if (item.reservation_type === "para") {
      addInfo("コース",   item.course);
      addInfo("人数",     item.pax_count + " 名");
      addInfo("集合時間", item.meeting_time || item.short_time);
      if (item.booking_site) addInfo("予約サイト", item.booking_site);
    } else {
      addInfo("サイト",   item.site_type);
      addInfo("大人",     item.adult_count + " 名");
      addInfo("子供",     item.child_count + " 名");
      addInfo("テント",   item.tent_count + " 張");
      addInfo("タープ",   item.tarp_count + " 張");
    }

    // 編集フィールド
    $("dStatus").value = item.status || "受付未";
    $("dMemo").value   = item.memo   || "";

    // 担当セレクト
    const dStaff = $("dStaff");
    dStaff.value = item.staff || "";
    if (!dStaff.value && item.staff) {
      // 既存値がリストにない場合も表示
      const opt = new Option(item.staff, item.staff);
      dStaff.appendChild(opt);
      dStaff.value = item.staff;
    }

    $("detailOverlay").style.display = "flex";
  }

  function closeDetail() {
    $("detailOverlay").style.display = "none";
    S.editingId = null;
  }

  async function saveDetail() {
    if (!S.editingId) return;
    const newStatus = $("dStatus").value;
    const newMemo   = $("dMemo").value.trim();
    const newStaff  = $("dStaff").value;

    try {
      // ステータス更新
      await apiPut(`/api/exp_status/${S.editingId}/status`, { status: newStatus });
      // 備考・担当更新
      await apiPut(`/api/exp_status/${S.editingId}/memo`,   { memo: newMemo, staff: newStaff });

      closeDetail();
      toast("保存しました");
      await loadDay(S.currentDate);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  /* ═══════════════════════════════════════
     パイロットモーダル
  ═══════════════════════════════════════ */
  function _bindPilotModal() {
    $("btnPilotClose").addEventListener("click", closePilotModal);
    $("btnPilotOk").addEventListener("click",    closePilotModal);
    $("pilotOverlay").addEventListener("click", e => {
      if (e.target === $("pilotOverlay")) closePilotModal();
    });
  }

  function showPilotModal(pilots) {
    const body = $("pilotBody");
    if (!pilots || pilots.length === 0) {
      body.innerHTML = `<p class="pilot-empty">担当者の設定なし</p>`;
    } else {
      const ul = document.createElement("ul");
      ul.className = "pilot-list";
      pilots.forEach(p => {
        const li = document.createElement("li");
        li.className = "pilot-list-item";
        li.innerHTML = `
          <span class="pilot-list-name">${esc(p.name)}</span>
        `;
        ul.appendChild(li);
      });
      body.innerHTML = "";
      body.appendChild(ul);
    }
    $("pilotOverlay").style.display = "flex";
  }

  function closePilotModal() {
    $("pilotOverlay").style.display = "none";
  }

  /* ═══════════════════════════════════════
     起動
  ═══════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", init);

})();
