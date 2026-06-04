"""
코스피 / 코스닥 일별 전종목 수집
- 날짜 기준으로 하루치 전종목을 한 번에 가져오는 방식 (get_market_ohlcv)
- 종목 마스터: get_market_ticker_and_name — API 1회로 ticker+name 전부 획득
  (get_market_ticker_list + get_market_ticker_name 반복 호출 방식 대비 O(N)→O(1))
- 날짜 루프마다 랜덤 딜레이 + retry
"""

import logging
import pandas as pd
from pykrx import stock
from pykrx.stock import krx  # get_market_ticker_and_name (내부 API, 1회 호출)

from config.settings import START_DATE, END_DATE
from db.local_db import init_db, is_done, log_status, upsert_stocks, insert_prices
from utils.helpers import random_delay, retry, Progress

logger = logging.getLogger(__name__)

MARKETS = ["KOSPI", "KOSDAQ"]


def get_business_days(start: str, end: str) -> list[str]:
    """영업일 목록 생성 (pykrx로 실제 거래일만 추출)"""
    days = stock.get_previous_business_days(fromdate=start, todate=end)
    return [d.strftime("%Y%m%d") for d in days]


@retry
def _fetch_ticker_name_map(market: str, date: str) -> dict | None:
    """
    해당 날짜 기준 {ticker: name} 딕셔너리.

    krx.get_market_ticker_and_name — API 1회 호출로 전종목 ticker+name 반환.
    (pykrx 내부 구현: 전종목시세().fetch() → ISU_SRT_CD, ISU_ABBRV 컬럼 추출)

    get_market_ticker_list + get_market_ticker_name(t) 반복 조합 대비:
    - 기존: 1 + N번 API 호출 (N = 종목 수, KOSPI ~800)
    - 개선: 1번 API 호출
    """
    s = krx.get_market_ticker_and_name(date, market)  # pd.Series: index=ticker, value=name
    if s is None or s.empty:
        return None
    return s.to_dict()  # {ticker: name, ...}


@retry
def fetch_ohlcv(date: str, market: str) -> pd.DataFrame:
    """해당 날짜 전종목 OHLCV (수정주가 기준)"""
    return stock.get_market_ohlcv(date, market=market)


def collect_krx():
    """
    초기 대량 수집 (로컬 SQLite → 이후 --migrate로 Turso에 올릴 것).

    실행 후 반드시:
        python main.py --migrate
    를 실행해야 Turso에 반영됩니다.
    """
    init_db()
    business_days = get_business_days(START_DATE, END_DATE)
    logger.info(f"KRX 수집 시작 | 영업일 {len(business_days)}일")

    for market in MARKETS:
        logger.info(f"── {market} 시작 ──")

        # ── 종목 마스터: 최신 날짜 기준 1회만 가져옴 ──────────
        # 날짜마다 종목 구성이 바뀌지만, 초기 수집 목적상
        # 현재 상장 종목 기준으로 일괄 등록하고 OHLCV는 날짜별로 수집.
        # 상장폐지 종목은 OHLCV에 ticker만 남고 name은 없을 수 있으나,
        # 운영상 허용 가능한 수준의 트레이드오프.
        latest_day = business_days[-1]
        ticker_map = _fetch_ticker_name_map(market, latest_day)
        if ticker_map is None:
            logger.error(f"[{market}] 종목 마스터 취득 실패 → 수집 중단")
            continue
        upsert_stocks([(t, n, market) for t, n in ticker_map.items()])
        logger.info(f"[{market}] 종목 마스터 {len(ticker_map)}개 등록")

        prog = Progress(total=len(business_days), label=market)
        prog.start()

        for date in business_days:
            prog.step(date)

            if is_done(market, date):
                logger.debug(f"[skip] {market} {date} 이미 완료")
                prog.skip_step()
                continue

            # ── OHLCV 수집 ──────────────────────────
            df = fetch_ohlcv(date, market)
            random_delay()

            if df is None or df.empty:
                logger.warning(f"[empty] {market} {date}")
                log_status(market, date, "skipped", 0)
                prog.fail_step("빈 데이터")
                continue

            # ── 컬럼 정리 ────────────────────────────
            df = df.rename(columns={
                "시가": "open",
                "고가": "high",
                "저가": "low",
                "종가": "close",
                "거래량": "volume",
            })
            missing = [c for c in ["open", "high", "low", "close", "volume"] if c not in df.columns]
            if missing:
                logger.warning(f"[컬럼 누락] {market} {date} → {missing}, 실제: {df.columns.tolist()}")
                log_status(market, date, "skipped", 0)
                prog.fail_step("컬럼 누락")
                continue

            df.index.name = "ticker"
            df = df[["open", "high", "low", "close", "volume"]].copy()
            df = df[df["volume"] > 0]       # 거래정지 종목 제외
            df = df.dropna(subset=["close"])

            # ── DB 저장 ──────────────────────────────
            rows = [
                (str(ticker).zfill(6), market, date,
                 row["open"], row["high"], row["low"], row["close"], int(row["volume"]))
                for ticker, row in df.iterrows()
            ]
            saved = insert_prices(rows)
            log_status(market, date, "done", saved)
            logger.info(f"[done] {market} {date} | {saved}개 저장")
            prog.done_step(saved=saved)

        prog.finish()

    logger.info("KRX 수집 완료")
    logger.info("▶ 다음 단계: python main.py --migrate  (Turso 업로드)")
