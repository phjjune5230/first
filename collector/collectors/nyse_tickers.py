"""
NYSE 상장 종목 리스트 다운로드
- ftp.nasdaqtrader.com/SymbolDirectory/otherlisted.txt (공식 소스)
  Exchange 컬럼 = 'N' 인 종목만 필터 (NYSE)
- FTP 실패 시 HTTPS fallback
- ETF, 워런트, 테스트 종목 제외 → Common Stock만 반환
"""

import ftplib
import logging
import io
import urllib.request
import json

logger = logging.getLogger(__name__)

FTP_HOST = "ftp.nasdaqtrader.com"
FTP_DIR  = "/SymbolDirectory"
FTP_FILE = "otherlisted.txt"

# HTTPS fallback — NASDAQ 공식 스크리너 API
HTTPS_URL = (
    "https://api.nasdaq.com/api/screener/stocks"
    "?tableonly=true&limit=10000&exchange=nyse"
)


# ── FTP 수집 ────────────────────────────────────────

def _fetch_via_ftp() -> list[tuple]:
    logger.info("NYSE FTP에서 종목 리스트 다운로드 중...")
    buf = io.BytesIO()
    ftp = ftplib.FTP(FTP_HOST, timeout=30)
    ftp.login("anonymous", "")
    ftp.cwd(FTP_DIR)
    ftp.retrbinary(f"RETR {FTP_FILE}", buf.write)
    ftp.quit()

    buf.seek(0)
    lines = buf.read().decode("utf-8").splitlines()
    # 헤더: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
    tickers = []
    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) < 7:
            continue
        symbol     = parts[0].strip()
        name       = parts[1].strip()
        exchange   = parts[2].strip()   # N = NYSE
        is_etf     = parts[4].strip()   # N = 주식
        test_issue = parts[6].strip()   # N = 실제 종목

        if exchange != "N":             # NYSE만
            continue
        if test_issue != "N":
            continue
        if is_etf != "N":
            continue
        # 특수문자 포함 티커 제외 (워런트·우선주 등)
        if any(c in symbol for c in ["^", ".", "/", " "]):
            continue
        tickers.append((symbol, name))

    logger.info(f"[FTP] NYSE 종목 {len(tickers)}개 로드")
    return tickers


# ── HTTPS fallback ──────────────────────────────────

def _fetch_via_https() -> list[tuple]:
    logger.info("NYSE HTTPS fallback으로 종목 리스트 다운로드 중...")
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
        if any(c in symbol for c in ["^", ".", "/", " "]):
            continue
        tickers.append((symbol, name))

    logger.info(f"[HTTPS] NYSE 종목 {len(tickers)}개 로드")
    return tickers


# ── 공개 인터페이스 ─────────────────────────────────

def fetch_nyse_tickers() -> list[tuple]:
    """
    반환: [(ticker, name), ...]
    FTP 실패 시 HTTPS fallback 자동 전환.
    둘 다 실패 시 빈 리스트 반환.
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
