"""
NASDAQ 상장 종목 리스트 다운로드
1차: ftp.nasdaqtrader.com FTP (공식 소스, 매일 업데이트)
2차: NASDAQ API HTTPS fallback (FTP 차단 환경 대응)
- ETF, 워런트, 테스트종목 필터링 후 Common Stock만 반환
"""

import ftplib
import logging
import io
import urllib.request
import json

logger = logging.getLogger(__name__)

FTP_HOST  = "ftp.nasdaqtrader.com"
FTP_DIR   = "/SymbolDirectory"
FTP_FILE  = "nasdaqlisted.txt"

# HTTPS fallback — NASDAQ 공식 스크리너 API
HTTPS_URL = (
    "https://api.nasdaq.com/api/screener/stocks"
    "?tableonly=true&limit=10000&exchange=nasdaq"
)


# ── FTP 수집 ────────────────────────────────────────

def _fetch_via_ftp() -> list[tuple]:
    logger.info("NASDAQ FTP에서 종목 리스트 다운로드 중...")
    buf = io.BytesIO()
    ftp = ftplib.FTP(FTP_HOST, timeout=30)
    ftp.login("anonymous", "")
    ftp.cwd(FTP_DIR)
    ftp.retrbinary(f"RETR {FTP_FILE}", buf.write)
    ftp.quit()

    buf.seek(0)
    lines = buf.read().decode("utf-8").splitlines()
    # 헤더: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
    tickers = []
    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) < 7:
            continue
        symbol     = parts[0].strip()
        name       = parts[1].strip()
        test_issue = parts[3].strip()   # N = 실제 종목
        fin_status = parts[4].strip()   # N = 정상
        is_etf     = parts[6].strip()   # N = 주식

        if test_issue != "N":
            continue
        if is_etf != "N":
            continue
        if fin_status != "N":
            continue
        # 특수문자 포함 티커 제외 (워런트·SPAC 등)
        if any(c in symbol for c in ["^", ".", "/"]):
            continue
        tickers.append((symbol, name))

    logger.info(f"[FTP] NASDAQ 종목 {len(tickers)}개 로드")
    return tickers


# ── HTTPS fallback ──────────────────────────────────

def _fetch_via_https() -> list[tuple]:
    logger.info("NASDAQ HTTPS fallback으로 종목 리스트 다운로드 중...")
    req = urllib.request.Request(
        HTTPS_URL,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    rows = data.get("data", {}).get("table", {}).get("rows", [])
    tickers = []
    for row in rows:
        symbol = (row.get("symbol") or "").strip()
        name   = (row.get("name")   or "").strip()
        if not symbol:
            continue
        if any(c in symbol for c in ["^", ".", "/"]):
            continue
        tickers.append((symbol, name))

    logger.info(f"[HTTPS] NASDAQ 종목 {len(tickers)}개 로드")
    return tickers


# ── 공개 인터페이스 ─────────────────────────────────

def fetch_nasdaq_tickers() -> list[tuple]:
    """
    반환: [(ticker, name), ...]
    FTP 실패 시 HTTPS fallback 자동 전환.
    둘 다 실패 시 빈 리스트 반환 (파이프라인 계속 진행).
    """
    try:
        return _fetch_via_ftp()
    except Exception as e:
        logger.warning(f"FTP 실패 → HTTPS fallback 전환: {type(e).__name__}: {e}")

    try:
        return _fetch_via_https()
    except Exception as e:
        logger.error(f"HTTPS fallback도 실패: {type(e).__name__}: {e} → 빈 리스트 반환")
        return []
