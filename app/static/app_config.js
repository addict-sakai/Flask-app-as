/**
 * app/static/app_config.js
 * 設定管理画面 JavaScript
 * API ベースパス: /config/api/
 */

// ══════════════════════════════════════════════════════════
// 定数
// ══════════════════════════════════════════════════════════
const API = {
  categories: "/config/api/categories",
  masters:    "/config/api/masters",
  values:     "/config/api/values",
};

// ══════════════════════════════════════════════════════════
// 状態管理
// ══════════════════════════════════════════════════════════
const state = {
  categories:      [],
  masters:         [],
  currentCategory: null,
  confirmCallback: null,
};

// ══════════════════════════════════════════════════════════
// DOM ショートカット
// ══════════════════════════════════════════════════════════
const $  = (id)           => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls)              e.className   = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ══════════════════════════════════════════════════════════
// API ヘルパー
// ══════════════════════════════════════════════════════════
async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════════
// トースト通知
// ══════════════════════════════════════════════════════════
function toast(message, type = "success") {
  const t = el("div", `toast toast--${type}`, message);
  $("toastContainer").appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ══════════════════════════════════════════════════════════
// モーダル開閉
// ══════════════════════════════════════════════════════════
function openModal(id)  { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

document.addEventListener("click", (e) => {
  const closeTarget = e.target.closest("[data-close]");
  if (closeTarget) closeModal(closeTarget.dataset.close);
  if (e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("open");
  }
});

// ══════════════════════════════════════════════════════════
// 確認ダイアログ
// ══════════════════════════════════════════════════════════
function confirmDlg(message, callback) {
  $("confirmMessage").textContent = message;
  state.confirmCallback = callback;
  openModal("confirmModal");
}

$("btnConfirmOk").addEventListener("click", () => {
  closeModal("confirmModal");
  if (state.confirmCallback) state.confirmCallback();
  state.confirmCallback = null;
});

// ══════════════════════════════════════════════════════════
// カテゴリ（大項目）
// ══════════════════════════════════════════════════════════
async function loadCategories() {
  try {
    state.categories = await api("GET", API.categories);
    renderCategories();
  } catch (e) {
    toast("カテゴリの読み込みに失敗しました: " + e.message, "error");
  }
}

function renderCategories() {
  const list = $("categoryList");
  list.innerHTML = "";

  if (state.categories.length === 0) {
    list.innerHTML = '<li class="hamburger-cat-item loading">データなし</li>';
    return;
  }

  state.categories.forEach((cat) => {
    const li = el("li", "hamburger-cat-item", cat);
    if (cat === state.currentCategory) li.classList.add("active");
    li.addEventListener("click", () => {
      selectCategory(cat);
      closeHamburger();   // 項目選択でメニューを閉じる
    });
    list.appendChild(li);
  });
}

// ══════════════════════════════════════════════════════════
// ハンバーガーメニュー 開閉
// ══════════════════════════════════════════════════════════
function toggleHamburger() {
  const btn      = $("hamburgerBtn");
  const dropdown = $("hamburgerDropdown");
  const isOpen   = dropdown.classList.contains("open");
  if (isOpen) {
    closeHamburger();
  } else {
    dropdown.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  }
}

function closeHamburger() {
  const btn      = $("hamburgerBtn");
  const dropdown = $("hamburgerDropdown");
  dropdown.classList.remove("open");
  btn.setAttribute("aria-expanded", "false");
}

async function selectCategory(cat) {
  state.currentCategory = cat;
  renderCategories();
  $("headerTitle").textContent = cat;
  $("btnAddMaster").disabled   = false;
  await loadMasters(cat);
}

// ══════════════════════════════════════════════════════════
// config_master 一覧
// ══════════════════════════════════════════════════════════
async function loadMasters(category) {
  try {
    state.masters = await api("GET", `${API.masters}?category=${encodeURIComponent(category)}`);
    renderMastersTable();
  } catch (e) {
    toast("項目の読み込みに失敗しました: " + e.message, "error");
  }
}

function renderMastersTable() {
  const wrapper = $("tableWrapper");
  const badge   = $("headerBadge");

  badge.textContent = `${state.masters.length} 項目`;
  badge.hidden      = false;

  if (state.masters.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>この大項目には項目がありません。<br>「＋ 項目を追加」から追加してください。</p>
      </div>`;
    return;
  }

  const table = el("table", "config-table");

  const thead = el("thead");
  thead.innerHTML = `
    <tr>
      <th>ID</th>
      <th>項目名</th>
      <th>種別</th>
      <th>単位</th>
      <th>順番</th>
      <th>状態</th>
      <th>値</th>
      <th>操作</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = el("tbody");
  state.masters.forEach((m) => {
    const tr = el("tr");
    tr.dataset.id = m.id;

    const typeBadge   = m.value_type === "amount"
      ? '<span class="badge badge--amount">金額</span>'
      : '<span class="badge badge--options">選択肢</span>';

    const statusBadge = m.is_active
      ? '<span class="badge badge--active">有効</span>'
      : '<span class="badge badge--inactive">無効</span>';

    tr.innerHTML = `
      <td><span style="font-family:'DM Mono',monospace;color:var(--text-muted);font-size:12px">${m.id}</span></td>
      <td style="font-weight:500">${escHtml(m.item_name)}</td>
      <td>${typeBadge}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--text-secondary)">${m.unit ?? "—"}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text-muted)">${m.sort_order}</td>
      <td>${statusBadge}</td>
      <td class="js-value-cell" data-id="${m.id}">
        <span style="color:var(--text-muted);font-size:12px">読込中…</span>
      </td>
      <td>
        <div class="action-group">
          <button class="btn-icon btn-icon--value js-btn-value" title="値を管理"
            data-id="${m.id}" data-name="${escHtml(m.item_name)}" data-type="${m.value_type}">⚙</button>
          <button class="btn-icon btn-icon--edit js-btn-edit" title="項目を編集"
            data-id="${m.id}">✎</button>
          <button class="btn-icon btn-icon--del js-btn-del" title="削除"
            data-id="${m.id}" data-name="${escHtml(m.item_name)}">✕</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.innerHTML = "";
  wrapper.appendChild(table);

  state.masters.forEach((m) => loadValuePreview(m.id));
  tbody.addEventListener("click", onTableClick);
}

async function loadValuePreview(masterId) {
  try {
    const values = await api("GET", `${API.values}/${masterId}`);
    const cell   = document.querySelector(`.js-value-cell[data-id="${masterId}"]`);
    if (!cell) return;

    if (values.length === 0) {
      cell.innerHTML = '<span style="color:var(--text-muted);font-size:12px">—</span>';
      return;
    }

    const div = el("div", "value-preview");
    values.slice(0, 6).forEach((v) => div.appendChild(el("span", "value-chip", v.value)));
    if (values.length > 6) div.appendChild(el("span", "value-chip", `+${values.length - 6}`));
    cell.innerHTML = "";
    cell.appendChild(div);
  } catch (_) { /* silent */ }
}

function onTableClick(e) {
  const btnValue = e.target.closest(".js-btn-value");
  const btnEdit  = e.target.closest(".js-btn-edit");
  const btnDel   = e.target.closest(".js-btn-del");

  if (btnValue) openValueModal(parseInt(btnValue.dataset.id), btnValue.dataset.name, btnValue.dataset.type);
  if (btnEdit)  openMasterModal("edit", parseInt(btnEdit.dataset.id));
  if (btnDel)   deleteMaster(parseInt(btnDel.dataset.id), btnDel.dataset.name);
}

// ══════════════════════════════════════════════════════════
// config_master 追加・編集
// ══════════════════════════════════════════════════════════
$("btnAddMaster").addEventListener("click", () => openMasterModal("add"));

async function openMasterModal(mode, masterId) {
  $("masterModalTitle").textContent = mode === "add" ? "項目を追加" : "項目を編集";

  if (mode === "add") {
    $("masterIdField").value     = "";
    $("masterCategory").value    = state.currentCategory ?? "";
    $("masterItemName").value    = "";
    $("masterValueType").value   = "amount";
    $("masterUnit").value        = "円";
    $("masterSortOrder").value   = state.masters.length;
    $("masterDescription").value = "";
    $("masterIsActive").checked  = true;
  } else {
    try {
      const m = await api("GET", `${API.masters}/${masterId}`);
      $("masterIdField").value     = m.id;
      $("masterCategory").value    = m.category;
      $("masterItemName").value    = m.item_name;
      $("masterValueType").value   = m.value_type;
      $("masterUnit").value        = m.unit ?? "";
      $("masterSortOrder").value   = m.sort_order;
      $("masterDescription").value = m.description ?? "";
      $("masterIsActive").checked  = m.is_active;
    } catch (e) {
      toast("データの取得に失敗しました: " + e.message, "error");
      return;
    }
  }

  openModal("masterModal");
}

$("btnSaveMaster").addEventListener("click", async () => {
  const id      = $("masterIdField").value;
  const payload = {
    category:    $("masterCategory").value.trim(),
    item_name:   $("masterItemName").value.trim(),
    value_type:  $("masterValueType").value,
    unit:        $("masterUnit").value.trim() || null,
    description: $("masterDescription").value.trim() || null,
    sort_order:  parseInt($("masterSortOrder").value) || 0,
    is_active:   $("masterIsActive").checked,
  };

  if (!payload.category || !payload.item_name) {
    toast("大項目と項目名は必須です", "error");
    return;
  }

  try {
    if (id) {
      await api("PUT", `${API.masters}/${id}`, payload);
      toast("項目を更新しました");
    } else {
      await api("POST", API.masters, payload);
      toast("項目を追加しました");
    }
    closeModal("masterModal");
    await loadMasters(state.currentCategory);
    await loadCategories();
  } catch (e) {
    toast("保存に失敗しました: " + e.message, "error");
  }
});

$("btnAddCategory").addEventListener("click", () => {
  $("masterIdField").value       = "";
  $("masterModalTitle").textContent = "大項目・項目を追加";
  $("masterCategory").value      = "";
  $("masterItemName").value      = "";
  $("masterValueType").value     = "amount";
  $("masterUnit").value          = "円";
  $("masterSortOrder").value     = 0;
  $("masterDescription").value   = "";
  $("masterIsActive").checked    = true;
  openModal("masterModal");
});

async function deleteMaster(id, name) {
  confirmDlg(`「${name}」を削除しますか？\n関連する値もすべて削除されます。`, async () => {
    try {
      await api("DELETE", `${API.masters}/${id}`);
      toast("削除しました");
      await loadMasters(state.currentCategory);
      await loadCategories();
    } catch (e) {
      toast("削除に失敗しました: " + e.message, "error");
    }
  });
}

// ══════════════════════════════════════════════════════════
// config_values 管理
// ══════════════════════════════════════════════════════════
async function openValueModal(masterId, itemName, valueType) {
  $("valueMasterId").value        = masterId;
  $("valueModalTitle").textContent   = `値を管理：${itemName}`;
  $("valueModalSubtitle").textContent =
    valueType === "amount" ? "金額（1件のみ推奨）" : "選択肢（複数設定可）";

  await refreshValueTable(masterId);
  openModal("valueModal");
}

async function refreshValueTable(masterId) {
  const mid = masterId ?? parseInt($("valueMasterId").value);
  try {
    const values = await api("GET", `${API.values}/${mid}`);
    renderValueTable(values);
  } catch (e) {
    toast("値の読み込みに失敗しました: " + e.message, "error");
  }
}

function renderValueTable(values) {
  const tbody = $("valueTableBody");
  tbody.innerHTML = "";

  if (values.length === 0) {
    const tr = el("tr");
    const td = el("td");
    td.colSpan = 4;
    td.style.cssText = "text-align:center;color:var(--text-muted);padding:20px;font-size:13px";
    td.textContent   = "値がありません";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  values.forEach((v) => {
    const tr = el("tr");
    tr.dataset.vid = v.id;
    tr.innerHTML = `
      <td><input type="text"   class="v-value" value="${escHtml(v.value)}"       placeholder="値" /></td>
      <td><input type="number" class="v-sort"  value="${v.sort_order}" min="0" /></td>
      <td>
        <label class="toggle-label">
          <input type="checkbox" class="toggle-input v-active" ${v.is_active ? "checked" : ""} />
          <span class="toggle-track"></span>
        </label>
      </td>
      <td>
        <div class="action-group">
          <button class="btn-icon btn-icon--edit js-btn-save-value" title="保存" data-vid="${v.id}">💾</button>
          <button class="btn-icon btn-icon--del  js-btn-del-value"  title="削除" data-vid="${v.id}" data-val="${escHtml(v.value)}">✕</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

$("valueTableBody").addEventListener("click", async (e) => {
  const btnSave = e.target.closest(".js-btn-save-value");
  const btnDel  = e.target.closest(".js-btn-del-value");

  if (btnSave) {
    const vid  = parseInt(btnSave.dataset.vid);
    const tr   = btnSave.closest("tr");
    const payload = {
      value:      tr.querySelector(".v-value").value.trim(),
      label:      tr.querySelector(".v-value").value.trim() || null,
      sort_order: parseInt(tr.querySelector(".v-sort").value)  || 0,
      is_active:  tr.querySelector(".v-active").checked,
    };
    if (!payload.value) { toast("値は必須です", "error"); return; }
    try {
      await api("PUT", `${API.values}/${vid}`, payload);
      toast("値を更新しました");
      await refreshValueTable();
      await loadMasters(state.currentCategory);
    } catch (e2) {
      toast("更新に失敗しました: " + e2.message, "error");
    }
  }

  if (btnDel) {
    const vid = parseInt(btnDel.dataset.vid);
    const val = btnDel.dataset.val;
    confirmDlg(`値「${val}」を削除しますか？`, async () => {
      try {
        await api("DELETE", `${API.values}/${vid}`);
        toast("削除しました");
        await refreshValueTable();
        await loadMasters(state.currentCategory);
      } catch (e2) {
        toast("削除に失敗しました: " + e2.message, "error");
      }
    });
  }
});

$("btnAddValue").addEventListener("click", async () => {
  const masterId = parseInt($("valueMasterId").value);
  const value    = $("newValue").value.trim();
  if (!value) { toast("値は必須です", "error"); return; }

  const payload = {
    master_id:  masterId,
    value,
    label:      value,
    sort_order: parseInt($("newSortOrder").value) || 0,
    is_active:  true,
  };

  try {
    await api("POST", API.values, payload);
    toast("値を追加しました");
    $("newValue").value     = "";
    $("newSortOrder").value = 0;
    await refreshValueTable();
    await loadMasters(state.currentCategory);
  } catch (e) {
    toast("追加に失敗しました: " + e.message, "error");
  }
});

// ══════════════════════════════════════════════════════════
// ユーティリティ
// ══════════════════════════════════════════════════════════
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ══════════════════════════════════════════════════════════
// 初期化
// ══════════════════════════════════════════════════════════
(async () => {
  // ハンバーガーボタンのクリックで開閉
  $("hamburgerBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHamburger();
  });

  // パネル外クリックで閉じる
  document.addEventListener("click", (e) => {
    const wrap = $("hamburgerWrap");
    if (wrap && !wrap.contains(e.target)) {
      closeHamburger();
    }
  });

  await loadCategories();
})();
