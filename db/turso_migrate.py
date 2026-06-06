"""
로컬 SQLite → Turso 마이그레이션
- 로컬 수집이 완전히 끝난 후 실행 (python main.py --migrate)
- 청크 단위로 나눠서 INSERT OR REPLACE (upsert — 재실행 시 최신값 반영)
- Turso free tier: 월 1,000만 row write 제한 주의
"""

import logging
import sqlite3
import libsql

from config.settings import LOCAL_DB_PATH, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
from utils.helpers import Progress

logger = logging.getLogger(__name__)

CHUNK_SIZE = 500   # Turso는 네트워크 round-trip 있으므로 적당히


def get_turso_conn():
    if not TURSO_DATABASE_URL or not TURSO_AUTH_TOKEN:
        raise ValueError("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 환경변수 확인")
    return libsql.connect(
        database   = TURSO_DATABASE_URL,
        auth_token = TURSO_AUTH_TOKEN,
    )


def init_turso(turso):
    """Turso에 테이블 없으면 생성"""
    turso.execute("""
        CREATE TABLE IF NOT EXISTS stocks (
            ticker  TEXT NOT NULL,
            name    TEXT,
            market  TEXT NOT NULL,
            PRIMARY KEY (ticker, market)
        )
    """)
    turso.execute("""
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
    turso.execute("CREATE INDEX IF NOT EXISTS idx_prices_ticker_date ON stock_prices(ticker, date)")
    turso.execute("CREATE INDEX IF NOT EXISTS idx_prices_market_date ON stock_prices(market, date)")
    turso.execute("CREATE INDEX IF NOT EXISTS idx_stocks_name ON stocks(name)")
    turso.commit()
    logger.info("Turso 테이블 준비 완료")


def migrate():
    local = sqlite3.connect(LOCAL_DB_PATH)
    turso = get_turso_conn()
    try:
        init_turso(turso)

        # ── stocks 마이그레이션 ────────────────────────
        stock_rows = local.execute("SELECT ticker, name, market FROM stocks").fetchall()
        logger.info(f"stocks 마이그레이션: {len(stock_rows)}개")

        if not stock_rows:
            logger.warning("stocks가 비어있음 → stocks 마이그레이션 건너뜀")
        else:
            stock_chunks = [stock_rows[i : i + CHUNK_SIZE] for i in range(0, len(stock_rows), CHUNK_SIZE)]
            prog_s = Progress(total=len(stock_chunks), label="Turso stocks 마이그레이션")
            prog_s.start()
            for chunk in stock_chunks:
                prog_s.step(f"{len(chunk)}개")
                turso.executemany(
                    "INSERT OR REPLACE INTO stocks (ticker, name, market) VALUES (?, ?, ?)",
                    chunk
                )
                turso.commit()
                prog_s.done_step(saved=len(chunk))
            prog_s.finish()

        # ── stock_prices 마이그레이션 ──────────────────
        total = local.execute("SELECT COUNT(*) FROM stock_prices").fetchone()[0]
        logger.info(f"stock_prices 마이그레이션: {total}개")

        if total == 0:
            logger.warning("stock_prices가 비어있음 → prices 마이그레이션 건너뜀")
        else:
            price_chunk_offsets = list(range(0, total, CHUNK_SIZE))
            prog_p = Progress(total=len(price_chunk_offsets), label="Turso stock_prices 마이그레이션")
            prog_p.start()
            for i in price_chunk_offsets:
                prog_p.step(f"{min(i+CHUNK_SIZE, total)}/{total}")
                rows = local.execute(
                    "SELECT ticker, market, date, open, high, low, close, volume "
                    "FROM stock_prices LIMIT ? OFFSET ?",
                    (CHUNK_SIZE, i)
                ).fetchall()
                if not rows:
                    prog_p.skip_step()
                    break
                turso.executemany(
                    "INSERT OR REPLACE INTO stock_prices "
                    "(ticker, market, date, open, high, low, close, volume) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    rows
                )
                turso.commit()
                prog_p.done_step(saved=len(rows))
            prog_p.finish()

        logger.info("Turso 마이그레이션 완료")

    finally:
        local.close()
        turso.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    migrate()
