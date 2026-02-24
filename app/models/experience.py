# import uuid
from app.db import db

class Member(db.Model):
    __tablename__ = "experience"

    id = db.Column(db.Integer, primary_key=True)
    # uuid = db.Column(db.String(36), default=lambda: str(uuid.uuid4()), unique=True)

    application_date = db.Column(db.Date)       # 申込日
    full_name = db.Column(db.String(100), nullable=False)       # 氏名
    furigana = db.Column(db.String(100))        # ふりがな
    gender = db.Column(db.String(10))           # 性別
    blood_type = db.Column(db.String(10))       # 血液型
    birthday = db.Column(db.Date)               # 生年月日
    weight = db.Column(db.String(10))           # 体重
    zip_code = db.Column(db.String(10))         # 郵便番号
    address = db.Column(db.String(255))         # 住所
    mobile_phone = db.Column(db.String(20))     # 携帯番号
    home_phone = db.Column(db.String(20))       # 自宅番号
    company_name = db.Column(db.String(100))    # 勤務先
    company_phone = db.Column(db.String(20))    # 勤務先電話番号
    emergency_name = db.Column(db.String(100))  # 緊急連絡先氏名
    emergency_phone = db.Column(db.String(20))  # 緊急連絡先番号
    email = db.Column(db.String(255))           # メールアドレス
    medical_history = db.Column(db.Text)        # 傷病履歴
    relationship = db.Column(db.String(10))     # 本人との続柄

    course_exp = db.Column(db.String(20))       # コース選択
    school_find = db.Column(db.String(50))      # スクール選択
    school_text = db.Column(db.String(100))     # スクール理由

    agreement_date = db.Column(db.Date)         # 確認日
    signature_name = db.Column(db.String(100), nullable=False)  # 本人署名
    guardian_name = db.Column(db.String(100))   # 保護者氏名
    insurance_agreement = db.Column(db.Boolean, default=False, nullable=False)   # 保険同意
