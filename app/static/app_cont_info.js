/* =========================================================
   app_cont_info.js  –  請負管理ページ ロジック
   =========================================================
   Views:
     'flight' → フライト状況（デフォルト）
     'work'   → 出勤可否状況
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
  showAll:   true,            // 全員表示フラグ（デフォルト：全員表示）

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
function isWeekend(dateStr) { const d = new Date(dateStr).getDay(); return d === 0 || d === 6; }
function isToday(dateStr)   { return dateStr === TODAY.toISOString().slice(0, 10); }

function statusIcon(status) {
  if (!status) return `<span class="status-null" title="未入力">　</span>`;
/*  if (!status) return `<span class="status-null" title="未入力">△</span>`; */
  const s = String(status).toUpperCase();
  if (s === "OK") return `<span class="status-ok"  title="出勤可">○</span>`;
  if (s === "NG") return `<span class="status-ng"  title="出勤不可">×</span>`;
  return `<span class="status-null" title="未確認">△</span>`;
}

/* =========================================================
   サイドバー View 切替
   ========================================================= */

function switchView(view) {
  state.currentView = view;

  /* ナビの active */
  document.querySelectorAll(".sidebar-nav .nav-item").forEach(el => {
    el.classList.toggle("active", el.id === `nav-${view}`);
  });

  /* パネルの表示切替 */
  $("view-flight").classList.toggle("hidden", view !== "flight");
  $("view-work").classList.toggle("hidden",   view !== "work");
  $("view-handover").classList.toggle("hidden", view !== "handover");

  /* トップバータイトル */
  const titles = {
    flight:   "✈ フライト状況",
    work:     "📆 出勤可否状況",
    handover: "📋 引継ぎ報告事項",
  };
  $("topbar-title").textContent = titles[view] || "";

  /* 初回ロード */
  if (view === "flight")   loadFlightStatus();
  if (view === "work")     loadWorkContract();
  if (view === "handover") loadHandover();
}

/* =========================================================
   フライト状況
   ========================================================= */

async function loadFlightStatus() {
  const { repYear: y, repMonth: m } = state;
    $("rep-month-label").textContent = `${y}年 ${m}月`;
  const tbody = $("flight-status-body");
  tbody.innerHTML = `<tr class="loading-row"><td colspan="5">読み込み中…</td></tr>`;

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
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">フライトデータがありません（「全員表示」で確認できます）</td></tr>`;
      return;
    }

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

    /* 合計行 */
    const totals = rows.reduce((acc, r) => {
      acc.flight_days        += r.flight_days;
      acc.total_flights      += r.total_flights;
      acc.mini_guarantee_days += r.mini_guarantee_days;
      acc.total_amount       += r.total_amount;
      return acc;
    }, { flight_days: 0, total_flights: 0, mini_guarantee_days: 0, total_amount: 0 });

    const tfoot = $("flight-status-foot");
    if (tfoot) {
      tfoot.innerHTML = `
        <tr class="total-row">
          <td class="col-name"><strong>合計</strong></td>
          <td class="col-num center"><strong>${fmt(totals.flight_days)}</strong></td>
          <td class="col-num center"><strong>${fmt(totals.total_flights)}</strong></td>
          <td class="col-num center"><strong>${fmt(totals.mini_guarantee_days)}</strong></td>
          <td class="col-amount right amount"><strong>${yen(totals.total_amount)}</strong></td>
        </tr>
      `;
    }

  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">エラー: ${e.message}</td></tr>`;
  }
}

/* ---- rep 月ナビ ---- */
function repMonthPrev() {
  let { repYear: y, repMonth: m } = state;
  if (--m < 1) { m = 12; y--; }
  state.repYear = y; state.repMonth = m;
  loadFlightStatus();
}
function repMonthNext() {
  let { repYear: y, repMonth: m } = state;
  if (++m > 12) { m = 1; y++; }
  state.repYear = y; state.repMonth = m;
  loadFlightStatus();
}

/* ---- 全員表示トグル ---- */
function toggleShowAll() {
  state.showAll = !state.showAll;
  $("btn-show-all").textContent = state.showAll ? "フライトありのみ" : "全員表示";
  loadFlightStatus();
}

/* =========================================================
   詳細モーダル
   ========================================================= */

async function openDetail(el) {
  const uuid = el.dataset.uuid;
  const name = el.dataset.name;
  const { repYear: y, repMonth: m } = state;

  $("modal-title-text").textContent  = `${name}  ${y}年${m}月 フライト詳細`;
  $("modal-body-content").innerHTML  = `<p style="padding:28px 20px;color:var(--text-muted)">読み込み中…</p>`;
  $("modal-summary").innerHTML       = "";
  $("detail-modal").classList.add("open");

  try {
    const res  = await fetch(`/api/cont_info/detail/${uuid}?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.data || [];

    if (rows.length === 0) {
      $("modal-body-content").innerHTML =
        `<p style="padding:28px 20px;color:var(--text-muted)">当月のデータがありません</p>`;
      return;
    }

    const totalFlights = rows.reduce((s, r) => s + r.daily_flight, 0);
    const totalAmount  = rows.reduce((s, r) => s + r.total_amount,  0);

    $("modal-body-content").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>日付</th>
            <th class="center">フライト本数</th>
            <th class="right">金額</th>
            <th class="center">最低保証</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.flight_date}（${weekday(r.flight_date)}）</td>
              <td class="center">${fmt(r.daily_flight)}</td>
              <td class="right amount">${yen(r.total_amount)}</td>
              <td class="center">${r.mini_guarantee
                ? '<span class="status-ok" title="最低保証あり">○</span>'
                : '—'}
              </td>
              <td style="color:var(--text-secondary)">${r.notes || '—'}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    $("modal-summary").innerHTML = `
      <span>合計フライト：<strong>${fmt(totalFlights)} 本</strong></span>
      <span>合計金額：<strong>${yen(totalAmount)}</strong></span>
    `;

  } catch (e) {
    $("modal-body-content").innerHTML =
      `<p style="padding:28px 20px;color:var(--danger)">エラー: ${e.message}</p>`;
  }
}

function closeDetail() {
  $("detail-modal").classList.remove("open");
}

/* オーバーレイクリックで閉じる */
document.addEventListener("click", e => {
  if (e.target.id === "detail-modal") closeDetail();
});

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

    const daysData = json.days || []; // APIから取得した日付ごとのデータ
    
    // カレンダーの生成
    const firstDay = new Date(y, m - 1, 1).getDay(); // 月初めの曜日
    const lastDate = new Date(y, m, 0).getDate();    // 月末の日付
    
    let html = `<div class="calendar-grid">`;
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    
    // 曜日ヘッダー
    weekdays.forEach(wd => html += `<div class="calendar-head">${wd}</div>`);

    // 空白埋め
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="calendar-day empty"></div>`;
    }

    // 日付マス
    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = daysData.find(x => x.date === dateStr);
      const okCount = dayData ? dayData.ok_count : 0;
      
      const cls = [
        "calendar-day",
        isWeekend(dateStr) ? "weekend" : "",
        isToday(dateStr) ? "today" : ""
      ].join(" ");

      // マスの中身
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

    // クリックイベント用にデータを保持（グローバルまたはstateに）
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

    const totalFlights = rows.reduce((s, r) => s + r.daily_flight, 0);
    const totalAmount  = rows.reduce((s, r) => s + r.total_amount,  0);

    $("modal-body-content").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>日付</th>
            <th class="center">フライト本数</th>
            <th class="right">金額</th>
            <th class="center">最低保証</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.flight_date}（${weekday(r.flight_date)}）</td>
              <td class="center">${fmt(r.daily_flight)}</td>
              <td class="right amount">${yen(r.total_amount)}</td>
              <td class="center">${r.mini_guarantee
                ? '<span class="status-ok" title="最低保証あり">○</span>'
                : '—'}</td>
              <td style="color:var(--text-secondary)">${r.notes || '—'}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    $("modal-summary").innerHTML = `
      <span>合計フライト：<strong>${fmt(totalFlights)} 本</strong></span>
      <span>合計金額：<strong>${yen(totalAmount)}</strong></span>
    `;
  } catch (e) {
    $("modal-body-content").innerHTML =
      `<p style="padding:28px 20px;color:var(--danger)">エラー: ${e.message}</p>`;
  }
}

/* ---- wc 月ナビ ---- */
function wcMonthPrev() {
  let { wcYear: y, wcMonth: m } = state;
  if (--m < 1) { m = 12; y--; }
  /* 当月より前には戻れない */
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
  /* 初期ビューはフライト状況 */
  switchView("flight");
});
