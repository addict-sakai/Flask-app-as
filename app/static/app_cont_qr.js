/**
 * app_cont_qr.js  –  請負QR入力ページ ロジック
 * Mt.FUJI PARAGLIDING / FujipSystem
 * 作成: 2026/04/08
 * 改定: 2026/04/08  引継ぎ報告省略・時間表示のみ（変更不可）
 * 改定: 2026/04/08  前回登録値の引継ぎ・全項目必須バリデーション
 * 改定: 2026/04/08  自動カメラ起動を廃止（ボタン操作のみ）
 * 改定: 2026/04/08  前回値をDB（/api/cont/latest）から取得
 */

const QrEntry = (() => {

  /* ─── 内部状態 ─── */
  let _memberUuid  = "";
  let _memberName  = "";
  let _flightTime  = "";
  let _configCache = null;
  let _prevValues  = null;   // DBから取得した直前の登録値


  /* ═══════════════════════
     初期化（自動カメラ起動なし）
  ═══════════════════════ */
  function init() {
    // カメラはボタン押下時のみ起動
  }


  /* ═══════════════════════
     QRスキャン（ボタンから呼ぶ）
  ═══════════════════════ */
  function startScan() {
    _hideError();
    QRScanner.open(async (memberData) => {
      await _lookupAndShowForm(memberData.uuid);
    });
  }

  function closeQr() {
    QRScanner.close();
  }

  async function _lookupAndShowForm(uuid) {
    // 会員情報を取得
    let data;
    try {
      const resp = await fetch("/api/cont/lookup", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ query: uuid }),
      });
      data = await resp.json();
      if (!resp.ok) {
        _showError(data.error || "会員が見つかりません");
        return;
      }
    } catch {
      _showError("通信エラーが発生しました");
      return;
    }

    _memberUuid = data.uuid;
    _memberName = data.full_name;

    // 本人の直前登録データをDBから取得
    _prevValues = await _fetchLatest(_memberUuid);

    await _showForm();
  }

  /* 直前の登録データをDBから取得 */
  async function _fetchLatest(uuid) {
    try {
      const resp = await fetch("/api/cont/latest?uuid=" + encodeURIComponent(uuid));
      if (!resp.ok) return null;
      const data = await resp.json();
      // 空オブジェクト（登録なし）の場合はnullを返す
      if (!data || !data.takeoff_location) return null;
      return data;
    } catch {
      return null;
    }
  }


  /* ═══════════════════════
     フォーム表示
  ═══════════════════════ */
  async function _showForm() {
    if (_configCache === null) {
      _configCache = await _fetchConfig();
    }
    _resetForm();

    document.getElementById("form-member-name").textContent = _memberName;
    document.getElementById("qr-screen").style.display   = "none";
    document.getElementById("form-screen").style.display = "block";
    window.scrollTo(0, 0);
  }

  async function _fetchConfig() {
    const targets = ["場所", "使用機体", "サイズ", "ハーネス", "パッセンジャー"];
    const result  = {};
    try {
      const mRes = await fetch("/config/api/masters?category=" + encodeURIComponent("請負"));
      if (!mRes.ok) throw new Error("masters取得失敗");
      const masters = await mRes.json();
      for (const m of masters.filter(m => targets.includes(m.item_name))) {
        const vRes = await fetch("/config/api/values/" + m.id);
        if (!vRes.ok) continue;
        const vs = await vRes.json();
        result[m.item_name] = vs
          .filter(v => v.is_active !== false)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(v => v.value);
      }
    } catch (e) {
      console.error("[QrEntry] config取得失敗:", e);
    }
    return result;
  }

  function _isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function _resetForm() {
    const today = new Date();
    const dow   = ["日","月","火","水","木","金","土"][today.getDay()];

    // 日付表示
    document.getElementById("form-date-display").textContent =
      `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}（${dow}）`;

    // 時間（変更不可）
    const hh = String(today.getHours()).padStart(2, "0");
    const mm = String(today.getMinutes()).padStart(2, "0");
    _flightTime = `${hh}:${mm}`;
    document.getElementById("form-time-display").textContent = _flightTime;

    // DBから取得した直前値をプリセット（なければ空）
    const prev = _prevValues;
    const cfg  = _configCache || {};

    // 場所ボタン生成
    _buildLocationButtons("form-location-wrap",
      cfg["場所"] || [],
      prev ? prev.takeoff_location : "");

    // セレクト生成
    _buildSelect("form-glider-select",  cfg["使用機体"]      || [], prev ? prev.used_glider       : "");
    _buildSelect("form-size-select",    cfg["サイズ"]         || [], prev ? prev.size              : "");
    _buildSelect("form-harness-select", cfg["ハーネス"]       || [], prev ? prev.pilot_harness     : "");
    _buildSelect("form-pass-select",    cfg["パッセンジャー"] || [], prev ? prev.passenger_harness : "");

    // チェックボックスクリア
    const chk = document.getElementById("form-mini-guarantee");
    if (chk) chk.checked = false;

    // 結果メッセージ非表示
    const res = document.getElementById("form-result");
    if (res) res.style.display = "none";
  }


  /* ═══════════════════════
     日報登録
  ═══════════════════════ */
  async function register() {
    const miniGuarantee = document.getElementById("form-mini-guarantee")?.checked || false;
    const location = _getLocationSelected("form-location-wrap");
    const glider   = document.getElementById("form-glider-select").value  || "";
    const size     = document.getElementById("form-size-select").value    || "";
    const harness  = document.getElementById("form-harness-select").value || "";
    const pass     = document.getElementById("form-pass-select").value    || "";

    // バリデーション（最低保証でも機体・サイズ・ハーネス・パッセンジャーは必須）
    const errors = [];
    if (!location && !miniGuarantee) errors.push("場所");
    if (!glider)  errors.push("使用機体");
    if (!size)    errors.push("サイズ");
    if (!harness) errors.push("ハーネス");
    if (!pass)    errors.push("パッセンジャー");

    if (errors.length > 0) {
      _showFormResult(`${errors.join("・")}を選択してください`, "danger");
      return;
    }

    const payload = {
      uuid:              _memberUuid,
      name:              _memberName,
      flight_time:       _flightTime,
      takeoff_location:  location,
      used_glider:       glider,
      size:              size,
      pilot_harness:     harness,
      passenger_harness: pass,
      mini_guarantee:    miniGuarantee,
      near_miss:         "",
      improvement:       "",
      damaged_section:   "",
    };

    let data;
    try {
      const resp = await fetch("/api/cont/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      data = await resp.json();
      if (!resp.ok) {
        _showFormResult(data.error || "登録に失敗しました", "danger");
        return;
      }
    } catch {
      _showFormResult("通信エラーが発生しました", "danger");
      return;
    }

    _showFormResult("✓ 登録しました", "success");
    setTimeout(() => _backToQr(), 1000);
  }


  /* ═══════════════════════
     キャンセル・QR画面に戻る
  ═══════════════════════ */
  function cancel() {
    _backToQr();
  }

  function _backToQr() {
    _memberUuid = "";
    _memberName = "";
    _flightTime = "";
    _prevValues = null;

    document.getElementById("form-screen").style.display = "none";
    document.getElementById("qr-screen").style.display   = "block";
    window.scrollTo(0, 0);
    // startScan() は呼ばない：ボタン押下待ち
  }


  /* ═══════════════════════
     フォームUI部品
  ═══════════════════════ */
  function _buildLocationButtons(wrapId, items, currentVal) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.innerHTML = "";
    items.forEach(name => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cont-opt-btn" + (name === currentVal ? " selected" : "");
      btn.dataset.val = name;
      btn.textContent = name;
      btn.addEventListener("click", () => {
        wrap.querySelectorAll(".cont-opt-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      wrap.appendChild(btn);
    });
  }

  function _buildSelect(selectId, items, currentVal) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">— 選択してください</option>`;
    items.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === currentVal) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _getLocationSelected(wrapId) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return "";
    const sel = wrap.querySelector(".cont-opt-btn.selected");
    return sel ? sel.dataset.val : "";
  }


  /* ═══════════════════════
     エラー・結果表示
  ═══════════════════════ */
  function _showError(msg) {
    const el = document.getElementById("qr-error");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
  }

  function _hideError() {
    const el = document.getElementById("qr-error");
    if (el) el.style.display = "none";
  }

  function _showFormResult(msg, type) {
    const el = document.getElementById("form-result");
    if (!el) return;
    el.textContent = msg;
    el.className = `cont-result-msg cont-alert cont-alert--${type}`;
    el.style.display = "block";
  }


  /* ─── 公開インターフェース ─── */
  return { init, startScan, closeQr, register, cancel };

})();

document.addEventListener("DOMContentLoaded", () => QrEntry.init());
