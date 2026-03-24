"""
app/models/member.py
members テーブル SQLAlchemy モデル
DB構成V5 対応（2026-03-23）

members テーブルは個人の基本情報・ステータスのみを保持する。
連絡先    → member_contacts
フライヤー → member_flyers
コース履歴 → member_courses
変更申請  → member_applications
"""
import uuid
from app.db import db
from datetime import datetime


class Member(db.Model):
    __tablename__ = "members"

    # ── 識別情報 ──────────────────────────────────────────────────
    id            = db.Column(db.Integer, primary_key=True)                       # 1
    uuid          = db.Column(
                        db.String(36),
                        default=lambda: str(uuid.uuid4()),
                        unique=True,
                        nullable=False,
                    )                                                              # UUID（QRコード用）
    member_number = db.Column(db.Text, nullable=False, unique=True)               # 会員番号

    # ── 基本個人情報 ──────────────────────────────────────────────
    full_name     = db.Column(db.Text)                                            # 氏名
    furigana      = db.Column(db.Text)                                            # ふりがな
    gender        = db.Column(db.Text)                                            # 性別
    blood_type    = db.Column(db.Text)                                            # 血液型
    birthday      = db.Column(db.Date)                                            # 生年月日
    weight        = db.Column(db.Text)                                            # 体重

    # ── 家族・続柄 ────────────────────────────────────────────────
    guardian_name = db.Column(db.Text)                                            # 保護者氏名
    relationship  = db.Column(db.Text)                                            # 本人との続柄

    # ── 申込・誓約 ────────────────────────────────────────────────
    application_date = db.Column(db.Date)                                         # 申込日
    agreement_date   = db.Column(db.Date)                                         # 誓約確認日
    signature_name   = db.Column(db.Text)                                         # 本人署名

    # ── 入校情報 ──────────────────────────────────────────────────
    course_find   = db.Column(db.Text)                                            # スクール選択理由
    member_class  = db.Column(db.Text)                                            # 会員クラス

    # ── ステータス・フラグ ────────────────────────────────────────
    member_status = db.Column(
                        db.String(20),
                        nullable=False,
                        default='pending',
                    )                                                              # 会員ステータス
    # 値:
    #   'pending' : 新規申込受付中（入金確認待ち）
    #   'active'  : 有効
    #   'visitor' : 期限切れ自動変更（APScheduler）

    confirmed_at      = db.Column(db.Date)                                        # 入金確認日（開始日）
    contract          = db.Column(db.Boolean, nullable=False, default=False)      # 請負判定
    payment_confirmed = db.Column(db.Boolean, nullable=False, default=False)      # 入金確認フラグ
    from_experience   = db.Column(db.Boolean, nullable=False, default=False)      # 体験から入校
    exp_resv_no       = db.Column(db.String(20))                                  # 体験予約番号

    # ── タイムスタンプ ────────────────────────────────────────────
    created_at    = db.Column(db.DateTime)
    updated_at    = db.Column(db.DateTime, onupdate=db.func.now())
