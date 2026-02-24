// app_vis.js

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

  flatpickr("#reglimit_date", {
    locale: "ja",
    altInput: true,
    altFormat: "Y年m月d日",
    dateFormat: "Y-m-d",
  });

  flatpickr("#repack_date", {
    locale: "ja",
    plugins: [
      new monthSelectPlugin({
        shorthand: false,
        dateFormat: "Y-m",
        altFormat: "Y年m月",
      }),
    ],
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
    if (confirm("入力画面を終了して、トップページへ戻りますか？")) {
      // window.close() の代わりに location.href を使用します
      window.location.href = "/"; 
      // Flaskなどのルート設定が index.html なら "/" または "/index" に変更してください
    }
  });

  // ── 申請ボタン：バリデーション → DB登録 ──────────────────────

  document.getElementById("submitBtn").addEventListener("click", function () {
    const form = document.getElementById("entryForm");

    if (!form.full_name.value.trim()) {
      alert("氏名を入力してください");
      form.full_name.focus();
      return;
    }

    if (!form.birthday.value.trim()) {
      alert("生年月日を入力してください");
      form.birthday.focus();
      return;
    }

    if (!form.reg_no.value.trim()) {
      alert("フライヤー登録No.を入力してください");
      form.reg_no.focus();
      return;
    }

    if (!form.querySelector('input[name="visitor_fee"]:checked')) {
      alert("料金を選択してください");
      return;
    }

    if (!form.querySelector('input[name="experience"]:checked')) {
      alert("フライト経験を選択してください");
      return;
    }

    if (!form.signature_name.value.trim()) {
      alert("本人署名を入力してください");
      form.signature_name.focus();
      return;
    }

    if (!confirm("この内容で申請しますか？")) return;

    registerData();
  });

  // ── DB登録処理 ────────────────────────────────────────────────

  function registerData() {
    // flatpickr の altInput 使用時、元 input に値を確実にセット
    ["application_date", "birthday", "agreement_date", "reglimit_date"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el && el._flatpickr && el._flatpickr.selectedDates.length > 0) {
        el.value = el._flatpickr.formatDate(
          el._flatpickr.selectedDates[0],
          el._flatpickr.config.dateFormat
        );
      }
    });

    const formData = new FormData(document.getElementById("entryForm"));

    fetch("/api/apply_v", {
      method: "POST",
      body: formData,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "error") {
          alert("DBエラー：\n" + data.message);
          return;
        }
      alert("登録完了しました。トップページに戻ります。");
        window.location.href = "/"; // 登録成功後に自動遷移        alert("登録完了しました。");
      })
      .catch((err) => {
        alert("登録に失敗しました。管理者へ連絡してください。");
      });
  }

});
