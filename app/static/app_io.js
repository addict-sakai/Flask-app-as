/**
 * app_io.js  –  入下山管理ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 * 改定: 2026-03-24
 *   - 検索方法変更：氏名入力 → 候補リスト表示 → PASSコード認証（携帯番号下4桁）
 *   - QRコードボタン追加（将来実装用プレースホルダー）
 */

const IOApp = (() => {
  /* ─── 内部状態 ─── */
  let _member    = null;   // 会員情報（lookup APIレスポンス）
  let _insurance = null;   // 選択保険区分
  let _passTarget = null;  // PASSコード確認対象の会員（候補リストで選択）

  /* ─── 初期化 ─── */
  function init() {
    _setTodayDisplay();
    _updateStats();

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') lookupByName();
    });

    // PASSコード入力欄でEnterキー
    document.getElementById('pass-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') verifyPass();
    });

    // ESCキーでモーダルを閉じる
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModalForce();
        closePassForce();
        closeCandidates();
        closeQRScanForce();
      }
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

  /* ─── QRコードスキャン（app_qr_scan.js の QRScanner モジュールに委譲） ─── */

  function openQR() {
    QRScanner.open((memberData) => {
      _renderModal(memberData);  // PASSコードなしで直接入山モーダルへ
    });
  }

  function closeQRScan(event) {
    QRScanner.closeOnOverlay(event);
  }

  function closeQRScanForce() {
    QRScanner.close();
  }

  /* ═══════════════════════════════════════
     STEP 1: 氏名検索 → 候補リスト表示
  ═══════════════════════════════════════ */

  async function lookupByName() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    _hideSearchError();
    closeCandidates();

    let data;
    try {
      const resp = await fetch('/api/io/lookup_by_name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: query }),
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

    if (!data.members || data.members.length === 0) {
      _showSearchError('該当する会員が見つかりません');
      return;
    }

    // 1件だけヒットした場合はそのままPASSコードへ
    if (data.members.length === 1) {
      _openPassModal(data.members[0]);
      return;
    }

    // 複数ヒット → 候補リストを表示
    _renderCandidates(data.members);
  }

  /* ─── 候補リスト描画 ─── */
  function _renderCandidates(members) {
    const list = document.getElementById('candidates-list');
    list.innerHTML = '';

    members.forEach(m => {
      const li = document.createElement('li');
      li.className = 'io-candidate-item';

      const birthday = m.birthday
        ? _formatDate(m.birthday)
        : '生年月日未登録';

      li.innerHTML = `
        <span class="io-candidate-name">${_esc(m.full_name)}</span>
        <span class="io-candidate-meta">${_esc(birthday)}</span>
        <span class="io-candidate-arrow">›</span>
      `;

      li.addEventListener('click', () => {
        closeCandidates();
        _openPassModal(m);
      });

      list.appendChild(li);
    });

    const wrap = document.getElementById('name-candidates');
    wrap.style.display = 'block';
  }

  /* ─── 候補リストを閉じる ─── */
  function closeCandidates() {
    document.getElementById('name-candidates').style.display = 'none';
    document.getElementById('candidates-list').innerHTML = '';
  }

  /* ═══════════════════════════════════════
     STEP 2: PASSコードモーダル
  ═══════════════════════════════════════ */

  function _openPassModal(candidate) {
    _passTarget = candidate;

    document.getElementById('pass-member-name').textContent = candidate.full_name || '—';
    document.getElementById('pass-input').value = '';
    document.getElementById('pass-error').style.display = 'none';

    const overlay = document.getElementById('pass-overlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    document.body.style.overflow = 'hidden';

    // 少し待ってからフォーカス（モーダルアニメーション後）
    setTimeout(() => {
      document.getElementById('pass-input').focus();
    }, 150);
  }

  /* ─── PASSコードモーダルを閉じる（オーバーレイクリック） ─── */
  function closePassModal(event) {
    if (event.target === document.getElementById('pass-overlay')) {
      closePassForce();
    }
  }

  /* ─── PASSコードモーダルを強制的に閉じる ─── */
  function closePassForce() {
    const overlay = document.getElementById('pass-overlay');
    overlay.classList.remove('is-visible');
    setTimeout(() => { overlay.style.display = 'none'; }, 200);
    document.body.style.overflow = '';
    _passTarget = null;
  }

  /* ─── PASSコード確認 ─── */
  async function verifyPass() {
    if (!_passTarget) return;

    const pass = document.getElementById('pass-input').value.trim();
    if (!pass || pass.length !== 4) {
      _showPassError('携帯番号の下4桁（半角数字4桁）を入力してください');
      return;
    }
    if (!/^\d{4}$/.test(pass)) {
      _showPassError('半角数字4桁で入力してください');
      return;
    }

    document.getElementById('pass-error').style.display = 'none';

    let data;
    try {
      const resp = await fetch('/api/io/verify_pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_number: _passTarget.member_number,
          pass_code: pass,
        }),
      });
      data = await resp.json();
      if (!resp.ok) {
        _showPassError(data.error || 'PASSコードが正しくありません');
        return;
      }
    } catch {
      _showPassError('通信エラーが発生しました');
      return;
    }

    // 認証成功 → PASSモーダルを閉じて会員情報モーダルを開く
    closePassForce();

    // lookup APIで最新情報を取得してモーダル表示
    await _lookupAndShowModal(data.member_number);
  }

  /* ─── PASSerror表示 ─── */
  function _showPassError(msg) {
    const el = document.getElementById('pass-error');
    el.textContent = '⚠ ' + msg;
    el.style.display = 'flex';
    // 入力欄をシェイク
    const input = document.getElementById('pass-input');
    input.classList.add('io-shake');
    setTimeout(() => input.classList.remove('io-shake'), 400);
  }

  /* ═══════════════════════════════════════
     STEP 3: 会員情報取得 → 入下山モーダル
  ═══════════════════════════════════════ */

  async function _lookupAndShowModal(memberNumber) {
    _clearModal();

    let data;
    try {
      const resp = await fetch('/api/io/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: memberNumber }),
      });
      data = await resp.json();
      if (!resp.ok) {
        _showSearchError(data.error || '会員情報の取得に失敗しました');
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
    _member    = null;
    _insurance = null;
  }

  /* ─── 検索エラー表示 ─── */
  function _showSearchError(msg) {
    const el = document.getElementById('search-error');
    el.textContent = '⚠ ' + msg;
    el.style.display = 'flex';
  }

  function _hideSearchError() {
    document.getElementById('search-error').style.display = 'none';
  }

  /* ─── メインモーダルを開く ─── */
  function _openModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    document.body.style.overflow = 'hidden';
  }

  /* ─── メインモーダルを閉じる（オーバーレイクリック） ─── */
  function closeModal(event) {
    if (event.target === document.getElementById('modal-overlay')) {
      closeModalForce();
    }
  }

  /* ─── メインモーダルを強制的に閉じる ─── */
  function closeModalForce() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('is-visible');
    setTimeout(() => { overlay.style.display = 'none'; }, 200);
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
    document.getElementById('radio-type').value   = '';

    // 保険区分の初期値：スクール（他校スクール除く）は「年間」、それ以外は「個人」
    const _mt = data.member_type || '';
    const defaultIns = (_mt.includes('スクール') && !_mt.includes('他校')) ? '年間' : '個人';
    document.querySelectorAll('.io-ins-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.val === defaultIns);
    });
    _insurance = defaultIns;

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

    const btn       = document.getElementById('action-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    if (data.already_in && data.already_out) {
      zone.innerHTML += _alertHTML('success', `✓ 本日の入退場記録が完了しています。（入山 ${data.in_time} / 下山 ${data.out_time}）`);
      btn.textContent   = '記録完了';
      btn.className     = 'io-action-btn io-action-btn--done';
      btn.disabled      = true;
      cancelBtn.textContent = '閉じる';

    } else if (data.already_in) {
      zone.innerHTML += _alertHTML('success', `✓ 入山済み（${data.in_time}）`);
      btn.textContent   = '⬇ 下山';
      btn.className     = 'io-action-btn io-action-btn--checkout';
      btn.disabled      = false;
      cancelBtn.textContent = 'キャンセル';

    } else {
      btn.textContent   = '⬆ 入山';
      btn.className     = 'io-action-btn io-action-btn--checkin';
      btn.disabled      = blocked;
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
      member_number:  _member.member_number,
      uuid:           _member.uuid,
      member_class:   _member.member_type,
      course_name:    _member.course_name,
      glider_name:    document.getElementById('glider-name').value,
      glider_color:   document.getElementById('glider-color').value,
      insurance_type: _insurance,
      radio_type:     document.getElementById('radio-type').value,
    };

    let data;
    try {
      const resp = await fetch('/api/io/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

    const btn       = document.getElementById('action-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    btn.textContent   = '記録完了';
    btn.className     = 'io-action-btn io-action-btn--done';
    btn.disabled      = true;
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
    const rows = document.querySelectorAll('#flight-tbody tr[data-uuid]');
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

  /* ─── 日付フォーマット（YYYY-MM-DD → YYYY年MM月DD日） ─── */
  function _formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[0]}年${parts[1]}月${parts[2]}日`;
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
  return {
    init,
    openQR,
    lookupByName,
    closeCandidates,
    closePassModal,
    closePassForce,
    verifyPass,
    selectInsurance,
    doAction,
    closeModal,
    closeModalForce,
    closeQRScan,
    closeQRScanForce,
  };

})();

document.addEventListener('DOMContentLoaded', () => IOApp.init());
