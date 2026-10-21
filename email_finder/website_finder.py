"""
website_finder.py - Discovers Official Clinic / Hospital / Provider Websites.
Queries:
1. CMS NPPES official endpoints
2. OpenStreetMap (Overpass API) with query sanitization
3. Public search / domain discovery heuristic
"""

import re
import urllib.parse
import logging
from typing import Optional, Tuple, Dict, Any
import httpx

logger = logging.getLogger("website_finder")

# Domains to reject as provider websites
DISALLOWED_WEBSITES = {
    "npiregistry.cms.hhs.gov", "cms.gov", "hhs.gov",
    "google.com", "facebook.com", "instagram.com", "twitter.com",
    "linkedin.com", "yelp.com", "yellowpages.com", "healthgrades.com",
    "vitals.com", "webmd.com", "doximity.com", "wikipedia.org"
}


def clean_url(url: str) -> Optional[str]:
    """Cleans and validates an extracted website URL."""
    if not url or not isinstance(url, str):
        return None
    cleaned = url.strip()
    if not cleaned.startswith(("http://", "https://")):
        cleaned = "https://" + cleaned

    try:
        parsed = urllib.parse.urlparse(cleaned)
        domain = parsed.netloc.lower().split(":")[0]
        if not domain or "." not in domain:
            return None
        # Remove www. for check
        bare_domain = domain[4:] if domain.startswith("www.") else domain
        if bare_domain in DISALLOWED_WEBSITES or domain in DISALLOWED_WEBSITES:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return None


def find_website_from_nppes(record: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Finds website from official CMS NPPES endpoints.
    CMS provides direct connection endpoints (e.g. FHIR, Website, Direct).
    """
    if not isinstance(record, dict):
        return None, None

    for endpoint in record.get("endpoints", []):
        url = endpoint.get("endpoint", "")
        if url and ("http://" in url or "https://" in url or ".com" in url or ".org" in url or ".edu" in url):
            cleaned = clean_url(url)
            if cleaned:
                return cleaned, "nppes_endpoint"

    return None, None


def find_website_from_osm(name: str, city: str = "", state: str = "") -> Tuple[Optional[str], Optional[str]]:
    """
    Finds website from OpenStreetMap Overpass API for healthcare facilities.
    Sanitizes provider name to prevent Overpass QL regex syntax errors.
    """
    if not name or len(name.strip()) < 3:
        return None, None

    # Sanitize name for Overpass regex: keep only alphanumeric and spaces
    safe_name = re.sub(r"[^a-zA-Z0-9\s]", "", name).strip()
    # Use first 3 words to avoid over-constrained search
    name_tokens = safe_name.split()[:3]
    if not name_tokens:
        return None, None
    query_name = " ".join(name_tokens)

    # Overpass QL query with 10s timeout
    query = f"""
    [out:json][timeout:10];
    (
      node["amenity"~"clinic|hospital|doctors|dentist|pharmacy"]["name"~"{query_name}",i];
      way["amenity"~"clinic|hospital|doctors|dentist|pharmacy"]["name"~"{query_name}",i];
    );
    out tags center 5;
    """

    try:
        response = httpx.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query},
            timeout=10,
            headers={"User-Agent": "NPPES-Healthcare-WebsiteFinder/2.1"}
        )
        if response.status_code == 200:
            data = response.json()
            for element in data.get("elements", []):
                tags = element.get("tags", {})
                raw_website = tags.get("website") or tags.get("contact:website")
                if raw_website:
                    cleaned = clean_url(raw_website)
                    if cleaned:
                        return cleaned, "openstreetmap"
    except Exception as exc:
        logger.debug("OSM lookup failed for %s: %s", name, exc)

    return None, None


def find_website_from_search(name: str, city: str = "", state: str = "") -> Tuple[Optional[str], Optional[str]]:
    """
    Discovers provider website via public DuckDuckGo search.
    Completely free, no API key required.
    """
    query_parts = [name]
    if city:
        query_parts.append(city)
    if state:
        query_parts.append(state)
    query_parts.append("official website")

    query_str = " ".join(query_parts)

    try:
        url = "https://html.duckduckgo.com/html/"
        response = httpx.post(
            url,
            data={"q": query_str},
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=8,
            follow_redirects=True
        )

        if response.status_code == 200:
            # Parse result links from DuckDuckGo HTML
            # Results have format: <a class="result__url" href="..."> or <a class="result__snippet" ...>
            text = response.text
            # Find URLs in result links
            urls = re.findall(r'<a[^>]+class="result__url"[^>]*href="([^"]+)"', text)
            if not urls:
                # Fallback to general href parsing inside uddg links
                urls = re.findall(r'uddg=([^&"]+)', text)
                urls = [urllib.parse.unquote(u) for u in urls]

            for raw_u in urls:
                cleaned = clean_url(raw_u)
                if cleaned:
                    return cleaned, "web_search"
    except Exception as exc:
        logger.debug("Web search failed for %s: %s", query_str, exc)

    return None, None


def find_website(record: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Main website discovery coordinator:
    1. Check official NPPES endpoint URIs
    2. Check OpenStreetMap healthcare registry
    3. Check public search query
    """
    # 1. Official CMS NPPES Endpoint
    website, source = find_website_from_nppes(record)
    if website:
        return website, source

    # Extract provider name and location
    basic = record.get("basic", {})
    is_org = record.get("enumeration_type") == "NPI-2"
    name = (
        record.get("organization_name")
        or basic.get("organization_name")
        or record.get("provider_name")
        or f"{basic.get('first_name', '')} {basic.get('last_name', '')}".strip()
    )

    city = record.get("city", "")
    state = record.get("state", "")
    if not city or not state:
        for addr in record.get("addresses", []):
            if addr.get("address_purpose") == "LOCATION":
                city = city or addr.get("city", "")
                state = state or addr.get("state", "")
                break

    if not name:
        return None, None

    # 2. OpenStreetMap Overpass API
    website, source = find_website_from_osm(name, city, state)
    if website:
        return website, source

    # 3. Public Web Search
    website, source = find_website_from_search(name, city, state)
    if website:
        return website, source

    return None, None