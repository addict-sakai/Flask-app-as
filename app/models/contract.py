from app.db import db
from datetime import date
import uuid as _uuid


class Contract(db.Model):
    __tablename__ = "rep_contract"

    id                 = db.Column(db.Integer, primary_key=True)
    flight_date        = db.Column(db.Date)                        # フライト日
    uuid               = db.Column(db.String(36), default=lambda: str(_uuid.uuid4()))
    name               = db.Column(db.String(100))                 # 氏名（member.full_name からコピー）
    daily_flight       = db.Column(db.Integer)                     # フライト本数
    takeoff_location   = db.Column(db.Text)                        # 場所
    used_glider        = db.Column(db.Text)                        # 使用機体
    size               = db.Column(db.Text)                        # サイズ
    pilot_harness      = db.Column(db.Text)                        # パイロットハーネス
    repack_date        = db.Column(db.Date)                        # リパック期限
    passenger_harness  = db.Column(db.Text)                        # パッセンジャーハーネス（DBのスペルに合わせる）
    near_miss          = db.Column(db.Text)                        # ヒヤリハット
    improvement        = db.Column(db.Text)                        # 改善点
    damaged_section    = db.Column(db.Text)                        # 破損部分
    total_amount       = db.Column(db.Numeric(12,2), nullable=False, default=0)  # 合計金額
    mini_guarantee     = db.Column(db.Boolean, nullable=False, default=False)    # 最低保証判定
