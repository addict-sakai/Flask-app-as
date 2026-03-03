import uuid
from app.db import db

class Member(db.Model):
    __tablename__ = "members"

    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String(36), default=lambda: str(uuid.uuid4()), unique=True)

    member_type = db.Column(db.String(20))     # 分類

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
    member_number = db.Column(db.String(10), nullable=False, unique=True)  # 会員番号
    # member_number = db.Column(db.String(10))    # 会員番号
    medical_history = db.Column(db.Text)        # 傷病履歴
    relationship = db.Column(db.String(10))     # 本人との続柄

    course_type = db.Column(db.String(20))      # コースタイプ
    course_name = db.Column(db.String(20))      # スクールコース名
    course_fee = db.Column(db.String(20))       # コース料金
    glider_name = db.Column(db.String(50) )     # 使用機体
    glider_color = db.Column(db.String(50) )    # 機体カラー

    agreement_date = db.Column(db.Date)         # 確認日
    signature_name = db.Column(db.String(100), nullable=False)  # 本人署名
    guardian_name = db.Column(db.String(100))   # 保護者氏名

    course_find = db.Column(db.String(255))     # 選択理由
    leader = db.Column(db.String(100))          # 引率者名
    home_area = db.Column(db.String(50))        # ホームエリア
    visitor_fee = db.Column(db.String(20))      # ビジター料金
    experience = db.Column(db.String(10))       # フライト経験

    reg_no = db.Column(db.String(20))           # フライヤー登録番号
    reglimit_date = db.Column(db.Date)          # 登録期限
    license = db.Column(db.String(20))          # 技能証
    repack_date = db.Column(db.Date)            # リパック日

    contract = db.Column(db.Boolean, default=False, nullable=False)   # 請負判定

