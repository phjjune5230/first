import sqlite3
import logging
from config.settings import LOCAL_DB_PATH

logger = logging.getLogger(__name__)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(LOCAL_DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")   # 쓰기 성능 향상
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db():
    """테이블 초기화 (없으면 생성)"""
    conn = get_conn()
    cur = conn.cursor()

    # 종목 마스터
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stocks (
            ticker  TEXT NOT NULL,
            name    TEXT,
            market  TEXT NOT NULL,
            PRIMARY KEY (ticker, market)
        )
    """)

    # 일별 주가 (수정주가 + 수정거래량)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stock_prices (
            ticker  TEXT    NOT NULL,
            market  TEXT    NOT NULL,
            date    TEXT    NOT NULL,
            open    REAL,
            high    REAL,
            low     REAL,
            close   REAL,
            volume  INTEGER,
            PRIMARY KEY (ticker, market, date)
        )
    """)

    # 수집 진행 로그 (날짜·마켓 단위)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS collection_log (
            market       TEXT NOT NULL,
            date         TEXT NOT NULL,
            status       TEXT NOT NULL,  -- done / failed / skipped
            rows_saved   INTEGER DEFAULT 0,
            collected_at TEXT,
            PRIMARY KEY (market, date)
        )
    """)

    conn.commit()
    conn.close()
    logger.info("로컬 DB 초기화 완료")


# ── 진행 로그 ──────────────────────────────────────

def is_done(market: str, date: str) -> bool:
    """해당 (market, date) 이미 수집 완료 여부"""
    conn = get_conn()
    row = conn.execute(
        "SELECT status FROM collection_log WHERE market=? AND date=?",
        (market, date)
    ).fetchone()
    conn.close()
    return row is not None and row[0] == "done"


def log_status(market: str, date: str, status: str, rows_saved: int = 0):
    from datetime import datetime
    conn = get_conn()
    conn.execute("""
        INSERT OR REPLACE INTO collection_log
            (market, date, status, rows_saved, collected_at)
        VALUES (?, ?, ?, ?, ?)
    """, (market, date, status, rows_saved, datetime.now().isoformat()))
    conn.commit()
    conn.close()


# ── 종목 마스터 저장 ────────────────────────────────

def upsert_stocks(rows: list[tuple]):
    """rows: [(ticker, name, market), ...]"""
    conn = get_conn()
    conn.executemany("""
        INSERT OR REPLACE INTO stocks (ticker, name, market)
        VALUES (?, ?, ?)
    """, rows)
    conn.commit()
    conn.close()


# ── 주가 저장 ──────────────────────────────────────

def insert_prices(rows: list[tuple], batch_size: int = 2000) -> int:
    """
    rows: [(ticker, market, date, open, high, low, close, volume), ...]
    batch_size 단위로 나눠서 INSERT OR IGNORE
    반환: 실제 insert 시도한 행 수 (중복 제외 아님)
    """
    if not rows:
        return 0

    conn = get_conn()
    total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        conn.executemany("""
            INSERT OR IGNORE INTO stock_prices
                (ticker, market, date, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, chunk)
        total += len(chunk)
    conn.commit()
    conn.close()
    return total
