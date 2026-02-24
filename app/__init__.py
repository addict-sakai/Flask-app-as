from flask import Flask
from .db import init_db

def create_app():
    app = Flask(__name__)

# 🔵 ここを追加
    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://fujiparasystem_user:G5ZJlhQMw7xD1Yq1uzqjoo9fu30HvKD5@dpg-d6enn2cr85hc73frbvrg-a/fujiparasystem"
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

    return app
