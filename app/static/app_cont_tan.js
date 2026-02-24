/**
 * app_cont_tan.js  –  請負日報ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 */

const ContApp = (() => {

  /* ─── 内部状態 ─── */
  let _memberName   = "";
  let _memberUuid   = "";
  let _memberNumber = "";
  let _editId       = null;

  /* ─── 初期化 ─── */
  function init() {
    _setMonthDisplay();
    _updateStats();

    document.getElementById("search-input").addEventListener("keydown", e => {
      if (e.key === "Enter") lookup();
    });

    // 編集モーダル外クリックで閉じる
    document.getElementById("edit-modal-overlay").addEventListener("click", e => {
      if (e.target === e.currentTarget) closeModal();
    });
  }

  /* ─── 当月表示 ─── */
  function _setMonthDisplay() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    document.getElementById("month-display").textContent = `${y}年${m}月`;
  }

  /* ─── 会員検索 ─── */
  async function lookup() {
    const query = document.getElementById("search-input").value.trim();
    if (!query) return;

    _hideAlert("search-error");

    let data;
    try {
      const resp = await fetch("/api/cont/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      data = await resp.json();
      if (!resp.ok) {
        _showAlert("search-error", data.error || "会員が見つかりません");
        _closePopup();
        return;
      }
    } catch {
      _showAlert("search-error", "通信エラーが発生しました");
      _closePopup();
      return;
    }

    _memberName   = data.full_name;
    _memberUuid   = data.uuid;
    _memberNumber = data.member_number;

    // ── 当日に同じ人のレコードが既にある場合は編集モーダルを直接開く ──
    const existingRow = document.querySelector(`tr.is-today[data-uuid="${data.uuid}"]`);
    if (existingRow) {
      _showAlert("search-error", `${data.full_name} さんの本日の日報が見つかりました。編集画面を開きます。`);
      document.getElementById("search-error").className = "cont-alert cont-alert--info";
      document.getElementById("search-error").style.display = "block";
      openEditModal(+existingRow.dataset.id);
      return;
    }

    // バナーを更新してポップアップを開く
    document.getElementById("member-name").textContent = data.full_name;
    document.getElementById("member-sub").textContent  = "No." + (data.member_number || "");
    _openPopup();
  }

  /* ─── ポップアップ 開く / 閉じる ─── */
  function _openPopup() {
    const popup = document.getElementById("entry-popup");
    popup.style.display = "block";
    // スムーズスクロール
    setTimeout(() => popup.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }

  function _closePopup() {
    document.getElementById("entry-popup").style.display = "none";
  }

  /* ─── 担当者クリア（✕ クリアボタン） ─── */
  function clearMember() {
    _memberName = _memberUuid = _memberNumber = "";
    document.getElementById("search-input").value = "";
    _hideAlert("search-error");
    _resetFormFields();
    _closePopup();
  }

  /* ─── キャンセルボタン ─── */
  function cancelForm() {
    _memberName = _memberUuid = _memberNumber = "";
    document.getElementById("search-input").value = "";
    _hideAlert("search-error");
    _resetFormFields();
    _closePopup();
  }

  /* ─── フォームフィールドのみリセット ─── */
  function _resetFormFields() {
    document.getElementById("flight-count").value = "";
    document.getElementById("near-miss").value    = "";
    document.getElementById("improvement").value  = "";
    document.getElementById("damaged").value      = "";
    document.querySelectorAll("#entry-popup .cont-opt-btn")
      .forEach(b => b.classList.remove("selected"));
    _hideResult();
  }

  /* ─── 選択ボタン ─── */
  function selectOpt(el, groupClass) {
    document.querySelectorAll("." + groupClass + " .cont-opt-btn")
      .forEach(b => b.classList.remove("selected"));
    el.classList.add("selected");
  }

  /* ─── 選択値取得 ─── */
  function _getSelected(groupClass) {
    const el = document.querySelector("." + groupClass + " .cont-opt-btn.selected");
    return el ? el.dataset.val : "";
  }

  /* ─── 登録 ─── */
  async function register() {
    if (!_memberName) {
      _showResult("担当者を検索してください", "danger");
      return;
    }

    const payload = {
      uuid:              _memberUuid,
      name:              _memberName,
      daily_flight:      parseInt(document.getElementById("flight-count").value) || 0,
      takeoff_location:  _getSelected("grp-location"),
      used_glider:       _getSelected("grp-glider"),
      size:              _getSelected("grp-size"),
      pilot_harness:     _getSelected("grp-pilot-harness"),
      passenger_harness: _getSelected("grp-pass-harness"),
      near_miss:         document.getElementById("near-miss").value.trim(),
      improvement:       document.getElementById("improvement").value.trim(),
      damaged_section:   document.getElementById("damaged").value.trim(),
    };

    let data;
    try {
      const resp = await fetch("/api/cont/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      data = await resp.json();
      if (!resp.ok) {
        _showResult(data.error || "登録に失敗しました", "danger");
        return;
      }
    } catch {
      _showResult("通信エラーが発生しました", "danger");
      return;
    }

    _showResult("登録しました ✓", "success");
    _prependTableRow(data.id, payload);
    _updateStats();

    // 1.2秒後にポップアップごとリセット
    setTimeout(() => {
      _memberName = _memberUuid = _memberNumber = "";
      document.getElementById("search-input").value = "";
      _resetFormFields();
      _closePopup();
    }, 1200);
  }

  /* ─── テーブル行を追加（降順：先頭に挿入） ─── */
  function _prependTableRow(id, payload) {
    const tbody = document.getElementById("cont-tbody");
    const emptyRow = document.getElementById("empty-row");
    if (emptyRow) emptyRow.remove();

    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;

    let dateRow = tbody.querySelector(`tr.cont-date-row[data-date="${dateStr}"]`);
    if (!dateRow) {
      dateRow = document.createElement("tr");
      dateRow.className = "cont-date-row";
      dateRow.dataset.date = dateStr;
      dateRow.innerHTML = `<td colspan="7">📅 ${dateStr}（今日）</td>`;
      tbody.insertBefore(dateRow, tbody.firstChild);
    }

    const tr = document.createElement("tr");
    tr.className  = "is-today";
    tr.dataset.id          = id;
    tr.dataset.uuid        = payload.uuid           || "";
    tr.dataset.nearMiss    = payload.near_miss       || "";
    tr.dataset.improvement = payload.improvement     || "";
    tr.dataset.damaged     = payload.damaged_section || "";
    tr.dataset.passHarness = payload.passenger_harness || "";
    tr.innerHTML = `
      <td class="cont-td-name">${_esc(payload.name)}</td>
      <td>${payload.daily_flight || 0}</td>
      <td><span class="cont-chip cont-chip--loc">${_esc(payload.takeoff_location || "—")}</span></td>
      <td>${_esc(payload.used_glider || "—")}</td>
      <td>${_esc(payload.size || "—")}</td>
      <td>${_esc(payload.pilot_harness || "—")}</td>
      <td>
        <button class="cont-btn-edit" onclick="ContApp.openEditModal(${id})">編集</button>
      </td>
    `;
    dateRow.insertAdjacentElement("afterend", tr);
  }

  /* ─── 統計カウント ─── */
  function _updateStats() {
    const rows = document.querySelectorAll("#cont-tbody tr[data-id]");
    document.getElementById("stat-total").textContent = rows.length;
  }

  /* ─── 編集モーダルを開く ─── */
  function openEditModal(id) {
    _editId = id;

    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;

    const cells = row.querySelectorAll("td");

    // ── 数値・選択ボタン ──
    document.getElementById("modal-flight-count").value = cells[1].textContent.trim();

    ["modal-grp-location","modal-grp-glider","modal-grp-size","modal-grp-pilot","modal-grp-pass"].forEach(g => {
      document.querySelectorAll("." + g + " .cont-opt-btn").forEach(b => b.classList.remove("selected"));
    });
    _preselectModal("modal-grp-location", cells[2].textContent.trim());
    _preselectModal("modal-grp-glider",   cells[3].textContent.trim());
    _preselectModal("modal-grp-size",     cells[4].textContent.trim());
    _preselectModal("modal-grp-pilot",    cells[5].textContent.trim());

    // ── data属性からテキストエリア・パッセンジャーハーネスを復元 ──
    document.getElementById("modal-near-miss").value   = row.dataset.nearMiss    || "";
    document.getElementById("modal-improvement").value = row.dataset.improvement || "";
    document.getElementById("modal-damaged").value     = row.dataset.damaged     || "";
    _preselectModal("modal-grp-pass", row.dataset.passHarness || "");

    document.getElementById("edit-modal-overlay").classList.add("open");
  }

  function _preselectModal(groupClass, value) {
    document.querySelectorAll("." + groupClass + " .cont-opt-btn").forEach(b => {
      if (b.dataset.val === value) b.classList.add("selected");
    });
  }

  function closeModal() {
    document.getElementById("edit-modal-overlay").classList.remove("open");
    _editId = null;
  }

  /* ─── 編集保存 ─── */
  async function saveEdit() {
    if (!_editId) return;

    const payload = {
      daily_flight:      parseInt(document.getElementById("modal-flight-count").value) || 0,
      takeoff_location:  _getSelected("modal-grp-location"),
      used_glider:       _getSelected("modal-grp-glider"),
      size:              _getSelected("modal-grp-size"),
      pilot_harness:     _getSelected("modal-grp-pilot"),
      passenger_harness: _getSelected("modal-grp-pass"),
      near_miss:         document.getElementById("modal-near-miss").value.trim(),
      improvement:       document.getElementById("modal-improvement").value.trim(),
      damaged_section:   document.getElementById("modal-damaged").value.trim(),
    };

    let data;
    try {
      const resp = await fetch(`/api/cont/${_editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      data = await resp.json();
      if (!resp.ok) {
        alert(data.error || "更新に失敗しました");
        return;
      }
    } catch {
      alert("通信エラーが発生しました");
      return;
    }

    const row = document.querySelector(`tr[data-id="${_editId}"]`);
    if (row) {
      const cells = row.querySelectorAll("td");
      cells[1].textContent = payload.daily_flight;
      cells[2].innerHTML   = `<span class="cont-chip cont-chip--loc">${_esc(payload.takeoff_location || "—")}</span>`;
      cells[3].textContent = payload.used_glider   || "—";
      cells[4].textContent = payload.size          || "—";
      cells[5].textContent = payload.pilot_harness || "—";
      // data属性を最新値に更新（次回の検索・編集で正しく読み込まれるよう）
      row.dataset.nearMiss    = payload.near_miss        || "";
      row.dataset.improvement = payload.improvement      || "";
      row.dataset.damaged     = payload.damaged_section  || "";
      row.dataset.passHarness = payload.passenger_harness || "";
    }

    closeModal();
  }

  /* ─── アラート ─── */
  function _showAlert(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
  }
  function _hideAlert(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }

  /* ─── 結果メッセージ ─── */
  function _showResult(msg, type) {
    const el = document.getElementById("result-msg");
    el.textContent = msg;
    el.className = `cont-result-msg cont-alert cont-alert--${type}`;
    el.style.display = "block";
  }
  function _hideResult() {
    const el = document.getElementById("result-msg");
    if (el) el.style.display = "none";
  }

  /* ─── HTMLエスケープ ─── */
  function _esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    init,
    lookup,
    selectOpt,
    register,
    cancelForm,
    clearMember,
    openEditModal,
    closeModal,
    saveEdit,
  };

})();

document.addEventListener("DOMContentLoaded", () => ContApp.init());
