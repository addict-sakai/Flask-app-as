/**
 * app_mem_upd.js  会員情報更新  改定１０版（2026/03/31）
 *
 * 改定１０変更点:
 *   1. ビジターへの変更は確認不要で即時登録（visitor_instant フラグ対応）
 *      - サーバーから visitor_instant:true が返ったらフォームをリロード
 *   2. ビジター→ビジターへの変更はサーバー側で却下
 *      - 400 レスポンスのエラーメッセージをトーストで表示
 *
 * 改定９変更点（維持）:
 *   1. コース変更申請中の挙動を制御
 *   2. _pendingCourseApp 状態変数でコース変更申請中を管理
 *
 *   1. 使用機体（glider_name）を必須項目に追加
 *   2. 申請可能条件:「基本情報」「フライヤー情報」「連絡先」「緊急連絡先」
 *      「傷病履歴」のいずれか1項目以上に変更があれば申請ボタンを有効化
 *   3. コース変更以外の情報変更はスタッフ確認なしで即時反映（従来仕様維持）
 *
 * 改定７変更点（維持）:
 *   - 検索方法を「氏名入力 → 候補リスト選択 → PASSコード認証」に変更
 *      - 左端の「QRコード」ボタンは将来実装用プレースホルダー
 *      - 氏名の部分一致で候補リスト（氏名・生年月日）を表示
 *      - 候補行クリック → PASSコードモーダル（携帯番号下4桁）
 *      - 認証成功 → loadForm() で修正フォームを表示
 *   - 既存の変更差分処理（コース変更・情報変更分離）はそのまま維持
 *
 * 改定５までの変更点（維持）:
 *   - 変更差分を「コース変更」と「情報変更」に分類して処理
 *   - コース変更はスタッフ確認待ち申請として登録
 *   - 情報変更は即時反映
 *   - 申請状態パネルの表示制御
 */
"use strict";

/* =========================================
   定数
   ========================================= */
const FIELD_LABELS = {
  member_type:     "コース（分類）",
  course_name:     "コース内容",
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
  email:           "Email",
  company_name:    "勤務先",
  company_phone:   "勤務先電話番号",
  emergency_name:  "緊急連絡先氏名",
  emergency_phone: "緊急連絡先番号",
  medical_history: "傷病履歴",
};

// 必須フィールド
const REQUIRED_FIELDS = [
  "full_name", "birthday",
  "organization", "reg_no", "reglimit_date", "license", "glider_name",
  "mobile_phone", "email",
  "emergency_name", "emergency_phone",
];

// コース変更フィールド（申請登録 → スタッフ確認待ち）
const COURSE_FIELDS = new Set(["member_type", "course_name", "course_fee"]);

// 編集対象フィールド（member_number・reg_no・zip_code は個別管理）
const EDIT_FIELDS = Object.keys(FIELD_LABELS).filter(k => k !== "reg_no" && k !== "zip_code");

/* =========================================
   状態
   ========================================= */
let originalData      = {};
let currentMemberId   = null;
let _loadedData       = null;
let _passTarget       = null;   // PASSコード認証対象の会員情報（候補リストで選択）
let _pendingCourseApp = false;  // コース変更申請中フラグ（申請中はコース変更不可）

/* =========================================
   DOM ショートカット
   ========================================= */
const $ = id => document.getElementById(id);

/* =========================================
   登録番号ユーティリティ
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
  const org   = ($("organization").value || "");
  const built = buildRegNo(org);
  $("regNoPreview").textContent = built ? `→ ${built}` : "";
  $("reg_no").value = built || "";
  const changed = (built || "") !== (originalData["reg_no"] || "");
  [$("f_reg_jhf1"), $("f_reg_jhf2"), $("f_reg_jpa")].forEach(el => {
    if (el) el.classList.toggle("changed", changed);
  });
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

  // ── 改定７：新検索フロー ──────────────────
  $("btnSearch").addEventListener("click", handleNameSearch);
  $("searchName").addEventListener("keydown", e => {
    if (e.key === "Enter") handleNameSearch();
  });
  $("btnCloseCandidates").addEventListener("click", closeCandidates);

  // PASSモーダル
  $("btnPassClose").addEventListener("click",   closePassModal);
  $("btnPassCancel").addEventListener("click",  closePassModal);
  $("btnPassConfirm").addEventListener("click", handlePassConfirm);
  $("passInput").addEventListener("keydown", e => {
    if (e.key === "Enter") handlePassConfirm();
  });
  $("passOverlay").addEventListener("click", e => {
    if (e.target === $("passOverlay")) closePassModal();
  });

  // QRコードボタン（将来実装）
  $("btnQr").addEventListener("click", handleQrBtn);

  // ★ 改定７：検索画面に戻るボタン
  $("btnBackToSearch").addEventListener("click", handleBackToSearch);

  // ── 既存ロジック ──────────────────────────
  $("btnZip").addEventListener("click", handleZipSearch);

  // 郵便番号 分割input制御
  $("zip_code1").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
    _syncZipHidden();
    if (e.target.value.length >= 3) $("zip_code2").focus();
  });
  $("zip_code2").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
    _syncZipHidden();
  });
  $("zip_code2").addEventListener("keydown", e => {
    if (e.key === "Enter") handleZipSearch();
  });
  $("btnSubmit").addEventListener("click", handleSubmitClick);
  $("btnExit").addEventListener("click", () => { window.history.back(); });
  $("btnModalCancel").addEventListener("click", closeModal);
  $("btnConfirm").addEventListener("click", handleConfirm);

  $("zip_code").addEventListener("input", e => {
    let v = e.target.value.replace(/[^0-9]/g,"");
    if (v.length > 3) v = v.slice(0,3) + "-" + v.slice(3,7);
    e.target.value = v;
  });
  $("zip_code").addEventListener("change", () => {
    const val = $("zip_code").value.trim();
    if (/^\d{3}-\d{4}$/.test(val)) autoFillAddress(val);
  });

  EDIT_FIELDS.forEach(key => {
    if (key === "member_type") return;
    const el = getFieldEl(key);
    if (!el) return;
    const evt = ["SELECT","TEXTAREA"].includes(el.tagName) || ["date","month"].includes(el.type)
      ? "change" : "input";
    el.addEventListener(evt, () => markChanged(key));
  });

  const memberTypeSel = $("member_type");
  if (memberTypeSel) memberTypeSel.addEventListener("change", () => markChanged("member_type"));

  const courseNameSel = $("course_name");
  if (courseNameSel) courseNameSel.addEventListener("change", () => markChanged("course_name"));

  $("confirmModal").addEventListener("click", e => {
    if (e.target === $("confirmModal")) closeModal();
  });

  // ESCキーでモーダルをすべて閉じる
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closePassModal();
      closeModal();
      closeCandidates();
    }
  });

  bindRegInputEvents();
});

/* =========================================
   ★ 改定７：STEP 1 — 氏名検索 → 候補リスト表示
   ========================================= */
async function handleNameSearch() {
  const name = ($("searchName").value || "").trim();
  if (!name) {
    showSearchError("氏名を入力してください");
    return;
  }

  hideSearchError();
  closeCandidates();
  $("btnSearch").textContent = "検索中…";
  $("btnSearch").disabled    = true;

  try {
    const res = await fetch("/api/members/lookup_by_name", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();

    if (!res.ok) {
      showSearchError(data.error || "会員が見つかりませんでした");
      return;
    }

    if (!data.members || data.members.length === 0) {
      showSearchError("該当する会員が見つかりませんでした");
      return;
    }

    // 1件だけヒット → 直接PASSモーダルへ
    if (data.members.length === 1) {
      openPassModal(data.members[0]);
      return;
    }

    // 複数ヒット → 候補リストを表示
    renderCandidates(data.members);

  } catch {
    showSearchError("通信エラーが発生しました");
  } finally {
    $("btnSearch").textContent = "検　索";
    $("btnSearch").disabled    = false;
  }
}

/* ── 候補リストを描画 ── */
function renderCandidates(members) {
  const ul = $("candidateList");
  ul.innerHTML = "";

  members.forEach(m => {
    const li = document.createElement("li");
    li.className = "candidate-item";

    const birthday = m.birthday ? _fmtDate(m.birthday) : "生年月日未登録";

    li.innerHTML = `
      <span class="candidate-item-name">${esc(m.full_name)}</span>
      <span class="candidate-item-birthday">${esc(birthday)}</span>
      <span class="candidate-item-arrow">›</span>
    `;

    li.addEventListener("click", () => {
      closeCandidates();
      openPassModal(m);
    });

    ul.appendChild(li);
  });

  $("candidateListWrap").classList.remove("hidden");
}

/* ── 候補リストを閉じる ── */
function closeCandidates() {
  $("candidateListWrap").classList.add("hidden");
  $("candidateList").innerHTML = "";
}

/* ── 日付フォーマット（YYYY-MM-DD → YYYY年MM月DD日） ── */
function _fmtDate(str) {
  if (!str) return "";
  const p = str.split("-");
  if (p.length !== 3) return str;
  return `${p[0]}年${p[1]}月${p[2]}日`;
}

/* =========================================
   ★ 改定７：STEP 2 — PASSコードモーダル
   ========================================= */
function openPassModal(candidate) {
  _passTarget = candidate;
  $("passTargetName").textContent = candidate.full_name || "—";
  $("passInput").value            = "";
  $("passError").classList.add("hidden");
  $("passError").textContent      = "";

  const overlay = $("passOverlay");
  overlay.classList.remove("hidden");
  requestAnimationFrame(() => overlay.classList.add("is-visible"));
  document.body.style.overflow = "hidden";

  setTimeout(() => { $("passInput").focus(); }, 150);
}

function closePassModal() {
  const overlay = $("passOverlay");
  overlay.classList.remove("is-visible");
  setTimeout(() => {
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
  }, 220);
  _passTarget = null;
}

/* ── PASS確認 ── */
async function handlePassConfirm() {
  if (!_passTarget) return;

  const pass = ($("passInput").value || "").trim();
  if (!pass || !/^\d{4}$/.test(pass)) {
    _showPassError("半角数字4桁で入力してください");
    return;
  }

  $("btnPassConfirm").disabled    = true;
  $("btnPassConfirm").textContent = "確認中…";

  try {
    const res = await fetch("/api/members/verify_pass", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_number: _passTarget.member_number,
        pass_code:     pass,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      _showPassError(data.error || "PASSコードが正しくありません");
      return;
    }

    // 認証成功 → モーダルを閉じてフォームをロード
    closePassModal();
    await _loadFormByMemberNumber(data.member_number);

  } catch {
    _showPassError("通信エラーが発生しました");
  } finally {
    $("btnPassConfirm").disabled    = false;
    $("btnPassConfirm").textContent = "確　認";
  }
}

function _showPassError(msg) {
  const el = $("passError");
  el.textContent = "⚠ " + msg;
  el.classList.remove("hidden");
  const input = $("passInput");
  input.classList.add("upd-shake");
  setTimeout(() => input.classList.remove("upd-shake"), 400);
}

/* =========================================
   ★ 改定７：STEP 3 — 認証後フォームロード
   ========================================= */
async function _loadFormByMemberNumber(memberNumber) {
  hideSearchError();
  try {
    const res = await fetch(`/api/members/by-member-number/${encodeURIComponent(memberNumber)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showSearchError(err.error || "会員情報の取得に失敗しました");
      return;
    }
    loadForm(await res.json());
  } catch {
    showSearchError("通信エラーが発生しました");
  }
}

/* ── QRコードスキャン ── */
function handleQrBtn() {
  QRScanner.open(async (memberData) => {
    // QRから取得したuuidで会員情報を取得してフォームに読み込む
    await _loadFormByUuid(memberData.uuid);
  });
}

function closeQrScan() {
  QRScanner.close();
}

async function _loadFormByUuid(uuid) {
  hideSearchError();
  try {
    const res = await fetch(`/api/members/by-uuid/${encodeURIComponent(uuid)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showSearchError(err.error || '会員情報の取得に失敗しました');
      return;
    }
    loadForm(await res.json());
  } catch {
    showSearchError('通信エラーが発生しました');
  }
}

/* =========================================
   ★ 改定７：検索画面に戻る
   ========================================= */
function handleBackToSearch() {
  // フォームを隠す
  $("formSection").classList.add("hidden");

  // 検索欄を表示・入力内容をリセット
  $("searchSection").classList.remove("hidden");
  $("searchName").value = "";
  hideSearchError();
  closeCandidates();

  // 「検索に戻る」ボタンを隠す
  $("btnBackToSearch").classList.add("hidden");

  // 内部状態をリセット
  originalData      = {};
  currentMemberId   = null;
  _loadedData       = null;
  _pendingCourseApp = false;

  // ページ先頭にスクロール
  window.scrollTo({ top: 0, behavior: "smooth" });

  // 氏名入力欄にフォーカス
  setTimeout(() => { $("searchName").focus(); }, 300);
}

/* =========================================
   フォームへデータをロード（既存ロジック維持）
   ========================================= */
async function loadFormById(id) {
  const res = await fetch(`/api/members/${id}`);
  if (res.ok) loadForm(await res.json());
}

function loadForm(data) {
  currentMemberId = data.id;
  _loadedData     = data;
  originalData    = {};

  EDIT_FIELDS.forEach(key => {
    let value = (data[key] == null) ? "" : String(data[key]);
    if (key === "repack_date" && value.length === 10) value = value.slice(0,7);
    if (key === "member_type") { originalData[key] = value; return; }
    const el = getFieldEl(key);
    if (el) { el.value = value; el.classList.remove("changed"); }
    originalData[key] = value;
  });

  $("member_number").value = data.member_number || "";

  const mtype = data.member_type || "";
  const memberTypeSel = $("member_type");
  if (memberTypeSel) { memberTypeSel.value = mtype; memberTypeSel.classList.remove("changed"); }
  originalData["member_type"] = mtype;

  const cname = data.course_name || "";
  const courseNameSel = $("course_name");
  if (courseNameSel) { courseNameSel.value = cname; courseNameSel.classList.remove("changed"); }
  originalData["course_name"] = cname;

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

  // 郵便番号：3桁と4桁に分割して表示
  const rawZip = (data.zip_code || "").replace(/-/g, "");
  $("zip_code1").value = rawZip.slice(0, 3);
  $("zip_code2").value = rawZip.slice(3, 7);
  _syncZipHidden();
  const builtZip = rawZip.length >= 7
    ? `${rawZip.slice(0,3)}-${rawZip.slice(3,7)}`
    : (data.zip_code || "");
  originalData["zip_code"] = builtZip;
  // changedマーク用にinputにもクラスをリセット
  [$("zip_code1"), $("zip_code2")].forEach(el => { if (el) el.classList.remove("changed"); });

  $("formSection").classList.remove("hidden");
  $("formSection").scrollIntoView({ behavior: "smooth", block: "start" });

  // ★ 改定７：検索欄を隠して「検索に戻る」ボタンを表示
  $("searchSection").classList.add("hidden");
  $("btnBackToSearch").classList.remove("hidden");

  if (typeof window.updateCurrentCourseDisplay === "function") {
    window.updateCurrentCourseDisplay(data);
  }

  // 申請状態バッジの復元
  _loadPendingApplication(data.id);
}

/* =========================================
   フィールド要素取得
   ========================================= */
function getFieldEl(key) {
  if (key === "member_type") return $("member_type");
  if (key === "course_name") return $("course_name");
  if (key === "reg_no")      return $("reg_no");
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
  if (key === "member_type") { const el = $("member_type"); return el ? el.value : ""; }
  if (key === "course_name") { const el = $("course_name"); return el ? el.value : ""; }
  if (key === "reg_no")      { return buildRegNo($("organization").value || "") || ""; }
  if (key === "zip_code") {
    const z1 = ($("zip_code1").value || "").replace(/\D/g, "");
    const z2 = ($("zip_code2").value || "").replace(/\D/g, "");
    return (z1 || z2) ? `${z1.padStart(3,"0")}-${z2.padStart(4,"0")}` : "";
  }
  const el = getFieldEl(key);
  return el ? el.value : "";
}

/* =========================================
   郵便番号検索
   ========================================= */
async function handleZipSearch() {
  const z1 = ($("zip_code1").value || "").replace(/\D/g, "");
  const z2 = ($("zip_code2").value || "").replace(/\D/g, "");
  const zip = z1 + z2;
  if (zip.length !== 7) {
    showToast("郵便番号を3桁と4桁に正しく入力してください", true);
    return;
  }
  _syncZipHidden();
  await autoFillAddress(zip);
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
    } else { showToast("住所が見つかりませんでした", true); }
  } catch { showToast("住所検索に失敗しました", true); }
}

/** 分割inputの値を hidden の zip_code に常時同期 */
function _syncZipHidden() {
  const z1 = ($("zip_code1").value || "").replace(/\D/g, "");
  const z2 = ($("zip_code2").value || "").replace(/\D/g, "");
  $("zip_code").value = (z1 || z2) ? `${z1}-${z2}` : "";
  // 変更マーク更新
  const current  = getCurrentValue("zip_code");
  const original = originalData["zip_code"] || "";
  const changed  = current !== original;
  [$("zip_code1"), $("zip_code2")].forEach(el => {
    if (el) el.classList.toggle("changed", changed);
  });
}

/* =========================================
   必須チェック
   ========================================= */
function validateRequired() {
  const org = $("organization").value || "";
  const builtReg = buildRegNo(org) || "";
  const errors = [];
  REQUIRED_FIELDS.forEach(key => {
    if (key === "reg_no") return;
    const val = getCurrentValue(key).trim();
    if (!val) errors.push(FIELD_LABELS[key] || key);
  });
  if (!builtReg) errors.push(FIELD_LABELS["reg_no"]);
  return errors;
}

/* =========================================
   変更差分収集（コース変更 / 情報変更に分類）
   ========================================= */
function _collectChanges() {
  const allFields = [...EDIT_FIELDS, "reg_no", "zip_code"];
  const courseChanges = {};
  const infoChanges   = {};

  allFields.forEach(key => {
    const current  = getCurrentValue(key);
    const original = originalData[key] || "";
    if (key === "member_type" && current === "") return;
    if (current !== original) {
      if (COURSE_FIELDS.has(key)) {
        courseChanges[key] = current;
      } else {
        infoChanges[key] = current;
      }
    }
  });

  // ★ 改定１１：年会員・ビジターへの変更時は course_name を強制削除
  // （コース内容が不要なコース種別では空文字で差分が生じても送信しない）
  const newMemberType = courseChanges["member_type"] || "";
  if (newMemberType === "年会員" || newMemberType === "ビジター") {
    delete courseChanges["course_name"];
  }

  // コース変更がある場合、現在表示中の料金を course_fee として追加
  if (courseChanges["member_type"] && typeof window.getCurrentCourseFee === "function") {
    const fee = window.getCurrentCourseFee();
    if (fee) courseChanges["course_fee"] = fee;
  }

  return { courseChanges, infoChanges };
}

/* =========================================
   申請ボタン押下
   ========================================= */
function handleSubmitClick() {
  if (!currentMemberId) {
    showToast("先に会員を検索してください", true);
    return;
  }

  const org = $("organization").value || "";
  $("reg_no").value = buildRegNo(org) || "";

  if (typeof window.getExpiredStatus === "function") {
    const { reglimitExpired, repackExpired } = window.getExpiredStatus();
    if (reglimitExpired) {
      showToast("フライヤー登録期限が切れています。期限を更新してから申請してください。", true);
      return;
    }
    if (repackExpired) {
      showToast("リパック期限が切れています。リパック日を更新してから申請してください。", true);
      return;
    }
  }

  const errors = validateRequired();
  if (errors.length) {
    showToast("必須項目を入力してください：" + errors.join("、"), true);
    return;
  }

  const { courseChanges, infoChanges } = _collectChanges();
  const hasCourse = Object.keys(courseChanges).length > 0;
  const hasInfo   = Object.keys(infoChanges).length > 0;

  if (!hasCourse && !hasInfo) {
    showToast("変更された項目がありません。いずれかの項目を変更してから申請してください。");
    return;
  }

  // ── コース変更申請中はコース変更を受け付けない ──
  if (_pendingCourseApp && hasCourse) {
    showToast("コース変更申請中のため、コース変更はできません。登録情報の修正のみ可能です。", true);
    return;
  }

  if (hasCourse) {
    _buildConfirmModal(courseChanges, infoChanges);
    $("confirmModal").classList.remove("hidden");
    return;
  }

  _sendChanges(courseChanges, infoChanges);
}

/* ── 確認モーダルの内容を構築 ── */
function _buildConfirmModal(courseChanges, infoChanges) {
  $("changeList").innerHTML = "";

  if (Object.keys(courseChanges).length > 0) {
    const hdr = document.createElement("div");
    hdr.className = "change-section-header change-section-course";
    hdr.textContent = "▼ コース変更（スタッフ確認後に反映）";
    $("changeList").appendChild(hdr);
    Object.entries(courseChanges).forEach(([key, val]) =>
      _appendChangeRow(key, originalData[key] || "", val));
  }

  if (Object.keys(infoChanges).length > 0) {
    const hdr = document.createElement("div");
    hdr.className = "change-section-header change-section-info";
    hdr.textContent = "▼ 登録情報変更（即時反映）";
    $("changeList").appendChild(hdr);
    Object.entries(infoChanges).forEach(([key, val]) =>
      _appendChangeRow(key, originalData[key] || "", val));
  }
}

function _appendChangeRow(key, oldVal, newVal) {
  const row = document.createElement("div");
  row.className = "change-row";
  row.innerHTML = `
    <span class="change-key">${esc(FIELD_LABELS[key] || key)}</span>
    <span class="change-old">${esc(oldVal || "（未設定）")}</span>
    <span class="change-arrow">→</span>
    <span class="change-value">${esc(newVal || "（削除）")}</span>`;
  $("changeList").appendChild(row);
}

/* =========================================
   確認OK → 送信
   ========================================= */
async function handleConfirm() {
  closeModal();
  const { courseChanges, infoChanges } = _collectChanges();
  await _sendChanges(courseChanges, infoChanges);
}

/* =========================================
   送信処理
   ========================================= */
async function _sendChanges(courseChanges, infoChanges) {
  const hasCourse = Object.keys(courseChanges).length > 0;
  const hasInfo   = Object.keys(infoChanges).length > 0;
  if (!hasCourse && !hasInfo) return;

  $("btnSubmit").disabled    = true;
  $("btnSubmit").textContent = "送信中…";

  try {
    const res = await fetch(`/api/members/${currentMemberId}/apply_update`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_changes: courseChanges, info_changes: infoChanges }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `ステータス ${res.status}`);
    }

    const result = await res.json();
    showToast(result.message || "更新しました。");

    if (result.info_updated) {
      Object.keys(infoChanges).forEach(key => {
        originalData[key] = infoChanges[key];
        const el = getFieldEl(key);
        if (el) el.classList.remove("changed");
      });
    }

    // ★ 改定１０：ビジター即時変更（フォームリロード）
    if (result.visitor_instant) {
      setTimeout(async () => {
        if (currentMemberId) {
          await loadFormById(currentMemberId);
        }
      }, 800);
      return;
    }

    if (result.course_applied) {
      _pendingCourseApp = true;
      const mt = courseChanges["member_type"] || originalData["member_type"] || "";
      if (typeof window.showStatusBadge === "function") {
        window.showStatusBadge("pending", mt, null);
      }
    }

    if (!hasCourse) {
      _loadPendingApplication(currentMemberId);
    }

  } catch (e) {
    showToast("送信に失敗しました: " + e.message, true);
  } finally {
    $("btnSubmit").disabled    = false;
    $("btnSubmit").textContent = "申　請";
  }
}

/* =========================================
   申請状態の復元
   ========================================= */
async function _loadPendingApplication(memberId) {
  try {
    const res = await fetch(`/api/members/${memberId}/pending_application`);
    if (!res.ok) {
      _pendingCourseApp = false;
      if (typeof window.showStatusBadge === "function") window.showStatusBadge(null, "");
      return;
    }
    const app = await res.json();
    if (!app) {
      _pendingCourseApp = false;
      if (typeof window.showStatusBadge === "function") window.showStatusBadge(null, "");
      return;
    }

    if (app.status_type === "member_pending") {
      _pendingCourseApp = false;
      if (typeof window.showStatusBadge === "function") {
        window.showStatusBadge("member_pending", "", { appliedAt: app.applied_at });
      }
      return;
    }

    // コース変更申請中フラグをセット
    _pendingCourseApp = (app.app_status === "pending" && app.status_type === "course_change");

    const changes = app.changes || {};
    const mt = changes["member_type"] || originalData["member_type"] || "";
    if (typeof window.showStatusBadge === "function") {
      window.showStatusBadge(app.app_status, mt, {
        appliedAt:   app.applied_at,
        confirmedAt: app.confirmed_at,
        confirmedBy: app.confirmed_by,
        notes:       app.notes,
      });
    }
  } catch {
    // バッジ復元失敗は無視
    _pendingCourseApp = false;
  }
}

/* =========================================
   モーダル（変更確認）
   ========================================= */
function closeModal() { $("confirmModal").classList.add("hidden"); }

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
   検索エラー表示
   ========================================= */
function showSearchError(msg) {
  $("searchError").textContent = msg;
  $("searchError").classList.remove("hidden");
}
function hideSearchError() { $("searchError").classList.add("hidden"); }

/* =========================================
   HTMLエスケープ
   ========================================= */
function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}


/* =========================================
   以下: 会員更新.html インラインスクリプト移行分
   コース情報UI制御（改定８版 2026/03/31）
   ========================================= */
/* ════════════════════════════════════════
   コース情報UI制御（改定８版 2026/03/31）
   改定８変更点:
     - 冬季会員のコース内容に「冬季継続」を追加
     - 冬季継続の開始日は5/1〜11/30のみ表示
     - 料金は config_master の「冬季継続料金」から取得
════════════════════════════════════════ */
(function () {

  /* ──────────────────────────────────────
     configから料金マップを取得
  ────────────────────────────────────── */
  const courseFeeMap = {};
  const FEE_TARGETS = [
    "年会費",
    "冬季料金","冬季1月","冬季2月","冬季3月","冬季4月","冬季継続料金",
    "Bコース入校料","NPコース入校料","Pコース入校料",
    "XCコース入校料","Tコース入校料",
  ];

  function formatFee(n) { return "￥" + Number(n).toLocaleString("ja-JP"); }

  fetch("/config/api/masters?category=" + encodeURIComponent("パラ"))
    .then(r => r.json())
    .then(masters => Promise.all(
      masters
        .filter(m => FEE_TARGETS.includes(m.item_name))
        .map(m => fetch("/config/api/values/" + m.id).then(r => r.json()).then(vals => {
          const a = vals.find(v => v.is_active);
          if (a && a.value) courseFeeMap[m.item_name] = Number(a.value);
        }))
    ))
    .then(() => { updateCourseFeeDisplay(); })
    .catch(() => {});

  /* ──────────────────────────────────────
     コース内容の選択肢定義
  ────────────────────────────────────── */
  function buildCourseNameOptions(memberType) {
    if (memberType === "冬季会員") {
      return [
        { value: "ALL", text: "年会費（12/1～4/30）" },
        { value: "1",   text: "1月入会" },
        { value: "2",   text: "2月入会" },
        { value: "3",   text: "3月入会" },
        { value: "4",   text: "4月入会" },
        { value: "継続", text: "継続会員（5/1～11/30）" },
      ];
    }
    if (memberType === "スクール") {
      return [
        { value: "B",  text: "Bコース" },
        { value: "NP", text: "NPコース" },
        { value: "P",  text: "Pコース" },
        { value: "XC", text: "XCコース" },
        { value: "T",  text: "タンデムコース" },
      ];
    }
    return [];
  }

  /* コースタイプ + コース内容 → config item_name */
  function resolveCourseFeeKey(memberType, courseNameVal) {
    if (memberType === "年会員")   return "年会費";
    if (memberType === "冬季会員") {
      const map = {
        "ALL":  "冬季料金",
        "1":    "冬季1月",
        "2":    "冬季2月",
        "3":    "冬季3月",
        "4":    "冬季4月",
        "継続": "冬季継続料金",
      };
      return map[courseNameVal] || null;
    }
    if (memberType === "スクール") {
      const map = { "B":"Bコース入校料","NP":"NPコース入校料","P":"Pコース入校料",
                    "XC":"XCコース入校料","T":"Tコース入校料" };
      return map[courseNameVal] || null;
    }
    return null;
  }

  /* ──────────────────────────────────────
     DOM参照
  ────────────────────────────────────── */
  const memberTypeSel    = document.getElementById("member_type");
  const schoolCourseWrap = document.getElementById("schoolCourseWrap");
  const courseFeeDisplay = document.getElementById("courseFeeDisplay");
  const courseFeeAmount  = document.getElementById("courseFeeAmount");
  const courseNameSel    = document.getElementById("course_name");

  /* ──────────────────────────────────────
     コース内容セレクトの選択肢を更新
  ────────────────────────────────────── */
  function updateCourseNameOptions(memberType) {
    courseNameSel.innerHTML = '<option value="">コース内容を選択</option>';
    const opts = buildCourseNameOptions(memberType);
    opts.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.text;
      courseNameSel.appendChild(o);
    });
  }

  /* ──────────────────────────────────────
     料金表示を更新
  ────────────────────────────────────── */
  function updateCourseFeeDisplay() {
    const mt = memberTypeSel ? memberTypeSel.value : "";
    const cn = courseNameSel ? courseNameSel.value : "";

    if (!mt || mt === "ビジター") {
      courseFeeDisplay.classList.remove("visible");
      courseFeeAmount.dataset.fee = "";
      return;
    }
    if (mt === "年会員") {
      const fee = courseFeeMap["年会費"];
      courseFeeAmount.textContent  = fee ? formatFee(fee) : "料金確認中";
      courseFeeAmount.dataset.fee  = fee ? String(fee) : "";
      courseFeeDisplay.classList.add("visible");
      return;
    }
    if (mt === "冬季会員" || mt === "スクール") {
      if (!cn) {
        courseFeeDisplay.classList.remove("visible");
        courseFeeAmount.dataset.fee = "";
        return;
      }
      const key = resolveCourseFeeKey(mt, cn);
      const fee = key ? courseFeeMap[key] : undefined;
      courseFeeAmount.textContent  = fee ? formatFee(fee) : "料金確認中";
      courseFeeAmount.dataset.fee  = fee ? String(fee) : "";
      courseFeeDisplay.classList.add("visible");
      return;
    }
    courseFeeDisplay.classList.remove("visible");
    courseFeeAmount.dataset.fee = "";
  }

  /* 外部から現在の料金を取得できるよう公開 */
  window.getCurrentCourseFee = function () {
    const el = document.getElementById("courseFeeAmount");
    return el ? (el.dataset.fee || "") : "";
  };

  /* ──────────────────────────────────────
     コースタイプ変更イベント
  ────────────────────────────────────── */
  if (memberTypeSel) {
    memberTypeSel.addEventListener("change", function () {
      const val = this.value;
      updateCourseNameOptions(val);
      if (val === "冬季会員" || val === "スクール") {
        schoolCourseWrap.classList.add("visible");
      } else {
        schoolCourseWrap.classList.remove("visible");
        courseNameSel.value = "";
      }
      updateCourseFeeDisplay();
    });
  }
  if (courseNameSel) {
    courseNameSel.addEventListener("change", function () { updateCourseFeeDisplay(); });
  }

  /* ──────────────────────────────────────
     期限切れ判定ユーティリティ
  ────────────────────────────────────── */
  function isDateExpired(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    const today = new Date(); today.setHours(0,0,0,0);
    return d < today;
  }

  /* リパック日期限切れ判定：リパック月含め6か月後の月末を超えたら期限切れ */
  function isRepackExpired(yearMonth) {
    if (!yearMonth) return false;
    const parts = yearMonth.slice(0,7).split("-");
    if (parts.length < 2) return false;
    const year  = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(month)) return false;
    let limitYear = year, limitMonth = month + 5;
    if (limitMonth > 12) {
      limitYear  += Math.floor((limitMonth - 1) / 12);
      limitMonth  = ((limitMonth - 1) % 12) + 1;
    }
    const limitDate = new Date(limitYear, limitMonth, 0);
    limitDate.setHours(23,59,59,999);
    return new Date() > limitDate;
  }

  /* ──────────────────────────────────────
     期限切れチェック（バッジ＋日付赤文字）
     返値: { reglimitExpired, repackExpired }
  ────────────────────────────────────── */
  function updateExpiredBadges() {
    const reglimitEl    = document.getElementById("reglimit_date");
    const reglimitBadge = document.getElementById("reglimitExpiredBadge");
    const repackEl      = document.getElementById("repack_date");
    const repackBadge   = document.getElementById("repackExpiredBadge");

    const reglimitExpired = reglimitEl ? isDateExpired(reglimitEl.value) : false;
    const repackExpired   = repackEl   ? isRepackExpired(repackEl.value) : false;

    /* バッジ表示 */
    if (reglimitBadge) reglimitBadge.classList.toggle("hidden", !reglimitExpired);
    if (repackBadge)   repackBadge.classList.toggle("hidden",   !repackExpired);

    /* 日付フィールド自体を赤文字に */
    if (reglimitEl) {
      reglimitEl.style.color = reglimitExpired ? "var(--danger)" : "";
    }
    if (repackEl) {
      repackEl.style.color = repackExpired ? "var(--danger)" : "";
    }

    return { reglimitExpired, repackExpired };
  }

  /* 入力変更時にも都度チェック */
  const reglimitEl = document.getElementById("reglimit_date");
  const repackEl   = document.getElementById("repack_date");
  if (reglimitEl) reglimitEl.addEventListener("change", updateExpiredBadges);
  if (repackEl)   repackEl.addEventListener("change",   updateExpiredBadges);

  /* ──────────────────────────────────────
     期限切れ状態を外部（app_mem_upd.js）から
     参照できるように公開
  ────────────────────────────────────── */
  window.getExpiredStatus = function () {
    return updateExpiredBadges();
  };

  /* ──────────────────────────────────────
     ★ 申請状態パネル表示（改定５追加）
     app_status: 'pending' | 'approved' | 'rejected' | null
     memberType : コース名（変更後）
     extra      : { appliedAt, confirmedAt, confirmedBy, notes }
  ────────────────────────────────────── */
  window.showStatusBadge = function (appStatus, memberType, extra) {
    const panel    = document.getElementById("appStatusPanel");
    const bar      = document.getElementById("appStatusBar");
    const icon     = document.getElementById("appStatusIcon");
    const label    = document.getElementById("appStatusLabel");
    const dateEl   = document.getElementById("appStatusDate");
    const targetEl = document.getElementById("appStatusTarget");
    const noteEl   = document.getElementById("appStatusNote");

    if (!panel) return;

    if (!appStatus) {
      panel.classList.remove("visible");
      return;
    }

    extra = extra || {};
    const mtLabel = memberType ? "「" + memberType + "」" : "";

    panel.classList.add("visible");
    bar.className = "app-status-bar " + appStatus;

    if (appStatus === "member_pending") {
      icon.textContent  = "⏳";
      label.textContent = "新規申込　申請中";
      dateEl.textContent = extra.appliedAt ? extra.appliedAt + " 申請日" : "";
      targetEl.textContent = "スタッフが内容を確認中です。確認後に有効化されます。";
    } else if (appStatus === "pending") {
      icon.textContent  = "⏳";
      label.textContent = "コース変更　申請中";
      dateEl.textContent = extra.appliedAt ? extra.appliedAt + " 申請日" : "";
      targetEl.innerHTML = mtLabel
        ? "変更後コース：<span class='app-status-target'>" + mtLabel + "</span>　／　スタッフ確認後に反映されます。"
        : "スタッフ確認後に反映されます。";
    } else if (appStatus === "approved") {
      icon.textContent  = "✅";
      label.textContent = "コース変更　承認済み";
      dateEl.textContent = extra.confirmedAt ? extra.confirmedAt + " 承認" : "";
      targetEl.innerHTML = mtLabel
        ? "変更後コース：<span class='app-status-target'>" + mtLabel + "</span>"
        : "承認済み";
    } else if (appStatus === "rejected") {
      icon.textContent  = "❌";
      label.textContent = "コース変更　却下";
      dateEl.textContent = extra.confirmedAt ? extra.confirmedAt + " 処理" : "";
      targetEl.textContent = "申請は却下されました。内容を確認して再申請してください。";
    }

    // 却下理由
    if (appStatus === "rejected" && extra.notes) {
      noteEl.textContent = "却下理由：" + extra.notes;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.textContent = "";
      noteEl.classList.add("hidden");
    }
  };

  /* 後方互換：showApplyingBadge も showStatusBadge を呼ぶ */
  window.showApplyingBadge = function (memberType) {
    if (!memberType || memberType === "ビジター") {
      window.showStatusBadge(null, "");
    } else {
      window.showStatusBadge("pending", memberType, null);
    }
  };

  /* ──────────────────────────────────────
     期限日計算（開始日基準）
     年会員・スクール：開始日から1年（1年後の前日）
     冬季会員：当年or翌年の4/30
  ────────────────────────────────────── */
  function calcExpireDate(mt, base) {
    if (!base) return null;
    const d = new Date(base);
    if (isNaN(d)) return null;
    if (mt === "年会員" || mt === "スクール") {
      // 開始日から1年後（例: 2025-03-01 → 2026-02-28）
      const e = new Date(d);
      e.setFullYear(e.getFullYear() + 1);
      e.setDate(e.getDate() - 1);
      return e;
    }
    if (mt === "冬季会員") {
      const mon = d.getMonth() + 1;
      if (mon === 12) {
        // 冬季シーズン（12月開始）→ 翌年4/30
        return new Date(d.getFullYear() + 1, 3, 30);
      } else if (mon >= 1 && mon <= 4) {
        // 冬季シーズン（1〜4月）→ 当年4/30
        return new Date(d.getFullYear(), 3, 30);
      } else {
        // 継続シーズン（5〜11月）→ 当年11/30
        return new Date(d.getFullYear(), 10, 30);
      }
    }
    return null;
  }

  function fmtJp(d) {
    if (!d) return "―";
    return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,"0")}月${String(d.getDate()).padStart(2,"0")}日`;
  }

  function remainDays(exp) {
    if (!exp) return null;
    const t = new Date(); t.setHours(0,0,0,0);
    return Math.ceil((exp - t) / 86400000);
  }

  /* 更新ボタンのトグル状態 */
  let _renewalPending = false;
  window.handleRenewalBtn = function () {
    _renewalPending = !_renewalPending;
    const waitEl  = document.getElementById("renewalWaiting");
    const ccsWrap = document.querySelector(".course-change-row");
    if (waitEl)  waitEl.classList.toggle("hidden", !_renewalPending);

    // ★ 改定１２：更新ONの時は member_type セレクトに「年会員」を強制セット
    // 更新OFFに戻した時は空に戻す（コース変更セレクトの disabled も連動）
    const memberTypeSel = document.getElementById("member_type");
    if (_renewalPending) {
      // コース変更セレクトを無効化し、member_type を「年会員」に固定
      if (ccsWrap) {
        ccsWrap.querySelectorAll("select").forEach(s => { s.disabled = true; });
      }
      if (memberTypeSel) memberTypeSel.value = "年会員";
    } else {
      // キャンセル：セレクトを再有効化し、member_type を空に戻す
      if (ccsWrap) {
        ccsWrap.querySelectorAll("select").forEach(s => { s.disabled = false; });
      }
      if (memberTypeSel) memberTypeSel.value = "";
    }

    const btn = document.getElementById("btnRenewal");
    if (btn) btn.textContent = _renewalPending ? "更新をキャンセル" : "更新";
  };

  /* ──────────────────────────────────────
     現在コース表示更新（loadForm後に呼ぶ）
     改定６: course_start_date を使用、申請中はコース変更不可
     ★ appData を省略した場合は API から自動取得する
  ────────────────────────────────────── */
  window.updateCurrentCourseDisplay = async function (data, appData) {
    // appData が渡されていない場合は API から取得
    if (appData === undefined && data && data.id) {
      try {
        const res = await fetch(`/api/members/${data.id}/pending_application`);
        appData = res.ok ? await res.json() : null;
      } catch { appData = null; }
    }

    const mt        = data.member_type || data.member_class || "";
    // 開始日: course_start_date（member_courses.start_date）を優先
    const startDate = data.course_start_date || data.confirmed_at || data.application_date || data.updated_at || null;

    const el = id => document.getElementById(id);

    if (el("currentCourseValue")) el("currentCourseValue").textContent = mt || "未設定";
    if (el("currentApplyDate"))   el("currentApplyDate").textContent   = startDate ? fmtJp(new Date(startDate.slice(0,10))) : "―";

    // コース内容（course_name）を開始日行に表示
    const courseNameEl = el("currentCourseName");
    if (courseNameEl) {
      const cn = data.course_name || "";
      if (cn) {
        courseNameEl.textContent = cn;
        courseNameEl.classList.remove("hidden");
      } else {
        courseNameEl.textContent = "";
        courseNameEl.classList.add("hidden");
      }
    }

    const exp = calcExpireDate(mt, startDate ? startDate.slice(0,10) : null);
    const expEl = el("currentExpireDate");
    if (expEl) {
      expEl.textContent = exp ? fmtJp(exp) : "―";
      if (exp) {
        const days = remainDays(exp);
        expEl.style.color = days < 0 ? "var(--danger)" : "";
      } else {
        expEl.style.color = "";
      }
    }

    const rem = el("remainingDays");
    if (rem) {
      if (!exp) { rem.textContent = ""; rem.className = "remaining-days none"; }
      else {
        const days = remainDays(exp);
        rem.textContent = days >= 0 ? `【残${days}日】` : `【超過${Math.abs(days)}日】`;
        rem.className = "remaining-days " + (days > 30 ? "ok" : days > 0 ? "warn" : "danger");
      }
    }

    // ── 申請中の処理 ──
    const isPending = appData && appData.app_status === "pending" && appData.status_type === "course_change";

    // 申請中コース情報を右端に表示
    const pendingInfoEl = el("pendingCourseInfo");
    if (pendingInfoEl) {
      if (isPending && appData.changes) {
        const ch = appData.changes;
        const parts = [];
        if (ch.member_type)  parts.push(ch.member_type);
        if (ch.course_name)  parts.push(ch.course_name);
        if (ch.course_fee)   parts.push(`¥${Number(ch.course_fee).toLocaleString()}`);
        pendingInfoEl.textContent = parts.length ? "→ 申請中：" + parts.join(" ／ ") : "";
        pendingInfoEl.classList.toggle("hidden", parts.length === 0);
      } else {
        pendingInfoEl.classList.add("hidden");
      }
    }

    // ── 申請中はコース変更を無効化 ──
    const changeRow = document.querySelector(".course-change-row");
    if (changeRow) {
      if (isPending) {
        changeRow.style.opacity = "0.4";
        changeRow.style.pointerEvents = "none";
      } else {
        changeRow.style.opacity = "";
        changeRow.style.pointerEvents = "";
      }
    }

    // ── 年会員の「更新」ボタン ──
    const btnRenewal     = el("btnRenewal");
    const renewalWaiting = el("renewalWaiting");
    _renewalPending = false;
    if (btnRenewal) {
      btnRenewal.textContent = "更新";
      if (isPending || mt !== "年会員") {
        btnRenewal.classList.add("hidden");
        if (renewalWaiting) renewalWaiting.classList.add("hidden");
      } else {
        // 期限2ヶ月前から使用可能
        const twoMonthsBefore = exp ? new Date(exp) : null;
        if (twoMonthsBefore) twoMonthsBefore.setMonth(twoMonthsBefore.getMonth() - 2);
        const today = new Date(); today.setHours(0,0,0,0);
        const canRenew = twoMonthsBefore && today >= twoMonthsBefore;
        btnRenewal.classList.toggle("hidden", !canRenew);
        btnRenewal.disabled = !canRenew;
        if (renewalWaiting) renewalWaiting.classList.add("hidden");
      }
    }

    /* ★ 申請状態パネル：申請中なら表示、それ以外はリセット
       （_loadPendingApplicationがない場合もここで確定表示する） */
    if (typeof window.showStatusBadge === "function") {
      if (appData && appData.app_status === "pending") {
        const changes = appData.changes || {};
        const changesMt = changes.member_type || "";
        const changesCn = changes.course_name || "";
        const mtLabel   = [changesMt, changesCn].filter(Boolean).join(" ");
        window.showStatusBadge("pending", mtLabel, {
          appliedAt: appData.applied_at ? appData.applied_at.slice(0, 10) : "",
        });
      } else if (appData && appData.status_type === "member_pending") {
        window.showStatusBadge("member_pending", "", {
          appliedAt: appData.applied_at || "",
        });
      } else {
        // 申請なし → パネル非表示（app_mem_upd.jsが別途呼ぶ場合もある）
        window.showStatusBadge(null, "");
      }
    }

    /* コース選択リセット（未選択＝現在のコースのまま申請） */
    if (memberTypeSel)    { memberTypeSel.value = ""; }
    if (schoolCourseWrap) { schoolCourseWrap.classList.remove("visible"); }
    if (courseFeeDisplay) { courseFeeDisplay.classList.remove("visible"); }
    if (courseNameSel)    { courseNameSel.innerHTML = '<option value="">コース内容を選択</option>'; }

    /* 期限切れバッジを更新 */
    updateExpiredBadges();
  };

  /* ──────────────────────────────────────
     現在のコースをJS側で参照できるよう公開
  ────────────────────────────────────── */
  window.getCurrentMemberTypeForSubmit = function (originalMemberType) {
    const sel = document.getElementById("member_type");
    return sel && sel.value ? sel.value : originalMemberType;
  };

})();
