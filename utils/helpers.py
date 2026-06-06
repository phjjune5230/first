import time
import random
import logging
import functools
from datetime import datetime

from config.settings import DELAY_MIN, DELAY_MAX, MAX_RETRY, RETRY_BACKOFF

logger = logging.getLogger(__name__)


# ── 랜덤 딜레이 ────────────────────────────────────

def random_delay():
    """호출마다 랜덤 딜레이 (KRX·Yahoo 차단 방지)"""
    t = random.uniform(DELAY_MIN, DELAY_MAX)
    time.sleep(t)


# ── retry 데코레이터 ───────────────────────────────

def retry(func):
    """
    에러 발생 시 MAX_RETRY회 재시도.
    retry마다 RETRY_BACKOFF * 시도횟수 초 대기 (누적 백오프).
    모두 실패하면 None 반환 — 파이프라인 중단 없이 skip.
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        for attempt in range(1, MAX_RETRY + 1):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                wait = RETRY_BACKOFF * attempt
                logger.warning(
                    f"[retry {attempt}/{MAX_RETRY}] {func.__name__} 실패: "
                    f"{type(e).__name__}: {e} → {wait}초 후 재시도"
                )
                time.sleep(wait)
        logger.error(f"[skip] {func.__name__} {MAX_RETRY}회 모두 실패 → None 반환")
        return None
    return wrapper


# ── 진행상황 트래커 ────────────────────────────────

class Progress:
    """
    수집 진행 상황을 실시간으로 콘솔에 출력하는 헬퍼.

    올바른 호출 순서:
        p.step(detail)      # 1. 스텝 시작 선언 (카운터 +1)
        ... 작업 ...
        p.done_step()       # 2a. 성공
        p.skip_step()       # 2b. 스킵
        p.fail_step(reason) # 2c. 실패

    주의: step()을 호출한 스텝에서 반드시 done/skip/fail 중 하나를 호출해야
    succeeded + skipped + failed == total 이 성립합니다.
    """

    def __init__(self, total: int, label: str):
        self.total      = total
        self.label      = label
        self.current    = 0
        self.succeeded  = 0
        self.skipped    = 0
        self.failed     = 0
        self.rows_total = 0
        self._start_ts  = None

    def start(self):
        self._start_ts = datetime.now()
        bar = "─" * 50
        print(f"\n┌{bar}┐")
        print(f"│  🚀  {self.label} 수집 시작  │  총 {self.total}개 단계")
        print(f"└{bar}┘")
        logger.info(f"[Progress] {self.label} 시작 | 총 {self.total}단계")

    def step(self, detail: str = ""):
        self.current += 1
        pct    = self.current / self.total * 100 if self.total else 0
        filled = int(pct / 5)
        bar    = "█" * filled + "░" * (20 - filled)
        elapsed = int((datetime.now() - self._start_ts).total_seconds()) if self._start_ts else 0
        if self.current > 1 and elapsed > 0:
            eta     = int(elapsed / self.current * (self.total - self.current))
            eta_str = f"  ETA {eta//60}분{eta%60:02d}초"
        else:
            eta_str = ""
        print(
            f"\r  [{bar}] {pct:5.1f}%  {self.current}/{self.total}"
            f"  {detail[:30]:<30}{eta_str}",
            end="", flush=True
        )

    def done_step(self, saved: int = 0):
        self.succeeded  += 1
        self.rows_total += saved

    def skip_step(self):
        self.skipped += 1

    def fail_step(self, reason: str = ""):
        self.failed += 1
        logger.warning(f"[Progress] {self.label} 스텝 실패: {reason}")

    def finish(self):
        elapsed = int((datetime.now() - self._start_ts).total_seconds()) if self._start_ts else 0
        accounted = self.succeeded + self.skipped + self.failed
        if accounted != self.total:
            logger.warning(
                f"[Progress] {self.label} 카운트 불일치: "
                f"total={self.total} vs 성공+스킵+실패={accounted}"
            )
        print()  # 줄바꿈
        bar = "─" * 50
        print(f"\n┌{bar}┐")
        print(f"│  ✅  {self.label} 수집 완료")
        print(f"│     성공: {self.succeeded}  스킵: {self.skipped}  실패: {self.failed}")
        print(f"│     저장 행수: {self.rows_total:,}  소요: {elapsed//60}분{elapsed%60:02d}초")
        print(f"└{bar}┘\n")
        logger.info(
            f"[Progress] {self.label} 완료 | "
            f"성공={self.succeeded} 스킵={self.skipped} 실패={self.failed} "
            f"rows={self.rows_total:,} elapsed={elapsed}s"
        )
