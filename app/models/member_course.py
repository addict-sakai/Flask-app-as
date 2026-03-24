"""
app/models/member_course.py
member_courses テーブル SQLAlchemy モデル
新規追加（2026-03-23）

用途:
    会員のコース情報を履歴として管理する。
    members テーブルから member_type / course_name / course_fee を分離。

「現在有効なコース」の取得:
    MemberCourse.query.filter_by(
        member_id=member_id,
        status='active',
        end_date=None,
    ).first()

「コース履歴」の取得:
    MemberCourse.query.filter_by(member_id=member_id)
        .order_by(MemberCourse.start_date.desc()).all()

status の値:
    'active'    : 現在有効
    'expired'   : 期限切れ（次のコース開始または reglimit_date 超過）
    'cancelled' : キャンセル・却下

member_type の値:
    '年会員' / '冬季会員' / 'スクール' / 'ビジター'

course_name の値（member_type が冬季会員 / スクールの場合のみ）:
    冬季会員: 'ALL'（12/1〜4/30） / '1'〜'4'（月入会）
    スクール: 'B' / 'NP' / 'P' / 'XC' / 'T'
"""
from app.db import db
from datetime import datetime, date


class MemberCourse(db.Model):
    __tablename__ = "member_courses"

    # ── カラム定義 ────────────────────────────────────────────────

    id             = db.Column(db.Integer, primary_key=True)                     # 1  PK

    member_id      = db.Column(
                         db.Integer,
                         db.ForeignKey("members.id", ondelete="CASCADE"),
                         nullable=False,
                         index=True,
                     )                                                            # 2  対象会員

    member_type    = db.Column(db.Text, nullable=False)                          # 3  コース種別
    course_name    = db.Column(db.Text)                                          # 4  コース内容
    course_fee     = db.Column(db.Text)                                          # 5  コース料金（表示用）

    start_date     = db.Column(db.Date, nullable=False)                          # 6  開始日（confirmed_at）
    end_date       = db.Column(db.Date)                                          # 7  終了日（NULL=現在有効）

    status         = db.Column(
                         db.String(20),
                         nullable=False,
                         default='active',
                     )                                                            # 8  ステータス

    confirmed_by   = db.Column(db.Text)                                          # 9  承認スタッフ

    application_id = db.Column(
                         db.Integer,
                         db.ForeignKey(
                             "member_applications.id",
                             ondelete="SET NULL",
                         ),
                     )                                                            # 10 元申請ID

    created_at     = db.Column(
                         db.DateTime,
                         nullable=False,
                         default=datetime.utcnow,
                     )                                                            # 11

    updated_at     = db.Column(
                         db.DateTime,
                         onupdate=datetime.utcnow,
                     )                                                            # 12

    # ── リレーション ──────────────────────────────────────────────
    member      = db.relationship(
                      "app.models.member.Member",
                    #  backref=db.backref("courses", lazy="dynamic"),
                      backref=db.backref("courses", lazy="dynamic", passive_deletes=True),
                  )
    application = db.relationship(
                      "app.models.member_application.MemberApplication",
                      backref=db.backref("course_record", uselist=False),
                  )

    # ── プロパティ ────────────────────────────────────────────────

    @property
    def is_active(self) -> bool:
        return self.status == 'active' and self.end_date is None

    @property
    def display_name(self) -> str:
        """表示用コース名（コース内容があれば付記）"""
        if self.course_name:
            return f"{self.member_type}（{self.course_name}）"
        return self.member_type or "—"

    # ── ヘルパーメソッド ──────────────────────────────────────────

    def to_dict(self) -> dict:
        """JSON シリアライズ可能な dict に変換"""
        def fd(d):
            return d.isoformat() if d else None

        return {
            "id":             self.id,
            "member_id":      self.member_id,
            "member_type":    self.member_type,
            "course_name":    self.course_name,
            "course_fee":     self.course_fee,
            "start_date":     fd(self.start_date),
            "end_date":       fd(self.end_date),
            "status":         self.status,
            "confirmed_by":   self.confirmed_by,
            "application_id": self.application_id,
            "display_name":   self.display_name,
            "is_active":      self.is_active,
            "created_at":     self.created_at.strftime("%Y-%m-%d %H:%M")
                              if self.created_at else None,
        }

    def expire(self, end_date: date = None) -> None:
        """このコースを終了させる（次のコース開始時に呼ぶ）"""
        self.end_date  = end_date or date.today()
        self.status    = 'expired'
        self.updated_at = datetime.utcnow()

    @classmethod
    def get_current(cls, member_id: int) -> "MemberCourse | None":
        """指定会員の現在有効なコースを1件返す"""
        return cls.query.filter_by(
            member_id=member_id,
            status='active',
            end_date=None,
        ).order_by(cls.start_date.desc()).first()

    @classmethod
    def get_history(cls, member_id: int) -> list:
        """指定会員のコース履歴を start_date 降順で返す"""
        return cls.query.filter_by(
            member_id=member_id,
        ).order_by(cls.start_date.desc()).all()
