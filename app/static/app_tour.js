/**
 * app_tour.js
 * ツアー申込書 フロントエンド
 * 新規作成（2026-04-11）
 * 改定６（2026/04/11）:
 *   - 編集モードでも引率者・参加者の削除ボタンを有効にする
 *   - 編集モードでも引率者・参加者の検索（追加登録）を可能にする
 *   - 引率者・参加者データはreadonly（既存データ変更不可）
 */

"use strict";

// ============================================================
// 状態管理
// ============================================================
const state = {
  flightDateFrom: null,
  flightDateTo:   null,
  flightDays:     0,
  editMode:       false,
  bookingId:      null,
  bookingNo:      null,
};

// ============================================================
// DOM参照
// ============================================================
const $  = id => document.getElementById(id);
const $q = sel => document.querySelector(sel);

// ============================================================
// 初期化
// ============================================================
document.addEventListener("DOMContentLoaded", () => {

  // URLパラメータから編集モード判定
  const params = new URLSearchParams(location.search);
  const editNo = params.get("edit");
  if (editNo) {
    state.editMode  = true;
    state.bookingNo = editNo;
    $("pageTitle").textContent       = "ツアー申込詳細登録 編集";
    $("submitBtn").textContent       = "✔ 更　新";
    $("deleteBtn").style.display     = "";
    $("bookingNoRow").style.display  = "";
    $("bookingNoDisplay").value      = editNo;
    loadBooking(editNo);
  }

  // 日付ピッカー
  const fpOpts = {
    locale: "ja",
    dateFormat: "Y/m/d",
    allowInput: true,
    onChange: () => recalcFlightDays(),
  };
  flatpickr("#flightDateFrom", fpOpts);
  flatpickr("#flightDateTo",   fpOpts);

  // ハンバーガーメニュー
  $("hmMenuBtn").addEventListener("click", e => {
    e.stopPropagation();
    $("hmDropdown").classList.toggle("is-open");
  });
  document.addEventListener("click", () => $("hmDropdown").classList.remove("is-open"));

  // 申込/更新ボタン
  $("submitBtn").addEventListener("click", () => {
    $("hmDropdown").classList.remove("is-open");
    state.editMode ? updateBooking() : submitBooking();
  });

  // 削除ボタン
  $("deleteBtn").addEventListener("click", () => {
    $("hmDropdown").classList.remove("is-open");
    deleteBooking();
  });

  // 終了ボタン
  $("exitBtn").addEventListener("click", () => {
    if (confirm("申込フォームを終了しますか？")) {
      window.location.href = "/apply_tour_select";
    }
  });

  // 検索ボタン（新規モードのみ有効）
  $("leaderSearchBtn").addEventListener("click", () =>
    searchMember("leader", $("leaderSearchName").value, $("leaderSearchPhone").value));
  $("participantSearchBtn").addEventListener("click", () =>
    searchMember("participant", $("participantSearchName").value, $("participantSearchPhone").value));

  // Enterキーで検索
  [$("leaderSearchName"), $("leaderSearchPhone")].forEach(el =>
    el.addEventListener("keydown", e => { if (e.key === "Enter") $("leaderSearchBtn").click(); }));
  [$("participantSearchName"), $("participantSearchPhone")].forEach(el =>
    el.addEventListener("keydown", e => { if (e.key === "Enter") $("participantSearchBtn").click(); }));

  // モーダルボタン
  $("modalNewBtn").addEventListener("click", () => {
    $("completeModal").classList.remove("is-open");
    window.location.href = "/apply_tour_select";
  });
  $("modalExitBtn").addEventListener("click", () => {
    window.location.href = "/apply_tour_select";
  });
});

// ============================================================
// フライト日数計算
// ============================================================
function recalcFlightDays() {
  const from = parseJpDate($("flightDateFrom").value);
  const to   = parseJpDate($("flightDateTo").value);

  if (!from || !to || to < from) {
    state.flightDateFrom = null;
    state.flightDateTo   = null;
    state.flightDays     = 0;
    $("flightDateDisplay").textContent = "－";
    return;
  }

  state.flightDateFrom = from;
  state.flightDateTo   = to;
  const days = Math.round((to - from) / 86400000) + 1;
  state.flightDays = days;

  const fmt = d => `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  $("flightDateDisplay").textContent = `${fmt(from)}  ～  ${fmt(to)}　[${days}日間]`;
}

function parseJpDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2]-1, +m[3]);
}

function setDatePicker(id, isoDate) {
  if (!isoDate) return;
  const el = document.querySelector(`#${id}`);
  if (el && el._flatpickr) el._flatpickr.setDate(isoDate.replace(/-/g, "/"));
}

// ============================================================
// 参加者合計人数バッジ更新
// ============================================================
function updateParticipantCount() {
  const count = $("participantCardList").querySelectorAll(".member-card").length;
  const badge = $("participantCountBadge");
  if (badge) badge.textContent = `（${count}名）`;
}

// ============================================================
// フライト期間の日付リストを生成
// ============================================================
function getFlightDates() {
  if (!state.flightDateFrom || !state.flightDateTo) return [];
  const dates = [];
  const cur = new Date(state.flightDateFrom);
  while (cur <= state.flightDateTo) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// 日付を表示用文字列に変換（例: 5/10）
function fmtDateShort(d) {
  return `${d.getMonth()+1}/${d.getDate()}`;
}

// 日付を比較用文字列に変換（例: 2026-05-10）
function fmtDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// attend_days文字列から選択済み日付のセットを生成
function parseAttendDays(str) {
  if (!str) return new Set();
  const parts = str.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
  return new Set(parts);
}

// ============================================================
// 参加日チェックボックスUIを生成してカードに挿入
// ============================================================
function buildAttendDaysUI(card, existingAttendDays) {
  const dates = getFlightDates();
  const existing = parseAttendDays(existingAttendDays || "");

  const container = card.querySelector(".attend-days-container");
  if (!container) return;

  container.innerHTML = "";

  if (dates.length === 0) {
    container.innerHTML = `<span style="color:var(--text-muted,#888);font-size:13px;">フライト期間を先に設定してください</span>`;
    return;
  }

  const checkboxWrap = document.createElement("div");
  checkboxWrap.className = "attend-days-checks";
  checkboxWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;";

  dates.forEach(d => {
    const short = fmtDateShort(d);
    // 既存データとの照合（M/D 形式または YYYY-MM-DD 形式）
    const isChecked = existing.has(short) || existing.has(fmtDateISO(d));

    const label = document.createElement("label");
    label.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;cursor:pointer;font-size:14px;background:#fff;user-select:none;";
    label.innerHTML = `
      <input type="checkbox" value="${short}" ${isChecked ? "checked" : ""}
             style="width:16px;height:16px;cursor:pointer;">
      <span>${short}</span>
    `;
    checkboxWrap.appendChild(label);

    // チェック時のビジュアル更新
    const cb = label.querySelector("input");
    cb.addEventListener("change", () => {
      label.style.background    = cb.checked ? "#e0f2fe" : "#fff";
      label.style.borderColor   = cb.checked ? "#0ea5e9" : "var(--border,#d1d5db)";
      syncAttendDaysHidden(card);
    });
    // 初期ビジュアル
    if (isChecked) {
      label.style.background  = "#e0f2fe";
      label.style.borderColor = "#0ea5e9";
    }
  });

  container.appendChild(checkboxWrap);
  syncAttendDaysHidden(card);
}

// チェックボックスの選択状態を hidden input に同期
function syncAttendDaysHidden(card) {
  const hidden = card.querySelector("[data-field='attend_days']");
  if (!hidden) return;
  const checks = card.querySelectorAll(".attend-days-checks input[type='checkbox']:checked");
  hidden.value = Array.from(checks).map(c => c.value).join(", ");
}

// ============================================================
// 既存申込データのロード（編集モード）
// ============================================================
async function loadBooking(bookingNo) {
  try {
    const res = await fetch(`/api/tour/bookings/by-no/${encodeURIComponent(bookingNo)}`);
    if (!res.ok) {
      alert(`申込番号 ${bookingNo} が見つかりませんでした。`);
      window.location.href = "/apply_tour_select";
      return;
    }
    const data = await res.json();
    state.bookingId = data.id;

    $("schoolName").value = data.school_name || "";
    if ($("contactEmail")) $("contactEmail").value = data.contact_email || "";
    setDatePicker("flightDateFrom", data.flight_date_from);
    setDatePicker("flightDateTo",   data.flight_date_to);
    recalcFlightDays();

    // 引率者カード（編集不可）
    const leaderList = $("leaderCardList");
    leaderList.innerHTML = "";
    (data.leaders || []).forEach((ld, i) => {
      const card = createLeaderCard(i, true);  // editMode=true
      leaderList.appendChild(card);
      fillCardFromData(card, ld, "leader");
    });
    renumberCards(leaderList, "引率者");

    // 参加者カード（参加日のみ編集可）
    const participantList = $("participantCardList");
    participantList.innerHTML = "";
    (data.participants || []).forEach((p, i) => {
      const card = createParticipantCard(i, true);  // editMode=true
      participantList.appendChild(card);
      fillCardFromData(card, p, "participant");
      // チェックボックスUIを構築（フライト日が確定後）
      buildAttendDaysUI(card, p.attend_days);
    });
    renumberCards(participantList, "参加者");
    updateParticipantCount();

  } catch (err) {
    console.error("loadBooking error:", err);
    alert("データの読み込みに失敗しました");
    window.location.href = "/apply_tour_select";
  }
}

function fillCardFromData(card, data, type) {
  const set = (field, val) => {
    const el = card.querySelector(`[data-field='${field}']`);
    if (el && el.type !== "hidden") el.value = val || "";
  };
  if (data.id) card.dataset.dbId = data.id;

  const badge = card.querySelector(".member-badge");
  if (badge && data.full_name) {
    badge.className = "member-badge badge-registered";
    badge.textContent = "登録済";
  }

  set("full_name",   data.full_name);
  set("phone",       data.phone);
  set("license",     data.license);
  set("reg_no",      data.reg_no);
  set("member_type", data.member_type);

  if (type === "leader") {
    set("instructor_role", data.instructor_role);
  }
  // attend_days は buildAttendDaysUI で別途処理
}

// ============================================================
// 会員検索（氏名＆電話番号の両方必須）
// ============================================================
async function searchMember(type, name, phone) {
  name  = (name  || "").trim();
  phone = (phone || "").trim();

  if (!name || !phone) {
    alert("氏名と電話番号の両方を入力してください");
    return;
  }

  const params = new URLSearchParams();
  params.set("name",  name);
  params.set("phone", phone);

  try {
    const res  = await fetch(`/api/tour/search_member?${params}`);
    const data = await res.json();

    const dropdownId = type === "leader" ? "leaderDropdown" : "participantDropdown";
    const dropdown   = $(dropdownId);

    if (data.status === "not_found" || !data.results || data.results.length === 0) {
      dropdown.innerHTML = `<div class="search-dropdown-empty">該当する会員が見つかりません</div>`;
    } else {
      dropdown.innerHTML = data.results.map((r, i) => `
        <div class="search-dropdown-item" data-index="${i}" data-type="${type}" data-json='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
          <div class="item-name">${esc(r.full_name)} <small style="color:var(--text-muted)">${esc(r.member_number||"")}</small></div>
          <div class="item-sub">
            ${r.phone ? "📞 "+esc(r.phone)+"　" : ""}
            ${r.license ? "技能："+esc(r.license)+"　" : ""}
            ${r.member_type ? "分類："+esc(r.member_type) : ""}
          </div>
        </div>
      `).join("");
    }

    dropdown.classList.add("is-open");

    dropdown.querySelectorAll(".search-dropdown-item").forEach(el => {
      el.addEventListener("click", () => {
        const member = JSON.parse(el.dataset.json.replace(/&#39;/g, "'"));
        fillMemberIntoCard(type, member);
        dropdown.classList.remove("is-open");
        clearSearchInputs(type);
      });
    });

    setTimeout(() => {
      document.addEventListener("click", function closeHandler() {
        dropdown.classList.remove("is-open");
        document.removeEventListener("click", closeHandler);
      });
    }, 50);

  } catch (err) {
    console.error("検索エラー:", err);
    alert("検索中にエラーが発生しました");
  }
}

function clearSearchInputs(type) {
  if (type === "leader") {
    $("leaderSearchName").value  = "";
    $("leaderSearchPhone").value = "";
  } else {
    $("participantSearchName").value  = "";
    $("participantSearchPhone").value = "";
  }
}

// ============================================================
// 検索結果をカードに反映（新規モードのみ）
// ============================================================
function fillMemberIntoCard(type, member) {
  const listId = type === "leader" ? "leaderCardList" : "participantCardList";
  const list   = $(listId);
  const cards  = list.querySelectorAll(".member-card");

  for (const card of cards) {
    const nameEl = card.querySelector("[data-field='full_name']");
    if (nameEl && !nameEl.value.trim()) {
      setCardFromMember(card, member, type);
      if (type === "participant") {
        buildAttendDaysUI(card, "");
        updateParticipantCount();
      }
      return;
    }
  }

  const newCard = type === "leader"
    ? createLeaderCard(cards.length, false)
    : createParticipantCard(cards.length, false);
  list.appendChild(newCard);
  renumberCards(list, type === "leader" ? "引率者" : "参加者");
  setCardFromMember(newCard, member, type);
  if (type === "participant") {
    buildAttendDaysUI(newCard, "");
    updateParticipantCount();
  }
}

function setCardFromMember(card, member, type) {
  const set = (field, val) => {
    const el = card.querySelector(`[data-field='${field}']`);
    if (el) {
      el.value = val || "";
      if (field !== "attend_days") el.readOnly = !!(val);
    }
  };

  const badge = card.querySelector(".member-badge");
  if (badge) {
    badge.className = "member-badge badge-registered";
    badge.textContent = "登録済";
  }

  set("full_name",   member.full_name);
  set("phone",       member.phone);
  set("license",     member.license);
  set("reg_no",      member.reg_no);
  set("member_type", member.member_type);

  if (type === "leader") {
    set("instructor_role", member.instructor_role);
  }
}

// ============================================================
// 引率者カード生成
// editMode=true: 全フィールドreadonly（分類・教員区分は常にreadonly）
// ============================================================
function createLeaderCard(index, editMode) {
  const card = document.createElement("div");
  card.className = "member-card";

  const roStyle = "background:var(--surface-alt,#f5f5f5);color:var(--text-secondary,#555);";
  card.innerHTML = `
    <div class="member-card-header">
      <span class="member-card-no">引率者 ${index + 1}</span>
      <span class="member-badge badge-new">未登録</span>
      <button type="button" class="btn-remove" title="削除">✕ 削除</button>
    </div>
    <div class="member-card-grid">
      <div class="card-field">
        <label class="card-field-label required">氏名</label>
        <input type="text" class="card-field-value" data-field="full_name"
               placeholder="氏名を入力" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">電話番号</label>
        <input type="text" class="card-field-value" data-field="phone"
               placeholder="090-xxxx-xxxx" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">技能証</label>
        <input type="text" class="card-field-value" data-field="license"
               placeholder="A/B/P/XC等" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">フライヤー登録番号</label>
        <input type="text" class="card-field-value" data-field="reg_no"
               placeholder="JHF/JPA番号" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">分類</label>
        <input type="text" class="card-field-value" data-field="member_type" readonly
               style="${roStyle}" placeholder="検索で自動入力">
      </div>
      <div class="card-field">
        <label class="card-field-label">教員区分</label>
        <input type="text" class="card-field-value" data-field="instructor_role" readonly
               style="${roStyle}" placeholder="検索で自動入力">
      </div>
    </div>
  `;

  card.querySelector(".btn-remove").addEventListener("click", async () => {
    const dbId = card.dataset.dbId;
    if (dbId && state.editMode) {
      if (!confirm("この引率者を削除しますか？")) return;
      try {
        const res = await fetch(`/api/tour/leaders/${dbId}`, { method: "DELETE" });
        if (!res.ok) { alert("削除に失敗しました"); return; }
      } catch { alert("通信エラーが発生しました"); return; }
    }
    card.remove();
    renumberCards($("leaderCardList"), "引率者");
  });

  card.querySelector("[data-field='full_name']").addEventListener("input", function() {
    const badge = card.querySelector(".member-badge");
    badge.className = "member-badge badge-new";
    badge.textContent = "未登録";
  });

  return card;
}

// ============================================================
// 参加者カード生成
// editMode=true: 参加日のみ編集可、他readonly
// ============================================================
function createParticipantCard(index, editMode) {
  const card = document.createElement("div");
  card.className = "member-card";

  const roStyle = "background:var(--surface-alt,#f5f5f5);color:var(--text-secondary,#555);";
  card.innerHTML = `
    <div class="member-card-header">
      <span class="member-card-no">参加者 ${index + 1}</span>
      <span class="member-badge badge-new">未登録</span>
      <button type="button" class="btn-remove" title="削除">✕ 削除</button>
    </div>
    <div class="member-card-grid">
      <div class="card-field">
        <label class="card-field-label required">氏名</label>
        <input type="text" class="card-field-value" data-field="full_name"
               placeholder="氏名を入力" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">電話番号</label>
        <input type="text" class="card-field-value" data-field="phone"
               placeholder="090-xxxx-xxxx" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">技能証</label>
        <input type="text" class="card-field-value" data-field="license"
               placeholder="A/B/P/XC等" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">フライヤー登録番号</label>
        <input type="text" class="card-field-value" data-field="reg_no"
               placeholder="JHF/JPA番号" ${editMode ? 'readonly style="'+roStyle+'"' : ""}>
      </div>
      <div class="card-field">
        <label class="card-field-label">分類</label>
        <input type="text" class="card-field-value" data-field="member_type" readonly
               style="${roStyle}" placeholder="検索で自動入力">
      </div>
      <div class="card-field span-2">
        <label class="card-field-label required">参加日</label>
        <div class="attend-days-container"></div>
        <input type="hidden" data-field="attend_days" value="">
      </div>
    </div>
  `;

  card.querySelector(".btn-remove").addEventListener("click", async () => {
    const dbId = card.dataset.dbId;
    if (dbId && state.editMode) {
      if (!confirm("この参加者を削除しますか？")) return;
      try {
        const res = await fetch(`/api/tour/participants/${dbId}`, { method: "DELETE" });
        if (!res.ok) { alert("削除に失敗しました"); return; }
      } catch { alert("通信エラーが発生しました"); return; }
    }
    card.remove();
    renumberCards($("participantCardList"), "参加者");
    updateParticipantCount();
  });

  card.querySelector("[data-field='full_name']").addEventListener("input", function() {
    const badge = card.querySelector(".member-badge");
    badge.className = "member-badge badge-new";
    badge.textContent = "未登録";
  });

  return card;
}

// ============================================================
// カード番号付け直し
// ============================================================
function renumberCards(list, label) {
  list.querySelectorAll(".member-card").forEach((card, i) => {
    const no = card.querySelector(".member-card-no");
    if (no) no.textContent = `${label} ${i + 1}`;
  });
}

// ============================================================
// バリデーション共通
// ============================================================
function validateForm() {
  const schoolName = $("schoolName").value.trim();
  if (!schoolName) {
    alert("スクール/エリア名を入力してください");
    $("schoolName").focus();
    return null;
  }
  if (!state.flightDateFrom || !state.flightDateTo) {
    alert("フライト開始日・終了日を選択してください");
    return null;
  }

  // school_name チェックの直後に追加
  const contactEmail = $("contactEmail") ? $("contactEmail").value.trim() : "";
  if (!contactEmail) {
    alert("連絡先メールアドレスを入力してください");
    $("contactEmail").focus();
    return null;
  }

  const leaderCards = $("leaderCardList").querySelectorAll(".member-card");
  if (leaderCards.length === 0) {
    alert("引率者を1名以上登録してください");
    return null;
  }
  const leaders = [];
  for (const [i, card] of leaderCards.entries()) {
    const name = card.querySelector("[data-field='full_name']").value.trim();
    if (!name) { alert(`引率者 ${i+1} の氏名を入力してください`); return null; }
    leaders.push(collectCard(card, "leader", i));
  }

  const participantCards = $("participantCardList").querySelectorAll(".member-card");
  const participants = [];
  for (const [i, card] of participantCards.entries()) {
    const name = card.querySelector("[data-field='full_name']").value.trim();
    if (!name) { alert(`参加者 ${i+1} の氏名を入力してください`); return null; }
    // チェックボックスから attend_days を収集
    syncAttendDaysHidden(card);
    const attendDays = card.querySelector("[data-field='attend_days']").value.trim();
    if (!attendDays) { alert(`参加者 ${i+1} の参加日を選択してください`); return null; }
    participants.push(collectCard(card, "participant", i));
  }

  return {
    school_name:      schoolName,
    contact_email:    ($("contactEmail") ? $("contactEmail").value.trim() : "") || null,
    flight_date_from: formatDate(state.flightDateFrom),
    flight_date_to:   formatDate(state.flightDateTo),
    flight_days:      state.flightDays,
    leaders,
    participants,
  };
}

// ============================================================
// 新規申込送信
// ============================================================
async function submitBooking() {
  const body = validateForm();
  if (!body) return;

  try {
    $("submitBtn").disabled = true;
    const res  = await fetch("/api/tour/bookings", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (data.status === "ok") {
      $("modalTitle").textContent     = "申込が完了しました";
      $("modalBookingNo").textContent = data.booking_no;
      $("modalMsg").innerHTML = "申込番号をお控えください。<br>当日ショップにてご確認をお願いします。";
      $("completeModal").classList.add("is-open");
    } else {
      alert("エラー：" + (data.message || "送信に失敗しました"));
    }
  } catch (err) {
    console.error(err);
    alert("通信エラーが発生しました");
  } finally {
    $("submitBtn").disabled = false;
  }
}

// ============================================================
// 更新送信（編集モード）
// ============================================================
async function updateBooking() {
  const body = validateForm();
  if (!body) return;

  try {
    $("submitBtn").disabled = true;
    const res  = await fetch(`/api/tour/bookings/${state.bookingId}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (data.status === "ok") {
      $("modalTitle").textContent     = "更新が完了しました";
      $("modalBookingNo").textContent = state.bookingNo;
      $("modalMsg").innerHTML         = "内容を更新しました。";
      $("completeModal").classList.add("is-open");
    } else {
      alert("エラー：" + (data.message || "更新に失敗しました"));
    }
  } catch (err) {
    console.error(err);
    alert("通信エラーが発生しました");
  } finally {
    $("submitBtn").disabled = false;
  }
}

// ============================================================
// 申込削除（編集モード）
// ============================================================
async function deleteBooking() {
  if (!confirm(`${state.bookingNo} のツアー申込を削除しますか？\nこの操作は取り消せません。`)) return;

  try {
    $("deleteBtn").disabled = true;
    const res  = await fetch(`/api/tour/bookings/${state.bookingId}`, { method: "DELETE" });
    const data = await res.json();

    if (data.status === "ok") {
      alert(`${state.bookingNo} を削除しました`);
      window.location.href = "/apply_tour_select";
    } else {
      alert("削除エラー：" + (data.message || "削除に失敗しました"));
    }
  } catch (err) {
    console.error(err);
    alert("通信エラーが発生しました");
  } finally {
    $("deleteBtn").disabled = false;
  }
}

// ============================================================
// カードデータ収集
// ============================================================
function collectCard(card, type, sortOrder) {
  const get = field => (card.querySelector(`[data-field='${field}']`)?.value || "").trim();
  const base = {
    sort_order:  sortOrder,
    full_name:   get("full_name"),
    phone:       get("phone")    || null,
    license:     get("license")  || null,
    reg_no:      get("reg_no")   || null,
    member_type: get("member_type") || null,
  };
  if (type === "leader") {
    base.instructor_role = get("instructor_role") || null;
  } else {
    base.attend_days = get("attend_days") || null;
  }
  return base;
}

function formatDate(d) {
  if (!d) return null;
  const y   = d.getFullYear();
  const m   = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function esc(str) {
  return String(str||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
