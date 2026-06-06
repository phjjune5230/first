"""
미국 주식 일별 OHLCV 수집 — Polygon.io Grouped Daily 엔드포인트
- 전종목을 1회 API 호출로 수집
- 종목 필터링: '$' 포함 / 워런트(W) / 유닛(U) / 권리(R) 제거
"""

import logging
import time
import re

import requests

from config.settings import POLYGON_API_KEY, POLYGON_BASE_URL
from utils.helpers import retry

logger = logging.getLogger(__name__)

_EXCLUDE_RE = re.compile(r'[\$\.]|[A-Z]{2,5}W$|[A-Z]{2,5}U$|[A-Z]{2,5}R$')


def _is_valid_ticker(ticker: str) -> bool:
    return bool(ticker) and not _EXCLUDE_RE.search(ticker)


@retry
def fetch_grouped_daily(date: str) -> list[dict] | None:
    """
    Polygon Grouped Daily 호출.
    date: 'YYYY-MM-DD' 또는 'YYYYMMDD'
    반환: results 리스트 or None(오류) or [](휴장일)
    """
    if len(date) == 8 and '-' not in date:
        date = f"{date[:4]}-{date[4:6]}-{date[6:]}"

    url = f"{POLYGON_BASE_URL}/v2/aggs/grouped/locale/us/market/stocks/{date}"
    logger.info(f"[Polygon] 요청 URL: {url}")
    logger.info(f"[Polygon] API 키 앞 4자리: {POLYGON_API_KEY[:4] if POLYGON_API_KEY else '없음'}")
    resp = requests.get(url, params={"adjusted": "true", "apiKey": POLYGON_API_KEY}, timeout=30)
    logger.info(f"[Polygon] 응답 코드: {resp.status_code}")
    if resp.status_code == 403:
        logger.error("[Polygon] API 키 인증 실패 (403)")
        return None
    if resp.status_code == 429:
        logger.warning("[Polygon] rate limit (429) — 60초 대기")
        time.sleep(60)
        raise Exception("rate limit")
    resp.raise_for_status()

    data   = resp.json()
    status = data.get("status", "")
    if status == "NOT_FOUND":
        logger.info(f"[Polygon] {date} 데이터 없음 (휴장일 등)")
        return []
    if status not in ("OK", "DELAYED"):
        logger.warning(f"[Polygon] 예상치 못한 status: {status}")
        return None

    results = data.get("results") or []
    logger.info(f"[Polygon] {date} {len(results)}개 수신")
    return results


def _parse_grouped(results: list[dict], market: str, date_str: str) -> list[tuple]:
    """Polygon results → DB insert용 tuple 리스트. date_str은 YYYYMMDD로 저장."""
    date_key = date_str.replace("-", "")
    rows = []
    for r in results:
        ticker = r.get("T", "")
        if not _is_valid_ticker(ticker):
            continue
        volume = r.get("v", 0) or 0
        close  = r.get("c")
        if not close or volume <= 0:
            continue
        rows.append((
            ticker, market, date_key,
            round(float(r["o"]), 4) if r.get("o") is not None else None,
            round(float(r["h"]), 4) if r.get("h") is not None else None,
            round(float(r["l"]), 4) if r.get("l") is not None else None,
            round(float(close),  4),
            int(volume),
        ))
    return rows
