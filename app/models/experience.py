# experience.py
# 改定2 2026/04/09
# 英語版申込書対応：新カラム追加
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
    height = db.Column(db.String(10))           # 身長 (英語版追加)
    weight = db.Column(db.String(10))           # 体重
    zip_code = db.Column(db.String(10))         # 郵便番号
    address = db.Column(db.String(255))         # 住所
    country = db.Column(db.String(100))         # 国（英語版追加）
    mobile_phone = db.Column(db.String(20))     # 携帯番号
    home_phone = db.Column(db.String(20))       # 自宅番号
    company_name = db.Column(db.String(100))    # 勤務先
    company_phone = db.Column(db.String(20))    # 勤務先電話番号
    email = db.Column(db.String(255))           # メールアドレス
    emergency_name = db.Column(db.String(100))  # 緊急連絡先氏名
    emergency_phone = db.Column(db.String(20))  # 緊急連絡先番号
    relationship = db.Column(db.String(10))     # 本人との続柄
    medical_history = db.Column(db.Text)        # 傷病履歴

    book_source = db.Column(db.String(255))     # 予約元（英語版追加）

    course_exp = db.Column(db.String(20))       # コース選択
    school_find = db.Column(db.String(50))      # スクール選択
    school_text = db.Column(db.String(100))     # スクール理由

    # Basic Information（英語版追加）
    first_time_para = db.Column(db.Boolean)     # 初めてのパラグライダー
    language = db.Column(db.String(20))         # 希望言語
    other_language = db.Column(db.String(100))  # 希望言語（その他）

    # Health Declaration（英語版追加）
    condtion = db.Column(db.Boolean)            # 持病の有無
    memo_condtion = db.Column(db.Text)          # 持病詳細
    physical = db.Column(db.Boolean)            # 怪我・身体制限の有無
    memo_physical = db.Column(db.Text)          # 怪我・身体制限詳細
    treatment = db.Column(db.Boolean)           # 治療中の有無
    memo_treatment = db.Column(db.Text)         # 治療中詳細
    pregnant = db.Column(db.Boolean)            # 妊娠の有無

    # Consent（英語版追加）
    media = db.Column(db.Boolean)               # 写真・動画使用同意

    agreement_date = db.Column(db.Date)         # 確認日
    signature_name = db.Column(db.String(100), nullable=False)  # 本人署名
    guardian_name = db.Column(db.String(100))   # 保護者氏名
    insurance_agreement = db.Column(db.Boolean, default=False, nullable=False)   # 保険同意

    resv_no = db.Column(db.String(20))          # 体験予約番号リンク
