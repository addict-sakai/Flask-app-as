from flask import Blueprint, render_template, request, jsonify, abort
from app.db import db
from app.models.member import Member
from datetime import datetime, date, timedelta
import uuid
import os

member_bp = Blueprint("member", __name__)

# =========================================
# ページルート
# =========================================

# トップページ
@member_bp.route("/")
def index():
    return render_template("index.html")

# 申込書表示
@member_bp.route("/apply")
def apply_page():
    return render_template("会員申込書.html")

# Ａコース申込書表示
@member_bp.route("/apply_a")
def apply_page_a():
    return render_template("会員申込書_A.html")

# ビジター申込書表示
@member_bp.route("/apply_v")
def apply_page_v():
    return render_template("ビジター申込書.html")

# クラブ入会案内表示
@member_bp.route("/apply_club")
def apply_page_club():
    return render_template("クラブ入会案内.html")

# 会員管理画面表示
@member_bp.route("/apply_info")
def apply_page_cnt():
    return render_template("会員管理画面.html")

# 会員情報更新ページ
@member_bp.route("/apply_upd")
def apply_page_upd():
    return render_template("会員更新.html")

# =========================================
# ヘルパー
# =========================================

def _parse_date(value: str | None, fmt: str = "%Y-%m-%d") -> date | None:
    """文字列を date に変換（空文字・None は None を返す）"""
    if not value:
        return None
    try:
        return datetime.strptime(value, fmt).date()
    except ValueError:
        return None


def _member_to_dict(m: Member) -> dict:
    """Member を JSON シリアライズ可能な dict に変換"""
    def fd(d):
        return d.isoformat() if d else None

    return {
        "id":               m.id,
        "uuid":             m.uuid,
        "member_type":      m.member_type,
        "application_date": fd(m.application_date),
        "full_name":        m.full_name,
        "furigana":         m.furigana,
        "gender":           m.gender,
        "blood_type":       m.blood_type,
        "birthday":         fd(m.birthday),
        "weight":           m.weight,
        "zip_code":         m.zip_code,
        "address":          m.address,
        "mobile_phone":     m.mobile_phone,
        "home_phone":       m.home_phone,
        "company_name":     m.company_name,
        "company_phone":    m.company_phone,
        "emergency_name":   m.emergency_name,
        "emergency_phone":  m.emergency_phone,
        "email":            m.email,
        "member_number":    m.member_number,
        "medical_history":  m.medical_history,
        "relationship":     m.relationship,
        "course_type":      m.course_type,
        "course_name":      m.course_name,
        "course_fee":       m.course_fee,
        "glider_name":      m.glider_name,
        "glider_color":     m.glider_color,
        "agreement_date":   fd(m.agreement_date),
        "signature_name":   m.signature_name,
        "guardian_name":    m.guardian_name,
        "course_find":      m.course_find,
        "leader":           m.leader,
        "home_area":        m.home_area,
        "visitor_fee":      m.visitor_fee,
        "experience":       m.experience,
        "reg_no":           m.reg_no,
        "reglimit_date":    fd(m.reglimit_date),
        "license":          m.license,
        "repack_date":      fd(m.repack_date),
        "contract":         bool(m.contract) if m.contract is not None else False,
    }


def _apply_fields_from_json(member: Member, data: dict) -> None:
    """JSON リクエストのデータを Member に適用（管理画面用）"""
    str_fields = [
        "member_type", "full_name", "furigana", "gender", "blood_type",
        "weight", "zip_code", "address", "mobile_phone", "home_phone",
        "company_name", "company_phone", "emergency_name", "emergency_phone",
        "email", "member_number", "medical_history", "relationship",
        "course_type", "course_name", "course_fee", "glider_name",
        "glider_color", "signature_name", "guardian_name", "course_find",
        "leader", "home_area", "visitor_fee", "experience", "reg_no", "license",
    ]
    date_fields = [
        "application_date", "birthday", "agreement_date", "reglimit_date",
    ]
    boolean_fields = [
        "contract",
    ]

    for f in str_fields:
        if f in data:
            setattr(member, f, data[f] or None)

    for f in date_fields:
        if f in data:
            setattr(member, f, _parse_date(data.get(f)))

    for f in boolean_fields:
        if f in data:
            setattr(member, f, bool(data[f]))

    # repack_date は YYYY-MM 形式（1日固定）と YYYY-MM-DD 形式の両方を受け付ける
    if "repack_date" in data:
        val = data.get("repack_date") or ""
        if len(val) == 7:  # YYYY-MM
            member.repack_date = _parse_date(val + "-01")
        else:
            member.repack_date = _parse_date(val)


# =========================================
# 既存: フォーム申込API（form-data）
# =========================================

#def _generate_member_number() -> str:
#    """フォーム申込用：仮会員番号を自動採番（TMP-XXXXXXXX 形式）"""
#    while True:
#        candidate = "TMP-" + uuid.uuid4().hex[:8].upper()
#        if not Member.query.filter_by(member_number=candidate).first():
#            return candidate

#def _generate_member_number() -> str:
#    """フォーム申込用：仮会員番号を自動採番（TMP-0001 形式、シリアル番号）"""
#    existing = (
#        db.session.query(Member.member_number)
#        .filter(Member.member_number.like("TMP-%"))
#        .all()
#    )
#    max_num = 0
#    for (num_str,) in existing:
#        try:
#            n = int(num_str.replace("TMP-", ""))
#            if n > max_num:
#                max_num = n
#        except ValueError:
#            pass
#    return f"TMP-{max_num + 1:04d}"

def _generate_member_number() -> str:
    """フォーム申込用：仮会員番号を自動採番（数字のみ、0001形式）"""
    existing = (
        db.session.query(Member.member_number)
        .filter(Member.member_number.op("~")(r"^\d+$"))  # 数字のみの番号を対象
        .all()
    )
    max_num = 0
    for (num_str,) in existing:
        try:
            n = int(num_str)
            if n > max_num:
                max_num = n
        except ValueError:
            pass
    return f"{max_num + 1:04d}"

def _register_member():
    zip_code = request.form.get("zip1", "") + request.form.get("zip2", "")

    repack_date = request.form.get("repack_date")
    repack_shortdate = (
        datetime.strptime(repack_date, "%Y-%m").replace(day=1).date()
        if repack_date else None
    )

    # 🔵 請負判定フラグの処理
    # "1" なら True, それ以外（Noneや"0"）なら False
    is_agreed = request.form.get("contract") == "1"

    # 会員番号：フォームに値があればそれを使用、なければ自動採番
    member_number = request.form.get("member_number", "").strip() or _generate_member_number()

    member = Member(
        member_type=request.form.get("member_type"),
        application_date=_parse_date(request.form.get("application_date")),
        full_name=request.form.get("full_name"),
        furigana=request.form.get("furigana"),
        gender=request.form.get("gender"),
        blood_type=request.form.get("blood_type"),
        birthday=_parse_date(request.form.get("birthday")),
        weight=request.form.get("weight"),
        zip_code=zip_code,
        address=request.form.get("address"),
        mobile_phone=request.form.get("mobile_phone"),
        home_phone=request.form.get("home_phone"),
        company_name=request.form.get("company_name"),
        company_phone=request.form.get("company_phone"),
        emergency_name=request.form.get("emergency_name"),
        emergency_phone=request.form.get("emergency_phone"),
        email=request.form.get("email"),
        member_number=member_number,
#        member_number=request.form.get("member_number"),
        medical_history=request.form.get("medical_history"),
        course_type=request.form.get("course_type"),
        course_name=request.form.get("course_name"),
        course_fee=request.form.get("course_fee"),
        glider_name=request.form.get("glider_name"),
        glider_color=request.form.get("glider_color"),
        agreement_date=_parse_date(request.form.get("agreement_date")),
        signature_name=request.form.get("signature_name"),
        guardian_name=request.form.get("guardian_name"),
        course_find=request.form.get("course_find"),
        leader=request.form.get("leader"),
        home_area=request.form.get("home_area"),
        visitor_fee=request.form.get("visitor_fee"),
        experience=request.form.get("experience"),
        reg_no=request.form.get("reg_no"),
        reglimit_date=_parse_date(request.form.get("reglimit_date")),
        license=request.form.get("license"),
        repack_date=repack_shortdate,
        contract=is_agreed,  # 請負判定
    )

    db.session.add(member)
    db.session.commit()

    return jsonify({"status": "ok"})


@member_bp.route("/api/apply", methods=["POST"])
def apply_member():
    return _register_member()

@member_bp.route("/api/apply_a", methods=["POST"])
def apply_member_a():
    return _register_member()

@member_bp.route("/api/apply_v", methods=["POST"])
def apply_member_v():
    return _register_member()

@member_bp.route("/api/apply_club", methods=["POST"])
def apply_member_club():
    return _register_member()

@member_bp.route("/api/apply_info", methods=["POST"])
def apply_member_cnt():
    return _register_member()


# =========================================
# 管理画面用 CRUD API（JSON）
# =========================================

# 会員一覧取得 / 検索
# GET /api/members
#   ?name=         氏名（部分一致）
#   ?member_type=  分類（完全一致）
#   ?glider_name=  使用機体（部分一致）
#   ?reglimit_soon=1  登録期限が今日から1ヶ月以内
#   ?repack_soon=1    リパック日が今日から1ヶ月以内
@member_bp.route("/api/members", methods=["GET"])
def list_members():
    query = Member.query

    name = request.args.get("name", "").strip()
    if name:
        query = query.filter(Member.full_name.ilike(f"%{name}%"))

    member_type = request.args.get("member_type", "").strip()
    if member_type:
        query = query.filter(Member.member_type == member_type)

    glider_name = request.args.get("glider_name", "").strip()
    if glider_name:
        query = query.filter(Member.glider_name.ilike(f"%{glider_name}%"))

    today = date.today()
    one_month_later = today + timedelta(days=31)

    if request.args.get("reglimit_soon") == "1":
        query = query.filter(
            Member.reglimit_date.isnot(None),
            Member.reglimit_date >= today,
            Member.reglimit_date <= one_month_later,
        )

    if request.args.get("repack_soon") == "1":
        query = query.filter(
            Member.repack_date.isnot(None),
            Member.repack_date >= today,
            Member.repack_date <= one_month_later,
        )

    members = query.order_by(Member.id.desc()).all()
    return jsonify([_member_to_dict(m) for m in members])


# 会員1件取得
@member_bp.route("/api/members/<int:member_id>", methods=["GET"])
def get_member(member_id):
    member = Member.query.get_or_404(member_id)
    return jsonify(_member_to_dict(member))

# 会員番号で1件取得（更新ページ検索用）
@member_bp.route("/api/members/by-member-number/<string:member_number>", methods=["GET"])
def get_member_by_number(member_number):
    member = Member.query.filter_by(member_number=member_number).first()
    if not member:
        abort(404, description="会員番号が見つかりません")
    return jsonify(_member_to_dict(member))


# UUIDで1件取得（QRコード検索用）
@member_bp.route("/api/members/by-uuid/<string:member_uuid>", methods=["GET"])
def get_member_by_uuid(member_uuid):
    member = Member.query.filter_by(uuid=member_uuid).first()
    if not member:
        abort(404, description="QRコード（UUID）が見つかりません")
    return jsonify(_member_to_dict(member))


# 会員新規作成（管理画面から JSON で登録）
@member_bp.route("/api/members", methods=["POST"])
def create_member():
    data = request.get_json(silent=True)
    if not data:
        abort(400, description="リクエストボディが不正です")
    if not data.get("full_name"):
        abort(400, description="氏名は必須です")
    if not data.get("signature_name"):
        abort(400, description="本人署名は必須です")

    member = Member()
    _apply_fields_from_json(member, data)
    db.session.add(member)
    db.session.commit()
    return jsonify(_member_to_dict(member)), 201


# 会員更新
# --- 既存の update_member 関数に会員番号重複チェックを追加 ---
# 以下のように update_member を置き換えてください
@member_bp.route("/api/members/<int:member_id>", methods=["PUT"])
def update_member(member_id):
    member = Member.query.get_or_404(member_id)
    data = request.get_json(silent=True)
    if not data:
        abort(400, description="リクエストボディが不正です")
    if "full_name" in data and not data["full_name"]:
        abort(400, description="氏名は必須です")

    # 会員番号の必須チェック
    new_member_number = data.get("member_number", "").strip() if data.get("member_number") else ""
    if "member_number" in data:
        if not new_member_number:
            abort(400, description="会員番号は必須です")
        # 重複チェック（自分自身は除外）
        duplicate = Member.query.filter(
            Member.member_number == new_member_number,
            Member.id != member_id
        ).first()
        if duplicate:
            abort(400, description=f"会員番号 '{new_member_number}' は既に使用されています")

    _apply_fields_from_json(member, data)
    db.session.commit()
    return jsonify(_member_to_dict(member))

#@member_bp.route("/api/members/<int:member_id>", methods=["PUT"])
#def update_member(member_id):
#    member = Member.query.get_or_404(member_id)
#    data = request.get_json(silent=True)
#    if not data:
#        abort(400, description="リクエストボディが不正です")
#    if "full_name" in data and not data["full_name"]:
#        abort(400, description="氏名は必須です")
#
#    _apply_fields_from_json(member, data)
#    db.session.commit()
#    return jsonify(_member_to_dict(member))


# 会員削除
@member_bp.route("/api/members/<int:member_id>", methods=["DELETE"])
def delete_member(member_id):
    member = Member.query.get_or_404(member_id)
    db.session.delete(member)
    db.session.commit()
    return jsonify({"message": "削除しました", "id": member_id})


# =========================================
# エラーハンドラ
# =========================================

@member_bp.errorhandler(400)
def bad_request(e):
    return jsonify({"error": str(e.description)}), 400

@member_bp.errorhandler(404)
def not_found(e):
    return jsonify({"error": "対象が見つかりません"}), 404
