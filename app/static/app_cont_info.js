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
  showAll:   false,           // 全員表示フラグ

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

  /* トップバータイトル */
  const titles = {
    flight: "✈ フライト状況",
    work:   "📆 出勤可否状況",
  };
  $("topbar-title").textContent = titles[view] || "";

  /* 初回ロード */
  if (view === "flight") loadFlightStatus();
  if (view === "work")   loadWorkContract();
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
      <tr>
        <td class="col-name">
          <span class="name-link"
                data-uuid="${r.uuid}"
                data-name="${r.name}"
                onclick="openDetail(this)">${r.name}</span>
        </td>
        <td class="col-num center">${fmt(r.flight_days)}</td>
        <td class="col-num center">${fmt(r.total_flights)}</td>
        <td class="col-amount right amount">${yen(r.total_amount)}</td>
        <td class="col-action center">
          <button class="btn btn-ghost btn-sm"
                  data-uuid="${r.uuid}"
                  data-name="${r.name}"
                  onclick="openDetail(this)">詳細</button>
        </td>
      </tr>
    `).join("");

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
   出勤可否状況
   ========================================================= */

async function loadWorkContract() {
  const { wcYear: y, wcMonth: m } = state;
  $("wc-month-label").textContent = `${y}年 ${m}月`;
  _updateWcNavState();

  const wrap = $("wc-table-wrap");
  wrap.innerHTML = `<p class="loading-text">読み込み中…</p>`;

  try {
    const res  = await fetch(`/api/cont_info/work_monthly?year=${y}&month=${m}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const members = json.members || [];
    const days    = json.days    || [];

    if (members.length === 0) {
      wrap.innerHTML = `<p class="loading-text">対象メンバーがいません</p>`;
      return;
    }

    const memberHeaders = members.map(mem =>
      `<th class="member-col" title="${mem.name}">${mem.name}</th>`
    ).join("");

    const bodyRows = days.map(day => {
      const cls = [
        isWeekend(day.date) ? "weekend"   : "",
        isToday(day.date)   ? "today-row" : "",
      ].filter(Boolean).join(" ");

      const d = new Date(day.date);
      const label = `${d.getMonth() + 1}/${d.getDate()}（${weekday(day.date)}）`;

      const cells = members.map(mem => {
        const ms = day.members.find(x => x.uuid === mem.uuid);
        return `<td class="member-status">${statusIcon(ms ? ms.status : null)}</td>`;
      }).join("");

      return `
        <tr class="${cls}">
          <td class="date-col">${label}</td>
          <td class="ok-col">${day.ok_count > 0 ? day.ok_count : "—"}</td>
          ${cells}
        </tr>
      `;
    }).join("");

    wrap.innerHTML = `
      <table class="wc-table">
        <thead>
          <tr>
            <th class="date-col">日付</th>
            <th class="ok-col">○数</th>
            ${memberHeaders}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;

  } catch (e) {
    wrap.innerHTML = `<p style="padding:24px;color:var(--danger)">エラー: ${e.message}</p>`;
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
   初期化
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  /* 初期ビューはフライト状況 */
  switchView("flight");
});
