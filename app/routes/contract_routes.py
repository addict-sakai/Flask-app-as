"""
contract_routes.py  –  請負日報 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem
"""

from flask import Blueprint, render_template, request, jsonify
from ..db import db  # 相対インポートに統一
# from ..models.rep_contract import RepContract  # 保存先はこちら
from ..models.contract import Contract       # もし他で使っていれば残す
from ..models.member import Member
from ..models.member_contact import MemberContact
from datetime import date, datetime, timedelta
from typing import Optional
import uuid as uuidlib
from sqlalchemy import func

contract_bp = Blueprint("contract", __name__)


# ─────────────────────────────────────────
# ヘルパー
# ─────────────────────────────────────────

def _fd(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


def _contract_to_dict(c: Contract) -> dict:
    return {
        "id":                c.id,
        "flight_date":       _fd(c.flight_date),
        "flight_time":       c.flight_time or "",
        "uuid":              c.uuid,
        "name":              c.name,
        "daily_flight":      c.daily_flight,
        "takeoff_location":  c.takeoff_location,
        "used_glider":       c.used_glider,
        "size":              c.size,
        "pilot_harness":     c.pilot_harness,
        "repack_date":       _fd(c.repack_date),
        "passenger_harness": c.passenger_harness,
        "near_miss":         c.near_miss,
        "improvement":       c.improvement,
        "damaged_section":   c.damaged_section,
        "mini_guarantee":    bool(c.mini_guarantee),
    }


# ─────────────────────────────────────────
# ページルート
# ─────────────────────────────────────────

# ─────────────────────────────────────────
# ページルート更新（統合ページ用）
# 既存の cont_tan_index を下記に置き換え
# ─────────────────────────────────────────

@contract_bp.route("/apply_cont_tan")
def cont_tan_index():
    """請負管理ページ（日報 + 出勤予定 統合）"""
    return render_template("請負日報.html")

# @contract_bp.route("/apply_cont_tan")
# def cont_tan_index():
#    """請負日報ページ（当月分のリストを初期描画）"""
#    today = date.today()
#    records = (
#        Contract.query
#        .filter(
#            db.extract("year",  Contract.flight_date) == today.year,
#            db.extract("month", Contract.flight_date) == today.month,
#        )
#        .order_by(Contract.flight_date, Contract.id)
#        .all()
#    )
#    return render_template("請負日報.html", records=records, today=today)


# ─────────────────────────────────────────
# API: 会員検索（会員番号 / UUID）
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/lookup", methods=["POST"])
def api_lookup():
    """
    Request  JSON: { "query": "<member_number or uuid>" }
    Response JSON: { "full_name": "...", "uuid": "...", "member_number": "..." }
    """
    data  = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()

    if not query:
        return jsonify({"error": "会員番号を入力してください"}), 400

    # 会員番号で検索（請負担当者のみ）、なければUUID（QR）で検索
    member = Member.query.filter_by(member_number=query, contract=True).first()
    if not member:
        try:
            uuidlib.UUID(query)   # UUID形式かチェック（不正な文字列を弾く）
            member = Member.query.filter(
                Member.uuid.cast(db.String) == query,
                Member.contract == True
            ).first()
        except ValueError:
            pass

    if not member:
        return jsonify({"error": "請負担当者が見つかりません"}), 404

    return jsonify({
        "full_name":     member.full_name,
        "uuid":          str(member.uuid).lower(),
        "member_number": member.member_number,
    })


# ─────────────────────────────────────────
# API: 氏名で会員検索（請負担当者のみ）
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/search_by_name", methods=["POST"])
def api_search_by_name():
    """
    氏名（部分一致）で請負担当者を検索する。
    Request  JSON: { "name": "山田" }
    Response JSON: { "members": [ { "full_name": "...", "uuid": "...", "member_number": "..." }, ... ] }
    """
    data  = request.get_json(silent=True) or {}
    name  = (data.get("name") or "").strip()

    if not name:
        return jsonify({"error": "氏名を入力してください"}), 400

    members = (
        Member.query
        .filter(
            Member.contract == True,
            Member.full_name.ilike(f"%{name}%"),
        )
        .order_by(Member.full_name)
        .limit(20)
        .all()
    )

    return jsonify({
        "members": [
            {
                "full_name":     m.full_name,
                "uuid":          str(m.uuid).lower(),
                "member_number": m.member_number,
            }
            for m in members
        ]
    })


# ─────────────────────────────────────────
# API: passコード検証（携帯番号下4桁）
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/verify_pass", methods=["POST"])
def api_verify_pass():
    """
    UUIDで会員を特定し、携帯番号の下4桁がpassと一致するか検証する。
    Request  JSON: { "uuid": "...", "pass": "1234" }
    Response JSON: { "full_name": "...", "uuid": "...", "member_number": "..." }
    """
    data      = request.get_json(silent=True) or {}
    uuid_str  = (data.get("uuid") or "").strip().lower()
    pass_code = (data.get("pass") or "").strip()

    if not uuid_str or not pass_code:
        return jsonify({"error": "パラメータが不足しています"}), 400

    if len(pass_code) != 4 or not pass_code.isdigit():
        return jsonify({"error": "passコードは4桁の数字で入力してください"}), 400

    # 会員取得
    member = Member.query.filter(
        Member.uuid.cast(db.String) == uuid_str,
        Member.contract == True,
    ).first()
    if not member:
        return jsonify({"error": "担当者が見つかりません"}), 404

    # 携帯番号取得（member_contactsテーブル）
    contact = MemberContact.query.filter_by(member_id=member.id).first()
    mobile = (contact.mobile_phone or "").strip() if contact else ""

    # 数字のみ抽出して下4桁を取得
    mobile_digits = "".join(c for c in mobile if c.isdigit())
    if len(mobile_digits) < 4:
        return jsonify({"error": "携帯番号が登録されていません。管理者にお問い合わせください"}), 403

    if mobile_digits[-4:] != pass_code:
        return jsonify({"error": "passコードが違います"}), 401

    return jsonify({
        "full_name":     member.full_name,
        "uuid":          str(member.uuid).lower(),
        "member_number": member.member_number,
    })


# ─────────────────────────────────────────
# API: 登録
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/register", methods=["POST"])
def api_register():
    """
    1本飛ぶ毎に1レコード登録する方式。
    Request JSON:
    {
      "uuid": "...", "name": "...",
      "flight_time": "09:30",
      "takeoff_location": "FUJIパラ",
      "used_glider": "K24", "size": "ML(41)",
      "pilot_harness": "...", "passenger_harness": "...",
      "mini_guarantee": false,          # 最低保証チェック
      "near_miss": "", "improvement": "", "damaged_section": ""
    }
    """
    from sqlalchemy import text as _text
    data = request.get_json(silent=True) or {}
    target_uuid = data.get("uuid")
    name = (data.get("name") or "").strip()
    today = date.today()

    if not target_uuid:
        return jsonify({"error": "UUIDが取得できません"}), 400

    flight_time    = (data.get("flight_time") or "").strip()
    mini_guarantee = bool(data.get("mini_guarantee", False))

    # 場所は必須（最低保証時は任意）
    takeoff_location = (data.get("takeoff_location") or "").strip()
    if not takeoff_location and not mini_guarantee:
        return jsonify({"error": "場所は必須です"}), 400
    def _get_config_value(item_name):
        row = db.session.execute(_text("""
            SELECT v.value FROM config_master m
            JOIN config_values v ON v.master_id = m.id
            WHERE m.category = '請負' AND m.item_name = :item_name
              AND m.is_active = true AND v.is_active = true
            ORDER BY v.sort_order, v.id LIMIT 1
        """), {"item_name": item_name}).fetchone()
        try:
            return int(float(row[0])) if row else 0
        except (ValueError, TypeError):
            return 0

    if mini_guarantee:
        # 最低保証：本数0・金額は最低保証料金
        flight_count  = 0
        total_amount  = _get_config_value("最低保証")
    else:
        # 通常：1本=1本料金（累積計算なし）
        flight_count  = 1
        total_amount  = _get_config_value("1本料金")

    # 新規レコード登録
    record = Contract(
        flight_date       = today,
        flight_time       = flight_time or None,
        uuid              = target_uuid,
        name              = name,
        daily_flight      = flight_count,
        takeoff_location  = takeoff_location,
        used_glider       = (data.get("used_glider") or "").strip() or None,
        size              = (data.get("size") or "").strip() or None,
        pilot_harness     = (data.get("pilot_harness") or "").strip() or None,
        repack_date       = None,
        passenger_harness = (data.get("passenger_harness") or "").strip() or None,
        near_miss         = (data.get("near_miss") or "").strip() or None,
        improvement       = (data.get("improvement") or "").strip() or None,
        damaged_section   = (data.get("damaged_section") or "").strip() or None,
        total_amount      = total_amount,
        mini_guarantee    = mini_guarantee,
    )
    db.session.add(record)

    try:
        db.session.commit()
        # 当日の通常フライト本数（最低保証除く）
        flight_number = Contract.query.filter_by(
            uuid=target_uuid, flight_date=today, mini_guarantee=False
        ).count()
        return jsonify({
            "status":        "ok",
            "id":            record.id,
            "message":       "登録しました",
            "flight_number": flight_number,
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"保存失敗: {str(e)}"}), 500
        
# ─────────────────────────────────────────
# API: 編集（当日分のみ）
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/<int:record_id>", methods=["GET"])
def api_get(record_id):
    """編集モーダル用：指定IDのレコードを1件返す"""
    record = Contract.query.get_or_404(record_id)
    return jsonify(_contract_to_dict(record))


@contract_bp.route("/api/cont/<int:record_id>", methods=["DELETE"])
def api_delete(record_id):
    """
    1レコード（1本分）の削除。当日分のみ。
    Response JSON: { "status": "ok", "message": "削除しました" }
    """
    record = Contract.query.get_or_404(record_id)

    if record.flight_date != date.today():
        return jsonify({"error": "削除できるのは当日分のみです"}), 403

    try:
        db.session.delete(record)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"削除失敗: {str(e)}"}), 500

    return jsonify({"status": "ok", "message": "削除しました"})


@contract_bp.route("/api/cont/<int:record_id>", methods=["PUT"])
def api_update(record_id):
    """1レコード（1本分）の編集。当日分のみ。mini_guarantee対応。"""
    from sqlalchemy import text as _text
    record = Contract.query.get_or_404(record_id)

    # 当日分のみ編集可
    if record.flight_date != date.today():
        return jsonify({"error": "編集できるのは当日分のみです"}), 403

    data = request.get_json(silent=True) or {}
    mini_guarantee = bool(data.get("mini_guarantee", record.mini_guarantee))

    # 場所（最低保証時は任意）
    takeoff_location = (data.get("takeoff_location") or "").strip()
    if not takeoff_location and not mini_guarantee:
        return jsonify({"error": "場所は必須です"}), 400

    # config_masterから料金取得
    def _get_config_value(item_name):
        row = db.session.execute(_text("""
            SELECT v.value FROM config_master m
            JOIN config_values v ON v.master_id = m.id
            WHERE m.category = '請負' AND m.item_name = :item_name
              AND m.is_active = true AND v.is_active = true
            ORDER BY v.sort_order, v.id LIMIT 1
        """), {"item_name": item_name}).fetchone()
        try:
            return int(float(row[0])) if row else 0
        except (ValueError, TypeError):
            return 0

    if mini_guarantee:
        daily_flight = 0
        total_amount = _get_config_value("最低保証")
    else:
        daily_flight = 1
        total_amount = _get_config_value("1本料金")

    record.flight_time       = (data.get("flight_time") or "").strip() or None
    record.takeoff_location  = takeoff_location or None
    record.used_glider       = (data.get("used_glider") or "").strip() or None
    record.size              = (data.get("size") or "").strip() or None
    record.pilot_harness     = (data.get("pilot_harness") or "").strip() or None
    record.passenger_harness = (data.get("passenger_harness") or "").strip() or None
    record.near_miss         = (data.get("near_miss") or "").strip() or None
    record.improvement       = (data.get("improvement") or "").strip() or None
    record.damaged_section   = (data.get("damaged_section") or "").strip() or None
    record.daily_flight      = daily_flight
    record.total_amount      = total_amount
    record.mini_guarantee    = mini_guarantee

    db.session.commit()
    return jsonify({"status": "ok", "message": "更新しました"})


# ─────────────────────────────────────────
# API: 当月リスト取得
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/list", methods=["GET"])
def api_list():
    today = date.today()
    records = (
        Contract.query
        .filter(
            db.extract("year",  Contract.flight_date) == today.year,
            db.extract("month", Contract.flight_date) == today.month,
        )
        .order_by(Contract.flight_date, Contract.id)
        .all()
    )
    return jsonify([_contract_to_dict(r) for r in records])



@contract_bp.route("/api/apply_cont_tan", methods=["POST"])
def apply_cont_tan():
    # 1. リクエストから主要なキーを取得
    flight_date_str = request.form.get("flight_date")
    target_uuid = request.form.get("uuid")
    
    if not flight_date_str or not target_uuid:
        return jsonify({"status": "error", "message": "日付またはUUIDが不足しています"}), 400

    try:
        # 文字列の日付を Python の date オブジェクトに変換
        flight_date = datetime.strptime(flight_date_str, "%Y-%m-%d").date()
        
        # リパック期限も日付オブジェクトに変換（空文字の場合は None）
        repack_str = request.form.get("repack_date")
        repack_date = datetime.strptime(repack_str, "%Y-%m-%d").date() if repack_str else None
    except ValueError:
        return jsonify({"status": "error", "message": "日付の形式が正しくありません"}), 400

    # 2. 既存データの確認 (uuid と flight_date の組み合わせ)
    # 保存先テーブルモデル: RepContract
    record = Contract.query.filter_by(uuid=target_uuid, flight_date=flight_date).first()

    if record:
        # 【UPDATE】既存レコードを更新
        record.name = request.form.get("name")
        record.daily_flight = int(request.form.get("daily_flight") or 0)
        record.takeoff_location = request.form.get("takeoff_location")
        record.used_glider = request.form.get("used_glider")
        record.size = request.form.get("size")
        record.pilot_harness = request.form.get("pilot_harness")
        record.repack_date = repack_date
        record.passenger_harness = request.form.get("passenger_harness")
        record.near_miss = request.form.get("near_miss")
        record.improvement = request.form.get("improvement")
        record.damaged_section = request.form.get("damaged_section")

        mode_msg = "本日の日報を更新しました。"
    else:
        # 【INSERT】新規レコードを作成
        new_record = Contract(
            flight_date=flight_date,
            uuid=target_uuid,
            name=request.form.get("name"),
            daily_flight=int(request.form.get("daily_flight") or 0),
            takeoff_location=request.form.get("takeoff_location"),
            used_glider=request.form.get("used_glider"),
            size=request.form.get("size"),
            pilot_harness=request.form.get("pilot_harness"),
            repack_date=repack_date,
            passenger_harness=request.form.get("passenger_harness"),
            near_miss=request.form.get("near_miss"),
            improvement=request.form.get("improvement"),
            damaged_section=request.form.get("damaged_section")
        )
        db.session.add(new_record)
        mode_msg = "日報を登録完了しました。"

    # 3. データベースへ反映
    try:
        db.session.commit()
        return jsonify({"status": "success", "message": mode_msg})
    except Exception as e:
        db.session.rollback()
        # 重複エラー等の詳細を返す
        return jsonify({"status": "error", "message": f"保存に失敗しました: {str(e)}"}), 500


# ═══════════════════════════════════════════════════════════════════
# 請負管理ページ用 API
# ═══════════════════════════════════════════════════════════════════

def _get_year_month(request) -> tuple[int, int]:
    """クエリパラメータから year / month を取得（デフォルト: 当月）"""
    today = date.today()
    year  = int(request.args.get("year",  today.year))
    month = int(request.args.get("month", today.month))
    return year, month


def _contract_members():
    """contract=True の Member 一覧を返す"""
    return (
        Member.query
        .filter(Member.contract == True)
        .order_by(Member.full_name)
        .all()
    )


# ─────────────────────────────────────────
# API: フライト本数・合計金額サマリー（リスト①上段）
# GET /api/cont_info/summary?year=YYYY&month=MM
# ─────────────────────────────────────────

@contract_bp.route("/api/cont_info/summary")
def cont_info_summary():
    """
    contract=True の全メンバーについて当月の
    daily_flight 総数・合計金額を返す。
    """
    year, month = _get_year_month(request)
    members = _contract_members()

    # 当月の集計をまとめて取得（uuid をキーに）
    agg = (
        db.session.query(
            Contract.uuid,
            func.coalesce(func.sum(Contract.daily_flight), 0).label("total_flights"),
            func.coalesce(func.sum(Contract.total_amount),  0).label("total_amount"),
        )
        .filter(
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
        )
        .group_by(Contract.uuid)
        .all()
    )
    agg_map = {str(row.uuid).lower(): row for row in agg}

    result = []
    for m in members:
        uuid_str = str(m.uuid).lower()
        row = agg_map.get(uuid_str)
        result.append({
            "uuid":          uuid_str,
            "name":          m.full_name,
            "total_flights": int(row.total_flights) if row else 0,
            "total_amount":  int(row.total_amount)  if row else 0,
        })

    return jsonify({"year": year, "month": month, "data": result})


# ─────────────────────────────────────────
# API: フライト状況（フライト日数・本数・合計金額）（リスト①下段）
# GET /api/cont_info/flight_days?year=YYYY&month=MM
# ─────────────────────────────────────────

@contract_bp.route("/api/cont_info/flight_days")
def cont_info_flight_days():
    """
    contract=True の全メンバーについて当月の
    フライト日数・フライト本数・施設料控除後合計金額を返す。
    """
    from sqlalchemy import text as _text

    year, month = _get_year_month(request)
    members = _contract_members()

    # 施設料を config_master から取得
    def _get_facility_fee():
        row = db.session.execute(_text("""
            SELECT v.value FROM config_master m
            JOIN config_values v ON v.master_id = m.id
            WHERE m.category = '請負' AND m.item_name = '施設料'
              AND m.is_active = true AND v.is_active = true
            ORDER BY v.sort_order, v.id LIMIT 1
        """)).fetchone()
        try:
            return int(float(row[0])) if row else 0
        except (ValueError, TypeError):
            return 0

    facility_fee = _get_facility_fee()

    # 日数と合計を同時に集計
    agg = (
        db.session.query(
            Contract.uuid,
            func.count(func.distinct(Contract.flight_date)).label("flight_days"),
            func.coalesce(func.sum(Contract.daily_flight), 0).label("total_flights"),
            func.coalesce(func.sum(Contract.total_amount),  0).label("total_amount_raw"),
            func.coalesce(
                func.sum(db.case((Contract.mini_guarantee == True, 1), else_=0)), 0
            ).label("mini_guarantee_days"),
        )
        .filter(
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
        )
        .group_by(Contract.uuid)
        .all()
    )
    agg_map = {str(row.uuid).lower(): row for row in agg}

    # 施設料控除は日別に計算する必要があるため、
    # 個人ごとに日別フライト本数を取得して控除額を算出する
    # 日別集計（uuid + flight_date ごとの通常フライト本数）
    day_agg = (
        db.session.query(
            Contract.uuid,
            Contract.flight_date,
            func.coalesce(func.sum(Contract.daily_flight), 0).label("day_flights"),
        )
        .filter(
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
            Contract.mini_guarantee == False,
        )
        .group_by(Contract.uuid, Contract.flight_date)
        .all()
    )

    # uuid別に施設料控除額を合算
    deduction_map: dict[str, int] = {}
    for row in day_agg:
        uuid_str = str(row.uuid).lower()
        n = int(row.day_flights)
        if n >= 4:
            deduction = facility_fee * 2
        elif n >= 2:
            deduction = facility_fee
        else:
            deduction = 0
        deduction_map[uuid_str] = deduction_map.get(uuid_str, 0) + deduction

    result = []
    for m in members:
        uuid_str = str(m.uuid).lower()
        row = agg_map.get(uuid_str)
        total_raw  = int(row.total_amount_raw) if row else 0
        deduction  = deduction_map.get(uuid_str, 0)
        result.append({
            "uuid":               uuid_str,
            "name":               m.full_name,
            "flight_days":        int(row.flight_days)        if row else 0,
            "total_flights":      int(row.total_flights)      if row else 0,
            "total_amount":       total_raw - deduction,
            "mini_guarantee_days": int(row.mini_guarantee_days) if row else 0,
            "facility_fee":       facility_fee,
        })

    return jsonify({"year": year, "month": month, "data": result, "facility_fee": facility_fee})


# ─────────────────────────────────────────
# API: 個人別 日別フライト詳細（モーダル用）
# GET /api/cont_info/detail/<member_uuid>?year=YYYY&month=MM
# ─────────────────────────────────────────

@contract_bp.route("/api/cont_info/detail/<string:member_uuid>")
def cont_info_detail(member_uuid: str):
    """
    指定した uuid のメンバーについて
    当月の日別フライト本数・施設料控除後金額・最低保証・備考を返す。
    1本=1レコード方式のため、同じ日付のレコードをグループ化して返す。
    - flight_times    : その日の飛行時刻リスト（None は除外）
    - daily_flight    : その日の合計本数（mini_guarantee=False のレコード数）
    - total_amount    : 施設料控除後の合計金額
    - facility_fee    : 適用された施設料控除額（表示用）
    - mini_guarantee  : その日に最低保証レコードが存在するか
    - notes           : near_miss / improvement / damaged_section を結合
    """
    from sqlalchemy import text as _text

    year, month = _get_year_month(request)
    member_uuid = member_uuid.lower()   # UUID 大文字/小文字を統一

    # 施設料を config_master から取得
    fee_row = db.session.execute(_text("""
        SELECT v.value FROM config_master m
        JOIN config_values v ON v.master_id = m.id
        WHERE m.category = '請負' AND m.item_name = '施設料'
          AND m.is_active = true AND v.is_active = true
        ORDER BY v.sort_order, v.id LIMIT 1
    """)).fetchone()
    try:
        facility_fee = int(float(fee_row[0])) if fee_row else 0
    except (ValueError, TypeError):
        facility_fee = 0

    records = (
        Contract.query
        .filter(
            Contract.uuid.cast(db.String) == member_uuid,
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
        )
        .order_by(Contract.flight_date, Contract.flight_time, Contract.id)
        .all()
    )

    # 名前取得（レコードがない場合は Member テーブルから）
    if records:
        display_name = records[0].name
    else:
        member = Member.query.filter(
            Member.uuid.cast(db.String) == member_uuid
        ).first()
        display_name = member.full_name if member else member_uuid

    # 日付ごとにグループ化
    from collections import OrderedDict
    grouped = OrderedDict()
    for r in records:
        key = r.flight_date.isoformat() if r.flight_date else "unknown"
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(r)

    data = []
    for flight_date_str, day_records in grouped.items():
        # 通常フライト本数（mini_guarantee=False のレコードの daily_flight 合計）
        normal_flights = sum(int(r.daily_flight or 0) for r in day_records if not r.mini_guarantee)

        # 飛行時刻リスト（None・空文字を除外、重複も除外）
        flight_times = []
        seen_times = set()
        for r in day_records:
            t = (r.flight_time or "").strip()
            if t and t not in seen_times:
                flight_times.append(t)
                seen_times.add(t)
        flight_times.sort()

        # 合計金額（各レコードの total_amount を合算）
        day_total_amount_raw = sum(int(r.total_amount or 0) for r in day_records)

        # 施設料控除（通常フライト本数に基づく）
        if normal_flights >= 4:
            day_deduction = facility_fee * 2
        elif normal_flights >= 2:
            day_deduction = facility_fee
        else:
            day_deduction = 0

        day_total_amount = day_total_amount_raw - day_deduction

        # 最低保証：その日に mini_guarantee=True のレコードが1件以上あるか
        day_mini_guarantee = any(r.mini_guarantee for r in day_records)

        # 備考を全レコードから収集（重複除外）
        notes_set = []
        seen_notes = set()
        for r in day_records:
            parts = [
                f"ヒヤリ:{r.near_miss}"       if r.near_miss       else "",
                f"改善:{r.improvement}"        if r.improvement       else "",
                f"破損:{r.damaged_section}"    if r.damaged_section   else "",
            ]
            note = " / ".join([p for p in parts if p])
            if note and note not in seen_notes:
                notes_set.append(note)
                seen_notes.add(note)
        notes = "　".join(notes_set)

        data.append({
            "flight_date":      flight_date_str,
            "daily_flight":     normal_flights,
            "flight_times":     flight_times,
            "total_amount":     day_total_amount,
            "facility_fee":     day_deduction,
            "mini_guarantee":   day_mini_guarantee,
            "notes":            notes,
        })

    return jsonify({
        "uuid":         member_uuid,
        "name":         display_name,
        "year":         year,
        "month":        month,
        "facility_fee": facility_fee,
        "data":         data,
    })


# ─────────────────────────────────────────
# ページルート: 請負管理
# ─────────────────────────────────────────

@contract_bp.route("/apply_cont_info")
def contract_info_page():
    return render_template("請負管理.html")


# ─────────────────────────────────────────
# API: 引継ぎ報告事項 — 件数サマリー
# GET /api/cont_info/handover?year=YYYY&month=MM
# ─────────────────────────────────────────

_HANDOVER_FIELDS = {
    "near_miss":       "ヒヤリハット",
    "improvement":     "営業改善点",
    "damaged_section": "機材破損状況",
}


@contract_bp.route("/api/cont_info/handover")
def cont_info_handover():
    """
    当月の引継ぎ報告事項（ヒヤリハット / 営業改善点 / 機材破損状況）の
    件数を返す。
    """
    year, month = _get_year_month(request)

    base_q = Contract.query.filter(
        db.extract("year",  Contract.flight_date) == year,
        db.extract("month", Contract.flight_date) == month,
    )

    result = []
    for field, label in _HANDOVER_FIELDS.items():
        count = base_q.filter(
            getattr(Contract, field) != None,
            getattr(Contract, field) != "",
        ).count()
        result.append({"category": field, "label": label, "count": count})

    return jsonify({"year": year, "month": month, "data": result})


# ─────────────────────────────────────────
# API: 引継ぎ報告事項 — カテゴリ別詳細
# GET /api/cont_info/handover/detail?year=YYYY&month=MM&category=near_miss
# ─────────────────────────────────────────

@contract_bp.route("/api/cont_info/handover/detail")
def cont_info_handover_detail():
    """
    指定カテゴリの当月レコード（内容・記入者・記入日）を返す。
    category: near_miss | improvement | damaged_section
    """
    year, month = _get_year_month(request)
    category = request.args.get("category", "")

    if category not in _HANDOVER_FIELDS:
        return jsonify({"error": "不正なカテゴリです"}), 400

    records = (
        Contract.query
        .filter(
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
            getattr(Contract, category) != None,
            getattr(Contract, category) != "",
        )
        .order_by(Contract.flight_date, Contract.id)
        .all()
    )

    data = [
        {
            "date":    r.flight_date.isoformat() if r.flight_date else None,
            "name":    r.name,
            "content": getattr(r, category) or "",
        }
        for r in records
    ]

    return jsonify({
        "year":     year,
        "month":    month,
        "category": category,
        "label":    _HANDOVER_FIELDS[category],
        "data":     data,
    })

# ─────────────────────────────────────────
# API: 個人別 月次日報一覧（統合ページ用）
# GET /api/cont/my_reports?uuid=...&year=YYYY&month=MM
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/my_reports")
def api_my_reports():
    """
    指定会員の月別日報一覧を返す。
    1本=1レコードなので、日付ごとにグループ化して返す。

    Response JSON:
    {
      "year": 2026, "month": 3,
      "days": [
        {
          "flight_date": "2026-03-15",
          "count": 3,                    # その日の本数（レコード件数）
          "locations": ["FUJIパラ"],     # ユニークな場所リスト
          "has_handover": true,          # 引継ぎ報告有無
          "records": [ { ...各フライト詳細... }, ... ]
        }, ...
      ]
    }
    """
    today = date.today()
    uuid_val = (request.args.get("uuid") or "").strip().lower()
    year  = int(request.args.get("year",  today.year))
    month = int(request.args.get("month", today.month))

    if not uuid_val:
        return jsonify({"error": "UUIDが必要です"}), 400

    records = (
        Contract.query
        .filter(
            Contract.uuid.cast(db.String) == uuid_val,
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
        )
        .order_by(Contract.flight_date.desc(), Contract.flight_time.asc(), Contract.id.asc())
        .all()
    )

    # 日付ごとにグループ化
    from collections import defaultdict, OrderedDict
    day_map = OrderedDict()
    for r in records:
        ds = _fd(r.flight_date)
        if ds not in day_map:
            day_map[ds] = []
        day_map[ds].append(r)

    days = []
    for ds, recs in day_map.items():
        has_handover = any(
            (r.near_miss or "") or (r.improvement or "") or (r.damaged_section or "")
            for r in recs
        )
        locs = list(dict.fromkeys(
            r.takeoff_location for r in recs if r.takeoff_location
        ))
        # 本数は daily_flight の合計（最低保証レコードは0なので加算されない）
        flight_count = sum(int(r.daily_flight or 0) for r in recs)
        # 当日に最低保証レコードが1件でもあるか
        has_mini_guarantee = any(r.mini_guarantee for r in recs)
        days.append({
            "flight_date":       ds,
            "count":             flight_count,
            "has_mini_guarantee": has_mini_guarantee,
            "locations":         locs,
            "has_handover":      has_handover,
            "records":           [_contract_to_dict(r) for r in recs],
        })

    return jsonify({
        "year":  year,
        "month": month,
        "days":  days,
    })

