/* =========================================================
   app_cont_info.js  –  請負管理ページ ロジック
   =========================================================
   Views:
     'flight'   → フライト状況（デフォルト）
     'work'     → 出勤可否状況
     'handover' → 引継ぎ報告事項
   API:
     GET /api/cont_info/flight_days?year&month
     GET /api/cont_info/detail/<uuid>?year&month
     GET /api/cont_info/work_monthly?year&month
   ========================================================= */

"use strict";

const TODAY = new Date();

/* ---- State ---- */
const state = {
  currentView: "flight",

  repYear:   TODAY.getFullYear(),
  repMonth:  TODAY.getMonth() + 1,
  showAll:   true,            // true = 全員表示 / false = フライトありのみ

  wcYear:    TODAY.getFullYear(),
  wcMonth:   TODAY.getMonth() + 1,
  wcMax: (() => {             // 当月 + 3か月後
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() + 3, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  })(),
};

/* ---- Shortcuts ---- */
const $     = (id) => document.getElementById(id);
const fmt   = (n)  => Number(n).toLocaleString("ja-JP");
const yen   = (n)  => `¥${fmt(n)}`;
const DAYS  = ["日","月","火","水","木","金","土"];

function weekday(dateStr) { return DAYS[new Date(dateStr).getDay()]; }
function isSaturday(dateStr) { return new Date(dateStr).getDay() === 6; }
function isSunday(dateStr)   { return new Date(dateStr).getDay() === 0; }
function isWeekend(dateStr)  { return isSaturday(dateStr) || isSunday(dateStr); }
function isToday(dateStr)    { return dateStr === TODAY.toISOString().slice(0, 10); }

/* ---- 日本の祝日判定 ---- */
function isHoliday(dateStr) {
  const fixed = [
    "01-01", "02-11", "02-23", "04-29",
    "05-03", "05-04", "05-05", "08-11",
    "11-03", "11-23",
  ];
  const mmdd = dateStr.slice(5);
  if (fixed.includes(mmdd)) return true;

  const d = new Date(dateStr);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const dow = d.getDay();

  if (mo === 1  && dow === 1 && day >= 8  && day <= 14) return true;
  if (mo === 7  && dow === 1 && day >= 15 && day <= 21) return true;
  if (mo === 9  && dow === 1 && day >= 15 && day <= 21) return true;
  if (mo === 10 && dow === 1 && day >= 8  && day <= 14) return true;

  const shunbun = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  if (mo === 3 && day === shunbun) return true;

  const shubun = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  if (mo === 9 && day === shubun) return true;

  if (dow === 1) {
    const prev = new Date(d); prev.setDate(day - 1);
    const prevStr = prev.toISOString().slice(0, 10);
    if (isHoliday(prevStr)) return true;
  }

  return false;
}

function statusIcon(status) {
  if (!status) return `<span class="status-null" title="未入力">　</span>`;
  const s = String(status).toUpperCase();
  if (s === "OK") return `<span class="status-ok"  title="出勤可">○</span>`;
  if (s === "NG") return `<span class="status-ng"  title="出勤不可">×</span>`;
  return `<span class="status-null" title="未確認">△</span>`;
}

/* =========================================================
   ハンバーガーメニュー
   ========================================================= */

function toggleHamburger() {
  const dropdown = $("hamburger-dropdown");
  const btn      = $("hamburger-btn");
  const isOpen   = dropdown.classList.contains("open");
  if (isOpen) {
    dropdown.classList.remove("open");
    btn.classList.remove("open");
  } else {
    dropdown.classList.add("open");
    btn.classList.add("open");
  }
}

function closeHamburger() {
  $("hamburger-dropdown").classList.remove("open");
  $("hamburger-btn").classList.remove("open");
}

/* 外側クリックで閉じる */
document.addEventListener("click", e => {
  const wrap = document.querySelector(".hamburger-wrap");
  if (wrap && !wrap.contains(e.target)) {
    closeHamburger();
  }
  if (e.target.id === "detail-modal") closeDetail();
});

/* =========================================================
   サイドバー View 切替（ハンバーガー版）
   ========================================================= */

function switchView(view) {
  state.currentView = view;

  /* ハンバーガーメニューの active */
  document.querySelectorAll(".hamburger-item").forEach(el => {
    el.classList.toggle("active", el.id === `hmenu-${view}`);
  });

  /* パネルの表示切替 */
  $("view-flight").classList.toggle("hidden",   view !== "flight");
  $("view-work").classList.toggle("hidden",     view !== "work");
  $("view-handover").classList.toggle("hidden", view !== "handover");

  /* 初回ロード */
  if (view === "flight")   loadFlightStatus();
  if (view === "work")     loadWorkContract();
  if (view === "handover") loadHandover();
}

/* =========================================================
   フライト状況
   ========================================================= */

function _updateShowAllBtn() {
  const btn = $("btn-show-all");
  if (!btn) return;
  // showAll=true（全員表示中）→ ボタン表記「全員」
  // showAll=false（フライトありのみ表示中）→ ボタン表記「フライトあり」
  btn.textContent = state.showAll ? "全員" : "フライトあり";
}

async function loadFlightStatus() {
  const { repYear: y, repMonth: m } = state;
  $("rep-month-label").textContent = `${y}年 ${m}月`;
  _updateShowAllBtn();

  const tbody = $("flight-status-body");
  const tfoot = $("flight-status-foot");
  tbody.innerHTML = `<tr class="loading-row"><td colspan="5">読み込み中…</td></tr>`;
  if (tfoot) tfoot.innerHTML = "";

  // 合計サブヘッダー行をクリア
  const totalSubHead = $("flight-total-subhead");
  if (totalSubHead) totalSubHead.innerHTML = "";

  try {
    const res  = await fetch(`/api/cont_info/flight_days?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    let rows = json.data || [];

    /* 全員表示 OFF → フライトありのみ */
    if (!state.showAll) {
      rows = rows.filter(r => r.total_flights > 0);
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">フライトデータがありません（「全員」で確認できます）</td></tr>`;
      return;
    }

    /* 合計計算 */
    const totals = rows.reduce((acc, r) => {
      acc.flight_days         += r.flight_days;
      acc.total_flights       += r.total_flights;
      acc.mini_guarantee_days += r.mini_guarantee_days;
      acc.total_amount        += r.total_amount;
      return acc;
    }, { flight_days: 0, total_flights: 0, mini_guarantee_days: 0, total_amount: 0 });

    /* 合計行をtheadの直下（subhead）に表示 */
    if (totalSubHead) {
      totalSubHead.innerHTML = `
        <tr class="total-subhead-row">
          <td class="col-name total-label">全員合計</td>
          <td class="col-num center">${fmt(totals.flight_days)}</td>
          <td class="col-num center">${fmt(totals.total_flights)}</td>
          <td class="col-num center">${fmt(totals.mini_guarantee_days)}</td>
          <td class="col-amount right amount">${yen(totals.total_amount)}</td>
        </tr>
      `;
    }

    /* 個人行 */
    tbody.innerHTML = rows.map(r => `
      <tr class="clickable-row"
          data-uuid="${r.uuid}"
          data-name="${r.name}"
          onclick="openDetail(this)"
          title="${r.name} の詳細を表示">
        <td class="col-name">${r.name}</td>
        <td class="col-num center">${fmt(r.flight_days)}</td>
        <td class="col-num center">${fmt(r.total_flights)}</td>
        <td class="col-num center">${fmt(r.mini_guarantee_days)}</td>
        <td class="col-amount right amount">${yen(r.total_amount)}</td>
      </tr>
    `).join("");

  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">エラー: ${e.message}</td></tr>`;
  }
}

/* ---- rep 月ナビ ---- */
function repMonthPrev() {
  _closeInlineDetail();
  let { repYear: y, repMonth: m } = state;
  if (--m < 1) { m = 12; y--; }
  state.repYear = y; state.repMonth = m;
  loadFlightStatus();
}
function repMonthNext() {
  _closeInlineDetail();
  let { repYear: y, repMonth: m } = state;
  if (++m > 12) { m = 1; y++; }
  state.repYear = y; state.repMonth = m;
  loadFlightStatus();
}

/* ---- 全員 / フライトあり トグル ---- */
function toggleShowAll() {
  state.showAll = !state.showAll;
  _updateShowAllBtn();
  loadFlightStatus();
}

/* =========================================================
   詳細モーダル
   ========================================================= */

/* ── インライン個人詳細パネル（フライト状況テーブル下に展開） ── */

let _activeDetailUuid = null;  // 現在展開中のuuid

/**
 * フライト状況テーブルの行クリック → 合計行の下にインライン展開
 */
async function openDetail(el) {
  const uuid = el.dataset.uuid;
  const name = el.dataset.name;
  const { repYear: y, repMonth: m } = state;

  // 同じ人を再クリック → 閉じる
  if (_activeDetailUuid === uuid) {
    _closeInlineDetail();
    return;
  }

  // 選択行のハイライト切替
  document.querySelectorAll("#flight-status-body tr.clickable-row").forEach(r => {
    r.classList.toggle("row-selected", r === el);
  });

  _activeDetailUuid = uuid;

  // 既存パネルを削除して新規作成
  _removeInlinePanel();

  // 合計行（tfoot）の後に挿入するためのコンテナ行をtbodyに追加
  const tbody = $("flight-status-body");
  const tfoot = $("flight-status-foot");

  // パネル行をtfootの直後に配置するため、tableの外にdivとして挿入する方法を使う
  // → tfoot内の合計行の後に追加行を入れる
  const panelRow = document.createElement("tr");
  panelRow.id = "inline-detail-row";
  panelRow.innerHTML = `
    <td colspan="5" class="inline-detail-cell">
      <div class="inline-detail-panel" id="inline-detail-panel">
        <div class="inline-detail-header">
          <span class="inline-detail-name">✈ ${name}　${y}年${m}月 フライト記録</span>
          <button class="inline-detail-close" onclick="_closeInlineDetail()">✕ 閉じる</button>
        </div>
        <div id="inline-detail-body">
          <p class="inline-loading">読み込み中…</p>
        </div>
      </div>
    </td>`;

  // tfoot の後ろに「詳細表示用tfoot」を追加
  const detailTfoot = document.createElement("tfoot");
  detailTfoot.id = "inline-detail-tfoot";
  detailTfoot.appendChild(panelRow);
  tfoot.parentNode.insertBefore(detailTfoot, tfoot.nextSibling);

  try {
    const res  = await fetch(`/api/cont_info/detail/${uuid}?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.data || [];

    if (rows.length === 0) {
      $("inline-detail-body").innerHTML =
        `<p class="inline-empty">当月のフライトデータがありません</p>`;
      return;
    }

    _renderInlineDetail(rows, uuid, y, m);

  } catch (e) {
    $("inline-detail-body").innerHTML =
      `<p class="inline-error">エラー: ${e.message}</p>`;
  }
}

/** インライン詳細パネルを描画 */
function _renderInlineDetail(rows, uuid, y, m) {
  const totalFlights = rows.reduce((s, r) => s + r.daily_flight, 0);
  const totalAmount  = rows.reduce((s, r) => s + r.total_amount,  0);

  // my_reportsを呼んで場所・引継ぎ情報を取得
  fetch(`/api/cont/my_reports?uuid=${uuid}&year=${y}&month=${m}`)
    .then(r => r.json())
    .then(json2 => {
      const days = json2.days || [];
      const dayMap = {};
      days.forEach(d => { dayMap[d.flight_date] = d; });

      const tbody = rows.map((r, idx) => {
        const dateLabel = `${r.flight_date}（${weekday(r.flight_date)}）`;
        const guarantee = r.mini_guarantee
          ? '<span class="tag-guarantee">最低保証</span>'
          : '—';

        // my_reports からその日の場所・引継ぎ情報を取得
        const dayInfo = dayMap[r.flight_date] || {};
        const locs = (dayInfo.locations || []).join("・") || '—';
        const handover = dayInfo.has_handover
          ? '<span class="tag-handover">あり</span>'
          : '<span class="tag-none">なし</span>';

        // 施設料控除の注記
        const feeNote = r.facility_fee > 0
          ? `<span class="fee-note">施設料 -${yen(r.facility_fee)}</span>`
          : '';

        return `
          <tr class="idd-row">
            <td class="idd-date">${dateLabel}</td>
            <td class="idd-count center">${fmt(r.daily_flight)} 本</td>
            <td class="idd-loc">${locs}</td>
            <td class="idd-amount right amount">${yen(r.total_amount)}${feeNote}</td>
            <td class="idd-guar center">${guarantee}</td>
            <td class="idd-hand center">${handover}</td>
            <td class="idd-btn center">
              <button class="btn-detail-expand" onclick="toggleDayDetail('idd-sub-${idx}', this, '${r.flight_date}', '${uuid}')">
                詳細
              </button>
            </td>
          </tr>
          <tr class="idd-sub-row hidden" id="idd-sub-${idx}">
            <td colspan="7" class="idd-sub-cell">
              <div class="idd-sub-inner" id="idd-sub-inner-${idx}">
                <p class="inline-loading">読み込み中…</p>
              </div>
            </td>
          </tr>`;
      }).join("");

      const html = `
        <div class="idd-table-wrap">
          <table class="idd-table">
            <thead>
              <tr>
                <th>日付</th>
                <th class="center">合計本数</th>
                <th>場所</th>
                <th class="right">合計金額</th>
                <th class="center">最低保証</th>
                <th class="center">引継ぎ</th>
                <th class="center">詳細</th>
              </tr>
            </thead>
            <tbody>${tbody}</tbody>
          </table>
        </div>
        <div class="idd-summary">
          <span>当月合計：<strong>${fmt(totalFlights)} 本</strong></span>
          <span>合計金額：<strong>${yen(totalAmount)}</strong></span>
        </div>`;

      $("inline-detail-body").innerHTML = html;
    })
    .catch(e => {
      // my_reportsが失敗した場合はrowsだけで表示
      const tbody = rows.map((r, idx) => {
        const dateLabel = `${r.flight_date}（${weekday(r.flight_date)}）`;
        const guarantee = r.mini_guarantee
          ? '<span class="tag-guarantee">最低保証</span>'
          : '—';
        const feeNote = r.facility_fee > 0
          ? `<span class="fee-note">施設料 -${yen(r.facility_fee)}</span>`
          : '';

        return `
          <tr class="idd-row">
            <td class="idd-date">${dateLabel}</td>
            <td class="idd-count center">${fmt(r.daily_flight)} 本</td>
            <td class="idd-loc">—</td>
            <td class="idd-amount right amount">${yen(r.total_amount)}${feeNote}</td>
            <td class="idd-guar center">${guarantee}</td>
            <td class="idd-hand center">—</td>
            <td class="idd-btn center">
              <button class="btn-detail-expand" onclick="toggleDayDetail('idd-sub-${idx}', this, '${r.flight_date}', '${uuid}')">
                詳細
              </button>
            </td>
          </tr>
          <tr class="idd-sub-row hidden" id="idd-sub-${idx}">
            <td colspan="7" class="idd-sub-cell">
              <div class="idd-sub-inner" id="idd-sub-inner-${idx}">
                <p class="inline-loading">読み込み中…</p>
              </div>
            </td>
          </tr>`;
      }).join("");

      $("inline-detail-body").innerHTML = `
        <div class="idd-table-wrap">
          <table class="idd-table">
            <thead>
              <tr>
                <th>日付</th><th class="center">合計本数</th><th>場所</th>
                <th class="right">合計金額</th>
                <th class="center">最低保証</th><th class="center">引継ぎ</th><th class="center">詳細</th>
              </tr>
            </thead>
            <tbody>${tbody}</tbody>
          </table>
        </div>
        <div class="idd-summary">
          <span>当月合計：<strong>${fmt(totalFlights)} 本</strong></span>
          <span>合計金額：<strong>${yen(totalAmount)}</strong></span>
        </div>`;
    });
}

/**
 * 日付別詳細（何本目・時間・場所/最低保証・引継ぎ）のトグル表示
 */
async function toggleDayDetail(subRowId, btn, flightDate, uuid) {
  const subRow   = $(subRowId);
  const innerIdx = subRowId.replace("idd-sub-", "");
  const inner    = $(`idd-sub-inner-${innerIdx}`);

  if (!subRow) return;

  const isOpen = !subRow.classList.contains("hidden");
  if (isOpen) {
    subRow.classList.add("hidden");
    btn.textContent = "詳細";
    btn.classList.remove("active");
    return;
  }

  subRow.classList.remove("hidden");
  btn.textContent = "閉じる";
  btn.classList.add("active");

  // 既にロード済みならスキップ
  if (inner.dataset.loaded === "1") return;

  // my_reportsから該当日のrecordsを取得
  const { repYear: y, repMonth: m } = state;
  try {
    const res  = await fetch(`/api/cont/my_reports?uuid=${uuid}&year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const days = json.days || [];
    const dayInfo = days.find(d => d.flight_date === flightDate);

    if (!dayInfo || !dayInfo.records || dayInfo.records.length === 0) {
      inner.innerHTML = `<p class="inline-empty">詳細データがありません</p>`;
      inner.dataset.loaded = "1";
      return;
    }

    const records = dayInfo.records;
    // mini_guaranteeレコードと通常レコードを分離
    const normalRecs = records.filter(r => !r.mini_guarantee);
    const guarRecs   = records.filter(r => r.mini_guarantee);

    const rows = [];

    // 通常フライト（何本目）
    normalRecs.forEach((r, i) => {
      const handover = (r.near_miss || r.improvement || r.damaged_section)
        ? '<span class="tag-handover">あり</span>'
        : '<span class="tag-none">なし</span>';
      rows.push(`
        <tr>
          <td class="sub-num">${i + 1} 本目</td>
          <td class="sub-time">${r.flight_time || '—'}</td>
          <td class="sub-loc">${r.takeoff_location || '—'}</td>
          <td class="sub-hand center">${handover}</td>
        </tr>`);
    });

    // 最低保証レコード
    guarRecs.forEach(r => {
      const handover = (r.near_miss || r.improvement || r.damaged_section)
        ? '<span class="tag-handover">あり</span>'
        : '<span class="tag-none">なし</span>';
      rows.push(`
        <tr class="sub-guarantee-row">
          <td class="sub-num"><span class="tag-guarantee">最低保証</span></td>
          <td class="sub-time">${r.flight_time || '—'}</td>
          <td class="sub-loc">—</td>
          <td class="sub-hand center">${handover}</td>
        </tr>`);
    });

    inner.innerHTML = `
      <table class="sub-table">
        <thead>
          <tr>
            <th>何本目</th>
            <th>時間</th>
            <th>場所 / 区分</th>
            <th class="center">引継ぎ</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>`;
    inner.dataset.loaded = "1";

  } catch (e) {
    inner.innerHTML = `<p class="inline-error">エラー: ${e.message}</p>`;
  }
}

/** インライン詳細パネルを閉じる */
function _closeInlineDetail() {
  _removeInlinePanel();
  _activeDetailUuid = null;
  document.querySelectorAll("#flight-status-body tr.clickable-row").forEach(r => {
    r.classList.remove("row-selected");
  });
}

function _removeInlinePanel() {
  const el = $("inline-detail-tfoot");
  if (el) el.remove();
}

/** フライト詳細テーブルHTMLを生成（openDetail / openFlightDetailFromWork 共通） */
function _buildFlightDetailHTML(rows) {
  const totalFlights = rows.reduce((s, r) => s + r.daily_flight, 0);
  const totalAmount  = rows.reduce((s, r) => s + r.total_amount,  0);

  const tbody = rows.map((r, idx) => {
    const dateLabel = `${r.flight_date}（${weekday(r.flight_date)}）`;
    const guarantee = r.mini_guarantee
      ? '<span class="status-ok" title="最低保証あり">○</span>'
      : '—';

    // 時間詳細ボタン（時刻データがある場合のみ）
    const hasTimes = r.flight_times && r.flight_times.length > 0;
    const timeBtn = hasTimes
      ? `<button class="btn-time-detail" onclick="toggleTimeDetail('td-time-${idx}')" title="時間詳細を表示">
           🕐 時間詳細
         </button>
         <div class="time-detail-panel" id="td-time-${idx}">
           ${r.flight_times.map(t => `<span class="time-chip">${t}</span>`).join("")}
         </div>`
      : '<span style="color:var(--text-muted);font-size:12px">—</span>';

    return `
      <tr>
        <td>${dateLabel}</td>
        <td class="center">${fmt(r.daily_flight)} 本</td>
        <td class="right amount">${yen(r.total_amount)}</td>
        <td class="center">${guarantee}</td>
        <td class="td-time-cell">${timeBtn}</td>
        <td style="color:var(--text-secondary);font-size:12px">${r.notes || '—'}</td>
      </tr>`;
  }).join("");

  const html = `
    <table>
      <thead>
        <tr>
          <th>日付</th>
          <th class="center">合計本数</th>
          <th class="right">金額</th>
          <th class="center">最低保証</th>
          <th>時間詳細</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>`;

  const summary = `
    <span>合計フライト：<strong>${fmt(totalFlights)} 本</strong></span>
    <span>合計金額：<strong>${yen(totalAmount)}</strong></span>`;

  return { html, summary };
}

/** 時間詳細パネルのトグル */
function toggleTimeDetail(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.classList.toggle("open");
  // ボタンのラベルを切り替え
  const btn = panel.previousElementSibling;
  if (btn) {
    btn.textContent = panel.classList.contains("open") ? "🕐 閉じる" : "🕐 時間詳細";
  }
}

function closeDetail() {
  $("detail-modal").classList.remove("open");
}

/* =========================================================
   出勤可否状況 (カレンダー版)
   ========================================================= */

async function loadWorkContract() {
  const { wcYear: y, wcMonth: m } = state;
  $("wc-month-label").textContent = `${y}年 ${m}月`;
  _updateWcNavState();

  const wrap = $("wc-table-wrap");
  wrap.innerHTML = `<p class="loading-text">読み込み中…</p>`;

  try {
    const res = await fetch(`/api/cont_info/work_monthly?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const daysData = json.days || [];

    const firstDay = new Date(y, m - 1, 1).getDay();
    const lastDate = new Date(y, m, 0).getDate();

    let html = `<div class="calendar-grid">`;
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

    weekdays.forEach(wd => html += `<div class="calendar-head">${wd}</div>`);

    for (let i = 0; i < firstDay; i++) {
      html += `<div class="calendar-day empty"></div>`;
    }

    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = daysData.find(x => x.date === dateStr);
      const okCount = dayData ? dayData.ok_count : 0;

      const cls = [
        "calendar-day",
        isSaturday(dateStr) ? "saturday" : "",
        (isSunday(dateStr) || isHoliday(dateStr)) ? "sunday" : "",
        isToday(dateStr) ? "today" : ""
      ].filter(c => c).join(" ");

      html += `
        <div class="${cls}" onclick="openWorkDetail('${dateStr}')">
          <span class="day-num">${d}</span>
          <div class="day-content">
            ${okCount > 0 ? `<span class="count-badge">${okCount}名</span>` : ''}
          </div>
        </div>`;
    }
    html += `</div>`;
    wrap.innerHTML = html;

    state.currentMonthWorkData = daysData;

  } catch (e) {
    wrap.innerHTML = `<p style="padding:24px;color:var(--danger)">エラー: ${e.message}</p>`;
  }
}

/* ---- カレンダー詳細モーダル ---- */
function openWorkDetail(dateStr) {
  const dayData = state.currentMonthWorkData.find(x => x.date === dateStr);
  if (!dayData) return;

  const okMembers = dayData.members.filter(m => String(m.status).toUpperCase() === "OK");
  const ngMembers = dayData.members.filter(m => String(m.status).toUpperCase() === "NG");

  $("modal-title-text").textContent = `${dateStr} (${weekday(dateStr)}) 出勤状況`;

  const memberLink = (m) => {
    if (m.uuid) {
      return `<li>
        <span class="name-link"
              data-uuid="${m.uuid}"
              data-name="${m.name}"
              onclick="openFlightDetailFromWork(this)">${m.name}</span>
      </li>`;
    }
    return `<li>${m.name}</li>`;
  };

  let html = `
    <div class="work-detail-split">
      <div class="detail-section">
        <h4 class="status-ok">○ 出勤可能 (${okMembers.length}名)</h4>
        <ul>${okMembers.map(memberLink).join("") || "<li>なし</li>"}</ul>
      </div>
      <div class="detail-section">
        <h4 class="status-ng">× 出勤不可 (${ngMembers.length}名)</h4>
        <ul>${ngMembers.map(memberLink).join("") || "<li>なし</li>"}</ul>
      </div>
    </div>
    <p class="modal-hint">※ 名前をクリックするとフライト詳細を表示します</p>
  `;

  $("modal-body-content").innerHTML = html;
  $("modal-summary").innerHTML = "";
  $("detail-modal").classList.add("open");
}

/* 出勤可否 → フライト詳細へ遷移 */
async function openFlightDetailFromWork(el) {
  const uuid = el.dataset.uuid;
  const name = el.dataset.name;
  const y = state.wcYear;
  const m = state.wcMonth;

  $("modal-title-text").textContent = `${name}  ${y}年${m}月 フライト詳細`;
  $("modal-body-content").innerHTML = `<p style="padding:28px 20px;color:var(--text-muted)">読み込み中…</p>`;
  $("modal-summary").innerHTML = "";

  try {
    const res  = await fetch(`/api/cont_info/detail/${uuid}?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.data || [];

    if (rows.length === 0) {
      $("modal-body-content").innerHTML =
        `<p style="padding:28px 20px;color:var(--text-muted)">当月のフライトデータがありません</p>`;
      return;
    }

    const { html, summary } = _buildFlightDetailHTML(rows);
    $("modal-body-content").innerHTML = html;
    $("modal-summary").innerHTML = summary;

  } catch (e) {
    $("modal-body-content").innerHTML =
      `<p style="padding:28px 20px;color:var(--danger)">エラー: ${e.message}</p>`;
  }
}

/* ---- wc 月ナビ ---- */
function wcMonthPrev() {
  let { wcYear: y, wcMonth: m } = state;
  if (--m < 1) { m = 12; y--; }
  if (y < TODAY.getFullYear() ||
     (y === TODAY.getFullYear() && m < TODAY.getMonth() + 1)) return;
  state.wcYear = y; state.wcMonth = m;
  loadWorkContract();
}

function wcMonthNext() {
  let { wcYear: y, wcMonth: m } = state;
  if (++m > 12) { m = 1; y++; }
  const max = state.wcMax;
  if (y > max.year || (y === max.year && m > max.month)) return;
  state.wcYear = y; state.wcMonth = m;
  loadWorkContract();
}

function _updateWcNavState() {
  const { wcYear: y, wcMonth: m, wcMax: max } = state;
  const atStart = y === TODAY.getFullYear() && m === TODAY.getMonth() + 1;
  const atEnd   = y === max.year && m === max.month;
  const prev = $("wc-prev-btn");
  const next = $("wc-next-btn");
  if (prev) prev.disabled = atStart;
  if (next) next.disabled = atEnd;
}

/* =========================================================
   引継ぎ報告事項
   ========================================================= */

const HANDOVER_LABELS = {
  near_miss:       "ヒヤリハット",
  improvement:     "営業改善点",
  damaged_section: "機材破損状況",
};

async function loadHandover() {
  const { repYear: y, repMonth: m } = state;
  $("handover-month-label").textContent = `${y}年 ${m}月`;
  const wrap = $("handover-cards");
  wrap.innerHTML = `<p class="loading-text">読み込み中…</p>`;

  try {
    const res  = await fetch(`/api/cont_info/handover?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || [];

    wrap.innerHTML = data.map(item => `
      <div class="handover-card" onclick="openHandoverDetail('${item.category}')">
        <div class="handover-card-label">${item.label}</div>
        <div class="handover-card-count ${item.count > 0 ? 'has-count' : ''}">${item.count}</div>
        <div class="handover-card-unit">件</div>
        <div class="handover-card-hint">クリックして内容を確認</div>
      </div>
    `).join("");

  } catch (e) {
    wrap.innerHTML = `<p style="padding:24px;color:var(--danger)">エラー: ${e.message}</p>`;
  }
}

async function openHandoverDetail(category) {
  const { repYear: y, repMonth: m } = state;
  const label = HANDOVER_LABELS[category] || category;

  $("modal-title-text").textContent = `${y}年${m}月 ${label}`;
  $("modal-body-content").innerHTML = `<p style="padding:28px 20px;color:var(--text-muted)">読み込み中…</p>`;
  $("modal-summary").innerHTML = "";
  $("detail-modal").classList.add("open");

  try {
    const res = await fetch(`/api/cont_info/handover/detail?year=${y}&month=${m}&category=${category}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.data || [];

    if (rows.length === 0) {
      $("modal-body-content").innerHTML =
        `<p style="padding:28px 20px;color:var(--text-muted)">当月の記録はありません</p>`;
      return;
    }

    $("modal-body-content").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>記入日</th>
            <th>記入者</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="white-space:nowrap">${r.date}（${weekday(r.date)}）</td>
              <td style="white-space:nowrap">${r.name}</td>
              <td style="color:var(--text-secondary)">${r.content}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    $("modal-summary").innerHTML =
      `<span>合計：<strong>${rows.length} 件</strong></span>`;

  } catch (e) {
    $("modal-body-content").innerHTML =
      `<p style="padding:28px 20px;color:var(--danger)">エラー: ${e.message}</p>`;
  }
}

/* ---- handover 月ナビ（repYear/repMonth を共用） ---- */
function handoverMonthPrev() {
  let { repYear: y, repMonth: m } = state;
  if (--m < 1) { m = 12; y--; }
  state.repYear = y; state.repMonth = m;
  loadHandover();
}
function handoverMonthNext() {
  let { repYear: y, repMonth: m } = state;
  if (++m > 12) { m = 1; y++; }
  state.repYear = y; state.repMonth = m;
  loadHandover();
}

/* =========================================================
   初期化
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  switchView("flight");
});
