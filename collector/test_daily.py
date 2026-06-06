"""
daily_update.py 로컬 테스트용 스크립트

사용법:
  python test_daily.py --market krx
  python test_daily.py --market us
  python test_daily.py --market all
  python test_daily.py --market krx --date 20260604
  python test_daily.py --market us  --date 20260604 --force

옵션:
  --market  krx | us | all  (필수)
  --date    YYYYMMDD        (생략 시 오늘)
  --force                   이미 완료된 날짜도 재수집
"""

import argparse
import logging
import os
import sys
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("test_daily.log", encoding="utf-8"),
    ]
)
logger = logging.getLogger(__name__)


def _check_env(market: str):
    missing = []
    for key in ("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"):
        if not os.getenv(key):
            missing.append(key)
    if market in ("us", "all") and not os.getenv("POLYGON_API_KEY"):
        missing.append("POLYGON_API_KEY")
    if missing:
        logger.error(f"필수 환경변수 없음: {', '.join(missing)}")
        sys.exit(1)


def run_krx(date_str: str, force: bool = False):
    """KRX 증분 수집 테스트"""
    from collectors.krx_collector import fetch_ohlcv, _fetch_ticker_name_map, MARKETS, _COL_MAP, _REQUIRED_COLS
    from db.turso_migrate import get_turso_conn, init_turso
    from daily_update import _init_daily_log, _is_done, _mark_done, _upsert_prices, _upsert_stocks
    from utils.helpers import random_delay

    logger.info(f"=== KRX 테스트 시작: {date_str} ===")
    turso = get_turso_conn()
    try:
        init_turso(turso)
        _init_daily_log(turso)

        for market in MARKETS:
            if not force and _is_done(turso, market, date_str):
                logger.info(f"[skip] {market} {date_str} 이미 완료 (--force로 재수집 가능)")
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

            df = df.rename(columns=_COL_MAP)
            df = df[_REQUIRED_COLS].copy()
            df = df[df["volume"] > 0].dropna(subset=["close"])

            rows = [
                (str(ticker).zfill(6), market, date_str,
                 row["open"], row["high"], row["low"], row["close"], int(row["volume"]))
                for ticker, row in df.iterrows()
            ]
            _upsert_prices(turso, rows, market, date_str)
            if not force:
                _mark_done(turso, market, date_str)
            logger.info(f"[완료] {market} {date_str} | {len(rows)}개 저장")

    finally:
        turso.close()


def run_us(date_str: str, force: bool = False):
    """US 증분 수집 테스트 (Polygon Grouped Daily — 1회 호출)"""
    from collectors.us_collector import fetch_grouped_daily, _parse_grouped
    from db.turso_migrate import get_turso_conn, init_turso
    from daily_update import _init_daily_log, _is_done, _mark_done, _upsert_prices

    poly_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    us_label  = f"POLYGON_{poly_date}"

    logger.info(f"=== US 테스트 시작 (Polygon): {poly_date} ===")
    turso = get_turso_conn()
    try:
        init_turso(turso)
        _init_daily_log(turso)

        if not force and _is_done(turso, "US_POLYGON", us_label):
            logger.info(f"[skip] US {poly_date} 이미 완료 (--force로 재수집 가능)")
            return

        results = fetch_grouped_daily(poly_date)

        if results is None:
            logger.error(f"[error] US {poly_date} Polygon API 오류")
            return
        if not results:
            logger.info(f"[empty] US {poly_date} — 휴장일 또는 데이터 없음")
            return

        rows = _parse_grouped(results, "US", poly_date)
        _upsert_prices(turso, rows, "US_POLYGON", poly_date)
        if not force:
            _mark_done(turso, "US_POLYGON", us_label)
        logger.info(f"[완료] US {poly_date} | {len(rows)}개 저장")

    finally:
        turso.close()


def main():
    parser = argparse.ArgumentParser(description="daily_update 로컬 테스트")
    parser.add_argument("--market", choices=["krx", "us", "all"], required=True)
    parser.add_argument("--date",   default=datetime.today().strftime("%Y%m%d"),
                        help="수집 날짜 YYYYMMDD (기본: 오늘)")
    parser.add_argument("--force",  action="store_true",
                        help="이미 완료된 날짜도 재수집")
    args = parser.parse_args()

    _check_env(args.market)
    logger.info(f"테스트 날짜: {args.date}, 대상: {args.market}, force: {args.force}")

    if args.market in ("krx", "all"):
        run_krx(args.date, args.force)

    if args.market in ("us", "all"):
        run_us(args.date, args.force)

    logger.info("=== 테스트 완료 ===")


if __name__ == "__main__":
    main()
