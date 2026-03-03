/**
 * app_io.js  –  入下山管理ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const IOApp = (() => {
  /* ─── 内部状態 ─── */
  let _member = null;
  let _insurance = null;

  /* ─── 初期化 ─── */
  function init() {
    _setTodayDisplay();
    _updateStats();

    document.getElementById('search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') lookup();
    });

    // ESCキーでモーダルを閉じる
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModalForce();
    });
  }

  /* ─── 今日の日付表示 ─── */
  function _setTodayDisplay() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const w = weekdays[now.getDay()];
    document.getElementById('today-display').textContent = `${y}年${m}月${d}日（${w}）`;
  }

  /* ─── 会員検索 ─── */
  async function lookup() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    _clearModal();

    let data;
    try {
      const resp = await fetch('/api/io/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      data = await resp.json();
      if (!resp.ok) {
        _showSearchError(data.error || '会員が見つかりません');
        return;
      }
    } catch {
      _showSearchError('通信エラーが発生しました');
      return;
    }

    _renderModal(data);
  }

  /* ─── モーダルをクリア ─── */
  function _clearModal() {
    document.getElementById('search-error').style.display = 'none';
    document.getElementById('alerts-zone').innerHTML = '';
    document.getElementById('result-msg').style.display = 'none';
    document.querySelectorAll('.io-ins-btn').forEach(b => b.classList.remove('selected'));
    _member = null;
    _insurance = null;
  }

  /* ─── 検索エラー表示 ─── */
  function _showSearchError(msg) {
    const el = document.getElementById('search-error');
    el.textContent = '⚠ ' + msg;
    el.style.display = 'flex';
  }

  /* ─── モーダルを開く ─── */
  function _openModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    // アニメーション用に少し遅延
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
    });
    document.body.style.overflow = 'hidden';
  }

  /* ─── モーダルを閉じる（オーバーレイクリック） ─── */
  function closeModal(event) {
    if (event.target === document.getElementById('modal-overlay')) {
      closeModalForce();
    }
  }

  /* ─── モーダルを強制的に閉じる ─── */
  function closeModalForce() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('is-visible');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);
    document.body.style.overflow = '';
    _clearModal();
  }

  /* ─── 会員カード描画 ─── */
  function _renderModal(data) {
    _member = data;

    document.getElementById('mc-name').textContent    = data.full_name || '—';
    document.getElementById('mc-type').textContent    = data.member_type || '';
    document.getElementById('mc-number').textContent  = data.member_number || '';
    document.getElementById('mc-course').textContent  = data.course_name ? '/ ' + data.course_name : '';
    document.getElementById('mc-regno').textContent   = data.reg_no || '—';
    document.getElementById('mc-license').textContent = data.license || '—';

    const reglimitEl = document.getElementById('mc-reglimit');
    reglimitEl.textContent = data.reglimit_date || '—';
    reglimitEl.className   = 'io-info-value ' + (data.license_status || 'none');

    const repackEl = document.getElementById('mc-repack');
    repackEl.textContent = data.repack_limit || '—';
    repackEl.className   = 'io-info-value ' + (data.repack_status || 'none');

    document.getElementById('glider-name').value  = data.glider_name  || '';
    document.getElementById('glider-color').value = data.glider_color || '';
    document.getElementById('radio-type').value = '';

    const zone    = document.getElementById('alerts-zone');
    const blocked = data.license_status === 'expired' || data.repack_status === 'expired';

    if (data.license_status === 'expired') {
      zone.innerHTML += _alertHTML('danger', '🚫 登録期限が切れています。入山できません。');
    } else if (data.license_status === 'warning') {
      zone.innerHTML += _alertHTML('warning', '⚠ 登録期限まで1ヶ月を切っています。');
    }

    if (data.repack_status === 'expired') {
      zone.innerHTML += _alertHTML('danger', '🚫 リパック期限が切れています。入山できません。');
    } else if (data.repack_status === 'warning') {
      zone.innerHTML += _alertHTML('warning', '⚠ リパック期限まで1ヶ月を切っています。');
    }

    const btn = document.getElementById('action-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    if (data.already_in && data.already_out) {
      zone.innerHTML += _alertHTML('success', `✓ 本日の入退場記録が完了しています。（入山 ${data.in_time} / 下山 ${data.out_time}）`);
      btn.textContent = '記録完了';
      btn.className   = 'io-action-btn io-action-btn--done';
      btn.disabled    = true;
      cancelBtn.textContent = '閉じる';

    } else if (data.already_in) {
      zone.innerHTML += _alertHTML('success', `✓ 入山済み（${data.in_time}）`);
      btn.textContent = '⬇ 下山';
      btn.className   = 'io-action-btn io-action-btn--checkout';
      btn.disabled    = false;
      cancelBtn.textContent = 'キャンセル';

    } else {
      btn.textContent = '⬆ 入山';
      btn.className   = 'io-action-btn io-action-btn--checkin';
      btn.disabled    = blocked;
      cancelBtn.textContent = 'キャンセル';
    }

    _openModal();
  }

  /* ─── 保険選択 ─── */
  function selectInsurance(el) {
    _insurance = el.dataset.val;
    document.querySelectorAll('.io-ins-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
  }

  /* ─── 入山 / 下山 アクション ─── */
  async function doAction() {
    if (!_member) return;

    if (!_member.already_in && !_insurance) {
      _showResultMsg('保険区分を選択してください', 'warning');
      return;
    }

    const payload = {
      member_number: _member.member_number,
      uuid:          _member.uuid,
      member_class:  _member.member_type,
      course_name:   _member.course_name,
      glider_name:   document.getElementById('glider-name').value,
      glider_color:  document.getElementById('glider-color').value,
      insurance_type: _insurance,
      radio_type:    document.getElementById('radio-type').value,
    };

    let data;
    try {
      const resp = await fetch('/api/io/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await resp.json();
      if (!resp.ok) {
        _showResultMsg(data.error || 'エラーが発生しました', 'danger');
        return;
      }
    } catch {
      _showResultMsg('通信エラーが発生しました', 'danger');
      return;
    }

    _showResultMsg(data.message, 'success');
    _updateTableRow(data, payload);

    const btn = document.getElementById('action-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    btn.textContent = '記録完了';
    btn.className   = 'io-action-btn io-action-btn--done';
    btn.disabled    = true;
    cancelBtn.textContent = '閉じる';

    _updateStats();

    // 2秒後に自動でモーダルを閉じる
    setTimeout(() => {
      closeModalForce();
      document.getElementById('search-input').value = '';
    }, 2000);
  }

  /* ─── テーブル行の追加 / 更新 ─── */
  function _updateTableRow(data, payload) {
    const tbody = document.getElementById('flight-tbody');

    const emptyRow = document.getElementById('empty-row');
    if (emptyRow) emptyRow.remove();

    const m = _member;

    if (data.action === 'checkin') {
      const tr = document.createElement('tr');
      tr.className    = 'is-active';
      tr.dataset.uuid = m.uuid;
      tr.innerHTML = `
        <td class="io-td-name">${_esc(m.full_name)}</td>
        <td>${_esc(m.member_type || '—')}</td>
        <td class="io-td-dim">${_esc(payload.course_name || '—')}</td>
        <td>${_esc(payload.glider_name  || '—')}</td>
        <td>${_esc(payload.glider_color || '—')}</td>
        <td class="io-td-mono">${_esc(payload.radio_type || '—')}</td>
        <td class="io-td-mono"><span class="io-chip io-chip--in">${_esc(data.in_time)}</span></td>
        <td>—</td>
      `;
      tbody.prepend(tr);

    } else if (data.action === 'checkout') {
      const existingRow = tbody.querySelector(`tr[data-uuid="${m.uuid}"]`);
      if (existingRow) {
        existingRow.classList.remove('is-active');
        existingRow.querySelectorAll('td')[7].innerHTML =
          `<span class="io-chip io-chip--out">${_esc(data.out_time)}</span>`;
      }
    }
  }

  /* ─── 統計バッジ更新 ─── */
  function _updateStats() {
    const rows  = document.querySelectorAll('#flight-tbody tr[data-uuid]');
    let total = 0, inCount = 0, outCount = 0;
    rows.forEach(r => {
      total++;
      const outTd = r.querySelectorAll('td')[7];
      if (outTd && outTd.textContent.trim() !== '—') outCount++;
      else inCount++;
    });
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-in').textContent    = inCount;
    document.getElementById('stat-out').textContent   = outCount;
  }

  /* ─── 結果メッセージ表示 ─── */
  function _showResultMsg(msg, type) {
    const el = document.getElementById('result-msg');
    el.textContent = msg;
    el.style.display = 'block';
    el.className = `io-result-msg io-alert io-alert--${type}`;
  }

  /* ─── アラート HTML 生成 ─── */
  function _alertHTML(type, msg) {
    return `<div class="io-alert io-alert--${type}">${msg}</div>`;
  }

  /* ─── HTML エスケープ ─── */
  function _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─── 公開インターフェース ─── */
  return { init, lookup, selectInsurance, doAction, closeModal, closeModalForce };

})();

document.addEventListener('DOMContentLoaded', () => IOApp.init());
