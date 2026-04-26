"""
app/models/tour_booking.py
ツアー申込 テーブル SQLAlchemy モデル
新規追加（2026-04-11）
改定４（2026-04-12）: tour_bookings に contact_email カラム追加

テーブル構成:
  tour_bookings      : ツアー申込ヘッダー（スクール/エリア名・フライト期間・受付料）
  tour_leaders       : 引率者（1申込に複数）
  tour_participants  : 参加者（1申込に複数）

各 leader / participant は members.member_number で紐づけ。
未登録者（新規当日発行）は member_number=NULL で氏名・電話番号のみ保存。
"""

from app.db import db
from datetime import datetime


class TourBooking(db.Model):
    """ツアー申込ヘッダー"""
    __tablename__ = "tour_bookings"

    id              = db.Column(db.Integer, primary_key=True)                    # 1
    booking_no      = db.Column(db.Text, nullable=False, unique=True)            # 2 申込番号（TB-YYYYMMDD-NNNN）
    school_name     = db.Column(db.Text, nullable=False)                         # 3 スクール/エリア名
    contact_email   = db.Column(db.Text)                                         # 4 連絡先メールアドレス（★追加）
    flight_date_from = db.Column(db.Date, nullable=False)                        # 5 フライト開始日
    flight_date_to   = db.Column(db.Date, nullable=False)                        # 6 フライト終了日
    flight_days      = db.Column(db.Integer, nullable=False, default=1)          # 7 日数
    visitor_fee_unit = db.Column(db.Integer, nullable=False, default=0)          # 8 ビジターフライト料（単価）
    total_fee        = db.Column(db.Integer, nullable=False, default=0)          # 9 受付料合計
    notes            = db.Column(db.Text)                                        # 10 備考
    app_status       = db.Column(
                           db.String(20),
                           nullable=False,
                           default='pending',
                       )                                                          # 11 pending / confirmed / cancelled

    created_at  = db.Column(db.DateTime, default=datetime.utcnow)                # 12
    updated_at  = db.Column(db.DateTime, onupdate=datetime.utcnow)               # 13

    # ── リレーション ──────────────────────────────────────────────
    leaders      = db.relationship(
                       "TourLeader",
                       backref=db.backref("booking", passive_deletes=True),
                       cascade="all, delete-orphan",
                       lazy="select",
                   )
    participants = db.relationship(
                       "TourParticipant",
                       backref=db.backref("booking", passive_deletes=True),
                       cascade="all, delete-orphan",
                       lazy="select",
                   )

    def to_dict(self) -> dict:
        def fd(d): return d.isoformat() if d else None
        return {
            "id":               self.id,
            "booking_no":       self.booking_no,
            "school_name":      self.school_name,
            "contact_email":    self.contact_email,
            "flight_date_from": fd(self.flight_date_from),
            "flight_date_to":   fd(self.flight_date_to),
            "flight_days":      self.flight_days,
            "visitor_fee_unit": self.visitor_fee_unit,
            "total_fee":        self.total_fee,
            "notes":            self.notes,
            "app_status":       self.app_status,
            "created_at":       self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
            "leaders":      [l.to_dict() for l in self.leaders],
            "participants": [p.to_dict() for p in self.participants],
        }


class TourLeader(db.Model):
    """引率者（代表者含む複数可）"""
    __tablename__ = "tour_leaders"

    id             = db.Column(db.Integer, primary_key=True)                     # 1
    booking_id     = db.Column(
                         db.Integer,
                         db.ForeignKey("tour_bookings.id", ondelete="CASCADE"),
                         nullable=False,
                         index=True,
                     )                                                            # 2
    sort_order     = db.Column(db.Integer, nullable=False, default=0)            # 3 表示順
    member_number  = db.Column(db.Text)                                          # 4 会員番号（NULL=未登録）
    full_name      = db.Column(db.Text, nullable=False)                          # 5 氏名
    phone          = db.Column(db.Text)                                          # 6 電話番号
    license        = db.Column(db.Text)                                          # 7 技能証
    reg_no         = db.Column(db.Text)                                          # 8 フライヤー登録番号
    instructor_role = db.Column(db.Text)                                         # 9 教員区分（一般/教員/助教員）
    member_type     = db.Column(db.Text)                                         # 10 分類（年会員/スクール/ビジター等）

    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "booking_id":      self.booking_id,
            "sort_order":      self.sort_order,
            "member_number":   self.member_number,
            "full_name":       self.full_name,
            "phone":           self.phone,
            "license":         self.license,
            "reg_no":          self.reg_no,
            "instructor_role": self.instructor_role,
            "member_type":     self.member_type,
        }


class TourParticipant(db.Model):
    """参加者"""
    __tablename__ = "tour_participants"

    id             = db.Column(db.Integer, primary_key=True)                     # 1
    booking_id     = db.Column(
                         db.Integer,
                         db.ForeignKey("tour_bookings.id", ondelete="CASCADE"),
                         nullable=False,
                         index=True,
                     )                                                            # 2
    sort_order     = db.Column(db.Integer, nullable=False, default=0)            # 3 表示順
    member_number  = db.Column(db.Text)                                          # 4 会員番号（NULL=未登録）
    full_name      = db.Column(db.Text, nullable=False)                          # 5 氏名
    phone          = db.Column(db.Text)                                          # 6 電話番号
    license        = db.Column(db.Text)                                          # 7 技能証
    reg_no         = db.Column(db.Text)                                          # 8 フライヤー登録番号
    member_type    = db.Column(db.Text)                                          # 9 分類（年会員/スクール/ビジター等）
    attend_days    = db.Column(db.Text)                                          # 10 参加日（手動入力テキスト）

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "booking_id":   self.booking_id,
            "sort_order":   self.sort_order,
            "member_number": self.member_number,
            "full_name":    self.full_name,
            "phone":        self.phone,
            "license":      self.license,
            "reg_no":       self.reg_no,
            "member_type":  self.member_type,
            "attend_days":  self.attend_days,
        }
