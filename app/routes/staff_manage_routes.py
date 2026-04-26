"""
staff_manage_routes.py  rev.6（改定４ 2026-04-12）
スタッフ管理ダッシュボード API

改定４変更点:
  1. ダッシュボードに tour_pending を追加
       ツアー申込（pending）をフライヤー申請（未）セクションに表示
  2. TourBooking import 追加

改定８変更点（維持）:
  1. _get_expiry_alerts() 追加
       コース期限・フライヤー登録期限・リパック日の
       期限切れ/期限前をまとめて返す
  2. dashboard API に expiry_alerts を追加
  3. POST /api/staff/send_expiry_alert/<member_id>
       期限アラートの案内メールを送信する
"""
from flask import Blueprint, jsonify, request, render_template
from app.db import db
from app.models.member import Member
from app.models.member_application import MemberApplication   # ★ 追加
from app.models.member_course   import MemberCourse             # ★ 改定６追加
from app.models.member_contact  import MemberContact            # ★ スリム化追加
from app.models.member_flyer    import MemberFlyer              # ★ スリム化追加
from app.models.tour_booking    import TourBooking              # ★ 改定４追加
from datetime import date, datetime, timedelta
from calendar import monthrange
import traceback

staff_manage_bp = Blueprint("staff_manage", __name__)


@staff_manage_bp.route("/apply_staff_manage")
def staff_manage_page():
    return render_template("スタッフ.html")


# =========================================
# ダッシュボード API
# GET /api/staff/dashboard
# =========================================
@staff_manage_bp.route("/api/staff/dashboard", methods=["GET"])
def staff_dashboard():
    return jsonify({
        "flyer":         _get_flyer_pending(),
        "tour":          _get_tour_pending(),              # ★ 改定４追加
        "experience":    _get_exp_pending(),
        "payment":       _get_payment_pending(),
        "update_apps":   _get_update_applications(),   # ★ 追加
        "expiry_alerts": _get_expiry_alerts(),          # ★ 改定８追加
    })


# =========================================
# 入金確認 API（入山申請）
# POST /api/staff/confirm_payment/<io_id>?type=entrance|yamachin
# =========================================
@staff_manage_bp.route("/api/staff/confirm_payment/<int:io_id>", methods=["POST"])
def confirm_payment(io_id):
    """
    入金確認済みフラグを立てる。
    ?type=entrance   → entrance_fee_paid = TRUE
    ?type=yamachin   → yamachin_confirmed = TRUE
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
# ★ 新規申込 確認 API
# POST /api/staff/confirm_member/<member_id>
# =========================================
@staff_manage_bp.route("/api/staff/confirm_member/<int:member_id>", methods=["POST"])
def confirm_member(member_id):
    """
    新規申込（member_status='pending'）のスタッフ確認処理。
    app_info.js の「入金確認済」チェックボックス保存時に呼ぶ。

    改定６処理:
      - confirmed_at      = 当日日付（開始日として使用）
      - payment_confirmed = False（確認フラグをリセット）
      - member_status     = 'active'
      - updated_at        = 現在時刻
      - member_courses に新規コース履歴レコードを追加（初回登録）
    """
    try:
        member = Member.query.get_or_404(member_id)
        today  = date.today()

        member.confirmed_at      = today
        member.payment_confirmed = False
        member.member_status     = 'active'
        member.updated_at        = datetime.utcnow()

        # ★ 改定６: member_courses に初回コース履歴を登録
        # 既に current レコードがなければ新規追加
        try:
            existing = MemberCourse.get_current(member_id)
        except Exception:
            existing = None
        if not existing:
            # member_courses の初回登録: member_type は申込フォームの changes_json か
            # pending な MemberApplication から取得、なければ 'ビジター'
            pending_app = MemberApplication.query.filter_by(
                member_id=member_id, app_status='pending'
            ).first()
            if pending_app:
                changes = pending_app.get_changes()
                init_type = changes.get("member_type") or "ビジター"
                init_name = changes.get("course_name")
                init_fee  = changes.get("course_fee")
            else:
                init_type = "ビジター"
                init_name = None
                init_fee  = None
            initial_course = MemberCourse(
                member_id    = member_id,
                member_type  = init_type,
                course_name  = init_name,
                course_fee   = init_fee,
                start_date   = today,
                end_date     = None,
                status       = 'active',
                confirmed_by = 'staff',
            )
            db.session.add(initial_course)
        elif existing:
            # 既存レコードの start_date を確認日に合わせて更新
            try:
                existing.start_date = today
                existing.updated_at = datetime.utcnow()
            except Exception:
                pass

        # ── pending な new_member 申請を approved に更新 ──────────────
        pending_new = MemberApplication.query.filter_by(
            member_id=member_id,
            application_type="new_member",
            app_status="pending",
        ).first()
        if pending_new:
            pending_new.app_status   = "approved"
            pending_new.confirmed_at = datetime.utcnow()
            pending_new.confirmed_by = "staff"

        db.session.commit()

        # 確認後の member_type を返す（フロントで分類欄を更新するため）
        current_course = MemberCourse.get_current(member_id)
        confirmed_member_type = current_course.member_type if current_course else None

        return jsonify({
            "status":            "ok",
            "id":                member_id,
            "confirmed_at":      member.confirmed_at.isoformat(),
            "confirmed_member_type": confirmed_member_type,
        })
    except Exception:
        db.session.rollback()
        traceback.print_exc()
        return jsonify({"error": "更新に失敗しました"}), 500


# =========================================
# 内部ヘルパー
# =========================================

def _get_tour_pending():
    """
    ★ 改定４追加
    ツアー申込（未処理 pending）
    判定: tour_bookings.app_status = 'pending'
    """
    try:
        bookings = (
            TourBooking.query
            .filter_by(app_status="pending")
            .order_by(TourBooking.created_at.desc())
            .all()
        )
        items = []
        for b in bookings:
            leader = next(
                (l for l in sorted(b.leaders, key=lambda x: x.sort_order)), None
            )
            items.append({
                "id":               b.id,
                "booking_no":       b.booking_no,
                "school_name":      b.school_name,
                "contact_email":    b.contact_email,
                "flight_date_from": b.flight_date_from.isoformat() if b.flight_date_from else None,
                "flight_date_to":   b.flight_date_to.isoformat()   if b.flight_date_to   else None,
                "leader_name":      leader.full_name if leader else "—",
                "created_at":       b.created_at.strftime("%Y-%m-%d") if b.created_at else None,
            })
        return {"total": len(items), "items": items}
    except Exception:
        traceback.print_exc()
        return {"total": 0, "items": [], "error": "取得失敗"}


def _get_flyer_pending():
    """
    フライヤー申請（未処理）
    ★ 判定を updated_at IS NULL → member_status = 'pending' に変更
    """
    try:
        members = (
            Member.query
            .filter(Member.member_status == 'pending')   # ★ 変更
            .order_by(Member.id.desc())
            .all()
        )

        # ── N+1防止：active コースを1クエリで一括取得 ────────────
        m_ids = [m.id for m in members]
        courses = MemberCourse.query.filter(
            MemberCourse.member_id.in_(m_ids),
            MemberCourse.status == 'active',
            MemberCourse.end_date.is_(None),
        ).all() if m_ids else []
        course_map = {cc.member_id: cc for cc in courses}

        by_type: dict[str, int] = {}
        items = []
        for m in members:
            current_course = course_map.get(m.id)
            mtype = current_course.member_type if current_course else "不明"
            by_type[mtype] = by_type.get(mtype, 0) + 1
            items.append({
                "id":               m.id,
                "application_date": m.application_date.isoformat()
                                    if m.application_date else None,
                "full_name":        m.full_name,
                "member_type":      mtype,
                "member_number":    m.member_number,
                "confirmed_at":     m.confirmed_at.isoformat()
                                    if m.confirmed_at else None,
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
                "member_type":   r[2],
                "full_name":     r[3] or "（不明）",
                "member_number": r[4] or "—",
                "confirm_type":  confirm_type,
            }

        items_nyuzan   = [to_item(r, "entrance") for r in rows_nyuzan]
        items_yamachin = [to_item(r, "yamachin") for r in rows_yamachin]

        all_items = items_nyuzan + items_yamachin

        return {
            "entrance_total": len(items_nyuzan),
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


def _get_update_applications():
    """
    ★ 新規追加
    更新・変更申請（未処理）
    判定: member_applications.app_status = 'pending'
    """
    try:
        apps = (
            MemberApplication.query
            .filter_by(app_status='pending')
            .order_by(MemberApplication.applied_at.desc())
            .all()
        )

        # 申請種別の日本語ラベル
        type_labels = {
            "renewal":       "更新",
            "course_change": "コース変更",
            "info_change":   "情報変更",
        }

        # ── N+1防止：コースを1クエリで一括取得 ──────────────────
        app_member_ids = [a.member_id for a in apps if a.member_id]
        app_courses = MemberCourse.query.filter(
            MemberCourse.member_id.in_(app_member_ids),
            MemberCourse.status == 'active',
            MemberCourse.end_date.is_(None),
        ).all() if app_member_ids else []
        app_course_map = {cc.member_id: cc for cc in app_courses}

        items = []
        for a in apps:
            m = a.member   # MemberApplication.member リレーション
            current_course = app_course_map.get(a.member_id) if m else None
            mtype = current_course.member_type if current_course else "—"
            items.append({
                "app_id":           a.id,
                "member_id":        a.member_id,
                "application_type": a.application_type,
                "type_label":       type_labels.get(a.application_type, a.application_type),
                "full_name":        m.full_name        if m else "—",
                "member_number":    m.member_number    if m else "—",
                "member_type":      mtype,
                "applied_at":       a.applied_at.strftime("%Y-%m-%d %H:%M"),
                "changes":          a.get_changes(),
            })

        return {"total": len(items), "items": items}

    except Exception:
        traceback.print_exc()
        return {"total": 0, "items": [], "error": "取得失敗"}

# =========================================
# ★ 改定４追加
# ツアー案内メール送信 API
# POST /api/staff/send_tour_mail
# =========================================
@staff_manage_bp.route("/api/staff/send_tour_mail", methods=["POST"])
def send_tour_mail():
    """
    ツアー申込承認の案内メールを送信する。
    リクエストボディ: { from_email, to_email, subject, body }
    """
    try:
        from app.routes.member_routes import _do_send_mail
        data       = request.get_json(force=True) or {}
        from_email = data.get("from_email", "").strip()
        to_email   = data.get("to_email",   "").strip()
        subject    = data.get("subject",    "").strip()
        body       = data.get("body",       "").strip()

        if not from_email or not to_email or not subject:
            return jsonify({"error": "送信元・送信先・件名は必須です"}), 400

        _do_send_mail(from_email, to_email, subject, body)
        return jsonify({"status": "ok", "message": "案内メールを送信しました"})
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "メール送信に失敗しました"}), 500


# =========================================
# ★ 改定８追加
# 期限前/期限切れ 案内メール送信 API
# POST /api/staff/send_expiry_alert/<member_id>
# =========================================
@staff_manage_bp.route(
    "/api/staff/send_expiry_alert/<int:member_id>", methods=["POST"]
)
def send_expiry_alert(member_id):
    """
    期限アラートの案内メールを送信する。
    リクエストボディ: { from_email, to_email, subject, body }
    """
    try:
        from app.routes.member_routes import _do_send_mail
        data       = request.get_json(force=True) or {}
        from_email = data.get("from_email", "").strip()
        to_email   = data.get("to_email",   "").strip()
        subject    = data.get("subject",    "").strip()
        body       = data.get("body",       "").strip()

        if not from_email or not to_email or not subject:
            return jsonify({"error": "送信元・送信先・件名は必須です"}), 400

        _do_send_mail(from_email, to_email, subject, body)
        return jsonify({"status": "ok", "message": "案内メールを送信しました"})
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "メール送信に失敗しました"}), 500


# =========================================
# ★ 改定８追加
# 期限前/期限切れ アラート ヘルパー
# =========================================
def _get_expiry_alerts():
    """
    フライヤー各種期限の期限切れ・期限前を一覧で返す。

    期限項目:
        course   : コース（年会員・スクール・冬季会員）
        reglimit : フライヤー登録期限
        repack   : リパック日（年会員・スクールのみ）

    期限分類:
        expired  : 期限日 < today
        soon     : 期限前（各項目ごとに閾値が異なる）

    期限前の閾値:
        年会員・スクール（コース）: 2ヶ月前
        フライヤー登録期限         : 1ヶ月前
        リパック日                  : 1ヶ月前
        冬季会員                    : 期限切れのみ（期限前表示なし）
    """
    try:
        today  = date.today()
        alerts = []

        # active な会員を全取得
        members = (
            Member.query
            .filter(Member.member_status == 'active')
            .all()
        )

        # ── N+1防止：コース・連絡先を一括取得 ────────────────────
        active_member_ids = [m.id for m in members]
        ea_courses = MemberCourse.query.filter(
            MemberCourse.member_id.in_(active_member_ids),
            MemberCourse.status == 'active',
            MemberCourse.end_date.is_(None),
        ).all() if active_member_ids else []
        ea_course_map = {cc.member_id: cc for cc in ea_courses}

        ea_contacts = MemberContact.query.filter(
            MemberContact.member_id.in_(active_member_ids)
        ).all() if active_member_ids else []
        ea_contact_map = {cc.member_id: cc for cc in ea_contacts}

        for m in members:
            flyer  = m.flyer
            course = ea_course_map.get(m.id)

            contact = ea_contact_map.get(m.id)
            member_info = {
                "member_id":     m.id,
                "full_name":     m.full_name or "（不明）",
                "member_number": m.member_number or "—",
                "license":       flyer.license if flyer else None,
                "email":         contact.email if contact else None,
            }

            # ── 項1: コース期限 ───────────────────────────────────
            if course and course.member_type in ("年会員", "スクール", "冬季会員"):
                mtype      = course.member_type
                start_date = course.start_date

                if mtype in ("年会員", "スクール"):
                    # 開始日から1年後
                    try:
                        exp_date = start_date.replace(year=start_date.year + 1)
                    except ValueError:
                        exp_date = start_date.replace(year=start_date.year + 1, day=28)
                    warn_date = _add_months(exp_date, -2)
                    if today > exp_date:
                        status = "expired"
                    elif today >= warn_date:
                        status = "soon"
                    else:
                        status = None

                elif mtype == "冬季会員":
                    # 当年4月30日（start_dateより前なら翌年）
                    exp_date = date(today.year, 4, 30)
                    if exp_date < start_date:
                        exp_date = date(today.year + 1, 4, 30)
                    # 冬季会員は期限切れのみ
                    status = "expired" if today > exp_date else None
                else:
                    status = None

                if status:
                    course_label = mtype
                    if course.course_name:
                        course_label = f"{mtype}（{course.course_name}）"
                    alerts.append({
                        **member_info,
                        "item":      "コース",
                        "item_type": mtype,
                        "exp_date":  exp_date.isoformat(),
                        "status":    status,
                        "label":     course_label,
                    })

            # ── 項2: フライヤー登録期限 ───────────────────────────
            if flyer and flyer.reglimit_date:
                exp_date  = flyer.reglimit_date
                warn_date = _add_months(exp_date, -1)
                if today > exp_date:
                    status = "expired"
                elif today >= warn_date:
                    status = "soon"
                else:
                    status = None

                if status:
                    alerts.append({
                        **member_info,
                        "item":      "フライヤー登録期限",
                        "item_type": "reglimit",
                        "exp_date":  exp_date.isoformat(),
                        "status":    status,
                        "label":     "フライヤー登録期限",
                    })

            # ── 項3: リパック日（年会員・スクールのみ） ───────────
            if (flyer and flyer.repack_date
                    and course and course.member_type in ("年会員", "スクール")):
                exp_date  = _repack_expiry(flyer.repack_date)
                warn_date = _add_months(exp_date, -1)
                if today > exp_date:
                    status = "expired"
                elif today >= warn_date:
                    status = "soon"
                else:
                    status = None

                if status:
                    alerts.append({
                        **member_info,
                        "item":      "リパック日",
                        "item_type": "repack",
                        "exp_date":  exp_date.isoformat(),
                        "status":    status,
                        "label":     "リパック日",
                    })

        # 期限切れ優先・期限日昇順でソート
        def sort_key(a):
            return (0 if a["status"] == "expired" else 1, a["exp_date"])

        alerts.sort(key=sort_key)
        return {"total": len(alerts), "items": alerts}

    except Exception:
        traceback.print_exc()
        return {"total": 0, "items": [], "error": "取得失敗"}


# ── 日付ユーティリティ ─────────────────────────────────────────────

def _add_months(d: date, months: int) -> date:
    """date d に months ヶ月を加算する（月末補正あり）"""
    month = d.month - 1 + months
    year  = d.year + month // 12
    month = month % 12 + 1
    day   = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def _repack_expiry(repack_date: date) -> date:
    """
    リパック日（登録月）を含む 6か月後の末日を返す。
    例: repack_date=2025-03-01 → 6か月目=2025-08 → 2025-08-31
    登録月を1か月目として +5か月後の月末。
    """
    base     = repack_date.replace(day=1)
    exp      = _add_months(base, 5)
    last_day = monthrange(exp.year, exp.month)[1]
    return exp.replace(day=last_day)


# =========================================
# コース変更情報取得 API
# GET /api/staff/member_course_change/<member_id>
# =========================================
@staff_manage_bp.route("/api/staff/member_course_change/<int:member_id>", methods=["GET"])
def get_member_course_change(member_id):
    """
    会員情報編集のコース変更パネル用。
    1. member_applications に course_change + pending があれば changes_json を返す
    2. なければ member_courses の現在 active レコードを返す
    3. どちらもなければ null を返す
    """
    try:
        # ① course_change + pending を探す
        pending = (
            MemberApplication.query
            .filter_by(
                member_id=member_id,
                application_type="course_change",
                app_status="pending",
            )
            .order_by(MemberApplication.applied_at.desc())
            .first()
        )
        if pending:
            ch = pending.get_changes()
            return jsonify({
                "source":      "pending",
                "member_type": ch.get("member_type") or None,
                "course_name": ch.get("course_name") or None,
                "course_fee":  ch.get("course_fee")  or None,
                "applied_at":  pending.applied_at.strftime("%Y-%m-%d") if pending.applied_at else None,
                "app_id":      pending.id,
            })

        # ② member_courses の現在 active を返す
        current = MemberCourse.get_current(member_id)
        if current:
            return jsonify({
                "source":      "current",
                "member_type": current.member_type,
                "course_name": current.course_name,
                "course_fee":  current.course_fee,
                "applied_at":  None,
                "app_id":      None,
            })

        return jsonify(None)

    except Exception:
        traceback.print_exc()
        return jsonify(None)


# =========================================
# カレンダーデータ API
# GET /api/staff/calendar?year=YYYY&month=MM
# 指定月の各日について:
#   tours     : ツアー申込（confirmed含む全件）の一覧
#   exp_count : 体験予約件数
#   unpaid    : 入山未入金件数
# =========================================
@staff_manage_bp.route("/api/staff/calendar", methods=["GET"])
def staff_calendar():
    try:
        today = date.today()
        year  = int(request.args.get("year",  today.year))
        month = int(request.args.get("month", today.month))

        first_day = date(year, month, 1)
        last_day  = date(year, month, monthrange(year, month)[1])

        # ── ツアー（期間が当月に重なるもの）──────────────────────
        sql_tour = db.text("""
            SELECT id, booking_no, school_name, flight_date_from, flight_date_to, app_status
            FROM tour_bookings
            WHERE app_status != 'cancelled'
              AND flight_date_from <= :last_day
              AND flight_date_to   >= :first_day
            ORDER BY flight_date_from ASC
        """)
        tour_rows = db.session.execute(
            sql_tour, {"first_day": first_day, "last_day": last_day}
        ).fetchall()

        # ── 体験予約（当月分）──────────────────────────────────
        sql_exp = db.text("""
            SELECT reservation_date, COUNT(*) AS cnt
            FROM exp_reservation
            WHERE (cancelled IS NULL OR cancelled = FALSE)
              AND reservation_date >= :first_day
              AND reservation_date <= :last_day
            GROUP BY reservation_date
        """)
        exp_rows = db.session.execute(
            sql_exp, {"first_day": first_day, "last_day": last_day}
        ).fetchall()
        exp_map = {str(r[0]): r[1] for r in exp_rows}

        # ── 入山未入金（entry_date が当月・入山料未確認）──────────
        sql_pay = db.text("""
            SELECT entry_date, COUNT(*) AS cnt
            FROM io_flight
            WHERE (entrance_fee_paid IS NULL OR entrance_fee_paid = FALSE)
              AND entry_date >= :first_day
              AND entry_date <= :last_day
            GROUP BY entry_date
        """)
        pay_rows = db.session.execute(
            sql_pay, {"first_day": first_day, "last_day": last_day}
        ).fetchall()
        pay_map = {str(r[0]): r[1] for r in pay_rows}

        # ── ツアーを日付ごとにマッピング ──────────────────────────
        # 期間中の各日にツアーを紐づける
        tour_by_date = {}  # "YYYY-MM-DD" -> [ {id, booking_no, school_name, ...} ]
        for r in tour_rows:
            t_from = r[3] if isinstance(r[3], date) else date.fromisoformat(str(r[3]))
            t_to   = r[4] if isinstance(r[4], date) else date.fromisoformat(str(r[4]))
            cur = max(t_from, first_day)
            end = min(t_to,   last_day)
            d = cur
            while d <= end:
                key = d.isoformat()
                if key not in tour_by_date:
                    tour_by_date[key] = []
                tour_by_date[key].append({
                    "id":           r[0],
                    "booking_no":   r[1],
                    "school_name":  r[2],
                    "date_from":    str(r[3]),
                    "date_to":      str(r[4]),
                    "app_status":   r[5],
                })
                d += timedelta(days=1)

        # ── 日別データを構築 ──────────────────────────────────────
        num_days = monthrange(year, month)[1]
        days = []
        for day in range(1, num_days + 1):
            d_str = date(year, month, day).isoformat()
            days.append({
                "date":      d_str,
                "tours":     tour_by_date.get(d_str, []),
                "exp_count": exp_map.get(d_str, 0),
                "unpaid":    pay_map.get(d_str, 0),
            })

        return jsonify({
            "year":  year,
            "month": month,
            "days":  days,
        })

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "カレンダーデータ取得失敗"}), 500


# =========================================
# 入山未入金 日別詳細 API
# GET /api/staff/calendar_pay?date=YYYY-MM-DD
# =========================================
@staff_manage_bp.route("/api/staff/calendar_pay", methods=["GET"])
def calendar_pay_detail():
    try:
        date_str = request.args.get("date")
        if not date_str:
            return jsonify([])

        # ── 入山料未確認 ──
        sql_e = db.text("""
            SELECT id, entry_date, full_name, member_number, member_class
            FROM io_flight
            WHERE (entrance_fee_paid IS NULL OR entrance_fee_paid = FALSE)
              AND entry_date = :date_str
            ORDER BY id ASC
        """)
        rows_e = db.session.execute(sql_e, {"date_str": date_str}).fetchall()

        # ── 山チン未確認 ──
        sql_y = db.text("""
            SELECT id, entry_date, full_name, member_number, member_class
            FROM io_flight
            WHERE yamachin = TRUE
              AND (yamachin_confirmed IS NULL OR yamachin_confirmed = FALSE)
              AND entry_date = :date_str
            ORDER BY id ASC
        """)
        rows_y = db.session.execute(sql_y, {"date_str": date_str}).fetchall()

        def to_item(r, confirm_type):
            return {
                "id":            r[0],
                "flight_date":   str(r[1]) if r[1] else None,
                "full_name":     r[2] or "（不明）",
                "member_number": r[3] or "—",
                "member_type":   r[4] or "—",
                "confirm_type":  confirm_type,
            }

        items = [to_item(r, "entrance") for r in rows_e] + \
                [to_item(r, "yamachin") for r in rows_y]
        return jsonify(items)

    except Exception:
        traceback.print_exc()
        return jsonify([]), 500
