"""
contract_routes.py  –  請負日報 Flask ルート
Mt.FUJI PARAGLIDING / FujipSystem
"""

from flask import Blueprint, render_template, request, jsonify
from ..db import db  # 相対インポートに統一
# from ..models.rep_contract import RepContract  # 保存先はこちら
from ..models.contract import Contract       # もし他で使っていれば残す
from ..models.member import Member
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
        "uuid":              c.uuid,
        "name":              c.name,
        "daily_flight":      c.daily_flight,
        "takeoff_location":  c.takeoff_location,
        "used_glider":       c.used_glider,
        "size":              c.size,
        "pilot_harness":     c.pilot_harness,
        "repack_date":       _fd(c.repack_date),
        "passenger_harness": c.passenger_harness,   # フロントは passenger_harness で統一
        "near_miss":         c.near_miss,
        "improvement":       c.improvement,
        "damaged_section":   c.damaged_section,
    }


# ─────────────────────────────────────────
# ページルート
# ─────────────────────────────────────────

@contract_bp.route("/apply_cont_tan")
def cont_tan_index():
    """請負日報ページ（当月分のリストを初期描画）"""
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
    return render_template("請負日報.html", records=records, today=today)


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

    # 会員番号で検索、なければUUID（QR）で検索
    member = Member.query.filter_by(member_number=query).first()
    if not member:
        try:
            uuidlib.UUID(query)   # UUID形式かチェック（不正な文字列を弾く）
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
# API: 登録
# ─────────────────────────────────────────

@contract_bp.route("/api/cont/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    target_uuid = data.get("uuid")
    name = (data.get("name") or "").strip()
    today = date.today()

    # フライト本数
    flight_count = int(data.get("daily_flight") or 0)

    # 金額計算
    if flight_count <= 1:
        total_amount = 6000
        mini_guarantee = True
    else:
        total_amount = 4000 * flight_count
        mini_guarantee = False

        if 2 <= flight_count <= 3:
            total_amount -= 1000
        elif flight_count >= 4:
            total_amount -= 2000
        
    if not target_uuid:
        return jsonify({"error": "UUIDが取得できません"}), 400

    # 当日かつ同じUUIDのレコードが既に存在するか確認
    record = Contract.query.filter_by(uuid=target_uuid, flight_date=today).first()

    if record:
        # 【既存データの上書き】
        record.name              = name # 名前が変わっている可能性も考慮
        record.daily_flight      = data.get("daily_flight") or 0
        record.takeoff_location  = data.get("takeoff_location") or ""
        record.used_glider       = data.get("used_glider") or ""
        record.size              = data.get("size") or ""
        record.pilot_harness     = data.get("pilot_harness") or ""
        record.passenger_harness = data.get("passenger_harness") or ""
        record.near_miss         = data.get("near_miss") or ""
        record.improvement       = data.get("improvement") or ""
        record.damaged_section   = data.get("damaged_section") or ""

        record.daily_flight = flight_count
        record.total_amount = total_amount
        record.mini_guarantee = mini_guarantee
        
        message = "本日のデータを更新しました"
    else:
        # 【新規登録】
        record = Contract(
            flight_date       = today,
            uuid              = target_uuid,
            name              = name,
        #    daily_flight      = data.get("daily_flight") or 0,
            takeoff_location  = data.get("takeoff_location") or "",
            used_glider       = data.get("used_glider") or "",
            size              = data.get("size") or "",
            pilot_harness     = data.get("pilot_harness") or "",
            repack_date       = None,
            passenger_harness = data.get("passenger_harness") or "",
            near_miss         = data.get("near_miss") or "",
            improvement       = data.get("improvement") or "",
            damaged_section   = data.get("damaged_section") or "",

            daily_flight = flight_count,
            total_amount = total_amount,
            mini_guarantee = mini_guarantee,
        )
        db.session.add(record)
        message = "登録しました"

    try:
        db.session.commit()
        return jsonify({"status": "ok", "id": record.id, "message": message}), 201
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


@contract_bp.route("/api/cont/<int:record_id>", methods=["PUT"])
def api_update(record_id):
    record = Contract.query.get_or_404(record_id)

    # 当日分のみ編集可
    if record.flight_date != date.today():
        return jsonify({"error": "編集できるのは当日分のみです"}), 403

    data = request.get_json(silent=True) or {}
    # ▼ フライト本数取得
    flight_count = int(data.get("daily_flight") or 0)

    # ▼ 金額再計算
    if flight_count <= 1:
        total_amount = 6000
        mini_guarantee = True
    else:
        total_amount = 4000 * flight_count
        mini_guarantee = False

        if 2 <= flight_count <= 3:
            total_amount -= 1000
        elif flight_count >= 4:
            total_amount -= 2000

    # ▼ 更新
    record.daily_flight      = flight_count
    record.total_amount      = total_amount
    record.mini_guarantee    = mini_guarantee
#    record.daily_flight      = data.get("daily_flight",     record.daily_flight)
    record.takeoff_location  = data.get("takeoff_location", record.takeoff_location)
    record.used_glider       = data.get("used_glider",      record.used_glider)
    record.size              = data.get("size",             record.size)
    record.pilot_harness     = data.get("pilot_harness",    record.pilot_harness)
    record.passenger_harness = data.get("passenger_harness", record.passenger_harness)
    record.near_miss         = data.get("near_miss",        record.near_miss)
    record.improvement       = data.get("improvement",      record.improvement)
    record.damaged_section   = data.get("damaged_section",  record.damaged_section)

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
    agg_map = {row.uuid: row for row in agg}

    result = []
    for m in members:
        uuid_str = str(m.uuid)
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
    フライト日数・フライト本数・合計金額を返す。
    """
    year, month = _get_year_month(request)
    members = _contract_members()

    # 日数と合計を同時に集計
    agg = (
        db.session.query(
            Contract.uuid,
            func.count(func.distinct(Contract.flight_date)).label("flight_days"),
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
    # agg_map = {row.uuid: row for row in agg}
    agg_map = {str(row.uuid): row for row in agg}

    result = []
    for m in members:
        uuid_str = str(m.uuid).lower()
        row = agg_map.get(uuid_str)
        result.append({
            "uuid":          uuid_str,
            "name":          m.full_name,
            "flight_days":   int(row.flight_days)   if row else 0,
            "total_flights": int(row.total_flights) if row else 0,
            "total_amount":  int(row.total_amount)  if row else 0,
        })

    return jsonify({"year": year, "month": month, "data": result})


# ─────────────────────────────────────────
# API: 個人別 日別フライト詳細（モーダル用）
# GET /api/cont_info/detail/<member_uuid>?year=YYYY&month=MM
# ─────────────────────────────────────────

@contract_bp.route("/api/cont_info/detail/<string:member_uuid>")
def cont_info_detail(member_uuid: str):
    """
    指定した uuid のメンバーについて
    当月の日別フライト本数・合計金額・最低保証・備考を返す。
    備考は near_miss / improvement / damaged_section を結合して返す。
    """
    year, month = _get_year_month(request)

    records = (
        Contract.query
        .filter(
            Contract.uuid == member_uuid,
            db.extract("year",  Contract.flight_date) == year,
            db.extract("month", Contract.flight_date) == month,
        )
        .order_by(Contract.flight_date)
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

    data = []
    for r in records:
        # 備考を複数フィールドから結合（空文字は除外）
        notes_parts = [
            f"ヒヤリ:{r.near_miss}"       if r.near_miss       else "",
            f"改善:{r.improvement}"        if r.improvement       else "",
            f"破損:{r.damaged_section}"    if r.damaged_section   else "",
        ]
        notes = " / ".join([p for p in notes_parts if p])

        data.append({
            "flight_date":      r.flight_date.isoformat() if r.flight_date else None,
            "daily_flight":     int(r.daily_flight) if r.daily_flight else 0,
            "total_amount":     int(r.total_amount) if r.total_amount else 0,
            "mini_guarantee":   bool(r.mini_guarantee),
            "notes":            notes,
        })

    return jsonify({
        "uuid":   member_uuid,
        "name":   display_name,
        "year":   year,
        "month":  month,
        "data":   data,
    })


# ─────────────────────────────────────────
# ページルート: 請負管理
# ─────────────────────────────────────────

@contract_bp.route("/apply_cont_info")
def contract_info_page():
    return render_template("請負管理.html")
