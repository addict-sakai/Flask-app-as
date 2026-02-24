import os

class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv("postgresql://postgres:1234@localhost:5432/fujiparasystem")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.getenv("SECRET_KEY")
