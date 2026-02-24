/**
 * 会員管理画面 - app_info.js
 * ===========================
 * エンドポイント（member_routes.py に定義）:
 *   GET    /api/members           一覧取得・検索
 *   POST   /api/members           新規作成
 *   GET    /api/members/:id       1件取得
 *   PUT    /api/members/:id       更新
 *   DELETE /api/members/:id       削除
 */

'use strict';

// =========================================
// DOM参照
// =========================================

const views        = { list: document.getElementById('view-list'), add: document.getElementById('view-add') };
const navItems     = document.querySelectorAll('.nav-item');
const memberForm   = document.getElementById('memberForm');
const formTitle    = document.getElementById('formTitle');
const tableBody    = document.getElementById('memberTableBody');
const totalCount   = document.getElementById('totalCount');
const deleteBtn    = document.getElementById('deleteBtn');
const toast        = document.getElementById('toast');
const modalOverlay = document.getElementById('modalOverlay');

// =========================================
// フィールド定義
// =========================================

// 日付フィールド（YYYY-MM-DD）
const DATE_FIELDS = ['application_date', 'birthday', 'agreement_date', 'reglimit_date'];

// 年月フィールド（YYYY-MM、input[type=month]）
const MONTH_FIELDS = ['repack_date'];

// 文字列フィールド
const STR_FIELDS = [
  'member_type', 'member_number', 'full_name', 'furigana', 'gender', 'blood_type',
  'weight', 'zip_code', 'address', 'mobile_phone', 'home_phone',
  'company_name', 'company_phone', 'emergency_name', 'emergency_phone',
  'email', 'medical_history', 'relationship',
  'course_type', 'course_name', 'course_fee', 'course_find',
  'glider_name', 'glider_color',
  'reg_no', 'license', 'experience', 'home_area', 'leader', 'visitor_fee',
  'signature_name', 'guardian_name',
];

// boolean フィールド（チェックボックス）
const BOOL_FIELDS = ['contract'];

const ALL_FIELDS = [...STR_FIELDS, ...DATE_FIELDS, ...MONTH_FIELDS];

// =========================================
// ビュー切り替え
// =========================================

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
}

navItems.forEach(btn => btn.addEventListener('click', () => {
  btn.dataset.view === 'list' ? showView('list') : openAddForm();
}));

document.getElementById('addFromListBtn').addEventListener('click', openAddForm);
document.getElementById('backToList').addEventListener('click', () => showView('list'));
document.getElementById('cancelBtn').addEventListener('click', () => showView('list'));

// =========================================
// トースト通知
// =========================================

let _toastTimer = null;

function showToast(msg, type = 'success') {
  clearTimeout(_toastTimer);
  toast.textContent = msg;
  toast.className = `toast toast-${type} show`;
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// =========================================
// API通信
// =========================================

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// =========================================
// 一覧取得・表示
// =========================================

async function loadList(params = {}) {
  try {
    const qs = new URLSearchParams(params).toString();
    const members = await apiFetch('/api/members' + (qs ? `?${qs}` : ''));
    renderTable(members);
  } catch (err) {
    showToast('データの取得に失敗しました: ' + err.message, 'error');
    renderTable([]);
  }
}

function renderTable(members) {
  totalCount.textContent = members.length;

  if (!members.length) {
    tableBody.innerHTML = '<tr class="empty-row"><td colspan="7">データがありません</td></tr>';
    return;
  }

  tableBody.innerHTML = members.map(m => `
    <tr>
      <td><span style="font-family:var(--font-mono);font-size:12px">${esc(m.member_number || '—')}</span></td>
      <td>${esc(m.full_name)}</td>
      <td>${renderBadge(m.member_type)}</td>
      <td>${esc(m.glider_name || '—')}</td>
      <td>${renderDate(m.reglimit_date)}</td>
      <td>${renderDate(m.repack_date)}</td>
      <td><button class="action-btn" onclick="openEditForm(${m.id})">編集</button></td>
    </tr>
  `).join('');
}

function renderBadge(type) {
  if (!type) return '<span style="color:var(--text-muted)">—</span>';
  const cls = { '会員': 'badge-member', 'スクール': 'badge-school', 'ビジター': 'badge-visitor' }[type] || '';
  return `<span class="badge ${cls}">${esc(type)}</span>`;
}

function renderDate(dateStr) {
  if (!dateStr) return '<span class="date-ok">—</span>';
  const d = new Date(dateStr);
  const limit = new Date();
  limit.setMonth(limit.getMonth() + 1);
  const fmt = d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return d <= limit
    ? `<span class="date-warning">⚠ ${fmt}</span>`
    : `<span class="date-ok">${fmt}</span>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =========================================
// 検索
// =========================================

document.getElementById('searchBtn').addEventListener('click', () => {
  const params = {};
  const name   = document.getElementById('searchName').value.trim();
  const type   = document.getElementById('searchType').value;
  const glider = document.getElementById('searchGlider').value.trim();

  if (name)   params.name = name;
  if (type)   params.member_type = type;
  if (glider) params.glider_name = glider;
  if (document.getElementById('searchReglimit').checked) params.reglimit_soon = '1';
  if (document.getElementById('searchRepack').checked)   params.repack_soon   = '1';

  loadList(params);
});

document.getElementById('searchReset').addEventListener('click', () => {
  document.getElementById('searchName').value    = '';
  document.getElementById('searchType').value    = '';
  document.getElementById('searchGlider').value  = '';
  document.getElementById('searchReglimit').checked = false;
  document.getElementById('searchRepack').checked   = false;
  loadList();
});

// =========================================
// フォーム操作
// =========================================

function clearForm() {
  ALL_FIELDS.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    if (el) el.value = '';
  });
  BOOL_FIELDS.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    if (el) el.checked = false;
  });
  document.getElementById('editId').value = '';
}

function openAddForm() {
  formTitle.textContent    = '新規登録';
  deleteBtn.style.display  = 'none';
  clearForm();
  showView('add');
}

async function openEditForm(id) {
  try {
    const member = await apiFetch(`/api/members/${id}`);

    formTitle.textContent   = '会員情報の編集';
    deleteBtn.style.display = '';
    document.getElementById('editId').value = id;

    STR_FIELDS.forEach(f => {
      const el = document.getElementById(`f_${f}`);
      if (el) el.value = member[f] ?? '';
    });

    DATE_FIELDS.forEach(f => {
      const el = document.getElementById(`f_${f}`);
      if (!el) return;
      const val = member[f];
      // ISO日付文字列から YYYY-MM-DD を取り出す
      el.value = val ? val.slice(0, 10) : '';
    });

    MONTH_FIELDS.forEach(f => {
      const el = document.getElementById(`f_${f}`);
      if (!el) return;
      const val = member[f];
      // YYYY-MM-DD → YYYY-MM（input[type=month]の値形式）
      el.value = val ? val.slice(0, 7) : '';
    });

    BOOL_FIELDS.forEach(f => {
      const el = document.getElementById(`f_${f}`);
      if (el) el.checked = !!member[f];
    });

    showView('add');
  } catch (err) {
    showToast('データの取得に失敗しました: ' + err.message, 'error');
  }
}

// =========================================
// 保存（新規作成 / 更新）
// =========================================

memberForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id     = document.getElementById('editId').value;
  const isEdit = !!id;

  // フォームデータ収集
  const body = {};

  STR_FIELDS.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    body[f] = el ? (el.value.trim() || null) : null;
  });

  DATE_FIELDS.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    body[f] = el ? (el.value || null) : null;
  });

  MONTH_FIELDS.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    // input[type=month] は YYYY-MM 形式で返す → サーバー側で YYYY-MM-01 に変換
    body[f] = el ? (el.value || null) : null;
  });

  BOOL_FIELDS.forEach(f => {
    const el = document.getElementById(`f_${f}`);
    body[f] = el ? el.checked : false;
  });

  try {
    if (isEdit) {
      await apiFetch(`/api/members/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('会員情報を更新しました');
    } else {
      await apiFetch('/api/members', { method: 'POST', body: JSON.stringify(body) });
      showToast('新規会員を登録しました');
    }
    showView('list');
    await loadList();
  } catch (err) {
    showToast('保存に失敗しました: ' + err.message, 'error');
  }
});

// =========================================
// 削除
// =========================================

let _deleteId = null;

deleteBtn.addEventListener('click', () => {
  _deleteId = document.getElementById('editId').value;
  modalOverlay.classList.add('active');
});

document.getElementById('modalCancel').addEventListener('click', () => {
  modalOverlay.classList.remove('active');
  _deleteId = null;
});

document.getElementById('modalConfirm').addEventListener('click', async () => {
  if (!_deleteId) return;
  modalOverlay.classList.remove('active');

  try {
    await apiFetch(`/api/members/${_deleteId}`, { method: 'DELETE' });
    showToast('会員データを削除しました');
    showView('list');
    await loadList();
  } catch (err) {
    showToast('削除に失敗しました: ' + err.message, 'error');
  }
  _deleteId = null;
});

// モーダル外クリックで閉じる
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.classList.remove('active');
    _deleteId = null;
  }
});

// =========================================
// 初期化
// =========================================

loadList();
