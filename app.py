"""
app.py - High-Performance Python Backend for NPPES NPI Registry Live Filtering & Provider Email Enrichment
Interacts directly with the official CMS NPPES Read API v2.1.
Implements multi-batch fetching to retrieve all matching records without pagination caps.
Integrates complete provider email and website discovery pipeline:
- Website Finder (NPPES endpoints, OpenStreetMap, Web Search)
- Targeted Web Crawler
- Mailto & Body Email Extractor
- DNS / MX Record Validator
- SQLite & PostgreSQL Storage
- Complete CSV Exporter
- Automated Scheduler
"""

import csv
import io
import json
import logging
import uuid
from typing import Any, Dict, List, Set, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from flask import Flask, jsonify, render_template, request, Response

from constants import (
    STATES,
    COUNTRIES,
    ADDRESS_TYPES,
    NPI_TYPES,
    POPULAR_TAXONOMIES,
)
from email_finder.database import (
    init_db,
    get_connection,
    get_provider_emails,
    get_all_emails_summary,
    create_job,
    update_job,
    get_job,
    save_email,
    save_website,
)
from email_finder.service import process_provider
from email_finder.exporter import generate_email_csv
from email_finder.search import SearchError
from email_finder.research import (
    research_provider,
    normalize_provider,
    extract_and_attribute_emails,
    is_safe_public_url,
)

# Set up logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("nppes_app")

# Initialize database schema upon server start
try:
    init_db()
    logger.info("Database initialized successfully.")
except Exception as e:
    logger.warning("Database initialization warning: %s", e)

app = Flask(__name__, static_folder="static", template_folder="templates")

# Official CMS NPPES API endpoint (Version 2.1)
CMS_NPPES_API_URL = "https://npiregistry.cms.hhs.gov/api/"
API_VERSION = "2.1"
REQUEST_TIMEOUT_SECONDS = 15
MAX_CMS_BATCH_SIZE = 200
CMS_SKIP_OFFSETS = [200, 400, 600, 800, 1000]

# Background worker executor for email discovery jobs
enrich_executor = ThreadPoolExecutor(max_workers=5)


def fetch_single_batch(params: Dict[str, Any], skip: int = 0) -> Tuple[int, List[Dict[str, Any]], Dict[str, Any]]:
    """Fetches a single batch from CMS API with specified skip offset."""
    batch_params = params.copy()
    batch_params["version"] = API_VERSION
    batch_params["limit"] = MAX_CMS_BATCH_SIZE
    batch_params["skip"] = skip

    try:
        resp = requests.get(
            CMS_NPPES_API_URL,
            params=batch_params,
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={"User-Agent": "NPPES-Registry-Studio/2.1 (Healthcare Data Integration)"}
        )
        data = resp.json()
        if "Errors" in data:
            return skip, [], data
        return skip, data.get("results", []), {}
    except Exception as exc:
        logger.warning("Error fetching batch skip=%s: %s", skip, exc)
        return skip, [], {"exception": str(exc)}


def fetch_all_matching_records(base_params: Dict[str, Any], deep_partition: bool = False) -> Dict[str, Any]:
    """
    Retrieves all available matching records through multi-batch fetching
    and optional entity partitioning to overcome API pagination caps.
    """
    seen_npis: Set[str] = set()
    all_results: List[Dict[str, Any]] = []
    total_batches = 0
    hit_cap = False

    # Check if we should partition across entity types (NPI-1 and NPI-2)
    query_variants: List[Dict[str, Any]] = []
    if deep_partition and "enumeration_type" not in base_params:
        for etype in ["NPI-1", "NPI-2"]:
            p = base_params.copy()
            p["enumeration_type"] = etype
            query_variants.append(p)
    else:
        query_variants.append(base_params.copy())

    for variant_params in query_variants:
        # 1. Fetch initial batch (skip = 0)
        skip0, first_batch, error_data = fetch_single_batch(variant_params, skip=0)
        total_batches += 1

        if error_data and "Errors" in error_data:
            return {
                "success": False,
                "errors": error_data["Errors"],
                "total_records_found": 0,
                "results": [],
                "batches_fetched": total_batches,
                "is_capped": False,
            }

        # Deduplicate and add first batch items
        for item in first_batch:
            npi = item.get("number")
            if npi and npi not in seen_npis:
                seen_npis.add(npi)
                all_results.append(item)

        # 2. If first batch returned full capacity (200 records), query remaining offsets in parallel
        if len(first_batch) == MAX_CMS_BATCH_SIZE:
            with ThreadPoolExecutor(max_workers=5) as executor:
                futures = [executor.submit(fetch_single_batch, variant_params, s) for s in CMS_SKIP_OFFSETS]
                for f in as_completed(futures):
                    total_batches += 1
                    skip_val, batch_items, err = f.result()
                    if len(batch_items) == MAX_CMS_BATCH_SIZE:
                        hit_cap = True
                    for item in batch_items:
                        npi = item.get("number")
                        if npi and npi not in seen_npis:
                            seen_npis.add(npi)
                            all_results.append(item)

    return {
        "success": True,
        "total_records_found": len(all_results),
        "results": all_results,
        "batches_fetched": total_batches,
        "is_capped": hit_cap,
    }


# ==========================================
# Application Routes
# ==========================================

@app.route("/")
def index():
    """Serves the main interactive filtering interface."""
    return render_template("index.html")


@app.route("/api/metadata", methods=["GET"])
def get_metadata():
    """Returns official configuration and lookup dictionaries."""
    return jsonify({
        "status": "success",
        "api_version": API_VERSION,
        "states": STATES,
        "countries": COUNTRIES,
        "address_types": ADDRESS_TYPES,
        "npi_types": NPI_TYPES,
        "popular_taxonomies": POPULAR_TAXONOMIES,
    })


@app.route("/api/search", methods=["GET"])
def search_npi():
    """
    Live API-based search endpoint with multi-batch fetching.
    Maps frontend filter fields to the official CMS NPPES v2.1 API parameters,
    batch-fetches all matching records, and returns the exact dataset.
    """
    number = request.args.get("number", "").strip()
    enumeration_type = request.args.get("enumeration_type", "").strip()
    taxonomy_description = request.args.get("taxonomy_description", "").strip()

    # Individual filters
    first_name = request.args.get("first_name", "").strip()
    last_name = request.args.get("last_name", "").strip()

    # Organization filters
    organization_name = request.args.get("organization_name", "").strip()
    authorized_official_first_name = request.args.get("authorized_official_first_name", "").strip()
    authorized_official_last_name = request.args.get("authorized_official_last_name", "").strip()

    # Location filters
    city = request.args.get("city", "").strip()
    state = request.args.get("state", "").strip().upper()
    country_code = request.args.get("country_code", "").strip().upper()
    postal_code = request.args.get("postal_code", "").strip()
    address_purpose = request.args.get("address_purpose", "").strip().upper()

    deep = request.args.get("deep", "false").lower() in ("true", "1", "yes")

    # Build CMS API Parameters dictionary
    api_params: Dict[str, Any] = {}

    if number:
        clean_number = "".join(c for c in number if c.isdigit())
        api_params["number"] = clean_number if clean_number else number

    if enumeration_type in ("NPI-1", "NPI-2"):
        api_params["enumeration_type"] = enumeration_type

    if taxonomy_description:
        api_params["taxonomy_description"] = taxonomy_description

    # Name mapping
    if enumeration_type == "NPI-2" and (authorized_official_first_name or authorized_official_last_name):
        api_params["name_purpose"] = "AO"
        if authorized_official_first_name:
            api_params["first_name"] = authorized_official_first_name
        if authorized_official_last_name:
            api_params["last_name"] = authorized_official_last_name
    elif authorized_official_first_name or authorized_official_last_name:
        api_params["name_purpose"] = "AO"
        if authorized_official_first_name:
            api_params["first_name"] = authorized_official_first_name
        if authorized_official_last_name:
            api_params["last_name"] = authorized_official_last_name
    else:
        if first_name:
            api_params["first_name"] = first_name
        if last_name:
            api_params["last_name"] = last_name
        if first_name or last_name:
            api_params["name_purpose"] = "PROVIDER"

    if organization_name:
        api_params["organization_name"] = organization_name

    if city:
        api_params["city"] = city
    if state:
        api_params["state"] = state
    if country_code:
        api_params["country_code"] = country_code
    if postal_code:
        api_params["postal_code"] = postal_code
    if address_purpose in ("PRIMARY", "SECONDARY", "LOCATION", "MAILING"):
        api_params["address_purpose"] = address_purpose

    # Check if any searchable criterion exists
    if not api_params:
        return jsonify({
            "success": True,
            "total_records_found": 0,
            "results": [],
            "message": "Please enter at least one search filter (e.g., NPI number, provider name, city & state, or taxonomy).",
            "query_params": api_params,
        })

    # Execute multi-batch fetch to retrieve all matching records
    logger.info("Executing multi-batch search with params: %s (deep=%s)", api_params, deep)
    fetch_result = fetch_all_matching_records(api_params, deep_partition=deep)

    if not fetch_result["success"]:
        error_list = fetch_result.get("errors", [])
        descriptions = [err.get("description", "Unknown API error") for err in error_list]
        return jsonify({
            "success": False,
            "errors": error_list,
            "error_message": "; ".join(descriptions),
            "total_records_found": 0,
            "results": [],
            "query_params": api_params,
        })

    return jsonify({
        "success": True,
        "total_records_found": fetch_result["total_records_found"],
        "results": fetch_result["results"],
        "batches_fetched": fetch_result["batches_fetched"],
        "is_capped": fetch_result["is_capped"],
        "query_params": api_params,
    })


@app.route("/api/export", methods=["GET"])
def export_results():
    """
    Exports all matching records retrieved from CMS API in CSV or JSON format.
    Ensures 100% of matching records are included in the export.
    """
    fmt = request.args.get("format", "csv").lower()
    search_response = search_npi()
    if isinstance(search_response, tuple):
        data = search_response[0].get_json()
    else:
        data = search_response.get_json()

    if not data or not data.get("success"):
        return jsonify(data), 400

    results = data.get("results", [])

    if fmt == "json":
        return Response(
            json.dumps(results, indent=2),
            mimetype="application/json",
            headers={"Content-Disposition": f"attachment; filename=npi_export_{len(results)}_records.json"}
        )

    # Generate CSV of all matching records
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "NPI",
        "Entity Type",
        "Provider Name / Organization",
        "Credential",
        "Primary Specialty",
        "Practice Address",
        "City",
        "State",
        "Postal Code",
        "Country",
        "Phone",
        "Last Updated"
    ])

    for item in results:
        basic = item.get("basic", {})
        enumeration_type = item.get("enumeration_type", "")
        npi = item.get("number", "")

        if enumeration_type == "NPI-1":
            name = f"{basic.get('first_name', '')} {basic.get('last_name', '')}".strip()
            entity_label = "Individual"
        else:
            name = basic.get("organization_name", "")
            entity_label = "Organization"

        credential = basic.get("credential", "")
        last_updated = basic.get("last_updated", "")

        # Find primary taxonomy
        primary_tax = ""
        for tax in item.get("taxonomies", []):
            if tax.get("primary"):
                primary_tax = tax.get("desc", tax.get("code", ""))
                break
        if not primary_tax and item.get("taxonomies"):
            primary_tax = item["taxonomies"][0].get("desc", "")

        # Find practice location address
        practice_addr = None
        for addr in item.get("addresses", []):
            if addr.get("address_purpose") == "LOCATION":
                practice_addr = addr
                break
        if not practice_addr and item.get("addresses"):
            practice_addr = item["addresses"][0]

        addr_line = practice_addr.get("address_1", "") if practice_addr else ""
        city = practice_addr.get("city", "") if practice_addr else ""
        state = practice_addr.get("state", "") if practice_addr else ""
        postal = practice_addr.get("postal_code", "") if practice_addr else ""
        country = practice_addr.get("country_name", practice_addr.get("country_code", "")) if practice_addr else ""
        phone = practice_addr.get("telephone_number", "") if practice_addr else ""

        writer.writerow([
            npi,
            entity_label,
            name,
            credential,
            primary_tax,
            addr_line,
            city,
            state,
            postal,
            country,
            phone,
            last_updated
        ])

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=npi_export_{len(results)}_records.csv"}
    )


# ==========================================
# Email & Website Enrichment API Endpoints
# ==========================================

@app.route("/api/enrich", methods=["POST"])
def enrich_providers():
    """
    Asynchronously enriches selected or retrieved providers:
    1. Finds official website
    2. Crawls contact & team pages
    3. Extracts public emails
    4. Validates syntax and live DNS/MX records
    5. Saves results in database
    """
    data = request.get_json() or {}
    records = data.get("records", [])

    if not records:
        return jsonify({"success": False, "error": "No provider records selected for enrichment."}), 400

    job_id = str(uuid.uuid4())
    create_job(job_id=job_id, total=len(records))

    def background_worker(recs: List[Dict[str, Any]], j_id: str):
        completed = 0
        found_emails = 0
        for rec in recs:
            try:
                emails_found = process_provider(rec)
                found_emails += emails_found
            except Exception as exc:
                logger.error("Error enriching provider in background: %s", exc)
            completed += 1
            update_job(job_id=j_id, completed=completed, found_emails=found_emails, status="running")

        update_job(job_id=j_id, completed=completed, found_emails=found_emails, status="completed")
        logger.info("Enrichment job %s completed. Total processed: %d, Emails found: %d", j_id, completed, found_emails)

    enrich_executor.submit(background_worker, records, job_id)

    return jsonify({
        "success": True,
        "job_id": job_id,
        "total": len(records),
        "status": "running",
        "message": f"Started email discovery and validation for {len(records)} provider(s)."
    })


@app.route("/api/enrich/status/<job_id>", methods=["GET"])
def enrich_status(job_id):
    """Returns real-time progress of an email enrichment job."""
    job = get_job(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404

    total = job.get("total", 0)
    completed = job.get("completed", 0)
    percent = round((completed / total * 100), 1) if total > 0 else 0

    return jsonify({
        "success": True,
        "job_id": job["job_id"],
        "status": job["status"],
        "total": total,
        "completed": completed,
        "found_emails": job.get("found_emails", 0),
        "percent": percent,
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at")
    })


@app.route("/api/emails/<npi>", methods=["GET"])
def get_emails(npi):
    """Returns all discovered and verified emails for a specific provider NPI."""
    rows = get_provider_emails(npi)
    return jsonify({
        "success": True,
        "npi": npi,
        "total_emails": len(rows),
        "emails": rows
    })


@app.route("/api/emails/summary", methods=["GET"])
def get_emails_summary():
    """
    Returns map of all providers with found emails.
    Used by frontend to render email badges instantly on cards and table.
    """
    summary = get_all_emails_summary()
    return jsonify({
        "success": True,
        "summary": summary
    })


@app.route("/api/export-emails", methods=["GET"])
def export_emails():
    """Exports enriched dataset (providers, websites, verified emails) to CSV."""
    only_with_emails = request.args.get("only_with_emails", "false").lower() in ("true", "1", "yes")
    csv_content = generate_email_csv(only_with_emails=only_with_emails)

    return Response(
        csv_content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=nppes_provider_emails.csv"}
    )


@app.post("/api/email-research")
def email_research():
    """
    Multi-stage provider email research using live search engines (Tavily default, Google optional).
    Stages:
      1. 'provider': Direct provider name + location + specialty query
      2. 'organization': Associated hospital/clinic query with optional domain filtering
      3. 'official_website': Official provider website and contact query
    """
    body = request.get_json(silent=True) or {}
    record = body.get("record")
    domains = body.get("domains") or []

    if not isinstance(record, dict):
        return jsonify({"error": "A provider record is required"}), 400

    if (
        not isinstance(domains, list)
        or len(domains) > 5
        or not all(isinstance(domain, str) for domain in domains)
    ):
        return jsonify({"error": "Invalid domains"}), 400

    stage = body.get("stage", "provider")
    organization = body.get("organization", "").strip()
    provider_engine = body.get("provider")  # 'tavily' or 'google'

    try:
        result = research_provider(
            record=record,
            stage=stage,
            organization=organization,
            domains=domains,
            provider=provider_engine,
        )
        return jsonify(result)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except SearchError as error:
        return jsonify({
            "status": "Search Incomplete",
            "error": str(error),
        }), 502


@app.post("/api/email-extract-source")
def email_extract_source():
    """
    Extracts, validates, and attributes emails from a confirmed public source URL.
    Applies SSRF safeguards and updates provider database.
    """
    body = request.get_json(silent=True) or {}
    url = body.get("url", "").strip()
    record = body.get("record") or {}

    if not url or not is_safe_public_url(url):
        return jsonify({"error": "Invalid or disallowed source URL."}), 400

    provider_info = normalize_provider(record)
    candidates = extract_and_attribute_emails(url, provider_info)

    npi = provider_info.get("npi")
    if npi:
        # Save official website if applicable
        save_website(npi, url, "search_source")
        for c in candidates:
            save_email(
                npi=npi,
                email=c["email"],
                email_type=c["email_type"],
                source_url=url,
                mx_valid=c["mx_valid"],
                status=c["attribution_status"]
            )

    return jsonify({
        "success": True,
        "url": url,
        "npi": npi,
        "total_candidates": len(candidates),
        "candidates": candidates
    })


if __name__ == "__main__":
    logger.info("Starting NPPES NPI Registry & Email Enrichment Server on http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)