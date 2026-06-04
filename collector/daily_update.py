"""
증분 수집 - 매일 장 마감 후 실행 (스케줄러용)
- KRX : 오늘 날짜 전종목 OHLCV
- US  : 오늘 날짜 전종목 OHLCV (NASDAQ + NYSE)
- 로컬 SQLite 없이 Turso에 직접 upsert
- 중복 실행 방지: Turso daily_log 테이블로 완료 여부 영속화
  → 프로세스 재시작 후에도 이미 완료된 청크 skip (write 한도 절약)
"""

import logging
from datetime import datetime, timedelta

from collectors.krx_collector import fetch_ohlcv, _fetch_ticker_name_map, MARKETS
from collectors.us_collector import _download_chunk, _parse_chunk
from collectors.nasdaq_tickers import fetch_nasdaq_tickers
from collectors.nyse_tickers import fetch_nyse_tickers
from db.turso_migrate import get_turso_conn, CHUNK_SIZE, init_turso
from utils.helpers import random_delay, Progress

logger = logging.getLogger(__name__)


def _init_daily_log(turso):
    """daily_log 테이블 생성 (없으면). 완료된 마켓/청크를 영속적으로 기록."""
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


def _upsert_prices(turso, rows: list[tuple], market: str, label: str):
    """주가 데이터 Turso upsert. executemany로 청크 단위 처리."""
    if not rows:
        return
    for i in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[i : i + CHUNK_SIZE]
        turso.executemany(
            "INSERT OR REPLACE INTO stock_prices "
            "(ticker, market, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            chunk
        )
        turso.commit()
    logger.info(f"Turso upsert 완료: {len(rows)}개 [{market} {label}]")


def _upsert_stocks(turso, rows: list[tuple]):
    """종목 마스터 Turso upsert. executemany로 일괄 처리."""
    if not rows:
        return
    turso.executemany(
        "INSERT OR REPLACE INTO stocks (ticker, name, market) VALUES (?, ?, ?)",
        rows
    )
    turso.commit()


def run_daily():
    today = datetime.today()

    krx_date      = today.strftime("%Y%m%d")
    yf_date_start = (today - timedelta(days=2)).strftime("%Y-%m-%d")
    yf_date_end   = today.strftime("%Y-%m-%d")

    turso = get_turso_conn()
    try:
        init_turso(turso)
        _init_daily_log(turso)

        # ── KRX 증분 ──────────────────────────────
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

            df = df.rename(columns={
                "시가": "open", "고가": "high", "저가": "low",
                "종가": "close", "거래량": "volume"
            })
            missing = [c for c in ["open", "high", "low", "close", "volume"] if c not in df.columns]
            if missing:
                logger.warning(f"[컬럼 누락] {market} {krx_date} → {missing}, 실제: {df.columns.tolist()}")
                krx_prog.fail_step("컬럼 누락")
                continue

            df.index.name = "ticker"
            df = df[["open", "high", "low", "close", "volume"]].copy()
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

        # ── 미국 증분 ──────────────────────────────
        from config.settings import YF_CHUNK_SIZE

        us_markets = {
            "NASDAQ": fetch_nasdaq_tickers(),
            "NYSE":   fetch_nyse_tickers(),
        }

        for market, ticker_list in us_markets.items():
            if not ticker_list:
                logger.error(f"[run_daily] {market} 종목 리스트 취득 실패 → 건너뜀")
                continue

            _upsert_stocks(turso, [(sym, name, market) for sym, name in ticker_list])
            symbols = [t[0] for t in ticker_list]
            chunks  = list(range(0, len(symbols), YF_CHUNK_SIZE))

            us_prog = Progress(total=len(chunks), label=f"{market} 증분수집")
            us_prog.start()

            for idx, i in enumerate(chunks):
                chunk       = symbols[i : i + YF_CHUNK_SIZE]
                chunk_label = f"DAILY_{market}_chunk_{idx+1}_{yf_date_start}"

                us_prog.step(f"청크 {idx+1}/{len(chunks)}")

                if _is_done(turso, market, chunk_label):
                    logger.info(f"[skip] {chunk_label} 이미 완료")
                    us_prog.skip_step()
                    continue

                df = _download_chunk(chunk, yf_date_start, yf_date_end)
                random_delay()

                if df is None or df.empty:
                    logger.warning(f"[empty] {market} 청크 {idx+1}")
                    us_prog.fail_step("빈 데이터")
                    continue

                rows = _parse_chunk(df, chunk, market)
                _upsert_prices(turso, rows, market, yf_date_start)
                _mark_done(turso, market, chunk_label)
                logger.info(f"[done] {market} 청크 {idx+1} | {len(rows)}개")
                us_prog.done_step(saved=len(rows))

            us_prog.finish()

        logger.info("증분 수집 완료")

    finally:
        turso.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_daily()
