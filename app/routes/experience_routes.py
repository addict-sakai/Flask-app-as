# experience_routes.py
# 改定4 2026/04/14
# 体験申込 resv_no 受け取り追加

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.experience import Member
from datetime import datetime
# import uuid
import os
# import qrcode

experience_bp = Blueprint("experience", __name__)

# 🔵 体験言語選択ページ
@experience_bp.route("/apply_exp_select")
def apply_page_exp_select():
    return render_template("体験選択.html")

# 🔵 体験申込書表示
@experience_bp.route("/apply_exp")
def apply_page_exp():
    return render_template("体験申込書.html")

# 🔵 体験申込書（英語）表示
@experience_bp.route("/apply_exp_e")
def apply_page_exp_e():
    return render_template("体験申込書_e.html")

# 🔵 保険案内ページ単体の表示（ポップアップ用）
@experience_bp.route("/insurance_guide")
def insurance_guide():
    return render_template("保険案内.html")

# 🔵 保険案内（Eng）ページ単体の表示（ポップアップ用）
@experience_bp.route("/insurance_guide_e")
def insurance_guide_e():
    return render_template("保険案内_E.html")


# ── ユーティリティ ────────────────────────────────────────────────
def _parse_bool(val):
    """フォームのbool値 ('true'/'false'/'yes'/'no') を Boolean に変換。未入力はNone。"""
    if val is None or val == "":
        return None
    return val.lower() in ("true", "yes", "1")


# 🔵 体験申込API（日本語・英語共通内部処理）
def _register_experience():

    zip_code = request.form.get("zip1", "") + request.form.get("zip2", "")

    application_date = request.form.get("application_date")
    apl_date = datetime.strptime(application_date, "%Y-%m-%d").date() if application_date else None

    birthday = request.form.get("birthday")
    birthday_date = datetime.strptime(birthday, "%Y-%m-%d").date() if birthday else None

    # 確認日：JS側から agreement_date_iso（YYYY-MM-DD）を優先使用
    agreement_date = request.form.get("agreement_date_iso") or request.form.get("agreement_date")
    try:
        agre_date = datetime.strptime(agreement_date, "%Y-%m-%d").date() if agreement_date else None
    except ValueError:
        agre_date = None

    # 保険同意フラグ：保険案内廃止のため False 固定
    is_agreed = False

    # 予約番号：空文字は None に変換
    resv_no_raw = (request.form.get("resv_no") or "").strip()
    resv_no_val = resv_no_raw if resv_no_raw else None

    experience = Member(
        application_date=apl_date,                              # 申込日
        full_name=request.form.get("full_name"),                # 氏名
        furigana=request.form.get("furigana"),                  # ふりがな
        gender=request.form.get("gender"),                      # 性別
        blood_type=request.form.get("blood_type"),              # 血液型
        birthday=birthday_date,                                 # 生年月日
        height=request.form.get("height"),                      # 身長
        weight=request.form.get("weight"),                      # 体重
        zip_code=zip_code,                                      # 郵便番号
        address=request.form.get("address"),                    # 住所
        country=request.form.get("country"),                    # 国
        mobile_phone=request.form.get("mobile_phone"),          # 携帯番号
        home_phone=request.form.get("home_phone"),              # 自宅電話
        company_name=request.form.get("company_name"),          # 勤務先
        company_phone=request.form.get("company_phone"),        # 勤務先電話番号
        email=request.form.get("email"),                        # メールアドレス
        medical_history=request.form.get("medical_history"),    # 傷病履歴
        relationship=request.form.get("relationship"),          # 本人との続柄

        book_source=request.form.get("book_source"),            # 予約元

        course_exp=request.form.get("course_exp"),              # コース選択
        school_find=request.form.get("school_find"),            # スクール選択
        school_text=request.form.get("school_text"),            # スクール理由

        # Basic Information
        first_time_para=_parse_bool(request.form.get("first_time_para")),
        language=request.form.get("language"),
        other_language=request.form.get("other_language"),

        # Health Declaration
        condtion=_parse_bool(request.form.get("condtion")),
        memo_condtion=request.form.get("memo_condtion"),
        physical=_parse_bool(request.form.get("physical")),
        memo_physical=request.form.get("memo_physical"),
        treatment=_parse_bool(request.form.get("treatment")),
        memo_treatment=request.form.get("memo_treatment"),
        pregnant=_parse_bool(request.form.get("pregnant")),

        # Consent
        media=_parse_bool(request.form.get("media")),

        agreement_date=agre_date,                               # 確認日
        signature_name=request.form.get("signature_name"),      # 本人署名
        guardian_name=request.form.get("guardian_name"),        # 保護者名

        insurance_agreement=is_agreed,                          # 保険同意

        resv_no=resv_no_val,                                    # 予約番号リンク（追加）
    )

    try:
        db.session.add(experience)
        db.session.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


# ✅ 体験申込
@experience_bp.route("/api/apply_exp", methods=["POST"])
def apply_experience():
    return _register_experience()

# ✅ 体験申込（英語）
@experience_bp.route("/api/apply_exp_e", methods=["POST"])
def apply_experience_e():
    return _register_experience()

# ✅ 体験申込の氏名検索API（Aコース申込「体験から入校」用）
@experience_bp.route("/api/experience/search_by_name")
def search_experience_by_name():
    """
    クエリパラメータ name で experience テーブルを氏名検索し、
    一致したレコードの resv_no を返す。
    完全一致優先、なければ前方一致。
    """
    from sqlalchemy import text
    name = request.args.get("name", "").strip()
    if not name:
        return jsonify({"results": []})
    try:
        rows = db.session.execute(text("""
            SELECT full_name, resv_no
            FROM experience
            WHERE full_name = :name
              AND resv_no IS NOT NULL
            ORDER BY application_date DESC
            LIMIT 10
        """), {"name": name}).fetchall()

        if not rows:
            rows = db.session.execute(text("""
                SELECT full_name, resv_no
                FROM experience
                WHERE full_name LIKE :name
                  AND resv_no IS NOT NULL
                ORDER BY application_date DESC
                LIMIT 10
            """), {"name": name + "%"}).fetchall()

        results = [{"full_name": r.full_name, "resv_no": r.resv_no} for r in rows]
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"results": [], "error": str(e)}), 500


# 🔵 体験コース選択肢取得API（configデータから動的取得）
@experience_bp.route("/api/exp_course_options")
def get_exp_course_options():
    """
    config_master の category='体験' かつ value_type='options' の項目から
    item_name に「コース」を含むレコードの config_values を返す。
    該当が複数あれば最初の1件を使用。
    """
    from sqlalchemy import text
    try:
        master = db.session.execute(text("""
            SELECT id, item_name, unit
            FROM config_master
            WHERE category = '体験'
              AND value_type = 'options'
              AND item_name LIKE '%コース%'
              AND is_active = true
            ORDER BY sort_order, id
            LIMIT 1
        """)).fetchone()

        if not master:
            return jsonify({"options": []})

        values = db.session.execute(text("""
            SELECT id, value, label, sort_order
            FROM config_values
            WHERE master_id = :mid
              AND is_active = true
            ORDER BY sort_order, id
        """), {"mid": master.id}).fetchall()

        options = [
            {
                "value": str(v.id),
                "label": v.label if v.label else v.value,
                "price": v.value
            }
            for v in values
        ]

        return jsonify({
            "item_name": master.item_name,
            "unit": master.unit,
            "options": options
        })

    except Exception as e:
        return jsonify({"options": [], "error": str(e)}), 500
