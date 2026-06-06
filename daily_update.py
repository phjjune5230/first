"""
증분 수집 - 매일 장 마감 후 실행 (스케줄러용)
- KRX : 오늘 날짜 전종목 OHLCV
- US  : Polygon Grouped Daily → 1회 API 호출로 전종목 수집
- 중복 실행 방지: Turso daily_log 테이블로 완료 여부 영속화
"""

import logging
from datetime import datetime

from db.turso_migrate import get_turso_conn, init_turso
from utils.helpers import random_delay, Progress

logger = logging.getLogger(__name__)


def _init_daily_log(turso):
    turso.execute("""
        CREATE TABLE IF NOT EXISTS daily_log (
            market TEXT NOT NULL,
            label  TEXT NOT NULL,
            PRIMARY KEY (market, label)
        )
    """)
    turso.commit()


def _is_done(turso, market: str, label: str) -> bool:
    row = turso.execute(
        "SELECT 1 FROM daily_log WHERE market=? AND label=?", (market, label)
    ).fetchone()
    return row is not None


def _mark_done(turso, market: str, label: str):
    turso.execute(
        "INSERT OR IGNORE INTO daily_log (market, label) VALUES (?, ?)", (market, label)
    )
    turso.commit()


def _multi_row_insert(turso, sql_prefix: str, rows: list[tuple], chunk_size: int = 500):
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i : i + chunk_size]
        placeholders = ",".join(["(" + ",".join(["?"] * len(chunk[0])) + ")"] * len(chunk))
        turso.execute(f"{sql_prefix} {placeholders}", [v for row in chunk for v in row])
        turso.commit()


def _upsert_prices(turso, rows: list[tuple], market: str, label: str):
    if not rows:
        return
    _multi_row_insert(
        turso,
        "INSERT OR REPLACE INTO stock_prices "
        "(ticker, market, date, open, high, low, close, volume) VALUES",
        rows
    )
    logger.info(f"Turso upsert 완료: {len(rows)}개 [{market} {label}]")


def _upsert_stocks(turso, rows: list[tuple]):
    if not rows:
        return
    _multi_row_insert(
        turso,
        "INSERT OR REPLACE INTO stocks (ticker, name, market) VALUES",
        rows
    )


def run_daily():
    today     = datetime.today()
    krx_date  = today.strftime("%Y%m%d")
    poly_date = today.strftime("%Y-%m-%d")

    turso = get_turso_conn()
    try:
        init_turso(turso)
        _init_daily_log(turso)

        # ── KRX 증분 ──────────────────────────────
        from collectors.krx_collector import fetch_ohlcv, _fetch_ticker_name_map, MARKETS, _COL_MAP, _REQUIRED_COLS

        krx_prog = Progress(total=len(MARKETS), label="KRX 증분수집")
        krx_prog.start()

        for market in MARKETS:
            krx_prog.step(f"{market} {krx_date}")

            if _is_done(turso, market, krx_date):
                logger.info(f"[skip] {market} {krx_date} 이미 완료")
                krx_prog.skip_step()
                continue

            df = fetch_ohlcv(krx_date, market)
            random_delay()

            if df is None or df.empty:
                logger.warning(f"[empty] {market} {krx_date}")
                krx_prog.fail_step("빈 데이터")
                continue

            ticker_map = _fetch_ticker_name_map(market, krx_date)
            random_delay()

            if ticker_map is None:
                logger.warning(f"[ticker_map 실패] {market} {krx_date} → skip")
                krx_prog.fail_step("ticker_map 실패")
                continue

            _upsert_stocks(turso, [(t, n, market) for t, n in ticker_map.items()])

            df = df.rename(columns=_COL_MAP)
            missing = [c for c in _REQUIRED_COLS if c not in df.columns]
            if missing:
                logger.warning(f"[컬럼 누락] {market} {krx_date} → {missing}")
                krx_prog.fail_step("컬럼 누락")
                continue

            df.index.name = "ticker"
            df = df[_REQUIRED_COLS].copy()
            df = df[df["volume"] > 0].dropna(subset=["close"])

            rows = [
                (str(ticker).zfill(6), market, krx_date,
                 row["open"], row["high"], row["low"], row["close"], int(row["volume"]))
                for ticker, row in df.iterrows()
            ]
            _upsert_prices(turso, rows, market, krx_date)
            _mark_done(turso, market, krx_date)
            logger.info(f"[done] {market} {krx_date} | {len(rows)}개")
            krx_prog.done_step(saved=len(rows))

        krx_prog.finish()

        # ── 미국 증분 (Polygon Grouped Daily 1회 호출) ──
        from collectors.us_collector import fetch_grouped_daily, _parse_grouped

        us_label = f"POLYGON_{poly_date}"
        us_prog  = Progress(total=1, label="US 증분수집(Polygon)")
        us_prog.start()
        us_prog.step(poly_date)

        if _is_done(turso, "US_POLYGON", us_label):
            logger.info(f"[skip] US {poly_date} 이미 완료")
            us_prog.skip_step()
        else:
            results = fetch_grouped_daily(poly_date)

            if results is None:
                logger.error(f"[error] US {poly_date} Polygon API 오류")
                us_prog.fail_step("API 오류")
            elif not results:
                logger.info(f"[empty] US {poly_date} — 휴장일 또는 데이터 없음")
                us_prog.fail_step("휴장일")
            else:
                rows = _parse_grouped(results, "US", poly_date)
                _upsert_prices(turso, rows, "US_POLYGON", poly_date)
                _mark_done(turso, "US_POLYGON", us_label)
                logger.info(f"[done] US {poly_date} | {len(rows)}개")
                us_prog.done_step(saved=len(rows))

        us_prog.finish()
        logger.info("증분 수집 완료")

    finally:
        turso.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_daily()
