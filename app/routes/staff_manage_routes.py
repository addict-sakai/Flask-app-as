"""
staff_manage_routes.py  rev.4（改定２ 2026-03-23）
スタッフ管理ダッシュボード API
DB構成V2 対応

改定２変更点:
  1. confirm_member() を改修
       confirmed_at（確認日）に当日日付をセット
       payment_confirmed を False にリセット（確認フラグは一時的なもの）
       member_status を 'active' に変更
  2. _member_to_dict() に confirmed_at を追加
"""
from flask import Blueprint, jsonify, request
from app.db import db
from app.models.member import Member
from app.models.member_application import MemberApplication   # ★ 追加
from app.models.member_course   import MemberCourse             # ★ 改定６追加
from app.models.member_contact  import MemberContact            # ★ スリム化追加
from app.models.member_flyer    import MemberFlyer              # ★ スリム化追加
from datetime import date, datetime
import traceback

staff_manage_bp = Blueprint("staff_manage", __name__)


# =========================================
# ダッシュボード API
# GET /api/staff/dashboard
# =========================================
@staff_manage_bp.route("/api/staff/dashboard", methods=["GET"])
def staff_dashboard():
    return jsonify({
        "flyer":       _get_flyer_pending(),
        "experience":  _get_exp_pending(),
        "payment":     _get_payment_pending(),
        "update_apps": _get_update_applications(),   # ★ 追加
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

        by_type: dict[str, int] = {}
        items = []
        for m in members:
            # member_courses（現在有効）から取得、未作成なら "不明"
            try:
                current_course = MemberCourse.get_current(m.id)
                mtype = current_course.member_type if current_course else "不明"
            except Exception:
                mtype = "不明"
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

        items = []
        for a in apps:
            m = a.member   # MemberApplication.member リレーション
            # member_type は member_courses（現在有効）から取得
            try:
                current_course = MemberCourse.get_current(a.member_id) if m else None
                mtype = current_course.member_type if current_course else "—"
            except Exception:
                mtype = "—"
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
