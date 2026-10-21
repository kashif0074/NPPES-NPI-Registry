"""
email_extractor.py - High-Precision Extraction of Public Emails from HTML, Text & Metadata.
Extracts mailto links, regular text patterns, obfuscated emails, and schema.org scripts.
"""

import html
import re
import urllib.parse
from typing import Set, Dict, Any
from bs4 import BeautifulSoup

# Strict RFC-compliant email matching pattern
EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE
)

# Obfuscated pattern: name [at] domain [dot] com
OBFUSCATED_AT_REGEX = re.compile(
    r"([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|@)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\.)\s*([a-zA-Z]{2,})",
    re.IGNORECASE
)

# File extensions that are not email addresses
IMAGE_AND_ASSET_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
    ".tif", ".tiff", ".css", ".js", ".map", ".woff", ".woff2", ".ttf",
    ".eot", ".mp4", ".mp3", ".pdf", ".zip"
)

# Dummy test emails to filter out
IGNORE_EMAILS = {
    "your@email.com", "name@domain.com", "user@domain.com", "test@test.com",
    "email@example.com", "info@example.com", "contact@example.com",
    "support@domain.com", "admin@domain.com", "user@example.com"
}


def clean_email(email_str: str) -> str:
    """Cleans up and normalizes an email string."""
    if not email_str:
        return ""
    # Strip whitespace, unescape HTML entities, and lowercase
    res = html.unescape(email_str).strip().lower()
    # Remove mailto prefix if present
    if res.startswith("mailto:"):
        res = res[7:]
    # Remove query string parameters (e.g. ?subject=...)
    res = res.split("?")[0].split("#")[0].strip()
    # Strip trailing punctuation often caught by regex (dots, commas, parentheses)
    res = res.rstrip(".,;:)'\"")
    res = res.lstrip("('\"<")
    return res


def is_valid_candidate(email: str) -> bool:
    """Verifies that extracted candidate is not an image file or ignored dummy."""
    if not email or "@" not in email:
        return False
    lower = email.lower()
    if any(lower.endswith(ext) for ext in IMAGE_AND_ASSET_EXTENSIONS):
        return False
    if lower in IGNORE_EMAILS:
        return False
    if ".." in lower or "@." in lower or ".@" in lower:
        return False
    parts = lower.split("@")
    if len(parts) != 2:
        return False
    user, domain = parts
    if not user or not domain or "." not in domain:
        return False
    # Avoid javascript / css code artifacts
    if any(c in email for c in ['"', "'", " ", "\\", "{", "}", ";", "<", ">"]):
        return False
    return True


def emails_from_nppes(record: Dict[str, Any]) -> Set[str]:
    """
    Extracts direct email endpoints from official CMS NPPES API response record.
    CMS NPPES records include an 'endpoints' list containing direct/SOAP/FHIR contact URIs.
    """
    found: Set[str] = set()
    if not isinstance(record, dict):
        return found

    for endpoint in record.get("endpoints", []):
        value = endpoint.get("endpoint", "")
        if not value:
            continue
        cleaned = clean_email(value)
        if is_valid_candidate(cleaned):
            found.add(cleaned)

    return found


def emails_from_html(html_content: str) -> Set[str]:
    """
    Extracts all public email addresses from raw HTML content:
    1. Parse mailto: links in <a> tags
    2. Regex scan full unescaped HTML body
    3. Obfuscated emails (e.g. name [at] domain.com)
    4. JSON-LD structured data scripts
    """
    if not html_content or not isinstance(html_content, str):
        return set()

    emails: Set[str] = set()

    # 1. Parse using BeautifulSoup
    try:
        soup = BeautifulSoup(html_content, "html.parser")

        # 1a. mailto: links
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            if href.lower().startswith("mailto:"):
                # URL-decode mailto value
                decoded = urllib.parse.unquote(href)
                cleaned = clean_email(decoded)
                if is_valid_candidate(cleaned):
                    emails.add(cleaned)

        # 1b. Schema.org / JSON-LD structured data
        for script in soup.find_all("script", type=lambda t: t and "ld+json" in t.lower()):
            if script.string:
                for match in EMAIL_REGEX.findall(script.string):
                    cleaned = clean_email(match)
                    if is_valid_candidate(cleaned):
                        emails.add(cleaned)

        # Get plain text for regex matching
        text_content = soup.get_text(separator=" ")
    except Exception:
        text_content = html_content

    # 2. Direct regex match on HTML text
    for match in EMAIL_REGEX.findall(text_content):
        cleaned = clean_email(match)
        if is_valid_candidate(cleaned):
            emails.add(cleaned)

    # 3. Detect obfuscated patterns
    for match in OBFUSCATED_AT_REGEX.findall(text_content):
        constructed = f"{match[0]}@{match[1]}.{match[2]}"
        cleaned = clean_email(constructed)
        if is_valid_candidate(cleaned):
            emails.add(cleaned)

    return emails
