"""
app/models/member_flyer.py
member_flyers テーブル SQLAlchemy モデル
新規追加（2026-03-23）

用途:
    会員のフライヤー登録情報を members テーブルから分離して管理する。
    登録番号・期限・機体・技能証など、JHF/JPA に関わる情報を独立させる。

取得方法:
    member = Member.query.get(member_id)
    flyer = member.flyer  # backref 経由

    または直接:
    flyer = MemberFlyer.query.filter_by(member_id=member_id).first()

APScheduler との関係:
    next_reglimit_date は早期更新申請が承認された際にセットされる。
    毎日 00:05 に _daily_member_check() が reglimit_date と比較し、
    期限到来で reglimit_date に移行・next_reglimit_date をリセットする。
    期限切れの場合は member_courses に 'ビジター' レコードを追加する。
"""
from app.db import db
from datetime import datetime


class MemberFlyer(db.Model):
    __tablename__ = "member_flyers"

    id                  = db.Column(db.Integer, primary_key=True)                # 1

    member_id           = db.Column(
                              db.Integer,
                              db.ForeignKey("members.id", ondelete="CASCADE"),
                              nullable=False,
                              unique=True,        # 1会員につき1レコード
                              index=True,
                          )                                                       # 2

    # ── 所属団体・登録番号 ────────────────────────────────────────
    organization        = db.Column(db.String(10))                               # 3  JHF / JPA
    reg_no              = db.Column(db.Text)                                     # 4  登録番号

    # ── フライヤー登録期限 ────────────────────────────────────────
    reglimit_date       = db.Column(db.Date)                                     # 5  現在の期限
    next_reglimit_date  = db.Column(db.Date)                                     # 6  早期更新時の次回期限

    # ── 技能証・機体 ──────────────────────────────────────────────
    license             = db.Column(db.Text)                                     # 7  技能証（A/B/NP/P/XC）
    repack_date         = db.Column(db.Date)                                     # 8  リパック日
    glider_name         = db.Column(db.Text)                                     # 9  使用機体
    glider_color        = db.Column(db.Text)                                     # 10 機体カラー

    # ── フライト情報 ──────────────────────────────────────────────
    home_area           = db.Column(db.Text)                                     # 11 ホームエリア
    experience          = db.Column(db.Text)                                     # 12 フライト経験
    leader              = db.Column(db.Text)                                     # 13 引率者名（他校引率）
    visitor_fee         = db.Column(db.Text)                                     # 14 ビジター料金区分

    # ── タイムスタンプ ────────────────────────────────────────────
    updated_at          = db.Column(
                              db.DateTime,
                              onupdate=datetime.utcnow,
                          )                                                       # 15

    # ── リレーション ──────────────────────────────────────────────
    member = db.relationship(
                 "app.models.member.Member",
                # backref=db.backref("flyer", uselist=False),
                 backref=db.backref("flyer", uselist=False, passive_deletes=True),
             )

    # ── ヘルパーメソッド ──────────────────────────────────────────

    def to_dict(self) -> dict:
        def fd(d):
            return d.isoformat() if d else None
        return {
            "id":                   self.id,
            "member_id":            self.member_id,
            "organization":         self.organization,
            "reg_no":               self.reg_no,
            "reglimit_date":        fd(self.reglimit_date),
            "next_reglimit_date":   fd(self.next_reglimit_date),
            "license":              self.license,
            "repack_date":          fd(self.repack_date),
            "glider_name":          self.glider_name,
            "glider_color":         self.glider_color,
            "home_area":            self.home_area,
            "experience":           self.experience,
            "leader":               self.leader,
            "visitor_fee":          self.visitor_fee,
            "updated_at":           self.updated_at.strftime("%Y-%m-%d %H:%M")
                                    if self.updated_at else None,
        }

    def apply_dict(self, data: dict, parse_date_fn=None) -> None:
        """dict からフィールドを一括セット"""
        str_fields = [
            "organization", "reg_no", "license",
            "glider_name", "glider_color",
            "home_area", "experience", "leader", "visitor_fee",
        ]
        date_fields = ["reglimit_date", "repack_date"]

        for f in str_fields:
            if f in data:
                setattr(self, f, data[f] or None)

        if parse_date_fn:
            for f in date_fields:
                if f in data:
                    setattr(self, f, parse_date_fn(data.get(f)))

        # repack_date は YYYY-MM 形式も受け付ける
        if "repack_date" in data and parse_date_fn:
            val = data.get("repack_date") or ""
            if len(val) == 7:   # YYYY-MM
                self.repack_date = parse_date_fn(val + "-01")
            else:
                self.repack_date = parse_date_fn(val)

        self.updated_at = datetime.utcnow()

    @classmethod
    def get_or_create(cls, member_id: int) -> "MemberFlyer":
        """member_id に対応するレコードを取得、なければ新規作成"""
        obj = cls.query.filter_by(member_id=member_id).first()
        if not obj:
            obj = cls(member_id=member_id)
            db.session.add(obj)
        return obj
