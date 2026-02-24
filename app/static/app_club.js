// app_club.js

document.addEventListener("DOMContentLoaded", function () {

  // ── flatpickr 初期化 ──────────────────────────────────────────

  flatpickr(".js-date", {
    locale: "ja",
    altInput: true,
    altFormat: "Y年m月d日",
    dateFormat: "Y-m-d",
    maxDate: "today",
  });

});

// ── 申請ボタン ──────────────────────────────────────────
function submitClub() {
  // 必要に応じてバリデーション・送信処理をここに追加
  alert("申請を受け付けました。");
}
