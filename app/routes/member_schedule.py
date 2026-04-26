"""
app/routes/member_schedule.py
APScheduler による日次バッチ処理・コース期限管理
member_routes.py から分離（E: ファイル分割）

含む処理:
    _send_course_change_mail() : コース変更通知メール
    _daily_member_check()      : 毎日00:05 コース期限切れ自動処理
    init_member_scheduler()    : スケジューラ起動（__init__.py から呼ぶ）
"""

from app.db import db
from app.models.member import Member
from app.models.member_application import MemberApplication
from app.models.member_course   import MemberCourse
from app.models.member_contact  import MemberContact
from app.models.member_flyer    import MemberFlyer
from datetime import datetime, date, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import os

# _do_send_mail は member_mail_routes.py に移動
from app.routes.member_mail_routes import _do_send_mail

_member_flask_app = None


# =========================================
# ★ 改定８：コース変更メール送信ヘルパー
# =========================================

def _send_course_change_mail(member: Member, new_member_type: str) -> None:
    """
    コースが変更された会員に通知メールを送信する。
    MAIL_BACKEND=dummy の場合はログ出力のみ。
    失敗しても例外は握り潰す（メール失敗でDB処理を巻き戻さない）。
    """
    try:
        contact = MemberContact.query.filter_by(member_id=member.id).first()
        if not contact or not contact.email:
            return  # メールアドレスなしはスキップ

        to_email  = contact.email.strip()
        full_name = (member.full_name or "").strip()

        # 設定管理から送信元取得
        sender_vals = _get_mail_config_values("送信元")
        if not sender_vals:
            return
        from_email = sender_vals[0]["value"].strip()

        subject = f"コース変更のご連絡"
        body = (
            f"{full_name} 様\n\n"
            f"コースが「{new_member_type}」に変更されました。\n\n"
            f"ご不明な点はスタッフまでお問い合わせください。\n"
        )

        # 署名追加
        sign_vals = _get_mail_config_values("署名")
        if sign_vals:
            signature_lines = [v["value"] for v in sorted(sign_vals, key=lambda x: x["sort_order"])]
            body += "\n" + "\n".join(signature_lines)

        mail_backend  = os.environ.get("MAIL_BACKEND", "smtp").lower()
        mail_server   = os.environ.get("MAIL_SERVER",  "")
        mail_port     = int(os.environ.get("MAIL_PORT", 587))
        use_tls       = os.environ.get("MAIL_USE_TLS", "true").lower() != "false"
        mail_user     = os.environ.get("MAIL_USERNAME", "")
        mail_password = os.environ.get("MAIL_PASSWORD", "")

        if mail_backend == "dummy":
            print("=" * 60)
            print("[MAIL DUMMY] コース変更通知")
            print(f"  From   : {from_email}")
            print(f"  To     : {to_email}")
            print(f"  Subject: {subject}")
            print(f"  Body   :\n{body}")
            print("=" * 60)
        else:
            if not mail_server:
                return
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

    except Exception as e:
        print(f"[_send_course_change_mail] メール送信失敗: {e}")


def _daily_member_check():
    if _member_flask_app is None:
        return
    with _member_flask_app.app_context():
        today   = date.today()
        targets = Member.query.filter(Member.member_status == 'active').all()

        changed = 0
        for m in targets:
            # member_flyers から期限情報を取得
            f = m.flyer
            if not f:
                continue  # フライヤー情報なしはスキップ

            reglimit      = f.reglimit_date
            next_reglimit = f.next_reglimit_date

            # ① 早期更新の適用日到来
            if next_reglimit and reglimit and reglimit <= today:
                f.reglimit_date      = next_reglimit
                f.next_reglimit_date = None
                f.updated_at         = datetime.utcnow()
                changed += 1
                continue  # 以下の期限切れ判定はスキップ

            # ★ 改定８：コース期限切れ判定
            current_course = MemberCourse.get_current(m.id)
            if not current_course:
                continue

            mt = current_course.member_type
            start = current_course.start_date

            # コース期限日を計算
            expire_dt = _calc_course_expire(mt, start)

            if expire_dt is None:
                continue  # ビジター等は期限なし

            if expire_dt >= today:
                continue  # 期限内

            # ── 期限切れ処理 ──────────────────────────────────────
            if mt in ("年会員", "冬季会員"):
                # → ビジターに自動変更＋メール送信
                current_course.expire(end_date=today)
                db.session.add(MemberCourse(
                    member_id    = m.id,
                    member_type  = "ビジター",
                    start_date   = today,
                    status       = "active",
                    confirmed_by = "system",
                ))
                m.updated_at = datetime.utcnow()
                changed += 1
                _send_course_change_mail(m, "ビジター")

            elif mt == "スクール":
                # → 更新待ち（member_status を renewal_waiting に変更）
                m.member_status = "renewal_waiting"
                m.updated_at    = datetime.utcnow()
                changed += 1

        if changed:
            db.session.commit()
        print(f"[daily_member_check] {today} 処理件数: {changed}")


def init_member_scheduler(app):
    global _member_flask_app
    _member_flask_app = app

    scheduler = BackgroundScheduler(timezone="Asia/Tokyo")
    scheduler.add_job(
        _daily_member_check,
        trigger=CronTrigger(hour=0, minute=5, timezone="Asia/Tokyo"),
        id="daily_member_check",
        replace_existing=True,
    )
    scheduler.start()
    return scheduler


