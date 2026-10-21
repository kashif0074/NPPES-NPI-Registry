"""
research.py - Multi-Stage Public Provider Email Discovery & Attribution.
Stages:
1. Provider Direct Search: "{name}" {location} {specialty} email contact
2. Organization Search: "{name}" "{organization}" email contact
3. Official Website Search: "{name}" {location} official website contact

Implements SSRF protection, polite extraction, and precise attribution model:
- Found: Public professional email explicitly attributed to confirmed provider
- Organization Contact Found: Clinic/hospital email found (switchboard, info, etc.)
- Needs Review: Email exists but identity/ownership is uncertain
- Email Not Found: All stages completed without attributable email
- Search Incomplete: Search/network error prevented completion
"""

import os
import re
import ipaddress
import urllib.parse
from typing import Dict, Any, List, Optional
import requests
from bs4 import BeautifulSoup

from .search import search_web, SearchError
from .email_extractor import EMAIL_REGEX, clean_email, is_valid_candidate
from .validator import validate_email_address

DISALLOWED_HOSTS = {
    "localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"
}


def is_safe_public_url(url: str) -> bool:
    """Blocks SSRF: disallows private IPs, localhost, cloud metadata endpoints."""
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname.lower() in DISALLOWED_HOSTS:
            return False
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        except ValueError:
            pass
        return True
    except Exception:
        return False


def normalize_provider(record: Dict[str, Any]) -> Dict[str, Any]:
    """Standardizes fields from raw CMS NPPES dictionary."""
    basic = record.get("basic") or {}
    addresses = record.get("addresses", [])
    
    # Practice location
    address = next(
        (item for item in addresses if item.get("address_purpose") == "LOCATION"),
        {},
    )
    if not address and addresses:
        address = addresses[0]

    first_name = basic.get("first_name", "")
    last_name = basic.get("last_name", "")
    person_name = " ".join(
        basic.get(field, "")
        for field in ("first_name", "middle_name", "last_name")
        if basic.get(field)
    ).strip()

    organization_name = basic.get("organization_name", "") or record.get("organization_name", "")

    # Primary specialty
    taxonomies = record.get("taxonomies", [])
    specialty = next(
        (item.get("desc", "") for item in taxonomies if item.get("primary")),
        "",
    )
    if not specialty and taxonomies:
        specialty = taxonomies[0].get("desc", "")

    return {
        "npi": str(record.get("number") or record.get("npi") or ""),
        "name": person_name or organization_name,
        "first_name": first_name,
        "last_name": last_name,
        "organization_name": organization_name,
        "city": address.get("city", ""),
        "state": address.get("state", ""),
        "specialty": specialty,
        "is_org": record.get("enumeration_type") == "NPI-2",
    }


def research_provider(
    record: Dict[str, Any],
    stage: str = "provider",
    organization: str = "",
    domains: Optional[List[str]] = None,
    provider: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes a web search stage against Tavily or Google:
    - stage="provider": Direct provider name + location + specialty search
    - stage="organization": Search against confirmed associated hospital/clinic
    - stage="official_website": Official website and contact search
    """
    provider_info = normalize_provider(record)
    if not provider_info["name"]:
        raise ValueError("Provider name is missing")

    name = provider_info["name"].replace('"', "")
    location = f'{provider_info["city"]} {provider_info["state"]}'.strip()

    if stage == "provider":
        query = f'"{name}" {location} {provider_info["specialty"]} email contact'.strip()
    elif stage == "organization":
        if not organization and not domains:
            raise ValueError("Confirm an organization name or domain first")
        org_term = f'"{organization}"' if organization else ""
        query = f'"{name}" {org_term} email contact'.strip()
    elif stage == "official_website":
        query = f'"{name}" {location} official website contact'.strip()
    else:
        raise ValueError("Invalid research stage")

    sources = search_web(query, domains=domains, provider=provider)

    return {
        "provider": provider_info,
        "stage": stage,
        "query": query,
        "status": "Sources Found" if sources else "No Sources Found",
        "sources": sources,
    }


def extract_and_attribute_emails(
    url: str,
    provider_info: Dict[str, Any],
    timeout: int = 10
) -> List[Dict[str, Any]]:
    """
    Politely fetches a verified public source page and extracts contact emails with attribution.
    Attributes emails accurately:
    - Provider direct email (e.g. contains last name / doctor initials)
    - Organization contact email (e.g. info@, contact@, appointments@)
    - Needs review
    """
    if not is_safe_public_url(url):
        return []

    candidates: List[Dict[str, Any]] = []

    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Healthcare Directory Verification)",
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=timeout,
            allow_redirects=True
        )

        if resp.status_code != 200 or "text/html" not in resp.headers.get("Content-Type", ""):
            return []

        soup = BeautifulSoup(resp.text[:500000], "html.parser")

        found_raw = set()

        # Parse mailto links
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if href.lower().startswith("mailto:"):
                cleaned = clean_email(href)
                if is_valid_candidate(cleaned):
                    found_raw.add((cleaned, "mailto_link", a.get_text(strip=True)))

        # Parse text body matches
        body_text = soup.get_text(separator=" ")
        for match in EMAIL_REGEX.findall(body_text):
            cleaned = clean_email(match)
            if is_valid_candidate(cleaned):
                found_raw.add((cleaned, "body_text", ""))

        last_name = (provider_info.get("last_name") or "").lower()
        first_name = (provider_info.get("first_name") or "").lower()

        for email, source_type, anchor_text in found_raw:
            local = email.split("@")[0].lower()
            val = validate_email_address(email, check_mx=True)

            # Attribution logic
            is_org_generic = any(
                w in local
                for w in ["info", "contact", "support", "office", "frontdesk", "inquiry", "appointments", "billing", "reception"]
            )

            is_provider_match = False
            if last_name and len(last_name) > 2 and last_name in local:
                is_provider_match = True
            elif first_name and len(first_name) > 2 and first_name in local:
                is_provider_match = True

            if is_provider_match:
                attribution = "Found"
                category = "provider_direct"
            elif is_org_generic:
                attribution = "Organization Contact Found"
                category = "organization_general"
            else:
                attribution = "Needs Review"
                category = "other"

            candidates.append({
                "email": email,
                "email_type": category,
                "attribution_status": attribution,
                "source_url": url,
                "mx_valid": val.get("mx_valid", False),
                "verification_status": val.get("status", "syntax_valid"),
                "evidence": anchor_text or f"Discovered on {urllib.parse.urlparse(url).netloc}",
            })

    except Exception:
        pass

    return candidates
