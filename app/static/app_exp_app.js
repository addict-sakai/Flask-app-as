/**
 * app_exp_app.js
 * 体験申込書（日本語・英語）共通スクリプト
 * 改定1 2026/04/01
 *
 * 対応モード:
 *   <body data-apply-mode="exp">   → 日本語版（POST /api/apply_exp）
 *   <body data-apply-mode="exp_e"> → 英語版  （POST /api/apply_exp_e）
 */
"use strict";

document.addEventListener("DOMContentLoaded", function () {

  // ── モード判定 ──────────────────────────────────────────────
  const MODE = document.body.dataset.applyMode || "exp";
  const IS_EN = MODE === "exp_e";
  const API_ENDPOINT = IS_EN ? "/api/apply_exp_e" : "/api/apply_exp";
  const LANG = IS_EN ? "en" : "ja";

  // ── ユーティリティ ────────────────────────────────────────────
  function el(id)        { return document.getElementById(id); }
  function getVal(name) {
    const e = document.querySelector(`[name="${name}"]`);
    if (!e) return "";
    if (e.tagName === "SELECT") return e.options[e.selectedIndex]?.text || "";
    return e.value || "";
  }
  function getDispVal(id) { const e = el(id); return e ? e.value : ""; }
  function setText(id, val) { const e = el(id); if (e) e.textContent = val || ""; }

  // ── 言語切替ドロップダウン ─────────────────────────────────────
  const langBtn    = el("langDropdownBtn");
  const langMenu   = el("langDropdownMenu");

  if (langBtn && langMenu) {
    langBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      langMenu.classList.toggle("is-open");
    });

    langMenu.querySelectorAll(".lang-dropdown-item").forEach(function (item) {
      item.addEventListener("click", function () {
        const lang = this.dataset.lang;
        langMenu.classList.remove("is-open");
        if (lang === "ja" && IS_EN) {
          window.location.href = "/apply_exp";
        } else if (lang === "en" && !IS_EN) {
          window.location.href = "/apply_exp_e";
        }
      });
    });

    document.addEventListener("click", function () {
      langMenu.classList.remove("is-open");
    });
  }

  // ── ハンバーガーメニュー ──────────────────────────────────────
  const hamburgerBtn  = el("hamburgerBtn");
  const hamburgerMenu = el("hamburgerMenu");

  if (hamburgerBtn && hamburgerMenu) {
    hamburgerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      hamburgerMenu.classList.toggle("is-open");
    });

    document.addEventListener("click", function () {
      hamburgerMenu.classList.remove("is-open");
    });

    hamburgerMenu.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  // ── 印刷ボタン ────────────────────────────────────────────────
  if (el("printBtn")) {
    el("printBtn").addEventListener("click", function () {
      hamburgerMenu && hamburgerMenu.classList.remove("is-open");
      syncPrintSheet();
      window.print();
    });
  }

  // ── キャンセルボタン ──────────────────────────────────────────
  if (el("cancelBtn")) {
    el("cancelBtn").addEventListener("click", function () {
      hamburgerMenu && hamburgerMenu.classList.remove("is-open");
      window.location.href = "/";
    });
  }

  // ── 体験コース選択肢をconfigから動的ロード ──────────────────────
  async function loadCourseOptions() {
    const sel = el("courseExpSelect");
    if (!sel) return;

    const defaultLabel = IS_EN ? "-- Please select --" : "-- 選択してください --";

    try {
      const res = await fetch("/api/exp_course_options");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      sel.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = defaultLabel;
      sel.appendChild(blank);

      if (data.options && data.options.length > 0) {
        data.options.forEach(function (opt) {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label || opt.value;
          sel.appendChild(o);
        });
      } else {
        const fallback = IS_EN
          ? [
              { value: "short_flight", text: "Short Flight Experience" },
              { value: "tandem",       text: "Tandem Flight" },
              { value: "set",          text: "Short + Tandem Set" },
            ]
          : [
              { value: "short_flight", text: "ショートフライト体験" },
              { value: "tandem",       text: "タンデムフライト" },
              { value: "set",          text: "ショート＋タンデム セット" },
            ];
        fallback.forEach(function (f) {
          const o = document.createElement("option");
          o.value = f.value;
          o.textContent = f.text;
          sel.appendChild(o);
        });
      }
    } catch (e) {
      console.warn("コース選択肢の取得に失敗しました:", e);
    }
  }

  loadCourseOptions();

  // ── flatpickr 初期化 ──────────────────────────────────────────

  // 申込日：全日可（過去・現在・将来）
  if (el("application_date")) {
    flatpickr("#application_date", {
      locale: IS_EN ? "en" : "ja",
      altInput: true,
      altFormat: IS_EN ? "F j, Y" : "Y年m月d日",
      dateFormat: "Y-m-d",
      // maxDate / minDate なし（全日可）
    });
  }

  // 生年月日
  if (el("birthday")) {
    flatpickr("#birthday", {
      locale: IS_EN ? "en" : "ja",
      altInput: true,
      altFormat: IS_EN ? "F j, Y" : "Y年m月d日",
      dateFormat: "Y-m-d",
      maxDate: "today",
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

  // 確認日：今日の日付を自動セット（読み取り専用）
  if (el("agreement_date")) {
    const today = new Date();
    const year  = today.getFullYear();
    const month = today.getMonth() + 1;
    const day   = today.getDate();
    if (IS_EN) {
      const monthNames = ["January","February","March","April","May","June",
                          "July","August","September","October","November","December"];
      el("agreement_date").value = monthNames[today.getMonth()] + " " + day + ", " + year;
    } else {
      el("agreement_date").value = year + "年" + month + "月" + day + "日";
    }
    // hidden値として YYYY-MM-DD を別途保持
    const hiddenAgreement = document.createElement("input");
    hiddenAgreement.type  = "hidden";
    hiddenAgreement.name  = "agreement_date_iso";
    hiddenAgreement.value = year + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
    el("entryForm").appendChild(hiddenAgreement);
  }

  // ── 氏名 → 誓約書の名前を連動 ────────────────────────────────
  const nameInput = el("fullName");
  const agreeName = el("agreeName");

  if (nameInput && agreeName) {
    nameInput.addEventListener("input", function () {
      agreeName.textContent = this.value || "　　　　　　　　　";
    });
  }

  // ── フリガナ自動入力（日本語版のみ） ─────────────────────────
  const furiganaInput = el("furigana");
  if (!IS_EN && nameInput && furiganaInput) {
    let kanaAccum = "", kanaComposing = "";
    const toKatakana = str => str.replace(/[\u3041-\u3096]/g,
      c => String.fromCharCode(c.charCodeAt(0) + 0x60));
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

  // ── 郵便番号 → 住所自動補完（日本語版のみ） ──────────────────
  if (!IS_EN) {
    function fetchAddress() {
      const z1 = (el("zip1") || {}).value || "";
      const z2 = (el("zip2") || {}).value || "";
      if (z1.length !== 3 || z2.length !== 4) return;
      fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z1}${z2}`)
        .then(r => r.json())
        .then(data => {
          if (data.results) {
            const r = data.results[0];
            if (el("address")) el("address").value = r.address1 + r.address2 + r.address3;
          }
        })
        .catch(() => {});
    }
    if (el("zip1")) {
      el("zip1").addEventListener("input", function () {
        if (this.value.length === 3 && el("zip2")) el("zip2").focus();
      });
    }
    if (el("zip2")) el("zip2").addEventListener("blur", fetchAddress);
  }

  // ── 印刷シート同期 ────────────────────────────────────────────
  function syncPrintSheet() {
    // 申込日
    const appDateFp = el("application_date") && el("application_date")._flatpickr;
    if (appDateFp && appDateFp.selectedDates.length > 0) {
      setText("p_application_date", appDateFp.altInput ? appDateFp.altInput.value : appDateFp.input.value);
    }

    setText("p_full_name",        getVal("full_name"));
    setText("p_furigana",         getVal("furigana"));
    setText("p_gender",           getVal("gender"));
    setText("p_blood_type",       getVal("blood_type"));

    const bdFp = el("birthday") && el("birthday")._flatpickr;
    if (bdFp && bdFp.selectedDates.length > 0) {
      setText("p_birthday", bdFp.altInput ? bdFp.altInput.value : bdFp.input.value);
    }
    setText("p_age",    getDispVal("age"));
    setText("p_weight", getVal("weight"));

    setText("p_mobile_phone",    getVal("mobile_phone"));
    setText("p_email",           getVal("email"));

    if (!IS_EN) {
      const z1 = (el("zip1") || {}).value || "";
      const z2 = (el("zip2") || {}).value || "";
      setText("p_zip", z1 && z2 ? z1 + "-" + z2 : (z1 || z2));
    } else {
      setText("p_country", getVal("country"));
    }
    setText("p_address",          getVal("address"));
    setText("p_emergency_name",   getVal("emergency_name"));
    setText("p_emergency_phone",  getVal("emergency_phone"));
    setText("p_relationship",     getVal("relationship"));
    setText("p_course_exp",       getVal("course_exp"));
    setText("p_school_find",      getVal("school_find"));

    // 誓約書
    setText("p_agree_name",      getVal("full_name"));
    setText("p_agreement_date",  getDispVal("agreement_date"));
    setText("p_signature_name",  getVal("signature_name"));
    setText("p_guardian_name",   getVal("guardian_name"));
  }

  // ── 申請バリデーション + 送信 ─────────────────────────────────
  if (el("submitBtn")) {
    el("submitBtn").addEventListener("click", function () {
      hamburgerMenu && hamburgerMenu.classList.remove("is-open");

      const msg = IS_EN ? {
        full_name:        "Please enter your full name.",
        birthday:         "Please enter your date of birth.",
        mobile_phone:     "Please enter your mobile phone number.",
        emergency_name:   "Please enter the emergency contact name.",
        emergency_phone:  "Please enter the emergency contact phone number.",
        email:            "Please enter your e-mail address.",
        course_exp:       "Please select a course.",
        signature_name:   "Please enter your signature.",
        confirm:          "Submit this application?",
        success:          "Application submitted successfully.",
        error:            "Submission failed. Please contact the staff.",
        app_date:         "Please select the application date.",
      } : {
        full_name:        "氏名を入力してください。",
        birthday:         "生年月日を入力してください。",
        mobile_phone:     "携帯電話番号を入力してください。",
        emergency_name:   "緊急連絡先の氏名を入力してください。",
        emergency_phone:  "緊急連絡先の電話番号を入力してください。",
        email:            "e-mailを入力してください。",
        course_exp:       "参加コースを選択してください。",
        signature_name:   "本人署名を入力してください。",
        confirm:          "この内容で申請しますか？",
        success:          "申請が完了しました。",
        error:            "申請に失敗しました。スタッフへ連絡してください。",
        app_date:         "申込日を選択してください。",
      };

      // 申込日
      const appDateFp = el("application_date") && el("application_date")._flatpickr;
      if (!appDateFp || !appDateFp.selectedDates.length) {
        alert(msg.app_date); return;
      }

      // 氏名
      const _fullName = (document.querySelector('[name="full_name"]') || {value:""}).value.trim();
      if (!_fullName) { alert(msg.full_name); return; }

      // 生年月日
      const bdFp = el("birthday") && el("birthday")._flatpickr;
      if (!bdFp || !bdFp.selectedDates.length) { alert(msg.birthday); return; }

      // 携帯番号
      const _mobile = (document.querySelector('[name="mobile_phone"]') || {value:""}).value.trim();
      if (!_mobile) { alert(msg.mobile_phone); return; }

      // 緊急連絡先
      const _emName = (document.querySelector('[name="emergency_name"]') || {value:""}).value.trim();
      if (!_emName) { alert(msg.emergency_name); return; }
      const _emPhone = (document.querySelector('[name="emergency_phone"]') || {value:""}).value.trim();
      if (!_emPhone) { alert(msg.emergency_phone); return; }

      // e-mail
      const _email = (document.querySelector('[name="email"]') || {value:""}).value.trim();
      if (!_email) { alert(msg.email); return; }

      // 参加コース
      const _course = (document.querySelector('[name="course_exp"]') || {value:""}).value;
      if (!_course) { alert(msg.course_exp); return; }

      // 署名
      const _sig = (document.querySelector('[name="signature_name"]') || {value:""}).value.trim();
      if (!_sig) { alert(msg.signature_name); return; }

      if (!confirm(msg.confirm)) return;

      // ── 送信前処理：flatpickr の値を実 input に確実にセット ──
      ["application_date", "birthday"].forEach(function (id) {
        const e = el(id);
        if (e && e._flatpickr && e._flatpickr.selectedDates.length > 0) {
          e.value = e._flatpickr.formatDate(
            e._flatpickr.selectedDates[0],
            e._flatpickr.config.dateFormat
          );
        }
      });

      // agreement_date は ISO 形式を hidden から取得して実フィールドにセット
      const isoHidden = document.querySelector('[name="agreement_date_iso"]');
      if (isoHidden && el("agreement_date")) {
        // agreement_date に ISO 値を上書き（DBへの送信用）
        // ※ altInput 方式でないため直接上書き
        const orig = el("agreement_date").value;
        el("agreement_date").removeAttribute("readonly"); // FormData に含めるため一時解除
        el("agreement_date").value = isoHidden.value;
      }

      // ── POST 送信 ────────────────────────────────────────────
      const formData = new FormData(el("entryForm"));

      // agreement_date を readonly に戻す
      if (el("agreement_date")) el("agreement_date").setAttribute("readonly", "");

      fetch(API_ENDPOINT, { method: "POST", body: formData })
        .then(res => res.json().then(data => ({ status: res.status, data })))
        .then(({ status, data }) => {
          if (status !== 200 && status !== 201) {
            const errMsg = (data && data.message) ? data.message : "Unknown error";
            alert((IS_EN ? "Error: " : "エラー：") + errMsg + "\n" + msg.error);
            return;
          }
          alert(msg.success);
          window.location.href = "/";
        })
        .catch(() => alert(msg.error));
    });
  }

});
