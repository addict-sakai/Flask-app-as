"""
exp_resv_routes.py  –  体験予約 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem
"""

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from datetime import date, datetime
from sqlalchemy import text, func, extract

exp_bp = Blueprint("exp", __name__)


# ═════════════════════════════════════════
# ヘルパー
# ═════════════════════════════════════════

def _fd(d) -> str | None:
    return d.isoformat() if d else None


def _resv_to_dict(r, para=None, camp=None) -> dict:
    base = {
        "id":               r.id,
        "reservation_type": r.reservation_type,
        "reservation_no":   r.reservation_no,
        "reception_date":   _fd(r.reception_date),
        "reservation_date": _fd(r.reservation_date),
        "name":             r.name,
        "phone":            r.phone or "",
        "charge_amount":    r.charge_amount,
        "staff":            r.staff or "",
        "memo":             r.memo or "",
        "cancelled":        r.cancelled,
    }
    if para:
        base["para"] = {
            "pax_count":       para.pax_count,
            "course":          para.course or "",
            "meeting_time":    para.meeting_time or "",
            "short_time":      para.short_time or "",
            "booking_site":    para.booking_site or "",
            "payment_method":  para.payment_method or "",
            "point_discount":  para.point_discount,
            "coupon_discount": para.coupon_discount,
            "insurance_fee":   para.insurance_fee,
            "ticket_detail":   para.ticket_detail or "",
            "upgrade":         para.upgrade,
            "shuttle":         para.shuttle,
        }
    if camp:
        base["camp"] = {
            "site_type":      camp.site_type or "",
            "adult_count":    camp.adult_count,
            "child_count":    camp.child_count,
            "tent_count":     camp.tent_count,
            "tarp_count":     camp.tarp_count,
            "vehicle1_type":  camp.vehicle1_type or "",
            "vehicle1_count": camp.vehicle1_count,
            "vehicle2_type":  camp.vehicle2_type or "",
            "vehicle2_count": camp.vehicle2_count,
            "vehicle3_type":  camp.vehicle3_type or "",
            "vehicle3_count": camp.vehicle3_count,
        }
    return base


def _next_reservation_no(resv_type: str) -> int:
    """種別ごとの次の通し番号を返す"""
    row = db.session.execute(
        text("SELECT COALESCE(MAX(reservation_no), 0) + 1 AS next_no "
             "FROM exp_reservation WHERE reservation_type = :t"),
        {"t": resv_type}
    ).fetchone()
    return row.next_no


def _get_config(category: str, item_name: str) -> list[dict]:
    """
    config_values を (category, item_name) で検索して返す。
    実際のカラム: cv.value（表示文字列 or 金額文字列）, cv.label（省略可）
    """
    rows = db.session.execute(
        text("""
            SELECT cv.id,
                   COALESCE(cv.label, cv.value) AS disp,
                   cv.value,
                   cm.value_type,
                   cv.sort_order
            FROM config_values cv
            JOIN config_master cm ON cm.id = cv.master_id
            WHERE cm.category  = :cat
              AND cm.item_name  = :name
              AND cm.is_active  = TRUE
              AND cv.is_active  = TRUE
            ORDER BY cv.sort_order, cv.id
        """),
        {"cat": category, "name": item_name}
    ).fetchall()

    result = []
    for r in rows:
        # value_type が amount の場合は数値に変換、options は 0
        try:
            amt = int(r.value) if r.value_type == "amount" else 0
        except (ValueError, TypeError):
            amt = 0
        result.append({
            "id":     r.id,
            "label":  r.disp,
            "amount": amt,
        })
    return result


def _get_config_multi(items: list[tuple[str, str]]) -> list[dict]:
    """
    複数の (category, item_name) を一度に取得してリストにまとめる。
    コース一覧など複数 item_name をまとめて取りたい場合に使用。
    各エントリに item_name（コース名）を label として使う。
    """
    result = []
    for category, item_name in items:
        rows = db.session.execute(
            text("""
                SELECT cv.value, cm.value_type, cm.item_name
                FROM config_values cv
                JOIN config_master cm ON cm.id = cv.master_id
                WHERE cm.category  = :cat
                  AND cm.item_name  = :name
                  AND cm.is_active  = TRUE
                  AND cv.is_active  = TRUE
                ORDER BY cv.sort_order, cv.id
                LIMIT 1
            """),
            {"cat": category, "name": item_name}
        ).fetchone()
        if rows:
            try:
                amt = int(rows.value)
            except (ValueError, TypeError):
                amt = 0
            result.append({"label": item_name, "amount": amt})
    return result


# ═════════════════════════════════════════
# ページルート
# ═════════════════════════════════════════

@exp_bp.route("/exp")
def exp_index():
    return render_template("体験予約.html")


# ═════════════════════════════════════════
# Config API  GET /api/exp/config
# ═════════════════════════════════════════

@exp_bp.route("/api/exp/config")
def api_exp_config():
    """
    フォームで必要な config データを一括返却。
    実際の config_master 構造:
      category='体験・キャンプ共通'  item_name: 予約サイト / チケット / 支払 / 担当者
      category='体験'               item_name: ショート / タンデム / セット / 集合時間 / ショート時間
      category='キャンプ'           item_name: 入場料 / テント（平日）/ テント（土日祝）/ タープ
                                               / バイク / 乗用車 / Campカー
    """
    def _v(category, item_name):
        return _get_config(category, item_name)

    return jsonify({
        # 担当者・共通選択肢
        "staff":          _v("体験・キャンプ共通", "担当者"),
        # パラ体験 コース（ショート/タンデム/セット それぞれ1件ずつ金額を持つ）
        "para_course":    _get_config_multi([
                              ("体験", "ショート"),
                              ("体験", "タンデム"),
                              ("体験", "セット"),
                          ]),
        "para_time":      _v("体験", "集合時間"),
        "para_short":     _v("体験", "ショート時間"),
        "para_site":      _v("体験・キャンプ共通", "予約サイト"),
        "para_payment":   _v("体験・キャンプ共通", "支払"),
        "para_ticket":    _v("体験・キャンプ共通", "チケット"),
        # 体験の保険料は体験 config に専用項目なし → 空リストで返す（JS側でデフォルト0）
        "para_insurance": [],
        # キャンプ
        "camp_adult":    _v("キャンプ", "入場料"),          # 大人1人当たりの金額
        "camp_tent_wd":  _v("キャンプ", "テント（平日）"),
        "camp_tent_wh":  _v("キャンプ", "テント（土日祝）"),
        "camp_tarp":     _v("キャンプ", "タープ"),
        "camp_vehicle":  _get_config_multi([
                             ("キャンプ", "バイク"),
                             ("キャンプ", "乗用車"),
                             ("キャンプ", "Campカー"),
                         ]),
    })


# ═════════════════════════════════════════
# 予約一覧  GET /api/exp/reservations
# ═════════════════════════════════════════

@exp_bp.route("/api/exp/reservations")
def api_exp_list():
    resv_type    = request.args.get("type",     "para")   # para | camp
    year         = request.args.get("year")
    month        = request.args.get("month")
    resv_date    = request.args.get("date")               # YYYY-MM-DD 絞り込み
    show_cancel  = request.args.get("show_cancel", "0")

    q = db.session.execute(
        text("SELECT 1 FROM exp_reservation LIMIT 0")     # table existence check
    )

    # SQLAlchemy ORM は使わずテキストSQLで組み立て
    filters = ["r.reservation_type = :rtype"]
    params  = {"rtype": resv_type}

    if show_cancel != "1":
        filters.append("r.cancelled = FALSE")

    if resv_date:
        filters.append("r.reservation_date = :rdate")
        params["rdate"] = resv_date
    elif year and month:
        filters.append("EXTRACT(YEAR  FROM r.reservation_date) = :yr")
        filters.append("EXTRACT(MONTH FROM r.reservation_date) = :mo")
        params["yr"] = int(year)
        params["mo"] = int(month)

    where = " AND ".join(filters)

    rows = db.session.execute(
        text(f"""
            SELECT
                r.id, r.reservation_type, r.reservation_no,
                r.reception_date, r.reservation_date,
                r.name, r.phone, r.charge_amount,
                r.staff, r.memo, r.cancelled,
                -- para
                p.pax_count, p.course, p.meeting_time, p.short_time,
                p.booking_site, p.payment_method,
                p.point_discount, p.coupon_discount, p.insurance_fee,
                p.ticket_detail, p.upgrade, p.shuttle,
                -- camp
                c.site_type, c.adult_count, c.child_count,
                c.tent_count, c.tarp_count,
                c.vehicle1_type, c.vehicle1_count,
                c.vehicle2_type, c.vehicle2_count,
                c.vehicle3_type, c.vehicle3_count
            FROM exp_reservation r
            LEFT JOIN exp_para_detail p ON p.reservation_id = r.id
            LEFT JOIN exp_camp_detail c ON c.reservation_id = r.id
            WHERE {where}
            ORDER BY r.reservation_date, r.reservation_no
        """),
        params
    ).fetchall()

    result = []
    for r in rows:
        d = {
            "id":               r.id,
            "reservation_type": r.reservation_type,
            "reservation_no":   r.reservation_no,
            "reception_date":   r.reception_date.isoformat() if r.reception_date else None,
            "reservation_date": r.reservation_date.isoformat() if r.reservation_date else None,
            "name":             r.name,
            "phone":            r.phone or "",
            "charge_amount":    r.charge_amount,
            "staff":            r.staff or "",
            "memo":             r.memo or "",
            "cancelled":        r.cancelled,
        }
        if resv_type == "para":
            d["para"] = {
                "pax_count":       r.pax_count,
                "course":          r.course or "",
                "meeting_time":    r.meeting_time or "",
                "short_time":      r.short_time or "",
                "booking_site":    r.booking_site or "",
                "payment_method":  r.payment_method or "",
                "point_discount":  r.point_discount,
                "coupon_discount": r.coupon_discount,
                "insurance_fee":   r.insurance_fee,
                "ticket_detail":   r.ticket_detail or "",
                "upgrade":         r.upgrade,
                "shuttle":         r.shuttle,
            }
        else:
            d["camp"] = {
                "site_type":      r.site_type or "",
                "adult_count":    r.adult_count,
                "child_count":    r.child_count,
                "tent_count":     r.tent_count,
                "tarp_count":     r.tarp_count,
                "vehicle1_type":  r.vehicle1_type or "",
                "vehicle1_count": r.vehicle1_count,
                "vehicle2_type":  r.vehicle2_type or "",
                "vehicle2_count": r.vehicle2_count,
                "vehicle3_type":  r.vehicle3_type or "",
                "vehicle3_count": r.vehicle3_count,
            }
        result.append(d)

    return jsonify({"type": resv_type, "count": len(result), "items": result})


# ═════════════════════════════════════════
# 月別カレンダー集計  GET /api/exp/calendar
# ═════════════════════════════════════════

@exp_bp.route("/api/exp/calendar")
def api_exp_calendar():
    resv_type = request.args.get("type",  "para")
    try:
        year  = int(request.args.get("year",  date.today().year))
        month = int(request.args.get("month", date.today().month))
    except ValueError:
        year, month = date.today().year, date.today().month

    rows = db.session.execute(
        text("""
            SELECT reservation_date,
                   COUNT(*) AS cnt,
                   SUM(charge_amount) AS total_amount
            FROM exp_reservation
            WHERE reservation_type = :rtype
              AND EXTRACT(YEAR  FROM reservation_date) = :yr
              AND EXTRACT(MONTH FROM reservation_date) = :mo
              AND cancelled = FALSE
            GROUP BY reservation_date
            ORDER BY reservation_date
        """),
        {"rtype": resv_type, "yr": year, "mo": month}
    ).fetchall()

    days = {}
    month_count  = 0
    month_amount = 0
    for r in rows:
        days[r.reservation_date.isoformat()] = {
            "count":  r.cnt,
            "amount": int(r.total_amount or 0),
        }
        month_count  += r.cnt
        month_amount += int(r.total_amount or 0)

    return jsonify({
        "year": year, "month": month,
        "month_count":  month_count,
        "month_amount": month_amount,
        "days": days,
    })


# ═════════════════════════════════════════
# 単件取得  GET /api/exp/reservations/<id>
# ═════════════════════════════════════════

@exp_bp.route("/api/exp/reservations/<int:resv_id>")
def api_exp_get(resv_id):
    row = db.session.execute(
        text("""
            SELECT r.*, p.*, c.*
            FROM exp_reservation r
            LEFT JOIN exp_para_detail p ON p.reservation_id = r.id
            LEFT JOIN exp_camp_detail c ON c.reservation_id = r.id
            WHERE r.id = :id
        """),
        {"id": resv_id}
    ).fetchone()

    if not row:
        return jsonify({"error": "予約が見つかりません"}), 404

    d = {
        "id":               row.id,
        "reservation_type": row.reservation_type,
        "reservation_no":   row.reservation_no,
        "reception_date":   row.reception_date.isoformat() if row.reception_date else None,
        "reservation_date": row.reservation_date.isoformat() if row.reservation_date else None,
        "name":             row.name,
        "phone":            row.phone or "",
        "charge_amount":    row.charge_amount,
        "staff":            row.staff or "",
        "memo":             row.memo or "",
        "cancelled":        row.cancelled,
    }
    if row.reservation_type == "para":
        d["para"] = {
            "pax_count":       row.pax_count,
            "course":          row.course or "",
            "meeting_time":    row.meeting_time or "",
            "short_time":      row.short_time or "",
            "booking_site":    row.booking_site or "",
            "payment_method":  row.payment_method or "",
            "point_discount":  row.point_discount,
            "coupon_discount": row.coupon_discount,
            "insurance_fee":   row.insurance_fee,
            "ticket_detail":   row.ticket_detail or "",
            "upgrade":         row.upgrade,
            "shuttle":         row.shuttle,
        }
    else:
        d["camp"] = {
            "site_type":      row.site_type or "",
            "adult_count":    row.adult_count,
            "child_count":    row.child_count,
            "tent_count":     row.tent_count,
            "tarp_count":     row.tarp_count,
            "vehicle1_type":  row.vehicle1_type or "",
            "vehicle1_count": row.vehicle1_count,
            "vehicle2_type":  row.vehicle2_type or "",
            "vehicle2_count": row.vehicle2_count,
            "vehicle3_type":  row.vehicle3_type or "",
            "vehicle3_count": row.vehicle3_count,
        }
    return jsonify(d)


# ═════════════════════════════════════════
# 新規登録  POST /api/exp/reservations
# ═════════════════════════════════════════

@exp_bp.route("/api/exp/reservations", methods=["POST"])
def api_exp_create():
    data      = request.get_json(silent=True) or {}
    resv_type = data.get("reservation_type", "para")

    next_no = _next_reservation_no(resv_type)

    try:
        db.session.execute(
            text("""
                INSERT INTO exp_reservation
                  (reservation_type, reservation_no, reception_date, reservation_date,
                   name, phone, charge_amount, staff, memo, cancelled)
                VALUES
                  (:rtype, :rno, :rec_date, :resv_date,
                   :name, :phone, :charge, :staff, :memo, FALSE)
                RETURNING id
            """),
            {
                "rtype":     resv_type,
                "rno":       next_no,
                "rec_date":  date.today().isoformat(),
                "resv_date": data.get("reservation_date") or None,
                "name":      data.get("name", ""),
                "phone":     data.get("phone", ""),
                "charge":    data.get("charge_amount", 0),
                "staff":     data.get("staff", ""),
                "memo":      data.get("memo", ""),
            }
        )
        row = db.session.execute(
            text("SELECT lastval() AS id")
        ).fetchone()
        new_id = row.id

        if resv_type == "para":
            p = data.get("para", {})
            db.session.execute(
                text("""
                    INSERT INTO exp_para_detail
                      (reservation_id, pax_count, course, meeting_time, short_time,
                       booking_site, payment_method,
                       point_discount, coupon_discount, insurance_fee,
                       ticket_detail, upgrade, shuttle)
                    VALUES
                      (:rid, :pax, :course, :mtg, :short,
                       :site, :pay,
                       :pt, :cp, :ins,
                       :tkt, :upg, :shu)
                """),
                {
                    "rid":   new_id,
                    "pax":   p.get("pax_count", 1),
                    "course":p.get("course", ""),
                    "mtg":   p.get("meeting_time", ""),
                    "short": p.get("short_time", ""),
                    "site":  p.get("booking_site", ""),
                    "pay":   p.get("payment_method", ""),
                    "pt":    p.get("point_discount", 0),
                    "cp":    p.get("coupon_discount", 0),
                    "ins":   p.get("insurance_fee", 0),
                    "tkt":   p.get("ticket_detail", ""),
                    "upg":   p.get("upgrade", False),
                    "shu":   p.get("shuttle", False),
                }
            )
        else:
            c = data.get("camp", {})
            db.session.execute(
                text("""
                    INSERT INTO exp_camp_detail
                      (reservation_id, site_type, adult_count, child_count,
                       tent_count, tarp_count,
                       vehicle1_type, vehicle1_count,
                       vehicle2_type, vehicle2_count,
                       vehicle3_type, vehicle3_count)
                    VALUES
                      (:rid, :site, :adult, :child,
                       :tent, :tarp,
                       :v1t, :v1c, :v2t, :v2c, :v3t, :v3c)
                """),
                {
                    "rid":  new_id,
                    "site": c.get("site_type", ""),
                    "adult":c.get("adult_count", 0),
                    "child":c.get("child_count", 0),
                    "tent": c.get("tent_count", 0),
                    "tarp": c.get("tarp_count", 0),
                    "v1t":  c.get("vehicle1_type", ""),
                    "v1c":  c.get("vehicle1_count", 0),
                    "v2t":  c.get("vehicle2_type", ""),
                    "v2c":  c.get("vehicle2_count", 0),
                    "v3t":  c.get("vehicle3_type", ""),
                    "v3c":  c.get("vehicle3_count", 0),
                }
            )

        db.session.commit()
        return jsonify({
            "message": "予約を登録しました",
            "id":      new_id,
            "reservation_no": next_no,
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# ═════════════════════════════════════════
# 更新  PUT /api/exp/reservations/<id>
# ═════════════════════════════════════════

@exp_bp.route("/api/exp/reservations/<int:resv_id>", methods=["PUT"])
def api_exp_update(resv_id):
    data = request.get_json(silent=True) or {}

    # reservation_type を取得
    row = db.session.execute(
        text("SELECT reservation_type FROM exp_reservation WHERE id = :id"),
        {"id": resv_id}
    ).fetchone()
    if not row:
        return jsonify({"error": "予約が見つかりません"}), 404

    resv_type = row.reservation_type

    try:
        db.session.execute(
            text("""
                UPDATE exp_reservation SET
                  reservation_date = :resv_date,
                  name             = :name,
                  phone            = :phone,
                  charge_amount    = :charge,
                  staff            = :staff,
                  memo             = :memo,
                  cancelled        = :cancelled
                WHERE id = :id
            """),
            {
                "resv_date": data.get("reservation_date") or None,
                "name":      data.get("name", ""),
                "phone":     data.get("phone", ""),
                "charge":    data.get("charge_amount", 0),
                "staff":     data.get("staff", ""),
                "memo":      data.get("memo", ""),
                "cancelled": data.get("cancelled", False),
                "id":        resv_id,
            }
        )

        if resv_type == "para":
            p = data.get("para", {})
            db.session.execute(
                text("""
                    UPDATE exp_para_detail SET
                      pax_count       = :pax,
                      course          = :course,
                      meeting_time    = :mtg,
                      short_time      = :short,
                      booking_site    = :site,
                      payment_method  = :pay,
                      point_discount  = :pt,
                      coupon_discount = :cp,
                      insurance_fee   = :ins,
                      ticket_detail   = :tkt,
                      upgrade         = :upg,
                      shuttle         = :shu
                    WHERE reservation_id = :rid
                """),
                {
                    "rid":   resv_id,
                    "pax":   p.get("pax_count", 1),
                    "course":p.get("course", ""),
                    "mtg":   p.get("meeting_time", ""),
                    "short": p.get("short_time", ""),
                    "site":  p.get("booking_site", ""),
                    "pay":   p.get("payment_method", ""),
                    "pt":    p.get("point_discount", 0),
                    "cp":    p.get("coupon_discount", 0),
                    "ins":   p.get("insurance_fee", 0),
                    "tkt":   p.get("ticket_detail", ""),
                    "upg":   p.get("upgrade", False),
                    "shu":   p.get("shuttle", False),
                }
            )
        else:
            c = data.get("camp", {})
            db.session.execute(
                text("""
                    UPDATE exp_camp_detail SET
                      site_type      = :site,
                      adult_count    = :adult,
                      child_count    = :child,
                      tent_count     = :tent,
                      tarp_count     = :tarp,
                      vehicle1_type  = :v1t,
                      vehicle1_count = :v1c,
                      vehicle2_type  = :v2t,
                      vehicle2_count = :v2c,
                      vehicle3_type  = :v3t,
                      vehicle3_count = :v3c
                    WHERE reservation_id = :rid
                """),
                {
                    "rid":  resv_id,
                    "site": c.get("site_type", ""),
                    "adult":c.get("adult_count", 0),
                    "child":c.get("child_count", 0),
                    "tent": c.get("tent_count", 0),
                    "tarp": c.get("tarp_count", 0),
                    "v1t":  c.get("vehicle1_type", ""),
                    "v1c":  c.get("vehicle1_count", 0),
                    "v2t":  c.get("vehicle2_type", ""),
                    "v2c":  c.get("vehicle2_count", 0),
                    "v3t":  c.get("vehicle3_type", ""),
                    "v3c":  c.get("vehicle3_count", 0),
                }
            )

        db.session.commit()
        return jsonify({"message": "更新しました"})

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
