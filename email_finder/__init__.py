"""
email_finder - Healthcare Provider Email & Website Enrichment Package.
"""

from email_finder.website_finder import find_website, find_website_from_nppes, find_website_from_osm
from email_finder.crawler import crawl_website, classify_email
from email_finder.email_extractor import emails_from_html, emails_from_nppes
from email_finder.validator import validate_email_address, check_syntax, check_mx_records
from email_finder.database import (
    init_db,
    save_provider,
    save_website,
    save_email,
    get_provider_emails,
    get_all_emails_summary,
    create_job,
    update_job,
    get_job,
)
from email_finder.service import process_provider, process_records_batch
from email_finder.exporter import generate_email_csv, export_csv_to_file
from email_finder.search import search_web, SearchError
from email_finder.research import research_provider, normalize_provider, extract_and_attribute_emails

__all__ = [
    "find_website",
    "find_website_from_nppes",
    "find_website_from_osm",
    "crawl_website",
    "classify_email",
    "emails_from_html",
    "emails_from_nppes",
    "validate_email_address",
    "check_syntax",
    "check_mx_records",
    "init_db",
    "save_provider",
    "save_website",
    "save_email",
    "get_provider_emails",
    "get_all_emails_summary",
    "create_job",
    "update_job",
    "get_job",
    "process_provider",
    "process_records_batch",
    "generate_email_csv",
    "export_csv_to_file",
    "search_web",
    "SearchError",
    "research_provider",
    "normalize_provider",
    "extract_and_attribute_emails",
]
