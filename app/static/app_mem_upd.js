/**
 * app_mem_upd.js
 * 会員情報更新ページ クライアントスクリプト
 */

"use strict";

// ============================================================
// 定数・設定
// ============================================================

// フィールド日本語名マッピング
const FIELD_LABELS = {
  member_type:     "分類",
  full_name:       "氏名",
  furigana:        "ふりがな",
  gender:          "性別",
  blood_type:      "血液型",
  birthday:        "生年月日",
  weight:          "体重",
  zip_code:        "郵便番号",
  address:         "住所",
  mobile_phone:    "携帯番号",
  home_phone:      "自宅番号",
  company_name:    "勤務先",
  company_phone:   "勤務先電話番号",
  emergency_name:  "緊急連絡先氏名",
  emergency_phone: "緊急連絡先番号",
  email:           "メールアドレス",
  member_number:   "会員番号",
  medical_history: "傷病履歴",
  relationship:    "本人との続柄",
  glider_name:     "使用機体",
  glider_color:    "機体カラー",
  home_area:       "ホームエリア",
  reg_no:          "フライヤー登録番号",
  reglimit_date:   "登録期限",
  license:         "技能証",
  repack_date:     "リパック日",
};

// 対象フィールド一覧（表示・編集対象）
const EDIT_FIELDS = Object.keys(FIELD_LABELS);

// ============================================================
// 状態管理
// ============================================================
let originalData = {};  // 取得時のデータ（変更検知用）
let currentMemberId = null;

// ============================================================
// DOM取得ヘルパー
// ============================================================
const $ = (id) => document.getElementById(id);
const formSection  = $("formSection");
const searchSection = $("searchSection");
const searchError  = $("searchError");
const confirmModal = $("confirmModal");
const changeList   = $("changeList");
const toast        = $("toast");

// ============================================================
// 初期化
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  $("btnSearch").addEventListener("click", handleSearch);
  $("btnZip").addEventListener("click", handleZipSearch);
  $("btnSubmit").addEventListener("click", handleSubmitClick);
  $("btnCancel").addEventListener("click", closeModal);
  $("btnConfirm").addEventListener("click", handleConfirm);

  // Enterキー検索
  [$("searchMemberNo"), $("searchUuid")].forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });
  });

  // 郵便番号入力変化時の自動ハイフン挿入
  $("zip_code").addEventListener("input", e => {
    let v = e.target.value.replace(/[^0-9]/g, "");
    if (v.length > 3) v = v.slice(0, 3) + "-" + v.slice(3, 7);
    e.target.value = v;
  });

  // 郵便番号変更時に自動住所検索
  $("zip_code").addEventListener("change", () => {
    const val = $("zip_code").value.trim();
    if (/^\d{3}-\d{4}$/.test(val)) autoFillAddress(val);
  });

  // 変更ハイライト
  EDIT_FIELDS.forEach(key => {
    const el = getFieldEl(key);
    if (!el) return;
    const evt = (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.type === "date" || el.type === "month") ? "change" : "input";
    el.addEventListener(evt, () => markChanged(key));
  });

  // member_type ラジオ
  document.querySelectorAll('input[name="member_type"]').forEach(r => {
    r.addEventListener("change", () => markChanged("member_type"));
  });
});

// ============================================================
// 検索
// ============================================================
async function handleSearch() {
  const memberNo = $("searchMemberNo").value.trim();
  const uuid     = $("searchUuid").value.trim();

  if (!memberNo && !uuid) {
    showSearchError("会員番号またはQRコード（UUID）を入力してください");
    return;
  }
  hideSearchError();
  $("btnSearch").textContent = "検索中…";
  $("btnSearch").disabled = true;

  try {
    let url;
    if (memberNo) {
      url = `/api/members/by-member-number/${encodeURIComponent(memberNo)}`;
    } else {
      url = `/api/members/by-uuid/${encodeURIComponent(uuid)}`;
    }

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `ステータス ${res.status}`);
    }
    const data = await res.json();
    loadForm(data);
  } catch (e) {
    showSearchError("会員が見つかりませんでした: " + e.message);
  } finally {
    $("btnSearch").textContent = "検 索";
    $("btnSearch").disabled = false;
  }
}

// ============================================================
// フォームへデータをロード
// ============================================================
function loadForm(data) {
  currentMemberId = data.id;
  originalData = {};

  // 全フィールドをセット
  EDIT_FIELDS.forEach(key => {
    let value = (data[key] === null || data[key] === undefined) ? "" : String(data[key]);

    // repack_date は YYYY-MM-DD → YYYY-MM へ
    if (key === "repack_date" && value.length === 10) {
      value = value.slice(0, 7);
    }

    const el = getFieldEl(key);
    if (el) {
      el.value = value;
      el.classList.remove("changed");
    }
    originalData[key] = value;
  });

  // member_type ラジオ
  const mtype = data.member_type || "";
  document.querySelectorAll('input[name="member_type"]').forEach(r => {
    r.checked = (r.value === mtype);
  });
  originalData["member_type"] = mtype;

  formSection.classList.remove("hidden");
  formSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============================================================
// フィールド要素取得
// ============================================================
function getFieldEl(key) {
  if (key === "member_type") return null; // ラジオは別管理
  return $(key) || null;
}

// ============================================================
// 変更マーク
// ============================================================
function markChanged(key) {
  const el = getFieldEl(key);
  if (!el) return;
  if (getCurrentValue(key) !== originalData[key]) {
    el.classList.add("changed");
  } else {
    el.classList.remove("changed");
  }
}

// ============================================================
// 現在値取得
// ============================================================
function getCurrentValue(key) {
  if (key === "member_type") {
    const checked = document.querySelector('input[name="member_type"]:checked');
    return checked ? checked.value : "";
  }
  const el = getFieldEl(key);
  return el ? el.value : "";
}

// ============================================================
// 郵便番号 → 住所 自動入力
// ============================================================
async function handleZipSearch() {
  const val = $("zip_code").value.trim();
  if (!val) return;
  await autoFillAddress(val);
}

async function autoFillAddress(zip) {
  const digits = zip.replace(/-/g, "");
  if (digits.length !== 7) return;
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`);
    const json = await res.json();
    if (json.results && json.results.length > 0) {
      const r = json.results[0];
      const addr = r.address1 + r.address2 + r.address3;
      $("address").value = addr;
      markChanged("address");
    } else {
      showToast("住所が見つかりませんでした", true);
    }
  } catch {
    showToast("住所検索に失敗しました", true);
  }
}

// ============================================================
// 申請ボタン → 変更差分を確認ポップアップ
// ============================================================
function handleSubmitClick() {
  // バリデーション
  const fullName = $("full_name").value.trim();
  if (!fullName) {
    $("full_name").focus();
    showToast("氏名は必須です", true);
    return;
  }
  const memberNo = $("member_number").value.trim();
  if (!memberNo) {
    $("member_number").focus();
    showToast("会員番号は必須です", true);
    return;
  }

  // 差分収集
  const changes = [];
  EDIT_FIELDS.forEach(key => {
    const current  = getCurrentValue(key);
    const original = originalData[key] || "";
    if (current !== original) {
      changes.push({ key, label: FIELD_LABELS[key], oldVal: original, newVal: current });
    }
  });

  if (changes.length === 0) {
    showToast("変更された項目がありません");
    return;
  }

  // ポップアップ描画
  changeList.innerHTML = "";
  changes.forEach(c => {
    const row = document.createElement("div");
    row.className = "change-row";
    row.innerHTML = `
      <span class="change-key">${escapeHtml(c.label)}</span>
      <span class="change-old">${escapeHtml(c.oldVal || "（未設定）")}</span>
      <span class="change-arrow">→</span>
      <span class="change-value">${escapeHtml(c.newVal || "（削除）")}</span>
    `;
    changeList.appendChild(row);
  });

  confirmModal.classList.remove("hidden");
}

// ============================================================
// 確認OK → 更新送信
// ============================================================
async function handleConfirm() {
  closeModal();
  if (!currentMemberId) return;

  // 送信データ構築
  const payload = {};
  EDIT_FIELDS.forEach(key => {
    payload[key] = getCurrentValue(key) || null;
  });

  $("btnSubmit").disabled = true;
  $("btnSubmit").textContent = "送信中…";

  try {
    const res = await fetch(`/api/members/${currentMemberId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `ステータス ${res.status}`);
    }

    const updated = await res.json();

    // 会員番号重複エラー対応はサーバー側でチェック
    loadForm(updated);  // 保存後に再ロード（originalData更新）
    showToast("✓ 変更を登録しました");
  } catch (e) {
    showToast("登録に失敗しました: " + e.message, true);
  } finally {
    $("btnSubmit").disabled = false;
    $("btnSubmit").textContent = "申 請";
  }
}

// ============================================================
// モーダル閉じる
// ============================================================
function closeModal() {
  confirmModal.classList.add("hidden");
}

// モーダル背景クリックで閉じる
confirmModal?.addEventListener("click", e => {
  if (e.target === confirmModal) closeModal();
});

// ============================================================
// トースト表示
// ============================================================
function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden", "error");
  if (isError) toast.classList.add("error");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ============================================================
// エラー表示
// ============================================================
function showSearchError(msg) {
  searchError.textContent = msg;
  searchError.classList.remove("hidden");
}
function hideSearchError() {
  searchError.classList.add("hidden");
}

// ============================================================
// HTMLエスケープ
// ============================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
