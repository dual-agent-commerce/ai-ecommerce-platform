import os

from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

# 專題根目錄
BASE_DIR = Path(__file__).resolve().parent.parent

# 載入 .env
load_dotenv(BASE_DIR / ".env")

# 建立 PostgreSQL 連線設定
DATABASE_URL = URL.create(
    drivername="postgresql+psycopg",
    username=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD"),
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "5432")),
    database=os.getenv("DB_NAME", "ecommerce_db"),
)

# SQLAlchemy Engine
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True
)
