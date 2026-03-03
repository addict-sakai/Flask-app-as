from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.experience import Member
from datetime import datetime
# import uuid
import os
# import qrcode

experience_bp = Blueprint("experience", __name__)

# 🔵 体験申込書表示
@experience_bp.route("/apply_exp")
def apply_page_exp():
    return render_template("体験申込書.html")

# 🔵 体験申込書（英語）表示
@experience_bp.route("/apply_exp_e")
def apply_page_exp_e():
    return render_template("体験申込書_E.html")

# 🔵 保険案内ページ単体の表示（ポップアップ用）
@experience_bp.route("/insurance_guide")
def insurance_guide():
    return render_template("保険案内.html")

# 🔵 保険案内（Eng）ページ単体の表示（ポップアップ用）
@experience_bp.route("/insurance_guide_e")
def insurance_guide_e():
    return render_template("保険案内_E.html")

# 🔵 体験申込API
def _register_experience():

    zip_code = request.form.get("zip1", "") + request.form.get("zip2", "")

    application_date = request.form.get("application_date")
    apl_date = datetime.strptime(application_date, "%Y-%m-%d").date() if application_date else None

    birthday = request.form.get("birthday")
    birthday_date = datetime.strptime(birthday, "%Y-%m-%d").date() if birthday else None

    agreement_date = request.form.get("agreement_date")
    agre_date = datetime.strptime(agreement_date, "%Y-%m-%d").date() if agreement_date else None

    # 🔵 保険同意フラグの処理
    # "1" なら True, それ以外（Noneや"0"）なら False
    is_agreed = request.form.get("insurance_agreement") == "1"

    # 🔵 UUIDを生成
    # new_uuid = str(uuid.uuid4())

    experience = Member(
        application_date=apl_date,                              # 申込日
        full_name=request.form.get("full_name"),                # 氏名
        furigana=request.form.get("furigana"),                  # ふりがな
        gender=request.form.get("gender"),                      # 性別
        blood_type=request.form.get("blood_type"),              # 血液型
        birthday=birthday_date,                                 # 生年月日
        weight=request.form.get("weight"),                      # 体重
        zip_code=zip_code,                                      # 郵便番号
        address=request.form.get("address"),                    # 住所
        mobile_phone=request.form.get("mobile_phone"),          # 携帯番号
        home_phone=request.form.get("home_phone"),              # 自宅電話
        company_name=request.form.get("company_name"),          # 勤務先
        company_phone=request.form.get("company_phone"),        # 勤務先電話番号
        emergency_name=request.form.get("emergency_name"),      # 緊急連絡先氏名
        emergency_phone=request.form.get("emergency_phone"),    # 緊急連絡先番号
        email=request.form.get("email"),                        # メールアドレス
        medical_history=request.form.get("medical_history"),    # 傷病履歴
        relationship=request.form.get("relationship"),          # 本人との続柄

        course_exp=request.form.get("course_exp"),              # コース選択
        school_find=request.form.get("school_find"),            # スクール選択
        school_text=request.form.get("school_text"),            # スクール理由

        agreement_date=agre_date,                               # 確認日
        signature_name=request.form.get("signature_name"),      # 本人署名
        guardian_name=request.form.get("guardian_name"),        # 保護者名

        insurance_agreement=is_agreed,                          # 保険同意
    )

    try:
        db.session.add(experience)
        db.session.commit() #
        return jsonify({"status": "ok"})
    except Exception as e:
        db.session.rollback() #
        return jsonify({"status": "error", "message": str(e)}), 500
    
    # QR生成
    # folder = "app/static/qrcodes"
    # os.makedirs(folder, exist_ok=True)

    # img = qrcode.make(member.uuid)
    # img.save(f"{folder}/{member.uuid}.png")


# ✅ 体験申込
@experience_bp.route("/api/apply_exp", methods=["POST"])
def apply_experience():
    return _register_experience()

# ✅ 体験申込（英語）
@experience_bp.route("/api/apply_exp_e", methods=["POST"])
def apply_experience_e():
    return _register_experience()
