"""
exporter.py - Final CSV Exporter for Enriched Healthcare Provider Dataset.
Merges CMS NPPES provider information with discovered websites and validated email addresses.
"""

import csv
import io
from typing import Optional, List, Dict, Any

from email_finder.database import get_connection


def generate_email_csv(job_id: Optional[str] = None, only_with_emails: bool = False) -> str:
    """
    Exports enriched provider data to a standard CSV string.
    Includes full provider location, specialty, discovered website, and validated emails.
    """
    conn = get_connection()
    cur = conn.cursor()

    query = """
        SELECT
            p.npi,
            p.entity_type,
            p.provider_name,
            p.organization_name,
            p.taxonomy,
            p.address_1,
            p.city,
            p.state,
            p.postal_code,
            p.country,
            p.phone,
            w.website,
            w.source AS website_source,
            e.email,
            e.email_type,
            e.source_url,
            e.mx_valid,
            e.status AS email_status,
            e.found_at
        FROM providers p
        LEFT JOIN websites w ON w.npi = p.npi
        LEFT JOIN emails e ON e.npi = p.npi
    """

    if only_with_emails:
        query += " WHERE e.email IS NOT NULL AND e.email != '' "

    query += " ORDER BY p.npi, e.mx_valid DESC"

    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "NPI",
        "Entity Type",
        "Provider Name",
        "Organization Name",
        "Primary Taxonomy",
        "Street Address",
        "City",
        "State",
        "Postal Code",
        "Country",
        "Phone Number",
        "Discovered Website",
        "Website Source",
        "Public Email",
        "Email Type",
        "DNS MX Valid",
        "Verification Status",
        "Source Webpage",
        "Discovered Date"
    ])

    for row in rows:
        row_dict = dict(row)
        npi = row_dict.get("npi", "")
        etype = "Organization" if row_dict.get("entity_type") == "NPI-2" else "Individual"
        pname = row_dict.get("provider_name") or ""
        orgname = row_dict.get("organization_name") or ""
        tax = row_dict.get("taxonomy") or ""
        addr = row_dict.get("address_1") or ""
        city = row_dict.get("city") or ""
        state = row_dict.get("state") or ""
        postal = row_dict.get("postal_code") or ""
        country = row_dict.get("country") or ""
        phone = row_dict.get("phone") or ""
        website = row_dict.get("website") or ""
        ws_source = row_dict.get("website_source") or ""
        email = row_dict.get("email") or ""
        email_type = row_dict.get("email_type") or ""
        mx_valid = "Yes" if row_dict.get("mx_valid") == 1 else ("No" if email else "")
        status = row_dict.get("email_status") or ""
        source_url = row_dict.get("source_url") or ""
        found_at = row_dict.get("found_at") or ""

        writer.writerow([
            npi,
            etype,
            pname,
            orgname,
            tax,
            addr,
            city,
            state,
            postal,
            country,
            phone,
            website,
            ws_source,
            email,
            email_type,
            mx_valid,
            status,
            source_url,
            found_at
        ])

    return output.getvalue()


def export_csv_to_file(filepath: str, only_with_emails: bool = False) -> str:
    """Exports enriched dataset directly to a CSV file path."""
    content = generate_email_csv(only_with_emails=only_with_emails)
    with open(filepath, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    return filepath
