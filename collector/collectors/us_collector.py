"""
NASDAQ 전종목 + NYSE 전종목 일별 주가 수집 (yfinance)
- 수정주가(auto_adjust=True) + 수정거래량(split ratio 반영)
- 청크 단위 배치 다운로드 + 랜덤 딜레이

[yfinance 실제 동작]
  기본값: group_by='column', multi_level_index=True
  → 컬럼 구조: ('Price','Ticker') MultiIndex, names=['Price','Ticker']
  파싱: xs(ticker, level='Ticker', axis=1) 로 종목별 슬라이싱
"""

import logging
import pandas as pd
import yfinance as yf

from config.settings import YF_START_DATE, YF_END_DATE, YF_CHUNK_SIZE
from collectors.nasdaq_tickers import fetch_nasdaq_tickers
from collectors.nyse_tickers import fetch_nyse_tickers
from db.local_db import init_db, is_done, log_status, upsert_stocks, insert_prices
from utils.helpers import random_delay, retry, Progress

logger = logging.getLogger(__name__)


@retry
def _download_chunk(tickers: list[str], start: str, end: str) -> pd.DataFrame | None:
    if not tickers:
        return None
    df = yf.download(
        tickers     = tickers,
        start       = start,
        end         = end,
        interval    = "1d",
        auto_adjust = True,
        progress    = False,
        threads     = True,
    )
    return df


def _parse_chunk(df: pd.DataFrame, tickers: list[str], market: str) -> list[tuple]:
    rows = []
    if df is None or df.empty:
        return rows

    available = set(df.columns.get_level_values("Ticker")) \
        if isinstance(df.columns, pd.MultiIndex) else set()

    for ticker in tickers:
        try:
            if ticker not in available:
                logger.debug(f"[parse] {ticker} 데이터 없음 (상장폐지 등)")
                continue

            sub = df.xs(ticker, level="Ticker", axis=1)
            sub = sub.dropna(subset=["Close"])
            sub = sub[sub["Volume"] > 0]

            for date, row in sub.iterrows():
                rows.append((
                    ticker, market,
                    date.strftime("%Y%m%d"),
                    round(float(row["Open"]),  4) if pd.notna(row["Open"])   else None,
                    round(float(row["High"]),  4) if pd.notna(row["High"])   else None,
                    round(float(row["Low"]),   4) if pd.notna(row["Low"])    else None,
                    round(float(row["Close"]), 4) if pd.notna(row["Close"])  else None,
                    int(row["Volume"])             if pd.notna(row["Volume"]) else None,
                ))
        except Exception as e:
            logger.warning(f"[parse error] {ticker}: {e}")
            continue

    return rows


def _collect_market(market: str, ticker_list: list[tuple]):
    """
    ticker_list: [(symbol, name), ...]
    청크 단위 다운로드 → 로컬 DB 저장.
    실행 후 python main.py --migrate 로 Turso에 올릴 것.
    """
    upsert_stocks([(sym, name, market) for sym, name in ticker_list])

    symbols = [t[0] for t in ticker_list]
    total   = len(symbols)
    chunks  = list(range(0, total, YF_CHUNK_SIZE))

    prog = Progress(total=len(chunks), label=f"{market} 전체수집")
    prog.start()

    for i in chunks:
        chunk_tickers = symbols[i : i + YF_CHUNK_SIZE]
        chunk_label   = f"{market}_chunk_{i//YF_CHUNK_SIZE + 1}"
        chunk_end     = min(i + YF_CHUNK_SIZE, total)

        prog.step(f"{i+1}~{chunk_end}/{total} 다운로드")

        if is_done(market, chunk_label):
            logger.debug(f"[skip] {chunk_label} 이미 완료")
            prog.skip_step()
            continue

        logger.info(f"[{market}] {i+1}~{chunk_end}/{total} 다운로드 중...")
        df = _download_chunk(chunk_tickers, YF_START_DATE, YF_END_DATE)
        random_delay()

        if df is None or df.empty:
            logger.warning(f"[empty] {chunk_label}")
            log_status(market, chunk_label, "skipped", 0)
            prog.fail_step("빈 데이터")
            continue

        rows  = _parse_chunk(df, chunk_tickers, market)
        saved = insert_prices(rows)
        log_status(market, chunk_label, "done", saved)
        logger.info(f"[done] {chunk_label} | {saved}개 저장")
        prog.done_step(saved=saved)

    prog.finish()


def collect_us():
    """
    초기 대량 수집 (로컬 SQLite).
    실행 후 반드시:
        python main.py --migrate
    를 실행해야 Turso에 반영됩니다.
    """
    init_db()

    nasdaq_tickers = fetch_nasdaq_tickers()
    if not nasdaq_tickers:
        logger.error("[collect_us] NASDAQ 종목 리스트 취득 실패 → NASDAQ 수집 건너뜀")
    else:
        _collect_market("NASDAQ", nasdaq_tickers)

    nyse_tickers = fetch_nyse_tickers()
    if not nyse_tickers:
        logger.error("[collect_us] NYSE 종목 리스트 취득 실패 → NYSE 수집 건너뜀")
    else:
        _collect_market("NYSE", nyse_tickers)

    logger.info("미국 주식 수집 완료")
    logger.info("▶ 다음 단계: python main.py --migrate  (Turso 업로드)")
