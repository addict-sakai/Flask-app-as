"""
app/models/member_contact.py
member_contacts テーブル SQLAlchemy モデル
新規追加（2026-03-23）

用途:
    会員の連絡先情報を members テーブルから分離して管理する。
    更新頻度が高い情報（住所・電話・メール等）を独立させることで
    members テーブルの肥大化を防ぐ。

取得方法:
    member = Member.query.get(member_id)
    contact = member.contact  # backref 経由

    または直接:
    contact = MemberContact.query.filter_by(member_id=member_id).first()

新規作成:
    contact = MemberContact(member_id=member.id, mobile_phone="090-...")
    db.session.add(contact)
"""
from app.db import db
from datetime import datetime


class MemberContact(db.Model):
    __tablename__ = "member_contacts"

    id              = db.Column(db.Integer, primary_key=True)                    # 1

    member_id       = db.Column(
                          db.Integer,
                          db.ForeignKey("members.id", ondelete="CASCADE"),
                          nullable=False,
                          unique=True,        # 1会員につき1レコード
                          index=True,
                      )                                                           # 2

    # ── 住所 ──────────────────────────────────────────────────────
    zip_code        = db.Column(db.Text)                                         # 3
    address         = db.Column(db.Text)                                         # 4

    # ── 電話・メール ──────────────────────────────────────────────
    mobile_phone    = db.Column(db.Text)                                         # 5
    home_phone      = db.Column(db.Text)                                         # 6
    email           = db.Column(db.Text)                                         # 7

    # ── 勤務先 ────────────────────────────────────────────────────
    company_name    = db.Column(db.Text)                                         # 8
    company_phone   = db.Column(db.Text)                                         # 9

    # ── 緊急連絡先 ────────────────────────────────────────────────
    emergency_name  = db.Column(db.Text)                                         # 10
    emergency_phone = db.Column(db.Text)                                         # 11

    # ── 傷病履歴（緊急連絡先と同時に更新されることが多い） ────────
    medical_history = db.Column(db.Text)                                         # 12

    # ── タイムスタンプ ────────────────────────────────────────────
    updated_at      = db.Column(
                          db.DateTime,
                          onupdate=datetime.utcnow,
                      )                                                           # 13

    # ── リレーション ──────────────────────────────────────────────
    member = db.relationship(
                 "app.models.member.Member",
                #  backref=db.backref("contact", uselist=False),
                 backref=db.backref("contact", uselist=False, passive_deletes=True),
             )

    # ── ヘルパーメソッド ──────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "id":               self.id,
            "member_id":        self.member_id,
            "zip_code":         self.zip_code,
            "address":          self.address,
            "mobile_phone":     self.mobile_phone,
            "home_phone":       self.home_phone,
            "email":            self.email,
            "company_name":     self.company_name,
            "company_phone":    self.company_phone,
            "emergency_name":   self.emergency_name,
            "emergency_phone":  self.emergency_phone,
            "medical_history":  self.medical_history,
            "updated_at":       self.updated_at.strftime("%Y-%m-%d %H:%M")
                                if self.updated_at else None,
        }

    def apply_dict(self, data: dict) -> None:
        """dict からフィールドを一括セット"""
        fields = [
            "zip_code", "address", "mobile_phone", "home_phone", "email",
            "company_name", "company_phone",
            "emergency_name", "emergency_phone", "medical_history",
        ]
        for f in fields:
            if f in data:
                setattr(self, f, data[f] or None)
        self.updated_at = datetime.utcnow()

    @classmethod
    def get_or_create(cls, member_id: int) -> "MemberContact":
        """member_id に対応するレコードを取得、なければ新規作成"""
        obj = cls.query.filter_by(member_id=member_id).first()
        if not obj:
            obj = cls(member_id=member_id)
            db.session.add(obj)
        return obj
