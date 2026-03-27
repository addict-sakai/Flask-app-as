"""
app/routes/member_routes.py
会員管理 Flask ルート & REST API
DB構成V2 対応（2026-03-23）改定５→改定６（member_courses 対応）

改定５変更点:
  1. apply_update_member() を改修
       リクエストを course_changes（コース変更・申請登録）と
       info_changes（情報変更・即時反映）に分離して処理。
         course_changes: member_type / course_name のみ
           → member_applications に登録（スタッフ確認待ち）
           → 既存 pending があれば course_changes のみマージ上書き
         info_changes: それ以外の全フィールド
           → members テーブルに即時 PUT（updated_at を更新）
       レスポンスに info_updated / course_applied を含める。
  2. get_pending_application() を拡張
       pending だけでなく最新の approved / rejected も返す。
       レスポンスに app_status / confirmed_at / confirmed_by / notes を追加。
"""

from flask import Blueprint, render_template, request, jsonify, abort
from app.db import db
from app.models.member import Member
from app.models.member_application import MemberApplication
from app.models.member_course   import MemberCourse
from app.models.member_contact  import MemberContact
from app.models.member_flyer    import MemberFlyer
from datetime import datetime, date, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import uuid
import json
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from sqlalchemy import text

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

@member_bp.route("/apply_io_info")
def apply_page_io_info():
    return render_template("入下山管理.html")

@member_bp.route("/apply_exp_resv")
def apply_page_exp_resv():
    return render_template("体験管理.html")

@member_bp.route("/apply_exp_status")
def apply_page_exp_status():
    return render_template("体験状況.html")

@member_bp.route("/apply_staff_manage")
def apply_page_staff_manage():
    return render_template("スタッフ.html")

@member_bp.route("/apply_exp")
def apply_page_exp():
    return render_template("体験申込書.html")

@member_bp.route("/apply_exp_e")
def apply_page_exp_e():
    return render_template("体験申込書_E.html")


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
    "course_find", "member_class", "exp_resv_no",
]
_MEMBER_DATE_FIELDS = ["application_date", "birthday", "agreement_date"]
_MEMBER_BOOL_FIELDS = ["contract", "payment_confirmed", "from_experience"]

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
    return f"{max_num + 1:04d}"


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
    return jsonify([_member_to_dict(m) for m in members])


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
_COURSE_FIELDS = {"member_type", "course_name"}


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

    info_updated   = False
    course_applied = False
    messages       = []

    # ── ① 情報変更を即時反映 ──────────────────────────────────
    if info_changes:
        _apply_fields_from_json(member, info_changes)
        member.updated_at = datetime.utcnow()
        info_updated = True
        messages.append("登録情報を更新しました。")

    # ── ② コース変更を申請登録 ────────────────────────────────
    if course_changes:
        existing = MemberApplication.query.filter_by(
            member_id=member_id,
            app_status='pending',
        ).first()

        if existing:
            # 既存 pending の course_changes のみマージ上書き
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
        "status":         "ok",
        "info_updated":   info_updated,
        "course_applied": course_applied,
        "message":        "".join(messages) if messages else "変更なし",
    })


# POST /api/applications/<id>/approve
# スタッフが管理画面から承認する。
# ★ 改定６: 承認時に member_courses にコース履歴レコードを追加する。
@member_bp.route("/api/applications/<int:app_id>/approve", methods=["POST"])
def approve_application(app_id):
    app_rec  = MemberApplication.query.get_or_404(app_id)
    member   = Member.query.get_or_404(app_rec.member_id)
    req_data = request.get_json(silent=True) or {}
    today    = date.today()

    changes = app_rec.get_changes()

    # ── ① members テーブルの情報変更フィールドを反映 ──────────────
    # course_changes（member_type / course_name）は member_courses で管理するため
    # members への上書きは行わない（互換性のため member_type だけ残す）
    new_member_type = changes.pop("member_type",  None)
    new_course_name = changes.pop("course_name",  None)
    new_course_fee  = changes.pop("course_fee",   None)

    # reglimit_date の早期更新判定（フライヤー登録期限）
    new_limit_str = changes.pop("reglimit_date", None)

    # 残りの info_changes を members に反映
    if changes:
        _apply_fields_from_json(member, changes)

    if new_limit_str:
        new_limit = _parse_date(new_limit_str)
        flyer = MemberFlyer.get_or_create(member.id)
        if flyer.reglimit_date and flyer.reglimit_date > today:
            # 早期更新: 現期限が残っている → next_reglimit_date にセット
            flyer.next_reglimit_date = new_limit
        else:
            flyer.reglimit_date      = new_limit
            flyer.next_reglimit_date = None

    member.updated_at = datetime.utcnow()

    # ── ② member_courses にコース履歴レコードを追加 ───────────────
    if new_member_type:
        confirmed_by = req_data.get("confirmed_by", "staff")

        # 現在有効なコースを終了させる
        current_course = MemberCourse.get_current(member.id)
        if current_course:
            # 新コース開始日の前日を終了日にセット
            start = member.confirmed_at or today
            current_course.expire(end_date=start)

        # 新コースレコードを追加
        new_course = MemberCourse(
            member_id      = member.id,
            member_type    = new_member_type,
            course_name    = new_course_name,
            course_fee     = new_course_fee,
            start_date     = member.confirmed_at or today,
            end_date       = None,          # 現在有効
            status         = 'active',
            confirmed_by   = confirmed_by,
            application_id = app_rec.id,
        )
        db.session.add(new_course)

    # ── ③ 申請レコードを承認済みに更新 ───────────────────────────
    app_rec.app_status   = 'approved'
    app_rec.confirmed_at = datetime.utcnow()
    app_rec.confirmed_by = req_data.get("confirmed_by", "staff")

    db.session.commit()
    return jsonify({"status": "ok"})


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
    # まず pending を探す
    app_rec = (
        MemberApplication.query
        .filter_by(member_id=member_id, app_status='pending')
        .order_by(MemberApplication.applied_at.desc())
        .first()
    )

    # pending がなければ最新の承認・却下済みを返す（表示用）
    if not app_rec:
        app_rec = (
            MemberApplication.query
            .filter_by(member_id=member_id)
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


def _daily_member_check():
    if _member_flask_app is None:
        return
    with _member_flask_app.app_context():
        today   = date.today()
        targets = Member.query.filter(Member.member_status == 'active').all()

        changed = 0
        for m in targets:
            # member_flyers から期限情報を取得
            f = m.flyer
            if not f:
                continue  # フライヤー情報なしはスキップ

            reglimit      = f.reglimit_date
            next_reglimit = f.next_reglimit_date

            # ① 早期更新の適用日到来
            if next_reglimit and reglimit and reglimit <= today:
                f.reglimit_date      = next_reglimit
                f.next_reglimit_date = None
                f.updated_at         = datetime.utcnow()
                changed += 1

            # ② 期限切れ → ビジターに自動変更
            elif reglimit and reglimit < today and not next_reglimit:
                m.member_status = 'visitor'
                current_course = MemberCourse.get_current(m.id)
                if current_course:
                    current_course.expire(end_date=today)
                db.session.add(MemberCourse(
                    member_id    = m.id,
                    member_type  = 'ビジター',
                    start_date   = today,
                    status       = 'active',
                    confirmed_by = 'system',
                ))
                changed += 1

        if changed:
            db.session.commit()
        print(f"[daily_member_check] {today} 処理件数: {changed}")


def init_member_scheduler(app):
    global _member_flask_app
    _member_flask_app = app

    scheduler = BackgroundScheduler(timezone="Asia/Tokyo")
    scheduler.add_job(
        _daily_member_check,
        trigger=CronTrigger(hour=0, minute=5, timezone="Asia/Tokyo"),
        id="daily_member_check",
        replace_existing=True,
    )
    scheduler.start()
    return scheduler


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
# ★ 改定７：案内メール共通ヘルパー
# =========================================

def _get_mail_config_values(item_name):
    """config_master カテゴリ「メール関連」から item_name に一致する
    config_values を sort_order 順で返す"""
    rows = db.session.execute(text("""
        SELECT cv.value, cv.label, cv.sort_order
        FROM config_master cm
        JOIN config_values cv ON cv.master_id = cm.id
        WHERE cm.category = 'メール関連'
          AND cm.item_name = :item_name
          AND cv.is_active = TRUE
        ORDER BY cv.sort_order, cv.id
    """), {"item_name": item_name}).fetchall()
    return [dict(r._mapping) for r in rows]


def _build_mail_preview(member_id):
    """
    会員IDからメールプレビュー用の辞書を生成して返す。
    エラー時は (None, エラーメッセージ, HTTPステータス) を返す。
    正常時は (dict, None, None) を返す。
    """
    member = Member.query.get(member_id)
    if not member:
        return None, "会員が見つかりません", 404

    contact = MemberContact.query.filter_by(member_id=member.id).first()
    to_email = (contact.email or "").strip() if contact else ""
    full_name = (member.full_name or "").strip()

    # 送信元（複数対応：labelがあればラベル付き、なければvalueをそのまま）
    sender_vals = _get_mail_config_values("送信元")
    if not sender_vals:
        return None, "設定管理に「送信元」が登録されていません", 500
    from_emails = [
        {"value": v["value"].strip(), "label": (v["label"] or v["value"]).strip()}
        for v in sender_vals
        if v["value"] and v["value"].strip()
    ]
    if not from_emails:
        return None, "設定管理に有効な「送信元」が登録されていません", 500

    # 件名（なければデフォルト）
    subject_vals = _get_mail_config_values("件名")
    subject = subject_vals[0]["value"].strip() if subject_vals else "ご案内"

    # 案内（本文テンプレート）
    body_vals = _get_mail_config_values("案内")
    if not body_vals:
        return None, "設定管理に「案内」が登録されていません", 500
    body_template = body_vals[0]["value"] or ""

    # 署名（sort_order 順に連結）
    sign_vals = _get_mail_config_values("署名")
    signature_lines = [v["value"] for v in sorted(sign_vals, key=lambda x: x["sort_order"])]
    signature_text = "\n".join(signature_lines)

    # 本文組み立て: 「氏名 様」+ 空行 + テンプレート + 空行 + 署名
    greeting = f"{full_name} 様"
    body = f"{greeting}\n\n{body_template}\n\n{signature_text}"

    return {
        "from_emails": from_emails,
        "to_email":    to_email,
        "subject":     subject,
        "body":        body,
        "full_name":   full_name,
    }, None, None


# ── メールプレビュー取得 ─────────────────────────────────────────────
# GET /api/members/<member_id>/mail_preview
# 設定管理の値を元に組み立てたメール内容（送信元・送信先・件名・本文）を返す。
# フロント側がプレビューモーダルに表示し、スタッフが編集してから送信ボタンを押す。
@member_bp.route("/api/members/<int:member_id>/mail_preview", methods=["GET"])
def mail_preview(member_id):
    preview, err, status = _build_mail_preview(member_id)
    if err:
        return jsonify({"error": err}), status
    if not preview["to_email"]:
        return jsonify({"error": "メールアドレスが登録されていません"}), 400
    return jsonify(preview)


# ── 案内メール送信 ───────────────────────────────────────────────────
# POST /api/members/<member_id>/send_info
# リクエストボディ JSON:
#   { "from_email": "...", "to_email": "...", "subject": "...", "body": "..." }
# スタッフがプレビューモーダルで内容を確認・編集した後に呼び出す。
#
# SMTP設定は環境変数から取得:
#   MAIL_SERVER  (default: localhost)
#   MAIL_PORT    (default: 587)
#   MAIL_USE_TLS (default: true)
#   MAIL_USERNAME
#   MAIL_PASSWORD
@member_bp.route("/api/members/<int:member_id>/send_info", methods=["POST"])
def send_info(member_id):
    member = Member.query.get(member_id)
    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    data       = request.get_json(silent=True) or {}
    from_email = (data.get("from_email") or "").strip()
    to_email   = (data.get("to_email")   or "").strip()
    subject    = (data.get("subject")    or "").strip()
    body       = (data.get("body")       or "").strip()

    if not from_email:
        return jsonify({"error": "送信元が指定されていません"}), 400
    if not to_email:
        return jsonify({"error": "送信先が指定されていません"}), 400
    if not subject:
        return jsonify({"error": "件名が指定されていません"}), 400

    # ── SMTP 送信 ─────────────────────────────────────────────────
    # MAIL_BACKEND=dummy の場合は実際には送信せずログ出力のみ（ローカル開発用）
    mail_backend  = os.environ.get("MAIL_BACKEND", "smtp").lower()
    mail_server   = os.environ.get("MAIL_SERVER",   "")
    mail_port     = int(os.environ.get("MAIL_PORT", 587))
    use_tls       = os.environ.get("MAIL_USE_TLS", "true").lower() != "false"
    mail_user     = os.environ.get("MAIL_USERNAME", "")
    mail_password = os.environ.get("MAIL_PASSWORD", "")

    if mail_backend == "dummy":
        # ── ダミー送信（ローカル開発用）─────────────────────────
        print("=" * 60)
        print("[MAIL DUMMY] ダミー送信（実際には送信されていません）")
        print(f"  From   : {from_email}")
        print(f"  To     : {to_email}")
        print(f"  Subject: {subject}")
        print("  Body   :")
        print(body)
        print("=" * 60)
    else:
        # ── SMTP 実送信 ───────────────────────────────────────────
        if not mail_server:
            return jsonify({"error": "MAIL_SERVER が設定されていません。Renderの環境変数を確認してください。"}), 500
        try:
            msg = MIMEMultipart()
            msg["From"]    = from_email
            msg["To"]      = to_email
            msg["Subject"] = Header(subject, "utf-8")
            msg.attach(MIMEText(body, "plain", "utf-8"))

            if use_tls:
                smtp = smtplib.SMTP(mail_server, mail_port, timeout=10)
                smtp.ehlo()
                smtp.starttls()
            else:
                smtp = smtplib.SMTP_SSL(mail_server, mail_port, timeout=10)

            if mail_user and mail_password:
                smtp.login(mail_user, mail_password)

            smtp.sendmail(from_email, [to_email], msg.as_bytes())
            smtp.quit()

        except Exception as e:
            return jsonify({"error": f"メール送信に失敗しました: {str(e)}"}), 500

    full_name = (member.full_name or "").strip()
    return jsonify({
        "ok":      True,
        "to":      to_email,
        "subject": subject,
        "message": f"{full_name} 様にメールを送信しました",
    })


# =========================================
# エラーハンドラ
# =========================================

@member_bp.errorhandler(400)
def bad_request(e):
    return jsonify({"error": str(e.description)}), 400

@member_bp.errorhandler(404)
def not_found(e):
    return jsonify({"error": "対象が見つかりません"}), 404
