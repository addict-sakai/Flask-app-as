"""
staff_manage_routes.py  rev.2
スタッフ管理ダッシュボード API
・入山料確認（entrance_fee_paid）と山チン確認（yamachin_confirmed）を分離
・DB: io_flight テーブル（2026年3月構成）
"""
from flask import Blueprint, jsonify, request
from app.db import db
from app.models.member import Member
from datetime import date
import traceback

staff_manage_bp = Blueprint("staff_manage", __name__)


# =========================================
# ダッシュボード API
# GET /api/staff/dashboard
# =========================================
@staff_manage_bp.route("/api/staff/dashboard", methods=["GET"])
def staff_dashboard():
    return jsonify({
        "flyer":      _get_flyer_pending(),
        "experience": _get_exp_pending(),
        "payment":    _get_payment_pending(),
    })


# =========================================
# 入金確認 API
# POST /api/staff/confirm_payment/<io_id>?type=entrance|yamachin
# =========================================
@staff_manage_bp.route("/api/staff/confirm_payment/<int:io_id>", methods=["POST"])
def confirm_payment(io_id):
    """
    入金確認済みフラグを立てる。
    ?type=entrance   → entrance_fee_paid = TRUE
    ?type=yamachin → yamachin_confirmed = TRUE

    ※ 事前に以下のALTER TABLEが必要（未実施の場合）:
       ALTER TABLE io_flight ADD COLUMN entrance_fee_paid  BOOLEAN DEFAULT FALSE;
       ALTER TABLE io_flight ADD COLUMN yamachin_confirmed BOOLEAN DEFAULT FALSE;
    """
    confirm_type = request.args.get("type", "entrance")

    if confirm_type == "yamachin":
        col = "yamachin_confirmed"
    else:
        col = "entrance_fee_paid"

    try:
        sql = db.text(f"""
            UPDATE io_flight
            SET {col} = TRUE
            WHERE id = :io_id
        """)
        db.session.execute(sql, {"io_id": io_id})
        db.session.commit()
        return jsonify({"status": "ok", "id": io_id, "type": confirm_type})
    except Exception:
        db.session.rollback()
        traceback.print_exc()
        return jsonify({"error": "更新に失敗しました"}), 500


# =========================================
# 内部ヘルパー
# =========================================

def _get_flyer_pending():
    """
    フライヤー申請（未処理）
    判定: members.updated_at IS NULL（スタッフ未確認）
    """
    try:
        members = (
            Member.query
            .filter(Member.updated_at.is_(None))
            .order_by(Member.id.desc())
            .all()
        )

        by_type: dict[str, int] = {}
        items = []
        for m in members:
            mtype = m.member_type or "不明"
            by_type[mtype] = by_type.get(mtype, 0) + 1
            items.append({
                "id":               m.id,
                "application_date": m.application_date.isoformat()
                                    if m.application_date else None,
                "full_name":        m.full_name,
                "member_type":      m.member_type,
                "member_number":    m.member_number,
            })

        return {"total": len(items), "by_type": by_type, "items": items}

    except Exception:
        traceback.print_exc()
        return {"total": 0, "by_type": {}, "items": [], "error": "取得失敗"}


def _get_exp_pending():
    """
    体験予約（未処理）
    判定: cancelled IS NULL/FALSE かつ reservation_date >= 今日
    """
    try:
        today_str = date.today().isoformat()
        sql = db.text("""
            SELECT id, reservation_type, reservation_date, reception_date,
                   name, phone, email, status
            FROM exp_reservation
            WHERE (cancelled IS NULL OR cancelled = FALSE)
              AND reservation_date >= :today
            ORDER BY reservation_date ASC, id ASC
            LIMIT 100
        """)
        rows = db.session.execute(sql, {"today": today_str}).fetchall()

        items = [
            {
                "id":               r[0],
                "reservation_type": r[1],
                "reservation_date": str(r[2]) if r[2] else None,
                "reception_date":   str(r[3]) if r[3] else None,
                "name":             r[4],
                "phone":            r[5],
                "email":            r[6],
                "status":           r[7],
            }
            for r in rows
        ]
        return {"total": len(items), "items": items}

    except Exception:
        traceback.print_exc()
        return {"total": 0, "items": [], "error": "取得失敗"}


def _get_payment_pending():
    """
    入山申請の入金確認待ち。
    入山料未確認（entrance_fee_paid IS NULL/FALSE）と
    山チン未確認（yamachin=TRUE かつ yamachin_confirmed IS NULL/FALSE）を
    まとめて返す。各行に confirm_type ('entrance' | 'yamachin') を付与。

    ※ 1件の入山レコードが両方に該当する場合（yamachin=TRUE）は
      2行に分けてリストに追加する。

    ※ 事前ALTER TABLE:
       ALTER TABLE io_flight ADD COLUMN entrance_fee_paid  BOOLEAN DEFAULT FALSE;
       ALTER TABLE io_flight ADD COLUMN yamachin_confirmed BOOLEAN DEFAULT FALSE;
    """
    try:
        # ── 入山料未確認（全レコード対象） ──
        sql_nyuzan = db.text("""
            SELECT id, entry_date, member_class, full_name, member_number
            FROM io_flight
            WHERE (entrance_fee_paid IS NULL OR entrance_fee_paid = FALSE)
            ORDER BY entry_date DESC
            LIMIT 200
        """)
        rows_nyuzan = db.session.execute(sql_nyuzan).fetchall()

        # ── 山チン未確認（yamachin=TRUE のみ） ──
        sql_yamachin = db.text("""
            SELECT id, entry_date, member_class, full_name, member_number
            FROM io_flight
            WHERE yamachin = TRUE
              AND (yamachin_confirmed IS NULL OR yamachin_confirmed = FALSE)
            ORDER BY entry_date DESC
            LIMIT 200
        """)
        rows_yamachin = db.session.execute(sql_yamachin).fetchall()

        def to_item(r, confirm_type):
            return {
                "id":            r[0],
                "flight_date":   str(r[1]) if r[1] else None,
                "member_type":   r[2],   # io_flight.member_class
                "full_name":     r[3] or "（不明）",
                "member_number": r[4] or "—",
                "confirm_type":  confirm_type,
            }

        items_nyuzan   = [to_item(r, "entrance")   for r in rows_nyuzan]
        items_yamachin = [to_item(r, "yamachin") for r in rows_yamachin]

        # 日付降順でマージ（nyuzan → yamachin の順で追加し、フロント側でソート不要）
        all_items = items_nyuzan + items_yamachin

        return {
            "entrance_total":   len(items_nyuzan),
            "yamachin_total": len(items_yamachin),
            "total":          len(items_nyuzan) + len(items_yamachin),
            "items":          all_items,
        }

    except Exception:
        traceback.print_exc()
        return {
            "entrance_total": 0, "yamachin_total": 0,
            "total": 0, "items": [], "error": "取得失敗",
        }
