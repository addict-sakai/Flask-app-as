"""
app/routes/tour_booking_routes.py
ツアー申込 Flask ルート & REST API
Blueprint名: tour  /  URLプレフィックス: なし（/apply_tour_select, /apply_tour, /api/tour/...）
新規追加（2026-04-11）
改定１（2026-04-11）: 申込番号をTU-NNNNN形式に変更
                     ビジター料金をビジター平日/土日祝日の2キー対応に変更
改定２（2026-04-11）: ツアー選択ページ追加
                     GET  /api/tour/bookings/by-no/<booking_no>  申込番号検索
                     PUT  /api/tour/bookings/<id>                申込内容更新
                     DELETE /api/tour/bookings/<id>              申込削除
                     DELETE /api/tour/leaders/<id>               引率者個別削除
                     DELETE /api/tour/participants/<id>           参加者個別削除
改定３（2026-04-11）: TourLeaderにmember_type追加対応
改定４（2026-04-12）: contact_email（連絡先メールアドレス）追加
                     GET /api/tour/bookings/pending  スタッフ管理用pending一覧追加
                     PUT /api/tour/bookings/<id>/confirm  承認API追加
"""

from flask import Blueprint, render_template, request, jsonify
from app.db import db
from app.models.tour_booking import TourBooking, TourLeader, TourParticipant
from app.models.member import Member
from app.models.member_flyer import MemberFlyer
from app.models.member_course import MemberCourse
from sqlalchemy import text
from datetime import datetime, date
import re

tour_bp = Blueprint("tour", __name__)


# ══════════════════════════════════════════════════════════
# ページ
# ══════════════════════════════════════════════════════════

@tour_bp.route("/apply_tour_select")
def apply_tour_select_page():
    return render_template("ツアー選択.html")


@tour_bp.route("/apply_tour")
def apply_tour_page():
    return render_template("ツアー申込書.html")


@tour_bp.route("/apply_tour_status")
def apply_tour_status_page():
    return render_template("ツアー状況.html")


# ══════════════════════════════════════════════════════════
# ヘルパー
# ══════════════════════════════════════════════════════════

def _generate_booking_no() -> str:
    """申込番号 TU-NNNNN を生成（全体通し番号・5桁）"""
    last = db.session.execute(
        text("SELECT booking_no FROM tour_bookings WHERE booking_no LIKE 'TU-%' ORDER BY id DESC LIMIT 1")
    ).fetchone()
    if last:
        try:
            seq = int(last[0].split("-")[1]) + 1
        except Exception:
            seq = 1
    else:
        seq = 1
    return f"TU-{seq:05d}"


def _parse_date(val):
    if not val:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            pass
    return None


def _member_search_result(member: Member) -> dict:
    """会員情報をツアー申込用に整形して返す"""
    f = member.flyer
    course = MemberCourse.get_current(member.id)
    c = member.contact
    return {
        "member_number":   member.member_number,
        "full_name":       member.full_name,
        "phone":           c.mobile_phone if c else None,
        "license":         f.license  if f else None,
        "reg_no":          f.reg_no   if f else None,
        "member_type":     course.member_type if course else None,
        "instructor_role": member.instructor_role,
        "is_leader":       bool(member.is_leader),
    }


# ══════════════════════════════════════════════════════════
# 会員検索 API（氏名 + 電話番号）
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/search_member", methods=["GET"])
def tour_search_member():
    """
    GET /api/tour/search_member?name=山田太郎&phone=090xxxx
    氏名（部分一致）＋電話番号（部分一致）でメンバーを検索して返す。
    """
    name  = request.args.get("name",  "").strip()
    phone = request.args.get("phone", "").strip()

    if not name and not phone:
        return jsonify({"status": "error", "message": "氏名または電話番号を入力してください"}), 400

    query = Member.query

    if name:
        query = query.filter(Member.full_name.ilike(f"%{name}%"))

    if phone:
        from app.models.member_contact import MemberContact
        contact_ids = (
            db.session.query(MemberContact.member_id)
            .filter(
                (MemberContact.mobile_phone.ilike(f"%{phone}%")) |
                (MemberContact.home_phone.ilike(f"%{phone}%"))
            )
            .subquery()
        )
        query = query.filter(Member.id.in_(contact_ids))

    members = query.order_by(Member.full_name).limit(20).all()

    if not members:
        return jsonify({"status": "not_found", "results": []})

    return jsonify({
        "status":  "ok",
        "results": [_member_search_result(m) for m in members],
    })


# ══════════════════════════════════════════════════════════
# ビジターフライト料金取得
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/visitor_fee", methods=["GET"])
def get_visitor_fee():
    def _fetch_fee(item_name: str) -> int:
        row = db.session.execute(
            text("""
                SELECT cv.value
                FROM config_master cm
                JOIN config_values cv ON cv.master_id = cm.id
                WHERE cm.category  = 'パラ'
                  AND cm.item_name = :item_name
                  AND cm.is_active = true
                  AND cv.is_active = true
                ORDER BY cv.sort_order, cv.id
                LIMIT 1
            """),
            {"item_name": item_name},
        ).fetchone()
        if row:
            try:
                return int(re.sub(r"[^\d]", "", str(row[0])))
            except (ValueError, TypeError):
                pass
        return 0

    fee_weekday = _fetch_fee("ビジター平日")
    fee_holiday = _fetch_fee("ビジター土日祝日")

    return jsonify({
        "fee_weekday": fee_weekday,
        "fee_holiday": fee_holiday,
    })


# ══════════════════════════════════════════════════════════
# ツアー申込 登録
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings", methods=["POST"])
def create_tour_booking():
    data = request.get_json(silent=True) or {}

    school_name = (data.get("school_name") or "").strip()
    if not school_name:
        return jsonify({"status": "error", "message": "スクール/エリア名は必須です"}), 400

    # school_name チェックの直後に追加（両関数とも同じ）
    contact_email = (data.get("contact_email") or "").strip()
    if not contact_email:
        return jsonify({"status": "error", "message": "連絡先メールアドレスは必須です"}), 400

    flight_date_from = _parse_date(data.get("flight_date_from"))
    flight_date_to   = _parse_date(data.get("flight_date_to"))
    if not flight_date_from or not flight_date_to:
        return jsonify({"status": "error", "message": "フライト日（開始・終了）は必須です"}), 400
    if flight_date_from > flight_date_to:
        return jsonify({"status": "error", "message": "終了日は開始日以降にしてください"}), 400

    leaders_data      = data.get("leaders", [])
    participants_data = data.get("participants", [])

    if not leaders_data:
        return jsonify({"status": "error", "message": "引率者を1名以上入力してください"}), 400

    try:
        flight_days = int(data.get("flight_days", 1))
    except (ValueError, TypeError):
        flight_days = 1

    try:
        booking = TourBooking(
            booking_no       = _generate_booking_no(),
            school_name      = school_name,
            contact_email    = (data.get("contact_email") or "").strip() or None,
            flight_date_from = flight_date_from,
            flight_date_to   = flight_date_to,
            flight_days      = flight_days,
            visitor_fee_unit = 0,
            total_fee        = 0,
            notes            = (data.get("notes") or "").strip() or None,
            app_status       = "pending",
        )
        db.session.add(booking)
        db.session.flush()

        for i, ld in enumerate(leaders_data):
            db.session.add(TourLeader(
                booking_id      = booking.id,
                sort_order      = i,
                member_number   = (ld.get("member_number") or "").strip() or None,
                full_name       = (ld.get("full_name") or "").strip(),
                phone           = (ld.get("phone") or "").strip() or None,
                license         = (ld.get("license") or "").strip() or None,
                reg_no          = (ld.get("reg_no") or "").strip() or None,
                instructor_role = (ld.get("instructor_role") or "").strip() or None,
                member_type     = (ld.get("member_type") or "").strip() or None,
            ))

        for i, pd in enumerate(participants_data):
            db.session.add(TourParticipant(
                booking_id    = booking.id,
                sort_order    = i,
                member_number = (pd.get("member_number") or "").strip() or None,
                full_name     = (pd.get("full_name") or "").strip(),
                phone         = (pd.get("phone") or "").strip() or None,
                license       = (pd.get("license") or "").strip() or None,
                reg_no        = (pd.get("reg_no") or "").strip() or None,
                member_type   = (pd.get("member_type") or "").strip() or None,
                attend_days   = (pd.get("attend_days") or "").strip() or None,
            ))

        db.session.commit()
        return jsonify({"status": "ok", "booking_no": booking.booking_no, "id": booking.id})

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


# ══════════════════════════════════════════════════════════
# ツアー申込一覧・詳細取得
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings", methods=["GET"])
def list_tour_bookings():
    """GET /api/tour/bookings?status=pending&date_from=2026-05-01"""
    query = TourBooking.query

    status = request.args.get("status", "").strip()
    if status:
        query = query.filter(TourBooking.app_status == status)

    date_from = _parse_date(request.args.get("date_from"))
    if date_from:
        query = query.filter(TourBooking.flight_date_from >= date_from)

    date_to = _parse_date(request.args.get("date_to"))
    if date_to:
        query = query.filter(TourBooking.flight_date_to <= date_to)

    bookings = query.order_by(TourBooking.id.desc()).all()
    return jsonify([b.to_dict() for b in bookings])


@tour_bp.route("/api/tour/bookings/<int:booking_id>", methods=["GET"])
def get_tour_booking(booking_id):
    booking = TourBooking.query.get_or_404(booking_id)
    return jsonify(booking.to_dict())


# ══════════════════════════════════════════════════════════
# 申込番号（booking_no）で1件取得
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings/by-no/<string:booking_no>", methods=["GET"])
def get_tour_booking_by_no(booking_no):
    """GET /api/tour/bookings/by-no/TU-00001"""
    booking = TourBooking.query.filter_by(booking_no=booking_no).first()
    if not booking:
        return jsonify({"status": "error", "message": "見つかりません"}), 404
    return jsonify(booking.to_dict())


# ══════════════════════════════════════════════════════════
# ★ 改定４: スタッフ管理用 pending ツアー申込一覧
# GET /api/tour/bookings/pending
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings/pending", methods=["GET"])
def list_pending_tour_bookings():
    """
    GET /api/tour/bookings/pending
    app_status = 'pending' のツアー申込を返す。
    スタッフ管理ダッシュボードの「フライヤー申請（未）」セクションで使用。
    """
    bookings = (
        TourBooking.query
        .filter_by(app_status="pending")
        .order_by(TourBooking.created_at.desc())
        .all()
    )
    items = []
    for b in bookings:
        # 代表引率者（sort_order=0）の氏名を取得
        leader = next((l for l in sorted(b.leaders, key=lambda x: x.sort_order)), None)
        items.append({
            "id":              b.id,
            "booking_no":      b.booking_no,
            "school_name":     b.school_name,
            "contact_email":   b.contact_email,
            "flight_date_from": b.flight_date_from.isoformat() if b.flight_date_from else None,
            "flight_date_to":   b.flight_date_to.isoformat()   if b.flight_date_to   else None,
            "flight_days":     b.flight_days,
            "leader_name":     leader.full_name if leader else "—",
            "created_at":      b.created_at.strftime("%Y-%m-%d") if b.created_at else None,
        })
    return jsonify({"total": len(items), "items": items})


# ══════════════════════════════════════════════════════════
# ★ 改定４: ツアー申込 承認（pending → confirmed）
# PUT /api/tour/bookings/<id>/confirm
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings/<int:booking_id>/confirm", methods=["PUT"])
def confirm_tour_booking(booking_id):
    """
    PUT /api/tour/bookings/<id>/confirm
    app_status を pending → confirmed に更新する。
    """
    booking = TourBooking.query.get_or_404(booking_id)
    booking.app_status = "confirmed"
    booking.updated_at = datetime.utcnow()
    try:
        db.session.commit()
        return jsonify({"status": "ok", "booking_no": booking.booking_no})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


# ══════════════════════════════════════════════════════════
# ツアー申込 更新
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings/<int:booking_id>", methods=["PUT"])
def update_tour_booking(booking_id):
    """PUT /api/tour/bookings/<id>  フライト日・引率者・参加者を全置換更新"""
    booking = TourBooking.query.get_or_404(booking_id)
    data    = request.get_json(silent=True) or {}

    # school_name チェックの直後に追加（両関数とも同じ）
    contact_email = (data.get("contact_email") or "").strip()
    if not contact_email:
        return jsonify({"status": "error", "message": "連絡先メールアドレスは必須です"}), 400

    flight_date_from = _parse_date(data.get("flight_date_from"))
    flight_date_to   = _parse_date(data.get("flight_date_to"))
    if not flight_date_from or not flight_date_to:
        return jsonify({"status": "error", "message": "フライト日（開始・終了）は必須です"}), 400
    if flight_date_from > flight_date_to:
        return jsonify({"status": "error", "message": "終了日は開始日以降にしてください"}), 400

    booking.school_name      = (data.get("school_name") or booking.school_name or "").strip()
    booking.contact_email    = (data.get("contact_email") or "").strip() or None
    booking.flight_date_from = flight_date_from
    booking.flight_date_to   = flight_date_to
    booking.flight_days      = int(data.get("flight_days", 1))
    booking.updated_at       = datetime.utcnow()

    leaders_data = data.get("leaders", [])
    if not leaders_data:
        return jsonify({"status": "error", "message": "引率者を1名以上入力してください"}), 400

    # 引率者：全置換
    TourLeader.query.filter_by(booking_id=booking_id).delete()
    for i, ld in enumerate(leaders_data):
        db.session.add(TourLeader(
            booking_id      = booking_id,
            sort_order      = i,
            member_number   = (ld.get("member_number") or "").strip() or None,
            full_name       = (ld.get("full_name") or "").strip(),
            phone           = (ld.get("phone") or "").strip() or None,
            license         = (ld.get("license") or "").strip() or None,
            reg_no          = (ld.get("reg_no") or "").strip() or None,
            instructor_role = (ld.get("instructor_role") or "").strip() or None,
            member_type     = (ld.get("member_type") or "").strip() or None,
        ))

    # 参加者：全置換
    participants_data = data.get("participants", [])
    TourParticipant.query.filter_by(booking_id=booking_id).delete()
    for i, pd in enumerate(participants_data):
        db.session.add(TourParticipant(
            booking_id    = booking_id,
            sort_order    = i,
            member_number = (pd.get("member_number") or "").strip() or None,
            full_name     = (pd.get("full_name") or "").strip(),
            phone         = (pd.get("phone") or "").strip() or None,
            license       = (pd.get("license") or "").strip() or None,
            reg_no        = (pd.get("reg_no") or "").strip() or None,
            member_type   = (pd.get("member_type") or "").strip() or None,
            attend_days   = (pd.get("attend_days") or "").strip() or None,
        ))

    try:
        db.session.commit()
        return jsonify({"status": "ok", "booking_no": booking.booking_no})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


# ══════════════════════════════════════════════════════════
# ツアー申込 削除
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/bookings/<int:booking_id>", methods=["DELETE"])
def delete_tour_booking(booking_id):
    """DELETE /api/tour/bookings/<id>  申込ごと削除（CASCADE）"""
    booking = TourBooking.query.get_or_404(booking_id)
    db.session.delete(booking)
    try:
        db.session.commit()
        return jsonify({"status": "ok", "booking_no": booking.booking_no})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


# ══════════════════════════════════════════════════════════
# 引率者・参加者 個別削除
# ══════════════════════════════════════════════════════════

@tour_bp.route("/api/tour/leaders/<int:leader_id>", methods=["DELETE"])
def delete_tour_leader(leader_id):
    """DELETE /api/tour/leaders/<id>"""
    leader = TourLeader.query.get_or_404(leader_id)
    db.session.delete(leader)
    try:
        db.session.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@tour_bp.route("/api/tour/participants/<int:participant_id>", methods=["DELETE"])
def delete_tour_participant(participant_id):
    """DELETE /api/tour/participants/<id>"""
    participant = TourParticipant.query.get_or_404(participant_id)
    db.session.delete(participant)
    try:
        db.session.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
