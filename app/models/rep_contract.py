from ..db import db

class RepContract(db.Model):
    __tablename__ = 'rep_contract'

    id = db.Column(db.Integer, primary_key=True)
    flight_date = db.Column(db.Date, nullable=False)
    uuid = db.Column(db.String(50), nullable=False)
    name = db.Column(db.String(100))
    daily_flight = db.Column(db.Integer)
    takeoff_location = db.Column(db.String(100))
    used_glider = db.Column(db.String(100))
    size = db.Column(db.String(20))
    pilot_harness = db.Column(db.String(100))
    repack_date = db.Column(db.Date)
    passenger_harness = db.Column(db.String(100))
    near_miss = db.Column(db.Text)
    improvement = db.Column(db.Text)
    damaged_section = db.Column(db.Text)
    total_amount = db.Column(db.Numeric(12,2), nullable=False, default=0)  # 合計金額
    mini_guarantee = db.Column(db.Boolean, nullable=False, default=False)    # 最低保証判定

    # 重複を防ぐための制約（同じUUIDが同じ日に2回登録できないようにする）
    __table_args__ = (
        db.UniqueConstraint('uuid', 'flight_date', name='uq_rep_contract_uuid_date'),
    )

    def __repr__(self):
        return f'<RepContract {self.name} {self.flight_date}>'