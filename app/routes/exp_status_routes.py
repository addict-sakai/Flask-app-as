"""
exp_status_routes.py  –  体験状況確認・編集ページ ルート & API
Mt.FUJI PARAGLIDING / FujipSystem

Blueprint名: exp_status
URLプレフィックス: なし

【初回マイグレーション】
  起動時に @record_once で下記カラムを自動追加:
    ALTER TABLE exp_reservation ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT '受付未';
"""

from flask import Blueprint, render_template, request, jsonify
from sqlalchemy import text
from app.db import db
from app.models.member import Member
from app.models.work_contract import WorkContract
from datetime import date

exp_status_bp = Blueprint("exp_status", __name__)

# ステータス定義
STATUS_LIST = ("受付未", "受付済", "体験完了", "キャンセル")


# ══════════════════════════════════════════════════════════
# 起動時マイグレーション（status カラムがなければ追加）
# ══════════════════════════════════════════════════════════

@exp_status_bp.record_once
def _on_register(state):
    with state.app.app_context():
        try:
            db.session.execute(text("""
                ALTER TABLE exp_reservation
                ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT '受付未'
            """))
            db.session.commit()
        except Exception:
            db.session.rollback()


# ══════════════════════════════════════════════════════════
# ヘルパー
# ══════════════════════════════════════════════════════════

def _next_resv_no(resv_type: str) -> int:
    row = db.session.execute(
        text("SELECT COALESCE(MAX(reservation_no), 0) + 1 AS n "
             "FROM exp_reservation WHERE reservation_type = :t"),
        {"t": resv_type}
    ).fetchone()
    return row.n


def _get_config(category: str, item_name: str) -> list[str]:
    rows = db.session.execute(text("""
        SELECT cv.value
        FROM config_values cv
        JOIN config_master cm ON cm.id = cv.master_id
        WHERE cm.category = :cat AND cm.item_name = :name
          AND cm.is_active = TRUE AND cv.is_active = TRUE
        ORDER BY cv.sort_order, cv.id
    """), {"cat": category, "name": item_name}).fetchall()
    return [r.value for r in rows]


# ══════════════════════════════════════════════════════════
# ページ
# ══════════════════════════════════════════════════════════

@exp_status_bp.route("/apply_exp_status")
def exp_status_page():
    return render_template("体験状況.html")


# ══════════════════════════════════════════════════════════
# 設定取得  GET /api/exp_status/config
# ══════════════════════════════════════════════════════════

@exp_status_bp.route("/api/exp_status/config")
def api_status_config():
    return jsonify({
        "staff":        _get_config("体験・キャンプ共通", "担当者"),
        "meeting_time": _get_config("体験", "集合時間"),
        "short_time":   _get_config("体験", "ショート時間"),
    })


# ══════════════════════════════════════════════════════════
# 日別一覧  GET /api/exp_status/daily?date=YYYY-MM-DD
# ══════════════════════════════════════════════════════════

@exp_status_bp.route("/api/exp_status/daily")
def api_daily():
    target_date = request.args.get("date", date.today().isoformat())

    rows = db.session.execute(text("""
        SELECT
            r.id,
            r.reservation_type,
            r.reservation_no,
            r.reservation_date,
            r.name,
            r.phone,
            r.email,
            r.staff,
            r.memo,
            r.cancelled,
            COALESCE(r.status, '受付未') AS status,
            -- para detail
            p.pax_count,
            p.course,
            p.meeting_time,
            p.short_time,
            p.booking_site,
            p.upgrade,
            p.shuttle,
            -- camp detail
            c.site_type,
            c.adult_count,
            c.child_count,
            c.tent_count,
            c.tarp_count,
            c.vehicle1_type,  c.vehicle1_count,
            c.vehicle2_type,  c.vehicle2_count,
            c.vehicle3_type,  c.vehicle3_count
        FROM exp_reservation r
        LEFT JOIN exp_para_detail p ON p.reservation_id = r.id
        LEFT JOIN exp_camp_detail c ON c.reservation_id = r.id
        WHERE r.reservation_date = :d
          AND r.cancelled = FALSE
        ORDER BY
            CASE r.reservation_type WHEN 'para' THEN 0 ELSE 1 END,
            COALESCE(p.meeting_time, p.short_time, '99:99'),
            r.reservation_no
    """), {"d": target_date}).fetchall()

    tandem, short_list, camp = [], [], []

    for r in rows:
        base = {
            "id":               r.id,
            "reservation_type": r.reservation_type,
            "reservation_no":   r.reservation_no,
            "reservation_date": r.reservation_date.isoformat() if r.reservation_date else None,
            "name":             r.name or "",
            "phone":            r.phone or "",
            "email":            r.email or "",
            "staff":            r.staff or "",
            "memo":             r.memo or "",
            "status":           r.status,
        }

        if r.reservation_type == "para":
            course = r.course or ""
            base.update({
                "pax_count":    r.pax_count or 1,
                "course":       course,
                "meeting_time": r.meeting_time or "",
                "short_time":   r.short_time or "",
                "booking_site": r.booking_site or "",
                "upgrade":      bool(r.upgrade),
                "shuttle":      bool(r.shuttle),
            })
            # セットは両セクションに表示
            if course in ("タンデム", "セット"):
                tandem.append({**base})
            if course in ("ショート", "セット"):
                short_list.append({**base})
        else:
            has_vehicle = any([
                (r.vehicle1_count or 0) > 0,
                (r.vehicle2_count or 0) > 0,
                (r.vehicle3_count or 0) > 0,
            ])
            base.update({
                "site_type":      r.site_type or "",
                "adult_count":    r.adult_count or 0,
                "child_count":    r.child_count or 0,
                "tent_count":     r.tent_count or 0,
                "tarp_count":     r.tarp_count or 0,
                "has_vehicle":    has_vehicle,
                "vehicle1_type":  r.vehicle1_type or "",
                "vehicle1_count": r.vehicle1_count or 0,
                "vehicle2_type":  r.vehicle2_type or "",
                "vehicle2_count": r.vehicle2_count or 0,
                "vehicle3_type":  r.vehicle3_type or "",
                "vehicle3_count": r.vehicle3_count or 0,
            })
            camp.append(base)

    # ── パイロット集計（work_contract で当日 OK の請負メンバー）
    ok_uuids = db.session.execute(text("""
        SELECT uuid
        FROM work_contract
        WHERE work_date = :d
          AND UPPER(status) = 'OK'
    """), {"d": target_date}).scalars().all()

    pilots = []
    if ok_uuids:
        pilot_members = (
            Member.query
            .filter(
                Member.contract == True,
                Member.uuid.in_(ok_uuids)
            )
            .order_by(Member.full_name)
            .all()
        )
        pilots = [{"name": m.full_name} for m in pilot_members]

    # ── スクール：当日 io_flight に入山記録があるスクール分類のメンバー
    school_rows = db.session.execute(text("""
        SELECT
            id,
            full_name,
            member_number,
            course_name,
            glider_name,
            glider_color,
            insurance_type,
            radio_type,
            license,
            reglimit_date,
            repack_date,
            entry_date,
            in_time,
            out_time,
            member_class,
            yamachin,
            comment
        FROM io_flight
        WHERE entry_date = :d
          AND member_class ILIKE '%スクール%'
        ORDER BY in_time NULLS LAST, full_name
    """), {"d": target_date}).fetchall()

    school = [
        {
            "id":           r.id,
            "full_name":    r.full_name or "",
            "member_number": r.member_number or "",
            "course_name":  r.course_name or "",
            "glider_name":  r.glider_name or "",
            "glider_color": r.glider_color or "",
            "insurance_type": r.insurance_type or "",
            "radio_type":   r.radio_type or "",
            "license":      r.license or "",
            "reglimit_date": str(r.reglimit_date) if r.reglimit_date else "",
            "repack_date":  str(r.repack_date) if r.repack_date else "",
            "entry_date":   str(r.entry_date) if r.entry_date else "",
            "in_time":      r.in_time.strftime("%H:%M") if r.in_time else "",
            "out_time":     r.out_time.strftime("%H:%M") if r.out_time else "",
            "io_status":    "下山済" if r.out_time else "入山中",
            "member_class": r.member_class or "",
            "yamachin":     bool(r.yamachin),
            "comment":      r.comment or "",
        }
        for r in school_rows
    ]

    return jsonify({
        "date":             target_date,
        "tandem":           tandem,
        "short":            short_list,
        "school":           school,
        "camp":             camp,
        "pilots":           pilots,
        "pilot_count":      len(pilots),
        "tandem_pax_total": sum(x["pax_count"] for x in tandem),
        "short_pax_total":  sum(x["pax_count"] for x in short_list),
    })


# ══════════════════════════════════════════════════════════
# ステータス更新  PUT /api/exp_status/<id>/status
# ══════════════════════════════════════════════════════════

@exp_status_bp.route("/api/exp_status/<int:resv_id>/status", methods=["PUT"])
def api_update_status(resv_id):
    data = request.get_json(silent=True) or {}
    new_status = data.get("status", "受付未")

    if new_status not in STATUS_LIST:
        return jsonify({"error": "無効なステータスです"}), 400

    try:
        db.session.execute(
            text("UPDATE exp_reservation SET status = :s WHERE id = :id"),
            {"s": new_status, "id": resv_id}
        )
        db.session.commit()
        return jsonify({"message": "更新しました", "status": new_status})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════
# 備考・担当更新  PUT /api/exp_status/<id>/memo
# ══════════════════════════════════════════════════════════

@exp_status_bp.route("/api/exp_status/<int:resv_id>/memo", methods=["PUT"])
def api_update_memo(resv_id):
    data = request.get_json(silent=True) or {}
    try:
        db.session.execute(text("""
            UPDATE exp_reservation
            SET memo = :m, staff = :s
            WHERE id = :id
        """), {
            "m":   data.get("memo", ""),
            "s":   data.get("staff", ""),
            "id":  resv_id,
        })
        db.session.commit()
        return jsonify({"message": "更新しました"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════
# 飛び込み登録  POST /api/exp_status/walkin
# ══════════════════════════════════════════════════════════

@exp_status_bp.route("/api/exp_status/walkin", methods=["POST"])
def api_walkin():
    data      = request.get_json(silent=True) or {}
    resv_type = data.get("reservation_type", "para")
    resv_date = data.get("reservation_date") or date.today().isoformat()
    next_no   = _next_resv_no(resv_type)

    try:
        db.session.execute(text("""
            INSERT INTO exp_reservation
              (reservation_type, reservation_no, reception_date, reservation_date,
               name, phone, email, charge_amount, staff, memo, cancelled, status)
            VALUES
              (:rtype, :rno, :rec, :resv,
               :name, :phone, :email, 0, :staff, :memo, FALSE, '受付済')
        """), {
            "rtype": resv_type,
            "rno":   next_no,
            "rec":   date.today().isoformat(),
            "resv":  resv_date,
            "name":  data.get("name", ""),
            "phone": data.get("phone", ""),
            "email": data.get("email", ""),
            "staff": data.get("staff", ""),
            "memo":  data.get("memo", ""),
        })
        row    = db.session.execute(text("SELECT lastval() AS id")).fetchone()
        new_id = row.id

        if resv_type == "para":
            p = data.get("para", {})
            db.session.execute(text("""
                INSERT INTO exp_para_detail
                  (reservation_id, pax_count, course, meeting_time, short_time,
                   booking_site, payment_method,
                   point_discount, coupon_discount, insurance_fee,
                   ticket_detail, upgrade, shuttle)
                VALUES
                  (:rid, :pax, :course, :mtg, :short,
                   '飛び込み', '',
                   0, 0, 0, '', FALSE, FALSE)
            """), {
                "rid":    new_id,
                "pax":    p.get("pax_count", 1),
                "course": p.get("course", "タンデム"),
                "mtg":    p.get("meeting_time", ""),
                "short":  p.get("short_time", ""),
            })
        else:
            c = data.get("camp", {})
            db.session.execute(text("""
                INSERT INTO exp_camp_detail
                  (reservation_id, site_type, adult_count, child_count,
                   tent_count, tarp_count,
                   vehicle1_type, vehicle1_count,
                   vehicle2_type, vehicle2_count,
                   vehicle3_type, vehicle3_count)
                VALUES
                  (:rid, :site, :adult, :child, :tent, :tarp,
                   '', 0, '', 0, '', 0)
            """), {
                "rid":   new_id,
                "site":  c.get("site_type", "フリーサイト①"),
                "adult": c.get("adult_count", 1),
                "child": c.get("child_count", 0),
                "tent":  c.get("tent_count", 0),
                "tarp":  c.get("tarp_count", 0),
            })

        db.session.commit()
        return jsonify({
            "message":        "登録しました",
            "id":             new_id,
            "reservation_no": next_no,
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
