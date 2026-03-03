from app.db import db
from datetime import datetime


class WorkContract(db.Model):
    __tablename__ = "work_contract"

    id         = db.Column(db.Integer, primary_key=True)
    uuid       = db.Column(db.String(36), nullable=False)        # member.uuid
    work_date  = db.Column(db.Date, nullable=False)              # 出勤可能日
    status     = db.Column(db.String(4), nullable=True)          # 'OK' / 'NG' / None
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    __table_args__ = (
        db.UniqueConstraint("uuid", "work_date", name="uq_work_contract_uuid_date"),
    )
