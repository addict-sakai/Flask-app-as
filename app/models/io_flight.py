from app.db import db
from datetime import date
from sqlalchemy.dialects.postgresql import UUID

class IoFlight(db.Model):
    __tablename__ = "io_flight"

    id             = db.Column(db.Integer, primary_key=True)
    member_number  = db.Column(db.String(20))
    uuid = db.Column(UUID(as_uuid=True))
    member_class   = db.Column(db.String(20))
    full_name      = db.Column(db.String(100))
    course_name    = db.Column(db.String(50))
    reg_no         = db.Column(db.String(20))
    reglimit_date  = db.Column(db.Date)
    license        = db.Column(db.String(20))
    glider_name    = db.Column(db.String(50))
    glider_color   = db.Column(db.String(50))
    repack_date    = db.Column(db.Date)          # リパック期限（登録日+1年）
    insurance_type = db.Column(db.String(20))    # 1日 / 年間 / 個人
    radio_type     = db.Column(db.String(50))
    entry_date     = db.Column(db.Date, default=date.today, nullable=False)
    in_time        = db.Column(db.DateTime)
    out_time       = db.Column(db.DateTime)
