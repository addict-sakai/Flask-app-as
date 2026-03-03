// app_exp_e.js

document.addEventListener("DOMContentLoaded", function () {

  // ── flatpickr 初期化 ──────────────────────────────────────────

  flatpickr("#application_date", {
    locale: "ja",
    altInput: true,
    altFormat: "Y年m月d日",
    dateFormat: "Y-m-d",
    maxDate: "today",
  });

  flatpickr("#agreement_date", {
    locale: "ja",
    altInput: true,
    altFormat: "Y年m月d日",
    dateFormat: "Y-m-d",
    maxDate: "today",
  });

  flatpickr("#birthday", {
    locale: "ja",
    altInput: true,
    altFormat: "Y年m月d日",
    dateFormat: "Y-m-d",
    maxDate: "today",
    onChange: function (selectedDates) {
      if (!selectedDates.length) return;
      const birth = selectedDates[0];
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      document.getElementById("age").value = age;
    },
  });

  // ── 氏名 → 誓約書の名前を連動 ────────────────────────────────

  const nameInput = document.getElementById("fullName");
  const agreeName = document.getElementById("agreeName");

  if (nameInput && agreeName) {
    nameInput.addEventListener("input", function () {
      agreeName.textContent = this.value || "　　　　　　　";
    });
  }

  // ── 郵便番号 → 住所自動補完 ──────────────────────────────────

  function fetchAddress() {
    const zip1 = document.getElementById("zip1").value;
    const zip2 = document.getElementById("zip2").value;
    if (zip1.length !== 3 || zip2.length !== 4) return;

    fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip1}${zip2}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.results) {
          const r = data.results[0];
          document.getElementById("address").value =
            r.address1 + r.address2 + r.address3;
        }
      })
      .catch(() => {});
  }

  document.getElementById("zip1").addEventListener("input", function () {
    if (this.value.length === 3) document.getElementById("zip2").focus();
  });

  document.getElementById("zip2").addEventListener("input", function () {
    if (this.value.length === 4) document.getElementById("address").focus();
  });

  document.getElementById("zip2").addEventListener("blur", fetchAddress);

  // ── 終了ボタン ────────────────────────────────────────────────

  document.getElementById("exitBtn").addEventListener("click", function () {
    if (confirm("Are you sure you want to close this window?")) {
      // 画面を閉じるのではなく、トップページ（/）へリダイレクトさせる
      window.location.href = "/"; 
    }
  });

  // ── 1. 申請ボタン：バリデーション → 保険ポップアップ表示 ─────

  document.getElementById("submitBtn").addEventListener("click", function () {
    const form = document.getElementById("entryForm");

    if (!form.full_name.value.trim()) {
      alert("Please enter your full name.");
      form.full_name.focus();
      return;
    }

    if (!form.birthday.value.trim()) {
      alert("Please enter your date of birth.");
      form.birthday.focus();
      return;
    }

    if (!form.querySelector('input[name="course_exp"]:checked')) {
      alert("Please select the course you will be attending.");
      return;
    }

    if (!form.querySelector('input[name="school_find"]:checked')) {
      alert("Please select how you found out about our school.");
      return;
    }

    if (!form.signature_name.value.trim()) {
      alert("Please enter your signature.");
      form.signature_name.focus();
      return;
    }

    // 保険案内ポップアップを表示
    const width = 600;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const insuranceWin = window.open(
      "/insurance_guide_e",
      "InsuranceWindow",
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );

    if (!insuranceWin) {
      alert("A pop-up has been blocked. Please check your browser settings.");
    }
  });

  // ── 2. ポップアップからの「同意」メッセージ受信 ───────────────

  window.addEventListener("message", function (event) {
    if (event.data === "agreed") {
      document.getElementById("insurance_agreement").value = "1";
      registerData();
    }
  });

  // ── 3. DB登録処理 ─────────────────────────────────────────────

  function registerData() {
    // flatpickr の altInput 使用時、元 input に値を確実にセット
    ["application_date", "birthday", "agreement_date"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el && el._flatpickr && el._flatpickr.selectedDates.length > 0) {
        el.value = el._flatpickr.formatDate(
          el._flatpickr.selectedDates[0],
          el._flatpickr.config.dateFormat
        );
      }
    });

    const formData = new FormData(document.getElementById("entryForm"));

    fetch("/api/apply_exp_e", {
      method: "POST",
      body: formData,
    })
      .then((res) => {
        if (!res.ok) throw new Error("DBエラー");
        return res.json();
      })
      .then(() => {
        alert("Your insurance consent has been confirmed, and your registration is complete.");
      })
      .catch(() => {
        alert("The registration has failed. Please contact the administrator.");
      });
  }

});
