// app_mem.js（ブラウザ専用）
document.addEventListener("DOMContentLoaded", function () {

  // document.getElementById("submitBtn").addEventListener("click", function () {
  //  const form = document.getElementById("entryForm");

  //  if (!form.full_name.value.trim()) {
  //    alert("氏名を入力してください");
  //    form.full_name.focus();
  //    return;
  //  }

  //  if (!form.birthday.value.trim()) {
  //    alert("生年月日を入力してください");
  //    form.birthday.focus();
  //    return;
  //  }

  //  if (!form.course_type.value) {
  //    alert("コースを選択してください");
  //    return;
  //  }

  //  if (!confirm("この内容で申請しますか？")) return;

  //  form.requestSubmit();
  //});

  // ── flatpickr 初期化 ──────────────────────────────────────────
  flatpickr("#application_date", {
    locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d", maxDate: "today",
  });

  flatpickr("#agreement_date", {
    locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d", maxDate: "today",
  });

  flatpickr("#reglimit_date", {
    locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d",
  });

  flatpickr("#repack_date", {
    locale: "ja",
    plugins: [new monthSelectPlugin({ shorthand: false, dateFormat: "Y-m", altFormat: "Y年m月" })],
    maxDate: "today",
  });

  flatpickr("#birthday", {
    locale: "ja", altInput: true, altFormat: "Y年m月d日", dateFormat: "Y-m-d", maxDate: "today",
    onChange: function (selectedDates) {
      if (!selectedDates.length) return;
      const birth = selectedDates[0];
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      document.getElementById("age").value = age;
    },
  });

  // ── 氏名連動 ────────────────────────────────────────────────
  const nameInput = document.getElementById("fullName");
  const agreeName = document.getElementById("agreeName");
  if (nameInput) {
    nameInput.addEventListener("input", function () {
      agreeName.textContent = this.value || "　　　　　　　";
    });
  }

  // ── 住所検索 ────────────────────────────────────────────────
  function fetchAddress() {
    const zip1 = document.getElementById("zip1").value;
    const zip2 = document.getElementById("zip2").value;
    if (zip1.length !== 3 || zip2.length !== 4) return;
    fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip1}${zip2}`)
      .then(res => res.json())
      .then(data => {
        if (data.results) {
          const r = data.results[0];
          document.getElementById("address").value = r.address1 + r.address2 + r.address3;
        }
      });
  }

  document.getElementById("zip1").addEventListener("input", function () {
    if (this.value.length === 3) document.getElementById("zip2").focus();
  });

  document.getElementById("zip2").addEventListener("blur", fetchAddress);

  // ── コース選択による活性/非活性制御 ──────────────────────────
  const schoolingRadio = document.getElementById("schooling");
  const freeflightRadio = document.getElementById("freeflight");
  const courseName = document.getElementById("course_name");
  const courseFee = document.getElementById("course_fee");
  const aircraft = document.getElementById("glider_name");

  function toggleFields() {
    courseName.disabled = !schoolingRadio.checked;
    courseFee.disabled = !schoolingRadio.checked;
    aircraft.disabled = !freeflightRadio.checked;
    if (schoolingRadio.checked) aircraft.value = "";
    if (freeflightRadio.checked) { courseName.value = ""; courseFee.value = ""; }
  }
  if (schoolingRadio) {
    schoolingRadio.addEventListener("change", toggleFields);
    freeflightRadio.addEventListener("change", toggleFields);
    toggleFields(); // 初期実行
  }

  // ── 終了ボタン（indexへ戻る） ───────────────────────────────
  document.getElementById("exitBtn").addEventListener("click", function () {
    if (confirm("入力を終了してトップ画面に戻りますか？")) {
      window.location.href = "/"; 
    }
  });

  // ── 申請ボタン（バリデーション & 送信） ──────────────────────
  document.getElementById("submitBtn").addEventListener("click", function () {
    const form = document.getElementById("entryForm");

    if (!form.full_name.value.trim()) { alert("氏名を入力してください"); form.full_name.focus(); return; }
    if (!form.birthday.value.trim()) { alert("生年月日を入力してください"); form.birthday.focus(); return; }
    if (!form.course_type.value) { alert("コースを選択してください"); return; }

    if (!confirm("この内容で申請しますか？")) return;

    const formData = new FormData(form);
    fetch("/api/apply", {
      method: "POST",
      body: formData
    })
    .then(res => {
      if (!res.ok) throw new Error("DBエラー");
      return res.json();
    })
    .then(data => {
      alert("登録完了しました。トップページに戻ります。");
      window.location.href = "/"; // indexへ戻る
    })
    .catch(err => {
      alert("登録に失敗しました。管理者へ連絡してください。");
    });
  });
});