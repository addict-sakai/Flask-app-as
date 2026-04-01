/**
 * app_apply.js
 * 会員申込書 / Aコース申込書 / ビジター申込書 の統合スクリプト
 * 旧: app_mem.js / app_mem_a.js / app_vis.js
 *
 * 使い方:
 *   HTML の <body> タグに data-apply-mode 属性を付ける。
 *     <body data-apply-mode="mem">   → 会員申込書（年会員・冬季・スクール・ビジター）
 *     <body data-apply-mode="mem_a"> → Aコース申込書
 *     <body data-apply-mode="vis">   → ビジター申込書（ビジター専用）
 *
 * 送信先 API:
 *   mem   → POST /api/apply
 *   mem_a → POST /api/apply_a
 *   vis   → POST /api/apply_v
 */
"use strict";

document.addEventListener("DOMContentLoaded", function () {

  // ── ハンバーガーメニュー開閉（申込書共通） ───────────────────
  const _hmBtn  = document.getElementById("hmMenuBtn");
  const _hmDrop = document.getElementById("hmDropdown");
  if (_hmBtn && _hmDrop) {
    _hmBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      _hmDrop.classList.toggle("is-open");
    });
    document.addEventListener("click", function () {
      _hmDrop.classList.remove("is-open");
    });
    _hmDrop.addEventListener("click", function (e) {
      e.stopPropagation();
      // ボタンクリック後は閉じる
      if (e.target.closest(".hm-item")) {
        _hmDrop.classList.remove("is-open");
      }
    });
  }

  // ── モード判定 ──────────────────────────────────────────────
  const MODE = document.body.dataset.applyMode || "mem";
  const IS_MEM   = MODE === "mem";
  const IS_MEM_A = MODE === "mem_a";
  const IS_VIS   = MODE === "vis";

  const API_ENDPOINT = IS_MEM ? "/api/apply"
                     : IS_MEM_A ? "/api/apply_a"
                     : "/api/apply_v";

  // ── 重複エラーモーダル（共通） ────────────────────────────────
  function showDuplicateError(message) {
    const existing = document.getElementById("dupErrorModal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "dupErrorModal";
    modal.style.cssText = [
      "position:fixed", "inset:0", "z-index:9999",
      "display:flex", "align-items:center", "justify-content:center",
      "background:rgba(0,0,0,0.45)",
    ].join(";");

    modal.innerHTML = `
      <div style="
        background:var(--surface,#fff);
        border:1px solid var(--border,#ddd);
        border-radius:var(--radius,10px);
        max-width:420px; width:90%;
        padding:28px 28px 22px;
        box-shadow:0 8px 32px rgba(0,0,0,0.18);
        font-family:inherit;
      ">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="font-size:22px;">⚠️</span>
          <strong style="font-size:15px;color:var(--text-primary,#111);">申請できませんでした</strong>
        </div>
        <p style="
          font-size:13.5px;
          line-height:1.75;
          color:var(--text-secondary,#444);
          white-space:pre-wrap;
          margin:0 0 20px;
        ">${message}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="dupGoUpd" style="
            padding:8px 18px;
            background:var(--primary,#2563eb);
            color:#fff; border:none;
            border-radius:var(--radius,8px);
            font-size:13px; cursor:pointer;
          ">更新・変更ページへ</button>
          <button id="dupClose" style="
            padding:8px 18px;
            background:transparent;
            border:1px solid var(--border,#ccc);
            border-radius:var(--radius,8px);
            font-size:13px; cursor:pointer;
          ">閉じる</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    document.getElementById("dupGoUpd").addEventListener("click", () => { modal.remove(); location.href = "/apply_upd"; });
    document.getElementById("dupClose").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  // ── ユーティリティ（共通） ────────────────────────────────────
  function formatFee(n) { return "￥" + Number(n).toLocaleString("ja-JP"); }
  function el(id)        { return document.getElementById(id); }
  function getVal(name) {
    const e = document.querySelector(`[name="${name}"]`);
    if (!e) return "";
    if (e.tagName === "SELECT") return e.options[e.selectedIndex]?.text || "";
    return e.value || "";
  }
  function getRadioVal(name) {
    const e = document.querySelector(`input[name="${name}"]:checked`);
    return e ? e.value : "";
  }
  function getDispVal(id) { const e = el(id); return e ? e.value : ""; }
  function setText(id, val) { const e = el(id); if (e) e.textContent = val || ""; }

  // ── フリガナ自動入力（共通） ──────────────────────────────────
  const nameInput     = el("fullName");
  const agreeName     = el("agreeName");
  const furiganaInput = el("furigana");

  if (nameInput && agreeName) {
    nameInput.addEventListener("input", function () {
      agreeName.textContent = this.value || "　　　　　　　　　";
    });
  }
  if (nameInput && furiganaInput) {
    let kanaAccum = "", kanaComposing = "";
    const toKatakana = str => str.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
    const isKanaOnly = str => /^[\u3040-\u30FF\u30FC\s]*$/.test(str);
    nameInput.addEventListener("compositionstart", () => { kanaComposing = ""; });
    nameInput.addEventListener("compositionupdate", e => {
      const d = e.data || "";
      if (isKanaOnly(d)) kanaComposing = toKatakana(d);
      furiganaInput.value = kanaAccum + kanaComposing;
    });
    nameInput.addEventListener("compositionend", () => {
      kanaAccum += kanaComposing; kanaComposing = "";
      furiganaInput.value = kanaAccum;
    });
    nameInput.addEventListener("input", e => {
      if (!e.isComposing && nameInput.value === "") {
        kanaAccum = ""; kanaComposing = ""; furiganaInput.value = "";
      }
    });
  }

  // ── 郵便番号 → 住所自動入力（共通） ─────────────────────────
  function fetchAddress() {
    const z1 = (el("zip1") || {}).value || "";
    const z2 = (el("zip2") || {}).value || "";
    if (z1.length !== 3 || z2.length !== 4) return;
    fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z1}${z2}`)
      .then(r => r.json())
      .then(data => {
        if (data.results) {
          const r = data.results[0];
          el("address").value = r.address1 + r.address2 + r.address3;
        }
      });
  }
  if (el("zip1")) {
    el("zip1").addEventListener("input", function () {
      if (this.value.length === 3) el("zip2").focus();
    });
  }
  if (el("zip2")) el("zip2").addEventListener("blur", fetchAddress);

  // ── フライヤー登録番号 分割入力（共通） ─────────────────────
  function buildRegNo(org) {
    if (org === "JHF") {
      const v1 = (el("reg_jhf1").value || "").trim();
      const v2 = (el("reg_jhf2").value || "").trim();
      if (!v1 && !v2) return null;
      return "JA" + v1.padStart(2, "0") + "O-" + v2.padStart(6, "0");
    }
    if (org === "JPA") {
      const v = (el("reg_jpa").value || "").trim();
      if (!v) return null;
      return "JP" + v.padStart(9, "0");
    }
    return null;
  }
  function updateRegPreview() {
    const org   = (el("organization") || {}).value || "";
    const built = buildRegNo(org);
    if (el("regNoPreview")) el("regNoPreview").textContent = built ? "→ " + built : "";
    if (el("reg_no")) el("reg_no").value = built || "";
  }
  function switchRegUI(org) {
    if (el("regInputNone")) el("regInputNone").style.display = (org === "")    ? "" : "none";
    if (el("regInputJHF"))  el("regInputJHF").style.display  = (org === "JHF") ? "flex" : "none";
    if (el("regInputJPA"))  el("regInputJPA").style.display  = (org === "JPA") ? "flex" : "none";
    updateRegPreview();
  }
  if (el("organization")) el("organization").addEventListener("change", e => switchRegUI(e.target.value));
  if (el("reg_jhf1")) {
    el("reg_jhf1").addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 2);
      if (this.value.length >= 2) el("reg_jhf2").focus();
      updateRegPreview();
    });
  }
  if (el("reg_jhf2")) {
    el("reg_jhf2").addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 6); updateRegPreview();
    });
    el("reg_jhf2").addEventListener("blur", function () {
      const v = this.value.trim();
      if (v.length > 0 && v.length < 6) { this.value = v.padStart(6, "0"); updateRegPreview(); }
    });
  }
  if (el("reg_jpa")) {
    el("reg_jpa").addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 9); updateRegPreview();
    });
    el("reg_jpa").addEventListener("blur", function () {
      const v = this.value.trim();
      if (v.length > 0 && v.length <= 4) { this.value = v.padStart(9, "0"); updateRegPreview(); }
    });
  }
  switchRegUI("");

  // ── flatpickr 初期化（共通） ──────────────────────────────────
  if (el("birthday")) {
    flatpickr("#birthday", {
      locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d", maxDate: "today",
      onChange: function (selectedDates) {
        if (!selectedDates.length) return;
        const birth = selectedDates[0];
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        if (el("age")) el("age").value = age;
      },
    });
  }
  if (el("reglimit_date")) {
    flatpickr("#reglimit_date", { locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d" });
  }
  if (el("repack_date")) {
    flatpickr("#repack_date", {
      locale: "ja",
      plugins: [new monthSelectPlugin({ shorthand: false, dateFormat: "Y-m", altFormat: "Y年m月" })],
      maxDate: "today",
    });
  }

  // ============================================================
  // ── mem / vis 専用：ビジター料金・祝日判定 ─────────────────
  // ============================================================
  let feeWeekday = 3200, feeHoliday = 3800;
  const VISITOR_FEE_LABELS = { "1": "平日：￥3,200", "2": "土日祝日：￥3,800" };
  let holidaySet = null;

  if (IS_MEM || IS_VIS) {
    function updateFeeLabels() {
      if (el("fee_weekday_label")) el("fee_weekday_label").textContent = "平日：" + formatFee(feeWeekday);
      if (el("fee_holiday_label")) el("fee_holiday_label").textContent = "土日祝日：" + formatFee(feeHoliday);
      VISITOR_FEE_LABELS["1"] = "平日：" + formatFee(feeWeekday);
      VISITOR_FEE_LABELS["2"] = "土日祝日：" + formatFee(feeHoliday);
    }
    function fetchHolidays() {
      if (holidaySet !== null) return Promise.resolve();
      return fetch("https://holidays-jp.github.io/api/v1/date.json")
        .then(r => r.json())
        .then(data => { holidaySet = new Set(Object.keys(data)); })
        .catch(() => { holidaySet = new Set(); });
    }
    function isHolidayOrWeekend(date) {
      const day = date.getDay();
      if (day === 0 || day === 6) return true;
      if (holidaySet) return holidaySet.has(date.toISOString().slice(0, 10));
      return false;
    }
    function autoSelectFee(date) {
      if (!date) return;
      const isWkEnd = isHolidayOrWeekend(date);
      if (el("fee_weekday")) el("fee_weekday").checked = !isWkEnd;
      if (el("fee_holiday")) el("fee_holiday").checked =  isWkEnd;
    }

    fetch("/config/api/masters?category=" + encodeURIComponent("パラ"))
      .then(r => r.json())
      .then(masters => {
        const wdM = masters.find(m => m.item_name === "ビジター平日");
        const hdM = masters.find(m => m.item_name === "ビジター土日祝日");
        const ps = [];
        if (wdM) ps.push(fetch("/config/api/values/" + wdM.id).then(r => r.json()).then(vs => {
          const a = vs.find(v => v.is_active); if (a && a.value) feeWeekday = Number(a.value);
        }));
        if (hdM) ps.push(fetch("/config/api/values/" + hdM.id).then(r => r.json()).then(vs => {
          const a = vs.find(v => v.is_active); if (a && a.value) feeHoliday = Number(a.value);
        }));
        return Promise.all(ps);
      })
      .then(() => { updateFeeLabels(); fetchHolidays().then(() => autoSelectFee(new Date())); })
      .catch(() => { updateFeeLabels(); autoSelectFee(new Date()); });

    // 申込日の変更で料金自動選択
    if (el("application_date")) {
      flatpickr("#application_date", {
        locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d",
        defaultDate: IS_MEM ? "today" : undefined,
        minDate:     IS_MEM ? "today" : undefined,
        onChange: function (selectedDates) {
          if (!selectedDates.length) return;
          fetchHolidays().then(() => autoSelectFee(selectedDates[0]));
        },
      });
    }

    // vis 用：agreement_date は flatpickr で独立初期化
    if (IS_VIS && el("agreement_date")) {
      flatpickr("#agreement_date", {
        locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d", maxDate: "today",
      });
    }

    // mem 用：agreement_date は今日の日付を表示するだけ（変更不可）
    if (IS_MEM && el("agreement_date")) {
      const today = new Date();
      el("agreement_date").value = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    }
  }

  // ============================================================
  // ── mem 専用：コース選択制御 ──────────────────────────────
  // ============================================================
  const courseFeeMap = {};

  if (IS_MEM) {
    const courseTypeSel   = el("course_type");
    const courseNameSel   = el("course_name");
    const courseFeeInp    = el("course_fee");
    const fieldCourseName = el("field-course-name");
    const fieldCourseFee  = el("field-course-fee");
    const formBodyWrapper = el("form-body-wrapper");

    // config からコース料金を取得
    fetch("/config/api/masters?category=" + encodeURIComponent("パラ"))
      .then(r => r.json())
      .then(masters => {
        const targets = [
          "年会費",
          "冬季料金", "冬季1月", "冬季2月", "冬季3月", "冬季4月",
          "Bコース入校料", "NPコース入校料", "Pコース入校料", "XCコース入校料", "Tコース入校料",
        ];
        return Promise.all(
          masters.filter(m => targets.includes(m.item_name)).map(m =>
            fetch("/config/api/values/" + m.id).then(r => r.json()).then(vals => {
              const a = vals.find(v => v.is_active);
              if (a && a.value) courseFeeMap[m.item_name] = Number(a.value);
            })
          )
        );
      })
      .then(() => autoFillCourseFee())
      .catch(() => {});

    const courseNameOptions = {
      "冬季限定会員": [
        { value: "ALL", text: "年会費（12/1～4/30）" },
        { value: "1",   text: "1月入会" },
        { value: "2",   text: "2月入会" },
        { value: "3",   text: "3月入会" },
        { value: "4",   text: "4月入会" },
      ],
      "スクール": [
        { value: "B",  text: "Bコース" },
        { value: "NP", text: "NPコース" },
        { value: "P",  text: "Pコース" },
        { value: "XC", text: "XCコース" },
        { value: "T",  text: "タンデムコース" },
      ],
    };
    const memberTypeMap = {
      "年会員": "年会員", "冬季限定会員": "冬季会員",
      "スクール": "スクール", "ビジター": "ビジター",
      "他校スクール": "他校スクール",
    };

    function resolveCourseFeeKey(ct, cn) {
      if (ct === "年会員")       return "年会費";
      if (ct === "冬季限定会員") return { "ALL":"冬季料金","1":"冬季1月","2":"冬季2月","3":"冬季3月","4":"冬季4月" }[cn] || null;
      if (ct === "スクール")     return { "B":"Bコース入校料","NP":"NPコース入校料","P":"Pコース入校料","XC":"XCコース入校料","T":"Tコース入校料" }[cn] || null;
      return null;
    }
    function autoFillCourseFee() {
      const key = resolveCourseFeeKey(courseTypeSel.value, courseNameSel.value);
      courseFeeInp.value = (key && courseFeeMap[key] !== undefined) ? courseFeeMap[key] : "";
    }
    function toggleCourse() {
      const ct = courseTypeSel.value;
      if (el("member_type")) el("member_type").value = memberTypeMap[ct] || "";

      const bodyDisabled = ct === "";
      if (formBodyWrapper) {
        formBodyWrapper.querySelectorAll("input, select, textarea, button").forEach(e => {
          if (bodyDisabled) {
            e.setAttribute("disabled", "disabled");
          } else {
            e.removeAttribute("disabled");
          }
        });
        formBodyWrapper.style.opacity       = bodyDisabled ? "0.4" : "";
        formBodyWrapper.style.pointerEvents = bodyDisabled ? "none" : "";
      }

      courseNameSel.innerHTML = '<option value="">選択</option>';
      (courseNameOptions[ct] || []).forEach(opt => {
        const o = document.createElement("option");
        o.value = opt.value; o.textContent = opt.text;
        courseNameSel.appendChild(o);
      });

      const labelAppDate = el("label_application_date");
      if (labelAppDate) labelAppDate.textContent = ct === "ビジター" ? "フライト予定日" : "申込日";

      const sectionVisitorFee = el("section-visitor-fee");
      if (sectionVisitorFee) sectionVisitorFee.style.display = ct === "ビジター" ? "" : "none";
      if (ct !== "ビジター") {
        document.querySelectorAll('input[name="visitor_fee"]').forEach(e => e.checked = false);
        document.querySelectorAll('input[name="experience"]').forEach(e => e.checked = false);
      }

      if (fieldCourseName) fieldCourseName.style.display = (ct === "冬季限定会員" || ct === "スクール") ? "" : "none";
      if (fieldCourseFee)  fieldCourseFee.style.display  = (ct === "年会員" || ct === "冬季限定会員" || ct === "スクール") ? "" : "none";

      autoFillCourseFee();
    }

    courseNameSel.addEventListener("change", autoFillCourseFee);
    courseTypeSel.addEventListener("change", toggleCourse);
    toggleCourse();
  }

  // ============================================================
  // ── mem_a 専用：Aコース料金 + 体験入校フラグ ────────────────
  // ============================================================
  let feeCourse = 10000, feeReception = 2100, feeInsurance = 2000;

  if (IS_MEM_A) {
    function applyFeeLabels() {
      if (el("fee_course"))    el("fee_course").textContent    = formatFee(feeCourse);
      if (el("fee_reception")) el("fee_reception").textContent = formatFee(feeReception);
      if (el("fee_insurance")) el("fee_insurance").textContent = formatFee(feeInsurance);
    }

    fetch("/config/api/masters?category=" + encodeURIComponent("パラ"))
      .then(r => r.json())
      .then(masters => {
        const targets = { "Aコース入校料": "feeCourse", "Aコース受付料": "feeReception", "Aコース保険料": "feeInsurance" };
        return Promise.all(masters.filter(m => targets[m.item_name]).map(m =>
          fetch("/config/api/values/" + m.id).then(r => r.json()).then(vals => {
            const a = vals.find(v => v.is_active);
            if (a && a.value != null) {
              const k = targets[m.item_name];
              if (k === "feeCourse")    feeCourse    = Number(a.value);
              if (k === "feeReception") feeReception = Number(a.value);
              if (k === "feeInsurance") feeInsurance = Number(a.value);
            }
          })
        ));
      })
      .then(applyFeeLabels).catch(applyFeeLabels);

    // flatpickr（mem_a 専用フィールド）
    if (el("application_date")) {
      flatpickr("#application_date", {
        locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d",
        defaultDate: "today", minDate: "today",
      });
    }
    if (el("agreement_date")) {
      flatpickr("#agreement_date", {
        locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d",
        defaultDate: "today", maxDate: "today",
        clickOpens: false, allowInput: false,
        onReady: function (_, __, fp) {
          fp.altInput.readOnly = true;
          fp.altInput.style.cursor = "default";
          fp.altInput.style.background = "var(--surface-2, #f5f5f5)";
        },
      });
    }

    // 体験から入校チェック
    const fromExpChk    = el("from_experience");
    const expResvGroup  = el("expResvNoGroup");
    const expDigitsInp  = el("exp_resv_digits");
    const expResvHidden = el("exp_resv_no");
    const expResvPrev   = el("expResvNoPreview");

    // 名前検索UI（動的生成：予約番号欄の前に挿入）
    let expNameGroup = null;
    function createExpNameGroup() {
      if (expNameGroup) return;
      expNameGroup = document.createElement("div");
      expNameGroup.id = "expNameGroup";
      expNameGroup.style.cssText = "display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:6px;";
      expNameGroup.innerHTML = `
        <span style="font-size:14px; font-weight:500;">申込氏名</span>
        <input type="text" id="exp_name_search" class="field-input"
               placeholder="氏名を入力して検索"
               style="width:200px;">
        <button type="button" id="exp_name_search_btn" class="btn btn-ghost"
                style="font-size:13px; padding:4px 12px;">検索</button>
        <span id="exp_name_result" style="font-size:13px; color:var(--text-muted);"></span>
      `;
      // expResvGroup の前に挿入
      if (expResvGroup && expResvGroup.parentNode) {
        expResvGroup.parentNode.insertBefore(expNameGroup, expResvGroup);
      }
      // 氏名欄に fullName の値を自動セット
      const nameInp = document.getElementById("exp_name_search");
      if (nameInp && el("fullName")) nameInp.value = el("fullName").value || "";

      // 検索ボタンのイベント
      document.getElementById("exp_name_search_btn").addEventListener("click", searchExpByName);
      // Enterキーでも検索
      nameInp.addEventListener("keydown", e => { if (e.key === "Enter") searchExpByName(); });
    }
    function removeExpNameGroup() {
      if (expNameGroup) { expNameGroup.remove(); expNameGroup = null; }
    }

    // 名前で体験予約を検索してresv_noをセット
    async function searchExpByName() {
      const nameInp   = document.getElementById("exp_name_search");
      const resultSp  = document.getElementById("exp_name_result");
      if (!nameInp || !resultSp) return;
      const name = nameInp.value.trim();
      if (!name) { resultSp.textContent = "氏名を入力してください"; resultSp.style.color = "var(--danger, #e53e3e)"; return; }
      resultSp.textContent = "検索中..."; resultSp.style.color = "var(--text-muted)";
      try {
        const res  = await fetch("/api/experience/search_by_name?name=" + encodeURIComponent(name));
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const hit = data.results[0];
          // resv_no は "P-XXXXXXX" 形式
          const rn = hit.resv_no || "";
          const digits = rn.replace(/^P-?/, "").replace(/\D/g, "");
          if (expDigitsInp) { expDigitsInp.value = digits; updateExpResvNo(); }
          resultSp.textContent = `✓ ${hit.full_name}（${rn}）`;
          resultSp.style.color = "var(--success, #38a169)";
        } else {
          resultSp.textContent = "一致する体験申込が見つかりませんでした";
          resultSp.style.color = "var(--danger, #e53e3e)";
        }
      } catch {
        resultSp.textContent = "検索に失敗しました";
        resultSp.style.color = "var(--danger, #e53e3e)";
      }
    }

    function updateExpResvNo() {
      const digits = expDigitsInp.value.replace(/\D/g, "").slice(0, 7);
      expDigitsInp.value = digits;
      const full = digits ? "P-" + digits : "";
      expResvHidden.value = full;
      if (expResvPrev) expResvPrev.textContent = full ? "→ " + full : "";
    }
    if (fromExpChk) {
      fromExpChk.addEventListener("change", function () {
        if (this.checked) {
          createExpNameGroup();
          if (expResvGroup) expResvGroup.style.display = "flex";
        } else {
          removeExpNameGroup();
          if (expResvGroup) expResvGroup.style.display = "none";
          if (expDigitsInp) {
            expDigitsInp.value = ""; expResvHidden.value = "";
            if (expResvPrev) expResvPrev.textContent = "";
          }
        }
        if (el("fee_course")) el("fee_course").textContent = this.checked ? "¥0" : formatFee(feeCourse);
      });
    }
    if (expDigitsInp) expDigitsInp.addEventListener("input", updateExpResvNo);
  }

  // ============================================================
  // ── 印刷シート同期（共通＋モード別） ─────────────────────────
  // ============================================================
  const EXPERIENCE_LABELS = {
    "1": "初めて（経験者同行なし）", "2": "初めて（経験者同行あり）",
    "3": "５回未満", "4": "５回以上",
  };

  function syncPrintSheet() {
    // 共通フィールド
    setText("p_application_date", getDispVal("application_date"));
    setText("p_full_name",        getVal("full_name"));
    setText("p_furigana",         getVal("furigana"));
    setText("p_gender",           getVal("gender"));
    setText("p_blood_type",       getVal("blood_type"));
    setText("p_birthday",         getDispVal("birthday"));
    setText("p_age",              getDispVal("age"));
    const z1 = (el("zip1") || {}).value || "";
    const z2 = (el("zip2") || {}).value || "";
    setText("p_zip",              z1 && z2 ? z1 + "-" + z2 : (z1 || z2));
    setText("p_weight",           getVal("weight"));
    setText("p_address",          getVal("address"));
    setText("p_mobile_phone",     getVal("mobile_phone"));
    setText("p_home_phone",       getVal("home_phone"));
    setText("p_company_name",     getVal("company_name"));
    setText("p_company_phone",    getVal("company_phone"));
    setText("p_emergency_name",   getVal("emergency_name"));
    setText("p_emergency_phone",  getVal("emergency_phone"));
    setText("p_relationship",     getVal("relationship"));
    setText("p_email",            getVal("email"));
    // 誓約書
    setText("p_agree_name",       getVal("full_name"));
    setText("p_agreement_date",   getDispVal("agreement_date"));
    setText("p_signature_name",   getVal("signature_name"));
    setText("p_guardian_name",    getVal("guardian_name"));

    if (IS_MEM || IS_VIS) {
      // フライヤー情報
      setText("p_organization",   getVal("organization"));
      setText("p_reg_no",         getDispVal("reg_no"));
      setText("p_reglimit_date",  getDispVal("reglimit_date"));
      setText("p_license",        getVal("license"));
      setText("p_repack_date",    getDispVal("repack_date"));
      setText("p_glider_name",    getVal("glider_name"));
      setText("p_glider_color",   getVal("glider_color"));
      setText("p_home_area",      getVal("home_area"));
      setText("p_leader",         getVal("leader"));
      // ビジター料金・経験
      const feeVal = getRadioVal("visitor_fee");
      const expVal = getRadioVal("experience");
      setText("p_visitor_fee",    VISITOR_FEE_LABELS[feeVal] || "");
      setText("p_experience",     EXPERIENCE_LABELS[expVal]  || "");
    }

    if (IS_MEM) {
      // コース情報（mem のみ）
      const ct = (el("course_type") || {}).value || "";
      const cn = (el("course_name") || {}).value || "";
      setText("p_course_type", ct);
      const showName = ct === "冬季限定会員" || ct === "スクール";
      const showFee  = ct === "年会員" || ct === "冬季限定会員" || ct === "スクール";
      setText("p_course_name", showName ? getVal("course_name") : "");
      setText("p_course_fee",  showFee  ? getVal("course_fee")  : "");
      if (el("p_label_course_name")) el("p_label_course_name").style.display = showName ? "" : "none";
      if (el("p_course_name") && el("p_course_name").parentElement)
        el("p_course_name").parentElement.style.display = showName ? "" : "none";
      if (el("p_row_course_fee")) el("p_row_course_fee").style.display = showFee ? "" : "none";

      const isVisitor = ct === "ビジター";
      if (el("p_table_visitor_fee")) el("p_table_visitor_fee").style.display = isVisitor ? "" : "none";
    }

    if (IS_MEM_A) {
      // Aコース料金（mem_a のみ）
      const fromExp = (el("from_experience") || {}).checked;
      setText("p_from_experience", fromExp ? "体験から入校" : "");
      setText("p_exp_resv_no",     fromExp ? getDispVal("exp_resv_no") : "");
      setText("p_fee_course",    fromExp ? "¥0" : formatFee(feeCourse));
      setText("p_fee_reception", formatFee(feeReception));
      setText("p_fee_insurance", formatFee(feeInsurance));
      setText("p_course_find",   getVal("course_find"));
    }

    if (IS_MEM) {
      setText("p_medical_history", getVal("medical_history"));
    }
    if (IS_VIS) {
      setText("p_medical_history", getVal("medical_history"));
    }
  }

  // ── 印刷・終了ボタン（共通） ─────────────────────────────────
  if (el("printBtn")) el("printBtn").addEventListener("click", function () { syncPrintSheet(); window.print(); });
  if (el("exitBtn"))  el("exitBtn").addEventListener("click",  function () { location.href = "/apply_flyer"; });

  // ============================================================
  // ── 送信バリデーション + 送信（共通＋モード別） ───────────────
  // ============================================================
  if (el("submitBtn")) {
    el("submitBtn").addEventListener("click", function () {
      const form = el("entryForm");

      // ── mem 専用チェック（最初に実施：form-body-wrapper外のcourse_typeを先に確認） ──
      if (IS_MEM) {
        if (!el("course_type").value) { alert("コースタイプを選択してください"); return; }
      }

      // ── 共通必須チェック（document.querySelector で参照：disabled でもアクセス可能） ──
      const _fullName = (document.querySelector('[name="full_name"]') || {value:""}).value.trim();
      if (!_fullName)                                          { alert("氏名を入力してください");               return; }
      if (!getDispVal("birthday"))                             { alert("生年月日を入力してください");           return; }
      const _mobilePhone = (document.querySelector('[name="mobile_phone"]') || {value:""}).value.trim();
      if (!_mobilePhone)                                       { alert("携帯電話番号を入力してください");       return; }
      const _email = (document.querySelector('[name="email"]') || {value:""}).value.trim();
      if (!_email)                                             { alert("e-mailを入力してください");             return; }
      const _emergencyName = (document.querySelector('[name="emergency_name"]') || {value:""}).value.trim();
      if (!_emergencyName)                                     { alert("緊急連絡先の氏名を入力してください");   return; }
      const _emergencyPhone = (document.querySelector('[name="emergency_phone"]') || {value:""}).value.trim();
      if (!_emergencyPhone)                                    { alert("緊急連絡先の電話番号を入力してください"); return; }

      // ── mem / vis 共通チェック（フライヤー情報） ────────────
      if (IS_MEM || IS_VIS) {
        if (!el("organization").value)    { alert("所属団体を選択してください");         return; }
        if (!buildRegNo(el("organization").value)) { alert("フライヤー登録番号を入力してください"); return; }
        // 登録期限：flatpickr の選択値を直接参照して必須チェック
        const _reglimitFp  = el("reglimit_date") && el("reglimit_date")._flatpickr;
        const _reglimitVal = _reglimitFp && _reglimitFp.selectedDates.length > 0 ? _reglimitFp.selectedDates[0] : null;
        if (!_reglimitVal) { alert("登録期限を入力してください"); return; }
        if (!el("license").value) { alert("技能証を選択してください"); return; }
        // 技能証が B / NP / P / XC の場合はリパック日も必須
        if (["B", "NP", "P", "XC"].includes(el("license").value)) {
          const _repackFp  = el("repack_date") && el("repack_date")._flatpickr;
          const _repackVal = _repackFp && _repackFp.selectedDates.length > 0 ? _repackFp.selectedDates[0] : null;
          if (!_repackVal) { alert("技能証が B / NP / P / XC の場合、リパック日は必須です"); return; }
        }
        if (IS_VIS || (el("course_type") && el("course_type").value === "ビジター")) {
          if (!getRadioVal("visitor_fee")) { alert("ビジター料金を選択してください"); return; }
          if (!getRadioVal("experience"))  { alert("フライト経験を選択してください"); return; }
        }
      }

      // ── mem 専用チェック（glider_name） ──────────────────────
      if (IS_MEM) {
        const _gliderName = (document.querySelector('[name="glider_name"]') || {value:""}).value.trim();
        if (!_gliderName) { alert("使用機体名を入力してください"); return; }
        // 他校スクールはホームエリア必須
        const _courseType = (el("course_type") || {}).value || "";
        // course_type ではなく API 送信値の member_type で判定
        // ここでは course_type の直接参照はないため、hidden の member_type を参照
        const _memberType = (el("member_type") || {}).value || "";
        if (_memberType === "他校スクール") {
          const _homeArea = (document.querySelector('[name="home_area"]') || {value:""}).value.trim();
          if (!_homeArea) { alert("他校スクールの場合、ホームエリア名は必須です"); return; }
        }
      }

      // ── mem_a 専用チェック ───────────────────────────────────
      if (IS_MEM_A) {
        if (!getDispVal("agreement_date")) { alert("確認日を入力してください"); return; }
      }

      // ── 共通：署名チェック ───────────────────────────────────
      const _sigName = (document.querySelector('[name="signature_name"]') || {value:""}).value.trim();
      if (!_sigName) { alert("本人署名を入力してください"); return; }
      if (_sigName !== _fullName) {
        const ok = confirm(`氏名「${_fullName}」と本人署名「${_sigName}」が異なります。\nこのまま申請する場合は「OK」、書き直す場合は「キャンセル」。`);
        if (!ok) return;
      }
      if (!confirm("この内容で申請しますか？")) return;

      // ── 送信前処理 ───────────────────────────────────────────
      // 登録番号を hidden に反映
      if (IS_MEM || IS_VIS) {
        el("reg_no").value = buildRegNo(el("organization").value) || "";
      }

      // flatpickr の値を実 input に確実にセット（altInput で実inputが空になるのを防ぐ）
      const _fpIds_common = IS_VIS
        ? ["application_date", "birthday", "agreement_date", "reglimit_date"]
        : IS_MEM
        ? ["application_date", "birthday", "reglimit_date", "repack_date"]
        : [];
      _fpIds_common.forEach(function (id) {
        const e = el(id);
        if (e && e._flatpickr && e._flatpickr.selectedDates.length > 0) {
          e.value = e._flatpickr.formatDate(e._flatpickr.selectedDates[0], e._flatpickr.config.dateFormat);
        }
      });

      // IS_MEM: agreement_date は "YYYY年M月D日" 形式 → "YYYY-MM-DD" に変換
      if (IS_MEM) {
        const agEl = el("agreement_date");
        if (agEl && agEl.value) {
          const _m = agEl.value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          if (_m) agEl.value = _m[1] + "-" + String(_m[2]).padStart(2,"0") + "-" + String(_m[3]).padStart(2,"0");
        }
      }

      // mem_a: course_fee を動的セット
      if (IS_MEM_A) {
        const fromExpChecked = (el("from_experience") || {}).checked;
        const feeCourseEl = document.querySelector("[name='course_fee']");
        if (feeCourseEl) feeCourseEl.value = fromExpChecked ? "0" : String(feeCourse);
      }

      // ── 送信 ─────────────────────────────────────────────────
      const formData = new FormData(form);

      fetch(API_ENDPOINT, { method: "POST", body: formData })
        .then(res => res.json().then(data => ({ status: res.status, data })))
        .then(({ status, data }) => {
          if (status === 409 && data.status === "duplicate") {
            showDuplicateError(data.message);
            return;
          }
          if (status !== 200 && status !== 201) {
            const msg = (data && data.message) ? data.message : "不明なエラー";
            alert("登録に失敗しました。\n\nエラー内容：" + msg + "\n\n管理者へ連絡してください。");
            return;
          }
          alert("登録完了しました。フライヤー申請ページに戻ります。");
          window.location.href = "/apply_flyer";
        })
        .catch(() => alert("登録に失敗しました。管理者へ連絡してください。"));
    });
  }

});
