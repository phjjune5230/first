"""
daily_update.py 로컬 테스트용 스크립트

GitHub Actions 환경변수를 직접 지정해서 로컬에서 실행합니다.

사용법:
  # KRX만 테스트 (오늘 날짜)
  python test_daily.py --market krx

  # US만 테스트 (오늘 날짜)
  python test_daily.py --market us

  # 전체 테스트 (KRX + US)
  python test_daily.py --market all

  # 특정 날짜로 테스트 (평일이어야 함)
  python test_daily.py --market krx --date 20260604

옵션:
  --market  krx | us | all  (필수)
  --date    YYYYMMDD        (생략 시 오늘)
  --force                   이미 완료된 날짜도 재수집
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta

# .env 로드
from dotenv import load_dotenv
load_dotenv()

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("test_daily.log", encoding="utf-8"),
    ]
)
logger = logging.getLogger(__name__)


def _set_env(market: str, date_str: str):
    """GitHub Actions에서 주입되는 환경변수를 로컬에서 직접 설정"""

    dt = datetime.strptime(date_str, "%Y%m%d")
    hour_utc = 8   # KRX 기본값 (07:30 UTC 스케줄 근처)

    if market == "us":
        hour_utc = 22  # US 스케줄 (22:00 UTC)

    os.environ["GITHUB_EVENT_NAME"] = "workflow_dispatch"
    os.environ["RUN_HOUR_UTC"]      = str(hour_utc)
    os.environ["RUN_MINUTE_UTC"]    = "00"

    logger.info(f"[env] GITHUB_EVENT_NAME=workflow_dispatch")
    logger.info(f"[env] RUN_HOUR_UTC={hour_utc}, RUN_MINUTE_UTC=00")


def _check_env():
    """필수 환경변수 확인"""
    missing = []
    if not os.getenv("TURSO_DATABASE_URL"):
        missing.append("TURSO_DATABASE_URL")
    if not os.getenv("TURSO_AUTH_TOKEN"):
        missing.append("TURSO_AUTH_TOKEN")
    if missing:
        logger.error(f"필수 환경변수 없음: {', '.join(missing)}")
        logger.error(".env 파일에 추가해주세요.")
        sys.exit(1)


def run_krx(date_str: str, force: bool = False):
    """KRX 증분 수집 테스트"""
    from collectors.krx_collector import fetch_ohlcv, _fetch_ticker_name_map, MARKETS
    from db.turso_migrate import get_turso_conn, init_turso
    from daily_update import _init_daily_log, _is_done, _mark_done, _upsert_prices, _upsert_stocks
    from utils.helpers import random_delay

    logger.info(f"=== KRX 테스트 시작: {date_str} ===")
    turso = get_turso_conn()
    try:
        init_turso(turso)
        _init_daily_log(turso)

        for market in MARKETS:
            label = date_str

            if not force and _is_done(turso, market, label):
                logger.info(f"[skip] {market} {date_str} 이미 완료 (--force 옵션으로 재수집 가능)")
                continue

            logger.info(f"[수집] {market} {date_str}")
            df = fetch_ohlcv(date_str, market)
            random_delay()

            if df is None or df.empty:
                logger.warning(f"[empty] {market} {date_str} — 휴장일이거나 데이터 없음")
                continue

            ticker_map = _fetch_ticker_name_map(market, date_str)
            random_delay()

            if ticker_map is None:
                logger.warning(f"[실패] {market} ticker_map 취득 실패")
                continue

            _upsert_stocks(turso, [(t, n, market) for t, n in ticker_map.items()])

            df = df.rename(columns={
                "시가": "open", "고가": "high", "저가": "low",
                "종가": "close", "거래량": "volume"
            })
            df = df[["open", "high", "low", "close", "volume"]].copy()
            df = df[df["volume"] > 0].dropna(subset=["close"])

            rows = [
                (str(ticker).zfill(6), market, date_str,
                 row["open"], row["high"], row["low"], row["close"], int(row["volume"]))
                for ticker, row in df.iterrows()
            ]
            _upsert_prices(turso, rows, market, date_str)
            if not force:
                _mark_done(turso, market, label)
            logger.info(f"[완료] {market} {date_str} | {len(rows)}개 저장")

    finally:
        turso.close()


def run_us(date_str: str, force: bool = False):
    """US 증분 수집 테스트"""
    from collectors.us_collector import _download_chunk, _parse_chunk
    from collectors.nasdaq_tickers import fetch_nasdaq_tickers
    from collectors.nyse_tickers import fetch_nyse_tickers
    from db.turso_migrate import get_turso_conn, init_turso, CHUNK_SIZE
    from daily_update import _init_daily_log, _is_done, _mark_done, _upsert_prices, _upsert_stocks
    from utils.helpers import random_delay
    from config.settings import YF_CHUNK_SIZE

    dt = datetime.strptime(date_str, "%Y%m%d")
    yf_start = (dt - timedelta(days=2)).strftime("%Y-%m-%d")
    yf_end   = dt.strftime("%Y-%m-%d")

    logger.info(f"=== US 테스트 시작: {yf_start} ~ {yf_end} ===")
    turso = get_turso_conn()
    try:
        init_turso(turso)
        _init_daily_log(turso)

        us_markets = {
            "NASDAQ": fetch_nasdaq_tickers(),
            "NYSE":   fetch_nyse_tickers(),
        }

        for market, ticker_list in us_markets.items():
            if not ticker_list:
                logger.error(f"[{market}] 종목 리스트 취득 실패")
                continue

            _upsert_stocks(turso, [(sym, name, market) for sym, name in ticker_list])
            symbols = [t[0] for t in ticker_list]
            chunks  = list(range(0, len(symbols), YF_CHUNK_SIZE))

            logger.info(f"[{market}] 총 {len(symbols)}개 종목, {len(chunks)}개 청크")

            for idx, i in enumerate(chunks):
                chunk       = symbols[i : i + YF_CHUNK_SIZE]
                chunk_label = f"DAILY_{market}_chunk_{idx+1}_{yf_start}"

                if not force and _is_done(turso, market, chunk_label):
                    logger.info(f"[skip] {chunk_label}")
                    continue

                logger.info(f"[{market}] 청크 {idx+1}/{len(chunks)} 수집 중...")
                df = _download_chunk(chunk, yf_start, yf_end)
                random_delay()

                if df is None or df.empty:
                    logger.warning(f"[empty] {market} 청크 {idx+1}")
                    continue

                rows = _parse_chunk(df, chunk, market)
                _upsert_prices(turso, rows, market, yf_start)
                if not force:
                    _mark_done(turso, market, chunk_label)
                logger.info(f"[완료] {market} 청크 {idx+1} | {len(rows)}개")

    finally:
        turso.close()


def main():
    parser = argparse.ArgumentParser(description="daily_update 로컬 테스트")
    parser.add_argument("--market", choices=["krx", "us", "all"], required=True,
                        help="수집 대상 (krx | us | all)")
    parser.add_argument("--date",   default=datetime.today().strftime("%Y%m%d"),
                        help="수집 날짜 YYYYMMDD (기본: 오늘)")
    parser.add_argument("--force",  action="store_true",
                        help="이미 완료된 날짜도 재수집")
    args = parser.parse_args()

    _check_env()
    _set_env(args.market, args.date)

    logger.info(f"테스트 날짜: {args.date}, 대상: {args.market}, force: {args.force}")

    if args.market in ("krx", "all"):
        run_krx(args.date, args.force)

    if args.market in ("us", "all"):
        run_us(args.date, args.force)

    logger.info("=== 테스트 완료 ===")


if __name__ == "__main__":
    main()
