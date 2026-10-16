/**
 * app.js - CMS NPPES NPI Registry Live Filtering & Complete Dataset Client
 * Retrieves all matching records via backend multi-batch fetching, displays exact
 * total matching counts, and provides seamless full-dataset pagination and inspection.
 */

(function () {
    "use strict";

    // Application State
    const state = {
        allRecords: [],             // All records retrieved across all API batches
        filteredRecords: [],        // Records after in-page quick filter
        totalRecordsFound: 0,       // Total matching count from CMS
        currentPage: 1,
        pageSize: 25,               // Default 25 per page (or 10, 50, 100, 'all')
        currentView: "cards",       // 'cards' | 'table'
        isLiveFiltering: true,
        activeRequestController: null,
        debounceTimer: null,
        metadata: null,
        selectedProvider: null,
        isDeepPartition: false,
    };

    // DOM Elements
    const elements = {
        filterForm: document.getElementById("filterForm"),
        executeSearchBtn: document.getElementById("executeSearchBtn"),
        clearAllFiltersBtn: document.getElementById("clearAllFiltersBtn"),
        liveSearchToggle: document.getElementById("liveSearchToggle"),
        apiStatusBadge: document.getElementById("apiStatusBadge"),

        // Filter Inputs
        npiNumber: document.getElementById("filterNpiNumber"),
        npiTypeGroup: document.getElementById("npiTypeGroup"),
        taxonomy: document.getElementById("filterTaxonomy"),
        taxonomyDatalist: document.getElementById("taxonomyDatalist"),
        firstName: document.getElementById("filterFirstName"),
        lastName: document.getElementById("filterLastName"),
        orgName: document.getElementById("filterOrgName"),
        aoFirstName: document.getElementById("filterAoFirstName"),
        aoLastName: document.getElementById("filterAoLastName"),
        city: document.getElementById("filterCity"),
        stateSelect: document.getElementById("filterState"),
        countrySelect: document.getElementById("filterCountry"),
        postalCode: document.getElementById("filterPostalCode"),
        addressType: document.getElementById("filterAddressType"),

        // Section wrappers
        individualSection: document.getElementById("individualSection"),
        organizationSection: document.getElementById("organizationSection"),

        // Metrics Dashboard
        metricsDashboard: document.getElementById("metricsDashboard"),
        metricTotalFound: document.getElementById("metricTotalFound"),
        metricBatchStatus: document.getElementById("metricBatchStatus"),
        metricCurrentlyDisplayed: document.getElementById("metricCurrentlyDisplayed"),
        metricPageInfo: document.getElementById("metricPageInfo"),
        metricApiStatus: document.getElementById("metricApiStatus"),
        metricBatchesFetched: document.getElementById("metricBatchesFetched"),

        // Deep Partition Banner
        deepPartitionBanner: document.getElementById("deepPartitionBanner"),
        deepFetchBtn: document.getElementById("deepFetchBtn"),

        // Quick Filter
        quickFilterInput: document.getElementById("quickFilterInput"),

        // Results & States
        resultCountHeader: document.getElementById("resultCountHeader"),
        resultCountSub: document.getElementById("resultCountSub"),
        activeFilterBar: document.getElementById("activeFilterBar"),
        filterTagList: document.getElementById("filterTagList"),
        errorAlertBox: document.getElementById("errorAlertBox"),
        alertTitle: document.getElementById("alertTitle"),
        alertMessage: document.getElementById("alertMessage"),

        initialState: document.getElementById("initialState"),
        loadingState: document.getElementById("loadingState"),
        loadingProgressText: document.getElementById("loadingProgressText"),
        noResultsState: document.getElementById("noResultsState"),
        cardsGrid: document.getElementById("cardsGrid"),
        tableContainer: document.getElementById("tableContainer"),
        tableBody: document.getElementById("tableBody"),

        // Toolbar
        viewCardsBtn: document.getElementById("viewCardsBtn"),
        viewTableBtn: document.getElementById("viewTableBtn"),
        pageSizeSelect: document.getElementById("pageSizeSelect"),
        exportCsvBtn: document.getElementById("exportCsvBtn"),
        exportJsonBtn: document.getElementById("exportJsonBtn"),

        // Pagination
        paginationFooter: document.getElementById("paginationFooter"),
        paginationInfo: document.getElementById("paginationInfo"),
        pageNumbers: document.getElementById("pageNumbers"),
        firstPageBtn: document.getElementById("firstPageBtn"),
        prevPageBtn: document.getElementById("prevPageBtn"),
        nextPageBtn: document.getElementById("nextPageBtn"),
        lastPageBtn: document.getElementById("lastPageBtn"),

        // Modal
        providerModalBackdrop: document.getElementById("providerModalBackdrop"),
        closeModalBtn: document.getElementById("closeModalBtn"),
        modalCloseActionBtn: document.getElementById("modalCloseActionBtn"),
        modalProviderTitle: document.getElementById("modalProviderTitle"),
        modalNpiTag: document.getElementById("modalNpiTag"),
        modalEntityTypeBadge: document.getElementById("modalEntityTypeBadge"),
        modalOverviewGrid: document.getElementById("modalOverviewGrid"),
        modalTaxonomiesList: document.getElementById("modalTaxonomiesList"),
        modalAddressesList: document.getElementById("modalAddressesList"),
        modalRawJsonCode: document.getElementById("modalRawJsonCode"),
        copyRawJsonBtn: document.getElementById("copyRawJsonBtn"),
        modalExternalLink: document.getElementById("modalExternalLink"),
    };

    // Initialize application
    async function init() {
        bindEvents();
        await loadMetadata();
    }

    // Load backend metadata (States, Countries, Taxonomies)
    async function loadMetadata() {
        try {
            const resp = await fetch("/api/metadata");
            const data = await resp.json();
            state.metadata = data;

            // Populate States dropdown
            elements.stateSelect.innerHTML = "";
            data.states.forEach(st => {
                const opt = document.createElement("option");
                opt.value = st.code;
                opt.textContent = st.code ? `${st.name} (${st.code})` : st.name;
                elements.stateSelect.appendChild(opt);
            });

            // Populate Countries dropdown
            elements.countrySelect.innerHTML = "";
            data.countries.forEach(ct => {
                const opt = document.createElement("option");
                opt.value = ct.code;
                opt.textContent = ct.code ? `${ct.name} (${ct.code})` : ct.name;
                elements.countrySelect.appendChild(opt);
            });

            // Populate Taxonomy datalist suggestions
            elements.taxonomyDatalist.innerHTML = "";
            data.popular_taxonomies.forEach(tax => {
                const opt = document.createElement("option");
                opt.value = tax;
                elements.taxonomyDatalist.appendChild(opt);
            });

        } catch (err) {
            console.error("Failed to load metadata:", err);
        }
    }

    // Bind event listeners
    function bindEvents() {
        // Live auto-filter toggle (if present)
        if (elements.liveSearchToggle) {
            elements.liveSearchToggle.addEventListener("change", (e) => {
                state.isLiveFiltering = e.target.checked;
            });
        }

        // Search button
        elements.executeSearchBtn.addEventListener("click", () => {
            state.isDeepPartition = false;
            fetchResults();
        });

        // Deep fetch button
        elements.deepFetchBtn.addEventListener("click", () => {
            state.isDeepPartition = true;
            fetchResults();
        });

        // Clear all filters
        elements.clearAllFiltersBtn.addEventListener("click", resetAllFilters);

        // Input listeners for text inputs (Debounced for real-time live filtering)
        const textInputs = [
            elements.npiNumber,
            elements.taxonomy,
            elements.firstName,
            elements.lastName,
            elements.orgName,
            elements.aoFirstName,
            elements.aoLastName,
            elements.city,
            elements.postalCode
        ];

        textInputs.forEach(input => {
            input.addEventListener("input", () => {
                if (state.isLiveFiltering) {
                    state.isDeepPartition = false;
                    debounceSearch();
                }
            });
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    state.isDeepPartition = false;
                    fetchResults();
                }
            });
        });

        // Select & Radio listeners (Immediate live filtering)
        [elements.stateSelect, elements.countrySelect, elements.addressType].forEach(select => {
            select.addEventListener("change", () => {
                if (state.isLiveFiltering) {
                    state.isDeepPartition = false;
                    fetchResults();
                }
            });
        });

        // NPI Type radio group
        const typeRadios = elements.npiTypeGroup.querySelectorAll('input[type="radio"]');
        typeRadios.forEach(radio => {
            radio.addEventListener("change", (e) => {
                updateFormSectionStates(e.target.value);
                if (state.isLiveFiltering) {
                    state.isDeepPartition = false;
                    fetchResults();
                }
            });
        });

        // Quick In-Page Filter inside retrieved records
        elements.quickFilterInput.addEventListener("input", (e) => {
            applyInPageQuickFilter(e.target.value);
        });

        // View toggle (Cards vs Table)
        elements.viewCardsBtn.addEventListener("click", () => setView("cards"));
        elements.viewTableBtn.addEventListener("click", () => setView("table"));

        // Page size selector
        elements.pageSizeSelect.addEventListener("change", (e) => {
            state.pageSize = e.target.value === "all" ? "all" : parseInt(e.target.value, 10);
            state.currentPage = 1;
            renderCurrentPage();
        });

        // Pagination buttons
        elements.firstPageBtn.addEventListener("click", () => {
            if (state.currentPage !== 1) {
                state.currentPage = 1;
                renderCurrentPage();
            }
        });

        elements.prevPageBtn.addEventListener("click", () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                renderCurrentPage();
            }
        });

        elements.nextPageBtn.addEventListener("click", () => {
            const maxPages = getTotalPages();
            if (state.currentPage < maxPages) {
                state.currentPage++;
                renderCurrentPage();
            }
        });

        elements.lastPageBtn.addEventListener("click", () => {
            const maxPages = getTotalPages();
            if (state.currentPage !== maxPages) {
                state.currentPage = maxPages;
                renderCurrentPage();
            }
        });

        // Quick Presets
        document.querySelectorAll(".preset-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                applyPreset(chip.getAttribute("data-preset"));
            });
        });

        // Exports
        elements.exportCsvBtn.addEventListener("click", () => triggerExport("csv"));
        elements.exportJsonBtn.addEventListener("click", () => triggerExport("json"));

        // Modal Close handlers
        elements.closeModalBtn.addEventListener("click", closeModal);
        elements.modalCloseActionBtn.addEventListener("click", closeModal);
        elements.providerModalBackdrop.addEventListener("click", (e) => {
            if (e.target === elements.providerModalBackdrop) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeModal();
        });

        // Modal Tabs
        document.querySelectorAll(".modal-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
                document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
                tab.classList.add("active");
                const targetId = tab.getAttribute("data-tab");
                const pane = document.getElementById(targetId);
                if (pane) pane.classList.add("active");
            });
        });

        // Copy Raw JSON
        elements.copyRawJsonBtn.addEventListener("click", copyRawJson);
    }

    // Debounce wrapper
    function debounceSearch() {
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(() => {
            fetchResults();
        }, 450);
    }

    // Update section UI based on NPI Type
    function updateFormSectionStates(typeVal) {
        if (typeVal === "NPI-1") {
            elements.individualSection.style.opacity = "1";
            elements.organizationSection.style.opacity = "0.45";
        } else if (typeVal === "NPI-2") {
            elements.individualSection.style.opacity = "0.45";
            elements.organizationSection.style.opacity = "1";
        } else {
            elements.individualSection.style.opacity = "1";
            elements.organizationSection.style.opacity = "1";
        }
    }

    // Gather active form parameters
    function getFilterParams() {
        const formData = new FormData(elements.filterForm);
        const params = new URLSearchParams();

        for (const [key, val] of formData.entries()) {
            const trimmed = val.trim();
            if (trimmed) {
                params.set(key, trimmed);
            }
        }

        if (state.isDeepPartition) {
            params.set("deep", "true");
        }

        return params;
    }

    // Fetch all matching results from CMS NPPES API via Multi-Batch Fetching
    async function fetchResults() {
        if (state.activeRequestController) {
            state.activeRequestController.abort();
        }
        state.activeRequestController = new AbortController();

        const params = getFilterParams();
        const searchKeys = Array.from(params.keys()).filter(k => k !== "deep");
        renderActiveFilterBadges(params);

        if (searchKeys.length === 0) {
            hideAlert();
            showState("initial");
            elements.metricsDashboard.style.display = "none";
            elements.deepPartitionBanner.style.display = "none";
            elements.resultCountHeader.textContent = "CMS Registry Results";
            elements.resultCountSub.textContent = "Enter filters to query the NPPES database in real time.";
            elements.paginationFooter.style.display = "none";
            state.allRecords = [];
            state.filteredRecords = [];
            state.totalRecordsFound = 0;
            return;
        }

        // Show loading state with multi-batch status
        showState("loading");
        hideAlert();
        elements.executeSearchBtn.disabled = true;
        elements.loadingProgressText.textContent = state.isDeepPartition
            ? "Executing deep entity partitioning across CMS NPPES API batches..."
            : "Querying CMS NPPES API & batch-fetching all matching records...";

        try {
            const response = await fetch(`/api/search?${params.toString()}`, {
                signal: state.activeRequestController.signal
            });

            const data = await response.json();
            elements.executeSearchBtn.disabled = false;

            // Handle API errors / Notice responses
            if (!data.success) {
                const message = data.error_message || (data.errors && data.errors.map(e => e.description).join("; ")) || "Invalid search query";
                showAlert("CMS API Notice", message);
                showState("noResults");
                elements.metricsDashboard.style.display = "none";
                elements.deepPartitionBanner.style.display = "none";
                elements.resultCountHeader.textContent = "0 Providers Found";
                elements.resultCountSub.textContent = "Please adjust your search criteria according to CMS requirements.";
                elements.paginationFooter.style.display = "none";
                state.allRecords = [];
                state.filteredRecords = [];
                state.totalRecordsFound = 0;
                return;
            }

            // Results returned
            state.totalRecordsFound = data.total_records_found || 0;
            state.allRecords = data.results || [];
            state.filteredRecords = state.allRecords;
            state.currentPage = 1;
            elements.quickFilterInput.value = "";

            if (state.totalRecordsFound === 0 || state.allRecords.length === 0) {
                showState("noResults");
                elements.metricsDashboard.style.display = "none";
                elements.deepPartitionBanner.style.display = "none";
                elements.resultCountHeader.textContent = "0 Providers Found";
                elements.resultCountSub.textContent = "No matching providers registered in CMS NPPES for these criteria.";
                elements.paginationFooter.style.display = "none";
                return;
            }

            // Update Metrics Dashboard
            elements.metricTotalFound.textContent = state.totalRecordsFound.toLocaleString();
            elements.metricBatchStatus.textContent = "Official CMS NPPES Registry";
            elements.metricBatchesFetched.textContent = `${data.batches_fetched} API batch(es) fetched`;
            elements.metricApiStatus.textContent = "100% Retrieved";
            elements.metricsDashboard.style.display = "grid";

            // Show deep partition banner if single query reached ceiling and deep wasn't run yet
            if (data.is_capped && !state.isDeepPartition) {
                elements.deepPartitionBanner.style.display = "flex";
            } else {
                elements.deepPartitionBanner.style.display = "none";
            }

            // Render current page
            renderCurrentPage();
            showState(state.currentView === "cards" ? "cards" : "table");

        } catch (err) {
            if (err.name === "AbortError") {
                return;
            }
            elements.executeSearchBtn.disabled = false;
            console.error("Search request failed:", err);
            showAlert("Connection Error", "Could not complete the query to the official API. Please verify your connection.");
            showState("noResults");
            elements.metricsDashboard.style.display = "none";
            elements.deepPartitionBanner.style.display = "none";
        }
    }

    // Filter in-memory results using quick search
    function applyInPageQuickFilter(query) {
        const q = (query || "").trim().toLowerCase();
        if (!q) {
            state.filteredRecords = state.allRecords;
        } else {
            state.filteredRecords = state.allRecords.filter(item => {
                const basic = item.basic || {};
                const name = `${basic.first_name || ''} ${basic.last_name || ''} ${basic.organization_name || ''}`.toLowerCase();
                const npi = String(item.number || '');
                const cityState = (item.addresses || []).map(a => `${a.city || ''} ${a.state || ''} ${a.postal_code || ''}`).join(' ').toLowerCase();
                const taxonomies = (item.taxonomies || []).map(t => `${t.code || ''} ${t.desc || ''}`).join(' ').toLowerCase();

                return name.includes(q) || npi.includes(q) || cityState.includes(q) || taxonomies.includes(q);
            });
        }
        state.currentPage = 1;
        renderCurrentPage();
    }

    // Calculate total pages for current filtered records
    function getTotalPages() {
        if (state.pageSize === "all") return 1;
        return Math.max(1, Math.ceil(state.filteredRecords.length / state.pageSize));
    }

    // Render the current page slice of records
    function renderCurrentPage() {
        const total = state.filteredRecords.length;
        const totalPages = getTotalPages();

        if (state.currentPage > totalPages) {
            state.currentPage = totalPages;
        }

        let start = 0;
        let end = total;
        let pageSlice = [];

        if (state.pageSize === "all") {
            start = 0;
            end = total;
            pageSlice = state.filteredRecords;
        } else {
            start = (state.currentPage - 1) * state.pageSize;
            end = Math.min(start + state.pageSize, total);
            pageSlice = state.filteredRecords.slice(start, end);
        }

        const displayStart = total === 0 ? 0 : start + 1;
        const displayEnd = end;

        // Update Headers & Summaries
        elements.resultCountHeader.textContent = `Total Records Found: ${state.totalRecordsFound.toLocaleString()}`;
        elements.resultCountSub.textContent = `Displaying records ${displayStart} – ${displayEnd} of ${state.totalRecordsFound.toLocaleString()} total matching records in CMS NPPES Registry`;

        elements.metricCurrentlyDisplayed.textContent = `${displayStart} – ${displayEnd}`;
        elements.metricPageInfo.textContent = `Page ${state.currentPage} of ${totalPages} (${state.pageSize === 'all' ? 'All Records' : `${state.pageSize}/page`})`;

        elements.paginationInfo.textContent = `Showing ${displayStart} – ${displayEnd} of ${total.toLocaleString()} matching records (Total Found: ${state.totalRecordsFound.toLocaleString()})`;

        // Render Views
        renderCards(pageSlice);
        renderTable(pageSlice);
        renderPaginationControls(totalPages);
    }

    // Render Cards View
    function renderCards(records) {
        elements.cardsGrid.innerHTML = "";

        records.forEach(item => {
            const card = document.createElement("div");
            card.className = "provider-card";

            const basic = item.basic || {};
            const isOrg = item.enumeration_type === "NPI-2";
            const entityType = isOrg ? "Organization" : "Individual";
            const badgeClass = isOrg ? "org" : "ind";

            const name = isOrg
                ? (basic.organization_name || "Unknown Organization")
                : `${basic.name_prefix || ''} ${basic.first_name || ''} ${basic.last_name || ''} ${basic.name_suffix || ''}`.trim() || "Unknown Provider";

            const credential = basic.credential ? basic.credential : "";

            let primaryTax = "";
            let primaryTaxCode = "";
            (item.taxonomies || []).forEach(t => {
                if (t.primary) {
                    primaryTax = t.desc || "";
                    primaryTaxCode = t.code || "";
                }
            });
            if (!primaryTax && item.taxonomies && item.taxonomies.length > 0) {
                primaryTax = item.taxonomies[0].desc || "";
                primaryTaxCode = item.taxonomies[0].code || "";
            }

            let practiceAddr = null;
            (item.addresses || []).forEach(addr => {
                if (addr.address_purpose === "LOCATION") practiceAddr = addr;
            });
            if (!practiceAddr && item.addresses && item.addresses.length > 0) {
                practiceAddr = item.addresses[0];
            }

            const addrStreet = practiceAddr ? (practiceAddr.address_1 || "") : "No street provided";
            const addrCityState = practiceAddr ? `${practiceAddr.city || ''}, ${practiceAddr.state || ''} ${practiceAddr.postal_code || ''}`.trim() : "";
            const phone = practiceAddr ? (practiceAddr.telephone_number || "Not listed") : "Not listed";

            card.innerHTML = `
                <div>
                    <div class="card-header">
                        <div class="card-title-group">
                            <h4>${escapeHtml(name)}</h4>
                            ${credential ? `<div class="card-credentials">${escapeHtml(credential)}</div>` : ''}
                        </div>
                        <div class="badges-stack">
                            <span class="badge ${badgeClass}">${entityType}</span>
                            ${basic.status === 'A' ? '<span class="badge active">Active</span>' : ''}
                        </div>
                    </div>

                    ${primaryTax ? `
                    <div class="card-taxonomy">
                        <div class="taxonomy-label">Primary Specialty (${escapeHtml(primaryTaxCode)})</div>
                        <div class="taxonomy-desc">${escapeHtml(primaryTax)}</div>
                    </div>
                    ` : ''}

                    <div class="card-details-grid">
                        <div class="detail-item">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                                <circle cx="12" cy="10" r="3"/>
                            </svg>
                            <span class="detail-value">${escapeHtml(addrStreet)}, ${escapeHtml(addrCityState)}</span>
                        </div>
                        <div class="detail-item">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                            </svg>
                            <span class="detail-value">${escapeHtml(phone)}</span>
                        </div>
                    </div>
                </div>

                <div class="card-footer">
                    <span class="npi-badge">NPI: ${escapeHtml(item.number)}</span>
                    <button type="button" class="btn-card-inspect" data-npi="${escapeHtml(item.number)}">
                        <span>View Full Record</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>
                </div>
            `;

            card.querySelector(".btn-card-inspect").addEventListener("click", () => {
                openProviderModal(item);
            });

            elements.cardsGrid.appendChild(card);
        });
    }

    // Render Table View
    function renderTable(records) {
        elements.tableBody.innerHTML = "";

        records.forEach(item => {
            const tr = document.createElement("tr");

            const basic = item.basic || {};
            const isOrg = item.enumeration_type === "NPI-2";
            const entityType = isOrg ? "Org" : "Ind";
            const badgeClass = isOrg ? "org" : "ind";

            const name = isOrg
                ? (basic.organization_name || "Unknown Organization")
                : `${basic.first_name || ''} ${basic.last_name || ''}`.trim() || "Unknown Provider";

            const credential = basic.credential ? ` (${basic.credential})` : "";

            let primaryTax = "";
            (item.taxonomies || []).forEach(t => {
                if (t.primary) primaryTax = t.desc || "";
            });
            if (!primaryTax && item.taxonomies && item.taxonomies.length > 0) {
                primaryTax = item.taxonomies[0].desc || "";
            }

            let practiceAddr = null;
            (item.addresses || []).forEach(addr => {
                if (addr.address_purpose === "LOCATION") practiceAddr = addr;
            });
            if (!practiceAddr && item.addresses && item.addresses.length > 0) {
                practiceAddr = item.addresses[0];
            }

            const cityState = practiceAddr ? `${practiceAddr.city || ''}, ${practiceAddr.state || ''}` : "N/A";
            const phone = practiceAddr ? (practiceAddr.telephone_number || "—") : "—";

            tr.innerHTML = `
                <td>
                    <div class="table-npi-cell">
                        <span class="table-npi-num">${escapeHtml(item.number)}</span>
                        <span class="badge ${badgeClass}">${entityType}</span>
                    </div>
                </td>
                <td>
                    <div class="table-name">${escapeHtml(name)}${escapeHtml(credential)}</div>
                    ${isOrg && basic.authorized_official_first_name ? `<div class="table-sub">AO: ${escapeHtml(basic.authorized_official_first_name)} ${escapeHtml(basic.authorized_official_last_name || '')}</div>` : ''}
                </td>
                <td>
                    <div class="table-name">${escapeHtml(primaryTax || '—')}</div>
                </td>
                <td>${escapeHtml(cityState)}</td>
                <td>${escapeHtml(phone)}</td>
                <td>
                    <button type="button" class="btn-secondary" data-npi="${escapeHtml(item.number)}">
                        Inspect
                    </button>
                </td>
            `;

            tr.querySelector("button").addEventListener("click", () => {
                openProviderModal(item);
            });

            elements.tableBody.appendChild(tr);
        });
    }

    // Render Pagination Controls
    function renderPaginationControls(totalPages) {
        if (totalPages <= 1 || state.pageSize === "all") {
            elements.paginationFooter.style.display = totalPages > 0 ? "flex" : "none";
            elements.pageNumbers.innerHTML = "";
            elements.firstPageBtn.disabled = true;
            elements.prevPageBtn.disabled = true;
            elements.nextPageBtn.disabled = true;
            elements.lastPageBtn.disabled = true;
            return;
        }

        elements.paginationFooter.style.display = "flex";

        elements.firstPageBtn.disabled = state.currentPage === 1;
        elements.prevPageBtn.disabled = state.currentPage === 1;
        elements.nextPageBtn.disabled = state.currentPage >= totalPages;
        elements.lastPageBtn.disabled = state.currentPage >= totalPages;

        // Render page buttons (sliding window of 5 pages)
        elements.pageNumbers.innerHTML = "";
        const maxVisibleButtons = 5;
        let startPage = Math.max(1, state.currentPage - Math.floor(maxVisibleButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxVisibleButtons - 1);

        if (endPage - startPage + 1 < maxVisibleButtons) {
            startPage = Math.max(1, endPage - maxVisibleButtons + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement("button");
            pageBtn.type = "button";
            pageBtn.className = `page-num-btn ${i === state.currentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.addEventListener("click", () => {
                state.currentPage = i;
                renderCurrentPage();
            });
            elements.pageNumbers.appendChild(pageBtn);
        }
    }

    // Render Active Filter Pills
    function renderActiveFilterBadges(params) {
        elements.filterTagList.innerHTML = "";
        const activeEntries = [];

        const labelMap = {
            number: "NPI",
            enumeration_type: "Type",
            taxonomy_description: "Taxonomy",
            first_name: "First Name",
            last_name: "Last Name",
            organization_name: "Org Name",
            authorized_official_first_name: "AO First Name",
            authorized_official_last_name: "AO Last Name",
            city: "City",
            state: "State",
            country_code: "Country",
            postal_code: "Postal Code",
            address_purpose: "Address Type"
        };

        for (const [key, val] of params.entries()) {
            if (["limit", "skip", "deep"].includes(key) || !val) continue;

            let displayVal = val;
            if (key === "enumeration_type") {
                displayVal = val === "NPI-1" ? "Individual" : "Organization";
            } else if (key === "state" && state.metadata) {
                const s = state.metadata.states.find(x => x.code === val);
                if (s) displayVal = s.name;
            } else if (key === "country_code" && state.metadata) {
                const c = state.metadata.countries.find(x => x.code === val);
                if (c) displayVal = c.name;
            } else if (key === "address_purpose") {
                displayVal = val === "PRIMARY" ? "Primary Location" : "Secondary Location";
            }

            activeEntries.push({ key, label: labelMap[key] || key, value: displayVal });
        }

        if (activeEntries.length === 0) {
            elements.activeFilterBar.style.display = "none";
            return;
        }

        elements.activeFilterBar.style.display = "flex";

        activeEntries.forEach(entry => {
            const tag = document.createElement("span");
            tag.className = "filter-tag";
            tag.innerHTML = `
                <span>${escapeHtml(entry.label)}: <strong>${escapeHtml(entry.value)}</strong></span>
                <span class="filter-tag-remove" title="Remove filter">&times;</span>
            `;

            tag.querySelector(".filter-tag-remove").addEventListener("click", () => {
                removeIndividualFilter(entry.key);
            });

            elements.filterTagList.appendChild(tag);
        });
    }

    // Remove single filter
    function removeIndividualFilter(key) {
        if (key === "enumeration_type") {
            const radio = elements.npiTypeGroup.querySelector('input[value=""]');
            if (radio) radio.checked = true;
            updateFormSectionStates("");
        } else {
            const input = elements.filterForm.elements[key];
            if (input) input.value = "";
        }
        state.isDeepPartition = false;
        fetchResults();
    }

    // Open detailed Provider Inspector Modal
    function openProviderModal(item) {
        state.selectedProvider = item;
        const basic = item.basic || {};
        const isOrg = item.enumeration_type === "NPI-2";

        elements.modalNpiTag.textContent = `NPI: ${item.number}`;
        elements.modalEntityTypeBadge.textContent = isOrg ? "Type 2: Organization" : "Type 1: Individual";
        elements.modalEntityTypeBadge.className = `badge ${isOrg ? 'org' : 'ind'}`;

        const name = isOrg
            ? (basic.organization_name || "Unknown Organization")
            : `${basic.name_prefix || ''} ${basic.first_name || ''} ${basic.middle_name || ''} ${basic.last_name || ''} ${basic.name_suffix || ''}`.trim();

        elements.modalProviderTitle.textContent = name;
        elements.modalExternalLink.href = `https://npiregistry.cms.hhs.gov/provider-view/${item.number}`;

        // Populate Overview Grid
        elements.modalOverviewGrid.innerHTML = `
            <div class="modal-info-card">
                <div class="modal-info-label">Status</div>
                <div class="modal-info-val">${basic.status === 'A' ? 'Active' : (basic.status || 'Active')}</div>
            </div>
            <div class="modal-info-card">
                <div class="modal-info-label">Enumeration Date</div>
                <div class="modal-info-val">${basic.enumeration_date || 'N/A'}</div>
            </div>
            <div class="modal-info-card">
                <div class="modal-info-label">Last Updated</div>
                <div class="modal-info-val">${basic.last_updated || 'N/A'}</div>
            </div>
            <div class="modal-info-card">
                <div class="modal-info-label">Credential</div>
                <div class="modal-info-val">${basic.credential || 'None specified'}</div>
            </div>
            ${isOrg ? `
                <div class="modal-info-card">
                    <div class="modal-info-label">Authorized Official</div>
                    <div class="modal-info-val">${basic.authorized_official_first_name || ''} ${basic.authorized_official_last_name || ''}</div>
                </div>
                <div class="modal-info-card">
                    <div class="modal-info-label">Official Title</div>
                    <div class="modal-info-val">${basic.authorized_official_title_or_position || 'N/A'}</div>
                </div>
                <div class="modal-info-card">
                    <div class="modal-info-label">Official Telephone</div>
                    <div class="modal-info-val">${basic.authorized_official_telephone_number || 'N/A'}</div>
                </div>
                <div class="modal-info-card">
                    <div class="modal-info-label">Subpart</div>
                    <div class="modal-info-val">${basic.organizational_subpart || 'NO'}</div>
                </div>
            ` : `
                <div class="modal-info-card">
                    <div class="modal-info-label">Gender / Sex</div>
                    <div class="modal-info-val">${basic.sex === 'M' ? 'Male' : (basic.sex === 'F' ? 'Female' : (basic.sex || 'N/A'))}</div>
                </div>
                <div class="modal-info-card">
                    <div class="modal-info-label">Sole Proprietor</div>
                    <div class="modal-info-val">${basic.sole_proprietor || 'NO'}</div>
                </div>
            `}
        `;

        // Populate Taxonomies List
        elements.modalTaxonomiesList.innerHTML = "";
        if (!item.taxonomies || item.taxonomies.length === 0) {
            elements.modalTaxonomiesList.innerHTML = `<p class="text-muted">No taxonomies listed.</p>`;
        } else {
            item.taxonomies.forEach(t => {
                const taxCard = document.createElement("div");
                taxCard.className = "tax-item-card";
                taxCard.innerHTML = `
                    <div class="tax-item-header">
                        <span class="tax-item-code">${escapeHtml(t.code || '')}</span>
                        ${t.primary ? '<span class="badge active">Primary Taxonomy</span>' : '<span class="badge">Secondary</span>'}
                    </div>
                    <div class="tax-item-desc">${escapeHtml(t.desc || 'No description available')}</div>
                    <div class="tax-meta-row">
                        <span>License: <strong>${escapeHtml(t.license || 'N/A')}</strong></span>
                        <span>State: <strong>${escapeHtml(t.state || 'N/A')}</strong></span>
                        ${t.taxonomy_group ? `<span>Group: <strong>${escapeHtml(t.taxonomy_group)}</strong></span>` : ''}
                    </div>
                `;
                elements.modalTaxonomiesList.appendChild(taxCard);
            });
        }

        // Populate Addresses List
        elements.modalAddressesList.innerHTML = "";
        if (!item.addresses || item.addresses.length === 0) {
            elements.modalAddressesList.innerHTML = `<p class="text-muted">No addresses returned.</p>`;
        } else {
            item.addresses.forEach(addr => {
                const addrCard = document.createElement("div");
                addrCard.className = "address-item-card";
                const isLocation = addr.address_purpose === "LOCATION";
                addrCard.innerHTML = `
                    <span class="address-item-purpose">${isLocation ? 'Primary Practice Location' : 'Mailing Address'}</span>
                    <div class="address-street">${escapeHtml(addr.address_1 || '')}</div>
                    ${addr.address_2 ? `<div class="address-street">${escapeHtml(addr.address_2)}</div>` : ''}
                    <div class="address-city-state">
                        ${escapeHtml(addr.city || '')}, ${escapeHtml(addr.state || '')} ${escapeHtml(addr.postal_code || '')}
                    </div>
                    <div class="address-city-state">
                        ${escapeHtml(addr.country_name || addr.country_code || 'United States')}
                    </div>
                    ${addr.telephone_number ? `
                        <div class="address-phone">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                            </svg>
                            <span>Phone: ${escapeHtml(addr.telephone_number)}</span>
                        </div>
                    ` : ''}
                    ${addr.fax_number ? `<div class="address-phone"><span>Fax: ${escapeHtml(addr.fax_number)}</span></div>` : ''}
                `;
                elements.modalAddressesList.appendChild(addrCard);
            });
        }

        // Exact Raw JSON
        elements.modalRawJsonCode.textContent = JSON.stringify(item, null, 2);

        // Reset to Overview tab
        document.querySelector('.modal-tab[data-tab="tab-overview"]').click();

        // Show modal
        elements.providerModalBackdrop.style.display = "flex";
        document.body.style.overflow = "hidden";
    }

    function closeModal() {
        elements.providerModalBackdrop.style.display = "none";
        document.body.style.overflow = "";
    }

    function copyRawJson() {
        if (!state.selectedProvider) return;
        const text = JSON.stringify(state.selectedProvider, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = elements.copyRawJsonBtn.innerHTML;
            elements.copyRawJsonBtn.innerHTML = `<span>Copied!</span>`;
            setTimeout(() => {
                elements.copyRawJsonBtn.innerHTML = originalHTML;
            }, 1800);
        });
    }

    // Presets
    function applyPreset(presetKey) {
        resetAllFilters(false);

        switch (presetKey) {
            case "cardiology-ny":
                elements.taxonomy.value = "Cardiovascular Disease";
                elements.stateSelect.value = "NY";
                break;
            case "hospital-tx":
                elements.taxonomy.value = "General Acute Care Hospital";
                elements.stateSelect.value = "TX";
                const orgRadio = elements.npiTypeGroup.querySelector('input[value="NPI-2"]');
                if (orgRadio) orgRadio.checked = true;
                updateFormSectionStates("NPI-2");
                break;
            case "mayo-org":
                elements.orgName.value = "Mayo Clinic*";
                const orgRadioMayo = elements.npiTypeGroup.querySelector('input[value="NPI-2"]');
                if (orgRadioMayo) orgRadioMayo.checked = true;
                updateFormSectionStates("NPI-2");
                break;
            case "smith-boston":
                elements.lastName.value = "Smith";
                elements.city.value = "Boston";
                elements.stateSelect.value = "MA";
                const indRadio = elements.npiTypeGroup.querySelector('input[value="NPI-1"]');
                if (indRadio) indRadio.checked = true;
                updateFormSectionStates("NPI-1");
                break;
            case "canada-providers":
                elements.countrySelect.value = "CA";
                break;
        }

        state.isDeepPartition = false;
        fetchResults();
    }

    // Reset all filters
    function resetAllFilters(shouldTrigger = true) {
        elements.filterForm.reset();
        const anyRadio = elements.npiTypeGroup.querySelector('input[value=""]');
        if (anyRadio) anyRadio.checked = true;
        updateFormSectionStates("");

        state.isDeepPartition = false;
        elements.quickFilterInput.value = "";
        elements.metricsDashboard.style.display = "none";
        elements.deepPartitionBanner.style.display = "none";

        if (shouldTrigger) {
            fetchResults();
        }
    }

    // Switch between Cards and Table view
    function setView(viewType) {
        state.currentView = viewType;
        elements.viewCardsBtn.classList.toggle("active", viewType === "cards");
        elements.viewTableBtn.classList.toggle("active", viewType === "table");

        if (state.filteredRecords.length > 0) {
            showState(viewType);
        }
    }

    // UI state transitions
    function showState(activeState) {
        elements.initialState.style.display = activeState === "initial" ? "block" : "none";
        elements.loadingState.style.display = activeState === "loading" ? "flex" : "none";
        elements.noResultsState.style.display = activeState === "noResults" ? "block" : "none";
        elements.cardsGrid.style.display = activeState === "cards" ? "grid" : "none";
        elements.tableContainer.style.display = activeState === "table" ? "block" : "none";
    }

    function showAlert(title, message) {
        elements.alertTitle.textContent = title;
        elements.alertMessage.textContent = message;
        elements.errorAlertBox.style.display = "flex";
    }

    function hideAlert() {
        elements.errorAlertBox.style.display = "none";
    }

    // Export all matching records (100% complete dataset)
    function triggerExport(format) {
        const params = getFilterParams();
        params.set("format", format);
        window.location.href = `/api/export?${params.toString()}`;
    }

    // Utility: HTML escaping
    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Start on DOM ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
