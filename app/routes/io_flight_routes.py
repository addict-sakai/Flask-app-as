"""
io_flight_routes.py  –  入下山管理 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem
"""

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.io_flight import IoFlight
from app.models.member import Member
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
    if not member.repack_date:
        return None
    rd = member.repack_date
    try:
        return rd.replace(year=rd.year + 1)
    except ValueError:
        return rd.replace(year=rd.year + 1, day=28)


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
        "yamachin":       r.yamachin,
        "comment":        r.comment or "",
    }


def _apply_class_filter(query, class_filter: str):
    """分類フィルターを適用（allの場合は無視）"""
    if class_filter and class_filter != "all":
        query = query.filter(IoFlight.member_class.ilike(f"%{class_filter}%"))
    return query


def _period_cutoff(period: str) -> date:
    """期間文字列から開始日を返す"""
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
    repack_lim = _repack_limit(member)
    existing   = IoFlight.query.filter_by(uuid=member.uuid, entry_date=today).first()

    return jsonify({
        "member_number":  member.member_number,
        "uuid":           member.uuid,
        "full_name":      member.full_name,
        "member_type":    member.member_type,
        "course_name":    member.course_name,
        "reg_no":         member.reg_no,
        "reglimit_date":  _fd(member.reglimit_date),
        "license":        member.license,
        "glider_name":    member.glider_name,
        "glider_color":   member.glider_color,
        "repack_date":    _fd(member.repack_date),
        "repack_limit":   _fd(repack_lim),
        "license_status": _check_expiry(member.reglimit_date),
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
    record = IoFlight(
        member_number  = member.member_number,
        uuid           = member.uuid,
        member_class   = data.get("member_class") or member.member_type,
        full_name      = member.full_name,
        course_name    = data.get("course_name")  or member.course_name,
        reg_no         = member.reg_no,
        reglimit_date  = member.reglimit_date,
        license        = member.license,
        glider_name    = data.get("glider_name")  or member.glider_name,
        glider_color   = data.get("glider_color") or member.glider_color,
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
        q = q.filter(IoFlight.entry_date >= cutoff)
    else:
        # 通常の分類フィルターのみ
        q = _apply_class_filter(q, class_filter)

    # id リストで日別集計
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
    """
    指定日の入山者リストを返す。現在のフィルター状態を反映する。
    filter = all | 会員 | スクール | ビジター
    type   = all | yamachin | comment | member
    query  = 会員番号 or UUID（type=member の場合）
    """
    date_str     = request.args.get("date")
    class_filter = request.args.get("filter", "all")
    filter_type  = request.args.get("type",   "all")
    member_query = (request.args.get("query", "") or "").strip()

    try:
        target_date = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        target_date = date.today()

    q = IoFlight.query.filter_by(entry_date=target_date)

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
    else:
        # 通常の分類フィルターのみ
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

    db.session.commit()
    return jsonify({"message": "更新しました", "record": _record_to_dict(record)})


# ─── 特殊フィルター（山チン・備考・個人） ─
@io_bp.route("/api/io/info/special")
def api_io_special():
    """
    特殊フィルター結果を返す
    Query:
      type   = yamachin | comment | member
      period = 1y | 6m | 3m
      filter = all | 会員 | スクール | ビジター  ※ type=yamachin/comment の場合は無視（全件）
      query  = 会員番号またはUUID文字列（type=member の場合）
    """
    filter_type  = request.args.get("type",   "yamachin")
    period       = request.args.get("period",  "3m")
    class_filter = request.args.get("filter",  "all")
    member_query = (request.args.get("query",  "") or "").strip()

    cutoff = _period_cutoff(period)
    q      = IoFlight.query.filter(IoFlight.entry_date >= cutoff)

    if filter_type == "yamachin":
        # 山チン・備考はクラスフィルターを適用しない（全員対象）
        q = q.filter(IoFlight.yamachin == True)  # noqa: E712

    elif filter_type == "comment":
        # 山チン・備考はクラスフィルターを適用しない（全員対象）
        q = q.filter(IoFlight.comment.isnot(None), IoFlight.comment != "")

    elif filter_type == "member":
        # 個人検索はクラスフィルターを適用する
        q = _apply_class_filter(q, class_filter)

        if not member_query:
            return jsonify({"error": "会員番号またはQRコードを入力してください"}), 400

        # UUID形式かどうかで分岐
        try:
            uuid_obj = uuidlib.UUID(member_query)
            # as_uuid=True の場合は UUID オブジェクトで比較
            q = q.filter(IoFlight.uuid == uuid_obj)
        except ValueError:
            # 会員番号（文字列）で検索
            q = q.filter(IoFlight.member_number == member_query)

    records = q.order_by(IoFlight.entry_date.desc(), IoFlight.in_time).all()

    return jsonify({
        "type":    filter_type,
        "period":  period,
        "count":   len(records),
        "records": [_record_to_dict(r) for r in records],
    })
