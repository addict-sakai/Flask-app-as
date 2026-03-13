/**
 * app_mem_upd.js  会員情報更新
 */
"use strict";

/* =========================================
   定数
   ========================================= */

const FIELD_LABELS = {
  member_type:     "分類",
  full_name:       "氏名",
  furigana:        "ふりがな",
  gender:          "性別",
  blood_type:      "血液型",
  birthday:        "生年月日",
  weight:          "体重",
  relationship:    "本人との続柄",
  glider_name:     "使用機体",
  glider_color:    "機体カラー",
  home_area:       "ホームエリア",
  organization:    "所属団体",
  reg_no:          "フライヤー登録番号",
  reglimit_date:   "登録期限",
  license:         "技能証",
  repack_date:     "リパック日",
  zip_code:        "郵便番号",
  address:         "住所",
  mobile_phone:    "携帯番号",
  home_phone:      "自宅番号",
  email:           "メールアドレス",
  company_name:    "勤務先",
  company_phone:   "勤務先電話番号",
  emergency_name:  "緊急連絡先氏名",
  emergency_phone: "緊急連絡先番号",
  medical_history: "傷病履歴",
};

// 編集対象フィールド（member_number は編集不可なので除外、reg_no はhidden経由）
const EDIT_FIELDS = Object.keys(FIELD_LABELS).filter(k => k !== "reg_no");

/* =========================================
   状態
   ========================================= */
let originalData = {};
let currentMemberId = null;

/* =========================================
   DOM
   ========================================= */
const $ = id => document.getElementById(id);

/* =========================================
   登録番号ユーティリティ
   JHF: JA{2桁}O-{6桁}  例: JA12O-003456
   JPA: JP{9桁}          例: JP000001234
   ========================================= */
function parseRegNo(org, raw) {
  if (!raw) return { jhf1: "", jhf2: "", jpa: "" };
  if (org === "JHF") {
    const m = raw.match(/^JA(\d{2})O-(\d{6})$/);
    if (m) return { jhf1: m[1], jhf2: m[2], jpa: "" };
  }
  if (org === "JPA") {
    const m = raw.match(/^JP(\d{9})$/);
    if (m) return { jhf1: "", jhf2: "", jpa: m[1] };
  }
  return { jhf1: "", jhf2: "", jpa: "" };
}

function buildRegNo(org) {
  if (org === "JHF") {
    const v1 = ($("f_reg_jhf1").value || "").trim();
    const v2 = ($("f_reg_jhf2").value || "").trim();
    if (!v1 && !v2) return null;
    return `JA${v1.padStart(2,"0")}O-${v2.padStart(6,"0")}`;
  }
  if (org === "JPA") {
    const v = ($("f_reg_jpa").value || "").trim();
    if (!v) return null;
    return `JP${v.padStart(9,"0")}`;
  }
  return null;
}

function updateRegPreview() {
  const org = ($("organization").value || "");
  const built = buildRegNo(org);
  $("regNoPreview").textContent = built ? `→ ${built}` : "";
  $("reg_no").value = built || "";
  // 変更チェック
  if ((built || "") !== (originalData["reg_no"] || "")) {
    [$("f_reg_jhf1"), $("f_reg_jhf2"), $("f_reg_jpa")].forEach(el => {
      if (el) el.classList.add("changed");
    });
  } else {
    [$("f_reg_jhf1"), $("f_reg_jhf2"), $("f_reg_jpa")].forEach(el => {
      if (el) el.classList.remove("changed");
    });
  }
}

function switchRegUI(org) {
  $("regInputNone").style.display = (org === "")    ? "" : "none";
  $("regInputJHF").style.display  = (org === "JHF") ? "flex" : "none";
  $("regInputJPA").style.display  = (org === "JPA") ? "flex" : "none";
  updateRegPreview();
}

function bindRegInputEvents() {
  $("f_reg_jhf1").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g,"").slice(0,2);
    if (e.target.value.length >= 2) $("f_reg_jhf2").focus();
    updateRegPreview();
  });
  $("f_reg_jhf2").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g,"").slice(0,6);
    updateRegPreview();
  });
  $("f_reg_jhf2").addEventListener("blur", e => {
    const v = e.target.value.trim();
    if (v.length > 0 && v.length < 6) { e.target.value = v.padStart(6,"0"); updateRegPreview(); }
  });
  $("f_reg_jpa").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g,"").slice(0,9);
    updateRegPreview();
  });
  $("f_reg_jpa").addEventListener("blur", e => {
    const v = e.target.value.trim();
    if (v.length > 0 && v.length <= 4) { e.target.value = v.padStart(9,"0"); updateRegPreview(); }
  });
  $("organization").addEventListener("change", e => {
    switchRegUI(e.target.value);
    markChanged("organization");
  });
}

/* =========================================
   初期化
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
  $("btnSearch").addEventListener("click", handleSearch);
  $("btnZip").addEventListener("click", handleZipSearch);
  $("btnSubmit").addEventListener("click", handleSubmitClick);
  $("btnCancel").addEventListener("click", handleCancel);
  $("btnModalCancel").addEventListener("click", closeModal);
  $("btnConfirm").addEventListener("click", handleConfirm);

  // Enterキー検索
  [$("searchMemberNo"), $("searchUuid")].forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });
  });

  // 郵便番号自動ハイフン
  $("zip_code").addEventListener("input", e => {
    let v = e.target.value.replace(/[^0-9]/g,"");
    if (v.length > 3) v = v.slice(0,3) + "-" + v.slice(3,7);
    e.target.value = v;
  });
  $("zip_code").addEventListener("change", () => {
    const val = $("zip_code").value.trim();
    if (/^\d{3}-\d{4}$/.test(val)) autoFillAddress(val);
  });

  // 変更ハイライト
  EDIT_FIELDS.forEach(key => {
    const el = getFieldEl(key);
    if (!el) return;
    const evt = ["SELECT","TEXTAREA"].includes(el.tagName) || ["date","month"].includes(el.type) ? "change" : "input";
    el.addEventListener(evt, () => markChanged(key));
  });

  // member_type ラジオ
  document.querySelectorAll('input[name="member_type"]').forEach(r => {
    r.addEventListener("change", () => markChanged("member_type"));
  });

  // モーダル背景クリック
  $("confirmModal").addEventListener("click", e => {
    if (e.target === $("confirmModal")) closeModal();
  });

  bindRegInputEvents();
});

/* =========================================
   キャンセル（フォームリセット）
   ========================================= */
function handleCancel() {
  if (currentMemberId) {
    // 再ロードして元の値に戻す
    loadFormById(currentMemberId);
  }
}

/* =========================================
   検索
   ========================================= */
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
    const url = memberNo
      ? `/api/members/by-member-number/${encodeURIComponent(memberNo)}`
      : `/api/members/by-uuid/${encodeURIComponent(uuid)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `ステータス ${res.status}`);
    }
    loadForm(await res.json());
  } catch (e) {
    showSearchError("会員が見つかりませんでした: " + e.message);
  } finally {
    $("btnSearch").textContent = "検索";
    $("btnSearch").disabled = false;
  }
}

async function loadFormById(id) {
  const res = await fetch(`/api/members/${id}`);
  if (res.ok) loadForm(await res.json());
}

/* =========================================
   フォームへデータをロード
   ========================================= */
function loadForm(data) {
  currentMemberId = data.id;
  originalData = {};

  EDIT_FIELDS.forEach(key => {
    let value = (data[key] == null) ? "" : String(data[key]);
    if (key === "repack_date" && value.length === 10) value = value.slice(0,7);
    const el = getFieldEl(key);
    if (el) { el.value = value; el.classList.remove("changed"); }
    originalData[key] = value;
  });

  // member_number（表示のみ）
  $("member_number").value = data.member_number || "";

  // member_type ラジオ
  const mtype = data.member_type || "";
  document.querySelectorAll('input[name="member_type"]').forEach(r => {
    r.checked = (r.value === mtype);
  });
  originalData["member_type"] = mtype;

  // 登録番号
  originalData["reg_no"] = data.reg_no || "";
  const org = data.organization || "";
  switchRegUI(org);
  if (org && data.reg_no) {
    const parsed = parseRegNo(org, data.reg_no);
    if (org === "JHF") { $("f_reg_jhf1").value = parsed.jhf1; $("f_reg_jhf2").value = parsed.jhf2; }
    if (org === "JPA") { $("f_reg_jpa").value = parsed.jpa; }
    updateRegPreview();
  } else {
    $("f_reg_jhf1").value = $("f_reg_jhf2").value = $("f_reg_jpa").value = "";
    $("reg_no").value = "";
    $("regNoPreview").textContent = "";
  }

  $("formSection").classList.remove("hidden");
  $("formSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================================
   フィールド要素取得
   ========================================= */
function getFieldEl(key) {
  if (key === "member_type") return null;
  if (key === "reg_no") return $("reg_no");
  return $(key) || null;
}

/* =========================================
   変更マーク
   ========================================= */
function markChanged(key) {
  const el = getFieldEl(key);
  if (!el) return;
  el.classList.toggle("changed", getCurrentValue(key) !== (originalData[key] || ""));
}

/* =========================================
   現在値取得
   ========================================= */
function getCurrentValue(key) {
  if (key === "member_type") {
    const checked = document.querySelector('input[name="member_type"]:checked');
    return checked ? checked.value : "";
  }
  if (key === "reg_no") {
    return buildRegNo($("organization").value || "") || "";
  }
  const el = getFieldEl(key);
  return el ? el.value : "";
}

/* =========================================
   郵便番号検索
   ========================================= */
async function handleZipSearch() {
  await autoFillAddress($("zip_code").value.trim());
}

async function autoFillAddress(zip) {
  const digits = zip.replace(/-/g,"");
  if (digits.length !== 7) return;
  try {
    const res  = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`);
    const json = await res.json();
    if (json.results?.length) {
      const r = json.results[0];
      $("address").value = r.address1 + r.address2 + r.address3;
      markChanged("address");
    } else {
      showToast("住所が見つかりませんでした", true);
    }
  } catch { showToast("住所検索に失敗しました", true); }
}

/* =========================================
   申請ボタン → 変更差分モーダル
   ========================================= */
function handleSubmitClick() {
  if (!currentMemberId) {
    showToast("先に会員を検索してください", true);
    return;
  }
  if (!$("full_name").value.trim()) {
    $("full_name").focus();
    showToast("氏名は必須です", true);
    return;
  }

  // 登録番号を hidden に反映
  const org = $("organization").value || "";
  $("reg_no").value = buildRegNo(org) || "";

  // 差分収集（reg_no を含めて確認）
  const allFields = [...EDIT_FIELDS, "reg_no"];
  const changes = [];
  allFields.forEach(key => {
    const current  = getCurrentValue(key);
    const original = originalData[key] || "";
    if (current !== original) {
      changes.push({ key, label: FIELD_LABELS[key] || key, oldVal: original, newVal: current });
    }
  });

  if (!changes.length) { showToast("変更された項目がありません"); return; }

  $("changeList").innerHTML = "";
  changes.forEach(c => {
    const row = document.createElement("div");
    row.className = "change-row";
    row.innerHTML = `
      <span class="change-key">${esc(c.label)}</span>
      <span class="change-old">${esc(c.oldVal || "（未設定）")}</span>
      <span class="change-arrow">→</span>
      <span class="change-value">${esc(c.newVal || "（削除）")}</span>`;
    $("changeList").appendChild(row);
  });

  $("confirmModal").classList.remove("hidden");
}

/* =========================================
   確認OK → 更新送信
   ========================================= */
async function handleConfirm() {
  closeModal();
  if (!currentMemberId) return;

  const payload = {};
  EDIT_FIELDS.forEach(key => {
    payload[key] = getCurrentValue(key) || null;
  });
  // 登録番号は hidden から
  payload.reg_no = $("reg_no").value || null;

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
    loadForm(await res.json());
    showToast("✓ 変更を登録しました");
  } catch (e) {
    showToast("登録に失敗しました: " + e.message, true);
  } finally {
    $("btnSubmit").disabled = false;
    $("btnSubmit").textContent = "更新申請";
  }
}

/* =========================================
   モーダル
   ========================================= */
function closeModal() {
  $("confirmModal").classList.add("hidden");
}

/* =========================================
   トースト
   ========================================= */
function showToast(message, isError = false) {
  const t = $("toast");
  t.textContent = message;
  t.classList.remove("hidden","error");
  if (isError) t.classList.add("error");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 3500);
}

/* =========================================
   エラー表示
   ========================================= */
function showSearchError(msg) {
  $("searchError").textContent = msg;
  $("searchError").classList.remove("hidden");
}
function hideSearchError() {
  $("searchError").classList.add("hidden");
}

/* =========================================
   HTMLエスケープ
   ========================================= */
function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
