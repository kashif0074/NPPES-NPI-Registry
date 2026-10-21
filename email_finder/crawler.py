"""
crawler.py - Targeted Healthcare Website Web Crawler.
Discovers and scans contact, team, provider, and staff pages to extract public emails.
"""

import logging
import urllib.parse
from typing import List, Dict, Any, Set
import httpx
from bs4 import BeautifulSoup

from email_finder.email_extractor import emails_from_html
from email_finder.validator import validate_email_address

logger = logging.getLogger("email_crawler")

# Standard paths commonly containing healthcare provider contact emails
DEFAULT_CONTACT_PATHS = [
    "",
    "/contact",
    "/contact-us",
    "/about",
    "/about-us",
    "/our-team",
    "/team",
    "/providers",
    "/physicians",
    "/doctors",
    "/staff",
    "/meet-the-team",
    "/appointments",
    "/locations",
]

# Keywords in href or anchor text indicating contact/team links
RELEVANT_LINK_KEYWORDS = [
    "contact", "about", "team", "provider", "physician", "doctor",
    "staff", "appointment", "location", "directory", "faculty"
]


def classify_email(email: str) -> str:
    """Classifies email into functional healthcare category."""
    if not email or "@" not in email:
        return "public_contact"
    
    local = email.split("@")[0].lower()

    if any(k in local for k in ["info", "contact", "hello", "office", "frontdesk", "inquiry", "enquiry"]):
        return "clinic_general"
    if any(k in local for k in ["appointment", "booking", "schedule", "reception", "intake"]):
        return "appointments"
    if any(k in local for k in ["billing", "finance", "claims", "insurance"]):
        return "billing"
    if any(k in local for k in ["research", "academic", "faculty", "fellowship"]):
        return "research"
    if any(k in local for k in ["hr", "careers", "jobs", "recruit", "employment"]):
        return "hr"
    if any(k in local for k in ["dr", "md", "do", "nurse", "provider", "physician"]):
        return "provider_direct"

    return "public_contact"


def discover_page_links(base_url: str, html_content: str, max_links: int = 8) -> List[str]:
    """
    Parses homepage HTML to discover relevant internal contact and team links.
    """
    discovered: Set[str] = set()
    try:
        soup = BeautifulSoup(html_content, "html.parser")
        parsed_base = urllib.parse.urlparse(base_url)
        base_domain = parsed_base.netloc.lower()

        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            text = a.get_text(strip=True).lower()

            # Ignore anchors and javascript
            if not href or href.startswith(("#", "javascript:", "tel:", "sms:")):
                continue

            # Check if link text or href contains contact/team keywords
            is_relevant = (
                any(kw in href.lower() for kw in RELEVANT_LINK_KEYWORDS) or
                any(kw in text for kw in RELEVANT_LINK_KEYWORDS)
            )

            if is_relevant:
                absolute_url = urllib.parse.urljoin(base_url, href)
                parsed_target = urllib.parse.urlparse(absolute_url)

                # Keep only same domain links
                if parsed_target.netloc.lower() == base_domain:
                    clean_target = f"{parsed_target.scheme}://{parsed_target.netloc}{parsed_target.path}"
                    discovered.add(clean_target)
                    if len(discovered) >= max_links:
                        break
    except Exception as exc:
        logger.debug("Link discovery failed for %s: %s", base_url, exc)

    return list(discovered)


def crawl_website(base_url: str, max_pages: int = 7) -> List[Dict[str, Any]]:
    """
    Crawls official clinic website:
    1. Fetches homepage and extracts emails + internal relevant links
    2. Crawls discovered contact/team pages
    3. Extracts and validates all found emails
    """
    results: List[Dict[str, Any]] = []
    seen_urls: Set[str] = set()
    seen_emails: Set[str] = set()

    clean_base = base_url.rstrip("/")

    # Prepare prioritized URL list
    urls_to_crawl = [clean_base]
    for path in DEFAULT_CONTACT_PATHS[1:]:
        urls_to_crawl.append(clean_base + path)

    # Use a polite HTTP client
    transport = httpx.HTTPTransport(retries=1, verify=False)
    client = httpx.Client(
        transport=transport,
        follow_redirects=True,
        timeout=10,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Healthcare Directory)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
    )

    pages_crawled = 0

    try:
        # Step 1: Crawl homepage first and discover on-page links
        try:
            resp = client.get(clean_base)
            seen_urls.add(clean_base)
            pages_crawled += 1

            if resp.status_code == 200:
                html_text = resp.text
                # Extract emails on homepage
                extracted = emails_from_html(html_text)
                for em in extracted:
                    if em not in seen_emails:
                        seen_emails.add(em)
                        checked = validate_email_address(em)
                        results.append({
                            "email": checked["email"],
                            "email_type": classify_email(checked["email"]),
                            "source_url": str(resp.url),
                            "mx_valid": checked["mx_valid"],
                            "status": checked["status"]
                        })

                # Discover active contact/team links on homepage
                dynamic_links = discover_page_links(clean_base, html_text)
                for dlink in dynamic_links:
                    if dlink not in seen_urls and dlink not in urls_to_crawl:
                        urls_to_crawl.insert(1, dlink)
        except Exception as exc:
            logger.debug("Homepage crawl error for %s: %s", clean_base, exc)

        # Step 2: Crawl remaining candidate pages
        for target_url in urls_to_crawl:
            if pages_crawled >= max_pages:
                break
            if target_url in seen_urls:
                continue

            seen_urls.add(target_url)
            try:
                resp = client.get(target_url)
                pages_crawled += 1

                if resp.status_code == 200:
                    extracted = emails_from_html(resp.text)
                    for em in extracted:
                        if em not in seen_emails:
                            seen_emails.add(em)
                            checked = validate_email_address(em)
                            results.append({
                                "email": checked["email"],
                                "email_type": classify_email(checked["email"]),
                                "source_url": str(resp.url),
                                "mx_valid": checked["mx_valid"],
                                "status": checked["status"]
                            })
            except Exception:
                continue
    finally:
        client.close()

    return results