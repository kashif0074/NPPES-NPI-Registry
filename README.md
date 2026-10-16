# CMS NPPES NPI Registry - Live API Filtering & Complete Batch Studio

A modern, responsive, and standalone full-stack application for live filtering and real-time lookup across the official **Centers for Medicare & Medicaid Services (CMS) National Plan and Provider Enumeration System (NPPES) NPI Registry API** (Version 2.1).

> **Important:** This is an independent, standalone project completely separate from LeadLens.

---

## 🌟 Key Features

### 1. Complete Dataset Retrieval & Multi-Batch Fetching
- **Zero Omitted Records:** Overcomes API page limits by automatically batch-fetching matching records across consecutive API offsets (`skip = 0, 200, 400, 600, 800, 1000`) concurrently.
- **Deep Entity Partitioning:** For broad high-volume searches, automatically partitions queries across entity types (`NPI-1` and `NPI-2`) to retrieve up to **2,400+ unique matching records**.
- **Exact Total Counts:** Accurately calculates and prominently displays the actual number of matching records in the official CMS registry (e.g., **"Total Records Found: 1,200"**, **"Total Records Found: 131"**, **"Total Records Found: 12"**).
- **Clear Display Range:** Prominently highlights **Currently Displayed: 1 – 25 of X matching records**.

### 2. Live API Filtering Interface
- **Real-Time Live Search:** Automatically queries the CMS NPPES API as you type or change filters (with 450ms debouncing and `AbortController` cancellation to eliminate race conditions).
- **Auto-Filter Toggle:** Easily switch between automatic live filtering and manual "Fetch Matching Records" execution.
- **Accurate & Unmodified Data:** Queries the official live endpoint `https://npiregistry.cms.hhs.gov/api/?version=2.1` and displays exact provider data without alteration.
- **In-Page Quick Search:** Fast client-side keyword search across all retrieved records.
- **Dynamic Field Guidance:** Automatically adapts form sections based on selected entity type (Individual vs. Organization).
- **Active Filter Badges:** Interactive filter pills at the top of results with one-click removal.

### 3. Comprehensive Filter Fields
| Field Category | Frontend Field | Official CMS NPPES API Parameter | Notes |
| :--- | :--- | :--- | :--- |
| **Core** | NPI Number | `number` | Exact 10-digit unique National Provider Identifier |
| **Core** | NPI Type | `enumeration_type` | `NPI-1` (Individual), `NPI-2` (Organization), or omitted for Any |
| **Core** | Taxonomy Description | `taxonomy_description` | Specialty/taxonomy description (supports wildcards `*` after 2+ chars) |
| **Individual** | Provider First Name | `first_name` + `name_purpose=PROVIDER` | Individual provider first name |
| **Individual** | Provider Last Name | `last_name` + `name_purpose=PROVIDER` | Individual provider last name |
| **Organization**| Organization Name | `organization_name` | Legal Business Name, DBA, Former LBN, or Other Name |
| **Organization**| Authorized Official First Name | `first_name` + `name_purpose=AO` | Mapped to Authorized Official name |
| **Organization**| Authorized Official Last Name | `last_name` + `name_purpose=AO` | Mapped to Authorized Official name |
| **Location** | City | `city` | Practice location or mailing city |
| **Location** | State | `state` | 2-letter state code (All 50 states, DC, territories & military codes) |
| **Location** | Country | `country_code` | 2-letter ISO code (All 250 international countries & territories) |
| **Location** | Postal Code | `postal_code` | 5 or 9 digits, or wildcard (e.g. `9021*`) |
| **Location** | Address Type | `address_purpose` | `PRIMARY` (Primary Location), `SECONDARY` (Secondary Location), or Any |

### 4. Seamless Dataset Browsing & Export
- **Flexible Page Sizes:** Browse with `10 per page`, `25 per page`, `50 per page`, `100 per page`, or **`Show All (All Records)`**.
- **Pagination Controls:** First Page, Previous, Page number buttons (sliding window), Next, Last Page.
- **Full Data Export:** Download 100% of all matching records directly to **CSV** or **JSON** (not just a single page).

### 5. Interactive Provider Inspector
- Detailed modal displaying:
  - **Overview:** NPI, Status, Entity Type, Enumeration & Last Updated dates, Gender, Credentials, Sole Proprietor / Subpart indicators.
  - **Taxonomies & Licenses:** Primary and secondary specialties, Healthcare Provider Taxonomy Codes, State License Numbers, Taxonomy Groups.
  - **Addresses & Contact:** Primary practice location and mailing addresses, phone numbers, and fax.
  - **Raw API JSON:** Formatted, exact payload directly from CMS with a one-click "Copy JSON" button and direct link to the CMS Registry web viewer.

---

## 🏛️ Supported States & Territories (62 Total)
`Any`, Alabama (`AL`), Alaska (`AK`), American Samoa (`AS`), Arizona (`AZ`), Arkansas (`AR`), Armed Forces America (`AA`), Armed Forces Europe/Canada/Middle East/Africa (`AE`), Armed Forces Pacific (`AP`), California (`CA`), Colorado (`CO`), Connecticut (`CT`), Delaware (`DE`), District of Columbia (`DC`), Florida (`FL`), Georgia (`GA`), Guam (`GU`), Hawaii (`HI`), Idaho (`ID`), Illinois (`IL`), Indiana (`IN`), Iowa (`IA`), Kansas (`KS`), Kentucky (`KY`), Louisiana (`LA`), Maine (`ME`), Mariana Islands (Northern) (`MP`), Marshall Islands (`MH`), Maryland (`MD`), Massachusetts (`MA`), Michigan (`MI`), Micronesia (Federated States of) (`FM`), Minnesota (`MN`), Mississippi (`MS`), Missouri (`MO`), Montana (`MT`), Nebraska (`NE`), Nevada (`NV`), New Hampshire (`NH`), New Jersey (`NJ`), New Mexico (`NM`), New York (`NY`), North Carolina (`NC`), North Dakota (`ND`), Ohio (`OH`), Oklahoma (`OK`), Oregon (`OR`), Pennsylvania (`PA`), Puerto Rico (`PR`), Rhode Island (`RI`), South Carolina (`SC`), South Dakota (`SD`), Tennessee (`TN`), Texas (`TX`), Utah (`UT`), Vermont (`VT`), Virgin Islands (`VI`), Virginia (`VA`), Washington (`WA`), West Virginia (`WV`), Wisconsin (`WI`), Wyoming (`WY`).

## 🌍 Supported Countries & Territories (250 Total)
Includes `Any`, United States (`US`), Canada (`CA`), United Kingdom (`GB`), Australia (`AU`), France (`FR`), Germany (`DE`), India (`IN`), Pakistan (`PK`), Saudi Arabia (`SA`), United Arab Emirates (`AE`), China (`CN`), Brazil (`BR`), Bangladesh (`BD`), Afghanistan (`AF`), Albania (`AL`), and all other 234 ISO 3166-1 alpha-2 countries and international territories.

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- `pip`

### Installation
1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
python app.py
```

3. Open your browser:
Navigate to **`http://127.0.0.1:5000`**

---

## 📁 Project Directory Structure
```
c:\Users\LAPTOP\Desktop\data\
├── app.py                 # Flask server with multi-batch fetcher, caching, and export endpoints
├── constants.py           # Master lists for States, 250 Countries, Address Types, and Taxonomies
├── requirements.txt       # Dependencies (Flask, requests)
├── README.md              # Project documentation
│
├── static/
│   ├── css/
│   │   └── styles.css     # Clean clinical healthcare design system, metrics dashboard, responsive layout
│   └── js/
│       └── app.js         # Real-time multi-batch dataset controller, pagination, modal, exports
│
└── templates/
    └── index.html         # Filtering interface with Metrics Dashboard & Full Dataset View
```
