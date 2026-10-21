/**
 * app.js - CMS NPPES NPI Registry Live Filtering & Provider Email Discovery Studio
 * Integrates:
 * 1. Multi-batch retrieval of matching records from official CMS NPPES API v2.1
 * 2. Provider selection for single or bulk email & website enrichment
 * 3. Targeted crawling, public email extraction, and live DNS/MX verification
 * 4. Discovered emails display badges and full CSV export
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

        // Selection & Email Discovery State
        selectedNpis: new Set(),
        enrichedEmailsMap: {},      // { [npi]: [ { email, email_type, mx_valid, status, website } ] }
        activeJobId: null,
        jobPollInterval: null,
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
        thSelectAllCheckbox: document.getElementById("thSelectAllCheckbox"),

        // Batch Selection Strip
        selectionActionsBar: document.getElementById("selectionActionsBar"),
        selectAllPageCheckbox: document.getElementById("selectAllPageCheckbox"),
        selectionStatusText: document.getElementById("selectionStatusText"),
        selectAllMatchingBtn: document.getElementById("selectAllMatchingBtn"),
        clearSelectionBtn: document.getElementById("clearSelectionBtn"),
        barEnrichBtn: document.getElementById("barEnrichBtn"),
        barEnrichCount: document.getElementById("barEnrichCount"),

        // Toolbar
        viewCardsBtn: document.getElementById("viewCardsBtn"),
        viewTableBtn: document.getElementById("viewTableBtn"),
        pageSizeSelect: document.getElementById("pageSizeSelect"),
        exportCsvBtn: document.getElementById("exportCsvBtn"),
        exportJsonBtn: document.getElementById("exportJsonBtn"),
        exportEmailsBtn: document.getElementById("exportEmailsBtn"),
        enrichSelectedBtn: document.getElementById("enrichSelectedBtn"),
        enrichBtnLabel: document.getElementById("enrichBtnLabel"),
        selectionCountBadge: document.getElementById("selectionCountBadge"),

        // Pagination
        paginationFooter: document.getElementById("paginationFooter"),
        paginationInfo: document.getElementById("paginationInfo"),
        pageNumbers: document.getElementById("pageNumbers"),
        firstPageBtn: document.getElementById("firstPageBtn"),
        prevPageBtn: document.getElementById("prevPageBtn"),
        nextPageBtn: document.getElementById("nextPageBtn"),
        lastPageBtn: document.getElementById("lastPageBtn"),

        // Provider Inspection Modal
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

        // Modal Email Tab Elements
        modalWebsiteSection: document.getElementById("modalWebsiteSection"),
        modalWebsiteLinkWrapper: document.getElementById("modalWebsiteLinkWrapper"),
        modalEnrichSingleBtn: document.getElementById("modalEnrichSingleBtn"),
        modalEmailsList: document.getElementById("modalEmailsList"),

        // Multi-Stage Research Elements
        researchProviderEmail: document.getElementById("researchProviderEmail"),
        researchOrgBtn: document.getElementById("researchOrgBtn"),
        researchOrgInput: document.getElementById("researchOrgInput"),
        researchOrgDomainInput: document.getElementById("researchOrgDomainInput"),
        researchWebsiteBtn: document.getElementById("researchWebsiteBtn"),
        researchEngineSelect: document.getElementById("researchEngineSelect"),
        researchStatusRow: document.getElementById("researchStatusRow"),
        emailResearchStatus: document.getElementById("emailResearchStatus"),
        emailResearchQuery: document.getElementById("emailResearchQuery"),
        researchSourcesWrapper: document.getElementById("researchSourcesWrapper"),
        sourcesCount: document.getElementById("sourcesCount"),
        emailResearchSources: document.getElementById("emailResearchSources"),

        // Live Enrichment Progress Dialog
        enrichModalBackdrop: document.getElementById("enrichModalBackdrop"),
        closeEnrichModalBtn: document.getElementById("closeEnrichModalBtn"),
        dismissEnrichModalBtn: document.getElementById("dismissEnrichModalBtn"),
        downloadEnrichedCsvBtn: document.getElementById("downloadEnrichedCsvBtn"),
        enrichProgressBar: document.getElementById("enrichProgressBar"),
        enrichPercentText: document.getElementById("enrichPercentText"),
        enrichCountsText: document.getElementById("enrichCountsText"),
        enrichTotalSelected: document.getElementById("enrichTotalSelected"),
        enrichCompletedCount: document.getElementById("enrichCompletedCount"),
        enrichFoundEmails: document.getElementById("enrichFoundEmails"),
        enrichStatusBadge: document.getElementById("enrichStatusBadge"),
    };

    // Initialize application
    async function init() {
        bindEvents();
        await loadMetadata();
        await loadEnrichedSummary();
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

    // Load map of existing discovered emails from database
    async function loadEnrichedSummary() {
        try {
            const resp = await fetch("/api/emails/summary");
            const data = await resp.json();
            if (data.success && data.summary) {
                state.enrichedEmailsMap = data.summary;
                // Re-render current page to update badges if results exist
                if (state.filteredRecords.length > 0) {
                    renderCurrentPage();
                }
            }
        } catch (err) {
            console.debug("Could not load enriched emails summary:", err);
        }
    }

    // Bind event listeners
    function bindEvents() {
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

        // Select & Radio listeners
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

        // Selection Handlers
        if (elements.selectAllPageCheckbox) {
            elements.selectAllPageCheckbox.addEventListener("change", (e) => {
                toggleSelectAllPage(e.target.checked);
            });
        }

        if (elements.thSelectAllCheckbox) {
            elements.thSelectAllCheckbox.addEventListener("change", (e) => {
                toggleSelectAllPage(e.target.checked);
            });
        }

        if (elements.selectAllMatchingBtn) {
            elements.selectAllMatchingBtn.addEventListener("click", () => {
                state.filteredRecords.forEach(r => state.selectedNpis.add(String(r.number)));
                updateSelectionUI();
                renderCurrentPage();
            });
        }

        if (elements.clearSelectionBtn) {
            elements.clearSelectionBtn.addEventListener("click", () => {
                state.selectedNpis.clear();
                updateSelectionUI();
                renderCurrentPage();
            });
        }

        // Email Enrichment Triggers
        elements.enrichSelectedBtn.addEventListener("click", () => {
            triggerEnrichmentForSelected();
        });

        if (elements.barEnrichBtn) {
            elements.barEnrichBtn.addEventListener("click", () => {
                triggerEnrichmentForSelected();
            });
        }

        if (elements.modalEnrichSingleBtn) {
            elements.modalEnrichSingleBtn.addEventListener("click", () => {
                if (state.selectedProvider) {
                    triggerEnrichmentForRecords([state.selectedProvider]);
                }
            });
        }

        // Multi-Stage Public Research Handlers
        if (elements.researchProviderEmail) {
            elements.researchProviderEmail.addEventListener("click", () => {
                executeResearch("provider");
            });
        }

        if (elements.researchOrgBtn) {
            elements.researchOrgBtn.addEventListener("click", () => {
                const orgName = elements.researchOrgInput ? elements.researchOrgInput.value.trim() : "";
                const domain = elements.researchOrgDomainInput ? elements.researchOrgDomainInput.value.trim() : "";
                executeResearch("organization", orgName, domain ? [domain] : []);
            });
        }

        if (elements.researchWebsiteBtn) {
            elements.researchWebsiteBtn.addEventListener("click", () => {
                executeResearch("official_website");
            });
        }

        // Progress Dialog Controls
        elements.closeEnrichModalBtn.addEventListener("click", closeEnrichModal);
        elements.dismissEnrichModalBtn.addEventListener("click", closeEnrichModal);
        elements.downloadEnrichedCsvBtn.addEventListener("click", () => {
            window.location.href = "/api/export-emails";
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
        elements.exportEmailsBtn.addEventListener("click", () => {
            window.location.href = "/api/export-emails";
        });

        // Modal Close handlers
        elements.closeModalBtn.addEventListener("click", closeModal);
        elements.modalCloseActionBtn.addEventListener("click", closeModal);
        elements.providerModalBackdrop.addEventListener("click", (e) => {
            if (e.target === elements.providerModalBackdrop) closeModal();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                closeModal();
                closeEnrichModal();
            }
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
            elements.selectionActionsBar.style.display = "none";
            elements.resultCountHeader.textContent = "CMS Registry Results";
            elements.resultCountSub.textContent = "Enter filters to query the NPPES database in real time.";
            elements.paginationFooter.style.display = "none";
            state.allRecords = [];
            state.filteredRecords = [];
            state.totalRecordsFound = 0;
            state.selectedNpis.clear();
            updateSelectionUI();
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

            if (!data.success) {
                const message = data.error_message || (data.errors && data.errors.map(e => e.description).join("; ")) || "Invalid search query";
                showAlert("CMS API Notice", message);
                showState("noResults");
                elements.metricsDashboard.style.display = "none";
                elements.deepPartitionBanner.style.display = "none";
                elements.selectionActionsBar.style.display = "none";
                elements.resultCountHeader.textContent = "0 Providers Found";
                elements.resultCountSub.textContent = "Please adjust your search criteria according to CMS requirements.";
                elements.paginationFooter.style.display = "none";
                state.allRecords = [];
                state.filteredRecords = [];
                state.totalRecordsFound = 0;
                state.selectedNpis.clear();
                updateSelectionUI();
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
                elements.selectionActionsBar.style.display = "none";
                elements.resultCountHeader.textContent = "0 Providers Found";
                elements.resultCountSub.textContent = "No matching providers registered in CMS NPPES for these criteria.";
                elements.paginationFooter.style.display = "none";
                state.selectedNpis.clear();
                updateSelectionUI();
                return;
            }

            // Update Metrics Dashboard
            elements.metricTotalFound.textContent = state.totalRecordsFound.toLocaleString();
            elements.metricBatchStatus.textContent = "Official CMS NPPES Registry";
            elements.metricBatchesFetched.textContent = `${data.batches_fetched} API batch(es) fetched`;
            elements.metricApiStatus.textContent = "100% Retrieved";
            elements.metricsDashboard.style.display = "grid";

            if (data.is_capped && !state.isDeepPartition) {
                elements.deepPartitionBanner.style.display = "flex";
            } else {
                elements.deepPartitionBanner.style.display = "none";
            }

            // Render current page & selection bar
            renderCurrentPage();
            showState(state.currentView === "cards" ? "cards" : "table");
            elements.selectionActionsBar.style.display = "flex";

            // Refresh enriched status in background
            loadEnrichedSummary();

        } catch (err) {
            if (err.name === "AbortError") return;
            elements.executeSearchBtn.disabled = false;
            console.error("Search request failed:", err);
            showAlert("Connection Error", "Could not complete the query to the official API. Please verify your connection.");
            showState("noResults");
            elements.metricsDashboard.style.display = "none";
            elements.deepPartitionBanner.style.display = "none";
            elements.selectionActionsBar.style.display = "none";
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

    // Get current visible page records slice
    function getCurrentPageSlice() {
        const total = state.filteredRecords.length;
        if (state.pageSize === "all") return state.filteredRecords;
        const start = (state.currentPage - 1) * state.pageSize;
        const end = Math.min(start + state.pageSize, total);
        return state.filteredRecords.slice(start, end);
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
        updateSelectionUI();
    }

    // Toggle Select All on visible page
    function toggleSelectAllPage(checked) {
        const pageSlice = getCurrentPageSlice();
        pageSlice.forEach(item => {
            const npi = String(item.number);
            if (checked) {
                state.selectedNpis.add(npi);
            } else {
                state.selectedNpis.delete(npi);
            }
        });
        updateSelectionUI();
        renderCurrentPage();
    }

    // Update selection indicators and button states
    function updateSelectionUI() {
        const pageSlice = getCurrentPageSlice();
        const pageNpis = pageSlice.map(r => String(r.number));
        const selectedOnPage = pageNpis.filter(npi => state.selectedNpis.has(npi)).length;

        // Update page checkboxes
        const allOnPageSelected = pageNpis.length > 0 && selectedOnPage === pageNpis.length;
        if (elements.selectAllPageCheckbox) {
            elements.selectAllPageCheckbox.checked = allOnPageSelected;
        }
        if (elements.thSelectAllCheckbox) {
            elements.thSelectAllCheckbox.checked = allOnPageSelected;
        }

        const totalSelected = state.selectedNpis.size;

        if (elements.selectionStatusText) {
            elements.selectionStatusText.innerHTML = `<strong>${selectedOnPage}</strong> of ${pageNpis.length} selected on this page (${totalSelected} total selected)`;
        }

        if (elements.barEnrichCount) {
            elements.barEnrichCount.textContent = totalSelected;
        }

        if (elements.selectionCountBadge) {
            elements.selectionCountBadge.textContent = totalSelected;
            elements.selectionCountBadge.style.display = totalSelected > 0 ? "inline-block" : "none";
        }

        if (elements.enrichSelectedBtn) {
            elements.enrichSelectedBtn.disabled = totalSelected === 0;
            elements.enrichBtnLabel.textContent = totalSelected > 0
                ? `Find Emails (${totalSelected})`
                : "Find Emails";
        }

        if (elements.barEnrichBtn) {
            elements.barEnrichBtn.disabled = totalSelected === 0;
        }
    }

    // Render Cards View
    function renderCards(records) {
        elements.cardsGrid.innerHTML = "";

        records.forEach(item => {
            const card = document.createElement("div");
            card.className = "provider-card";

            const npi = String(item.number);
            const isSelected = state.selectedNpis.has(npi);
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

            // Check if provider has enriched emails
            const enrichedEmails = state.enrichedEmailsMap[npi] || [];
            const hasEmails = enrichedEmails.length > 0;
            const validMxCount = enrichedEmails.filter(e => e.mx_valid === 1).length;

            let emailBadgeHtml = "";
            if (hasEmails) {
                emailBadgeHtml = `
                    <span class="email-badge" title="${enrichedEmails.map(e => e.email).join(', ')}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        <span>${enrichedEmails.length} Email${enrichedEmails.length > 1 ? 's' : ''}</span>
                        ${validMxCount > 0 ? `<span class="badge-mx-pill">MX ✓</span>` : ''}
                    </span>
                `;
            }

            card.innerHTML = `
                <div>
                    <!-- Top Checkbox and Selector Row -->
                    <div class="card-top-row">
                        <label class="card-select-label">
                            <input type="checkbox" class="provider-card-select" data-npi="${escapeHtml(npi)}" ${isSelected ? 'checked' : ''}>
                            <span>Select for Email Discovery</span>
                        </label>
                        ${emailBadgeHtml}
                    </div>

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
                    <span class="npi-badge">NPI: ${escapeHtml(npi)}</span>
                    <button type="button" class="btn-card-inspect" data-npi="${escapeHtml(npi)}">
                        <span>View Full Record</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>
                </div>
            `;

            // Checkbox event
            const checkbox = card.querySelector(".provider-card-select");
            checkbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    state.selectedNpis.add(npi);
                } else {
                    state.selectedNpis.delete(npi);
                }
                updateSelectionUI();
            });

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
            const npi = String(item.number);
            const isSelected = state.selectedNpis.has(npi);

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

            // Enriched email info
            const enrichedEmails = state.enrichedEmailsMap[npi] || [];
            let emailColumnHtml = `<span class="text-muted" style="font-size:0.8rem;">Not Enriched</span>`;
            if (enrichedEmails.length > 0) {
                const firstEmail = enrichedEmails[0];
                emailColumnHtml = `
                    <div class="table-emails-cell">
                        <span class="email-badge" title="${enrichedEmails.map(e => e.email).join(', ')}">
                            ${escapeHtml(firstEmail.email)}
                            ${firstEmail.mx_valid === 1 ? '<span class="badge-mx-pill">MX ✓</span>' : ''}
                        </span>
                        ${enrichedEmails.length > 1 ? `<span class="badge" style="font-size:0.7rem;">+${enrichedEmails.length - 1} more</span>` : ''}
                    </div>
                `;
            }

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="provider-table-select" data-npi="${escapeHtml(npi)}" ${isSelected ? 'checked' : ''}>
                </td>
                <td>
                    <div class="table-npi-cell">
                        <span class="table-npi-num">${escapeHtml(npi)}</span>
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
                <td>${emailColumnHtml}</td>
                <td>${escapeHtml(phone)}</td>
                <td>
                    <button type="button" class="btn-secondary btn-inspect" data-npi="${escapeHtml(npi)}">
                        Inspect
                    </button>
                </td>
            `;

            // Checkbox event
            const checkbox = tr.querySelector(".provider-table-select");
            checkbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    state.selectedNpis.add(npi);
                } else {
                    state.selectedNpis.delete(npi);
                }
                updateSelectionUI();
            });

            tr.querySelector(".btn-inspect").addEventListener("click", () => {
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

    // ==========================================
    // Email Enrichment Workflow
    // ==========================================

    function triggerEnrichmentForSelected() {
        if (state.selectedNpis.size === 0) return;
        const selectedRecords = state.allRecords.filter(r => state.selectedNpis.has(String(r.number)));
        triggerEnrichmentForRecords(selectedRecords);
    }

    async function triggerEnrichmentForRecords(records) {
        if (!records || records.length === 0) return;

        // Show live modal in running state
        elements.enrichModalBackdrop.style.display = "flex";
        elements.enrichStatusBadge.textContent = "Running";
        elements.enrichStatusBadge.className = "badge active";
        elements.enrichProgressBar.style.width = "0%";
        elements.enrichPercentText.textContent = "0% Complete";
        elements.enrichCountsText.textContent = `0 / ${records.length} Providers Processed`;
        elements.enrichTotalSelected.textContent = records.length;
        elements.enrichCompletedCount.textContent = "0";
        elements.enrichFoundEmails.textContent = "0";
        elements.downloadEnrichedCsvBtn.style.display = "none";

        try {
            const resp = await fetch("/api/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ records: records })
            });

            const data = await resp.json();
            if (!data.success) {
                alert(data.error || "Failed to start enrichment job.");
                closeEnrichModal();
                return;
            }

            state.activeJobId = data.job_id;
            startJobPolling(data.job_id);

        } catch (err) {
            console.error("Enrichment initiation failed:", err);
            alert("Could not connect to enrichment service. Please check server.");
            closeEnrichModal();
        }
    }

    function startJobPolling(jobId) {
        if (state.jobPollInterval) clearInterval(state.jobPollInterval);

        state.jobPollInterval = setInterval(async () => {
            try {
                const resp = await fetch(`/api/enrich/status/${jobId}`);
                if (!resp.ok) return;

                const job = await resp.json();
                if (!job.success) return;

                const total = job.total || 0;
                const completed = job.completed || 0;
                const found = job.found_emails || 0;
                const percent = job.percent || 0;

                elements.enrichProgressBar.style.width = `${percent}%`;
                elements.enrichPercentText.textContent = `${percent}% Complete`;
                elements.enrichCountsText.textContent = `${completed} / ${total} Providers Processed`;
                elements.enrichCompletedCount.textContent = completed;
                elements.enrichFoundEmails.textContent = found;

                if (job.status === "completed") {
                    clearInterval(state.jobPollInterval);
                    state.jobPollInterval = null;
                    elements.enrichStatusBadge.textContent = "Completed";
                    elements.enrichStatusBadge.className = "badge active";
                    elements.downloadEnrichedCsvBtn.style.display = "inline-flex";

                    // Reload email summary & refresh views
                    await loadEnrichedSummary();
                    renderCurrentPage();

                    // If provider inspection modal is open, refresh emails tab
                    if (state.selectedProvider) {
                        loadProviderModalEmails(state.selectedProvider.number);
                    }
                }
            } catch (err) {
                console.debug("Job polling error:", err);
            }
        }, 850);
    }

    function closeEnrichModal() {
        elements.enrichModalBackdrop.style.display = "none";
    }

    // ==========================================
    // Provider Inspection Modal & Email Tab
    // ==========================================

    async function loadProviderModalEmails(npi) {
        elements.modalEmailsList.innerHTML = `<p class="text-muted">Loading discovered emails...</p>`;
        elements.modalWebsiteLinkWrapper.innerHTML = `<em>Checking records...</em>`;

        try {
            const resp = await fetch(`/api/emails/${npi}`);
            const data = await resp.json();

            if (data.success && data.emails && data.emails.length > 0) {
                const firstRow = data.emails[0];
                const website = firstRow.website;
                const websiteSource = firstRow.website_source || "discovered";

                if (website) {
                    elements.modalWebsiteLinkWrapper.innerHTML = `
                        <a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">
                            <span>${escapeHtml(website)}</span>
                            <span class="badge" style="font-size:0.7rem;">${escapeHtml(websiteSource)}</span>
                        </a>
                    `;
                } else {
                    elements.modalWebsiteLinkWrapper.innerHTML = `<span class="text-muted">No website found yet.</span>`;
                }

                elements.modalEmailsList.innerHTML = "";
                data.emails.forEach(item => {
                    const row = document.createElement("div");
                    row.className = "email-row-item";
                    const isMx = item.mx_valid === 1;

                    row.innerHTML = `
                        <div class="email-meta-group">
                            <div class="email-address-text">${escapeHtml(item.email)}</div>
                            <div class="email-tags-row">
                                <span class="badge">${escapeHtml(item.email_type || 'public_contact')}</span>
                                <span class="badge-mx-pill ${isMx ? '' : 'invalid'}">
                                    ${isMx ? 'MX Valid (Deliverable)' : 'No MX / Unverified'}
                                </span>
                                ${item.source_url ? `<span class="text-muted" title="${escapeHtml(item.source_url)}">Source: ${escapeHtml(item.source_url.slice(0, 40))}...</span>` : ''}
                            </div>
                        </div>
                        <button type="button" class="btn-copy copy-email-btn" data-email="${escapeHtml(item.email)}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            <span>Copy Email</span>
                        </button>
                    `;

                    row.querySelector(".copy-email-btn").addEventListener("click", () => {
                        navigator.clipboard.writeText(item.email).then(() => {
                            const btn = row.querySelector(".copy-email-btn");
                            btn.innerHTML = `<span>Copied!</span>`;
                            setTimeout(() => {
                                btn.innerHTML = `<span>Copy Email</span>`;
                            }, 1800);
                        });
                    });

                    elements.modalEmailsList.appendChild(row);
                });
            } else {
                elements.modalWebsiteLinkWrapper.innerHTML = `<span class="text-muted">No official website identified yet.</span>`;
                elements.modalEmailsList.innerHTML = `
                    <div class="empty-state" style="padding: 1.5rem 0;">
                        <p class="text-muted">No public emails discovered for this provider yet.</p>
                        <p style="font-size: 0.85rem; color: var(--text-secondary);">
                            Click <strong>"Run Email Discovery"</strong> above to find official clinic websites, scan contact pages, and verify email DNS/MX records.
                        </p>
                    </div>
                `;
            }
        } catch (err) {
            console.error("Failed to load provider emails:", err);
            elements.modalEmailsList.innerHTML = `<p class="text-danger">Could not load email records.</p>`;
        }
    }

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

        // Reset and pre-populate Multi-Stage Research inputs
        if (elements.researchOrgInput) {
            elements.researchOrgInput.value = isOrg ? (basic.organization_name || "") : "";
        }
        if (elements.researchOrgDomainInput) {
            elements.researchOrgDomainInput.value = "";
        }
        if (elements.researchStatusRow) {
            elements.researchStatusRow.style.display = "none";
        }
        if (elements.researchSourcesWrapper) {
            elements.researchSourcesWrapper.style.display = "none";
        }
        if (elements.emailResearchSources) {
            elements.emailResearchSources.innerHTML = "";
        }

        // Load Emails & Website Tab
        loadProviderModalEmails(item.number);

        // Exact Raw JSON
        elements.modalRawJsonCode.textContent = JSON.stringify(item, null, 2);

        // Reset to Overview tab
        document.querySelector('.modal-tab[data-tab="tab-overview"]').click();

        // Show modal
        elements.providerModalBackdrop.style.display = "flex";
        document.body.style.overflow = "hidden";
    }

    // ==========================================
    // Multi-Stage Public Research Workflow
    // ==========================================

    async function executeResearch(stage, organization = "", domains = []) {
        const provider = state.selectedProvider;
        if (!provider) return;

        const engine = elements.researchEngineSelect ? elements.researchEngineSelect.value : "tavily";
        const statusPill = elements.emailResearchStatus;
        const queryBox = elements.emailResearchQuery;
        const sourcesWrapper = elements.researchSourcesWrapper;
        const sourcesList = elements.emailResearchSources;
        const sourcesCount = elements.sourcesCount;

        if (elements.researchStatusRow) elements.researchStatusRow.style.display = "flex";
        if (statusPill) {
            statusPill.textContent = "Searching public sources...";
            statusPill.className = "research-status-pill loading";
        }
        if (queryBox) queryBox.textContent = "";
        if (sourcesWrapper) sourcesWrapper.style.display = "none";
        if (sourcesList) sourcesList.innerHTML = "";

        if (elements.researchProviderEmail) elements.researchProviderEmail.disabled = true;
        if (elements.researchOrgBtn) elements.researchOrgBtn.disabled = true;
        if (elements.researchWebsiteBtn) elements.researchWebsiteBtn.disabled = true;

        try {
            const resp = await fetch("/api/email-research", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    record: provider,
                    stage: stage,
                    organization: organization,
                    domains: domains,
                    provider: engine,
                })
            });

            const data = await resp.json();

            if (!resp.ok) {
                if (statusPill) {
                    statusPill.textContent = `Search Incomplete: ${data.error || "Search request failed"}`;
                    statusPill.className = "research-status-pill error";
                }
                return;
            }

            const sources = data.sources || [];
            if (statusPill) {
                statusPill.textContent = sources.length > 0 ? (data.status || "Sources Found") : "Email Not Found";
                statusPill.className = sources.length > 0 ? "research-status-pill success" : "research-status-pill";
            }
            if (queryBox) queryBox.textContent = `Query: ${data.query}`;
            if (sourcesCount) sourcesCount.textContent = sources.length;

            if (sources.length > 0) {
                if (sourcesWrapper) sourcesWrapper.style.display = "block";
                sources.forEach(src => {
                    const li = document.createElement("li");
                    li.className = "research-source-item";

                    let domainStr = "";
                    try {
                        const parsed = new URL(src.url);
                        domainStr = parsed.hostname;
                    } catch (e) {
                        domainStr = src.url;
                    }

                    li.innerHTML = `
                        <div class="source-meta">
                            <a href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer" class="source-title-link">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                                <span>${escapeHtml(src.title || domainStr)}</span>
                            </a>
                            <div class="source-url-text">${escapeHtml(src.url)}</div>
                            ${src.snippet ? `<div class="source-snippet-text">${escapeHtml(src.snippet)}</div>` : ''}
                        </div>
                        <div class="source-actions-group">
                            <span class="badge" style="font-size:0.7rem;text-transform:uppercase;">${escapeHtml(src.engine || engine)}</span>
                            <button type="button" class="btn-sm btn-secondary extract-btn">
                                <span>Extract Emails</span>
                            </button>
                        </div>
                    `;

                    li.querySelector(".extract-btn").addEventListener("click", () => {
                        extractEmailsFromSource(src.url, li.querySelector(".extract-btn"));
                    });

                    sourcesList.appendChild(li);
                });
            }

        } catch (err) {
            console.error("Research request error:", err);
            if (statusPill) {
                statusPill.textContent = `Search Incomplete: ${err.message}`;
                statusPill.className = "research-status-pill error";
            }
        } finally {
            if (elements.researchProviderEmail) elements.researchProviderEmail.disabled = false;
            if (elements.researchOrgBtn) elements.researchOrgBtn.disabled = false;
            if (elements.researchWebsiteBtn) elements.researchWebsiteBtn.disabled = false;
        }
    }

    async function extractEmailsFromSource(url, btnElement) {
        if (!url || !state.selectedProvider) return;
        if (btnElement) {
            btnElement.disabled = true;
            btnElement.innerHTML = `<span>Scanning...</span>`;
        }

        try {
            const resp = await fetch("/api/email-extract-source", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: url,
                    record: state.selectedProvider,
                })
            });

            const data = await resp.json();

            if (!resp.ok) {
                alert(data.error || "Extraction failed.");
                if (btnElement) {
                    btnElement.disabled = false;
                    btnElement.innerHTML = `<span>Extract Emails</span>`;
                }
                return;
            }

            const candidates = data.candidates || [];
            if (candidates.length > 0) {
                // Refresh provider emails in modal
                await loadProviderModalEmails(state.selectedProvider.number);
                // Refresh global summary and table/cards badges
                await loadEnrichedSummary();
                renderCurrentPage();

                if (btnElement) {
                    btnElement.className = "btn-sm btn-primary extract-btn";
                    btnElement.innerHTML = `<span>${candidates.length} Found ✓</span>`;
                }
            } else {
                if (btnElement) {
                    btnElement.innerHTML = `<span>No Emails on Page</span>`;
                    setTimeout(() => {
                        btnElement.disabled = false;
                        btnElement.innerHTML = `<span>Extract Emails</span>`;
                    }, 2500);
                }
            }
        } catch (err) {
            console.error("Extraction error:", err);
            if (btnElement) {
                btnElement.disabled = false;
                btnElement.innerHTML = `<span>Extract Emails</span>`;
            }
        }
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
        elements.selectionActionsBar.style.display = "none";
        state.selectedNpis.clear();
        updateSelectionUI();

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
