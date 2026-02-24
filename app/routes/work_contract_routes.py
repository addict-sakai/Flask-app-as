"""
work_contract_routes.py  –  請負出勤可能予定 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem
"""

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.work_contract import WorkContract
from app.models.member import Member
from datetime import date, datetime, timedelta
from typing import Optional
import uuid as uuidlib
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

work_bp = Blueprint("work_contract", __name__)


# ─────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────

def _fd(d) -> Optional[str]:
    return d.isoformat() if d else None


def _valid_range():
    """登録可能範囲: 当月1日 〜 3ヶ月後末日"""
    today = date.today()
    start = today.replace(day=1)
    # 3ヶ月後の月末
    m = today.month + 3
    y = today.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    import calendar
    end = date(y, m, calendar.monthrange(y, m)[1])
    return start, end


# ─────────────────────────────────────────
# ページルート
# ─────────────────────────────────────────

@work_bp.route("/apply_cont_work")
def work_index():
    return render_template("請負予定.html")


# ─────────────────────────────────────────
# API: 会員検索
# ─────────────────────────────────────────

@work_bp.route("/api/work/lookup", methods=["POST"])
def api_lookup():
    data  = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()

    if not query:
        return jsonify({"error": "会員番号を入力してください"}), 400

    # 会員番号で検索、なければUUID（QR）で検索
    member = Member.query.filter_by(member_number=query).first()
    if not member:
        try:
            uuidlib.UUID(query)
            member = Member.query.filter(
                Member.uuid.cast(db.String) == query
            ).first()
        except ValueError:
            pass

    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    return jsonify({
        "full_name":     member.full_name,
        "uuid":          member.uuid,
        "member_number": member.member_number,
    })


# ─────────────────────────────────────────
# API: 登録済みデータ取得
# ─────────────────────────────────────────

@work_bp.route("/api/work/schedules", methods=["POST"])
def api_get_schedules():
    """指定会員の当月〜3ヶ月分の登録データを返す"""
    data     = request.get_json(silent=True) or {}
    uuid_val = (data.get("uuid") or "").strip()
    if not uuid_val:
        return jsonify({"error": "UUIDが必要です"}), 400

    start, end = _valid_range()
    records = WorkContract.query.filter(
        WorkContract.uuid      == uuid_val,
        WorkContract.work_date >= start,
        WorkContract.work_date <= end,
    ).all()

    return jsonify({
        r.work_date.isoformat(): r.status
        for r in records
    })


# ─────────────────────────────────────────
# API: 一括登録・更新
# ─────────────────────────────────────────

@work_bp.route("/api/work/save", methods=["POST"])
def api_save():
    """
    Request JSON:
    {
      "uuid": "...",
      "schedules": {
        "2026-03-01": "OK",
        "2026-03-02": "NG",
        "2026-03-05": null
      }
    }
    """
    data     = request.get_json(silent=True) or {}
    uuid_val = (data.get("uuid") or "").strip()
    schedules = data.get("schedules") or {}

    if not uuid_val:
        return jsonify({"error": "UUIDが必要です"}), 400

    today = date.today()
    start, end = _valid_range()

    for date_str, status in schedules.items():
        try:
            work_date = date.fromisoformat(date_str)
        except ValueError:
            continue

        # 範囲外・過去日はスキップ
        if work_date < today or work_date < start or work_date > end:
            continue

        # status の正規化（OK / NG / None のみ許可）
        if status not in ("OK", "NG"):
            status = None

        existing = WorkContract.query.filter_by(
            uuid=uuid_val, work_date=work_date
        ).first()

        if existing:
            existing.status     = status
            existing.updated_at = datetime.now()
        else:
            record = WorkContract(
                uuid      = uuid_val,
                work_date = work_date,
                status    = status,
            )
            db.session.add(record)

    db.session.commit()
    return jsonify({"status": "ok", "message": "保存しました"})


# ─────────────────────────────────────────
# 定期削除ジョブ（毎月1日 0:00 実行）
# ─────────────────────────────────────────

_flask_app = None   # スケジューラジョブから app を参照するための変数


def _auto_cleanup():
    if _flask_app is None:
        return
    with _flask_app.app_context():
        today = date.today()
        m = today.month - 2
        y = today.year
        if m <= 0:
            m += 12
            y -= 1
        cutoff = date(y, m, 1)
        deleted = WorkContract.query.filter(
            WorkContract.work_date < cutoff
        ).delete(synchronize_session=False)
        db.session.commit()
        print(f"[AutoCleanup] {deleted} 件削除 (cutoff: {cutoff})")


def init_scheduler(app):
    global _flask_app
    _flask_app = app
    scheduler = BackgroundScheduler(timezone="Asia/Tokyo")
    scheduler.add_job(
        _auto_cleanup,
        trigger=CronTrigger(day=1, hour=0, minute=0, timezone="Asia/Tokyo"),
        id="work_contract_cleanup",
        replace_existing=True,
    )
    scheduler.start()
    return scheduler


# 手動実行用（管理者向け）
@work_bp.route("/api/work/cleanup", methods=["POST"])
def api_cleanup():
    _auto_cleanup()
    return jsonify({"status": "ok", "message": "削除完了"})


# ═══════════════════════════════════════════════════════════════════
# 請負管理ページ用 API
# ═══════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────
# API: 出勤可否状況（月別カレンダー）
# GET /api/cont_info/work_monthly?year=YYYY&month=MM
# ─────────────────────────────────────────

@work_bp.route("/api/cont_info/work_monthly")
def cont_info_work_monthly():
    """
    contract=True の全メンバーについて
    指定月（デフォルト: 当月）の日別出勤可否状況を返す。

    Response JSON:
    {
      "year": 2026, "month": 3,
      "members": [{"uuid": "...", "name": "..."}, ...],
      "days": [
        {
          "date": "2026-03-01",
          "ok_count": 3,
          "members": [
            {"uuid": "...", "name": "...", "status": "OK" | "NG" | null},
            ...
          ]
        },
        ...
      ]
    }
    """
    import calendar as _calendar

    today  = date.today()
    year   = int(request.args.get("year",  today.year))
    month  = int(request.args.get("month", today.month))

    # contract=True のメンバー一覧
    members = (
        Member.query
        .filter(Member.contract == True)
        .order_by(Member.full_name)
        .all()
    )
    member_list = [
        {"uuid": str(m.uuid), "name": m.full_name}
        for m in members
    ]
    member_uuids = [m["uuid"] for m in member_list]

    # 指定月のwork_contractを一括取得
    month_start = date(year, month, 1)
    days_in_month = _calendar.monthrange(year, month)[1]
    month_end   = date(year, month, days_in_month)

    records = (
        WorkContract.query
        .filter(
            WorkContract.uuid.in_(member_uuids),
            WorkContract.work_date >= month_start,
            WorkContract.work_date <= month_end,
        )
        .all()
    )

    # (uuid, date_str) → status の辞書を構築
    status_map: dict[tuple, str | None] = {
        (r.uuid, r.work_date.isoformat()): r.status
        for r in records
    }

    # 日別データ構築
    days_data = []
    for day_num in range(1, days_in_month + 1):
        date_str = f"{year:04d}-{month:02d}-{day_num:02d}"
        ok_count = 0
        member_statuses = []

        for m in member_list:
            status = status_map.get((m["uuid"], date_str), None)
            # 大文字小文字を正規化
            if status is not None:
                status = status.upper()
            if status == "OK":
                ok_count += 1
            member_statuses.append({
                "uuid":   m["uuid"],
                "name":   m["name"],
                "status": status,   # "OK" / "NG" / None
            })

        days_data.append({
            "date":     date_str,
            "ok_count": ok_count,
            "members":  member_statuses,
        })

    return jsonify({
        "year":    year,
        "month":   month,
        "members": member_list,
        "days":    days_data,
    })
