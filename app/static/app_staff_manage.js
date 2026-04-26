/* =============================================================
   app_staff_manage.js  rev.8（改定6 2026-04-20）

   変更点:
     1. レイアウト刷新に伴うUI再設計
        - 各種申請/更新バナー（フライヤー申請未＋フライヤー更新・変更未 合算）
        - 期限前/期限切れバナー（未案内件数で有/無表示）
        - バナークリックで詳細テーブルをカレンダー上部に展開
     2. 月次カレンダー追加
        - 前月/翌月ナビ、当日フォーカス
        - 平日黒/土曜青/日曜・祝日赤
        - 日付マスにツアー・体験予約件数・入山未入金件数表示
        - 日付またはラベルクリックでカレンダー下に詳細表示
     3. 既存モーダル（ツアー承認、体験予約詳細、入金確認、
        更新申請承認/却下、期限案内メール）は全て維持
     4. 改定6: 各種申請/更新 詳細からツアー申請（未承認）テーブルを削除
   ============================================================= */

"use strict";

// ── グローバル変数 ───────────────────────────────────────────
let pendingConfirm = null;
let pendingAppId   = null;
let _rejectMode    = false;

// ダッシュボードデータキャッシュ
let _dashData = null;

// カレンダー
let _calYear  = null;
let _calMonth = null;
let _calData  = null;        // /api/staff/calendar のレスポンス
let _holidays = {};          // { "YYYY-MM-DD": "祝日名" }
let _activeBanner = null;    // 現在展開中バナー ("apply" | "expiry" | null)
let _activeCalDate = null;   // 現在展開中カレンダー日付 ("YYYY-MM-DD" | null)

// =============================================================
// 起動
// =============================================================
document.addEventListener("DOMContentLoaded", async () => {
  const today = new Date();
  _calYear  = today.getFullYear();
  _calMonth = today.getMonth() + 1;

  // ナビボタン
  document.getElementById("calPrev").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("calNext").addEventListener("click", () => shiftMonth(+1));

  // バナークリック
  document.getElementById("applyBannerBtn").addEventListener("click",  () => toggleBanner("apply"));
  document.getElementById("expiryBannerBtn").addEventListener("click", () => toggleBanner("expiry"));

  // データ読み込み
  await Promise.all([
    loadDashboard(),
    loadHolidays(_calYear),
  ]);
  await loadCalendar();
});

// =============================================================
// ダッシュボードデータ読み込み（バナー用）
// =============================================================
async function loadDashboard() {
  try {
    const res = await fetch("/api/staff/dashboard");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _dashData = await res.json();
    renderBanners();
  } catch (e) {
    console.error("ダッシュボード読み込みエラー:", e);
    document.getElementById("applyBannerStatus").textContent  = "—";
    document.getElementById("expiryBannerStatus").textContent = "—";
  }
}

// =============================================================
// バナー描画
// =============================================================
function renderBanners() {
  if (!_dashData) return;

  // 各種申請/更新 = フライヤー申請(未) + フライヤー更新・変更(未)
  // ※ ツアー申請はカレンダーで表示するため件数に含めない
  const flyerTotal  = (_dashData.flyer       || {}).total || 0;
  const updateTotal = (_dashData.update_apps || {}).total || 0;
  const applyTotal  = flyerTotal + updateTotal;

  const applyEl = document.getElementById("applyBannerStatus");
  applyEl.textContent = applyTotal > 0 ? "有" : "無";
  applyEl.className   = "banner-status " + (applyTotal > 0 ? "has" : "none");

  // 期限前/期限切れ = 未案内件数（全itemを対象: 案内済みフラグは現状APIにないため総件数で判定）
  const expiryTotal = (_dashData.expiry_alerts || {}).total || 0;
  const expiryEl    = document.getElementById("expiryBannerStatus");
  expiryEl.textContent = expiryTotal > 0 ? "有" : "無";
  expiryEl.className   = "banner-status " + (expiryTotal > 0 ? "has" : "none");
}

// =============================================================
// バナー切り替え（クリックで詳細表示/非表示）
// =============================================================
function toggleBanner(type) {
  const detailWrap = document.getElementById("bannerDetail");

  if (_activeBanner === type) {
    // 同じバナーを再クリック → 閉じる
    _activeBanner = null;
    detailWrap.style.display = "none";
    detailWrap.innerHTML = "";
    document.getElementById("applyBanner").classList.remove("active");
    document.getElementById("expiryBanner").classList.remove("active");
    return;
  }

  _activeBanner = type;
  document.getElementById("applyBanner").classList.toggle("active",  type === "apply");
  document.getElementById("expiryBanner").classList.toggle("active", type === "expiry");

  if (type === "apply") {
    renderApplyDetail(detailWrap);
  } else {
    renderExpiryDetail(detailWrap);
  }
  detailWrap.style.display = "block";
}

// ── 各種申請/更新 詳細 ──────────────────────────────────────
function renderApplyDetail(wrap) {
  if (!_dashData) { wrap.innerHTML = "<p>データなし</p>"; return; }

  const flyer  = _dashData.flyer       || { total: 0, items: [] };
  const update = _dashData.update_apps || { total: 0, items: [] };

  let html = `<div class="detail-section-title">各種申請/更新 詳細</div>`;

  // フライヤー申請（未）
  html += `
    <div class="detail-sub-title">✈ フライヤー申請（未）<span class="detail-cnt">${flyer.total}</span></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>申込日</th><th>氏名</th><th>分類</th></tr></thead>
        <tbody>`;
  if (flyer.items.length === 0) {
    html += `<tr><td colspan="3" class="empty-row">未処理の申請はありません</td></tr>`;
  } else {
    html += flyer.items.map(r => `
      <tr class="clickable-row" onclick="location.href='/apply_info?id=${r.id}&from=flyer'">
        <td>${esc(r.application_date || "—")}</td>
        <td>${esc(r.full_name || "—")}</td>
        <td>${esc(r.member_type || "—")}</td>
      </tr>`).join("");
  }
  html += `</tbody></table></div>`;

  // フライヤー更新・変更（未）
  const typeStyle = {
    "renewal":       "background:#0984e3; color:#fff;",
    "course_change": "background:#6c5ce7; color:#fff;",
    "info_change":   "background:#00b894; color:#fff;",
  };
  html += `
    <div class="detail-sub-title" style="margin-top:14px;">📝 フライヤー更新・変更（未）<span class="detail-cnt">${update.total}</span></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>申請日時</th><th>氏名</th><th>会員番号</th><th>種別</th></tr></thead>
        <tbody>`;
  if (update.items.length === 0) {
    html += `<tr><td colspan="4" class="empty-row">未処理の更新・変更申請はありません</td></tr>`;
  } else {
    html += update.items.map(r => {
      const style = typeStyle[r.application_type] || "background:#636e72; color:#fff;";
      return `
      <tr class="clickable-row"
        onclick="location.href='/apply_info?id=${r.member_id || ""}&from=update_app'">
        <td>${esc(r.applied_at || "—")}</td>
        <td>${esc(r.full_name  || "—")}</td>
        <td>${esc(r.member_number || "—")}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;${style}">${esc(r.type_label || r.application_type)}</span></td>
      </tr>`;
    }).join("");
  }
  html += `</tbody></table></div>`;

  wrap.innerHTML = html;
}

// ── 期限前/期限切れ 詳細 ────────────────────────────────────
function renderExpiryDetail(wrap) {
  if (!_dashData) { wrap.innerHTML = "<p>データなし</p>"; return; }
  const expiry = _dashData.expiry_alerts || { total: 0, items: [] };

  const statusStyle = { expired: "background:#d63031; color:#fff;", soon: "background:#e17055; color:#fff;" };
  const statusLabel = { expired: "期限切れ", soon: "期限前" };
  const typeLabelMap = { "年会員": "年会員", "スクール": "スクール", "冬季会員": "冬季会員", "reglimit": "—", "repack": "—" };

  let html = `<div class="detail-section-title">フライヤー各種期限前/期限切れ 詳細</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>期限項目</th><th>期限分類</th><th>期限日</th><th>分類</th><th>名前</th><th>技能証</th><th>案内</th></tr></thead>
        <tbody>`;

  if (expiry.items.length === 0) {
    html += `<tr><td colspan="7" class="empty-row">期限切れ・期限前の項目はありません</td></tr>`;
  } else {
    html += expiry.items.map(row => {
      const sstyle  = statusStyle[row.status] || "background:#636e72; color:#fff;";
      const slabel  = statusLabel[row.status] || row.status;
      const expStr  = row.exp_date ? row.exp_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3") : "—";
      const typeDisp = typeLabelMap[row.item_type] ?? row.item_type ?? "—";
      return `
      <tr>
        <td>${esc(row.label || row.item)}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;${sstyle}">${slabel}</span></td>
        <td>${expStr}</td>
        <td>${typeDisp}</td>
        <td><a href="/apply_info?id=${row.member_id}" style="color:#2563eb;text-decoration:none;font-weight:500;">${esc(row.full_name)}</a></td>
        <td>${esc(row.license || "—")}</td>
        <td>
          <button data-mid="${row.member_id}" data-name="${esc(row.full_name)}"
            data-email="${esc(row.email||'')}" data-label="${esc(row.label||row.item)}" data-exp="${expStr}"
            class="expiry-mail-btn"
            style="padding:4px 10px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
            案内
          </button>
        </td>
      </tr>`;
    }).join("");
  }
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;

  // 案内ボタン再バインド
  wrap.querySelectorAll(".expiry-mail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      openExpiryMailModal(
        btn.dataset.mid,
        btn.dataset.name,
        btn.dataset.email,
        btn.dataset.label,
        btn.dataset.exp
      );
    });
  });
}

// =============================================================
// 祝日取得（holidays-jp GitHub API）
// =============================================================
async function loadHolidays(year) {
  try {
    const res = await fetch(`https://holidays-jp.github.io/api/v1/${year}/date.json`);
    if (!res.ok) return;
    const data = await res.json();
    Object.assign(_holidays, data);
    // 翌年分も取得（12月表示時に翌1月分が必要な場合に備え）
    if (year < new Date().getFullYear() + 1) {
      const res2 = await fetch(`https://holidays-jp.github.io/api/v1/${year + 1}/date.json`);
      if (res2.ok) Object.assign(_holidays, await res2.json());
    }
  } catch { /* 祝日取得失敗は無視 */ }
}

// =============================================================
// カレンダーデータ読み込み＆描画
// =============================================================
async function loadCalendar() {
  document.getElementById("calMonthLabel").textContent =
    `${_calYear}年 ${_calMonth}月`;
  document.getElementById("calendarCells").innerHTML =
    `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#999;">読み込み中...</div>`;

  try {
    const res = await fetch(`/api/staff/calendar?year=${_calYear}&month=${_calMonth}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _calData = await res.json();
    renderCalendar();
  } catch (e) {
    console.error("カレンダー取得エラー:", e);
    document.getElementById("calendarCells").innerHTML =
      `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#d63031;">カレンダーデータの取得に失敗しました</div>`;
  }
}

function shiftMonth(delta) {
  _activeCalDate = null;
  document.getElementById("calDetail").style.display = "none";
  document.getElementById("calDetail").innerHTML = "";

  _calMonth += delta;
  if (_calMonth > 12) { _calMonth = 1;  _calYear++; }
  if (_calMonth < 1)  { _calMonth = 12; _calYear--; }
  loadCalendar();
}

// =============================================================
// カレンダー描画
// =============================================================
function renderCalendar() {
  const cells    = document.getElementById("calendarCells");
  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  // 月初の曜日（0=日）
  const firstDow = new Date(_calYear, _calMonth - 1, 1).getDay();
  // 日数
  const numDays  = new Date(_calYear, _calMonth, 0).getDate();

  // dayMap: "YYYY-MM-DD" -> dayObj
  const dayMap = {};
  (_calData?.days || []).forEach(d => { dayMap[d.date] = d; });

  let html = "";

  // 空白セル（月初前）
  for (let i = 0; i < firstDow; i++) {
    html += `<div class="cal-cell empty"></div>`;
  }

  for (let day = 1; day <= numDays; day++) {
    const dateStr = `${_calYear}-${String(_calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const dow     = new Date(_calYear, _calMonth - 1, day).getDay(); // 0=日
    const isHoliday = !!_holidays[dateStr];
    const isToday   = dateStr === todayStr;

    let colorClass = "weekday";
    if (dow === 0 || isHoliday) colorClass = "sunday";
    else if (dow === 6)         colorClass = "saturday";

    const d = dayMap[dateStr] || { tours: [], exp_count: 0, unpaid: 0 };

    // ツアータグ（未承認があれば赤系「ツアー（未）」、承認済みのみなら黄「ツアー」）
    let tourTags = "";
    if (d.tours.length > 0) {
      const hasPending = d.tours.some(t => t.app_status === "pending");
      if (hasPending) {
        tourTags = `<div class="cal-tour-tag pending" data-date="${dateStr}">ツアー（未）</div>`;
      } else {
        tourTags = `<div class="cal-tour-tag" data-date="${dateStr}">ツアー</div>`;
      }
    }

    // 体験予約
    const expTag = d.exp_count > 0
      ? `<div class="cal-count-tag exp" data-date="${dateStr}">体験 ${d.exp_count}</div>`
      : "";

    // 入山未入金
    const payTag = d.unpaid > 0
      ? `<div class="cal-count-tag pay" data-date="${dateStr}">未入金 ${d.unpaid}</div>`
      : "";

    const hasContent = d.tours.length > 0 || d.exp_count > 0 || d.unpaid > 0;

    html += `
      <div class="cal-cell ${isToday ? "today" : ""} ${hasContent ? "has-data" : ""}"
           data-date="${dateStr}">
        <div class="cal-day-num ${colorClass}">${day}${isHoliday ? `<span class="holiday-dot">●</span>` : ""}</div>
        ${tourTags}${expTag}${payTag}
      </div>`;
  }

  cells.innerHTML = html;

  // セルクリックイベント
  cells.querySelectorAll(".cal-cell:not(.empty)").forEach(cell => {
    cell.addEventListener("click", () => {
      const d = cell.dataset.date;
      if (!d) return;
      openCalDetail(d);
    });
  });
}

// =============================================================
// カレンダー日付クリック → 詳細表示
// =============================================================
function openCalDetail(dateStr) {
  const detailWrap = document.getElementById("calDetail");

  // 同じ日を再クリック → 閉じる
  if (_activeCalDate === dateStr) {
    _activeCalDate = null;
    detailWrap.style.display = "none";
    detailWrap.innerHTML = "";
    // セルのアクティブ解除
    document.querySelectorAll(".cal-cell.selected").forEach(c => c.classList.remove("selected"));
    return;
  }

  _activeCalDate = dateStr;

  // セルのアクティブ表示
  document.querySelectorAll(".cal-cell.selected").forEach(c => c.classList.remove("selected"));
  const cell = document.querySelector(`.cal-cell[data-date="${dateStr}"]`);
  if (cell) cell.classList.add("selected");

  const dayMap = {};
  (_calData?.days || []).forEach(d => { dayMap[d.date] = d; });
  const d = dayMap[dateStr] || { tours: [], exp_count: 0, unpaid: 0 };

  const [y, m, day] = dateStr.split("-");
  const dow = new Date(parseInt(y), parseInt(m)-1, parseInt(day)).getDay();
  const dowLabel = ["日","月","火","水","木","金","土"][dow];
  const holidayName = _holidays[dateStr] || "";

  let html = `
    <div class="cal-detail-header">
      <span>${y}年${parseInt(m)}月${parseInt(day)}日（${dowLabel}）${holidayName ? " " + holidayName : ""}</span>
      <button type="button" class="cal-detail-close-btn" onclick="closeCalDetail()">✕ 閉じる</button>
    </div>`;

  // ── ツアー ──
  html += `<div class="detail-sub-title">🗓 ツアー申込</div>`;
  if (d.tours.length === 0) {
    html += `<p class="detail-empty">この日のツアー申込はありません</p>`;
  } else {
    html += `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>申込番号</th><th>スクール/エリア名</th><th>フライト期間</th><th>ステータス</th></tr></thead>
      <tbody>`;
    d.tours.forEach(t => {
      const statusLabel = { pending: "未承認", confirmed: "承認済", cancelled: "キャンセル" };
      const statusStyle = { pending: "background:#f59e0b;color:#fff;", confirmed: "background:#059669;color:#fff;", cancelled: "background:#9ca3af;color:#fff;" };
      html += `
        <tr class="clickable-row" data-tour-id="${t.id}">
          <td>${esc(t.booking_no || "—")}</td>
          <td>${esc(t.school_name || "—")}</td>
          <td>${esc(t.date_from || "—")} ～ ${esc(t.date_to || "—")}</td>
          <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;${statusStyle[t.app_status]||"background:#636e72;color:#fff;"}">${statusLabel[t.app_status]||t.app_status}</span></td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // ── 体験予約 ──
  html += `<div class="detail-sub-title" style="margin-top:14px;">🪂 体験予約 <span class="detail-cnt">${d.exp_count}</span></div>`;
  if (d.exp_count === 0) {
    html += `<p class="detail-empty">この日の体験予約はありません</p>`;
  } else {
    html += `<div class="table-wrap" id="calExpTableWrap_${dateStr}">
      <p style="color:#999;font-size:13px;padding:8px;">読み込み中...</p></div>`;
  }

  // ── 入山未入金 ──
  html += `<div class="detail-sub-title" style="margin-top:14px;">⛰ 入山未入金 <span class="detail-cnt">${d.unpaid}</span></div>`;
  if (d.unpaid === 0) {
    html += `<p class="detail-empty">この日の未入金はありません</p>`;
  } else {
    html += `<div class="table-wrap" id="calPayTableWrap_${dateStr}">
      <p style="color:#999;font-size:13px;padding:8px;">読み込み中...</p></div>`;
  }

  detailWrap.innerHTML = html;
  detailWrap.style.display = "block";

  // カレンダー詳細が画面に収まるようスクロール
  requestAnimationFrame(() => {
    detailWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ツアー行クリック
  detailWrap.querySelectorAll("tr[data-tour-id]").forEach(tr => {
    const tid = parseInt(tr.dataset.tourId);
    const tourObj = d.tours.find(t => t.id === tid);
    if (tourObj) {
      tr.addEventListener("click", () => openTourModalFromCalendar(tourObj));
    }
  });

  // 体験予約・入山未入金を非同期で追加取得
  if (d.exp_count > 0)  loadCalExpDetail(dateStr);
  if (d.unpaid > 0)     loadCalPayDetail(dateStr);
}

// カレンダー詳細を閉じる
function closeCalDetail() {
  _activeCalDate = null;
  const detailWrap = document.getElementById("calDetail");
  detailWrap.style.display = "none";
  detailWrap.innerHTML = "";
  document.querySelectorAll(".cal-cell.selected").forEach(c => c.classList.remove("selected"));
}

// カレンダーからツアーモーダルを開く（承認済みは承認ボタン非表示）
function openTourModalFromCalendar(tourData) {
  _currentTourData = tourData;
  const modal = document.getElementById("tourModal");
  if (!modal) return;

  document.getElementById("tourModalTitle").textContent =
    `ツアー詳細　${esc(tourData.booking_no || "")}`;

  document.getElementById("tourModalBody").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><th style="text-align:left;padding:6px 8px;color:#555;width:40%;border-bottom:1px solid #f0f0f0;">申込番号</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(tourData.booking_no || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;border-bottom:1px solid #f0f0f0;">スクール/エリア名</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(tourData.school_name || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;border-bottom:1px solid #f0f0f0;">フライト期間</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(tourData.date_from || "—")} ～ ${esc(tourData.date_to || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;">ステータス</th>
          <td style="padding:6px 8px;">${esc(tourData.app_status || "—")}</td></tr>
    </table>`;

  // 未承認の場合のみ承認ボタン表示
  const approveBtn = document.getElementById("tourApproveBtn");
  if (approveBtn) approveBtn.style.display = tourData.app_status === "pending" ? "" : "none";

  modal.style.display = "flex";
}

// 体験予約詳細取得（カレンダー用）
async function loadCalExpDetail(dateStr) {
  const wrap = document.getElementById(`calExpTableWrap_${dateStr}`);
  if (!wrap) return;
  try {
    const res = await fetch(`/api/exp/reservations?date=${dateStr}`);
    let items = [];
    if (res.ok) {
      const data = await res.json();
      items = Array.isArray(data) ? data : (data.items || []);
    }
    if (items.length === 0) {
      wrap.innerHTML = `<p class="detail-empty">データなし</p>`;
      return;
    }
    let html = `<table class="data-table">
      <thead><tr><th>予約番号</th><th>氏名</th><th>種別</th><th>TEL</th><th>ステータス</th></tr></thead>
      <tbody>`;
    html += items.map(r => `
      <tr class="clickable-row" onclick="location.href='/apply_exp_resv?id=${r.id}&from=staff_manage'">
        <td>${esc(r.reservation_no ? (r.reservation_type === "para" ? "P-" : "C-") + String(r.reservation_no).padStart(4,"0") : "—")}</td>
        <td>${esc(r.name || "—")}</td>
        <td>${esc(r.reservation_type === "para" ? "パラグライダー" : "キャンプ")}</td>
        <td>${esc(r.phone || "—")}</td>
        <td>${esc(r.status || "—")}</td>
      </tr>`).join("");
    html += `</tbody></table>`;
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<p style="color:#d63031;font-size:13px;">取得失敗: ${esc(e.message)}</p>`;
  }
}

// 入山未入金詳細取得（カレンダー用）
async function loadCalPayDetail(dateStr) {
  const wrap = document.getElementById(`calPayTableWrap_${dateStr}`);
  if (!wrap) return;
  try {
    const res = await fetch(`/api/staff/calendar_pay?date=${dateStr}`);
    let items = [];
    if (res.ok) {
      const data = await res.json();
      items = Array.isArray(data) ? data : (data.items || []);
    }
    if (items.length === 0) {
      wrap.innerHTML = `<p class="detail-empty">データなし</p>`;
      return;
    }
    let html = `<table class="data-table">
      <thead><tr><th>氏名</th><th>会員番号</th><th>分類</th><th>種別</th></tr></thead>
      <tbody>`;
    html += items.map(r => {
      const isYamachin = r.confirm_type === "yamachin";
      const typeTag = isYamachin
        ? `<span class="type-tag yamachin">山チン</span>`
        : `<span class="type-tag entrance">入山料</span>`;
      const nameEsc  = esc(r.full_name    || "—");
      const dateEsc  = esc(r.flight_date  || "—");
      const ctype    = esc(r.confirm_type || "entrance");
      return `
      <tr class="clickable-row"
          onclick="openConfirmModal(${r.id}, '${ctype}', '${nameEsc}', '${dateEsc}')">
        <td>${nameEsc}</td>
        <td>${esc(r.member_number || "—")}</td>
        <td>${esc(r.member_type   || "—")}</td>
        <td>${typeTag}</td>
      </tr>`;
    }).join("");
    html += `</tbody></table>`;
    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<p style="color:#d63031;font-size:13px;">取得失敗: ${esc(e.message)}</p>`;
  }
}

// =============================================================
// ① ツアー申請詳細モーダル（バナー詳細側から）
// =============================================================
let _currentTourData = null;

function openTourModal(rowData) {
  _currentTourData = typeof rowData === "string" ? JSON.parse(rowData) : rowData;
  const modal = document.getElementById("tourModal");
  if (!modal) return;

  document.getElementById("tourModalTitle").textContent =
    `ツアー申請詳細　${esc(_currentTourData.booking_no || "")}`;

  const period = (_currentTourData.flight_date_from && _currentTourData.flight_date_to)
    ? `${_currentTourData.flight_date_from} ～ ${_currentTourData.flight_date_to}`
    : "—";

  document.getElementById("tourModalBody").innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><th style="text-align:left;padding:6px 8px;color:#555;width:40%;border-bottom:1px solid #f0f0f0;">申込番号</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(_currentTourData.booking_no || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;border-bottom:1px solid #f0f0f0;">スクール/エリア名</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(_currentTourData.school_name || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;border-bottom:1px solid #f0f0f0;">連絡先メール</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(_currentTourData.contact_email || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;border-bottom:1px solid #f0f0f0;">フライト期間</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(period)}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;border-bottom:1px solid #f0f0f0;">代表引率者</th>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${esc(_currentTourData.leader_name || "—")}</td></tr>
      <tr><th style="text-align:left;padding:6px 8px;color:#555;">申込日</th>
          <td style="padding:6px 8px;">${esc(_currentTourData.created_at || "—")}</td></tr>
    </table>`;

  const approveBtn = document.getElementById("tourApproveBtn");
  if (approveBtn) approveBtn.style.display = "";

  modal.style.display = "flex";
}

function closeTourModal() {
  const modal = document.getElementById("tourModal");
  if (modal) modal.style.display = "none";
}

function openTourEdit() {
  if (!_currentTourData) return;
  closeTourModal();
  window.location.href = `/apply_tour?edit=${encodeURIComponent(_currentTourData.booking_no || _currentTourData.id)}&from=staff_manage`;
}

// =============================================================
// ツアー承認・案内メール送信
// =============================================================
async function doApproveTour() {
  if (!_currentTourData) return;
  closeTourModal();
  await openTourMailModal(_currentTourData);
}

async function openTourMailModal(tourData) {
  document.getElementById("tourMailBookingId").value = tourData.id;
  document.getElementById("tourMailTo").value        = tourData.contact_email || "";

  const fromSel = document.getElementById("tourMailFrom");
  fromSel.innerHTML = "";
  const fromEmails = await _getFromEmails();
  if (fromEmails.length === 0) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "（設定なし）";
    fromSel.appendChild(opt);
  } else {
    fromEmails.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.value;
      opt.textContent = f.label !== f.value ? `${f.label}（${f.value}）` : f.value;
      fromSel.appendChild(opt);
    });
  }

  const period = (tourData.flight_date_from && tourData.flight_date_to)
    ? `${tourData.flight_date_from} ～ ${tourData.flight_date_to}`
    : (tourData.date_from && tourData.date_to)
    ? `${tourData.date_from} ～ ${tourData.date_to}` : "—";

  document.getElementById("tourMailSubject").value =
    `【Mt.FUJI PARAGLIDING】ツアー申込承認のご連絡（${tourData.booking_no}）`;
  document.getElementById("tourMailBody").value =
    `${esc(tourData.school_name)} 御中\n\n` +
    `この度はツアー申込をいただきありがとうございます。\n\n` +
    `以下の内容でツアー申込を承認いたしました。\n\n` +
    `申込番号：${tourData.booking_no}\n` +
    `フライト期間：${period}\n\n` +
    `当日はスタッフまでお声がけください。\n\n` +
    `Mt.FUJI PARAGLIDING スタッフ`;

  document.getElementById("tourMailModal").style.display = "flex";
}

function closeTourMailModal() {
  document.getElementById("tourMailModal").style.display = "none";
}

async function doSendTourMail() {
  const bookingId = document.getElementById("tourMailBookingId").value;
  const fromEmail = document.getElementById("tourMailFrom").value.trim();
  const toEmail   = document.getElementById("tourMailTo").value.trim();
  const subject   = document.getElementById("tourMailSubject").value.trim();
  const body      = document.getElementById("tourMailBody").value.trim();

  if (!fromEmail || !toEmail || !subject) {
    alert("送信元・送信先・件名は必須です");
    return;
  }

  const sendBtn = document.getElementById("tourMailSendBtn");
  sendBtn.disabled    = true;
  sendBtn.textContent = "送信中...";

  try {
    const confirmRes = await fetch(`/api/tour/bookings/${bookingId}/confirm`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    });
    if (!confirmRes.ok) throw new Error("ステータス更新に失敗しました");

    const mailRes = await fetch("/api/staff/send_tour_mail", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ from_email: fromEmail, to_email: toEmail, subject, body }),
    });
    const mailData = await mailRes.json();
    if (!mailRes.ok) throw new Error(mailData.error || "メール送信に失敗しました");

    closeTourMailModal();
    alert("承認しました。案内メールを送信しました。");
    await loadDashboard();
    await loadCalendar();
  } catch (e) {
    alert("エラー: " + e.message);
  } finally {
    sendBtn.disabled    = false;
    sendBtn.textContent = "📨 送信する";
  }
}

// =============================================================
// フライヤー更新・変更モーダル
// =============================================================
function openUpdateAppModal(appId, fullName, appliedAt, appType, typeLabel, changesJsonStr) {
  pendingAppId = appId;
  _rejectMode  = false;

  document.getElementById("updateAppModalTitle").textContent = `${typeLabel}申請の確認`;
  document.getElementById("updateAppModalMeta").textContent  = `申請者：${fullName}　申請日時：${appliedAt}`;

  let changes = {};
  try { changes = JSON.parse(changesJsonStr); } catch { changes = {}; }

  const fieldLabels = {
    member_type: "コース（分類）", course_name: "コース内容",
    full_name: "氏名", furigana: "ふりがな", gender: "性別",
    blood_type: "血液型", birthday: "生年月日", weight: "体重",
    zip_code: "郵便番号", address: "住所", mobile_phone: "携帯番号",
    home_phone: "自宅番号", email: "Email",
    company_name: "勤務先", company_phone: "勤務先電話番号",
    emergency_name: "緊急連絡先氏名", emergency_phone: "緊急連絡先番号",
    medical_history: "傷病履歴", relationship: "本人との続柄",
    glider_name: "使用機体", glider_color: "機体カラー",
    home_area: "ホームエリア", organization: "所属団体",
    reg_no: "フライヤー登録番号", reglimit_date: "登録期限",
    license: "技能証", repack_date: "リパック日",
  };

  const entries = Object.entries(changes);
  if (entries.length === 0) {
    document.getElementById("updateAppChangeList").innerHTML = `<p style="color:#999;">変更内容がありません</p>`;
  } else {
    document.getElementById("updateAppChangeList").innerHTML = entries.map(([k, v]) => `
      <div style="display:flex; gap:8px; padding:4px 0; border-bottom:1px solid #f0f0f0;">
        <span style="min-width:130px; color:#636e72; font-size:12px;">${esc(fieldLabels[k] || k)}</span>
        <span style="color:#2d3436; font-weight:500;">${esc(v || "（削除）")}</span>
      </div>`).join("");
  }

  document.getElementById("updateAppRejectRow").style.display  = "none";
  document.getElementById("updateAppRejectNote").value         = "";
  document.getElementById("btnRejectToggle").textContent       = "却下";
  document.getElementById("btnApprove").style.display          = "";

  const existing = document.getElementById("btnRejectConfirm");
  if (existing) existing.remove();
  _rejectMode = false;

  document.getElementById("updateAppModal").style.display = "flex";
}

function closeUpdateAppModal() {
  pendingAppId = null;
  _rejectMode  = false;
  document.getElementById("updateAppModal").style.display = "none";
}

function toggleRejectMode() {
  _rejectMode = !_rejectMode;
  document.getElementById("updateAppRejectRow").style.display = _rejectMode ? "" : "none";
  document.getElementById("btnRejectToggle").textContent      = _rejectMode ? "却下をやめる" : "却下";
  document.getElementById("btnApprove").style.display         = _rejectMode ? "none" : "";

  const existing = document.getElementById("btnRejectConfirm");
  if (_rejectMode && !existing) {
    const btn = document.createElement("button");
    btn.id        = "btnRejectConfirm";
    btn.textContent = "却下を確定";
    btn.style.cssText = "background:#d63031; color:#fff; border:none; padding:8px 18px; border-radius:6px; cursor:pointer; font-size:14px;";
    btn.addEventListener("click", doRejectApp);
    document.querySelector("#updateAppModal .modal-actions").appendChild(btn);
  } else if (!_rejectMode && existing) {
    existing.remove();
  }
}

async function doApproveApp() {
  if (!pendingAppId) return;
  try {
    const res = await fetch(`/api/applications/${pendingAppId}/approve`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed_by: "staff" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeUpdateAppModal();
    await loadDashboard();
  } catch (e) {
    alert("承認に失敗しました: " + e.message);
  }
}

async function doRejectApp() {
  if (!pendingAppId) return;
  const note = document.getElementById("updateAppRejectNote").value.trim();
  try {
    const res = await fetch(`/api/applications/${pendingAppId}/reject`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: note }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeUpdateAppModal();
    await loadDashboard();
  } catch (e) {
    alert("却下に失敗しました: " + e.message);
  }
}

// =============================================================
// 体験予約モーダル
// =============================================================
let _currentExpId = null;

async function openExpModal(id) {
  _currentExpId = id;
  const modal = document.getElementById("expModal");
  if (!modal) return;
  document.getElementById("expModalBody").innerHTML =
    `<p style="text-align:center;color:#999;padding:24px;">読み込み中...</p>`;
  modal.style.display = "flex";
  try {
    const res = await fetch(`/api/exp/reservations/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    renderExpModalBody(d);
  } catch (e) {
    document.getElementById("expModalBody").innerHTML =
      `<p style="color:#d63031;padding:12px;">データ取得に失敗しました（${esc(e.message)}）</p>`;
  }
}

function renderExpModalBody(d) {
  const type = d.reservation_type;
  const p    = d.para  || {};
  const c    = d.camp  || {};
  const rows = [
    ["種別",     type === "para" ? "パラグライダー" : "キャンプ"],
    ["予約番号", type === "para"
        ? `P-${String(d.reservation_no).padStart(4,"0")}`
        : `C-${String(d.reservation_no).padStart(4,"0")}`],
    ["予約日",   d.reservation_date || "—"],
    ["氏名",     d.name             || "—"],
    ["電話番号", d.phone            || "—"],
    ["メール",   d.email            || "—"],
  ];
  if (type === "para") {
    rows.push(
      ["人数",       p.pax_count != null ? `${p.pax_count}名` : "—"],
      ["コース",     p.course        || "—"],
      ["集合時間",   p.meeting_time  || "—"],
      ["支払方法",   p.payment_method|| "—"],
      ["請求金額",   d.charge_amount != null ? `${Number(d.charge_amount).toLocaleString()}円` : "—"],
    );
  } else {
    rows.push(
      ["サイト",     c.site_type     || "—"],
      ["大人",       c.adult_count != null ? `${c.adult_count}名` : "—"],
      ["テント",     c.tent_count  != null ? `${c.tent_count}張`  : "—"],
      ["請求金額",   d.charge_amount != null ? `${Number(d.charge_amount).toLocaleString()}円` : "—"],
    );
  }
  rows.push(["担当", d.staff||"—"], ["ステータス", d.status||"—"], ["備考", d.memo||"—"]);

  const resvNo = type === "para"
    ? `P-${String(d.reservation_no).padStart(4,"0")}`
    : `C-${String(d.reservation_no).padStart(4,"0")}`;

  document.getElementById("expModalTitle").textContent = `体験予約詳細（${resvNo} ${d.name || ""}）`;
  document.getElementById("expModalBody").innerHTML = rows.map(([label, val]) => `
    <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;">
      <span style="min-width:110px;color:#636e72;font-size:12px;flex-shrink:0;">${esc(label)}</span>
      <span style="color:#2d3436;font-weight:500;">${esc(String(val))}</span>
    </div>`).join("");
}

function closeExpModal() {
  _currentExpId = null;
  const modal = document.getElementById("expModal");
  if (modal) modal.style.display = "none";
}

async function goToExpDetail() {
  if (_currentExpId) location.href = `/apply_exp_resv?id=${_currentExpId}&from=staff_manage`;
}

// =============================================================
// 入金確認モーダル
// =============================================================
function openConfirmModal(id, type, name, date) {
  pendingConfirm = { id, type };
  const isYamachin = type === "yamachin";
  const kindLabel  = isYamachin ? "山チン" : "入山料";
  document.getElementById("confirmModalTitle").textContent =
    `${kindLabel}の入金確認`;
  document.getElementById("confirmModalText").textContent =
    `「${name}」（${date}）の${kindLabel}を確認済みにしますか？`;
  const btnOk = document.querySelector("#confirmModal .btn-ok");
  btnOk.style.background = isYamachin ? "var(--yamachin-color)" : "var(--success)";
  document.getElementById("confirmModal").style.display = "flex";
}

function closeConfirmModal() {
  pendingConfirm = null;
  document.getElementById("confirmModal").style.display = "none";
}

async function doConfirmPayment() {
  if (!pendingConfirm) return;
  const { id, type } = pendingConfirm;
  try {
    const res = await fetch(`/api/staff/confirm_payment/${id}?type=${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeConfirmModal();
    await loadDashboard();
    await loadCalendar();
    // カレンダー詳細が開いていた日付を再描画
    if (_activeCalDate) openCalDetail(_activeCalDate);
  } catch (e) {
    alert("更新に失敗しました: " + e.message);
    closeConfirmModal();
  }
}

// =============================================================
// 期限アラート案内メールモーダル
// =============================================================
let _fromEmailCache = null;

async function _getFromEmails() {
  if (_fromEmailCache) return _fromEmailCache;
  try {
    // 設定管理「メール関連」カテゴリの「送信元」master を取得
    const res = await fetch("/config/api/masters?category=" + encodeURIComponent("メール関連"));
    if (!res.ok) return [];
    const masters = await res.json();
    const master = masters.find(m => m.item_name === "送信元");
    if (!master) return [];
    const vres = await fetch("/config/api/values/" + master.id);
    if (!vres.ok) return [];
    const vals = await vres.json();
    _fromEmailCache = vals.filter(v => v.is_active).map(v => ({
      value: v.value,
      label: v.label || v.value,
    }));
    return _fromEmailCache;
  } catch { return []; }
}

async function openExpiryMailModal(memberId, fullName, email, itemLabel, expStr) {
  document.getElementById("expiryMailMemberId").value = memberId;
  document.getElementById("expiryMailTo").value       = email || "";

  const fromSel = document.getElementById("expiryMailFrom");
  fromSel.innerHTML = "";
  const fromEmails = await _getFromEmails();
  if (fromEmails.length === 0) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "（設定なし）";
    fromSel.appendChild(opt);
  } else {
    fromEmails.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.value;
      opt.textContent = f.label !== f.value ? `${f.label}（${f.value}）` : f.value;
      fromSel.appendChild(opt);
    });
  }

  document.getElementById("expiryMailSubject").value =
    `【Mt.FUJI PARAGLIDING】${itemLabel}のご案内`;
  document.getElementById("expiryMailBody").value =
    `${fullName} 様\n\n` +
    `いつもMt.FUJI PARAGLIDINGをご利用いただきありがとうございます。\n\n` +
    `${itemLabel}（期限：${expStr}）についてお知らせします。\n\n` +
    `お手続きのご確認をお願いいたします。\n\n` +
    `Mt.FUJI PARAGLIDING スタッフ`;

  document.getElementById("expiryMailModal").style.display = "flex";
}

function closeExpiryMailModal() {
  document.getElementById("expiryMailModal").style.display = "none";
}

async function doSendExpiryMail() {
  const memberId  = document.getElementById("expiryMailMemberId").value;
  const fromEmail = document.getElementById("expiryMailFrom").value.trim();
  const toEmail   = document.getElementById("expiryMailTo").value.trim();
  const subject   = document.getElementById("expiryMailSubject").value.trim();
  const body      = document.getElementById("expiryMailBody").value.trim();

  if (!fromEmail || !toEmail || !subject) {
    alert("送信元・送信先・件名は必須です");
    return;
  }

  const sendBtn = document.getElementById("expiryMailSendBtn");
  sendBtn.disabled    = true;
  sendBtn.textContent = "送信中...";

  try {
    const res = await fetch(`/api/staff/send_expiry_alert/${memberId}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ from_email: fromEmail, to_email: toEmail, subject, body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "送信失敗");
    closeExpiryMailModal();
    alert(data.message || "案内メールを送信しました");
  } catch (e) {
    alert("送信に失敗しました: " + e.message);
  } finally {
    sendBtn.disabled    = false;
    sendBtn.textContent = "📨 送信する";
  }
}

// =============================================================
// ユーティリティ
// =============================================================
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
