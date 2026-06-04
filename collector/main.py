"""
주가 데이터 수집 메인 실행

사용법:
  python main.py --market all    # 전체 초기 수집 (KRX + NASDAQ + NYSE) → 로컬 DB
  python main.py --market krx    # 코스피/코스닥만 → 로컬 DB
  python main.py --market us     # NASDAQ + NYSE만 → 로컬 DB
  python main.py --migrate       # 로컬 DB → Turso (초기 수집 후 1회 실행)
  python main.py --daily         # 오늘치 증분 수집 → Turso 직접

초기 수집 전체 흐름:
  1. python main.py --market all   (수 시간 소요, 재시작 가능)
  2. python main.py --migrate      (로컬 → Turso, 1회)
  이후 매일:
  3. python main.py --daily        (Turso 직접 upsert)
"""

import argparse
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(
    level    = logging.INFO,
    format   = "%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers = [
        logging.StreamHandler(),
        logging.FileHandler("collector.log", encoding="utf-8"),
    ]
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(
        description="주가 데이터 수집기",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "초기 수집 흐름:\n"
            "  1) python main.py --market all\n"
            "  2) python main.py --migrate\n"
            "  이후 매일: python main.py --daily"
        )
    )
    parser.add_argument("--market",  choices=["all", "krx", "us"],
                        help="초기 대량 수집 대상 (로컬 DB에 저장)")
    parser.add_argument("--migrate", action="store_true",
                        help="로컬 DB → Turso 마이그레이션 (초기 수집 후 1회)")
    parser.add_argument("--daily",   action="store_true",
                        help="오늘치 증분 수집 (Turso 직접 upsert)")
    args = parser.parse_args()

    if args.daily:
        logger.info("=== 증분 수집 시작 ===")
        from daily_update import run_daily
        run_daily()

    elif args.migrate:
        logger.info("=== Turso 마이그레이션 시작 ===")
        from db.turso_migrate import migrate
        migrate()

    elif args.market in ("all", "krx"):
        logger.info("=== KRX 수집 시작 ===")
        from collectors.krx_collector import collect_krx
        collect_krx()
        if args.market == "all":
            logger.info("=== US 수집 시작 ===")
            from collectors.us_collector import collect_us
            collect_us()
        logger.info("▶ 초기 수집 완료. 다음: python main.py --migrate")

    elif args.market == "us":
        logger.info("=== US 수집 시작 (NASDAQ + NYSE) ===")
        from collectors.us_collector import collect_us
        collect_us()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
