"""
scheduler.py - Automated Daily Provider Email Discovery Scheduler.
Supports execution via Linux cron, Windows Task Scheduler, or GitHub Actions.
"""

import os
import sys
import logging
import argparse
from datetime import datetime

# Add project root to sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from email_finder.database import init_db, get_connection
from email_finder.service import process_provider
from email_finder.exporter import export_csv_to_file

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("scheduler")


def run_daily_enrichment(limit: int = 50, output_csv: str = "daily_enriched_providers.csv"):
    """
    Finds providers in database that do not yet have websites/emails or enriches pending ones.
    """
    logger.info("Initializing database...")
    init_db()

    conn = get_connection()
    cur = conn.cursor()

    # Find providers that haven't been crawled yet
    cur.execute("""
        SELECT p.npi, p.provider_name, p.organization_name, p.entity_type,
               p.taxonomy, p.address_1, p.city, p.state, p.postal_code, p.country,
               p.phone, p.raw_json
        FROM providers p
        LEFT JOIN websites w ON w.npi = p.npi
        WHERE w.website IS NULL
        LIMIT ?
    """, (limit,))

    pending_providers = [dict(r) for r in cur.fetchall()]
    conn.close()

    total = len(pending_providers)
    logger.info("Found %d pending providers needing enrichment.", total)

    if total == 0:
        logger.info("All stored providers are already enriched. Checking if new search sync is requested...")

    success_count = 0
    total_emails = 0

    for idx, p in enumerate(pending_providers, 1):
        npi = p.get("npi")
        name = p.get("organization_name") or p.get("provider_name") or npi
        logger.info("[%d/%d] Enriching provider: %s (NPI: %s)", idx, total, name, npi)

        try:
            emails_found = process_provider(p)
            total_emails += emails_found
            success_count += 1
        except Exception as exc:
            logger.error("Failed to enrich provider %s: %s", npi, exc)

    logger.info("Enrichment complete. Processed: %d, Emails Discovered: %d", success_count, total_emails)

    # Export latest dataset
    try:
        csv_path = export_csv_to_file(output_csv)
        logger.info("Successfully exported latest dataset to: %s", csv_path)
    except Exception as exc:
        logger.error("Failed to export CSV: %s", exc)


def main():
    parser = argparse.ArgumentParser(description="Automated NPPES Provider Email Discovery Scheduler")
    parser.add_argument("--limit", type=int, default=50, help="Maximum number of providers to enrich per run")
    parser.add_argument("--output", type=str, default="daily_enriched_providers.csv", help="Path to output CSV")

    args = parser.parse_args()
    logger.info("Starting Daily Enrichment Task at %s", datetime.utcnow().isoformat())
    run_daily_enrichment(limit=args.limit, output_csv=args.output)
    logger.info("Scheduler task finished successfully.")


if __name__ == "__main__":
    main()
