/* ================================================
   app_info.js  会員管理
   ================================================ */
"use strict";

const $ = id => document.getElementById(id);

/** ISO日付文字列 → "YYYY年MM月DD日" */
function fmtDate(val) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d)) return "—";
  return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日`;
}

/** ISO日付文字列 → "YYYY-MM-DD"（input[type=date]用） */
function toISODate(val) {
  if (!val) return "";
  // "2025-03-01" のような文字列はそのまま使える
  const s = String(val).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function showToast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}

/* ================================================
   登録番号ユーティリティ
   JHF: JA{2桁}O-{6桁}  例: JA12O-003456
   JPA: JP{9桁}          例: JP000001234
   ================================================ */
function parseRegNo(org, raw) {
  if (!raw) return { jhf1: "", jhf2: "", jpa: "" };
  if (org === "JHF") {
    // ハイフンあり・なし両対応
    const m = raw.match(/^JA(\d{2})O-?(\d{6})$/);
    if (m) return { jhf1: m[1], jhf2: m[2], jpa: "" };
  }
  if (org === "JPA") {
    const m = raw.match(/^JP(\d{9})$/);
    if (m) return { jhf1: "", jhf2: "", jpa: m[1] };
  }
  return { jhf1: "", jhf2: "", jpa: "" };
}

/** reg_no の書式から所属団体を推定する（organization が null の場合のフォールバック） */
function guessOrgFromRegNo(raw) {
  if (!raw) return "";
  if (/^JA\d{2}O-?\d{6}$/.test(raw)) return "JHF";
  if (/^JP\d{9}$/.test(raw)) return "JPA";
  return "";
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
  const org = $("f_organization").value;
  const built = buildRegNo(org);
  $("regNoPreview").textContent = built ? `→ ${built}` : "";
  $("f_reg_no").value = built || "";
}

function switchRegUI(org) {
  $("regInputNone").style.display = (org === "")    ? "" : "none";
  $("regInputJHF").style.display  = (org === "JHF") ? "flex" : "none";
  $("regInputJPA").style.display  = (org === "JPA") ? "flex" : "none";
  updateRegPreview();
}

function bindRegInputEvents() {
  /* JHF 前半2桁：数字のみ、2桁で後半へフォーカス */
  $("f_reg_jhf1").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g,"").slice(0,2);
    if (e.target.value.length >= 2) $("f_reg_jhf2").focus();
    updateRegPreview();
  });

  /* JHF 後半6桁：数字のみ。blur時に3桁以下なら上位0埋め */
  $("f_reg_jhf2").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g,"").slice(0,6);
    updateRegPreview();
  });
  $("f_reg_jhf2").addEventListener("blur", e => {
    const v = e.target.value.trim();
    if (v.length > 0 && v.length < 6) {
      e.target.value = v.padStart(6,"0");
      updateRegPreview();
    }
  });

  /* JPA 9桁：数字のみ。blur時に4桁以下なら上位0埋め */
  $("f_reg_jpa").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g,"").slice(0,9);
    updateRegPreview();
  });
  $("f_reg_jpa").addEventListener("blur", e => {
    const v = e.target.value.trim();
    if (v.length > 0 && v.length <= 4) {
      e.target.value = v.padStart(9,"0");
      updateRegPreview();
    }
  });

  $("f_organization").addEventListener("change", e => switchRegUI(e.target.value));
}

/* ================================================
   ビュー切り替え
   ================================================ */
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(id).classList.add("active");
}

/* ================================================
   一覧
   ================================================ */
let currentMembers = [];

async function fetchMembers(params = {}) {
  const url = new URL("/api/members", location.origin);
  Object.entries(params).forEach(([k,v]) => { if (v) url.searchParams.set(k,v); });
  try {
    const res = await fetch(url);
    const data = await res.json();
    currentMembers = Array.isArray(data) ? data : (data.members || []);
    renderList(currentMembers);
  } catch {
    showToast("一覧取得に失敗しました","error");
  }
}

/** 登録期限の警告表示
 *  今日 <= 期限 かつ (期限 - 31日) <= 今日 → 赤（1か月以内）
 *  今日 > 期限 → 赤（期限切れ） */
function fmtDateWarning(val) {
  if (!val) return "—";
  const txt = fmtDate(val);
  const expiry = new Date(val);
  if (isNaN(expiry)) return txt;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warnStart = new Date(expiry);
  warnStart.setDate(warnStart.getDate() - 31);
  const isRed = today >= warnStart; // 1か月前以降（期限切れ含む）
  return isRed ? `<span class="text-danger">${txt}</span>` : txt;
}

/** リパック日（YYYY-MM）の警告表示
 *  登録月を1か月目として6か月目の月末が期限
 *  例: 2025-03 → 期限 2025-08-31
 *  (期限 - 31日) <= 今日 <= 期限  → 赤 */
function fmtRepackWarning(val) {
  if (!val) return "—";
  const s = String(val).slice(0, 7);
  const parts = s.split("-");
  if (parts.length !== 2) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  // 登録月を1か月目 → +5か月が6か月目。その月末が期限
  const expM = (mo - 1 + 5) % 12 + 1;
  const expY = y + Math.floor((mo - 1 + 5) / 12);
  // expM月の月末 = expM+1月の0日
  const expiry = new Date(expY, expM, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warnStart = new Date(expiry);
  warnStart.setDate(warnStart.getDate() - 31);
  const isRed = today >= warnStart; // 1か月前以降（期限切れ含む）
  return isRed ? `<span class="text-danger">${s}</span>` : s;
}

function typeToKey(t) {
  if (!t) return "";
  if (t === "会員")    return "member";
  if (t === "スクール") return "school";
  if (t === "ビジター") return "visitor";
  if (t === "スタッフ") return "staff";
  if (t === "請負")    return "contract";
  if (t === "ディーラー") return "dealer";
  if (t === "他校引率") return "leader";
  return "";
}

function renderList(members) {
  $("totalCount").textContent = members.length;
  const tbody = $("memberTableBody");
  if (!members.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">データがありません</td></tr>`;
    return;
  }
  tbody.innerHTML = members.map(m => {
    const key = typeToKey(m.member_type);
    const rowCls  = key ? `clickable-row row-${key}` : "clickable-row";
    const badgeCls = key ? `badge badge-${key}` : "badge";
    return `
    <tr data-id="${m.id}" class="${rowCls}">
      <td>${m.member_number || "—"}</td>
      <td>${m.full_name || "—"}</td>
      <td><span class="${badgeCls}">${m.member_type || "—"}</span></td>
      <td>${m.glider_name || "—"}</td>
      <td>${fmtDateWarning(m.reglimit_date)}</td>
      <td>${fmtRepackWarning(m.repack_date)}</td>
      <td>${fmtDate(m.updated_at)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".clickable-row").forEach(row => {
    row.addEventListener("click", () => openEdit(row.dataset.id));
  });
}

function getSearchParams() {
  return {
    name:          $("searchName").value.trim(),
    member_type:   $("searchType").value,
    glider_name:   $("searchGlider").value.trim(),
    reglimit_soon: $("searchReglimit").checked ? "1" : "",
    repack_soon:   $("searchRepack").checked  ? "1" : "",
  };
}

/* ================================================
   フォームクリア
   ================================================ */
function clearForm() {
  [
    "editId","f_member_type","f_member_number","f_full_name","f_furigana",
    "f_gender","f_blood_type","f_birthday","f_weight","f_application_date",
    "f_zip_code","f_zip_code1","f_zip_code2","f_address","f_mobile_phone","f_home_phone",
    "f_email","f_company_name","f_company_phone",
    "f_emergency_name","f_emergency_phone","f_relationship",
    "f_course_type","f_course_name","f_course_fee","f_course_find",
    "f_glider_name","f_glider_color","f_repack_date",
    "f_organization","f_reg_no","f_reglimit_date","f_license",
    "f_experience","f_home_area","f_leader","f_visitor_fee",
    "f_agreement_date","f_signature_name","f_guardian_name","f_medical_history",
    "f_reg_jhf1","f_reg_jhf2","f_reg_jpa",
  ].forEach(id => {
    const el = $(id); if (!el) return;
    if (el.type === "checkbox") el.checked = false;
    else el.value = "";
  });
  $("f_contract").checked = false;
  // 新規申請・コース変更リセット
  if ($("f_payment_confirmed_new"))    $("f_payment_confirmed_new").checked = false;
  if ($("f_payment_confirmed_course")) $("f_payment_confirmed_course").checked = false;
  if ($("newApplicationSection"))  $("newApplicationSection").style.display  = "none";
  if ($("courseChangeSection"))    $("courseChangeSection").style.display    = "none";
  if ($("pendingApplicationArea"))  $("pendingApplicationArea").style.display  = "";
  if ($("confirmedApplicationArea")) $("confirmedApplicationArea").style.display = "none";
  if ($("pendingCourseArea"))      $("pendingCourseArea").style.display      = "";
  if ($("confirmedCourseArea"))    $("confirmedCourseArea").style.display    = "none";
  $("regNoPreview").textContent = "";
  $("f_application_date_disp").style.display = "none";
  $("f_application_date_disp").textContent = "—";
  $("f_agreement_date_disp").textContent = "—";
}

/* ================================================
   新規登録
   ================================================ */
function openNew() {
  clearForm();
  $("formTitle").textContent = "新規登録";
  $("deleteBtn").style.display = "none";

  // 申込日：新規は date input を表示
  $("f_application_date").style.display = "";
  $("f_application_date_disp").style.display = "none";
  $("f_application_date").value = new Date().toISOString().slice(0,10);



  $("f_member_number").removeAttribute("readonly");
  $("updatedAtSection").style.display = "none";
  switchRegUI("");
  showView("view-add");
  $("edit-scroll-area") && ($("edit-scroll-area").scrollTop = 0);
}

/* ================================================
   編集
   ================================================ */
async function openEdit(id) {
  try {
    const res = await fetch(`/api/members/${id}`);
    if (!res.ok) throw new Error("取得失敗");
    const m = await res.json();

    clearForm();
    $("formTitle").textContent = "会員情報編集";
    $("deleteBtn").style.display = "";
    $("editId").value = m.id;

    // 文字列フィールド（zip_code は分割入力のため別処理）
    [
      "member_type","member_number","full_name","furigana","gender","blood_type",
      "weight","address","mobile_phone","home_phone","email",
      "company_name","company_phone","emergency_name","emergency_phone","relationship",
      "course_type","course_name","course_fee","course_find",
      "glider_name","glider_color","organization","license",
      "experience","home_area","leader","visitor_fee",
      "signature_name","guardian_name","medical_history",
    ].forEach(f => {
      const el = $("f_" + f);
      if (el && m[f] != null) el.value = m[f];
    });

    // 郵便番号：3桁と4桁に分割して表示
    if (m.zip_code) {
      const digits = String(m.zip_code).replace(/-/g, "");
      $("f_zip_code1").value = digits.slice(0, 3);
      $("f_zip_code2").value = digits.slice(3, 7);
      $("f_zip_code").value  = digits.length >= 7
        ? `${digits.slice(0,3)}-${digits.slice(3,7)}`
        : m.zip_code;
    }

    // チェックボックス
    $("f_contract").checked = !!m.contract;

    // 月フィールド
    if (m.repack_date) $("f_repack_date").value = String(m.repack_date).slice(0,7);

    // dateフィールド（input[type=date]用）
    if (m.birthday)      $("f_birthday").value      = toISODate(m.birthday);
    if (m.reglimit_date) $("f_reglimit_date").value = toISODate(m.reglimit_date);



    // 申込日：編集時はテキスト表示
    $("f_application_date").style.display = "none";
    $("f_application_date_disp").style.display = "";
    $("f_application_date_disp").textContent = fmtDate(m.application_date);
    if (m.application_date) $("f_application_date").value = toISODate(m.application_date);

    // 確認日：常にテキスト表示
    $("f_agreement_date_disp").textContent = fmtDate(m.agreement_date);
    if (m.agreement_date) $("f_agreement_date").value = toISODate(m.agreement_date);

    // 会員番号：編集時は readonly
    $("f_member_number").setAttribute("readonly", true);

    // 更新日
    if (m.updated_at) {
      $("updatedAtSection").style.display = "";
      const d = new Date(m.updated_at);
      $("f_updated_at").value =
        `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日 ` +
        `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } else {
      $("updatedAtSection").style.display = "none";
    }

    // 登録番号 分割表示
    // organization が null の場合は reg_no の書式から推定
    const org = m.organization || guessOrgFromRegNo(m.reg_no) || "";
    if (org) $("f_organization").value = org;
    switchRegUI(org);
    if (org && m.reg_no) {
      const parsed = parseRegNo(org, m.reg_no);
      if (org === "JHF") { $("f_reg_jhf1").value = parsed.jhf1; $("f_reg_jhf2").value = parsed.jhf2; }
      if (org === "JPA") { $("f_reg_jpa").value = parsed.jpa; }
      updateRegPreview();
    }

    // 新規申請・コース変更パネル表示
    await loadApplicationPanels(id, m);

    showView("view-add");
    document.querySelector(".edit-scroll-area").scrollTop = 0;
  } catch (e) {
    showToast("データ取得に失敗しました","error");
  }
}

/* ================================================
   新規申請・コース変更パネル読み込み
   ================================================ */
// 現在の申請中レコードID（新規申請用）
let _pendingNewAppId    = null;
let _pendingCourseAppId = null;

async function loadApplicationPanels(memberId, memberData) {
  // 新規申請パネル（member_status === 'pending'）
  if (memberData.member_status === 'pending') {
    $("newApplicationSection").style.display = "";
    // application_date を表示
    $("disp_application_date").textContent = fmtDate(memberData.application_date);

    // 申請コース情報を pending_application から取得して表示
    try {
      const appRes = await fetch(`/api/members/${memberId}/pending_application`);
      const appData = appRes.ok ? await appRes.json() : null;
      // status_type === 'member_pending' の場合は changes に申請コース情報が入っている
      const changes = (appData && appData.changes) ? appData.changes : {};
      const mt  = changes.member_type  || null;
      const cn  = changes.course_name  || null;
      const cf  = changes.course_fee   || null;
      if ($("disp_new_member_type")) $("disp_new_member_type").textContent = mt || "―";
      if ($("disp_new_course_name_row")) $("disp_new_course_name_row").style.display = cn ? "" : "none";
      if ($("disp_new_course_name"))     $("disp_new_course_name").textContent = cn || "―";
      if ($("disp_new_course_fee_row"))  $("disp_new_course_fee_row").style.display  = cf ? "" : "none";
      if ($("disp_new_course_fee"))      $("disp_new_course_fee").textContent  = cf ? `¥${Number(cf).toLocaleString()}` : "―";
    } catch { /* 申請コース情報取得失敗は無視 */ }

    // confirmed_at があれば入金済み表示
    if (memberData.confirmed_at) {
      $("pendingApplicationArea").style.display  = "none";
      $("confirmedApplicationArea").style.display = "";
      $("disp_confirmed_date").textContent = fmtDate(memberData.confirmed_at);
    } else {
      $("pendingApplicationArea").style.display  = "";
      $("confirmedApplicationArea").style.display = "none";
    }
  } else {
    $("newApplicationSection").style.display = "none";
  }

  // コース変更申請パネル（pending application of type course_change）
  try {
    const res = await fetch(`/api/members/${memberId}/pending_application`);
    if (!res.ok) return;
    const appData = await res.json();
    if (appData && appData.status_type === 'course_change' && appData.app_status === 'pending') {
      _pendingCourseAppId = appData.id;
      $("courseChangeSection").style.display = "";
      $("pendingCourseArea").style.display   = "";
      $("confirmedCourseArea").style.display = "none";
      const changes = appData.changes || {};
      $("disp_change_member_type").textContent = changes.member_type  || "―";
      $("disp_change_course_name").textContent = changes.course_name  || "―";
      $("disp_change_course_fee").textContent  = changes.course_fee   ? `¥${Number(changes.course_fee).toLocaleString()}` : "―";
      $("disp_change_applied_at").textContent  = appData.applied_at   ? fmtDate(appData.applied_at.slice(0,10)) : "―";
    } else {
      _pendingCourseAppId = null;
      $("courseChangeSection").style.display = "none";
    }
  } catch { /* コース変更申請なし */ }
}

/* ================================================
   新規申請：入金確認済み登録
   ================================================ */
async function saveNewApplicationPayment(memberId) {
  const checked = $("f_payment_confirmed_new").checked;
  if (!checked) return false;
  try {
    const res = await fetch(`/api/staff/confirm_member/${memberId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error("入金確認更新失敗");
    const data = await res.json();
    // 確定した member_type を分類欄にセット
    if (data.confirmed_member_type && $("f_member_type")) {
      $("f_member_type").value = data.confirmed_member_type;
    }
    return true;
  } catch (e) {
    showToast(e.message, "error");
    return false;
  }
}

/* ================================================
   コース変更：入金確認済み登録（承認）
   ================================================ */
async function saveCourseChangePayment() {
  const checked = $("f_payment_confirmed_course").checked;
  if (!checked || !_pendingCourseAppId) return false;
  try {
    const res = await fetch(`/api/applications/${_pendingCourseAppId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed_by: "staff" }),
    });
    if (!res.ok) throw new Error("コース変更承認失敗");
    return true;
  } catch (e) {
    showToast(e.message, "error");
    return false;
  }
}

/* ================================================
   保存
   ================================================ */
async function saveMember() {
  const isEdit = !!$("editId").value;
  const org = $("f_organization").value;

  // 登録番号を hidden に反映
  $("f_reg_no").value = buildRegNo(org) || "";

  // 必須バリデーション
  if (!validateRequired()) return;

  const payload = {};

  [
    "member_type","full_name","furigana","gender","blood_type",
    "weight","address","mobile_phone","home_phone","email",
    "company_name","company_phone","emergency_name","emergency_phone","relationship",
    "course_type","course_name","course_fee","course_find",
    "glider_name","glider_color","repack_date","organization","license",
    "experience","home_area","leader","visitor_fee","medical_history",
  ].forEach(f => {
    const el = $("f_" + f);
    payload[f] = el ? (el.value || null) : null;
  });

  // 郵便番号：分割inputから結合
  const z1 = ($("f_zip_code1").value || "").replace(/\D/g, "");
  const z2 = ($("f_zip_code2").value || "").replace(/\D/g, "");
  payload.zip_code = (z1 || z2)
    ? `${z1.padStart(3,"0")}-${z2.padStart(4,"0")}`
    : null;

  payload.reg_no   = $("f_reg_no").value || null;
  payload.contract = $("f_contract").checked ? 1 : 0;
  payload.birthday      = $("f_birthday").value || null;
  payload.reglimit_date = $("f_reglimit_date").value || null;

  // 新規のみ
  if (!isEdit) {
    payload.member_number    = $("f_member_number").value || null;
    payload.application_date = $("f_application_date").value || null;
  }

  try {
    const id  = $("editId").value;
    const url = isEdit ? `/api/members/${id}` : "/api/members";
    const res = await fetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存失敗");

    // 新規申請：入金確認済み処理
    if (isEdit && $("newApplicationSection").style.display !== "none" &&
        $("f_payment_confirmed_new") && $("f_payment_confirmed_new").checked) {
      await saveNewApplicationPayment(id);
    }
    // コース変更：入金確認済み処理
    if (isEdit && $("courseChangeSection").style.display !== "none" &&
        $("f_payment_confirmed_course") && $("f_payment_confirmed_course").checked) {
      await saveCourseChangePayment();
    }

    showToast(isEdit ? "更新しました" : "登録しました");

    // 遷移元により戻り先を変える
    const src = $("fromSource") ? $("fromSource").value : "";
    if (src === "flyer" || src === "update_app") {
      location.href = "/apply_staff_manage";
    } else {
      await fetchMembers(getSearchParams());
      showView("view-list");
    }
  } catch (e) {
    showToast(e.message,"error");
  }
}

/* ================================================
   キャンセル処理（遷移元により戻り先を変える）
   ================================================ */
function handleCancel() {
  const src = $("fromSource") ? $("fromSource").value : "";
  if (src === "flyer" || src === "update_app") {
    location.href = "/apply_staff_manage";
  } else {
    clearForm();
    showView("view-list");
  }
}

/* ================================================
   必須バリデーション（12項目）
   ================================================ */
function validateRequired() {
  const checks = [
    { id: "f_member_type",    label: "分類" },
    { id: "f_full_name",      label: "氏名" },
    { id: "f_birthday",       label: "生年月日" },
    { id: "f_email",          label: "メールアドレス" },
    { id: "f_mobile_phone",   label: "携帯番号" },
    { id: "f_emergency_name", label: "緊急連絡先氏名" },
    { id: "f_emergency_phone",label: "緊急連絡先電話番号" },
    { id: "f_glider_name",    label: "使用機体" },
    { id: "f_organization",   label: "所属団体" },
    { id: "f_reg_no",         label: "フライヤー登録番号" },
    { id: "f_reglimit_date",  label: "登録期限" },
    { id: "f_license",        label: "技能証" },
  ];
  // 登録番号は hidden に buildRegNo で反映済み
  $("f_reg_no").value = buildRegNo($("f_organization").value) || "";

  const missing = checks
    .filter(c => { const el = $(c.id); return !el || !el.value.trim(); })
    .map(c => c.label);

  if (missing.length) {
    showToast(`未入力の必須項目があります：${missing.join("、")}`, "error");
    return false;
  }
  return true;
}

/* ================================================
   新規申請 取消
   ================================================ */
async function cancelNewApplication() {
  const memberId = $("editId").value;
  if (!memberId) return;
  if (!confirm("新規申請を取消しますか？この操作は元に戻せません。")) return;
  try {
    // member_status を 'cancelled' または削除
    const res = await fetch(`/api/members/${memberId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_status: "cancelled" }),
    });
    if (!res.ok) throw new Error("取消失敗");
    showToast("申請を取消しました");
    await fetchMembers(getSearchParams());
    showView("view-list");
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ================================================
   コース変更申請 取消（却下）
   ================================================ */
async function cancelCourseApplication() {
  if (!_pendingCourseAppId) return;
  if (!confirm("コース変更申請を取消しますか？")) return;
  try {
    const res = await fetch(`/api/applications/${_pendingCourseAppId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "スタッフによる取消" }),
    });
    if (!res.ok) throw new Error("取消失敗");
    showToast("コース変更申請を取消しました");
    // パネルを再ロード
    const id = $("editId").value;
    const res2 = await fetch(`/api/members/${id}`);
    const m = await res2.json();
    await loadApplicationPanels(id, m);
  } catch (e) {
    showToast(e.message, "error");
  }
}

/* ================================================
   削除
   ================================================ */
let pendingDeleteId = null;

function confirmDelete() {
  pendingDeleteId = $("editId").value;
  $("modalOverlay").classList.add("active");
}

async function doDelete() {
  $("modalOverlay").classList.remove("active");
  try {
    const res = await fetch(`/api/members/${pendingDeleteId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("削除失敗");
    showToast("削除しました");
    await fetchMembers(getSearchParams());
    showView("view-list");
  } catch (e) {
    showToast(e.message,"error");
  }
}

/* ================================================
   郵便番号検索
   ================================================ */
async function searchZip() {
  const z1 = ($("f_zip_code1").value || "").replace(/\D/g, "");
  const z2 = ($("f_zip_code2").value || "").replace(/\D/g, "");
  const zip = z1 + z2;
  if (zip.length !== 7) {
    showToast("郵便番号を3桁と4桁に正しく入力してください", "error");
    return;
  }
  // hidden にも反映
  $("f_zip_code").value = `${z1}-${z2}`;
  try {
    const res  = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
    const data = await res.json();
    if (data.results?.length) {
      const r = data.results[0];
      $("f_address").value = r.address1 + r.address2 + r.address3;
    } else {
      showToast("住所が見つかりませんでした", "error");
    }
  } catch { showToast("住所検索に失敗しました", "error"); }
}

/** 分割inputの値を hidden の f_zip_code に常時同期する */
function _syncZipHidden() {
  const z1 = ($("f_zip_code1").value || "").replace(/\D/g, "");
  const z2 = ($("f_zip_code2").value || "").replace(/\D/g, "");
  $("f_zip_code").value = (z1 || z2) ? `${z1}-${z2}` : "";
}

/* ================================================
   初期化
   ================================================ */
document.addEventListener("DOMContentLoaded", () => {
  // CONFIG の全 master を取得し item_name === "分類" のレコードから
  // f_member_type（編集フォーム）と searchType（一覧検索）の option を動的生成
  fetch("/config/api/masters")
    .then(r => r.json())
    .then(masters => {
      // item_name が「分類」のマスターを探す（category は問わない）
      const master = masters.find(m => m.item_name === "分類");
      if (!master) return;
      return fetch("/config/api/values/" + master.id)
        .then(r => r.json())
        .then(vals => {
          const activeVals = vals
            .filter(v => v.is_active)
            .sort((a, b) => a.sort_order - b.sort_order);
          if (!activeVals.length) return;

          function buildOptions(sel, firstLabel) {
            if (!sel) return;
            sel.innerHTML = `<option value="">${firstLabel}</option>`;
            activeVals.forEach(v => {
              const o = document.createElement("option");
              o.value = v.value;
              o.textContent = v.label || v.value;
              sel.appendChild(o);
            });
          }
          buildOptions($("f_member_type"), "選択してください");
          buildOptions($("searchType"),    "すべて");
        });
    })
    .catch(() => { /* CONFIG取得失敗時は HTML の既存 option をそのまま使用 */ });

  fetchMembers();

  $("searchBtn").addEventListener("click", () => fetchMembers(getSearchParams()));
  $("searchReset").addEventListener("click", () => {
    ["searchName","searchType","searchGlider"].forEach(id => $(id).value = "");
    $("searchReglimit").checked = $("searchRepack").checked = false;
    fetchMembers();
  });
  ["searchName","searchGlider"].forEach(id => {
    $(id).addEventListener("keydown", e => { if (e.key==="Enter") fetchMembers(getSearchParams()); });
  });

  $("addFromListBtn").addEventListener("click", openNew);
  $("saveBtn").addEventListener("click", saveMember);
  $("cancelBtn").addEventListener("click", handleCancel);
  $("backToList").addEventListener("click", () => { clearForm(); showView("view-list"); });
  $("deleteBtn").addEventListener("click", confirmDelete);

  $("modalConfirm").addEventListener("click", doDelete);
  $("modalCancel").addEventListener("click",  () => $("modalOverlay").classList.remove("active"));

  $("btnZipSearch").addEventListener("click", searchZip);

  // 郵便番号 分割input制御
  // f_zip_code1：数字のみ・3桁入力で f_zip_code2 へ自動フォーカス
  $("f_zip_code1").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
    _syncZipHidden();
    if (e.target.value.length >= 3) $("f_zip_code2").focus();
  });
  // f_zip_code2：数字のみ・4桁制限
  $("f_zip_code2").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
    _syncZipHidden();
  });
  // f_zip_code2 で Enter → 住所検索
  $("f_zip_code2").addEventListener("keydown", e => {
    if (e.key === "Enter") searchZip();
  });

  bindRegInputEvents();

  $("f_member_type").addEventListener("change", e => {
    $("f_contract").checked = (e.target.value === "請負");
  });

  $("f_course_type").addEventListener("change", e => {
    if (e.target.value) $("f_member_type").value = "スクール";
  });

  // ── 遷移元判定 ──────────────────────────────────────────────
  // ?from=flyer        : フライヤー申請（未）から
  // ?from=update_app   : フライヤー更新・変更から
  // ?id=XX             : スタッフ管理画面から（一覧遷移）
  const params   = new URLSearchParams(location.search);
  const fromSrc  = params.get("from") || "";
  const openId   = params.get("id");

  if (fromSrc === "flyer" || fromSrc === "update_app") {
    // 管理メニュー・一覧に戻る を非表示
    const menuBtn = $("btnToMenu");
    const backBtn = $("backToList");
    if (menuBtn) menuBtn.style.display = "none";
    if (backBtn) backBtn.style.display = "none";
    // fromSource に記録
    if ($("fromSource")) $("fromSource").value = fromSrc;
  }

  // ★ 追加：新規申請「入金済み」チェック時に分類欄の表示を更新
  $("f_payment_confirmed_new").addEventListener("change", e => {
    if (!e.target.checked) {
      // チェックを外したら分類欄を空に戻す
      if ($("f_member_type")) $("f_member_type").value = "";
      return;
    }
    // チェックを入れたら申請コースを分類欄にセット
    const mt = $("disp_new_member_type") ? $("disp_new_member_type").textContent : "";
    if (mt && mt !== "―" && $("f_member_type")) {
      $("f_member_type").value = mt;
    }
  });

  if (openId) openEdit(openId);
})
