"""
app/routes/member_mail_routes.py
会員案内メール送信 API
member_routes.py から分離（E: ファイル分割）

含む処理:
    _do_send_mail()           : SMTP送信共通ヘルパー（他routesからimport）
    _get_mail_config_values() : 設定管理から送信設定を取得
    _build_mail_preview()     : メールプレビュー生成
    GET  /api/members/<id>/mail_preview
    POST /api/members/<id>/send_info
    GET  /api/members/expiry_alerts
    GET  /api/config/course_fee
"""

from flask import Blueprint, request, jsonify
from app.db import db
from app.models.member import Member
from app.models.member_application import MemberApplication
from app.models.member_course   import MemberCourse
from app.models.member_contact  import MemberContact
from app.models.member_flyer    import MemberFlyer
from datetime import datetime, date, timedelta
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from sqlalchemy import text

member_mail_bp = Blueprint("member_mail", __name__)

# _calc_course_expire は member_routes.py に残っているため import
from app.routes.member_routes import _calc_course_expire, member_bp


# =========================================
# ★ 改定７：案内メール共通ヘルパー
# =========================================

def _do_send_mail(from_email: str, to_email: str, subject: str, body: str) -> None:
    """
    SMTP メール送信共通ヘルパー。
    MAIL_BACKEND=dummy の場合はログ出力のみ（ローカル開発用）。
    失敗時は Exception を送出する（呼び出し元でハンドルすること）。
    staff_manage_routes.py の send_expiry_alert / send_tour_mail から
    import して使用する。
    """
    mail_backend  = os.environ.get("MAIL_BACKEND", "smtp").lower()
    mail_server   = os.environ.get("MAIL_SERVER",   "")
    mail_port     = int(os.environ.get("MAIL_PORT", 587))
    use_tls       = os.environ.get("MAIL_USE_TLS", "true").lower() != "false"
    mail_user     = os.environ.get("MAIL_USERNAME", "")
    mail_password = os.environ.get("MAIL_PASSWORD", "")

    if mail_backend == "dummy":
        print("=" * 60)
        print("[MAIL DUMMY] ダミー送信（実際には送信されていません）")
        print(f"  From   : {from_email}")
        print(f"  To     : {to_email}")
        print(f"  Subject: {subject}")
        print("  Body   :")
        print(body)
        print("=" * 60)
        return

    if not mail_server:
        raise RuntimeError("MAIL_SERVER が設定されていません。Renderの環境変数を確認してください。")

    msg = MIMEMultipart()
    msg["From"]    = from_email
    msg["To"]      = to_email
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(body, "plain", "utf-8"))

    if use_tls:
        smtp = smtplib.SMTP(mail_server, mail_port, timeout=10)
        smtp.ehlo()
        smtp.starttls()
    else:
        smtp = smtplib.SMTP_SSL(mail_server, mail_port, timeout=10)

    if mail_user and mail_password:
        smtp.login(mail_user, mail_password)

    smtp.sendmail(from_email, [to_email], msg.as_bytes())
    smtp.quit()


def _get_mail_config_values(item_name):
    """config_master カテゴリ「メール関連」から item_name に一致する
    config_values を sort_order 順で返す"""
    rows = db.session.execute(text("""
        SELECT cv.value, cv.label, cv.sort_order
        FROM config_master cm
        JOIN config_values cv ON cv.master_id = cm.id
        WHERE cm.category = 'メール関連'
          AND cm.item_name = :item_name
          AND cv.is_active = TRUE
        ORDER BY cv.sort_order, cv.id
    """), {"item_name": item_name}).fetchall()
    return [dict(r._mapping) for r in rows]


def _build_mail_preview(member_id):
    """
    会員IDからメールプレビュー用の辞書を生成して返す。
    エラー時は (None, エラーメッセージ, HTTPステータス) を返す。
    正常時は (dict, None, None) を返す。
    """
    member = Member.query.get(member_id)
    if not member:
        return None, "会員が見つかりません", 404

    contact = MemberContact.query.filter_by(member_id=member.id).first()
    to_email = (contact.email or "").strip() if contact else ""
    full_name = (member.full_name or "").strip()

    # 送信元（複数対応：labelがあればラベル付き、なければvalueをそのまま）
    sender_vals = _get_mail_config_values("送信元")
    if not sender_vals:
        return None, "設定管理に「送信元」が登録されていません", 500
    from_emails = [
        {"value": v["value"].strip(), "label": (v["label"] or v["value"]).strip()}
        for v in sender_vals
        if v["value"] and v["value"].strip()
    ]
    if not from_emails:
        return None, "設定管理に有効な「送信元」が登録されていません", 500

    # 件名（なければデフォルト）
    subject_vals = _get_mail_config_values("件名")
    subject = subject_vals[0]["value"].strip() if subject_vals else "ご案内"

    # 案内（本文テンプレート）
    body_vals = _get_mail_config_values("案内")
    if not body_vals:
        return None, "設定管理に「案内」が登録されていません", 500
    body_template = body_vals[0]["value"] or ""

    # 署名（sort_order 順に連結）
    sign_vals = _get_mail_config_values("署名")
    signature_lines = [v["value"] for v in sorted(sign_vals, key=lambda x: x["sort_order"])]
    signature_text = "\n".join(signature_lines)

    # 本文組み立て: 「氏名 様」+ 空行 + テンプレート + 空行 + 署名
    greeting = f"{full_name} 様"
    body = f"{greeting}\n\n{body_template}\n\n{signature_text}"

    return {
        "from_emails": from_emails,
        "to_email":    to_email,
        "subject":     subject,
        "body":        body,
        "full_name":   full_name,
    }, None, None


# ── メールプレビュー取得 ─────────────────────────────────────────────
# GET /api/members/<member_id>/mail_preview
# 設定管理の値を元に組み立てたメール内容（送信元・送信先・件名・本文）を返す。
# フロント側がプレビューモーダルに表示し、スタッフが編集してから送信ボタンを押す。
@member_mail_bp.route("/api/members/<int:member_id>/mail_preview", methods=["GET"])
def mail_preview(member_id):
    preview, err, status = _build_mail_preview(member_id)
    if err:
        return jsonify({"error": err}), status
    if not preview["to_email"]:
        return jsonify({"error": "メールアドレスが登録されていません"}), 400
    return jsonify(preview)


# ── 案内メール送信 ───────────────────────────────────────────────────
# POST /api/members/<member_id>/send_info
# リクエストボディ JSON:
#   { "from_email": "...", "to_email": "...", "subject": "...", "body": "..." }
# スタッフがプレビューモーダルで内容を確認・編集した後に呼び出す。
#
# SMTP設定は環境変数から取得:
#   MAIL_SERVER  (default: localhost)
#   MAIL_PORT    (default: 587)
#   MAIL_USE_TLS (default: true)
#   MAIL_USERNAME
#   MAIL_PASSWORD
@member_mail_bp.route("/api/members/<int:member_id>/send_info", methods=["POST"])
def send_info(member_id):
    member = Member.query.get(member_id)
    if not member:
        return jsonify({"error": "会員が見つかりません"}), 404

    data       = request.get_json(silent=True) or {}
    from_email = (data.get("from_email") or "").strip()
    to_email   = (data.get("to_email")   or "").strip()
    subject    = (data.get("subject")    or "").strip()
    body       = (data.get("body")       or "").strip()

    if not from_email:
        return jsonify({"error": "送信元が指定されていません"}), 400
    if not to_email:
        return jsonify({"error": "送信先が指定されていません"}), 400
    if not subject:
        return jsonify({"error": "件名が指定されていません"}), 400

    try:
        _do_send_mail(from_email, to_email, subject, body)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"メール送信に失敗しました: {str(e)}"}), 500

    full_name = (member.full_name or "").strip()
    return jsonify({
        "ok":      True,
        "to":      to_email,
        "subject": subject,
        "message": f"{full_name} 様にメールを送信しました",
    })


# =========================================
# ★ 改定８：期限通知アラート取得 API
# =========================================

# GET /api/members/expiry_alerts
# 期限が近い会員リストを返す（会員管理画面の通知表示・手動メール送信用）
# レスポンス JSON:
# {
#   "annual": [...],   # 年会員：期限2ヶ月前以内
#   "winter": [...],   # 冬季会員：期限2週間前以内
#   "school": [...],   # スクール：期限1ヶ月前以内
# }
# 各要素: { id, member_number, full_name, email, member_type, expire_date, remain_days }
@member_mail_bp.route("/api/members/expiry_alerts", methods=["GET"])
def get_expiry_alerts():
    today  = date.today()
    result = {"annual": [], "winter": [], "school": []}

    # 有効なコースを持つ active 会員を取得
    active_courses = (
        MemberCourse.query
        .filter(
            MemberCourse.status == "active",
            MemberCourse.end_date.is_(None),
            MemberCourse.member_type.in_(["年会員", "冬季会員", "スクール"]),
        )
        .all()
    )

    # ── N+1防止：対象会員・連絡先を一括取得 ──────────────────────
    course_member_ids = [course.member_id for course in active_courses]
    if course_member_ids:
        members_map = {
            m.id: m for m in
            Member.query.filter(
                Member.id.in_(course_member_ids),
                Member.member_status == 'active',
            ).all()
        }
        contacts_map = {
            cc.member_id: cc for cc in
            MemberContact.query.filter(
                MemberContact.member_id.in_(course_member_ids)
            ).all()
        }
    else:
        members_map = {}
        contacts_map = {}

    for course in active_courses:
        expire_dt = _calc_course_expire(course.member_type, course.start_date)
        if not expire_dt:
            continue

        remain = (expire_dt - today).days

        # 通知期間の判定
        if course.member_type == "年会員" and remain > 60:
            continue
        if course.member_type == "冬季会員" and remain > 14:
            continue
        if course.member_type == "スクール" and remain > 31:
            continue
        if remain < 0:
            continue  # 期限切れはスキップ（自動処理済み）

        member = members_map.get(course.member_id)
        if not member:
            continue

        contact = contacts_map.get(member.id)
        email   = (contact.email or "") if contact else ""

        row = {
            "id":            member.id,
            "member_number": member.member_number,
            "full_name":     member.full_name,
            "email":         email,
            "member_type":   course.member_type,
            "expire_date":   expire_dt.isoformat(),
            "remain_days":   remain,
        }

        if course.member_type == "年会員":
            result["annual"].append(row)
        elif course.member_type == "冬季会員":
            result["winter"].append(row)
        elif course.member_type == "スクール":
            result["school"].append(row)

    # 残日数の少ない順にソート
    for key in result:
        result[key].sort(key=lambda x: x["remain_days"])

    return jsonify(result)


# =========================================
# ★ 改定８：コース料金取得 API
# =========================================

# GET /api/config/course_fee?course=冬季継続
# config_master からコース名に対応する料金を返す
# レスポンス JSON: { "fee": "30000", "course": "冬季継続" }
@member_mail_bp.route("/api/config/course_fee", methods=["GET"])
def get_course_fee():
    course_name = (request.args.get("course") or "").strip()
    if not course_name:
        return jsonify({"error": "course パラメータが必要です"}), 400

    row = db.session.execute(text("""
        SELECT cv.value
        FROM config_master cm
        JOIN config_values cv ON cv.master_id = cm.id
        WHERE cm.item_name = :item_name
          AND cv.is_active = TRUE
        ORDER BY cv.sort_order, cv.id
        LIMIT 1
    """), {"item_name": course_name}).fetchone()

    if not row:
        return jsonify({"fee": None, "course": course_name})

    return jsonify({"fee": row[0], "course": course_name})


