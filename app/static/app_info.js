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
    "f_zip_code","f_address","f_mobile_phone","f_home_phone",
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

    // 文字列フィールド
    [
      "member_type","member_number","full_name","furigana","gender","blood_type",
      "weight","zip_code","address","mobile_phone","home_phone","email",
      "company_name","company_phone","emergency_name","emergency_phone","relationship",
      "course_type","course_name","course_fee","course_find",
      "glider_name","glider_color","organization","license",
      "experience","home_area","leader","visitor_fee",
      "signature_name","guardian_name","medical_history",
    ].forEach(f => {
      const el = $("f_" + f);
      if (el && m[f] != null) el.value = m[f];
    });

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
    const org = m.organization || "";
    switchRegUI(org);
    if (org && m.reg_no) {
      const parsed = parseRegNo(org, m.reg_no);
      if (org === "JHF") { $("f_reg_jhf1").value = parsed.jhf1; $("f_reg_jhf2").value = parsed.jhf2; }
      if (org === "JPA") { $("f_reg_jpa").value = parsed.jpa; }
      updateRegPreview();
    }

    showView("view-add");
    document.querySelector(".edit-scroll-area").scrollTop = 0;
  } catch (e) {
    showToast("データ取得に失敗しました","error");
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

  if (!$("f_full_name").value.trim()) {
    showToast("氏名を入力してください","error");
    return;
  }

  const payload = {};

  [
    "member_type","full_name","furigana","gender","blood_type",
    "weight","zip_code","address","mobile_phone","home_phone","email",
    "company_name","company_phone","emergency_name","emergency_phone","relationship",
    "course_type","course_name","course_fee","course_find",
    "glider_name","glider_color","repack_date","organization","license",
    "experience","home_area","leader","visitor_fee","medical_history",
  ].forEach(f => {
    const el = $("f_" + f);
    payload[f] = el ? (el.value || null) : null;
  });

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

    showToast(isEdit ? "更新しました" : "登録しました");
    await fetchMembers(getSearchParams());
    showView("view-list");
  } catch (e) {
    showToast(e.message,"error");
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
  const zip = ($("f_zip_code").value || "").replace(/-/g,"").trim();
  if (zip.length !== 7) { showToast("7桁の郵便番号を入力してください","error"); return; }
  try {
    const res  = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
    const data = await res.json();
    if (data.results?.length) {
      const r = data.results[0];
      $("f_address").value = r.address1 + r.address2 + r.address3;
    } else {
      showToast("住所が見つかりませんでした","error");
    }
  } catch { showToast("住所検索に失敗しました","error"); }
}

/* ================================================
   初期化
   ================================================ */
document.addEventListener("DOMContentLoaded", () => {
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
  $("cancelBtn").addEventListener("click", () => { clearForm(); showView("view-list"); });
  $("backToList").addEventListener("click", () => { clearForm(); showView("view-list"); });
  $("deleteBtn").addEventListener("click", confirmDelete);

  $("modalConfirm").addEventListener("click", doDelete);
  $("modalCancel").addEventListener("click",  () => $("modalOverlay").classList.remove("active"));

  $("btnZipSearch").addEventListener("click", searchZip);

  bindRegInputEvents();

  $("f_member_type").addEventListener("change", e => {
    $("f_contract").checked = (e.target.value === "請負");
  });
});
