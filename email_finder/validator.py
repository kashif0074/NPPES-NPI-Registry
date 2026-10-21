"""
validator.py - Syntax & DNS/MX Record Validation for Discovered Emails.
Performs RFC syntax validation and queries live domain MX records via DNS.
"""

import re
import socket
import logging
from typing import Dict, Any, Optional

try:
    import dns.resolver
    HAS_DNS = True
except ImportError:
    HAS_DNS = False

try:
    from email_validator import validate_email as ext_validate_email, EmailNotValidError
    HAS_EMAIL_VALIDATOR = True
except ImportError:
    HAS_EMAIL_VALIDATOR = False

logger = logging.getLogger("email_validator")

# Standard RFC 5322 regex for fallback syntax checking
EMAIL_REGEX = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
)

# Reject dummy/placeholder domains
DUMMY_DOMAINS = {
    "example.com", "example.org", "example.net",
    "test.com", "domain.com", "yoursite.com",
    "email.com", "sample.com", "placeholder.com"
}

# In-memory DNS cache to avoid duplicate DNS queries
_MX_CACHE: Dict[str, bool] = {}


def check_syntax(email: str) -> bool:
    """Validates email syntax."""
    if not email or len(email) > 254:
        return False
    
    clean = email.strip()
    
    if HAS_EMAIL_VALIDATOR:
        try:
            ext_validate_email(clean, check_deliverability=False)
            return True
        except EmailNotValidError:
            return False
        except Exception:
            pass

    return bool(EMAIL_REGEX.match(clean))


def check_mx_records(domain: str, timeout: float = 3.5) -> bool:
    """
    Checks if domain has valid DNS MX or A records to receive email.
    Uses in-memory cache to prevent redundant network lookups.
    """
    clean_domain = domain.strip().lower()
    if clean_domain in _MX_CACHE:
        return _MX_CACHE[clean_domain]

    if clean_domain in DUMMY_DOMAINS:
        _MX_CACHE[clean_domain] = False
        return False

    if HAS_DNS:
        try:
            resolver = dns.resolver.Resolver()
            resolver.lifetime = timeout
            resolver.timeout = timeout
            # Try MX record first
            answers = resolver.resolve(clean_domain, "MX")
            if answers and len(answers) > 0:
                _MX_CACHE[clean_domain] = True
                return True
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers, dns.exception.Timeout):
            pass
        except Exception as exc:
            logger.debug("DNS MX lookup exception for %s: %s", clean_domain, exc)

        # Fallback to A record check (some mail servers accept direct A record routing)
        try:
            resolver = dns.resolver.Resolver()
            resolver.lifetime = timeout
            resolver.timeout = timeout
            answers = resolver.resolve(clean_domain, "A")
            if answers and len(answers) > 0:
                _MX_CACHE[clean_domain] = True
                return True
        except Exception:
            pass
    else:
        # Fallback socket lookup if dnspython is missing
        try:
            socket.setdefaulttimeout(timeout)
            socket.gethostbyname(clean_domain)
            _MX_CACHE[clean_domain] = True
            return True
        except Exception:
            pass

    _MX_CACHE[clean_domain] = False
    return False


def validate_email_address(email: str, check_mx: bool = True) -> Dict[str, Any]:
    """
    Complete validation pipeline:
    1. Syntax check
    2. Domain extraction & dummy filtering
    3. DNS MX record verification
    
    Returns structured result dict.
    """
    if not email or not isinstance(email, str):
        return {
            "email": "",
            "valid": False,
            "mx_valid": False,
            "domain": "",
            "status": "invalid_syntax"
        }

    clean_email = email.strip().lower()

    if "@" not in clean_email:
        return {
            "email": clean_email,
            "valid": False,
            "mx_valid": False,
            "domain": "",
            "status": "invalid_syntax"
        }

    domain = clean_email.split("@")[-1]

    # 1. Syntax check
    if not check_syntax(clean_email):
        return {
            "email": clean_email,
            "valid": False,
            "mx_valid": False,
            "domain": domain,
            "status": "invalid_syntax"
        }

    # 2. Dummy domain check
    if domain in DUMMY_DOMAINS:
        return {
            "email": clean_email,
            "valid": False,
            "mx_valid": False,
            "domain": domain,
            "status": "dummy_domain"
        }

    # 3. MX / DNS check
    mx_valid = False
    if check_mx:
        mx_valid = check_mx_records(domain)
        status = "valid" if mx_valid else "syntax_valid_no_mx"
    else:
        status = "syntax_valid"

    return {
        "email": clean_email,
        "valid": mx_valid if check_mx else True,
        "mx_valid": mx_valid,
        "domain": domain,
        "status": status
    }
