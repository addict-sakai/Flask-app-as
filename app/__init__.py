import os
from flask import Flask
from .db import init_db

def create_app():
    app = Flask(__name__)

    # --- 🔵 ここから修正 ---
    # 1. あなたのローカルPostgreSQL設定
    LOCAL_DB_URL = "postgresql://postgres:1234@localhost:5432/fujiparasystem"
    
    # 2. Render上の環境変数 DATABASE_URL を取得。なければローカル用を使う
    database_url = os.environ.get('DATABASE_URL', LOCAL_DB_URL)

    # 3. SQLAlchemy 1.4以降での postgres:// 互換性対応
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    # --- 🔵 ここまで修正 ---

    # --- Pooler接続対策
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
        'pool_timeout': 30,
        'pool_size': 5,
        'max_overflow': 2,
    }

# 🔵 ここを追加
#    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://fujiparasystem_user:G5ZJlhQMw7xD1Yq1uzqjoo9fu30HvKD5@dpg-d6enn2cr85hc73frbvrg-a/fujiparasystem"
    # app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://postgres:1234@localhost:5432/fujiparasystem"

    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    init_db(app)

    from .routes.member_routes import member_bp
    app.register_blueprint(member_bp)

    from .routes.experience_routes import experience_bp
    app.register_blueprint(experience_bp)

    # app/__init__.py または app.py
    from .routes.io_flight_routes import io_bp
    app.register_blueprint(io_bp)
    
    from .routes.contract_routes import contract_bp
    app.register_blueprint(contract_bp)

    from .routes.work_contract_routes import work_bp, init_scheduler
    app.register_blueprint(work_bp)
    init_scheduler(app)   # 毎月1日0時に古いデータを自動削除

    from .routes.config_routes import config_bp
    app.register_blueprint(config_bp)

    from .routes.exp_resv_routes import exp_bp
    app.register_blueprint(exp_bp)

    from .routes.exp_status_routes import exp_status_bp
    app.register_blueprint(exp_status_bp)
    
    return app
