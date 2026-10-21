"""
service.py - End-to-End Orchestrator for Provider Email Enrichment Pipeline.
Pipeline:
1. Save provider details to DB
2. Extract direct CMS NPPES endpoint emails
3. Discover official website (NPPES -> OSM -> Web Search)
4. Crawl contact & provider pages
5. Extract public emails & perform syntax + DNS/MX verification
6. Persist results in DB
"""

import logging
from typing import Dict, Any, List, Optional, Callable

from email_finder.email_extractor import emails_from_nppes
from email_finder.website_finder import find_website
from email_finder.crawler import crawl_website
from email_finder.validator import validate_email_address
from email_finder.database import (
    save_provider,
    save_website,
    save_email,
    update_job
)

logger = logging.getLogger("email_service")


def process_provider(record: Dict[str, Any]) -> int:
    """
    Executes the entire enrichment pipeline for a single provider record:
    Returns the count of validated emails discovered.
    """
    if not isinstance(record, dict):
        return 0

    # Ensure provider is saved in database
    npi = save_provider(record)
    if not npi:
        return 0

    discovered_count = 0

    # 1. Official CMS NPPES Endpoint Emails
    try:
        nppes_emails = emails_from_nppes(record)
        for em in nppes_emails:
            checked = validate_email_address(em)
            save_email(
                npi=npi,
                email=checked["email"],
                email_type="nppes_endpoint",
                source_url="https://npiregistry.cms.hhs.gov/",
                mx_valid=checked["mx_valid"],
                status=checked["status"]
            )
            discovered_count += 1
    except Exception as exc:
        logger.debug("Error checking NPPES endpoints for NPI %s: %s", npi, exc)

    # 2. Discover official clinic/hospital website
    website = None
    source = None
    try:
        website, source = find_website(record)
        if website:
            save_website(npi, website, source or "discovered")
    except Exception as exc:
        logger.debug("Website lookup error for NPI %s: %s", npi, exc)

    # 3. Crawl website pages & extract public contact emails
    if website:
        try:
            crawled_results = crawl_website(website, max_pages=6)
            for res in crawled_results:
                save_email(
                    npi=npi,
                    email=res["email"],
                    email_type=res["email_type"],
                    source_url=res["source_url"],
                    mx_valid=res["mx_valid"],
                    status=res["status"]
                )
                discovered_count += 1
        except Exception as exc:
            logger.debug("Crawl error for NPI %s (%s): %s", npi, website, exc)

    return discovered_count


def process_records_batch(
    records: List[Dict[str, Any]],
    job_id: Optional[str] = None,
    progress_callback: Optional[Callable[[int, int, int], None]] = None
) -> Dict[str, Any]:
    """
    Processes a list of provider records sequentially or in worker thread.
    Updates job table after each provider.
    """
    total = len(records)
    completed = 0
    total_emails_found = 0

    for record in records:
        try:
            emails_found = process_provider(record)
            total_emails_found += emails_found
        except Exception as exc:
            logger.error("Error processing provider record: %s", exc)

        completed += 1

        if job_id:
            try:
                update_job(
                    job_id=job_id,
                    completed=completed,
                    found_emails=total_emails_found,
                    status="running"
                )
            except Exception:
                pass

        if progress_callback:
            try:
                progress_callback(completed, total, total_emails_found)
            except Exception:
                pass

    if job_id:
        try:
            update_job(
                job_id=job_id,
                completed=completed,
                found_emails=total_emails_found,
                status="completed"
            )
        except Exception:
            pass

    return {
        "job_id": job_id,
        "total": total,
        "completed": completed,
        "found_emails": total_emails_found,
        "status": "completed"
    }