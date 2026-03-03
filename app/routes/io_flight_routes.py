"""
io_flight_routes.py  –  入下山管理 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem
"""

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.io_flight import IoFlight
from app.models.member import Member
from datetime import date, datetime, timedelta

io_bp = Blueprint("io_flight", __name__)


# ─────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────

def _check_expiry(target_date: date | None) -> str:
    """
    期限チェック
    Returns: 'expired' | 'warning'（1ヶ月以内）| 'ok' | 'none'
    """
    if not target_date:
        return "none"
    today = date.today()
    if target_date < today:
        return "expired"
    if target_date <= today + timedelta(days=31):
        return "warning"
    return "ok"


def _repack_limit(member: Member) -> date | None:
    """リパック期限 = repack_date の翌年同日"""
    if not member.repack_date:
        return None
    rd = member.repack_date
    try:
        return rd.replace(year=rd.year + 1)
    except ValueError:
        # 2月29日などのうるう年対応
        return rd.replace(year=rd.year + 1, day=28)


def _fd(d: date | None) -> str | None:
    return d.isoformat() if d else None


# ─────────────────────────────────────────
# ページルート
# ─────────────────────────────────────────

@io_bp.route("/apply_io")
def io_index():
    """入下山管理ページ（当日分のリストを初期描画）"""
    today   = date.today()
    records = (
        IoFlight.query
        .filter_by(entry_date=today)
        .order_by(IoFlight.in_time)
        .all()
    )
    return render_template("入下山.html", records=records, today=today)


# ─────────────────────────────────────────
# API: 会員検索
# ─────────────────────────────────────────

import uuid as uuidlib

@io_bp.route("/api/io/lookup", methods=["POST"])
def api_lookup():
    data  = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()

    if not query:
        return jsonify({"error": "検索キーワードを入力してください"}), 400

    member = None

    # ① UUID形式ならUUID検索
    try:
        uuid_obj = uuidlib.UUID(query)
        member = Member.query.filter_by(uuid=str(uuid_obj)).first()
    except ValueError:
        # UUIDでなければ会員番号検索
        member = Member.query.filter_by(member_number=query).first()

    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404
    
    today    = date.today()
    repack_lim = _repack_limit(member)

    license_status = _check_expiry(member.reglimit_date)
    repack_status  = _check_expiry(repack_lim)

    # 当日の入下山記録を確認
    existing = IoFlight.query.filter_by(
        uuid=member.uuid, entry_date=today
    ).first()

    return jsonify({
        # 会員基本情報
        "member_number": member.member_number,
        "uuid":          member.uuid,
        "full_name":     member.full_name,
        "member_type":   member.member_type,
        "course_name":   member.course_name,
        "reg_no":        member.reg_no,
        "reglimit_date": _fd(member.reglimit_date),
        "license":       member.license,
        "glider_name":   member.glider_name,
        "glider_color":  member.glider_color,
        "repack_date":   _fd(member.repack_date),
        "repack_limit":  _fd(repack_lim),
        # 期限ステータス
        "license_status": license_status,
        "repack_status":  repack_status,
        # 当日記録
        "already_in":    existing is not None,
        "already_out":   existing.out_time is not None if existing else False,
        "io_flight_id":  existing.id if existing else None,
        "in_time":       existing.in_time.strftime("%H:%M") if existing and existing.in_time else None,
        "out_time":      existing.out_time.strftime("%H:%M") if existing and existing.out_time else None,
    })


# ─────────────────────────────────────────
# API: 入山 / 下山
# ─────────────────────────────────────────

@io_bp.route("/api/io/checkin", methods=["POST"])
def api_checkin():
    """
    入山 or 下山を記録する。
    - 当日記録なし → 入山（io_flight に INSERT）
    - 当日記録あり・out_time なし → 下山（out_time を UPDATE）

    Request JSON:
    {
      "member_number": "...",
      "uuid": "...",
      "member_class": "...",
      "course_name":  "...",
      "glider_name":  "...",
      "glider_color": "...",
      "insurance_type": "1日 | 年間 | 個人",
      "radio_type":   "..."
    }
    """
    data = request.get_json(silent=True) or {}

    # 会員を特定
    member = Member.query.filter(
        (Member.member_number == (data.get("member_number") or "")) |
        (Member.uuid          == (data.get("uuid") or ""))
    ).first()

    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    today    = date.today()
    existing = IoFlight.query.filter_by(
        uuid=member.uuid, entry_date=today
    ).first()

    now = datetime.now()

    # ── 下山 ──
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

    # ── 入山 ──
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
