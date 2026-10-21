"""
database.py - Thread-Safe Storage Layer Supporting SQLite & PostgreSQL.
Stores providers, discovered websites, validated emails, and asynchronous batch jobs.
"""

import os
import json
import sqlite3
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("database")

DB_PATH = os.environ.get("NPPES_DB_PATH", "nppes_emails.db")
DATABASE_URL = os.environ.get("DATABASE_URL")

IS_POSTGRES = bool(DATABASE_URL and DATABASE_URL.startswith(("postgres://", "postgresql://")))

if IS_POSTGRES:
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
    except ImportError:
        logger.warning("DATABASE_URL provided but psycopg2 is not installed. Falling back to SQLite.")
        IS_POSTGRES = False


def get_connection():
    """Returns database connection based on environment configuration."""
    if IS_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        return conn

    # SQLite
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.row_factory = sqlite3.Row
    # Enable Write-Ahead Logging (WAL) for high-performance concurrent writes
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass
    return conn


def init_db():
    """Initializes tables for providers, websites, emails, and enrichment jobs."""
    conn = get_connection()
    cur = conn.cursor()

    if IS_POSTGRES:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS providers (
            npi VARCHAR(20) PRIMARY KEY,
            provider_name TEXT,
            organization_name TEXT,
            entity_type VARCHAR(10),
            taxonomy TEXT,
            address_1 TEXT,
            city TEXT,
            state VARCHAR(10),
            postal_code VARCHAR(20),
            country VARCHAR(50),
            phone VARCHAR(30),
            raw_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS websites (
            npi VARCHAR(20) PRIMARY KEY,
            website TEXT,
            source VARCHAR(50),
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(npi) REFERENCES providers(npi) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS emails (
            id SERIAL PRIMARY KEY,
            npi VARCHAR(20),
            email VARCHAR(255),
            email_type VARCHAR(50),
            source_url TEXT,
            mx_valid INTEGER DEFAULT 0,
            status VARCHAR(50),
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(npi, email),
            FOREIGN KEY(npi) REFERENCES providers(npi) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS jobs (
            job_id VARCHAR(64) PRIMARY KEY,
            status VARCHAR(20),
            total INTEGER,
            completed INTEGER,
            found_emails INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
    else:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS providers (
            npi TEXT PRIMARY KEY,
            provider_name TEXT,
            organization_name TEXT,
            entity_type TEXT,
            taxonomy TEXT,
            address_1 TEXT,
            city TEXT,
            state TEXT,
            postal_code TEXT,
            country TEXT,
            phone TEXT,
            raw_json TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS websites (
            npi TEXT PRIMARY KEY,
            website TEXT,
            source TEXT,
            found_at TEXT,
            FOREIGN KEY(npi) REFERENCES providers(npi)
        );

        CREATE TABLE IF NOT EXISTS emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            npi TEXT,
            email TEXT,
            email_type TEXT,
            source_url TEXT,
            mx_valid INTEGER,
            status TEXT,
            found_at TEXT,
            UNIQUE(npi, email),
            FOREIGN KEY(npi) REFERENCES providers(npi)
        );

        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            status TEXT,
            total INTEGER,
            completed INTEGER,
            found_emails INTEGER,
            created_at TEXT,
            updated_at TEXT
        );
        """)

    conn.commit()
    conn.close()


def normalize_provider_data(record: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts standardized provider fields from both raw CMS and flat format."""
    npi = str(record.get("npi") or record.get("number") or "").strip()
    
    basic = record.get("basic", {})
    entity_type = record.get("enumeration_type", "")
    
    # Provider name
    if entity_type == "NPI-2":
        provider_name = ""
        organization_name = record.get("organization_name") or basic.get("organization_name", "")
    else:
        provider_name = record.get("provider_name") or (
            f"{basic.get('first_name', '')} {basic.get('last_name', '')}".strip()
        )
        organization_name = record.get("organization_name", "")

    # Primary Taxonomy
    taxonomy = record.get("taxonomy", "")
    if not taxonomy:
        for t in record.get("taxonomies", []):
            if t.get("primary"):
                taxonomy = t.get("desc") or t.get("code", "")
                break
        if not taxonomy and record.get("taxonomies"):
            taxonomy = record["taxonomies"][0].get("desc", "")

    # Practice Location Address
    addr_1 = record.get("address_1", "")
    city = record.get("city", "")
    state = record.get("state", "")
    postal_code = record.get("postal_code", "")
    country = record.get("country", "")
    phone = record.get("phone", "")

    if not city or not state:
        for addr in record.get("addresses", []):
            if addr.get("address_purpose") == "LOCATION":
                addr_1 = addr.get("address_1", "")
                city = addr.get("city", "")
                state = addr.get("state", "")
                postal_code = addr.get("postal_code", "")
                country = addr.get("country_name") or addr.get("country_code", "")
                phone = addr.get("telephone_number", "")
                break
        if not city and record.get("addresses"):
            first_addr = record["addresses"][0]
            addr_1 = addr_1 or first_addr.get("address_1", "")
            city = city or first_addr.get("city", "")
            state = state or first_addr.get("state", "")
            postal_code = postal_code or first_addr.get("postal_code", "")
            country = country or first_addr.get("country_name") or first_addr.get("country_code", "")
            phone = phone or first_addr.get("telephone_number", "")

    raw_json = json.dumps(record) if not isinstance(record.get("raw_json"), str) else record["raw_json"]

    return {
        "npi": npi,
        "provider_name": provider_name,
        "organization_name": organization_name,
        "entity_type": entity_type,
        "taxonomy": taxonomy,
        "address_1": addr_1,
        "city": city,
        "state": state,
        "postal_code": postal_code,
        "country": country,
        "phone": phone,
        "raw_json": raw_json
    }


def save_provider(record: Dict[str, Any]) -> str:
    """Inserts or updates provider record in database."""
    norm = normalize_provider_data(record)
    if not norm["npi"]:
        return ""

    conn = get_connection()
    cur = conn.cursor()

    if IS_POSTGRES:
        cur.execute("""
            INSERT INTO providers (npi, provider_name, organization_name, entity_type, taxonomy, address_1, city, state, postal_code, country, phone, raw_json)
            VALUES (%(npi)s, %(provider_name)s, %(organization_name)s, %(entity_type)s, %(taxonomy)s, %(address_1)s, %(city)s, %(state)s, %(postal_code)s, %(country)s, %(phone)s, %(raw_json)s)
            ON CONFLICT (npi) DO UPDATE SET
                provider_name = EXCLUDED.provider_name,
                organization_name = EXCLUDED.organization_name,
                taxonomy = EXCLUDED.taxonomy,
                address_1 = EXCLUDED.address_1,
                city = EXCLUDED.city,
                state = EXCLUDED.state,
                postal_code = EXCLUDED.postal_code,
                country = EXCLUDED.country,
                phone = EXCLUDED.phone,
                raw_json = EXCLUDED.raw_json;
        """, norm)
    else:
        now_str = datetime.utcnow().isoformat()
        cur.execute("""
            INSERT OR REPLACE INTO providers
            (npi, provider_name, organization_name, entity_type, taxonomy, address_1, city, state, postal_code, country, phone, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            norm["npi"], norm["provider_name"], norm["organization_name"],
            norm["entity_type"], norm["taxonomy"], norm["address_1"],
            norm["city"], norm["state"], norm["postal_code"],
            norm["country"], norm["phone"], norm["raw_json"], now_str
        ))

    conn.commit()
    conn.close()
    return norm["npi"]


def save_website(npi: str, website: str, source: str):
    """Saves discovered website for provider."""
    if not npi or not website:
        return

    conn = get_connection()
    cur = conn.cursor()
    now_str = datetime.utcnow().isoformat()

    if IS_POSTGRES:
        cur.execute("""
            INSERT INTO websites (npi, website, source, found_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (npi) DO UPDATE SET
                website = EXCLUDED.website,
                source = EXCLUDED.source,
                found_at = CURRENT_TIMESTAMP;
        """, (npi, website, source))
    else:
        cur.execute("""
            INSERT OR REPLACE INTO websites (npi, website, source, found_at)
            VALUES (?, ?, ?, ?)
        """, (npi, website, source, now_str))

    conn.commit()
    conn.close()


def save_email(npi: str, email: str, email_type: str, source_url: str, mx_valid: bool, status: str):
    """Saves extracted & validated email for provider."""
    if not npi or not email:
        return

    conn = get_connection()
    cur = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    clean_email = email.lower().strip()
    mx_flag = 1 if mx_valid else 0

    if IS_POSTGRES:
        cur.execute("""
            INSERT INTO emails (npi, email, email_type, source_url, mx_valid, status, found_at)
            VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (npi, email) DO UPDATE SET
                email_type = EXCLUDED.email_type,
                source_url = EXCLUDED.source_url,
                mx_valid = EXCLUDED.mx_valid,
                status = EXCLUDED.status,
                found_at = CURRENT_TIMESTAMP;
        """, (npi, clean_email, email_type, source_url, mx_flag, status))
    else:
        cur.execute("""
            INSERT OR REPLACE INTO emails (npi, email, email_type, source_url, mx_valid, status, found_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (npi, clean_email, email_type, source_url, mx_flag, status, now_str))

    conn.commit()
    conn.close()


def get_provider_emails(npi: str) -> List[Dict[str, Any]]:
    """Returns all emails discovered for a specific NPI."""
    conn = get_connection()
    cur = conn.cursor()

    if IS_POSTGRES:
        cur.execute("""
            SELECT e.email, e.email_type, e.source_url, e.mx_valid, e.status, e.found_at, w.website, w.source as website_source
            FROM emails e
            LEFT JOIN websites w ON w.npi = e.npi
            WHERE e.npi = %s
            ORDER BY e.mx_valid DESC, e.id ASC
        """, (npi,))
    else:
        cur.execute("""
            SELECT e.email, e.email_type, e.source_url, e.mx_valid, e.status, e.found_at, w.website, w.source as website_source
            FROM emails e
            LEFT JOIN websites w ON w.npi = e.npi
            WHERE e.npi = ?
            ORDER BY e.mx_valid DESC, e.id ASC
        """, (npi,))

    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_emails_summary() -> Dict[str, List[Dict[str, Any]]]:
    """
    Returns mapping { npi: [list_of_emails] } for all providers with emails found.
    Used by frontend to immediately render email badges on cards/table.
    """
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT e.npi, e.email, e.email_type, e.mx_valid, e.status, w.website
        FROM emails e
        LEFT JOIN websites w ON w.npi = e.npi
        ORDER BY e.mx_valid DESC
    """)

    rows = cur.fetchall()
    conn.close()

    summary: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        row_dict = dict(r)
        npi = row_dict["npi"]
        if npi not in summary:
            summary[npi] = []
        summary[npi].append(row_dict)

    return summary


def create_job(job_id: str, total: int):
    """Initializes job record in database."""
    conn = get_connection()
    cur = conn.cursor()
    now_str = datetime.utcnow().isoformat()

    if IS_POSTGRES:
        cur.execute("""
            INSERT INTO jobs (job_id, status, total, completed, found_emails, created_at, updated_at)
            VALUES (%s, 'running', %s, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """, (job_id, total))
    else:
        cur.execute("""
            INSERT INTO jobs (job_id, status, total, completed, found_emails, created_at, updated_at)
            VALUES (?, 'running', ?, 0, 0, ?, ?)
        """, (job_id, total, now_str, now_str))

    conn.commit()
    conn.close()


def update_job(job_id: str, completed: int, found_emails: int, status: str = "running"):
    """Updates progress of enrichment job."""
    conn = get_connection()
    cur = conn.cursor()
    now_str = datetime.utcnow().isoformat()

    if IS_POSTGRES:
        cur.execute("""
            UPDATE jobs
            SET completed = %s, found_emails = %s, status = %s, updated_at = CURRENT_TIMESTAMP
            WHERE job_id = %s
        """, (completed, found_emails, status, job_id))
    else:
        cur.execute("""
            UPDATE jobs
            SET completed = ?, found_emails = ?, status = ?, updated_at = ?
            WHERE job_id = ?
        """, (completed, found_emails, status, now_str, job_id))

    conn.commit()
    conn.close()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves job status."""
    conn = get_connection()
    cur = conn.cursor()

    if IS_POSTGRES:
        cur.execute("SELECT * FROM jobs WHERE job_id = %s", (job_id,))
    else:
        cur.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))

    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None