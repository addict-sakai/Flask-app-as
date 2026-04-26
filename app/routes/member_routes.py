"""
app/routes/member_routes.py
会員管理 Flask ルート & REST API
DB構成V2 対応（2026-03-23）改定５→改定９（2026/04/11）

改定９変更点:
  1. _member_to_dict() に is_leader / instructor_role を追加（GETで返るように）
  2. _MEMBER_BOOL_FIELDS に is_leader を追加（PUT/POSTで保存されるように）
  3. _MEMBER_STR_FIELDS に instructor_role を追加（PUT/POSTで保存されるように）

改定８変更点:
  1. apply_update_member() にビジター変更の即時登録ロジックを追加
       - 変更先が「ビジター」の場合はスタッフ確認不要で即時登録（メール送信）
       - 現在「ビジター」から「ビジター」への変更は却下
  2. _daily_member_check() を拡張
       - 「年会員」「冬季会員」の期限切れ → 自動ビジター化＋メール送信
       - 「スクール」の期限切れ → member_status を 'renewal_waiting' に変更
  3. 期限通知対象取得 API を追加
       GET /api/members/expiry_alerts
       年会員（2ヶ月前）・冬季会員（2週間前）・スクール（1ヶ月前）を返す
  4. コース設定取得 API を追加
       GET /api/config/course_fee?course=冬季継続
       config_master からコース料金を返す

改定５変更点（維持）:
  1. apply_update_member() を改修
       リクエストを course_changes（コース変更・申請登録）と
       info_changes（情報変更・即時反映）に分離して処理。
  2. get_pending_application() を拡張
       pending だけでなく最新の approved / rejected も返す。
"""

from flask import Blueprint, render_template, request, jsonify, abort, send_from_directory
from app.db import db
from app.models.member import Member
from app.models.member_application import MemberApplication
from app.models.member_course   import MemberCourse
from app.models.member_contact  import MemberContact
from app.models.member_flyer    import MemberFlyer
from datetime import datetime, date, timedelta
import uuid
import json
import os
from sqlalchemy import text
from sqlalchemy.orm import selectinload

member_bp = Blueprint("member", __name__)


# =========================================
# ページルート
# =========================================

@member_bp.route("/")
def index():
    return render_template("index.html")

@member_bp.route("/apply")
def apply_page():
    return render_template("会員申込書.html")

@member_bp.route("/apply_a")
def apply_page_a():
    return render_template("会員申込書_A.html")

@member_bp.route("/apply_v")
def apply_page_v():
    return render_template("ビジター申込書.html")

@member_bp.route("/apply_club")
def apply_page_club():
    return render_template("クラブ入会案内.html")

@member_bp.route("/apply_info")
def apply_page_cnt():
    return render_template("会員管理.html")

@member_bp.route("/logo_back")
def logo_back_page():
    return render_template("logo_back.html")

@member_bp.route("/img/<path:filename>")
def serve_img(filename):
    img_dir = os.path.join(os.path.dirname(__file__), '..', 'img')
    return send_from_directory(img_dir, filename)

@member_bp.route("/apply_flyer")
def apply_page_flyer():
    return render_template("フライヤー申請.html")

@member_bp.route("/apply_winter")
def apply_page_winter():
    return render_template("冬季会員申込書.html")

@member_bp.route("/apply_upd")
def apply_page_upd():
    return render_template("会員更新.html")

@member_bp.route("/apply_config")
def apply_page_config():
    return render_template("設定管理.html")







# =========================================
# ヘルパー
# =========================================

def _parse_date(value, fmt="%Y-%m-%d"):
    if not value:
        return None
    try:
        return datetime.strptime(value, fmt).date()
    except ValueError:
        return None


def _member_to_list_dict(m, course=None) -> dict:
    """
    GET /api/members（一覧）専用の軽量 dict。
    renderList()・renderQrBulkList() が使うフィールドのみ返す。
    uuid / member_status / reg_no は QRカード一括作成ビューで必要。
    """
    def fd(d):
        return d.isoformat() if d else None
    f = m.flyer  # backref 経由
    return {
        "id":              m.id,
        "uuid":            str(m.uuid) if m.uuid else None,
        "member_number":   m.member_number,
        "full_name":       m.full_name,
        "member_status":   m.member_status,
        "member_type":     course.member_type if course else None,
        "license":         f.license           if f else None,
        "glider_name":     f.glider_name       if f else None,
        "organization":    f.organization      if f else None,
        "reg_no":          f.reg_no            if f else None,
        "reglimit_date":   fd(f.reglimit_date)  if f else None,
        "repack_date":     fd(f.repack_date)    if f else None,
        "instructor_role": m.instructor_role,
    }


def _member_to_dict(m: Member) -> dict:
    """
    members + member_contacts + member_flyers + member_courses（現在）
    を結合して JSON シリアライズ可能な dict に変換する。
    """
    def fd(d):
        return d.isoformat() if d else None

    c = m.contact   # MemberContact（1:1）
    f = m.flyer     # MemberFlyer  （1:1）

    course = MemberCourse.get_current(m.id)

    return {
        # ── members（基本情報） ──────────────────────────────────
        "id":               m.id,
        "uuid":             str(m.uuid) if m.uuid else None,
        "member_number":    m.member_number,
        "full_name":        m.full_name,
        "furigana":         m.furigana,
        "gender":           m.gender,
        "blood_type":       m.blood_type,
        "birthday":         fd(m.birthday),
        "weight":           m.weight,
        "guardian_name":    m.guardian_name,
        "relationship":     m.relationship,
        "application_date": fd(m.application_date),
        "agreement_date":   fd(m.agreement_date),
        "signature_name":   m.signature_name,
        "course_find":      m.course_find,
        "member_class":     m.member_class,
        "member_status":    m.member_status,
        "confirmed_at":     fd(m.confirmed_at),
        "contract":         bool(m.contract)          if m.contract          is not None else False,
        "is_leader":        bool(m.is_leader)          if m.is_leader         is not None else False,
        "instructor_role":  m.instructor_role,
        "payment_confirmed":bool(m.payment_confirmed) if m.payment_confirmed is not None else False,
        "from_experience":  bool(m.from_experience)   if m.from_experience   is not None else False,
        "exp_resv_no":      m.exp_resv_no,
        "updated_at":       m.updated_at.strftime("%Y-%m-%d %H:%M") if m.updated_at else None,

        # ── member_contacts（連絡先） ────────────────────────────
        "zip_code":         c.zip_code         if c else None,
        "address":          c.address          if c else None,
        "mobile_phone":     c.mobile_phone     if c else None,
        "home_phone":       c.home_phone       if c else None,
        "email":            c.email            if c else None,
        "company_name":     c.company_name     if c else None,
        "company_phone":    c.company_phone    if c else None,
        "emergency_name":   c.emergency_name   if c else None,
        "emergency_phone":  c.emergency_phone  if c else None,
        "medical_history":  c.medical_history  if c else None,

        # ── member_flyers（フライヤー情報） ──────────────────────
        "organization":       f.organization         if f else None,
        "reg_no":             f.reg_no               if f else None,
        "reglimit_date":      fd(f.reglimit_date)    if f else None,
        "next_reglimit_date": fd(f.next_reglimit_date) if f else None,
        "license":            f.license              if f else None,
        "repack_date":        fd(f.repack_date)      if f else None,
        "glider_name":        f.glider_name          if f else None,
        "glider_color":       f.glider_color         if f else None,
        "home_area":          f.home_area            if f else None,
        "experience":         f.experience           if f else None,
        "leader":             f.leader               if f else None,
        "visitor_fee":        f.visitor_fee          if f else None,

        # ── member_courses（現在有効なコース） ───────────────────
        "member_type":       course.member_type  if course else None,
        "course_name":       course.course_name  if course else None,
        "course_fee":        course.course_fee   if course else None,
        "course_type":       course.member_type  if course else None,  # 互換用
        "course_start_date": fd(course.start_date) if course else fd(m.confirmed_at),
    }



# members に書くフィールド
_MEMBER_STR_FIELDS  = [
    "full_name", "furigana", "gender", "blood_type", "weight",
    "member_number", "relationship", "signature_name", "guardian_name",
    "course_find", "member_class", "exp_resv_no", "instructor_role",
]
_MEMBER_DATE_FIELDS = ["application_date", "birthday", "agreement_date"]
_MEMBER_BOOL_FIELDS = ["contract", "is_leader", "payment_confirmed", "from_experience"]

# member_contacts に書くフィールド
_CONTACT_FIELDS = [
    "zip_code", "address", "mobile_phone", "home_phone", "email",
    "company_name", "company_phone",
    "emergency_name", "emergency_phone", "medical_history",
]

# member_flyers に書くフィールド
_FLYER_STR_FIELDS  = [
    "organization", "reg_no", "license",
    "glider_name", "glider_color", "home_area",
    "experience", "leader", "visitor_fee",
]
_FLYER_DATE_FIELDS = ["reglimit_date"]


def _apply_fields_from_json(member: Member, data: dict) -> None:
    """JSON データを members / member_contacts / member_flyers に振り分けて書き込む"""

    # ── members ──────────────────────────────────────────────────
    for field in _MEMBER_STR_FIELDS:
        if field in data:
            setattr(member, field, data[field] or None)
    for field in _MEMBER_DATE_FIELDS:
        if field in data:
            setattr(member, field, _parse_date(data.get(field)))
    for field in _MEMBER_BOOL_FIELDS:
        if field in data:
            setattr(member, field, bool(data[field]))

    # ── member_contacts ───────────────────────────────────────────
    contact_data = {k: v for k, v in data.items() if k in _CONTACT_FIELDS}
    if contact_data:
        contact = MemberContact.get_or_create(member.id)
        contact.apply_dict(contact_data)

    # ── member_flyers ─────────────────────────────────────────────
    flyer_keys = set(_FLYER_STR_FIELDS) | set(_FLYER_DATE_FIELDS) | {"repack_date"}
    flyer_data = {k: v for k, v in data.items() if k in flyer_keys}
    if flyer_data:
        flyer = MemberFlyer.get_or_create(member.id)
        flyer.apply_dict(flyer_data, parse_date_fn=_parse_date)



# =========================================
# フォーム申込 API（form-data）
# =========================================

def _generate_member_number() -> str:
    """
    数字のみの会員番号の最大値+1を5桁ゼロ埋めで返す。
    既存の4桁番号も含めて最大値を探すため、既存データへの影響なし。
    例: 既存最大が0038 -> 次は00039
    """
    existing = (
        db.session.query(Member.member_number)
        .filter(Member.member_number.op("~")(r"^\d+$"))
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
    return f"{max_num + 1:05d}"


def _register_member():
    try:
        zip_code = request.form.get("zip1", "") + request.form.get("zip2", "")

        dup_name     = request.form.get("full_name", "").strip()
        dup_birthday = _parse_date(request.form.get("birthday"))
        if dup_name and dup_birthday:
            duplicate = Member.query.filter_by(
                full_name=dup_name,
                birthday=dup_birthday,
            ).first()
            if duplicate:
                return jsonify({
                    "status": "duplicate",
                    "message": (
                        f"「{dup_name}」さん（生年月日: {dup_birthday.strftime('%Y年%m月%d日')}）"
                        "は既に登録されています。\n"
                        "登録内容の変更・更新は「会員情報の更新・変更」からお手続きください。"
                    ),
                }), 409

        repack_date = (request.form.get("repack_date") or "").strip()
        repack_shortdate = None
        if repack_date:
            # flatpickr monthSelect は "YYYY-MM" 形式で送信するが、
            # 万一 "YYYY-MM-DD" 形式で来た場合も安全に処理する
            try:
                if len(repack_date) == 7:   # "YYYY-MM"
                    repack_shortdate = datetime.strptime(repack_date, "%Y-%m").replace(day=1).date()
                else:                       # "YYYY-MM-DD" 等
                    repack_shortdate = datetime.strptime(repack_date[:7], "%Y-%m").replace(day=1).date()
            except ValueError:
                repack_shortdate = None

        is_agreed          = request.form.get("contract") == "1"
        is_from_experience = request.form.get("from_experience") == "1"
        exp_resv_no        = request.form.get("exp_resv_no", "").strip() or None
        member_number      = request.form.get("member_number", "").strip() or _generate_member_number()

        course_type = request.form.get("course_type")
        member_type = request.form.get("member_type")
        if course_type == "スクール":
            member_type = "スクール"
        elif course_type == "フリーフライト":
            member_type = "会員"

        member = Member(
            member_status    = 'pending',
            member_number    = member_number,
            full_name        = request.form.get("full_name"),
            furigana         = request.form.get("furigana"),
            gender           = request.form.get("gender"),
            blood_type       = request.form.get("blood_type"),
            birthday         = _parse_date(request.form.get("birthday")),
            weight           = request.form.get("weight"),
            guardian_name    = request.form.get("guardian_name"),
            relationship     = request.form.get("relationship"),
            application_date = _parse_date(request.form.get("application_date")),
            agreement_date   = _parse_date(request.form.get("agreement_date")),
            signature_name   = request.form.get("signature_name"),
            course_find      = request.form.get("course_find"),
            contract         = is_agreed,
            payment_confirmed= False,
            from_experience  = is_from_experience,
            exp_resv_no      = exp_resv_no,
        )

        db.session.add(member)
        db.session.flush()  # member.id を確定させてから子テーブルを作成

        # ── member_contacts を作成 ───────────────────────────────────
        contact = MemberContact(
            member_id       = member.id,
            zip_code        = zip_code,
            address         = request.form.get("address"),
            mobile_phone    = request.form.get("mobile_phone"),
            home_phone      = request.form.get("home_phone"),
            email           = request.form.get("email"),
            company_name    = request.form.get("company_name"),
            company_phone   = request.form.get("company_phone"),
            emergency_name  = request.form.get("emergency_name"),
            emergency_phone = request.form.get("emergency_phone"),
            medical_history = request.form.get("medical_history"),
        )
        db.session.add(contact)

        # ── member_flyers を作成 ─────────────────────────────────────
        flyer = MemberFlyer(
            member_id     = member.id,
            organization  = request.form.get("organization"),
            reg_no        = request.form.get("reg_no"),
            reglimit_date = _parse_date(request.form.get("reglimit_date")),
            license       = request.form.get("license"),
            repack_date   = repack_shortdate,
            glider_name   = request.form.get("glider_name"),
            glider_color  = request.form.get("glider_color"),
            home_area     = request.form.get("home_area"),
            experience    = request.form.get("experience"),
            leader        = request.form.get("leader"),
            visitor_fee   = request.form.get("visitor_fee"),
        )
        db.session.add(flyer)

        # ── member_applications に申込コース情報を保存（pending） ────────
        # course_type / course_name / course_fee を changes_json に格納
        course_type_val = request.form.get("course_type", "").strip()
        course_name_val = request.form.get("course_name", "").strip()
        course_fee_val  = request.form.get("course_fee",  "").strip()
        # member_type マッピング
        if course_type_val == "スクール":
            app_member_type = "スクール"
        elif course_type_val == "フリーフライト":
            app_member_type = "会員"
        elif course_type_val:
            app_member_type = course_type_val
        else:
            app_member_type = None

        if app_member_type:
            changes = {"member_type": app_member_type}
            if course_name_val:
                changes["course_name"] = course_name_val
            if course_fee_val:
                changes["course_fee"] = course_fee_val
            new_app = MemberApplication(
                member_id        = member.id,
                application_type = "new_member",
                app_status       = "pending",
            )
            new_app.set_changes(changes)
            db.session.add(new_app)

        db.session.commit()
        return jsonify({"status": "ok"})

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


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

@member_bp.route("/api/members", methods=["GET"])
def list_members():
    query = Member.query

    name = request.args.get("name", "").strip()
    if name:
        query = query.filter(Member.full_name.ilike(f"%{name}%"))

    member_type = request.args.get("member_type", "").strip()
    if member_type:
        # member_courses（現在有効）で絞り込み
        active_ids = db.session.query(MemberCourse.member_id).filter(
            MemberCourse.member_type == member_type,
            MemberCourse.status == 'active',
            MemberCourse.end_date.is_(None),
        ).subquery()
        query = query.filter(Member.id.in_(active_ids))

    glider_name = request.args.get("glider_name", "").strip()
    if glider_name:
        # member_flyers で絞り込み
        flyer_ids = db.session.query(MemberFlyer.member_id).filter(
            MemberFlyer.glider_name.ilike(f"%{glider_name}%")
        ).subquery()
        query = query.filter(Member.id.in_(flyer_ids))

    today = date.today()

    if request.args.get("reglimit_soon") == "1":
        flyer_ids_rl = db.session.query(MemberFlyer.member_id).filter(
            MemberFlyer.reglimit_date.isnot(None),
            MemberFlyer.reglimit_date <= today + timedelta(days=31),
        ).subquery()
        query = query.filter(Member.id.in_(flyer_ids_rl))

    if request.args.get("repack_soon") == "1":
        upper_ref   = today
        upper_month = upper_ref.month - 5
        upper_year  = upper_ref.year
        if upper_month <= 0:
            upper_month += 12
            upper_year  -= 1
        repack_upper = upper_ref.replace(year=upper_year, month=upper_month, day=1)
        flyer_ids_rp = db.session.query(MemberFlyer.member_id).filter(
            MemberFlyer.repack_date.isnot(None),
            MemberFlyer.repack_date <= repack_upper,
        ).subquery()
        query = query.filter(Member.id.in_(flyer_ids_rp))

    members = query.order_by(Member.id.desc()).all()

    if not members:
        return jsonify([])

    # ── N+1防止：active コースを1クエリで一括取得 ──────────────────
    member_ids = [m.id for m in members]
    active_courses = MemberCourse.query.filter(
        MemberCourse.member_id.in_(member_ids),
        MemberCourse.status == 'active',
        MemberCourse.end_date.is_(None),
    ).all()
    course_map = {c.member_id: c for c in active_courses}

    # 一覧は軽量 dict のみ返す。詳細は GET /api/members/<id> で取得
    return jsonify([_member_to_list_dict(m, course_map.get(m.id)) for m in members])


@member_bp.route("/api/members/<int:member_id>", methods=["GET"])
def get_member(member_id):
    member = Member.query.get_or_404(member_id)
    return jsonify(_member_to_dict(member))


@member_bp.route("/api/members/by-member-number/<string:member_number>", methods=["GET"])
def get_member_by_number(member_number):
    member = Member.query.filter_by(member_number=member_number).first()
    if not member:
        abort(404, description="会員番号が見つかりません")
    return jsonify(_member_to_dict(member))


@member_bp.route("/api/members/by-uuid/<string:member_uuid>", methods=["GET"])
def get_member_by_uuid(member_uuid):
    member = Member.query.filter_by(uuid=member_uuid).first()
    if not member:
        abort(404, description="QRコード（UUID）が見つかりません")
    return jsonify(_member_to_dict(member))


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


@member_bp.route("/api/members/<int:member_id>", methods=["PUT"])
def update_member(member_id):
    member = Member.query.get_or_404(member_id)
    data   = request.get_json(silent=True)
    if not data:
        abort(400, description="リクエストボディが不正です")
    if "full_name" in data and not data["full_name"]:
        abort(400, description="氏名は必須です")

    new_member_number = data.get("member_number", "").strip() if data.get("member_number") else ""
    if "member_number" in data:
        if not new_member_number:
            abort(400, description="会員番号は必須です")
        duplicate = Member.query.filter(
            Member.member_number == new_member_number,
            Member.id != member_id
        ).first()
        if duplicate:
            abort(400, description=f"会員番号 '{new_member_number}' は既に使用されています")

    _apply_fields_from_json(member, data)
    member.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(_member_to_dict(member))


@member_bp.route("/api/members/<int:member_id>", methods=["DELETE"])
def delete_member(member_id):
    member = Member.query.get_or_404(member_id)
    db.session.delete(member)
    db.session.commit()
    return jsonify({"message": "削除しました", "id": member_id})


# =========================================
# ★ 改定５：更新・変更申請 API（分離処理版）
# =========================================

# コース変更フィールド（申請登録対象）
# course_fee を追加 → changes_json に金額が保存されスタッフ承認画面に表示される
_COURSE_FIELDS = {"member_type", "course_name", "course_fee"}


# POST /api/members/<id>/apply_update  改定５版
#
# リクエスト JSON:
#   {
#     "course_changes": { "member_type": "年会員", ... },  # コース変更（申請登録）
#     "info_changes":   { "full_name": "山田太郎", ... },  # 情報変更（即時反映）
#   }
#
# 処理:
#   1. info_changes → members に即時 PUT（updated_at 更新）
#   2. course_changes → member_applications に登録
#      既存 pending があれば course_changes のみマージ上書き
#      （info_changes で更新済みの内容は申請に含めない）
#
# レスポンス:
#   { "status": "ok", "info_updated": bool, "course_applied": bool, "message": str }
@member_bp.route("/api/members/<int:member_id>/apply_update", methods=["POST"])
def apply_update_member(member_id):
    member = Member.query.get_or_404(member_id)
    data = request.get_json(silent=True)
    if not data:
        abort(400, description="リクエストボディが不正です")

    course_changes = data.get("course_changes", {})
    info_changes   = data.get("info_changes",   {})

    # どちらも空なら何もしない
    if not course_changes and not info_changes:
        abort(400, description="変更内容がありません")

    # course_changes に info 系フィールドが混入していた場合は除去（安全対策）
    course_changes = {k: v for k, v in course_changes.items() if k in _COURSE_FIELDS}
    # info_changes に course 系フィールドが混入していた場合は除去（安全対策）
    info_changes   = {k: v for k, v in info_changes.items()   if k not in _COURSE_FIELDS}

    # ★ 改定１１：年会員・ビジターへの変更時は course_name を強制削除
    _new_type = course_changes.get("member_type", "")
    if _new_type in ("年会員", "ビジター"):
        course_changes.pop("course_name", None)

    info_updated   = False
    course_applied = False
    visitor_instant = False
    messages       = []

    # ── ① 情報変更を即時反映 ──────────────────────────────────
    if info_changes:
        _apply_fields_from_json(member, info_changes)
        member.updated_at = datetime.utcnow()
        info_updated = True
        messages.append("登録情報を更新しました。")

    # ── ② コース変更を処理 ────────────────────────────────────
    if course_changes:
        new_member_type = course_changes.get("member_type", "")

        # ★ 改定８：ビジター→ビジターは却下
        current_course = MemberCourse.get_current(member_id)
        current_type   = current_course.member_type if current_course else ""

        if new_member_type == "ビジター" and current_type == "ビジター":
            db.session.rollback()
            return jsonify({
                "status":  "rejected",
                "message": "現在すでにビジターです。ビジターへの変更は受け付けられません。",
            }), 400

        # ★ 改定８：ビジターへの変更は確認不要で即時登録
        if new_member_type == "ビジター":
            today = date.today()
            # 現在コースを終了
            if current_course:
                current_course.expire(end_date=today)
            # ビジターコースを追加
            new_course = MemberCourse(
                member_id    = member_id,
                member_type  = "ビジター",
                course_name  = course_changes.get("course_name") or None,
                course_fee   = course_changes.get("course_fee")  or None,
                start_date   = today,
                end_date     = None,
                status       = "active",
                confirmed_by = "member",
            )
            db.session.add(new_course)
            member.updated_at = datetime.utcnow()
            visitor_instant   = True
            course_applied    = True
            messages.append("ビジターへの変更が完了しました。")

            # ★ メール送信（変更通知）
            _send_course_change_mail(member, "ビジター")

        else:
            # 通常コース変更（スタッフ確認待ち申請）
            existing = MemberApplication.query.filter_by(
                member_id=member_id,
                app_status='pending',
            ).first()

            if existing:
                merged = existing.get_changes()
                merged.update(course_changes)
                existing.set_changes(merged)
                existing.application_type = "course_change"
                existing.applied_at       = datetime.utcnow()
            else:
                app = MemberApplication(
                    member_id=member_id,
                    application_type="course_change",
                    app_status='pending',
                )
                app.set_changes(course_changes)
                db.session.add(app)

            course_applied = True
            messages.append("コース変更申請を受け付けました。スタッフ確認後に反映されます。")

    db.session.commit()

    return jsonify({
        "status":          "ok",
        "info_updated":    info_updated,
        "course_applied":  course_applied,
        "visitor_instant": visitor_instant,
        "message":         "".join(messages) if messages else "変更なし",
    })


# POST /api/applications/<id>/approve
# ★ 改定６ : 承認時に member_courses にコース履歴レコードを追加。
# ★ 改定１０: confirmed_member_type をレスポンスに追加。
#             年会員・ビジターへの変更時は course_name を None に強制。
# ★ 改定１１: start_date を _calc_new_course_start() で正しく算出。
@member_bp.route("/api/applications/<int:app_id>/approve", methods=["POST"])
def approve_application(app_id):
    app_rec  = MemberApplication.query.get_or_404(app_id)
    member   = Member.query.get_or_404(app_rec.member_id)
    req_data = request.get_json(silent=True) or {}
    today    = date.today()

    changes = app_rec.get_changes()

    # ── ① course / reglimit フィールドを抽出 ──────────────────────
    new_member_type = changes.pop("member_type",  None)
    new_course_name = changes.pop("course_name",  None)
    new_course_fee  = changes.pop("course_fee",   None)

    # 年会員・ビジターへの変更時は course_name を強制 None
    if new_member_type in ("年会員", "ビジター"):
        new_course_name = None

    # reglimit_date の早期更新判定（フライヤー登録期限）
    new_limit_str = changes.pop("reglimit_date", None)

    # ── ② 残りの info_changes を members / contacts / flyers に反映 ─
    if changes:
        _apply_fields_from_json(member, changes)

    if new_limit_str:
        new_limit = _parse_date(new_limit_str)
        flyer = MemberFlyer.get_or_create(member.id)
        if flyer.reglimit_date and flyer.reglimit_date > today:
            flyer.next_reglimit_date = new_limit
        else:
            flyer.reglimit_date      = new_limit
            flyer.next_reglimit_date = None

    member.updated_at = datetime.utcnow()

    # ── ③ member_courses にコース履歴レコードを追加 ───────────────
    if new_member_type:
        confirmed_by   = req_data.get("confirmed_by", "staff")
        current_course = MemberCourse.get_current(member.id)

        # ★ 改定１１: コース種別に応じた start_date を計算
        new_start = _calc_new_course_start(
            new_member_type, new_course_name, current_course, today
        )

        # 現在有効なコースを終了
        if current_course:
            current_course.expire(end_date=new_start)

        # 新コースレコードを追加
        new_course = MemberCourse(
            member_id      = member.id,
            member_type    = new_member_type,
            course_name    = new_course_name,
            course_fee     = new_course_fee,
            start_date     = new_start,
            end_date       = None,
            status         = 'active',
            confirmed_by   = confirmed_by,
            application_id = app_rec.id,
        )
        db.session.add(new_course)

    # ── ④ 申請レコードを承認済みに更新 ───────────────────────────
    app_rec.app_status   = 'approved'
    app_rec.confirmed_at = datetime.utcnow()
    app_rec.confirmed_by = req_data.get("confirmed_by", "staff")

    db.session.commit()

    # フロント側で分類欄を更新できるよう confirmed_member_type を返す
    confirmed_course      = MemberCourse.get_current(member.id)
    confirmed_member_type = confirmed_course.member_type if confirmed_course else new_member_type

    return jsonify({
        "status":                "ok",
        "confirmed_member_type": confirmed_member_type,
    })


# POST /api/applications/<id>/reject
@member_bp.route("/api/applications/<int:app_id>/reject", methods=["POST"])
def reject_application(app_id):
    app_rec  = MemberApplication.query.get_or_404(app_id)
    req_data = request.get_json(silent=True) or {}

    app_rec.app_status   = 'rejected'
    app_rec.confirmed_at = datetime.utcnow()
    app_rec.notes        = req_data.get("notes", "")

    db.session.commit()
    return jsonify({"status": "ok"})


# GET /api/members/<id>/pending_application  改定５版（フライヤー申請対応）
#
# 会員更新ページの申請状態バッジ表示に使う。
# ★ 優先順位:
#   1. members.member_status = 'pending'
#        → 新規申込がスタッフ未確認（フライヤー申請未処理）
#        → status_type: 'member_pending'
#   2. member_applications.app_status = 'pending'
#        → コース変更申請中
#        → status_type: 'course_change'
#   3. member_applications の最新 approved / rejected
#        → 処理済み表示用
#        → status_type: 'course_change'
@member_bp.route("/api/members/<int:member_id>/pending_application", methods=["GET"])
def get_pending_application(member_id):
    member = Member.query.get_or_404(member_id)

    # ── ① members.member_status = 'pending' → 新規申込 ──
    #    confirmed_at がない → 審査待ち
    #    confirmed_at がある → 入金確認済み（★ 改定２: 確認日登録でステータス変更前の過渡期対応）
    if member.member_status == 'pending':
        has_confirmed = member.confirmed_at is not None

        # ★ member_applications から new_member の pending レコードを取得
        new_app = MemberApplication.query.filter_by(
            member_id=member_id,
            application_type="new_member",
            app_status="pending",
        ).first()
        changes = new_app.get_changes() if new_app else {}  # ★ changes を取得

        return jsonify({
            "id":               new_app.id if new_app else None,  # ★ ID も返す
            "status_type":      "member_pending",
            "application_type": "new_member",
            "app_status":       "member_pending" if has_confirmed else "member_pending_waiting",
            "changes":          changes,  # ★ 空dictではなく実際のchangesを返す
            "applied_at":       member.application_date.strftime("%Y-%m-%d") if member.application_date else None,
            "confirmed_at":     member.confirmed_at.strftime("%Y-%m-%d") if member.confirmed_at else None,
            "confirmed_by":     None,
            "notes":            None,
        })

    # ── ② member_applications を確認 ──
    # course_change の pending を最優先で取得
    app_rec = (
        MemberApplication.query
        .filter_by(
            member_id=member_id,
            application_type='course_change',
            app_status='pending',
        )
        .order_by(MemberApplication.applied_at.desc())
        .first()
    )

    # course_change pending がなければ最新の course_change レコードを返す（表示用）
    if not app_rec:
        app_rec = (
            MemberApplication.query
            .filter_by(
                member_id=member_id,
                application_type='course_change',
            )
            .order_by(MemberApplication.applied_at.desc())
            .first()
        )

    if not app_rec:
        return jsonify(None)

    return jsonify({
        "id":               app_rec.id,
        "status_type":      "course_change",
        "application_type": app_rec.application_type,
        "app_status":       app_rec.app_status,
        "changes":          app_rec.get_changes(),
        "applied_at":       app_rec.applied_at.strftime("%Y-%m-%d %H:%M"),
        "confirmed_at":     app_rec.confirmed_at.strftime("%Y-%m-%d %H:%M") if app_rec.confirmed_at else None,
        "confirmed_by":     app_rec.confirmed_by,
        "notes":            app_rec.notes,
    })


# =========================================
# ★ APScheduler：毎日 00:05 自動実行
# =========================================

_member_flask_app = None


# =========================================
# ★ 改定８：コース期限計算ヘルパー
# =========================================

def _calc_course_expire(member_type: str, start_date) -> date | None:
    """
    コース種別と開始日からコース期限日（最終有効日）を返す。
    ビジター等、期限なしの場合は None を返す。

    年会員・スクール : 開始日から1年後の前日
    冬季会員        :
        12月   → 翌年4/30（冬季シーズン）
        1〜4月 → 当年4/30（冬季シーズン）
        5〜11月 → 当年11/30（継続シーズン：5/1〜11/30）
    """
    if not start_date:
        return None
    if isinstance(start_date, str):
        try:
            start_date = datetime.strptime(start_date, "%Y-%m-%d").date()
        except ValueError:
            return None

    if member_type in ("年会員", "スクール"):
        exp = date(start_date.year + 1, start_date.month, start_date.day) - timedelta(days=1)
        return exp

    if member_type == "冬季会員":
        m = start_date.month
        if m == 12:
            return date(start_date.year + 1, 4, 30)
        elif 1 <= m <= 4:
            return date(start_date.year, 4, 30)
        else:  # 5〜11月：継続シーズン
            return date(start_date.year, 11, 30)

    return None


def _calc_new_course_start(new_member_type: str, new_course_name,
                           current_course, today: date) -> date:
    """
    承認時の新コース開始日をコース種別ごとに計算する。

    年会員（更新）:
        現在コースが年会員かつ期限日前 → 現在コースの期限日 + 1日
        それ以外（期限切れ・他コースから変更）→ today

    スクール:
        常に today（承認日）

    冬季会員:
        course_name に応じた月の1日（直近の未来日）
        ALL → 12/1、1 → 1/1、2 → 2/1、3 → 3/1、4 → 4/1、継続 → 5/1

    ビジター・その他:
        today
    """
    if new_member_type == "年会員":
        if current_course:
            expire_dt = _calc_course_expire(current_course.member_type, current_course.start_date)
            if expire_dt and expire_dt >= today:
                return expire_dt + timedelta(days=1)
        return today

    if new_member_type == "スクール":
        return today

    if new_member_type == "冬季会員":
        _WINTER_MONTH = {
            "ALL": 12,
            "1":   1,
            "2":   2,
            "3":   3,
            "4":   4,
            "継続": 5,
        }
        cn = (new_course_name or "").strip()
        target_month = _WINTER_MONTH.get(cn)
        if target_month is None:
            return today

        if target_month == 12:
            candidate = date(today.year, 12, 1)
            if candidate < today:
                candidate = date(today.year + 1, 12, 1)
        else:
            candidate = date(today.year, target_month, 1)
            if candidate < today:
                candidate = date(today.year + 1, target_month, 1)
        return candidate

    return today

# =========================================
# ★ 改定６：コース履歴 API
# =========================================

# GET /api/members/<id>/courses
# 指定会員のコース履歴を start_date 降順で返す。
# フロント（app_info.js / app_mem_upd.js）から呼ぶ。
@member_bp.route("/api/members/<int:member_id>/courses", methods=["GET"])
def get_member_courses(member_id):
    Member.query.get_or_404(member_id)   # 存在確認
    courses = MemberCourse.get_history(member_id)
    return jsonify([c.to_dict() for c in courses])


# GET /api/members/<id>/courses/current
# 指定会員の現在有効なコースを1件返す。
# なければ 404 ではなく null を返す（フロント側で判定する）。
@member_bp.route("/api/members/<int:member_id>/courses/current", methods=["GET"])
def get_current_course(member_id):
    Member.query.get_or_404(member_id)
    course = MemberCourse.get_current(member_id)
    if not course:
        return jsonify(None)
    return jsonify(course.to_dict())


# POST /api/members/<id>/courses
# スタッフが手動でコース履歴レコードを追加する（初回登録・修正用）。
# リクエスト JSON:
#   {
#     "member_type":  "年会員",
#     "course_name":  null,
#     "course_fee":   "30000",
#     "start_date":   "2026-04-01",
#     "confirmed_by": "staff_name"
#   }
@member_bp.route("/api/members/<int:member_id>/courses", methods=["POST"])
def add_member_course(member_id):
    Member.query.get_or_404(member_id)
    data = request.get_json(silent=True)
    if not data:
        abort(400, description="リクエストボディが不正です")

    member_type = data.get("member_type", "").strip()
    if not member_type:
        abort(400, description="member_type は必須です")

    start_date = _parse_date(data.get("start_date"))
    if not start_date:
        abort(400, description="start_date は必須です（YYYY-MM-DD）")

    confirmed_by = data.get("confirmed_by", "staff")

    # 現在有効なコースを終了させる
    current = MemberCourse.get_current(member_id)
    if current:
        current.expire(end_date=start_date)

    new_course = MemberCourse(
        member_id    = member_id,
        member_type  = member_type,
        course_name  = data.get("course_name") or None,
        course_fee   = data.get("course_fee")  or None,
        start_date   = start_date,
        end_date     = None,
        status       = 'active',
        confirmed_by = confirmed_by,
    )
    db.session.add(new_course)

    # updated_at のみ更新（member_type/course_name は member_courses で管理）
    member = Member.query.get(member_id)
    if member:
        member.updated_at = datetime.utcnow()

    db.session.commit()
    return jsonify(new_course.to_dict()), 201


# PUT /api/courses/<course_id>
# コース履歴レコードを1件修正する（スタッフ用）。
@member_bp.route("/api/courses/<int:course_id>", methods=["PUT"])
def update_course(course_id):
    course = MemberCourse.query.get_or_404(course_id)
    data   = request.get_json(silent=True) or {}

    if "member_type" in data:
        course.member_type = data["member_type"] or course.member_type
    if "course_name" in data:
        course.course_name = data["course_name"] or None
    if "course_fee" in data:
        course.course_fee  = data["course_fee"]  or None
    if "start_date" in data:
        d = _parse_date(data["start_date"])
        if d:
            course.start_date = d
    if "end_date" in data:
        course.end_date = _parse_date(data["end_date"])
    if "status" in data and data["status"] in ("active", "expired", "cancelled"):
        course.status = data["status"]
    if "confirmed_by" in data:
        course.confirmed_by = data["confirmed_by"] or None

    course.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(course.to_dict())


# =========================================
# ★ 改定７：氏名検索 API
# =========================================
#
# POST /api/members/lookup_by_name
# リクエスト JSON: { "name": "山田" }
# レスポンス JSON:
#   {
#     "members": [
#       { "member_number": "0001", "full_name": "山田太郎", "birthday": "1980-01-01" },
#       ...
#     ]
#   }
#
# 検索条件:
#   - full_name の部分一致（ilike）
#   - member_status が 'active' または 'visitor' の会員のみ
#   - 最大20件に制限
@member_bp.route("/api/members/lookup_by_name", methods=["POST"])
def lookup_by_name():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"error": "氏名を入力してください"}), 400

    members = (
        Member.query
        .filter(
            Member.full_name.ilike(f"%{name}%"),
            Member.member_status.in_(["active", "visitor", "pending"]),
        )
        .order_by(Member.full_name)
        .limit(20)
        .all()
    )

    if not members:
        return jsonify({"error": "該当する会員が見つかりませんでした"}), 404

    result = []
    for m in members:
        result.append({
            "member_number": m.member_number,
            "full_name":     m.full_name,
            "birthday":      m.birthday.isoformat() if m.birthday else None,
        })

    return jsonify({"members": result})


# =========================================
# ★ 改定７：PASSコード認証 API
# =========================================
#
# POST /api/members/verify_pass
# リクエスト JSON: { "member_number": "0001", "pass_code": "1234" }
# レスポンス JSON:
#   成功: { "ok": true, "member_number": "0001" }
#   失敗: 401 { "error": "PASSコードが正しくありません" }
#
# 認証ロジック:
#   - member_contacts.mobile_phone の末尾4桁と一致すれば認証成功
#   - mobile_phone が未登録の場合はスタッフ誘導メッセージを返す
#   - 入力は半角数字4桁のみ受け付ける
@member_bp.route("/api/members/verify_pass", methods=["POST"])
def verify_pass():
    data          = request.get_json(silent=True) or {}
    member_number = (data.get("member_number") or "").strip()
    pass_code     = (data.get("pass_code")     or "").strip()

    # バリデーション
    if not member_number:
        return jsonify({"error": "会員番号が指定されていません"}), 400
    if not pass_code or not pass_code.isdigit() or len(pass_code) != 4:
        return jsonify({"error": "PASSコードは半角数字4桁で入力してください"}), 400

    # 会員取得
    member = Member.query.filter_by(member_number=member_number).first()
    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    # 連絡先取得（MemberContact は member_routes で import 済み）
    contact = MemberContact.query.filter_by(member_id=member.id).first()
    if not contact or not contact.mobile_phone:
        return jsonify({
            "error": "携帯番号が登録されていないため認証できません。スタッフにお声がけください。"
        }), 401

    # 携帯番号から数字のみ抽出して末尾4桁と比較
    mobile_digits = "".join(c for c in contact.mobile_phone if c.isdigit())
    if len(mobile_digits) < 4:
        return jsonify({
            "error": "登録されている携帯番号が不正なため認証できません。スタッフにお声がけください。"
        }), 401

    if mobile_digits[-4:] != pass_code:
        return jsonify({"error": "PASSコードが正しくありません"}), 401

    return jsonify({"ok": True, "member_number": member.member_number})

# =========================================
# エラーハンドラ
# =========================================

@member_bp.errorhandler(400)
def bad_request(e):
    return jsonify({"error": str(e.description)}), 400

@member_bp.errorhandler(404)
def not_found(e):
    return jsonify({"error": "対象が見つかりません"}), 404
