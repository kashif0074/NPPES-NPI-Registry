"""
extractor.py - Backwards compatibility wrapper for email_extractor.py.
"""

from email_finder.email_extractor import (
    clean_email,
    is_valid_candidate,
    emails_from_nppes,
    emails_from_html,
)

__all__ = [
    "clean_email",
    "is_valid_candidate",
    "emails_from_nppes",
    "emails_from_html",
]