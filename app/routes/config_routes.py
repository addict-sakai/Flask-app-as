"""
app/routes/config_routes.py
設定管理画面 ルート & REST API
Blueprint名: config  /  URLプレフィックス: /config
DB: SQLAlchemy (db.session.execute) + text()
"""

from flask import Blueprint, request, jsonify, render_template
from sqlalchemy import text
from app.db import db

config_bp = Blueprint("config", __name__, url_prefix="/config")


# ══════════════════════════════════════════════════════════
# ページ
# ══════════════════════════════════════════════════════════
@config_bp.route("/")
def config_admin():
    return render_template("設定管理画面.html")


# ══════════════════════════════════════════════════════════
# カテゴリ（大項目）一覧
# ══════════════════════════════════════════════════════════
@config_bp.route("/api/categories", methods=["GET"])
def get_categories():
    rows = db.session.execute(text("""
        SELECT category, MIN(id) AS min_id
        FROM config_master
        GROUP BY category
        ORDER BY min_id
    """)).fetchall()
    return jsonify([r[0] for r in rows])


# ══════════════════════════════════════════════════════════
# config_master CRUD
# ══════════════════════════════════════════════════════════
@config_bp.route("/api/masters", methods=["GET"])
def get_masters():
    category = request.args.get("category")
    if category:
        rows = db.session.execute(text("""
            SELECT id, category, item_name, value_type, unit,
                   description, sort_order, is_active,
                   created_at, updated_at
            FROM config_master
            WHERE category = :category
            ORDER BY sort_order, id
        """), {"category": category}).fetchall()
    else:
        rows = db.session.execute(text("""
            SELECT id, category, item_name, value_type, unit,
                   description, sort_order, is_active,
                   created_at, updated_at
            FROM config_master
            ORDER BY category, sort_order, id
        """)).fetchall()
    return jsonify([dict(r._mapping) for r in rows])


@config_bp.route("/api/masters/<int:master_id>", methods=["GET"])
def get_master(master_id):
    master = db.session.execute(text("""
        SELECT id, category, item_name, value_type, unit,
               description, sort_order, is_active,
               created_at, updated_at
        FROM config_master WHERE id = :id
    """), {"id": master_id}).fetchone()

    if not master:
        return jsonify({"error": "Not found"}), 404

    values = db.session.execute(text("""
        SELECT id, value, label, sort_order, is_active
        FROM config_values
        WHERE master_id = :master_id
        ORDER BY sort_order, id
    """), {"master_id": master_id}).fetchall()

    result = dict(master._mapping)
    result["values"] = [dict(v._mapping) for v in values]
    return jsonify(result)


@config_bp.route("/api/masters", methods=["POST"])
def create_master():
    data = request.json
    for field in ["category", "item_name", "value_type"]:
        if not data.get(field):
            return jsonify({"error": f"{field} は必須です"}), 400

    row = db.session.execute(text("""
        INSERT INTO config_master
            (category, item_name, value_type, unit, description, sort_order, is_active)
        VALUES
            (:category, :item_name, :value_type, :unit, :description, :sort_order, :is_active)
        RETURNING id
    """), {
        "category":    data["category"],
        "item_name":   data["item_name"],
        "value_type":  data["value_type"],
        "unit":        data.get("unit", "円" if data["value_type"] == "amount" else None),
        "description": data.get("description"),
        "sort_order":  data.get("sort_order", 0),
        "is_active":   data.get("is_active", True),
    }).fetchone()
    db.session.commit()
    return jsonify({"id": row[0], "message": "作成しました"}), 201


@config_bp.route("/api/masters/<int:master_id>", methods=["PUT"])
def update_master(master_id):
    data = request.json
    db.session.execute(text("""
        UPDATE config_master
        SET category    = :category,
            item_name   = :item_name,
            value_type  = :value_type,
            unit        = :unit,
            description = :description,
            sort_order  = :sort_order,
            is_active   = :is_active
        WHERE id = :id
    """), {
        "category":    data["category"],
        "item_name":   data["item_name"],
        "value_type":  data["value_type"],
        "unit":        data.get("unit"),
        "description": data.get("description"),
        "sort_order":  data.get("sort_order", 0),
        "is_active":   data.get("is_active", True),
        "id":          master_id,
    })
    db.session.commit()
    return jsonify({"message": "更新しました"})


@config_bp.route("/api/masters/<int:master_id>", methods=["DELETE"])
def delete_master(master_id):
    db.session.execute(text(
        "DELETE FROM config_master WHERE id = :id"
    ), {"id": master_id})
    db.session.commit()
    return jsonify({"message": "削除しました"})


# ══════════════════════════════════════════════════════════
# config_values CRUD
# ══════════════════════════════════════════════════════════
@config_bp.route("/api/values/<int:master_id>", methods=["GET"])
def get_values(master_id):
    rows = db.session.execute(text("""
        SELECT id, master_id, value, label, sort_order, is_active
        FROM config_values
        WHERE master_id = :master_id
        ORDER BY sort_order, id
    """), {"master_id": master_id}).fetchall()
    return jsonify([dict(r._mapping) for r in rows])


@config_bp.route("/api/values", methods=["POST"])
def create_value():
    data = request.json
    if not data.get("master_id") or data.get("value") is None:
        return jsonify({"error": "master_id と value は必須です"}), 400

    row = db.session.execute(text("""
        INSERT INTO config_values (master_id, value, label, sort_order, is_active)
        VALUES (:master_id, :value, :label, :sort_order, :is_active)
        RETURNING id
    """), {
        "master_id":  data["master_id"],
        "value":      data["value"],
        "label":      data.get("label"),
        "sort_order": data.get("sort_order", 0),
        "is_active":  data.get("is_active", True),
    }).fetchone()
    db.session.commit()
    return jsonify({"id": row[0], "message": "追加しました"}), 201


@config_bp.route("/api/values/<int:value_id>", methods=["PUT"])
def update_value(value_id):
    data = request.json
    db.session.execute(text("""
        UPDATE config_values
        SET value      = :value,
            label      = :label,
            sort_order = :sort_order,
            is_active  = :is_active
        WHERE id = :id
    """), {
        "value":      data["value"],
        "label":      data.get("label"),
        "sort_order": data.get("sort_order", 0),
        "is_active":  data.get("is_active", True),
        "id":         value_id,
    })
    db.session.commit()
    return jsonify({"message": "更新しました"})


@config_bp.route("/api/values/<int:value_id>", methods=["DELETE"])
def delete_value(value_id):
    db.session.execute(text(
        "DELETE FROM config_values WHERE id = :id"
    ), {"id": value_id})
    db.session.commit()
    return jsonify({"message": "削除しました"})
