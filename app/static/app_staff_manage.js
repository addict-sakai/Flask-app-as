/* =============================================================
   app_staff_manage.js  rev.4（2026-03-23）

   変更点:
     1. toggleSection() を新規追加
        各セクションのヘッダークリックでリスト折り畳み
        初期状態：全セクション折り畳み（closed）
     2. renderFlyer() の typeLabels から「クラブ」を削除し
        「冬季会員」を追加
     3. renderPayment() の件数表示を sub-badges スタイルに変更
        （paySubCounts を使用）
        旧：pay-counts / pay-count-item 構造を廃止
   ============================================================= */

"use strict";

let pendingConfirm = null;
let pendingAppId   = null;
let _rejectMode    = false;

// =============================================================
// 起動
// =============================================================
document.addEventListener("DOMContentLoaded", () => {
  initHamburger();
  initCollapse();
  loadDashboard();
});

// =============================================================
// ハンバーガーメニュー 開閉
// =============================================================
function initHamburger() {
  const btn      = document.getElementById("hamburgerBtn");
  const wrap     = document.getElementById("hamburgerWrap");
  const dropdown = document.getElementById("hamburgerDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains("open");
    dropdown.classList.toggle("open", !isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) {
      dropdown.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  });
}

// =============================================================
// 折り畳み初期化（全セクション閉じた状態）
// =============================================================
const SECTIONS = ["flyerSection", "updateAppSection", "expSection", "paySection"];

function initCollapse() {
  SECTIONS.forEach(id => {
    const body  = document.getElementById(`${id}-body`);
    const arrow = document.getElementById(`${id}-arrow`);
    if (body)  body.classList.add("collapsed");
    if (arrow) arrow.classList.add("closed");
  });
}

function toggleSection(id) {
  const body  = document.getElementById(`${id}-body`);
  const arrow = document.getElementById(`${id}-arrow`);
  if (!body) return;
  body.classList.toggle("collapsed");
  if (arrow) arrow.classList.toggle("closed");
}

// =============================================================
// ダッシュボードデータ読み込み
// =============================================================
async function loadDashboard() {
  try {
    const res = await fetch("/api/staff/dashboard");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderFlyer(data.flyer        || { total: 0, by_type: {}, items: [] });
    renderUpdateApps(data.update_apps || { total: 0, items: [] });
    renderExp(data.experience     || { total: 0, items: [] });
    renderPayment(data.payment    || { entrance_total: 0, yamachin_total: 0, items: [] });
  } catch (e) {
    console.error("ダッシュボード読み込みエラー:", e);
    setError("flyerTableBody",     4, e.message);
    setError("updateAppTableBody", 5, e.message);
    setError("expTableBody",       6, e.message);
    setError("payTableBody",       6, e.message);
  }
}

function setError(tbodyId, cols, msg) {
  const el = document.getElementById(tbodyId);
  if (el) el.innerHTML =
    `<tr><td colspan="${cols}" class="empty-row" style="color:#d63031;">データの取得に失敗しました（${msg}）</td></tr>`;
}

// =============================================================
// ① フライヤー申請（未処理）
//    ★ ヘッダー件数バッジのみ（sub-badges 非表示）
//    ★ 行クリックで /apply_info?id=… へ移動（操作列廃止）
// =============================================================
function renderFlyer(data) {
  const badge = document.getElementById("flyerCount");
  const subEl = document.getElementById("flyerSubCounts");
  const tbody = document.getElementById("flyerTableBody");

  badge.textContent = data.total;
  badge.classList.toggle("zero", data.total === 0);

  // ★ 件数内訳バッジを非表示
  subEl.innerHTML = "";

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="3" class="empty-row">未処理の申請はありません</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(row => `
    <tr class="clickable-row" onclick="location.href='/apply_info?id=${row.id}&from=flyer'">
      <td>${row.application_date || "—"}</td>
      <td>${esc(row.full_name || "—")}</td>
      <td>${esc(row.member_type || "—")}</td>
    </tr>
  `).join("");
}

// =============================================================
// ② フライヤー更新・変更（未処理）
// =============================================================
function renderUpdateApps(data) {
  const badge = document.getElementById("updateAppCount");
  const tbody = document.getElementById("updateAppTableBody");

  badge.textContent = data.total;
  badge.classList.toggle("zero", data.total === 0);

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="5" class="empty-row">未処理の更新・変更申請はありません</td></tr>`;
    return;
  }

  const typeStyle = {
    "renewal":       "background:#0984e3; color:#fff;",
    "course_change": "background:#6c5ce7; color:#fff;",
    "info_change":   "background:#00b894; color:#fff;",
  };

  tbody.innerHTML = data.items.map(row => {
    const style = typeStyle[row.application_type] || "background:#636e72; color:#fff;";
    // 行クリックで会員管理の編集画面へ移動（member_id を使用）
    const memberId = row.member_id || "";
    return `
    <tr class="clickable-row"
      onclick="location.href='/apply_info?id=${memberId}&from=update_app'"
      title="${esc(row.full_name)}の会員情報を開く">
      <td>${esc(row.applied_at || "—")}</td>
      <td>${esc(row.full_name  || "—")}</td>
      <td>${esc(row.member_number || "—")}</td>
      <td>
        <span style="
          display:inline-block; padding:2px 8px; border-radius:4px;
          font-size:12px; font-weight:600; ${style}
        ">${esc(row.type_label || row.application_type)}</span>
      </td>
    </tr>`;
  }).join("");
}

// =============================================================
// フライヤー更新・変更モーダル：開く
// =============================================================
function openUpdateAppModal(appId, fullName, appliedAt, appType, typeLabel, changesJsonStr) {
  pendingAppId = appId;
  _rejectMode  = false;

  document.getElementById("updateAppModalTitle").textContent =
    `${typeLabel}申請の確認`;
  document.getElementById("updateAppModalMeta").textContent =
    `申請者：${fullName}　申請日時：${appliedAt}`;

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
    document.getElementById("updateAppChangeList").innerHTML =
      `<p style="color:#999;">変更内容がありません</p>`;
  } else {
    document.getElementById("updateAppChangeList").innerHTML = entries.map(([k, v]) => `
      <div style="display:flex; gap:8px; padding:4px 0; border-bottom:1px solid #f0f0f0;">
        <span style="min-width:130px; color:#636e72; font-size:12px;">
          ${esc(fieldLabels[k] || k)}
        </span>
        <span style="color:#2d3436; font-weight:500;">${esc(v || "（削除）")}</span>
      </div>
    `).join("");
  }

  document.getElementById("updateAppRejectRow").style.display = "none";
  document.getElementById("updateAppRejectNote").value = "";
  document.getElementById("btnRejectToggle").textContent = "却下";
  document.getElementById("btnApprove").style.display = "";

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
  document.getElementById("btnRejectToggle").textContent = _rejectMode ? "却下をやめる" : "却下";
  document.getElementById("btnApprove").style.display   = _rejectMode ? "none" : "";

  const existing = document.getElementById("btnRejectConfirm");
  if (_rejectMode && !existing) {
    const btn = document.createElement("button");
    btn.id        = "btnRejectConfirm";
    btn.textContent = "却下を確定";
    btn.style.cssText = "background:#d63031; color:#fff; border:none; padding:8px 18px; border-radius:6px; cursor:pointer; font-size:14px;";
    btn.onclick = doRejectApp;
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
    loadDashboard();
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
    loadDashboard();
  } catch (e) {
    alert("却下に失敗しました: " + e.message);
  }
}

// =============================================================
// ③ 体験予約（未処理）—— クリックで体験管理画面へ直接遷移
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
    <tr class="clickable-row"
      onclick="location.href='/apply_exp_resv?id=${row.id}&from=staff_manage'">
      <td>${row.reservation_date || "—"}</td>
      <td>${row.reception_date   || "—"}</td>
      <td>${esc(row.name  || "—")}</td>
      <td>${esc(row.reservation_type || "—")}</td>
      <td>${esc(row.phone || "—")}</td>
    </tr>
  `).join("");
}

// =============================================================
// 体験予約 詳細モーダル
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
    // 正しいAPIエンドポイント
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

  // 共通行
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

  rows.push(
    ["担当",     d.staff  || "—"],
    ["ステータス", d.status || "—"],
    ["備考",     d.memo   || "—"],
  );

  const resvNo = type === "para"
    ? `P-${String(d.reservation_no).padStart(4,"0")}`
    : `C-${String(d.reservation_no).padStart(4,"0")}`;

  document.getElementById("expModalTitle").textContent =
    `体験予約詳細（${resvNo} ${d.name || ""}）`;

  document.getElementById("expModalBody").innerHTML = rows.map(([label, val]) => `
    <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;">
      <span style="min-width:110px;color:#636e72;font-size:12px;flex-shrink:0;">${esc(label)}</span>
      <span style="color:#2d3436;font-weight:500;">${esc(String(val))}</span>
    </div>
  `).join("");
}

function closeExpModal() {
  _currentExpId = null;
  const modal = document.getElementById("expModal");
  if (modal) modal.style.display = "none";
}

async function goToExpDetail() {
  // 体験管理画面へ移動（更新ボタン）
  if (_currentExpId) {
    location.href = `/apply_exp_resv?id=${_currentExpId}&from=staff_manage`;
  }
}

// =============================================================
// ④ 入山申請（入金確認）
//    ★ sub-badges スタイルに変更（paySubCounts を使用）
// =============================================================
function renderPayment(data) {
  const totalBadge = document.getElementById("payCount");
  const subEl      = document.getElementById("paySubCounts");
  const tbody      = document.getElementById("payTableBody");

  const entranceCnt = data.entrance_total || 0;
  const yamachinCnt = data.yamachin_total || 0;
  const total       = entranceCnt + yamachinCnt;

  totalBadge.textContent = total;
  totalBadge.classList.toggle("zero", total === 0);

  // ★ 件数内訳バッジを非表示
  subEl.innerHTML = "";

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="6" class="empty-row">入金確認待ちの申請はありません</td></tr>`;
    return;
  }

  tbody.innerHTML = data.items.map(row => {
    const isYamachin = row.confirm_type === "yamachin";
    const typeTag    = isYamachin
      ? `<span class="type-tag yamachin">山チン</span>`
      : `<span class="type-tag entrance">入山料</span>`;
    const btnClass   = isYamachin ? "btn-yamachin" : "btn-entrance";
    const btnLabel   = isYamachin ? "山チン確認" : "入山料確認";
    const nameEsc    = esc(row.full_name    || "—");
    const dateStr    = row.flight_date      || "—";
    const memberNo   = esc(row.member_number || "—");
    const memberType = esc(row.member_type   || "—");

    return `<tr class="clickable-row"
      onclick="openConfirmModal(${row.id}, '${row.confirm_type}', '${nameEsc}', '${dateStr}')">
      <td>${dateStr}</td>
      <td>${nameEsc}</td>
      <td>${memberNo}</td>
      <td>${memberType}</td>
      <td>${typeTag}</td>
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
