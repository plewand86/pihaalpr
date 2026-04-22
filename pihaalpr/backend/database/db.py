import os
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine, Session

_engine = None

_MIGRATIONS = [
    "ALTER TABLE camera ADD COLUMN auto_capture BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE camera ADD COLUMN capture_interval INTEGER NOT NULL DEFAULT 30",
    "ALTER TABLE camera ADD COLUMN rtsp_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE camera ADD COLUMN rtsp_auto_start BOOLEAN NOT NULL DEFAULT 1",
    "ALTER TABLE camera ADD COLUMN rtsp_use_snapshot BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE camera ADD COLUMN motion_threshold INTEGER NOT NULL DEFAULT 10",
    "ALTER TABLE detection ADD COLUMN image_data BLOB",
    "ALTER TABLE whitelist ADD COLUMN dummy INTEGER",
]


def _run_migrations(engine) -> None:
    with engine.connect() as conn:
        for sql in _MIGRATIONS:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass


def init_db(database_url: str) -> None:
    global _engine
    db_path = database_url.replace("sqlite:///", "")
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    _engine = create_engine(database_url, connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(_engine)
    _run_migrations(_engine)


def get_session() -> Session:
    return Session(_engine, expire_on_commit=False)
