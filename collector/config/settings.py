import os
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv()

# ── Turso ─────────────────────────────────────────
TURSO_DATABASE_URL = os.getenv("TURSO_DATABASE_URL", "")
TURSO_AUTH_TOKEN   = os.getenv("TURSO_AUTH_TOKEN", "")

# ── 로컬 SQLite (초기 대량 수집용) ────────────────
LOCAL_DB_PATH = os.getenv("LOCAL_DB_PATH", "./stock_local.db")

# ── 수집 기간 (3년) ───────────────────────────────
# 주의: 모듈 임포트 시점에 고정됨.
# 초기 대량 수집(collect_krx/collect_us)용으로만 사용.
# daily_update는 자체적으로 datetime.today()를 사용함.
def get_date_range():
    end   = datetime.today()
    start = end - timedelta(days=365 * 3)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")

def get_yf_date_range():
    end   = datetime.today()
    start = end - timedelta(days=365 * 3)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

# 하위 호환용 — 초기 수집에서 직접 import해서 쓰는 경우
START_DATE, END_DATE       = get_date_range()
YF_START_DATE, YF_END_DATE = get_yf_date_range()

# ── 딜레이 (초) ───────────────────────────────────
DELAY_MIN = 1.5
DELAY_MAX = 2.5

# ── yfinance 배치 크기 ────────────────────────────
YF_CHUNK_SIZE = 200   # 한 번에 요청할 티커 수

# ── retry ─────────────────────────────────────────
MAX_RETRY     = 3
RETRY_BACKOFF = 5     # retry 간격(초) — 매 retry마다 누적
