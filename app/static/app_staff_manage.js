/* =============================================================
   app_staff_manage.js  rev.2
   ============================================================= */

"use strict";

// 入金確認モーダル用の状態
let pendingConfirm = null; // { id, type: 'entrance' | 'yamachin', label }

// =============================================================
// 起動
// =============================================================
document.addEventListener("DOMContentLoaded", () => {
  setHeaderDate();
  loadDashboard();
});

// =============================================================
// ヘッダー日付表示
// =============================================================
function setHeaderDate() {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const d   = String(now.getDate()).padStart(2, "0");
  const dow = days[now.getDay()];
  document.getElementById("headerDate").textContent =
    `${y}年${m}月${d}日（${dow}）`;
}

// =============================================================
// ダッシュボードデータ読み込み
// =============================================================
async function loadDashboard() {
  try {
    const res = await fetch("/api/staff/dashboard");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderFlyer(data.flyer      || { total: 0, by_type: {}, items: [] });
    renderExp(data.experience   || { total: 0, items: [] });
    renderPayment(data.payment  || { entrance_total: 0, yamachin_total: 0, items: [] });
  } catch (e) {
    console.error("ダッシュボード読み込みエラー:", e);
    setError("flyerTableBody",  3, e.message);
    setError("expTableBody",    5, e.message);
    setError("payTableBody",    6, e.message);
  }
}

function setError(tbodyId, cols, msg) {
  const el = document.getElementById(tbodyId);
  if (el) el.innerHTML =
    `<tr><td colspan="${cols}" class="empty-row" style="color:#d63031;">データの取得に失敗しました（${msg}）</td></tr>`;
}

// =============================================================
// ① フライヤー申請（未処理）
//    ・操作ボタンなし
//    ・申込別件数をカードヘッダー内（タイトル右・総件数左）に表示
// =============================================================
function renderFlyer(data) {
  const badge  = document.getElementById("flyerCount");
  const subEl  = document.getElementById("flyerSubCounts");
  const tbody  = document.getElementById("flyerTableBody");

  // 総件数バッジ
  badge.textContent = data.total;
  badge.classList.toggle("zero", data.total === 0);

  // 申込別件数バッジ（カードヘッダー内）
  const typeLabels = {
    "会員":     "会員申込",
    "スクール": "Aコース",
    "ビジター": "ビジター",
    "クラブ":   "クラブ入会",
  };
  let subHtml = "";
  // 既知の分類を順番通りに表示
  for (const [key, label] of Object.entries(typeLabels)) {
    const cnt = (data.by_type && data.by_type[key]) || 0;
    subHtml += `<span class="sub-badge">${label}：<strong>${cnt}</strong></span>`;
  }
  // 上記以外の分類も表示
  for (const [key, cnt] of Object.entries(data.by_type || {})) {
    if (!typeLabels[key]) {
      subHtml += `<span class="sub-badge">${esc(key)}：<strong>${cnt}</strong></span>`;
    }
  }
  subEl.innerHTML = subHtml;

  // テーブル
  if (!data.items || data.items.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="4" class="empty-row">未処理の申請はありません</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(row => `
    <tr>
      <td>${row.application_date || "—"}</td>
      <td>${esc(row.full_name || "—")}</td>
      <td>${esc(row.member_type || "—")}</td>
      <td class="col-action">
        <a href="/apply_info?id=${row.id}" class="btn-detail" target="_self">詳細</a>
      </td>
    </tr>
  `).join("");
}

// =============================================================
// ② 体験予約（未処理）
// =============================================================
function renderExp(data) {
  const badge = document.getElementById("expCount");
  const tbody = document.getElementById("expTableBody");

  badge.textContent = data.total;
  badge.classList.toggle("zero", data.total === 0);

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="empty-row">未処理の体験予約はありません</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(row => `
    <tr>
      <td>${row.reservation_date || "—"}</td>
      <td>${row.reception_date   || "—"}</td>
      <td>${esc(row.name  || "—")}</td>
      <td>${esc(row.reservation_type || "—")}</td>
      <td>${esc(row.phone || "—")}</td>
      <td class="col-action">
        <a href="/apply_exp_resv?id=${row.id}" class="btn-resv" target="_self">予約</a>
      </td>
    </tr>
  `).join("");
}

// =============================================================
// ③ 入山申請（入金確認）
//    ・入山料（nyuzan）と山チン（yamachin）を区別して表示
//    ・ヘッダーに各件数を分けて表示
//    ・リストの「種別」列でどちらか明示
//    ・各行に種別に応じた確認ボタン
// =============================================================
function renderPayment(data) {
  const totalBadge    = document.getElementById("payCount");
  const entranceCount   = document.getElementById("entranceCount");
  const yamachinCount = document.getElementById("yamachinCount");
  const tbody         = document.getElementById("payTableBody");

  const total = (data.entrance_total || 0) + (data.yamachin_total || 0);

  // 件数表示
  totalBadge.textContent    = total;
  totalBadge.classList.toggle("zero", total === 0);
  entranceCount.textContent   = data.entrance_total   || 0;
  yamachinCount.textContent = data.yamachin_total  || 0;

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="empty-row">入金確認待ちの申請はありません</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(row => {
    const isYamachin  = row.confirm_type === "yamachin";
    const typeTag     = isYamachin
      ? `<span class="type-tag yamachin">山チン</span>`
      : `<span class="type-tag entrance">入山料</span>`;
    const btnClass    = isYamachin ? "btn-yamachin" : "btn-entrance";
    const btnLabel    = isYamachin ? "山チン確認" : "入山料確認";
    const nameEsc     = esc(row.full_name    || "—");
    const dateStr     = row.flight_date      || "—";
    const memberNo    = esc(row.member_number || "—");
    const memberType  = esc(row.member_type  || "—");

    return `<tr>
      <td>${dateStr}</td>
      <td>${nameEsc}</td>
      <td>${memberNo}</td>
      <td>${memberType}</td>
      <td>${typeTag}</td>
      <td class="col-action">
        <button class="${btnClass}"
          onclick="openConfirmModal(${row.id}, '${row.confirm_type}', '${nameEsc}', '${dateStr}')">
          ${btnLabel}
        </button>
      </td>
    </tr>`;
  }).join("");
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
    loadDashboard();
  } catch (e) {
    alert("更新に失敗しました: " + e.message);
    closeConfirmModal();
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
