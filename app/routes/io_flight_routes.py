"""
io_flight_routes.py  –  入下山管理 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem

改定: 2026-03-24
  - /api/io/lookup_by_name  : 氏名（部分一致）で会員候補を返す
  - /api/io/verify_pass     : 携帯番号下4桁でPASSコード認証する
"""

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.io_flight import IoFlight
from app.models.member import Member
from app.models.member_flyer import MemberFlyer
from app.models.member_course import MemberCourse
from app.models.member_contact import MemberContact
from datetime import date, datetime, timedelta
from sqlalchemy import func, extract
import uuid as uuidlib

io_bp = Blueprint("io_flight", __name__)


# ─────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────

def _check_expiry(target_date: date | None) -> str:
    if not target_date:
        return "none"
    today = date.today()
    if target_date < today:
        return "expired"
    if target_date <= today + timedelta(days=31):
        return "warning"
    return "ok"


def _repack_limit(member: Member) -> date | None:
    flyer = member.flyer  # backref 経由で MemberFlyer を取得
    if not flyer or not flyer.repack_date:
        return None
    rd = flyer.repack_date
    try:
        return rd.replace(year=rd.year + 1)
    except ValueError:
        return rd.replace(year=rd.year + 1, day=28)


def _get_current_course(member: Member) -> MemberCourse | None:
    """現在有効なコースを取得"""
    return MemberCourse.get_current(member.id)


def _fd(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _record_to_dict(r: IoFlight) -> dict:
    """IoFlight レコードを辞書に変換"""
    return {
        "id":             r.id,
        "member_number":  r.member_number,
        "uuid":           str(r.uuid) if r.uuid else None,
        "member_class":   r.member_class,
        "full_name":      r.full_name,
        "course_name":    r.course_name,
        "reg_no":         r.reg_no,
        "reglimit_date":  _fd(r.reglimit_date),
        "license":        r.license,
        "glider_name":    r.glider_name,
        "glider_color":   r.glider_color,
        "repack_date":    _fd(r.repack_date),
        "insurance_type": r.insurance_type,
        "radio_type":     r.radio_type,
        "entry_date":     r.entry_date.isoformat() if r.entry_date else None,
        "in_time":        r.in_time.strftime("%H:%M") if r.in_time else None,
        "out_time":       r.out_time.strftime("%H:%M") if r.out_time else None,
        "status":         "下山済" if r.out_time else "入山中",
        "yamachin":           r.yamachin,
        "comment":            r.comment or "",
        "entrance_fee_paid":   r.entrance_fee_paid,
        "yamachin_confirmed": r.yamachin_confirmed,
    }


def _apply_class_filter(query, class_filter: str):
    """分類フィルターを適用（allの場合は無視）"""
    if class_filter and class_filter != "all":
        query = query.filter(IoFlight.member_class.ilike(f"%{class_filter}%"))
    return query


def _period_cutoff(period: str) -> date | None:
    """期間文字列から開始日を返す。'all' の場合は None（全期間）"""
    if period == "all":
        return None
    periods = {"1y": 365, "6m": 183, "3m": 91}
    days = periods.get(period, 91)
    return date.today() - timedelta(days=days)


# ═════════════════════════════════════════
# 既存ルート
# ═════════════════════════════════════════

@io_bp.route("/apply_io")
def io_index():
    today   = date.today()
    records = (
        IoFlight.query
        .filter_by(entry_date=today)
        .order_by(IoFlight.in_time)
        .all()
    )
    return render_template("入下山.html", records=records, today=today)


# ─────────────────────────────────────────
# ★ 新規 API: 氏名（部分一致）で会員候補を返す
# ─────────────────────────────────────────
# POST /api/io/lookup_by_name
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
#   - member_status が 'active' または 'visitor' の会員のみ返す
#   - 最大10件に制限
@io_bp.route("/api/io/lookup_by_name", methods=["POST"])
def api_lookup_by_name():
    data  = request.get_json(silent=True) or {}
    name  = (data.get("name") or "").strip()

    if not name:
        return jsonify({"error": "氏名を入力してください"}), 400

    if len(name) < 1:
        return jsonify({"error": "氏名を1文字以上入力してください"}), 400

    members = (
        Member.query
        .filter(
            Member.full_name.ilike(f"%{name}%"),
            Member.member_status.in_(["active", "visitor"]),
        )
        .order_by(Member.full_name)
        .limit(10)
        .all()
    )

    if not members:
        return jsonify({"error": "該当する会員が見つかりません"}), 404

    result = []
    for m in members:
        result.append({
            "member_number": m.member_number,
            "full_name":     m.full_name,
            "birthday":      m.birthday.isoformat() if m.birthday else None,
        })

    return jsonify({"members": result})


# ─────────────────────────────────────────
# ★ 新規 API: PASSコード認証（携帯番号下4桁）
# ─────────────────────────────────────────
# POST /api/io/verify_pass
# リクエスト JSON: { "member_number": "0001", "pass_code": "1234" }
# レスポンス JSON:
#   成功: { "ok": true, "member_number": "0001" }
#   失敗: 401 { "error": "PASSコードが正しくありません" }
#
# 認証ロジック:
#   - member_contacts.mobile_phone の末尾4桁と一致すれば認証成功
#   - mobile_phone が未登録の場合は認証不可（エラー）
#   - 入力は半角数字4桁のみ受け付ける
@io_bp.route("/api/io/verify_pass", methods=["POST"])
def api_verify_pass():
    data          = request.get_json(silent=True) or {}
    member_number = (data.get("member_number") or "").strip()
    pass_code     = (data.get("pass_code") or "").strip()

    # バリデーション
    if not member_number:
        return jsonify({"error": "会員番号が指定されていません"}), 400
    if not pass_code or not pass_code.isdigit() or len(pass_code) != 4:
        return jsonify({"error": "PASSコードは半角数字4桁で入力してください"}), 400

    # 会員取得
    member = Member.query.filter_by(member_number=member_number).first()
    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    # 連絡先取得
    contact = MemberContact.query.filter_by(member_id=member.id).first()
    if not contact or not contact.mobile_phone:
        return jsonify({"error": "携帯番号が登録されていないため認証できません。スタッフにお声がけください。"}), 401

    # 携帯番号から数字のみ抽出して末尾4桁と比較
    mobile_digits = ''.join(c for c in contact.mobile_phone if c.isdigit())
    if len(mobile_digits) < 4:
        return jsonify({"error": "登録されている携帯番号が不正なため認証できません。スタッフにお声がけください。"}), 401

    if mobile_digits[-4:] != pass_code:
        return jsonify({"error": "PASSコードが正しくありません"}), 401

    return jsonify({"ok": True, "member_number": member.member_number})


# ─────────────────────────────────────────
# 既存: 会員番号 or UUID で会員情報を返す
# ─────────────────────────────────────────

@io_bp.route("/api/io/lookup", methods=["POST"])
def api_lookup():
    data  = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()

    if not query:
        return jsonify({"error": "検索キーワードを入力してください"}), 400

    member = None
    try:
        uuid_obj = uuidlib.UUID(query)
        member = Member.query.filter_by(uuid=str(uuid_obj)).first()
    except ValueError:
        member = Member.query.filter_by(member_number=query).first()

    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    today      = date.today()
    flyer      = member.flyer   # MemberFlyer（backref）
    course     = _get_current_course(member)  # MemberCourse（現在有効）
    repack_lim = _repack_limit(member)
    existing   = IoFlight.query.filter_by(uuid=member.uuid, entry_date=today).first()

    return jsonify({
        "member_number":  member.member_number,
        "uuid":           member.uuid,
        "full_name":      member.full_name,
        "member_type":    course.member_type  if course else None,
        "course_name":    course.course_name  if course else None,
        "reg_no":         flyer.reg_no        if flyer  else None,
        "reglimit_date":  _fd(flyer.reglimit_date)  if flyer else None,
        "license":        flyer.license       if flyer  else None,
        "glider_name":    flyer.glider_name   if flyer  else None,
        "glider_color":   flyer.glider_color  if flyer  else None,
        "repack_date":    _fd(flyer.repack_date) if flyer else None,
        "repack_limit":   _fd(repack_lim),
        "license_status": _check_expiry(flyer.reglimit_date if flyer else None),
        "repack_status":  _check_expiry(repack_lim),
        "already_in":     existing is not None,
        "already_out":    existing.out_time is not None if existing else False,
        "io_flight_id":   existing.id if existing else None,
        "in_time":        existing.in_time.strftime("%H:%M") if existing and existing.in_time else None,
        "out_time":       existing.out_time.strftime("%H:%M") if existing and existing.out_time else None,
    })


@io_bp.route("/api/io/checkin", methods=["POST"])
def api_checkin():
    data   = request.get_json(silent=True) or {}
    member = Member.query.filter(
        (Member.member_number == (data.get("member_number") or "")) |
        (Member.uuid          == (data.get("uuid") or ""))
    ).first()

    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    today    = date.today()
    existing = IoFlight.query.filter_by(uuid=member.uuid, entry_date=today).first()
    now      = datetime.now()

    if existing:
        if existing.out_time:
            return jsonify({"error": "本日の退場記録が既にあります"}), 400
        existing.out_time = now
        db.session.commit()
        return jsonify({
            "action":   "checkout",
            "out_time": now.strftime("%H:%M"),
            "message":  f"{member.full_name} さんの下山を記録しました",
        })

    repack_lim = _repack_limit(member)
    flyer      = member.flyer
    course     = _get_current_course(member)
    record = IoFlight(
        member_number  = member.member_number,
        uuid           = member.uuid,
        member_class   = data.get("member_class") or (course.member_type if course else None),
        full_name      = member.full_name,
        course_name    = data.get("course_name")  or (course.course_name if course else None),
        reg_no         = flyer.reg_no        if flyer else None,
        reglimit_date  = flyer.reglimit_date  if flyer else None,
        license        = flyer.license        if flyer else None,
        glider_name    = data.get("glider_name")  or (flyer.glider_name  if flyer else None),
        glider_color   = data.get("glider_color") or (flyer.glider_color if flyer else None),
        repack_date    = repack_lim,
        insurance_type = data.get("insurance_type"),
        radio_type     = data.get("radio_type"),
        entry_date     = today,
        in_time        = now,
    )
    db.session.add(record)
    db.session.commit()

    return jsonify({
        "action":       "checkin",
        "in_time":      now.strftime("%H:%M"),
        "message":      f"{member.full_name} さんの入山を記録しました",
        "io_flight_id": record.id,
    })


# ═════════════════════════════════════════
# 新規ルート：入下山管理画面
# ═════════════════════════════════════════

@io_bp.route("/apply_io_info")
def io_info_index():
    return render_template("入下山管理.html")


# ─── 氏名サジェスト（部分一致） ────────────
# GET /api/io/info/member_suggest?q=氏名
# io_flight テーブルから部分一致で候補を返す
# （実際に入山記録のある人のみ＋ members テーブルも参照して uuid・分類を補完）
@io_bp.route("/api/io/info/member_suggest")
def api_io_member_suggest():
    q_str = (request.args.get("q", "") or "").strip()
    if not q_str:
        return jsonify({"members": []})

    # io_flight から氏名部分一致で uuid・分類を取得（重複排除）
    rows = (
        db.session.query(
            IoFlight.full_name,
            IoFlight.uuid,
            IoFlight.member_number,
            IoFlight.member_class,
        )
        .filter(IoFlight.full_name.ilike(f"%{q_str}%"))
        .distinct(IoFlight.uuid)
        .order_by(IoFlight.uuid, IoFlight.full_name)
        .limit(20)
        .all()
    )

    # uuid ごとに1件に絞る（同一人物の重複を排除）
    seen_uuid = set()
    members   = []
    for row in rows:
        key = str(row.uuid) if row.uuid else row.full_name
        if key in seen_uuid:
            continue
        seen_uuid.add(key)
        members.append({
            "full_name":     row.full_name,
            "uuid":          str(row.uuid) if row.uuid else "",
            "member_number": row.member_number or "",
            "member_class":  row.member_class  or "",
        })

    return jsonify({"members": members})


# ─── 日別レコード取得 ────────────────────
@io_bp.route("/api/io/info/daily")
def api_io_daily():
    date_str     = request.args.get("date")
    class_filter = request.args.get("filter", "all")

    try:
        target_date = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        target_date = date.today()

    q = IoFlight.query.filter_by(entry_date=target_date)
    q = _apply_class_filter(q, class_filter)
    records = q.order_by(IoFlight.in_time).all()

    total     = len(records)
    in_count  = sum(1 for r in records if not r.out_time)
    out_count = total - in_count

    return jsonify({
        "date":      target_date.isoformat(),
        "total":     total,
        "in_count":  in_count,
        "out_count": out_count,
        "records":   [_record_to_dict(r) for r in records],
    })


# ─── 月別カレンダーデータ（フィルター対応） ──
@io_bp.route("/api/io/info/calendar")
def api_io_calendar():
    """
    指定月の日別集計を返す。
    filter = all | 会員 | スクール | ビジター  （分類フィルター）
    type   = all | yamachin | comment | member  （特殊フィルター）
    period = 3m | 6m | 1y
    query  = 会員番号 or UUID  （type=member の場合）
    """
    today = date.today()
    try:
        year  = int(request.args.get("year",  today.year))
        month = int(request.args.get("month", today.month))
    except ValueError:
        year, month = today.year, today.month

    class_filter = request.args.get("filter", "all")
    filter_type  = request.args.get("type",   "all")
    period       = request.args.get("period", "3m")
    member_query = (request.args.get("query", "") or "").strip()

    # 月範囲の基本フィルター
    q = IoFlight.query.filter(
        extract("year",  IoFlight.entry_date) == year,
        extract("month", IoFlight.entry_date) == month,
    )

    # 特殊フィルター適用
    if filter_type == "yamachin":
        q = q.filter(IoFlight.yamachin == True)  # noqa: E712
    elif filter_type == "comment":
        q = q.filter(IoFlight.comment.isnot(None), IoFlight.comment != "")
    elif filter_type == "member":
        q = _apply_class_filter(q, class_filter)
        if member_query:
            try:
                uuid_obj = uuidlib.UUID(member_query)
                q = q.filter(IoFlight.uuid == uuid_obj)
            except ValueError:
                q = q.filter(IoFlight.member_number == member_query)
        cutoff = _period_cutoff(period)
        if cutoff:
            q = q.filter(IoFlight.entry_date >= cutoff)
    else:
        q = _apply_class_filter(q, class_filter)

    id_subq = [r.id for r in q.with_entities(IoFlight.id)]

    rows = (
        db.session.query(
            IoFlight.entry_date,
            func.count(IoFlight.id).label("cnt"),
            func.sum(func.cast(IoFlight.yamachin, db.Integer)).label("yamachin_cnt"),
        )
        .filter(IoFlight.id.in_(id_subq))
        .group_by(IoFlight.entry_date)
        .all()
    )

    days = {}
    month_total = 0
    for row in rows:
        days[row.entry_date.isoformat()] = {
            "count":        row.cnt,
            "yamachin_cnt": int(row.yamachin_cnt or 0),
        }
        month_total += row.cnt

    return jsonify({
        "year":        year,
        "month":       month,
        "month_total": month_total,
        "days":        days,
    })


# ─── 日付クリック：その日の入山者リスト ───
@io_bp.route("/api/io/info/date-members")
def api_io_date_members():
    date_str     = request.args.get("date")
    class_filter = request.args.get("filter", "all")
    filter_type  = request.args.get("type",   "all")
    member_query = (request.args.get("query", "") or "").strip()

    try:
        target_date = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        target_date = date.today()

    q = IoFlight.query.filter_by(entry_date=target_date)

    if filter_type == "yamachin":
        q = q.filter(IoFlight.yamachin == True)  # noqa: E712
    elif filter_type == "comment":
        q = q.filter(IoFlight.comment.isnot(None), IoFlight.comment != "")
    elif filter_type == "member":
        q = _apply_class_filter(q, class_filter)
        if member_query:
            try:
                uuid_obj = uuidlib.UUID(member_query)
                q = q.filter(IoFlight.uuid == uuid_obj)
            except ValueError:
                q = q.filter(IoFlight.member_number == member_query)
    else:
        q = _apply_class_filter(q, class_filter)

    records = q.order_by(IoFlight.in_time).all()

    return jsonify({
        "date":    target_date.isoformat(),
        "members": [_record_to_dict(r) for r in records],
    })


# ─── 山チン・備考 更新 ────────────────────
@io_bp.route("/api/io/info/record/<int:record_id>", methods=["PUT"])
def api_io_update_record(record_id):
    data   = request.get_json(silent=True) or {}
    record = IoFlight.query.get(record_id)

    if not record:
        return jsonify({"error": "レコードが見つかりません"}), 404

    if "yamachin" in data:
        record.yamachin = bool(data["yamachin"])
    if "comment" in data:
        record.comment = data["comment"] or None
    if "entrance_fee_paid" in data:
        record.entrance_fee_paid = bool(data["entrance_fee_paid"])
    if "yamachin_confirmed" in data:
        record.yamachin_confirmed = bool(data["yamachin_confirmed"])

    db.session.commit()
    return jsonify({"message": "更新しました", "record": _record_to_dict(record)})


# ─── 特殊フィルター（山チン・備考・個人） ─
@io_bp.route("/api/io/info/special")
def api_io_special():
    filter_type  = request.args.get("type",   "yamachin")
    period       = request.args.get("period",  "3m")
    class_filter = request.args.get("filter",  "all")
    member_query = (request.args.get("query",  "") or "").strip()
    member_uuid  = (request.args.get("uuid",   "") or "").strip()

    cutoff = _period_cutoff(period)  # None = 全期間

    q = IoFlight.query
    if cutoff:
        q = q.filter(IoFlight.entry_date >= cutoff)

    if filter_type == "yamachin":
        # 山チン：全期間・全員
        q = q.filter(IoFlight.yamachin == True)  # noqa: E712

    elif filter_type == "comment":
        # 備考あり：全期間・全員
        q = q.filter(IoFlight.comment.isnot(None), IoFlight.comment != "")

    elif filter_type.startswith("member"):
        # 個人系フィルター：特定の人物に絞る
        # まず対象人物を特定（uuid 優先、なければ氏名）
        if member_uuid:
            try:
                uuid_obj = uuidlib.UUID(member_uuid)
                q = q.filter(IoFlight.uuid == uuid_obj)
            except ValueError:
                pass
        elif member_query:
            q = q.filter(IoFlight.full_name.ilike(f"%{member_query}%"))
        else:
            return jsonify({"error": "氏名を入力してください"}), 400

        # subtype による追加絞り込み
        if filter_type == "member_yamachin":
            q = q.filter(IoFlight.yamachin == True)  # noqa: E712
        elif filter_type == "member_comment":
            q = q.filter(IoFlight.comment.isnot(None), IoFlight.comment != "")
        elif filter_type == "member_yama_comment":
            from sqlalchemy import or_
            q = q.filter(or_(
                IoFlight.yamachin == True,  # noqa: E712
                (IoFlight.comment.isnot(None) & (IoFlight.comment != "")),
            ))
        # "member" のみ（チェックなし）は追加フィルターなし

    records = q.order_by(IoFlight.entry_date.desc(), IoFlight.in_time).all()

    return jsonify({
        "type":    filter_type,
        "period":  period,
        "count":   len(records),
        "records": [_record_to_dict(r) for r in records],
    })
