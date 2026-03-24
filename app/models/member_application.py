"""
app/models/member_application.py
member_applications テーブル SQLAlchemy モデル
DB構成V2 新規追加テーブル（2026-03-23）

用途:
    会員の更新・変更申請をスタッフ承認まで一時保管する。
    申請時点では members テーブルを変更しない。
    スタッフが承認した時点で changes_json の内容を members に反映する。

application_type の値:
    'new_member'    : 新規申込（初回入金確認前の申請）
    'course_change' : コース変更（member_type, course_name の変更）
                      → 承認時に member_courses にレコードを追加する（改定６）
    'renewal'       : 更新（reglimit_date の変更のみ）
    'info_change'   : 個人情報変更（住所・電話・グライダー等）

app_status の値:
    'pending'  : 申請中（スタッフ未確認）
    'approved' : 承認済み（members に反映済み）
    'rejected' : 却下
"""
import json
from app.db import db
from datetime import datetime


class MemberApplication(db.Model):
    __tablename__ = "member_applications"

    # ── カラム定義（DB構成V2 ordinal 順） ────────────────────────

    id               = db.Column(db.Integer, primary_key=True)                    # 1

    member_id        = db.Column(
                           db.Integer,
                           db.ForeignKey("members.id", ondelete="CASCADE"),
                           nullable=False,
                       )                                                           # 2  対象会員

    application_type = db.Column(db.String(20), nullable=False)                   # 3  申請種別
    app_status       = db.Column(
                           db.String(20),
                           nullable=False,
                           default='pending',
                       )                                                           # 4  申請ステータス

    changes_json     = db.Column(db.Text, nullable=False)                         # 5  変更差分（JSON）
    # 例: '{"full_name": "山田太郎", "reglimit_date": "2027-03-31"}'
    # app_mem_upd.js が収集した変更差分をそのまま格納する

    notes            = db.Column(db.Text)                                         # 6  スタッフメモ（却下理由等）

    applied_at       = db.Column(
                           db.DateTime,
                           nullable=False,
                           default=datetime.utcnow,
                       )                                                           # 7  申請日時

    confirmed_at     = db.Column(db.DateTime)                                     # 8  承認・却下日時
    confirmed_by     = db.Column(db.String(100))                                  # 9  処理したスタッフ名

    # ── リレーション ──────────────────────────────────────────────
    # member = db.relationship("Member", backref="applications")
    member = db.relationship(
        "app.models.member.Member",
        backref=db.backref("applications", passive_deletes=True),
    )

    # ── ヘルパーメソッド ──────────────────────────────────────────

    def get_changes(self) -> dict:
        """changes_json を dict に変換して返す"""
        if not self.changes_json:
            return {}
        try:
            return json.loads(self.changes_json)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_changes(self, changes: dict) -> None:
        """dict を JSON 文字列に変換して changes_json にセットする"""
        self.changes_json = json.dumps(changes, ensure_ascii=False)

    def is_pending(self) -> bool:
        return self.app_status == 'pending'

    def is_approved(self) -> bool:
        return self.app_status == 'approved'

    def is_rejected(self) -> bool:
        return self.app_status == 'rejected'
