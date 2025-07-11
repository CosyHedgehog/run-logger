let runs = [];
const MASTER_PASSWORD_LOCALSTORAGE_KEY = "runLoggerMasterPassword";
const MPH_TO_KPH_FACTOR = 1.60934;
const KPH_TO_MPH_FACTOR = 1 / MPH_TO_KPH_FACTOR;

function calculateKph(mph) { return (mph * MPH_TO_KPH_FACTOR); }

function calculateDistance(timeMinutes, kph) { const timeHours = timeMinutes / 60; return (timeHours * kph); }

function calculateMph(timeMinutes, distanceKm) {
    if (timeMinutes <= 0 || distanceKm < 0) return 0;
    const timeHours = timeMinutes / 60;
    const kph = distanceKm / timeHours;
    return kph * KPH_TO_MPH_FACTOR;
}

function getDayOfWeek(dateString) { const date = new Date(dateString + 'T00:00:00'); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return days[date.getDay()]; }

function parseMMSS(timeString) {
    if (!timeString || typeof timeString !== 'string') return NaN;
    if (/^\d+$/.test(timeString)) {
        timeString = timeString + ":00";
    }
    const parts = timeString.split(':');
    if (parts.length !== 2) return NaN;
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (isNaN(minutes) || isNaN(seconds) || seconds < 0 || seconds >= 60 || minutes < 0) {
        return NaN;
    }
    return minutes + (seconds / 60);
}

function formatMinutesToMMSS(totalMinutes) {
    if (isNaN(totalMinutes) || totalMinutes < 0) return '00:00';
    const minutes = Math.floor(totalMinutes);
    const seconds = Math.round((totalMinutes - minutes) * 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getNumberOfDaysSoFarInYear(year) {
    const today = new Date();
    const startOfYear = new Date(year, 0, 1);
    if (today.getFullYear() < year) return 0;
    if (today.getFullYear() > year) {
        const isLeap = new Date(year, 1, 29).getDate() === 29;
        return isLeap ? 366 : 365;
    }
    const diffInMilliseconds = today - startOfYear;
    const diffInDays = Math.ceil(diffInMilliseconds / (1000 * 60 * 60 * 24));
    return diffInDays;
}

const SUPABASE_URL = 'https://qrjstijzhumrhwvdkuls.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyanN0aWp6aHVtcmh3dmRrdWxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5MjQ0MzksImV4cCI6MjA2MzUwMDQzOX0.5CCuhm8rdwJQ_Of_B-XUWjNY9JyQb1EOMSmRREh7x6w';
let supabase = null;
let activeCalculatorInput = 'mph';
let isCalculating = false;
let tabSpecificLogButtons = null;
let gModalContainer, gModalTitleEl, gModalMessageEl;
let gModalConfirmBtn, gModalCancelBtn;
let gFormOverlay;
let gLogRunFormContainer;
let runForm = null;
let runIdToEditInput = null;
let deleteRunFromFormBtn = null;
let logForUserSpan = null;
let currentUserForRunInput = null;
let gFilterModalContainer, filterForm, filterForUserSpan, closeFilterModalBtn, resetFiltersBtn;
let activeFilterUser = null;
let currentFilters = {};
const RUN_LOGGER_FILTERS_KEY = 'runLoggerFilters';

if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        db: {
            schema: 'public',
        },
        auth: {},
        global: {}
    });
} else {
    console.error("Supabase JS SDK (window.supabase.createClient) not loaded or found. Ensure SDK is included before this script.");
    alert("Critical error: Supabase SDK not loaded. App may not function correctly.");
}

async function getSha256Hash(inputString) {
    if (!inputString) {
        console.warn("[getSha256Hash] Input string is null or empty.");
        return null;
    }
    try {
        const textAsBuffer = new TextEncoder().encode(inputString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return hashHex;
    } catch (error) {
        console.error("[getSha256Hash] Error hashing string:", error);
        return null;
    }
}

async function fetchRunsFromSupabase() {
    if (!supabase) {
        console.warn('Supabase client not initialized. Cannot fetch runs.');
        return [];
    }
    try {
        const { data, error } = await supabase
            .from('runs')
            .select('*')
            .order('date', { ascending: false });

        if (error) {
            console.error('Error fetching runs from Supabase:', error);
            alert(`Error fetching runs: ${error.message}. Check console for details.`);
            return [];
        }
        return data || [];
    } catch (err) {
        console.error('Catch block error fetching runs:', err);
        alert(`Error fetching runs: ${err.message}. Check console for details.`);
        return [];
    }
}

async function addRunToSupabase(runObjectWithAuthKey) {

    if (!supabase) {
        console.warn('Supabase client not initialized. Cannot add run.');
        return null;
    }
    try {
        const { data, error } = await supabase
            .from('runs')
            .insert([runObjectWithAuthKey])
            .select();

        if (error) {
            console.error('Error adding run to Supabase:', error, 'Payload:', runObjectWithAuthKey);
            let title = "Add Run Error";
            let message = `An error occurred while adding the run: ${error.message}`;
            if (error.message && error.message.toLowerCase().includes('violates row-level security')) {
                title = "Add Failed: Unauthorized";
                message = "Could not save the run. This might be due to an invalid Master Password or a permission issue on the server.";
            } else if (error.message && error.message.toLowerCase().includes('networkerror')) {
                title = "Network Error";
                message = "Could not connect to the server to add the run. Please check your internet connection.";
            }
            openModal(title, message, 'error');
            return null;
        }

        return data ? data[0] : null;
    } catch (err) {
        console.error('Catch block error adding run:', err);
        openModal("Client-Side Error", `Error during add operation: ${err.message}`, 'error');
        return null;
    }
}

async function updateRunInSupabase(runId, updatedRunObjectWithAuthKey) {

    if (!supabase) {
        console.warn('Supabase client not initialized. Cannot update run.');
        return null;
    }
    try {
        const { data, error } = await supabase
            .from('runs')
            .update(updatedRunObjectWithAuthKey)
            .eq('id', runId)
            .select();

        if (error) {
            console.error('Error updating run in Supabase:', error, 'Payload:', updatedRunObjectWithAuthKey);
            let title = "Update Error";
            let message = `An error occurred while updating the run: ${error.message}`;
            if (error.message && error.message.toLowerCase().includes('violates row-level security')) {
                title = "Update Failed: Unauthorized";
                message = "Could not save changes. This might be due to an invalid Master Password or a permission issue on the server.";
            } else if (error.message && error.message.toLowerCase().includes('networkerror')) {
                title = "Network Error";
                message = "Could not connect to the server to update the run. Please check your internet connection.";
            }
            openModal(title, message, 'error');
            return null;
        }

        return data ? data[0] : null;
    } catch (err) {
        console.error('Catch block error updating run:', err);
        openModal("Client-Side Error", `Error during update operation: ${err.message}`, 'error');
        return null;
    }
}

function openModal(title, message, type = 'error', onConfirm = null) {

    if (gModalTitleEl) {
        gModalTitleEl.textContent = title;
        if (type === 'error') {
            gModalTitleEl.style.color = 'var(--danger-color)';
        } else if (type === 'success') {
            gModalTitleEl.style.color = 'var(--success-color)';
        } else {
            gModalTitleEl.style.color = 'var(--card-title-color)';
        }
    }
    if (gModalMessageEl) gModalMessageEl.textContent = message;

    gModalConfirmCallback = null;

    if (gModalConfirmBtn && gModalCancelBtn) {
        if (type === 'confirmation' && typeof onConfirm === 'function') {
            gModalConfirmBtn.classList.remove('hidden', 'btn-danger', 'btn-success');
            gModalConfirmBtn.classList.add('btn-danger');
            gModalConfirmBtn.style.display = '';
            gModalCancelBtn.textContent = 'Cancel';
            gModalConfirmCallback = onConfirm;
        } else if (type === 'success') {
            gModalConfirmBtn.style.display = 'none';
            gModalCancelBtn.textContent = 'Close';
        } else {
            gModalConfirmBtn.style.display = 'none';
            gModalCancelBtn.textContent = 'Close';
        }
    } else {
        console.error("[openModal] Confirm or Cancel button not found!");
    }

    if (gFormOverlay) {
        gFormOverlay.classList.remove('hidden');
    }

    if (gModalContainer) {
        gModalContainer.classList.remove('hidden');
        setTimeout(() => {
            gModalContainer.classList.add('visible', 'modal-active');
        }, 10);
    } else {
        console.error("[openModal] gModalContainer is not defined!");
    }
}

function closeModal() {
    if (gModalContainer) {
        gModalContainer.classList.remove('visible');
        setTimeout(() => {
            gModalContainer.classList.add('hidden');
            gModalContainer.classList.remove('modal-active');

            if (!gLogRunFormContainer || !gLogRunFormContainer.classList.contains('visible')) {
                if (gFormOverlay) gFormOverlay.classList.add('hidden');
            }
        }, 300);
    }
    gModalConfirmCallback = null;
}

function closeFilterModal() {
    if (gFilterModalContainer) {
        gFilterModalContainer.classList.remove('visible');
        setTimeout(() => {
            gFilterModalContainer.classList.add('hidden');
            if (gFormOverlay &&
                (!gModalContainer || !gModalContainer.classList.contains('modal-active')) &&
                (!gLogRunFormContainer || !gLogRunFormContainer.classList.contains('visible'))
            ) {
                gFormOverlay.classList.add('hidden');
            }
        }, 300);
    }
}

function closeLogRunForm() {
    if (gLogRunFormContainer) {
        gLogRunFormContainer.classList.remove('visible');
        setTimeout(() => {
            gLogRunFormContainer.classList.add('hidden');
            if (gFormOverlay && (!gModalContainer || !gModalContainer.classList.contains('modal-active'))) {
                gFormOverlay.classList.add('hidden');
            }
            if (runForm) {
                runForm.reset();
                if (runIdToEditInput) runIdToEditInput.value = '';
                const submitButton = runForm.querySelector('button[type="submit"]');
                if (submitButton) submitButton.textContent = 'Add Run';
                const h2Title = runForm.querySelector('h2');
                if (h2Title) {
                    const existingSpan = h2Title.querySelector('#logForUser');
                    if (existingSpan) h2Title.innerHTML = `Log New Run for <span id="logForUser"></span>`;
                    else h2Title.innerHTML = `Log New Run for <span></span>`;
                }
            }
            if (deleteRunFromFormBtn) deleteRunFromFormBtn.classList.add('hidden');
        }, 300);
    } else if (gFormOverlay && (!gModalContainer || !gModalContainer.classList.contains('modal-active'))) {
        gFormOverlay.classList.add('hidden');
        if (deleteRunFromFormBtn) deleteRunFromFormBtn.classList.add('hidden');
    }
}

async function deleteRun(runIdToDelete) {
    const masterPassword = localStorage.getItem(MASTER_PASSWORD_LOCALSTORAGE_KEY);
    if (!masterPassword) {
        openModal("Authentication Error", "Master Shared Password not found. Please set it in Settings to delete runs.", 'error');
        return;
    }
    const hashedClientAuthKey = await getSha256Hash(masterPassword);
    if (!hashedClientAuthKey) {
        openModal("Security Key Error", "Could not generate security key for delete operation. Please try again or check console.", 'error');
        return;
    }

    const runToDelete = runs.find(run => run.id === runIdToDelete);
    const confirmMsg = runToDelete ?
        `Are you sure you want to delete this run? \n${runToDelete.date} - ${runToDelete.user} - ${runToDelete.distance} Km` :
        `Are you sure you want to delete run with ID: ${runIdToDelete}? (Run details not found in local cache)`;

    openModal("Confirm Deletion", confirmMsg, 'confirmation', async() => {
        try {
            if (!supabase) {
                openModal("Connection Error", "Supabase client not available. Cannot delete run.", 'error');
                return;
            }


            const { data, error } = await supabase.rpc('secure_delete_run', {
                run_id_to_delete: runIdToDelete,
                client_auth_key_param: hashedClientAuthKey
            });

            if (error) {
                console.error('[deleteRun] Error calling secure_delete_run RPC:', error);
                if (error.message && error.message.toLowerCase().includes('unauthorized: invalid auth key')) {
                    openModal("Delete Failed: Unauthorized", "The provided Master Password was incorrect. Run not deleted.", 'error');
                } else if (error.message && error.message.toLowerCase().includes('networkerror')) {
                    openModal("Network Error", "Could not connect to the server to delete the run. Please check your internet connection.", 'error');
                } else {
                    openModal("Delete Error", `An error occurred: ${error.message}`, 'error');
                }
                return;
            }


            runs = runs.filter(run => run.id !== runIdToDelete);
            document.dispatchEvent(new CustomEvent('dataChanged', { detail: { operation: 'delete', id: runIdToDelete } }));

            if (typeof data === 'string' && data.toLowerCase().includes('successfully deleted')) {

                closeModal();
                closeLogRunForm();
            } else if (typeof data === 'string') {
                openModal("Delete Operation Note", data, 'error');
            } else {
                closeModal();
            }

        } catch (rpcCatchError) {
            console.error('[deleteRun onConfirm callback] Catch block: Error during RPC call or processing:', rpcCatchError);
            openModal("Client-Side Error", `Error during delete operation: ${rpcCatchError.message}`, 'error');
        }
    });
}

document.addEventListener('DOMContentLoaded', async() => {
    gModalContainer = document.getElementById('modalContainer');
    gModalTitleEl = document.getElementById('modalTitle');
    gModalMessageEl = document.getElementById('modalMessage');
    gModalConfirmBtn = document.getElementById('modalConfirmBtn');
    gModalCancelBtn = document.getElementById('modalCancelBtn');
    gFormOverlay = document.getElementById('formOverlay');
    gLogRunFormContainer = document.getElementById('logRunFormContainer');
    console.log("[DOMContentLoaded] Global modal element variables assigned:", { gModalContainer, gModalTitleEl, gModalMessageEl, gModalConfirmBtn, gModalCancelBtn, gFormOverlay, gLogRunFormContainer });

    const darkModeToggle = document.getElementById('darkModeToggle');
    const documentElement = document.documentElement;

    runForm = document.getElementById('runForm');
    logForUserSpan = document.getElementById('logForUser');
    currentUserForRunInput = document.getElementById('currentUserForRun');
    runIdToEditInput = document.getElementById('runIdToEdit');
    deleteRunFromFormBtn = document.getElementById('deleteRunFromFormBtn');


    tabSpecificLogButtons = document.querySelectorAll('.showLogRunFormBtn');
    const closeLogRunFormBtn = document.getElementById('closeLogRunFormBtn');

    const timeInput = document.getElementById('time');
    const mphInput = document.getElementById('mph');
    const distanceInput = document.getElementById('distance');

    const runsTableBodySummary = document.getElementById('runsTableBodySummary');
    const runsTableBodyJason = document.getElementById('runsTableBodyJason');
    const runsTableBodyKelvin = document.getElementById('runsTableBodyKelvin');
    const userStatsTableBody = document.getElementById('userStatsTableBody'); // New reference

    const totalDistanceOverallJasonEl = document.getElementById('totalDistanceOverallJason');
    const totalDistance2025JasonEl = document.getElementById('totalDistance2025Jason');
    const totalVisits2025JasonEl = document.getElementById('totalVisits2025Jason');
    const avgKmDay2025JasonEl = document.getElementById('avgKmDay2025Jason');
    const goal2025JasonEl = document.getElementById('goal2025Jason'); // To read the goal value
    const percentToGoal2025JasonEl = document.getElementById('percentToGoal2025Jason');

    const totalDistanceOverallKelvinEl = document.getElementById('totalDistanceOverallKelvin');
    const totalDistance2025KelvinEl = document.getElementById('totalDistance2025Kelvin');
    const totalVisits2025KelvinEl = document.getElementById('totalVisits2025Kelvin');
    const avgKmDay2025KelvinEl = document.getElementById('avgKmDay2025Kelvin');
    const goal2025KelvinEl = document.getElementById('goal2025Kelvin'); // To read the goal value
    const percentToGoal2025KelvinEl = document.getElementById('percentToGoal2025Kelvin');

    const distanceOverTimeChartCanvas = document.getElementById('distanceOverTimeChart')?.getContext('2d');
    const totalKmChartCanvas = document.getElementById('totalKmChart')?.getContext('2d'); // New Consolidated
    const totalVisitsChartCanvas = document.getElementById('totalVisitsChart')?.getContext('2d'); // New Consolidated

    // Tabs
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');

    let currentTheme = localStorage.getItem('theme') || 'dark'; // Default to dark mode

    let distanceOverTimeChartInstance;
    let totalKmChartInstance;
    let totalVisitsChartInstance;

    let activeTab = 'summary'; // Default active tab

    // --- Elements for Summary Tab Activity Visualizations ---
    let jasonSummaryActivityTitleEl, jasonSummaryActivityMonthSelectEl, jasonSummaryActivityGridEl;
    let kelvinSummaryActivityTitleEl, kelvinSummaryActivityMonthSelectEl, kelvinSummaryActivityGridEl;
    // --- End Elements ---

    // Assign Summary Activity Visualization Elements EARLY
    jasonSummaryActivityTitleEl = document.getElementById('jasonSummaryActivityTitle');
    jasonSummaryActivityMonthSelectEl = document.getElementById('jasonSummaryActivityMonthSelect');
    jasonSummaryActivityGridEl = document.getElementById('jasonSummaryActivityGrid');

    kelvinSummaryActivityTitleEl = document.getElementById('kelvinSummaryActivityTitle');
    kelvinSummaryActivityMonthSelectEl = document.getElementById('kelvinSummaryActivityMonthSelect');
    kelvinSummaryActivityGridEl = document.getElementById('kelvinSummaryActivityGrid');
    console.log("[DOMContentLoaded] Summary activity DOM elements assigned EARLY:", { jasonSummaryActivityMonthSelectEl, kelvinSummaryActivityMonthSelectEl } // Log the elements themselves
    );

    // --- Definitions for calculateUserStats, populateSummaryActivityMonthSelects, updateSummaryActivityVisualization ---
    function calculateUserStats() {
        const yearForStats = 2025;
        const daysSoFarIn2025 = getNumberOfDaysSoFarInYear(yearForStats);

        let totalDistance2025Jason = 0,
            totalVisits2025Jason = 0,
            totalOverallJason = 0,
            totalVisitsOverallJason = 0;
        let totalDistance2025Kelvin = 0,
            totalVisits2025Kelvin = 0,
            totalOverallKelvin = 0,
            totalVisitsOverallKelvin = 0;

        runs.forEach(run => {
            const runDistance = parseFloat(run.distance) || 0;

            if (run.user === 'Jason') {
                totalOverallJason += runDistance;
                totalVisitsOverallJason++;
                if (new Date(run.date).getFullYear() === yearForStats) {
                    totalDistance2025Jason += runDistance;
                    totalVisits2025Jason++;
                }
            } else if (run.user === 'Kelvin') {
                totalOverallKelvin += runDistance;
                totalVisitsOverallKelvin++;
                if (new Date(run.date).getFullYear() === yearForStats) {
                    totalDistance2025Kelvin += runDistance;
                    totalVisits2025Kelvin++;
                }
            }
        });

        const jasonGoal = parseFloat(document.getElementById('goal2025Jason')?.textContent || '1000');
        const kelvinGoal = parseFloat(document.getElementById('goal2025Kelvin')?.textContent || '500');

        return [{
                user: "Jason",
                totalKm: totalOverallJason,
                totalKm2025: totalDistance2025Jason,
                visits2025: totalVisits2025Jason,
                avgKmDay2025: daysSoFarIn2025 > 0 ? (totalDistance2025Jason / daysSoFarIn2025) : 0,
                goal2025: jasonGoal,
                percentToGoal2025: jasonGoal > 0 ? (totalDistance2025Jason / jasonGoal) * 100 : 0,
            },
            {
                user: "Kelvin",
                totalKm: totalOverallKelvin,
                totalKm2025: totalDistance2025Kelvin,
                visits2025: totalVisits2025Kelvin,
                avgKmDay2025: daysSoFarIn2025 > 0 ? (totalDistance2025Kelvin / daysSoFarIn2025) : 0,
                goal2025: kelvinGoal,
                percentToGoal2025: kelvinGoal > 0 ? (totalDistance2025Kelvin / kelvinGoal) * 100 : 0,
            }
        ];
    }

    function populateSummaryActivityMonthSelects() {
        const selects = [
            { el: jasonSummaryActivityMonthSelectEl, user: 'Jason' },
            { el: kelvinSummaryActivityMonthSelectEl, user: 'Kelvin' }
        ];
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth(); // 0-indexed

        selects.forEach(item => {
            if (!item.el) return;
            item.el.innerHTML = ''; // Clear existing options

            for (let month = 0; month <= currentMonth; month++) {
                const date = new Date(currentYear, month, 1);
                const option = document.createElement('option');
                option.value = `${currentYear}-${String(month + 1).padStart(2, '0')}`; 
                option.textContent = date.toLocaleString('default', { month: 'long' });
                item.el.appendChild(option);
            }
            const defaultValue = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

            item.el.value = defaultValue;
            if (item.el.value !== defaultValue) {
                console.warn(`[populateSummaryActivityMonthSelects] Default value '${defaultValue}' for ${item.user} was not set. Current select value: '${item.el.value}'. Forcing selection of first option if available.`);
                if (item.el.options.length > 0) {
                    item.el.selectedIndex = 0;
                }
            } 
        });
    }

    function updateSummaryActivityVisualization(user) {
        let titleEl, selectEl, gridId;

        if (user === 'Jason') {
            titleEl = jasonSummaryActivityTitleEl;
            selectEl = jasonSummaryActivityMonthSelectEl;
            gridId = 'jasonSummaryActivityGrid';
        } else if (user === 'Kelvin') {
            titleEl = kelvinSummaryActivityTitleEl;
            selectEl = kelvinSummaryActivityMonthSelectEl;
            gridId = 'kelvinSummaryActivityGrid';
        } else {
            return; 
        }

        if (!titleEl || !selectEl) {
            console.warn(`[updateSummaryActivityVisualization] Missing elements for ${user}`);
            return;
        }

        const selectedValue = selectEl.value;
        const [yearStr, monthStr] = selectedValue.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthStr) - 1; 

        const displayDate = new Date(year, month, 1);
        titleEl.textContent = `${user}'s Activity - ${displayDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`;

        const runsForSummaryActivity = runs.filter(r => r.user === user);
        renderActivityVisualization(user, gridId, { targetDate: displayDate }, runsForSummaryActivity);
    }
    // --- End Definitions ---

    // --- Initial Population and Setup for Summary Activity Visualizations --- (THIS BLOCK ALREADY EXISTS AND CALLS THE FUNCTIONS ABOVE)
    // This block MUST run before the IIFE that uses the select values.
    if (jasonSummaryActivityMonthSelectEl && kelvinSummaryActivityMonthSelectEl) {
        populateSummaryActivityMonthSelects(); // Populates and sets default value
        // Add event listeners
        jasonSummaryActivityMonthSelectEl.addEventListener('change', () => updateSummaryActivityVisualization('Jason'));
        kelvinSummaryActivityMonthSelectEl.addEventListener('change', () => updateSummaryActivityVisualization('Kelvin'));

    } else {
        console.warn("[DOMContentLoaded] Summary activity month select elements not found for population (this check is before IIFE).");
    }
    // --- End Initial Population ---

    const masterSharedPasswordInput = document.getElementById('masterSharedPassword');
    const saveMasterPasswordBtn = document.getElementById('saveMasterPasswordBtn');
    const clearMasterPasswordBtn = document.getElementById('clearMasterPasswordBtn');
    const masterPasswordStatusEl = document.getElementById('masterPasswordStatus');

    // ---- Filter Modal Elements ----
    gFilterModalContainer = document.getElementById('filterModalContainer');
    filterForm = document.getElementById('filterForm');
    filterForUserSpan = document.getElementById('filterForUser');
    closeFilterModalBtn = document.getElementById('closeFilterModalBtn');
    resetFiltersBtn = document.getElementById('resetFiltersBtn');
    const showFilterModalBtns = document.querySelectorAll('.showFilterModalBtn');
    // ---- End Filter Modal Elements ----

    // Export Button
    const exportAllRunsBtn = document.getElementById('exportAllRunsBtn');

    // Add DOM elements for the new Error Modal
    // const errorModalContainer = document.getElementById('errorModalContainer'); // REMOVE - ID changed
    // const errorModalTitleEl = document.getElementById('errorModalTitle');     // REMOVE - ID changed
    // const errorModalMessageEl = document.getElementById('errorModalMessage');   // REMOVE - ID changed
    // const closeErrorModalBtn = document.getElementById('closeErrorModalBtn'); // REMOVE - ID changed

    // --- Selectors for new dropdowns ---
    const distanceChartPeriodSelect = document.getElementById('distanceChartPeriodSelect');
    const visitsChartPeriodSelect = document.getElementById('visitsChartPeriodSelect');
    const distanceOverTimeChartPeriodSelect = document.getElementById('distanceOverTimeChartPeriodSelect'); // New dropdown selector
    // --- End Selectors for new dropdowns ---

    // --- Dynamic Form Calculation for MPH/Distance ---
    function handleDynamicFormCalculation() {
        if (isCalculating) return; // Prevent infinite loops
        isCalculating = true;

        const timeString = timeInput.value;
        const timeMinutes = parseMMSS(timeString);
        const mph = parseFloat(mphInput.value);
        const distanceKm = parseFloat(distanceInput.value);

        if (isNaN(timeMinutes) || timeMinutes <= 0) {
            // If time is invalid, don't attempt calculations that depend on it
            // but still allow clearing the other field if one is focused
            if (activeCalculatorInput === 'mph' && document.activeElement === mphInput) {
                distanceInput.value = '';
            } else if (activeCalculatorInput === 'distance' && document.activeElement === distanceInput) {
                mphInput.value = '';
            }
            isCalculating = false;
            return;
        }

        if (activeCalculatorInput === 'mph') {
            if (!isNaN(mph) && mph > 0) {
                const kph = calculateKph(mph);
                const calculatedDistance = calculateDistance(timeMinutes, kph);
                distanceInput.value = calculatedDistance.toFixed(3);
            } else if (document.activeElement === mphInput && mphInput.value === '') {
                distanceInput.value = ''; // Clear distance if MPH is focused and cleared
            }
        } else if (activeCalculatorInput === 'distance') {
            if (!isNaN(distanceKm) && distanceKm > 0) {
                const calculatedMph = calculateMph(timeMinutes, distanceKm);
                mphInput.value = calculatedMph.toFixed(3);
            } else if (document.activeElement === distanceInput && distanceInput.value === '') {
                mphInput.value = ''; // Clear MPH if distance is focused and cleared
            }
        }
        isCalculating = false;
    }

    if (timeInput) {
        timeInput.addEventListener('input', () => {
            // When time changes, recalculate based on the last active input (MPH or Distance)
            handleDynamicFormCalculation();
        });
    }
    if (mphInput) {
        mphInput.addEventListener('focus', () => {
            activeCalculatorInput = 'mph';

        });
        mphInput.addEventListener('input', () => {
            if (document.activeElement === mphInput) { // Ensure calculation only if user is typing in this field
                activeCalculatorInput = 'mph';
                handleDynamicFormCalculation();
            }
        });
    }
    if (distanceInput) {
        distanceInput.addEventListener('focus', () => {
            activeCalculatorInput = 'distance';

        });
        distanceInput.addEventListener('input', () => {
            if (document.activeElement === distanceInput) { // Ensure calculation only if user is typing in this field
                activeCalculatorInput = 'distance';
                handleDynamicFormCalculation();
            }
        });
    }
    // --- End Dynamic Form Calculation ---

    // --- Settings Page Logic ---
    function updateMasterPasswordStatus(transientMessage = null) {
        if (!masterPasswordStatusEl) return;
        const savedPassword = localStorage.getItem(MASTER_PASSWORD_LOCALSTORAGE_KEY);
        const isReadOnly = !savedPassword; // True if no password saved, meaning input should be editable

        // Helper to set enabled/disabled state
        const setInputDisabledState = (disabled) => {
            if (masterSharedPasswordInput) masterSharedPasswordInput.disabled = disabled;
            if (saveMasterPasswordBtn) saveMasterPasswordBtn.disabled = disabled;
            // New logic for clear button
            if (clearMasterPasswordBtn) clearMasterPasswordBtn.disabled = !disabled; // Opposite of save/input
        };

        if (transientMessage) {
            masterPasswordStatusEl.textContent = transientMessage;
            if (transientMessage.toLowerCase().includes('please enter')) {
                masterPasswordStatusEl.style.color = "var(--warning-color)";
                setInputDisabledState(false);
            } else if (transientMessage.toLowerCase().includes('saved')) {
                masterPasswordStatusEl.style.color = "var(--success-color)";
                setInputDisabledState(true); // Password saved, so input/save are disabled, clear is enabled
            } else {
                masterPasswordStatusEl.style.color = "var(--warning-color)";
            }

            setTimeout(() => {
                const currentSavedPassword = localStorage.getItem(MASTER_PASSWORD_LOCALSTORAGE_KEY);
                if (currentSavedPassword) {
                    masterPasswordStatusEl.textContent = "A Master Shared Password is currently saved.";
                    masterPasswordStatusEl.style.color = "var(--success-color)";
                    if (masterSharedPasswordInput) masterSharedPasswordInput.placeholder = "Saved (hidden)";
                    setInputDisabledState(true); // Password saved, input/save disabled, clear enabled
                } else {
                    masterPasswordStatusEl.textContent = "No Master Shared Password saved.";
                    masterPasswordStatusEl.style.color = "var(--danger-color)";
                    if (masterSharedPasswordInput) masterSharedPasswordInput.placeholder = "Enter password to save";
                    setInputDisabledState(false); // No password, input/save enabled, clear disabled
                }
            }, 2500);
        } else {
            // Standard status update
            if (savedPassword) {
                masterPasswordStatusEl.textContent = "A Master Shared Password is currently saved.";
                masterPasswordStatusEl.style.color = "var(--success-color)";
                if (masterSharedPasswordInput) masterSharedPasswordInput.placeholder = "Saved (hidden)";
                setInputDisabledState(true); // Password saved, input/save disabled, clear enabled
            } else {
                masterPasswordStatusEl.textContent = "No Master Shared Password saved.";
                masterPasswordStatusEl.style.color = "var(--danger-color)";
                if (masterSharedPasswordInput) masterSharedPasswordInput.placeholder = "Enter password to save";
                setInputDisabledState(false); // No password, input/save enabled, clear disabled
            }
        }

        // Control visibility of "Log Run" buttons (remains the same)
        if (tabSpecificLogButtons) {
            tabSpecificLogButtons.forEach(btn => {
                btn.style.display = isReadOnly ? 'none' : '';
            });
        }
    }

    if (masterSharedPasswordInput) { // Add keypress listener for Enter key
        masterSharedPasswordInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault(); // Prevent any default action (like form submission)
                if (saveMasterPasswordBtn && !saveMasterPasswordBtn.disabled) {
                    saveMasterPasswordBtn.click();
                }
            }
        });
    }

    if (saveMasterPasswordBtn) {
        saveMasterPasswordBtn.addEventListener('click', () => {
            if (!masterSharedPasswordInput) return;
            const passwordToSave = masterSharedPasswordInput.value;
            if (passwordToSave) {
                localStorage.setItem(MASTER_PASSWORD_LOCALSTORAGE_KEY, passwordToSave);
                masterSharedPasswordInput.value = '';
                updateMasterPasswordStatus(); // Show persistent status (which will disable input/button)
            } else {
                updateMasterPasswordStatus("Please enter a password to save."); // Show error, input remains enabled
            }
        });
    }

    if (clearMasterPasswordBtn) {
        clearMasterPasswordBtn.addEventListener('click', () => {
            localStorage.removeItem(MASTER_PASSWORD_LOCALSTORAGE_KEY);
            updateMasterPasswordStatus(); // Show persistent status (which will enable input/button)
        });
    }
    // --- End Settings Page Logic ---

    // --- Export Data Logic ---
    if (exportAllRunsBtn) {
        exportAllRunsBtn.addEventListener('click', () => {
            if (!runs || runs.length === 0) {
                openModal("Export Error", "There is no data to export.", 'error');
                return;
            }

            try {
                // Filter out auth_key before stringifying
                const runsToExport = runs.map(run => {
                    const { auth_key, ...rest } = run; // Destructure to exclude auth_key
                    return rest;
                });

                const jsonData = JSON.stringify(runsToExport, null, 2); // Pretty print JSON
                const blob = new Blob([jsonData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');

                const today = new Date();
                const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                a.download = `run_logger_export_${dateString}.json`;

                a.href = url;
                document.body.appendChild(a); // Append to body to make it clickable
                a.click();
                document.body.removeChild(a); // Clean up
                URL.revokeObjectURL(url); // Release object URL

                openModal("Export Successful", "All run data has been exported as a JSON file.", 'success');
            } catch (error) {
                console.error("Error exporting data:", error);
                openModal("Export Error", `An unexpected error occurred during export: ${error.message}`, 'error');
            }
        });
    }
    // --- End Export Data Logic ---

    // --- Corrected Modal Event Listeners (using global gModal... buttons and global closeModal) ---
    if (gModalConfirmBtn) {
        gModalConfirmBtn.addEventListener('click', () => {
            if (typeof gModalConfirmCallback === 'function') {
                gModalConfirmCallback(); // Execute the stored callback
                // DO NOT call closeModal() here anymore. The callback is responsible.
            }
            // If there was no callback, the button click does nothing other than what CSS provides (e.g. active state)
            // This case (no callback for a visible confirm button) should ideally not happen with current openModal logic.
        });
    }
    if (gModalCancelBtn) {
        gModalCancelBtn.addEventListener('click', closeModal); // Cancel just closes the modal
    }

    // --- Update Consolidated gFormOverlay click listener ---
    if (gFormOverlay) {
        gFormOverlay.addEventListener('click', () => {
            if (gModalContainer && gModalContainer.classList.contains('modal-active')) { // Check generic modal first
                closeModal();
            } else if (gLogRunFormContainer && gLogRunFormContainer.classList.contains('visible')) { // Then check log run form
                closeLogRunForm();
            } else if (gFilterModalContainer && gFilterModalContainer.classList.contains('visible')) { // Then check filter form
                closeFilterModal();
            }
        });
    }

    // --- Dark Mode Functions ---
    function applyTheme(theme) {
        // Log entry
        if (theme === 'dark') {
            // Log branch
            documentElement.classList.add('dark-mode');
            if (darkModeToggle) darkModeToggle.checked = true; // Set checkbox to checked for dark mode
        } else {
            // Log branch
            documentElement.classList.remove('dark-mode');
            if (darkModeToggle) darkModeToggle.checked = false; // Set checkbox to unchecked for light mode
        }
        currentTheme = theme;
        localStorage.setItem('theme', theme);
        // Log state
        // Log state

        // Update charts whenever theme changes
        if (activeTab === 'summary') {
            renderConsolidatedCharts();
            updateDistanceOverTimeChart();
            // Ensure select has a value before attempting to update visualization from theme change
            if (jasonSummaryActivityMonthSelectEl && jasonSummaryActivityMonthSelectEl.value) {

                updateSummaryActivityVisualization('Jason');
            } else {
                console.warn("[applyTheme] Jason's summary activity month select has NO VALUE or element not found. Skipping update from theme change.");
            }
            if (kelvinSummaryActivityMonthSelectEl && kelvinSummaryActivityMonthSelectEl.value) {

                updateSummaryActivityVisualization('Kelvin');
            } else {
                console.warn("[applyTheme] Kelvin's summary activity month select has NO VALUE or element not found. Skipping update from theme change.");
            }
        }
        updateMasterPasswordStatus(); // Also call here after everything is loaded
    }

    if (darkModeToggle) {
        // Set initial state of the toggle based on currentTheme which was set by the IIFE or localStorage
        darkModeToggle.checked = (currentTheme === 'dark');

        darkModeToggle.addEventListener('change', () => { // Listen for change on the checkbox
            const newTheme = darkModeToggle.checked ? 'dark' : 'light';

            applyTheme(newTheme);
        });
    }

    // --- Chart Color Helper ---
    function getChartColors() {
        const isDarkMode = currentTheme === 'dark';
        return {
            gridColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
            ticksColor: isDarkMode ? '#e0e0e0' : '#333',
            legendLabelColor: isDarkMode ? '#e0e0e0' : '#333',
            titleColor: isDarkMode ? '#f5f5f5' : '#343a40',
            jasonColor: isDarkMode ? 'rgba(54, 162, 235, 0.7)' : 'rgba(0, 123, 255, 0.6)', // Blue
            jasonBorderColor: isDarkMode ? 'rgba(54, 162, 235, 1)' : 'rgba(0, 123, 255, 1)',
            kelvinColor: isDarkMode ? 'rgba(255, 206, 86, 0.7)' : 'rgba(255, 193, 7, 0.6)', // Yellow
            kelvinBorderColor: isDarkMode ? 'rgba(255, 206, 86, 1)' : 'rgba(255, 193, 7, 1)',
            // Add more colors if needed for different charts or datasets
        };
    }

    // --- Helper & Core Functions defined within DOMContentLoaded ---
    function renderTable(tableBody, runsToDisplay, isSummaryTable = false) {
        tableBody.innerHTML = '';
        if (!runsToDisplay || runsToDisplay.length === 0) {
            let colspan = 11; // Default for summary table
            if (tableBody.id === 'runsTableBodyJason') {
                colspan = 8; // Date, Day, Type, Time, MPH, Km/hr, Distance, Notes
            } else if (tableBody.id === 'runsTableBodyKelvin') {
                colspan = 10; // Kelvin's table retains BPM, +1, Delta, excludes User
            }
            tableBody.innerHTML = `<tr class="no-data-message"><td colspan="${colspan}">No runs logged yet.</td></tr>`;
            return;
        }
        runsToDisplay.forEach(run => {
            const row = tableBody.insertRow();
            if (isSummaryTable) row.insertCell().textContent = run.user;
            row.insertCell().textContent = new Date(run.date + 'T00:00:00').toLocaleDateString('en-GB');

            const dayCell = row.insertCell();
            dayCell.textContent = run.day;
            if (!isSummaryTable) dayCell.classList.add('hide-on-mobile');

            row.insertCell().textContent = run.type || '-'; // Display type, default to '-'

            row.insertCell().textContent = run.time;
            row.insertCell().textContent = run.mph.toFixed(1);

            const kphCell = row.insertCell();
            // kphCell.textContent = run.kph.toFixed(3);
            const paceMinPerKm = calculateMinPerKm(run.kph);
            kphCell.textContent = isFinite(paceMinPerKm) ? formatMinutesToMMSS(paceMinPerKm) : '-'; // Display pace in MM:SS
            if (!isSummaryTable) kphCell.classList.add('hide-on-mobile');

            const distanceCell = row.insertCell();
            distanceCell.textContent = run.distance.toFixed(3);

            if (tableBody.id === 'runsTableBodyJason') {
                const notesCell = row.insertCell(); // Notes for Jason
                notesCell.textContent = run.notes || '-';
                notesCell.classList.add('hide-on-mobile');
            } else {
                // For Summary and Kelvin, include BPM, +1, Delta
                const bpmCell = row.insertCell();
                bpmCell.textContent = run.bpm !== null ? run.bpm : '-';
                if (!isSummaryTable) bpmCell.classList.add('hide-on-mobile');

                const plus1Cell = row.insertCell();
                plus1Cell.textContent = run.plus1 !== null ? run.plus1 : '-';
                if (!isSummaryTable) plus1Cell.classList.add('hide-on-mobile');

                const deltaCell = row.insertCell();
                deltaCell.textContent = run.delta !== null ? run.delta : '-';
                if (!isSummaryTable) deltaCell.classList.add('hide-on-mobile');
            }

            if (!isSummaryTable) {
                // const actionsCell = row.insertCell(); // Removed
                // actionsCell.classList.add('actions-cell'); // Removed

                // Delete button (old one) - REMOVED
                // const deleteBtn = document.createElement('button');
                // deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                // deleteBtn.classList.add('action-btn', 'delete-btn');
                // deleteBtn.setAttribute('aria-label', 'Delete run');
                // deleteBtn.onclick = function(event) { 
                //     event.stopPropagation(); 
                //     deleteRun(run.id);
                // };
                // actionsCell.appendChild(deleteBtn);

                // Make the entire row clickable to edit
                row.style.cursor = 'pointer'; // Add pointer cursor to indicate clickability
                row.addEventListener('click', function() {
                    openEditForm(run.id);
                });
            }
        });
    }

    // --- Table Sorting Functions ---
    function updateSortIndicators(tableBody, activeSortColumn, activeSortDirection) {
        const table = tableBody.closest('table');
        if (!table) return;
        const headers = table.querySelectorAll('th.sortable-header');
        headers.forEach(th => {
            const span = th.querySelector('span');
            if (span) {
                span.classList.remove('sort-asc', 'sort-desc');
                if (th.dataset.column === activeSortColumn) {
                    span.classList.add(activeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
                }
            }
        });
    }

    // Modified sortTableByColumn to accept an optional explicitDirection
    function sortTableByColumn(tableBody, columnKey, runsToSort, isSummaryTable, explicitDirection = null) {
        let newSortCol = columnKey;
        let newSortDir;

        if (explicitDirection) {
            newSortDir = explicitDirection;
        } else { // Called from a click, determine direction
            const currentDatasetSortCol = tableBody.dataset.sortColumn;
            const currentDatasetSortDir = tableBody.dataset.sortDirection;

            if (currentDatasetSortCol === columnKey) {
                newSortDir = (currentDatasetSortDir === 'asc') ? 'desc' : 'asc';
            } else {
                newSortDir = (columnKey === 'date') ? 'desc' : 'asc'; // Default for new column
            }
        }

        tableBody.dataset.sortColumn = newSortCol;
        tableBody.dataset.sortDirection = newSortDir;

        const sortedRuns = [...runsToSort].sort((a, b) => {
            let valA = a[newSortCol];
            let valB = b[newSortCol];

            // Handle null or undefined values - typically sort them to the bottom or top
            if (valA === null || valA === undefined) return 1; // valA comes after valB
            if (valB === null || valB === undefined) return -1; // valB comes after valA

            switch (newSortCol) {
                case 'date':
                    return new Date(valA) - new Date(valB);
                case 'time':
                    const valAMinutes = parseMMSS(valA);
                    const valBMinutes = parseMMSS(valB);
                    if (isNaN(valAMinutes) && isNaN(valBMinutes)) return 0;
                    if (isNaN(valAMinutes)) return 1; // Sort NaN to the end
                    if (isNaN(valBMinutes)) return -1;
                    return valAMinutes - valBMinutes;
                case 'mph':
                case 'distance':
                    return parseFloat(valA) - parseFloat(valB);
                case 'kph': // Now represents Min/Km (lower is faster)
                    const paceA = calculateMinPerKm(a.kph); // a.kph still stores the raw kph value
                    const paceB = calculateMinPerKm(b.kph);
                    if (!isFinite(paceA) && !isFinite(paceB)) return 0;
                    if (!isFinite(paceA)) return 1; // Infinity (no pace) sorts to the end
                    if (!isFinite(paceB)) return -1;
                    return paceA - paceB;
                case 'bpm':
                case 'plus1':
                case 'delta':
                    return valA.toString().toLowerCase().localeCompare(valB.toString().toLowerCase());
                case 'type': // Add case for sorting by type
                case 'notes': // Add case for sorting by notes
                    valA = valA || ''; // Handle null/undefined as empty string for comparison
                    valB = valB || '';
                    return valA.toLowerCase().localeCompare(valB.toLowerCase());
                default:
                    return 0;
            }
        });

        if (newSortDir === 'desc') {
            sortedRuns.reverse();
        }

        renderTable(tableBody, sortedRuns, isSummaryTable);
        updateSortIndicators(tableBody, newSortCol, newSortDir);
    }

    // Simplified attachSortListenersToTable
    function attachSortListenersToTable(tableBody, getRunsForTableFunction, isSummaryTable) {
        if (!tableBody) return;
        const table = tableBody.closest('table');
        if (!table) return;
        const headers = table.querySelectorAll('th.sortable-header');

        // Removed initial sort state setting from here

        headers.forEach(th => {
            th.addEventListener('click', () => {
                const columnKeyClicked = th.dataset.column;
                if (columnKeyClicked) {
                    let runsForThisTable = getRunsForTableFunction(); // Get user-specific runs
                    // Determine the user based on the tableBody ID to apply correct filters
                    let userForFiltering = null;
                    if (tableBody.id === 'runsTableBodyJason') {
                        userForFiltering = 'Jason';
                    } else if (tableBody.id === 'runsTableBodyKelvin') {
                        userForFiltering = 'Kelvin';
                    }
                    // If it's a user-specific table, apply current filters for that user
                    if (userForFiltering) {
                        runsForThisTable = applyAllFilters(runsForThisTable, userForFiltering);
                    }
                    // For the summary table, we don't apply user-specific active filters here, 
                    // as it shows all runs (or could have its own separate filter logic if ever needed).
                    // The initial render of summary table already handles general sorting.

                    // Call sortTableByColumn WITHOUT explicitDirection for clicks
                    sortTableByColumn(tableBody, columnKeyClicked, runsForThisTable, isSummaryTable);
                }
            });
        });
        // Removed initial call to updateSortIndicators from here
    }
    // --- End Table Sorting Functions ---

    // --- User Statistics Table Functions ---
    function renderUserStatsTable(statsArray) {
        if (!userStatsTableBody) return;
        userStatsTableBody.innerHTML = ''; // Clear existing rows

        if (!statsArray || statsArray.length === 0) {
            // This case should ideally not happen for the stats table as it's fixed to 2 users.
            // But as a fallback:
            userStatsTableBody.innerHTML = '<tr><td colspan="7">No statistics available.</td></tr>';
            return;
        }

        statsArray.forEach(userStat => {
            const row = userStatsTableBody.insertRow();
            row.id = userStat.user.toLowerCase() + "StatsRow"; // Re-add ID for potential future use, though direct DOM manipulation for these cells is reduced

            row.insertCell().textContent = userStat.user;
            row.insertCell().textContent = userStat.totalKm.toFixed(3);
            row.insertCell().textContent = userStat.totalKm2025.toFixed(3);
            row.insertCell().textContent = userStat.visits2025;
            row.insertCell().textContent = userStat.avgKmDay2025.toFixed(3);
            row.insertCell().textContent = userStat.goal2025; // Goal is already formatted
            row.insertCell().textContent = userStat.percentToGoal2025.toFixed(2) + '%';
        });
    }

    function sortUserStatsTable(statsArray, columnKey, explicitDirection = null) {
        if (!userStatsTableBody || !statsArray) return;

        let newSortCol = columnKey;
        let newSortDir;

        if (explicitDirection) {
            newSortDir = explicitDirection;
        } else {
            const currentDatasetSortCol = userStatsTableBody.dataset.sortColumn;
            const currentDatasetSortDir = userStatsTableBody.dataset.sortDirection;

            if (currentDatasetSortCol === columnKey) {
                newSortDir = (currentDatasetSortDir === 'asc') ? 'desc' : 'asc';
            } else {
                // Default sort directions for new columns in stats table
                switch (columnKey) {
                    case 'user':
                        newSortDir = 'asc';
                        break;
                    default: // For all numeric stats columns
                        newSortDir = 'desc';
                        break;
                }
            }
        }

        userStatsTableBody.dataset.sortColumn = newSortCol;
        userStatsTableBody.dataset.sortDirection = newSortDir;

        const sortedStats = [...statsArray].sort((a, b) => {
            let valA = a[columnKey];
            let valB = b[columnKey];

            // Handle cases for different data types
            if (typeof valA === 'string' && typeof valB === 'string') {
                return valA.toLowerCase().localeCompare(valB.toLowerCase());
            } else if (typeof valA === 'number' && typeof valB === 'number') {
                return valA - valB;
            }
            // Add more type handling if necessary, though stats are mostly numbers or user string
            return 0;
        });

        if (newSortDir === 'desc') {
            sortedStats.reverse();
        }

        renderUserStatsTable(sortedStats);
        updateSortIndicators(userStatsTableBody, newSortCol, newSortDir); // Assuming updateSortIndicators can target tbody directly
    }

    function attachSortListenersToStatsTable() {
        if (!userStatsTableBody) return;
        const table = userStatsTableBody.closest('table');
        if (!table) return;
        const headers = table.querySelectorAll('th.sortable-header');

        headers.forEach(th => {
            th.addEventListener('click', () => {
                const columnKeyClicked = th.dataset.column;
                if (columnKeyClicked) {
                    // Recalculate stats and sort with the new column.
                    // updateStatistics() will handle getting data and calling sortUserStatsTable
                    // We need to pass the clicked column to sortUserStatsTable through updateStatistics or have sortUserStatsTable
                    // handle the click event logic for fetching current stats and column.

                    // Simpler: Click calls sortUserStatsTable directly.
                    // This means `updateStatistics` is primarily for chart data now, and user stats data calculation
                    // needs to be accessible to the click handler for sorting.

                    // Let's make `calculateUserStats` a standalone function and call it from here.
                    const currentStats = calculateUserStats(); // You'll need to define this function based on updateStatistics logic
                    sortUserStatsTable(currentStats, columnKeyClicked); // No explicit direction, so it toggles or sets default
                }
            });
        });
    }
    // --- End User Statistics Table Functions ---

    function renderAllRuns() {
        // For Summary Table
        if (runsTableBodySummary) {
            let summaryRunsToRender = [...runs];
            const currentSortCol = runsTableBodySummary.dataset.sortColumn;
            const currentSortDir = runsTableBodySummary.dataset.sortDirection;
            if (currentSortCol && currentSortDir) {
                sortTableByColumn(runsTableBodySummary, currentSortCol, summaryRunsToRender, true, currentSortDir);
            } else {
                sortTableByColumn(runsTableBodySummary, 'date', summaryRunsToRender, true, 'desc'); // Default initial sort
            }
        }

        // For Jason's Table
        let jasonRunsForTable = [];
        const jasonEntryCountEl = document.getElementById('jasonEntryCount');
        if (runsTableBodyJason) {
            let initialJasonRuns = runs.filter(run => run.user === 'Jason');
            jasonRunsForTable = applyAllFilters(initialJasonRuns, 'Jason');
            const currentSortCol = runsTableBodyJason.dataset.sortColumn;
            const currentSortDir = runsTableBodyJason.dataset.sortDirection;
            if (currentSortCol && currentSortDir) {
                sortTableByColumn(runsTableBodyJason, currentSortCol, jasonRunsForTable, false, currentSortDir);
            } else {
                sortTableByColumn(runsTableBodyJason, 'date', jasonRunsForTable, false, 'desc'); // Default initial sort
            }
            if (jasonEntryCountEl) {
                jasonEntryCountEl.textContent = ` (${jasonRunsForTable.length} entries)`;
            }
        }

        // For Kelvin's Table
        let kelvinRunsForTable = [];
        const kelvinEntryCountEl = document.getElementById('kelvinEntryCount');
        if (runsTableBodyKelvin) {
            let initialKelvinRuns = runs.filter(run => run.user === 'Kelvin');
            kelvinRunsForTable = applyAllFilters(initialKelvinRuns, 'Kelvin');
            const currentSortCol = runsTableBodyKelvin.dataset.sortColumn;
            const currentSortDir = runsTableBodyKelvin.dataset.sortDirection;
            if (currentSortCol && currentSortDir) {
                sortTableByColumn(runsTableBodyKelvin, currentSortCol, kelvinRunsForTable, false, currentSortDir);
            } else {
                sortTableByColumn(runsTableBodyKelvin, 'date', kelvinRunsForTable, false, 'desc'); // Default initial sort
            }
            if (kelvinEntryCountEl) {
                kelvinEntryCountEl.textContent = ` (${kelvinRunsForTable.length} entries)`;
            }
        }

        // Update activity visualizations if on the respective tabs
        if (activeTab === 'jason') {
            if (runsTableBodyJason) { // Check element existence
                 renderActivityVisualization('Jason', 'jasonTabActivityGrid', { displayMonths: 5 }, jasonRunsForTable);
            }
        } else if (activeTab === 'kelvin') {
            if (runsTableBodyKelvin) { // Check element existence
                renderActivityVisualization('Kelvin', 'kelvinTabActivityGrid', { displayMonths: 5 }, kelvinRunsForTable);
            }
        }
    }

    function updateStatistics() {
        let totalDistanceOverall = 0;
        let totalDistance2025Jason = 0,
            totalVisits2025Jason = 0,
            totalOverallJason = 0,
            totalVisitsOverallJason = 0;
        let totalDistance2025Kelvin = 0,
            totalVisits2025Kelvin = 0,
            totalOverallKelvin = 0,
            totalVisitsOverallKelvin = 0;

        const yearForStats = 2025;
        const daysSoFarIn2025 = getNumberOfDaysSoFarInYear(yearForStats);

        runs.forEach(run => {
            const runDistance = parseFloat(run.distance) || 0;
            totalDistanceOverall += runDistance;

            if (run.user === 'Jason') {
                totalOverallJason += runDistance;
                totalVisitsOverallJason++;
                if (new Date(run.date).getFullYear() === yearForStats) {
                    totalDistance2025Jason += runDistance;
                    totalVisits2025Jason++;
                }
            } else if (run.user === 'Kelvin') {
                totalOverallKelvin += runDistance;
                totalVisitsOverallKelvin++;
                if (new Date(run.date).getFullYear() === yearForStats) {
                    totalDistance2025Kelvin += runDistance;
                    totalVisits2025Kelvin++;
                }
            }
        });

        // Calculate Jason's 2025 derived stats
        const avgKmDay2025Jason = daysSoFarIn2025 > 0 ? (totalDistance2025Jason / daysSoFarIn2025) : 0;
        const goal2025Jason = parseFloat(goal2025JasonEl?.textContent || '500'); // Read from DOM or default
        const percentToGoal2025Jason = goal2025Jason > 0 ? (totalDistance2025Jason / goal2025Jason) * 100 : 0;

        // Calculate Kelvin's 2025 derived stats
        const avgKmDay2025Kelvin = daysSoFarIn2025 > 0 ? (totalDistance2025Kelvin / daysSoFarIn2025) : 0;
        const goal2025Kelvin = parseFloat(goal2025KelvinEl?.textContent || '500'); // Read from DOM or default
        const percentToGoal2025Kelvin = goal2025Kelvin > 0 ? (totalDistance2025Kelvin / goal2025Kelvin) * 100 : 0;

        // Populate the new statistics table
        if (totalDistanceOverallJasonEl) totalDistanceOverallJasonEl.textContent = totalOverallJason.toFixed(3);
        if (totalDistance2025JasonEl) totalDistance2025JasonEl.textContent = totalDistance2025Jason.toFixed(3);
        if (totalVisits2025JasonEl) totalVisits2025JasonEl.textContent = totalVisits2025Jason;
        if (avgKmDay2025JasonEl) avgKmDay2025JasonEl.textContent = avgKmDay2025Jason.toFixed(3);
        if (percentToGoal2025JasonEl) percentToGoal2025JasonEl.textContent = percentToGoal2025Jason.toFixed(2) + '%';

        if (totalDistanceOverallKelvinEl) totalDistanceOverallKelvinEl.textContent = totalOverallKelvin.toFixed(3);
        if (totalDistance2025KelvinEl) totalDistance2025KelvinEl.textContent = totalDistance2025Kelvin.toFixed(3);
        if (totalVisits2025KelvinEl) totalVisits2025KelvinEl.textContent = totalVisits2025Kelvin;
        if (avgKmDay2025KelvinEl) avgKmDay2025KelvinEl.textContent = avgKmDay2025Kelvin.toFixed(3);
        if (percentToGoal2025KelvinEl) percentToGoal2025KelvinEl.textContent = percentToGoal2025Kelvin.toFixed(2) + '%';

        // Re-render charts if summary tab is active, using theme-aware colors
        if (activeTab === 'summary') {
            renderConsolidatedCharts(); // New function to handle both consolidated charts
            updateDistanceOverTimeChart();
        }

        // Determine sort parameters for userStatsTable
        const statsSortCol = userStatsTableBody.dataset.sortColumn || 'user'; // Default sort column
        const statsSortDir = userStatsTableBody.dataset.sortDirection || 'asc'; // Default sort direction

        // Call sortUserStatsTable which will then call renderUserStatsTable
        sortUserStatsTable(calculateUserStats(), statsSortCol, statsSortDir);
    }

    function renderBarChart(canvasContext, chartInstance, chartTitle, labels, datasets, yAxisLabel = 'Distance (Km)') {
        if (!canvasContext) return null;
        const chartContainer = canvasContext.canvas.parentElement;
        if (!chartContainer || chartContainer.offsetParent === null) { // Check if visible
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }
            return null; // Don't render if not visible
        }
        if (chartInstance) chartInstance.destroy(); // Destroy existing chart before re-rendering

        const colors = getChartColors();

        return new Chart(canvasContext, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: yAxisLabel, font: { size: 14 }, color: colors.ticksColor },
                        grid: { color: colors.gridColor },
                        ticks: {
                            color: colors.ticksColor,
                            precision: 0 // Ensure y-axis ticks are whole numbers for visit counts
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: colors.ticksColor }
                    }
                },
                plugins: {
                    legend: {
                        display: datasets.length > 1,
                        labels: { font: { size: 14 }, color: colors.legendLabelColor }
                    },
                    title: {
                        display: !!chartTitle, // only display if title is provided
                        text: chartTitle,
                        font: { size: 16 },
                        color: colors.titleColor
                    }
                }
            }
        });
    }

    // Consolidated function to render the Total KM chart based on selected period
    function renderTotalKmChart(chartData) {
        if (!totalKmChartCanvas) return;
        const colors = getChartColors();
        totalKmChartInstance = renderBarChart(
            totalKmChartCanvas,
            totalKmChartInstance,
            '', // Title is now in HTML h2
            ['Jason', 'Kelvin'], [{
                label: 'Total KM',
                data: [chartData.jason.toFixed(3), chartData.kelvin.toFixed(3)],
                backgroundColor: [colors.jasonColor, colors.kelvinColor],
                borderColor: [colors.jasonBorderColor, colors.kelvinBorderColor],
                borderWidth: 1
            }]
        );
    }

    // Consolidated function to render the Total Visits chart based on selected period
    function renderTotalVisitsChart(chartData) {
        if (!totalVisitsChartCanvas) return;
        const colors = getChartColors();
        totalVisitsChartInstance = renderBarChart(
            totalVisitsChartCanvas,
            totalVisitsChartInstance,
            '', // Title is in HTML h2
            ['Jason', 'Kelvin'], [{
                label: 'Total Visits',
                data: [chartData.jason, chartData.kelvin],
                backgroundColor: [colors.jasonColor, colors.kelvinColor],
                borderColor: [colors.jasonBorderColor, colors.kelvinBorderColor],
                borderWidth: 1
            }],
            'Visits' // Y-axis label for visits
        );
    }

    function updateDistanceOverTimeChart() {
        if (!distanceOverTimeChartCanvas) return;
        const chartContainer = distanceOverTimeChartCanvas.canvas.parentElement;
        if (!chartContainer || chartContainer.offsetParent === null) { // Check if visible
            if (distanceOverTimeChartInstance) {
                distanceOverTimeChartInstance.destroy();
                distanceOverTimeChartInstance = null; // Ensure instance is nulled
            }
            return;
        }

        if (distanceOverTimeChartInstance) {
            distanceOverTimeChartInstance.destroy();
            distanceOverTimeChartInstance = null; // Ensure instance is nulled here too
        }

        const selectedPeriod = distanceOverTimeChartPeriodSelect ? distanceOverTimeChartPeriodSelect.value : 'allTime';

        let filteredRuns = [...runs];
        if (selectedPeriod !== 'allTime') {
            const yearToFilter = parseInt(selectedPeriod);
            filteredRuns = runs.filter(run => new Date(run.date).getFullYear() === yearToFilter);
        }

        const sortedRuns = filteredRuns.sort((a, b) => new Date(a.date) - new Date(b.date));
        const jasonRuns = sortedRuns.filter(run => run.user === 'Jason');
        const kelvinRuns = sortedRuns.filter(run => run.user === 'Kelvin');

        const jasonCumulative = jasonRuns.reduce((acc, run) => {
            const dist = parseFloat(run.distance) || 0;
            const lastVal = acc.length > 0 ? acc[acc.length - 1].y : 0;
            acc.push({ x: run.date, y: lastVal + dist });
            return acc;
        }, []);
        const kelvinCumulative = kelvinRuns.reduce((acc, run) => {
            const dist = parseFloat(run.distance) || 0;
            const lastVal = acc.length > 0 ? acc[acc.length - 1].y : 0;
            acc.push({ x: run.date, y: lastVal + dist });
            return acc;
        }, []);

        // Create a unique set of all dates for the x-axis
        const allDates = [...new Set([...jasonCumulative.map(d => d.x), ...kelvinCumulative.map(d => d.x)])].sort((a, b) => new Date(a) - new Date(b));

        const colors = getChartColors();

        distanceOverTimeChartInstance = new Chart(distanceOverTimeChartCanvas, {
            type: 'line',
            data: {
                // labels: allDates, // Using time scale, labels are inferred
                datasets: [{
                        label: 'Jason - Cumulative Distance',
                        data: jasonCumulative,
                        borderColor: colors.jasonBorderColor,
                        backgroundColor: colors.jasonColor,
                        tension: 0.1,
                        fill: false
                    },
                    {
                        label: 'Kelvin - Cumulative Distance',
                        data: kelvinCumulative,
                        borderColor: colors.kelvinBorderColor,
                        backgroundColor: colors.kelvinColor,
                        tension: 0.1,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month' }, // Adjust unit as needed
                        title: { display: true, text: 'Date', font: { size: 14 }, color: colors.ticksColor },
                        grid: { color: colors.gridColor },
                        ticks: { color: colors.ticksColor }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Cumulative Distance (Km)', font: { size: 14 }, color: colors.ticksColor },
                        grid: { color: colors.gridColor },
                        ticks: { color: colors.ticksColor }
                    }
                },
                plugins: {
                    legend: {
                        labels: { font: { size: 14 }, color: colors.legendLabelColor }
                    },
                    title: {
                        display: false, // Title is now in HTML H2
                        // text: 'Distance Ran Over Time (Km)', // Title now in HTML
                        font: { size: 16 },
                        color: colors.titleColor
                    }
                }
            }
        });
    }

    function openLogRunForm(userForRun) {
        if (runForm) {
            runForm.reset(); // Reset first to clear any previous edit data

            // Pre-populate for new run
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
            const day = String(today.getDate()).padStart(2, '0');
            runForm.date.value = `${year}-${month}-${day}`;

            runForm.time.value = "30:00"; // Pre-populate with MM:SS

            if (userForRun === 'Jason') {
                runForm.distance.value = '5.000'; // Default 5km for Jason
                runForm.mph.value = ''; // Clear MPH so it gets calculated
                runForm.type.value = 'Treadmill LHR'; // Default type for Jason
                activeCalculatorInput = 'distance'; // Prioritize distance for calculation
            } else {
                runForm.mph.value = 4; // Default MPH for others
                runForm.distance.value = ''; // Clear distance field for others
                runForm.type.value = 'Treadmill'; // Default type for others
                activeCalculatorInput = 'mph'; // Set default focus for calculation
            }

            handleDynamicFormCalculation(); // Perform initial calculation
            // ---- END OF KEY LINES ----

            // Set user specific info
            if (logForUserSpan) logForUserSpan.textContent = userForRun;
            if (currentUserForRunInput) currentUserForRunInput.value = userForRun;
            if (runIdToEditInput) runIdToEditInput.value = ''; // Ensure it's not in edit mode

            runForm.querySelector('h2').innerHTML = `Log New Run for <span id="logForUser">${userForRun}</span>`;
            const submitButton = runForm.querySelector('button[type="submit"]');
            if (submitButton) submitButton.textContent = 'Add Run';
        }

        if (deleteRunFromFormBtn) deleteRunFromFormBtn.classList.add('hidden'); // Hide delete button for new runs

        if (gFormOverlay) gFormOverlay.classList.remove('hidden');
        if (gLogRunFormContainer) {
            gLogRunFormContainer.classList.remove('hidden');
            setTimeout(() => gLogRunFormContainer.classList.add('visible'), 10);
        }
    }

    function openEditForm(runId) {
        const runToEdit = runs.find(run => run.id === runId);
        if (!runToEdit) {
            alert('Run not found for editing.');
            return;
        }

        const isReadOnly = !localStorage.getItem(MASTER_PASSWORD_LOCALSTORAGE_KEY);
        const submitButton = runForm.querySelector('button[type="submit"]');

        if (runForm) {
            runForm.reset();
            runForm.date.value = runToEdit.date;
            runForm.time.value = runToEdit.time;
            // runForm.mph.value = runToEdit.mph; // Old way
            // Ensure distance is populated with 3 decimal places
            // const distanceToEdit = parseFloat(runToEdit.distance); // Old way
            // runForm.distance.value = isNaN(distanceToEdit) ? '' : distanceToEdit.toFixed(3); // Old way

            // New: Format for display, using parseFloat to handle potential string values from DB
            runForm.mph.value = parseFloat(runToEdit.mph).toFixed(3);
            runForm.distance.value = parseFloat(runToEdit.distance).toFixed(3);

            runForm.bpm.value = runToEdit.bpm || '';
            runForm.plus1.value = runToEdit.plus1 || '';
            runForm.notes.value = runToEdit.notes || '';
            runForm.type.value = runToEdit.type || 'Treadmill'; // Populate type, default if not present
            currentUserForRunInput.value = runToEdit.user;
            runIdToEditInput.value = runId;

            // ---- Store original values for comparison on save ----
            runForm.dataset.originalTime = runToEdit.time;
            // runForm.dataset.originalMph = runToEdit.mph.toString(); // Old way
            // runForm.dataset.originalDistance = isNaN(distanceToEdit) ? '' : distanceToEdit.toFixed(3); // Old way

            // New: Store full precision string versions of original metrics
            runForm.dataset.originalMph = String(runToEdit.mph);
            runForm.dataset.originalKph = String(runToEdit.kph); // Store original KPH too
            runForm.dataset.originalDistance = String(runToEdit.distance);
            // ---- End of storing original values ----

            activeCalculatorInput = 'mph';
            // No explicit call to handleDynamicFormCalculation(); here.
            // The user's first interaction with time, mph, or distance will trigger it.
            // ---- END OF KEY LINES ----

            const formTitleH2 = runForm.querySelector('h2');
            if (formTitleH2) {
                formTitleH2.innerHTML = `${isReadOnly ? 'Run' : 'Edit Run'} for <span id="logForUser">${runToEdit.user}</span>`;
            }
            // runForm.querySelector('h2').innerHTML = `Edit Run for <span id="logForUser">${runToEdit.user}</span>`;
            if (logForUserSpan) logForUserSpan.textContent = runToEdit.user; // logForUserSpan is global

            // Set read-only and disabled states
            runForm.date.readOnly = isReadOnly;
            runForm.time.readOnly = isReadOnly;
            runForm.mph.readOnly = isReadOnly;
            runForm.distance.readOnly = isReadOnly;
            runForm.bpm.readOnly = isReadOnly;
            runForm.plus1.readOnly = isReadOnly;
            runForm.notes.readOnly = isReadOnly;
            runForm.type.disabled = isReadOnly; // Disable select if read-only

            if (submitButton) {
                submitButton.textContent = 'Save'; // Still set text
                submitButton.style.display = isReadOnly ? 'none' : ''; // Hide if read-only, show if not
            }

            // Show and configure the delete button for edit mode
            if (deleteRunFromFormBtn) { // deleteRunFromFormBtn is global
                if (isReadOnly) {
                    deleteRunFromFormBtn.style.display = 'none';
                    deleteRunFromFormBtn.onclick = null; // Clear onclick if read-only
                } else {
                    deleteRunFromFormBtn.classList.remove('hidden'); // Ensure the .hidden class is removed
                    deleteRunFromFormBtn.style.display = ''; // Revert to default display (or e.g., 'inline-block')
                    deleteRunFromFormBtn.onclick = function() {
                        deleteRun(runId);
                    };
                }
            }
        }

        // Add/remove class for styling read-only form
        if (gLogRunFormContainer) {
            if (isReadOnly) {
                gLogRunFormContainer.classList.add('form-read-only');
            } else {
                gLogRunFormContainer.classList.remove('form-read-only');
            }
        }

        if (gFormOverlay) gFormOverlay.classList.remove('hidden'); // gFormOverlay is global
        if (gLogRunFormContainer) { // gLogRunFormContainer is global
            gLogRunFormContainer.classList.remove('hidden');
            setTimeout(() => gLogRunFormContainer.classList.add('visible'), 10);
        }
    }

    async function addRun(event) {
        event.preventDefault();

        const masterPassword = localStorage.getItem(MASTER_PASSWORD_LOCALSTORAGE_KEY);
        if (!masterPassword) {
            closeLogRunForm(); // Close form first
            openModal("Authentication Error", "Master Shared Password not found. Please set it in Settings to make changes.", 'error');
            return;
        }

        const hashedAuthKey = await getSha256Hash(masterPassword);
        if (!hashedAuthKey) {
            closeLogRunForm(); // Close form first
            openModal("Security Key Error", "Could not generate security key for database operation. Please try again or check console.", 'error');
            return;
        }

        const formData = new FormData(runForm);
        const editingRunId = runIdToEditInput.value;

        const user = formData.get('currentUserForRun');
        const date = formData.get('date');
        const timeInputString = formData.get('time'); // Get time as MM:SS string
        const type = formData.get('type');
        const notes = formData.get('notes');
        const day = getDayOfWeek(date);

        const parsedTimeMinutes = parseMMSS(timeInputString);
        let timeStringToStore = timeInputString;

        if (!date || !user || isNaN(parsedTimeMinutes) || parsedTimeMinutes <= 0) {
            closeLogRunForm();
            let errorMsg = "Please fill in User, Date, and a valid Time (MM:SS, greater than 0).";
            if (isNaN(parsedTimeMinutes) && timeInputString) {
                errorMsg = "Invalid time format. Please use MM:SS (e.g., 30:45 or 30 for 30:00).";
            } else if (parsedTimeMinutes <= 0 && timeInputString) {
                errorMsg = "Time must be greater than 00:00.";
            }
            openModal("Input Error", errorMsg, 'error');
            return;
        }

        if (!isNaN(parsedTimeMinutes)) {
            timeStringToStore = formatMinutesToMMSS(parsedTimeMinutes);
        }

        let finalMph, finalKph, finalDistance;

        // Helper function for core metric calculation
        function calculateRunMetricsInternal(timeMinutes, formMphStr, formDistStr, activeCalcInput) {
            let mph, kph, distance;

            // Process input strings to align with displayed precision (3dp) before parsing
            let processedMphStr = formMphStr;
            if (formMphStr) {
                const num = parseFloat(formMphStr);
                if (!isNaN(num)) processedMphStr = num.toFixed(3);
                else processedMphStr = 'NaN'; // Ensure parseFloat results in NaN if original was bad
            }

            let processedDistStr = formDistStr;
            if (formDistStr) {
                const num = parseFloat(formDistStr);
                if (!isNaN(num)) processedDistStr = num.toFixed(3);
                else processedDistStr = 'NaN';
            }

            const inputMphVal = parseFloat(processedMphStr);
            const inputDistanceVal = parseFloat(processedDistStr);

            if (timeMinutes <= 0) {
                return { error: "Time must be positive for metric calculation." };
            }

            if (activeCalcInput === 'distance') {
                if (!isNaN(inputDistanceVal) && inputDistanceVal > 0) {
                    distance = inputDistanceVal;
                    kph = distance / (timeMinutes / 60);
                    mph = kph * KPH_TO_MPH_FACTOR;
                } else {
                    return { error: "Distance was selected for calculation but is invalid. Please enter a valid Distance (Km)." };
                }
            } else if (activeCalcInput === 'mph') {
                if (!isNaN(inputMphVal) && inputMphVal > 0) {
                    mph = inputMphVal;
                    kph = mph * MPH_TO_KPH_FACTOR;
                    distance = kph * (timeMinutes / 60);
                } else {
                    return { error: "MPH was selected for calculation but is invalid. Please enter a valid MPH." };
                }
            } else {
                // This case should ideally not be reached if activeCalculatorInput is always 'mph' or 'distance'.
                // If it is, it implies a state where neither known input method is active.
                // Attempt a generic fallback, prioritizing distance then MPH if one is valid.
                if (!isNaN(inputDistanceVal) && inputDistanceVal > 0) {
                    distance = inputDistanceVal;
                    kph = distance / (timeMinutes / 60);
                    mph = kph * KPH_TO_MPH_FACTOR;
                } else if (!isNaN(inputMphVal) && inputMphVal > 0) {
                    mph = inputMphVal;
                    kph = mph * MPH_TO_KPH_FACTOR;
                    distance = kph * (timeMinutes / 60);
                } else {
                     return { error: "Please provide either a valid MPH or a valid Distance (Km) for calculation." };
                }
            }

            if (typeof mph === 'undefined' || typeof kph === 'undefined' || typeof distance === 'undefined') {
                return { error: "Calculation failed. Ensure valid positive MPH or Distance, and Time." };
            }
            return { mph, kph, distance };
        }

        if (editingRunId) {
            const originalTime = runForm.dataset.originalTime;
            const originalMphData = runForm.dataset.originalMph; // Full precision string from dataset
            const originalKphData = runForm.dataset.originalKph; // Full precision string from dataset
            const originalDistanceData = runForm.dataset.originalDistance; // Full precision string from dataset

            const formMphDisplayValue = formData.get('mph');
            const formDistanceDisplayValue = formData.get('distance');

            // Check if the displayed values in the form have changed
            const timeChanged = timeInputString !== originalTime;
            // Compare form's current display value with how the original full-precision MPH would be displayed (toFixed(1))
            const mphDisplayChanged = formMphDisplayValue !== parseFloat(originalMphData).toFixed(3);
            // Compare form's current display value with how the original full-precision Distance would be displayed (toFixed(3))
            const distanceDisplayChanged = formDistanceDisplayValue !== parseFloat(originalDistanceData).toFixed(3);

            if (!timeChanged && !mphDisplayChanged && !distanceDisplayChanged) {
                // If no user-facing values changed, use the original full-precision metrics
                finalMph = parseFloat(originalMphData);
                finalKph = parseFloat(originalKphData);
                finalDistance = parseFloat(originalDistanceData);
            } else {
                // If any user-facing value changed, recalculate from form inputs
                const freshParsedTimeMinutes = parseMMSS(timeInputString); // Re-parse time here
                if (isNaN(freshParsedTimeMinutes) || freshParsedTimeMinutes <= 0) {
                    closeLogRunForm();
                    openModal("Input Error", "Time became invalid during edit. Please ensure valid time.", 'error');
                    return;
                }
                const calculatedMetrics = calculateRunMetricsInternal(freshParsedTimeMinutes, formMphDisplayValue, formDistanceDisplayValue, activeCalculatorInput);
                if (calculatedMetrics.error) {
                    closeLogRunForm(); openModal("Input Error", calculatedMetrics.error, 'error'); return;
                }
                finalMph = calculatedMetrics.mph;
                finalKph = calculatedMetrics.kph;
                finalDistance = calculatedMetrics.distance;
            }
        } else { // ADD MODE
            const calculatedMetrics = calculateRunMetricsInternal(parsedTimeMinutes, formData.get('mph'), formData.get('distance'), activeCalculatorInput);
            if (calculatedMetrics.error) {
                closeLogRunForm(); openModal("Input Error", calculatedMetrics.error, 'error'); return;
            }
            finalMph = calculatedMetrics.mph;
            finalKph = calculatedMetrics.kph;
            finalDistance = calculatedMetrics.distance;
        }
        
        // Validate that metrics were successfully calculated
        if (typeof finalMph === 'undefined' || typeof finalKph === 'undefined' || typeof finalDistance === 'undefined') {
            closeLogRunForm();
            openModal("Calculation Error", "Could not determine run metrics. Please check your inputs.", 'error');
            return;
        }

        const runBpm = formData.get('bpm') ? parseInt(formData.get('bpm')) : null;
        const runPlus1 = formData.get('plus1') ? parseInt(formData.get('plus1')) : null;
        const runDelta = (runBpm !== null && runPlus1 !== null) ? (runBpm - runPlus1) : null;

        const fullRunObject = {
            user,
            date,
            time: timeStringToStore,
            // Store raw numbers with full precision
            mph: finalMph,
            kph: finalKph,
            distance: finalDistance,
            type,
            bpm: runBpm,
            plus1: runPlus1,
            delta: runDelta,
            notes,
            day,
            auth_key: hashedAuthKey
        };

        if (editingRunId) {

            const updatedRunFromDB = await updateRunInSupabase(editingRunId, fullRunObject);
            closeLogRunForm(); // Close form regardless of sub-function outcome (it shows its own modal on error)

            if (updatedRunFromDB && typeof updatedRunFromDB === 'object' && updatedRunFromDB.id) {
                const index = runs.findIndex(r => String(r.id) === String(editingRunId));
                if (index !== -1) {
                    runs[index] = updatedRunFromDB;
                } else {
                    console.warn('[addRun - Edit Mode] Run ID not found in local array after update. ID:', editingRunId);
                    runs = await fetchRunsFromSupabase(); // Refetch as fallback
                }
                document.dispatchEvent(new CustomEvent('dataChanged', { detail: { operation: 'edit', id: editingRunId, item: updatedRunFromDB } }));
            } else {
                console.warn('[addRun - Edit Mode] Update operation did not result in a valid run object for UI refresh, or error already handled by modal by sub-function.');
            }
        } else { // ----- ADD MODE -----

            const addedRunFromDB = await addRunToSupabase(fullRunObject);
            closeLogRunForm(); // Close form regardless of sub-function outcome

            if (addedRunFromDB) {
                runs.push(addedRunFromDB);
                document.dispatchEvent(new CustomEvent('dataChanged', { detail: { operation: 'add', item: addedRunFromDB } }));
            } else {
                console.warn('[addRun - Add Mode] Add operation did not result in a valid run object, or error already handled by modal by sub-function.');
            }
        }
        // Note: The dataChanged event will trigger renderAllRuns and updateStatistics
    }

    function switchTab(event) {
        const clickedTab = event.currentTarget;
        const targetPaneId = clickedTab.dataset.tab;

        // Do not switch if already active
        if (clickedTab.classList.contains('active')) {
            return;
        }

        tabButtons.forEach(button => button.classList.remove('active'));
        tabPanes.forEach(pane => pane.classList.remove('active'));

        clickedTab.classList.add('active');
        const targetPane = document.getElementById(targetPaneId);
        if (targetPane) {
            targetPane.classList.add('active');
            activeTab = targetPaneId; // Update activeTab
            localStorage.setItem('activeTab', activeTab); // Save active tab to localStorage

            if (activeTab === 'summary') {
                updateStatistics(); // Re-render charts and activity viz when switching to summary tab
            } else if (activeTab === 'jason') {
                renderActivityVisualization('Jason', 'jasonTabActivityGrid', { displayMonths: 5 }); // Jason tab shows 5 months
                renderAllRuns(); // Ensure table is up-to-date
            } else if (activeTab === 'kelvin') {
                renderActivityVisualization('Kelvin', 'kelvinTabActivityGrid', { displayMonths: 5 }); // Kelvin tab shows 5 months
                renderAllRuns(); // Ensure table is up-to-date
            } else {
                // If switching away from summary, destroy chart instances to prevent issues if they are not visible
                if (distanceOverTimeChartInstance) {
                    distanceOverTimeChartInstance.destroy();
                    distanceOverTimeChartInstance = null;
                }
                if (totalKmChartInstance) {
                    totalKmChartInstance.destroy();
                    totalKmChartInstance = null;
                }
                if (totalVisitsChartInstance) {
                    totalVisitsChartInstance.destroy();
                    totalVisitsChartInstance = null;
                }
            }
        }
        // Close log run form if it's open when switching tabs
        if (logRunFormContainer && logRunFormContainer.classList.contains('visible')) {
            closeLogRunForm();
        }
        // Close filter modal if it's open when switching tabs
        if (gFilterModalContainer && gFilterModalContainer.classList.contains('visible')) {
            closeFilterModal();
        }
    }

    // --- Event Listeners ---
    if (runForm) runForm.addEventListener('submit', addRun);
    if (formOverlay) formOverlay.addEventListener('click', closeLogRunForm);
    if (closeLogRunFormBtn) closeLogRunFormBtn.addEventListener('click', closeLogRunForm); // New event listener

    tabSpecificLogButtons.forEach(button => {
        button.addEventListener('click', () => {
            const user = button.dataset.user;
            openLogRunForm(user);
        });
    });

    tabButtons.forEach(button => {
        button.addEventListener('click', switchTab);
    });

    // --- Event Listener for Data Changes ---
    document.addEventListener('dataChanged', (event) => {

        // Call your main UI refresh functions here
        if (typeof renderAllRuns === 'function' && typeof updateStatistics === 'function') {
            renderAllRuns();
            updateStatistics();
            // renderActivityVisualization('Jason', 'jasonTabActivityGrid', 5); // Always update 5 months for tab view - OLD
            // renderActivityVisualization('Kelvin', 'kelvinTabActivityGrid', 5); // Always update 5 months for tab view - OLD
            // renderActivityVisualization('Jason', 'jasonTabActivityGrid', { displayMonths: 5 }); // REMOVED - handled by renderAllRuns
            // renderActivityVisualization('Kelvin', 'kelvinTabActivityGrid', { displayMonths: 5 }); // REMOVED - handled by renderAllRuns
        } else {
            console.error('renderAllRuns or updateStatistics is not available in dataChanged event listener scope');
        }
    });

    // --- Event Listeners for new dropdowns ---
    if (distanceChartPeriodSelect) {
        distanceChartPeriodSelect.addEventListener('change', () => {
            // if (activeTab === 'summary') {
            //     updateStatistics(); // This will re-render charts with new period
            // }
            updateTotalKmChartUI(); // Call specific updater
        });
    }
    if (visitsChartPeriodSelect) {
        visitsChartPeriodSelect.addEventListener('change', () => {
            // if (activeTab === 'summary') {
            //     updateStatistics(); // This will re-render charts with new period
            // }
            updateTotalVisitsChartUI(); // Call specific updater
        });
    }
    if (distanceOverTimeChartPeriodSelect) { // Event listener for the new dropdown
        distanceOverTimeChartPeriodSelect.addEventListener('change', () => {
            if (activeTab === 'summary') { // Only update if summary tab is active
                updateDistanceOverTimeChart();
            }
        });
    }
    // --- End Event Listeners for new dropdowns ---

    // Initial Load
    (async() => {



        if (supabase) {
            runs = await fetchRunsFromSupabase();
            // populateTypeFilters(); // REMOVED
        } else {
            console.error("CRITICAL: Supabase client not initialized. Data cannot be loaded.");
            alert("Failed to connect to the database. Please check your internet connection or contact support.");
            runs = [];
        }

        // Load filters from local storage
        const savedFilters = localStorage.getItem(RUN_LOGGER_FILTERS_KEY);
        if (savedFilters) {
            try {
                currentFilters = JSON.parse(savedFilters);
            } catch (e) {
                console.error("Error parsing saved filters from localStorage:", e);
                currentFilters = {}; // Reset to default if parsing fails
            }
        }


        // Explicitly update summary visualizations AFTER runs are fetched and dropdowns are populated
        // and default values set. This ensures the initial view is correct.
        // Check if the summary tab is the one that will be active or is by default considered active
        // for this initial rendering. If localStorage has a different tab, these might not be visible anyway,
        // but it's good to render them once with data.
        if (jasonSummaryActivityMonthSelectEl) {

            updateSummaryActivityVisualization('Jason');
        } else {
            console.warn("[DOMContentLoaded IIFE] Jason's summary activity month select element was NOT found when trying to call initial viz.");
        }
        if (kelvinSummaryActivityMonthSelectEl) {

            updateSummaryActivityVisualization('Kelvin');
        } else {
            console.warn("[DOMContentLoaded IIFE] Kelvin's summary activity month select element was NOT found when trying to call initial viz.");
        }

        // --- Set default dropdown values to current year if available, else allTime ---
        const currentYearString = new Date().getFullYear().toString();

        if (distanceOverTimeChartPeriodSelect) {
            if (distanceOverTimeChartPeriodSelect.querySelector(`option[value="${currentYearString}"]`)) {
                distanceOverTimeChartPeriodSelect.value = currentYearString;
            } else {
                distanceOverTimeChartPeriodSelect.value = 'allTime'; // Fallback
            }
        }
        if (distanceChartPeriodSelect) {
            if (distanceChartPeriodSelect.querySelector(`option[value="${currentYearString}"]`)) {
                distanceChartPeriodSelect.value = currentYearString;
            } else {
                distanceChartPeriodSelect.value = 'allTime'; // Fallback
            }
        }
        if (visitsChartPeriodSelect) {
            if (visitsChartPeriodSelect.querySelector(`option[value="${currentYearString}"]`)) {
                visitsChartPeriodSelect.value = currentYearString;
            } else {
                visitsChartPeriodSelect.value = 'allTime'; // Fallback
            }
        }
        // --- End set default dropdown values ---

        // Attach sort listeners and apply initial sort (date desc)
        if (runsTableBodySummary) attachSortListenersToTable(runsTableBodySummary, () => [...runs], true);
        if (runsTableBodyJason) attachSortListenersToTable(runsTableBodyJason, () => runs.filter(run => run.user === 'Jason'), false);
        if (runsTableBodyKelvin) attachSortListenersToTable(runsTableBodyKelvin, () => runs.filter(run => run.user === 'Kelvin'), false);

        // Attach sort listeners for the new stats table
        // The function `calculateUserStats` needs to be defined or integrated into the listener logic
        // This is a placeholder for the correct attachment logic for stats table.
        // attachSortListenersToStatsTable(); // We need to refine how this works with updateStatistics

        // Refined approach for stats table sorting:
        // updateStatistics will always calculate the data and then call sortUserStatsTable with the current dataset sort state.
        // The click listener will call sortUserStatsTable with the *clicked column* and NO explicit direction.
        // sortUserStatsTable will then determine the direction (toggle or default) and update the dataset.
        if (userStatsTableBody) { // Setup for User Stats Table
            const table = userStatsTableBody.closest('table');
            if (table) {
                const headers = table.querySelectorAll('th.sortable-header');
                headers.forEach(th => {
                    th.addEventListener('click', () => {
                        const columnKeyClicked = th.dataset.column;
                        if (columnKeyClicked) {
                            // Recalculate stats and sort with the new column.
                            // updateStatistics() will handle getting data and calling sortUserStatsTable
                            // We need to pass the clicked column to sortUserStatsTable through updateStatistics or have sortUserStatsTable
                            // handle the click event logic for fetching current stats and column.

                            // Simpler: Click calls sortUserStatsTable directly.
                            // This means `updateStatistics` is primarily for chart data now, and user stats data calculation
                            // needs to be accessible to the click handler for sorting.

                            // Let's make `calculateUserStats` a standalone function and call it from here.
                            const currentStats = calculateUserStats(); // You'll need to define this function based on updateStatistics logic
                            sortUserStatsTable(currentStats, columnKeyClicked); // No explicit direction, so it toggles or sets default
                        }
                    });
                });
            }
        }

        applyTheme(currentTheme); // currentTheme will be 'light' or based on non-localStorage method if any
        renderAllRuns(); // This will now render tables with their default sort
        updateStatistics(); // This will calculate and render the initial state of the user stats table (sorted by default) and activity viz if summary tab is active
        // Also render tab-specific visualizations on initial load
        // renderActivityVisualization('Jason', 'jasonTabActivityGrid', 5); // Initial load for tab view (5 months) - OLD
        // renderActivityVisualization('Kelvin', 'kelvinTabActivityGrid', 5); // Initial load for tab view (5 months) - OLD
        // renderActivityVisualization('Jason', 'jasonTabActivityGrid', { displayMonths: 5 }); // REMOVED - handled by renderAllRuns
        // renderActivityVisualization('Kelvin', 'kelvinTabActivityGrid', { displayMonths: 5 }); // REMOVED - handled by renderAllRuns

        // Add event listeners for the new filters (REMOVED)
        // const jasonTypeFilter = document.getElementById('jasonTypeFilter');
        // if (jasonTypeFilter) {
        //     jasonTypeFilter.addEventListener('change', renderAllRuns);
        // }
        // const kelvinTypeFilter = document.getElementById('kelvinTypeFilter');
        // if (kelvinTypeFilter) {
        //     kelvinTypeFilter.addEventListener('change', renderAllRuns);
        // }

        // Initial update of filter counts
        updateFilterCountDisplay('Jason');
        updateFilterCountDisplay('Kelvin');

        const lastActiveTab = localStorage.getItem('activeTab'); // Get last active tab from localStorage
        let tabActivated = false;
        if (lastActiveTab) {
            const tabButtonToActivate = document.querySelector(`.tab-button[data-tab="${lastActiveTab}"]`);
            if (tabButtonToActivate) {
                tabButtonToActivate.click(); // Simulate click to activate the tab and its logic
                tabActivated = true;
            }
        }

        if (!tabActivated) { // If no tab was activated from localStorage, default to summary
            const summaryTabButton = document.querySelector('.tab-button[data-tab="summary"]');
            if (summaryTabButton) {
                summaryTabButton.click();
            }
        }
        updateMasterPasswordStatus(); // Also call here after everything is loaded
        setupFilterCountClickListeners(); // Call to set up listeners after DOM is ready

        // --- Initial Population and Setup for Summary Activity Visualizations ---
        // Moved this block earlier to ensure dropdowns are populated before use.
        if (jasonSummaryActivityMonthSelectEl && kelvinSummaryActivityMonthSelectEl) {
            populateSummaryActivityMonthSelects(); // Populates and sets default value
            // Add event listeners
            jasonSummaryActivityMonthSelectEl.addEventListener('change', () => updateSummaryActivityVisualization('Jason'));
            kelvinSummaryActivityMonthSelectEl.addEventListener('change', () => updateSummaryActivityVisualization('Kelvin'));

        } else {
            console.warn("[DOMContentLoaded] Summary activity month select elements not found for population immediately after assignment.");
        }
        // --- End Initial Population ---
    })();

    // New function to manage rendering of consolidated charts based on dropdowns
    function renderConsolidatedCharts() {
        if (activeTab !== 'summary') return;

        const distancePeriod = document.getElementById('distanceChartPeriodSelect')?.value || 'allTime';
        const visitsPeriod = document.getElementById('visitsChartPeriodSelect')?.value || 'allTime';

        let jasonDistanceData = 0;
        let kelvinDistanceData = 0;
        let jasonVisitsData = 0;
        let kelvinVisitsData = 0;

        runs.forEach(run => {
            const runDistance = parseFloat(run.distance) || 0;
            const runYear = new Date(run.date).getFullYear();

            // Calculate Distance Data
            if (distancePeriod === 'allTime' || (distancePeriod !== 'allTime' && runYear === parseInt(distancePeriod))) {
                if (run.user === 'Jason') {
                    jasonDistanceData += runDistance;
                }
                if (run.user === 'Kelvin') {
                    kelvinDistanceData += runDistance;
                }
            }

            // Calculate Visits Data
            if (visitsPeriod === 'allTime' || (visitsPeriod !== 'allTime' && runYear === parseInt(visitsPeriod))) {
                if (run.user === 'Jason') {
                    jasonVisitsData++;
                }
                if (run.user === 'Kelvin') {
                    kelvinVisitsData++;
                }
            }
        });

        if (typeof renderTotalKmChart === 'function') {
            renderTotalKmChart({ jason: jasonDistanceData, kelvin: kelvinDistanceData });
        }
        if (typeof renderTotalVisitsChart === 'function') {
            renderTotalVisitsChart({ jason: jasonVisitsData, kelvin: kelvinVisitsData });
        }
    }

    // New function to specifically update the Total KM chart from its dropdown
    function updateTotalKmChartUI() {
        if (activeTab !== 'summary' || !document.getElementById('distanceChartPeriodSelect')) return;

        const distancePeriod = document.getElementById('distanceChartPeriodSelect').value;
        let jasonDistanceData = 0;
        let kelvinDistanceData = 0;

        runs.forEach(run => {
            const runDistance = parseFloat(run.distance) || 0;
            const runYear = new Date(run.date).getFullYear();
            if (distancePeriod === 'allTime' || (distancePeriod !== 'allTime' && runYear === parseInt(distancePeriod))) {
                if (run.user === 'Jason') jasonDistanceData += runDistance;
                if (run.user === 'Kelvin') kelvinDistanceData += runDistance;
            }
        });

        if (typeof renderTotalKmChart === 'function') {
            renderTotalKmChart({ jason: jasonDistanceData, kelvin: kelvinDistanceData });
        }
    }

    // New function to specifically update the Total Visits chart from its dropdown
    function updateTotalVisitsChartUI() {
        if (activeTab !== 'summary' || !document.getElementById('visitsChartPeriodSelect')) return;

        const visitsPeriod = document.getElementById('visitsChartPeriodSelect').value;
        let jasonVisitsData = 0;
        let kelvinVisitsData = 0;

        runs.forEach(run => {
            const runYear = new Date(run.date).getFullYear();
            if (visitsPeriod === 'allTime' || (visitsPeriod !== 'allTime' && runYear === parseInt(visitsPeriod))) {
                if (run.user === 'Jason') jasonVisitsData++;
                if (run.user === 'Kelvin') kelvinVisitsData++;
            }
        });

        if (typeof renderTotalVisitsChart === 'function') {
            renderTotalVisitsChart({ jason: jasonVisitsData, kelvin: kelvinVisitsData });
        }
    }

    // --- Filter Modal Logic ---
    function populateFilterTypeOptions() {
        const filterTypeSelect = document.getElementById('filterType');
        if (!filterTypeSelect) return;

        const uniqueTypes = [...new Set(runs.map(run => run.type).filter(type => type))].sort(); // Get unique, sorted types

        // Preserve the "All Types" option
        filterTypeSelect.innerHTML = '<option value="">All Types</option>';

        uniqueTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            filterTypeSelect.appendChild(option);
        });
    }

    function openFilterModal(userForFilter) {
        activeFilterUser = userForFilter;
        if (filterForUserSpan) filterForUserSpan.textContent = userForFilter;

        populateFilterTypeOptions(); // Populate/update type options each time modal opens
        updateFilterCountDisplay(userForFilter); // Update count when modal opens

        // Load current filters for this user into the form
        if (filterForm) {
            filterForm.reset(); // Reset form first
            const userSpecificFilters = currentFilters[userForFilter] || {};

            for (const key in userSpecificFilters) {
                if (filterForm.elements[key]) {
                    filterForm.elements[key].value = userSpecificFilters[key];
                }
            }
        }

        if (gFormOverlay) gFormOverlay.classList.remove('hidden');
        if (gFilterModalContainer) {
            gFilterModalContainer.classList.remove('hidden');
            setTimeout(() => gFilterModalContainer.classList.add('visible'), 10);
        }
    }

    function applyFiltersFromModal(event) {
        event.preventDefault();
        if (!activeFilterUser || !filterForm) return;

        const formData = new FormData(filterForm);
        const newFiltersForUser = {};
        for (let [key, value] of formData.entries()) {
            if (value) { // Only store non-empty filter values
                newFiltersForUser[key] = value;
            }
        }
        currentFilters[activeFilterUser] = newFiltersForUser;
        localStorage.setItem(RUN_LOGGER_FILTERS_KEY, JSON.stringify(currentFilters));


        closeFilterModal();
        renderAllRuns(); // Re-render tables with new filters
        updateFilterCountDisplay(activeFilterUser); // Update count after applying filters
    }

    function resetCurrentUsersFilters() {
        if (!activeFilterUser) return;
        currentFilters[activeFilterUser] = {}; // Clear filters for the active user
        if (filterForm) filterForm.reset(); // Reset the form fields
        localStorage.setItem(RUN_LOGGER_FILTERS_KEY, JSON.stringify(currentFilters));

        updateFilterCountDisplay(activeFilterUser); // Update count after resetting filters
        // Optionally, re-apply (which means showing all data) and re-render immediately
        // renderAllRuns(); 
        // Or, wait for user to click "Apply Filters" after reset, which is current behavior without the line above.
    }

    function applyAllFilters(runsToFilter, user) {
        const filtersToApply = currentFilters[user] || {};
        if (Object.keys(filtersToApply).length === 0) {
            return runsToFilter; // No filters for this user, return original array
        }


        return runsToFilter.filter(run => {
            let passesAll = true;

            // Date Range
            if (filtersToApply.filterDateStart && new Date(run.date) < new Date(filtersToApply.filterDateStart + 'T00:00:00')) passesAll = false;
            if (filtersToApply.filterDateEnd && new Date(run.date) > new Date(filtersToApply.filterDateEnd + 'T23:59:59')) passesAll = false;

            // Type
            if (filtersToApply.filterType && run.type !== filtersToApply.filterType) passesAll = false;

            // Time Range (MM:SS)
            const runTimeMinutes = parseMMSS(run.time);
            if (filtersToApply.filterTimeMin) {
                const minTimeMinutes = parseMMSS(filtersToApply.filterTimeMin);
                if (!isNaN(minTimeMinutes) && (isNaN(runTimeMinutes) || runTimeMinutes < minTimeMinutes)) passesAll = false;
            }
            if (filtersToApply.filterTimeMax) {
                const maxTimeMinutes = parseMMSS(filtersToApply.filterTimeMax);
                if (!isNaN(maxTimeMinutes) && (isNaN(runTimeMinutes) || runTimeMinutes > maxTimeMinutes)) passesAll = false;
            }

            // MPH Range
            if (filtersToApply.filterMphMin && run.mph < parseFloat(filtersToApply.filterMphMin)) passesAll = false;
            if (filtersToApply.filterMphMax && run.mph > parseFloat(filtersToApply.filterMphMax)) passesAll = false;

            // Distance Range
            if (filtersToApply.filterDistanceMin && run.distance < parseFloat(filtersToApply.filterDistanceMin)) passesAll = false;
            if (filtersToApply.filterDistanceMax && run.distance > parseFloat(filtersToApply.filterDistanceMax)) passesAll = false;

            // Pace Range (Min/Km)
            const runPaceMinutes = calculateMinPerKm(run.kph); // This returns total minutes

            if (filtersToApply.filterPaceMin) {
                const minPaceFilterMinutes = parseMMSS(filtersToApply.filterPaceMin);
                if (!isNaN(minPaceFilterMinutes) && (isNaN(runPaceMinutes) || runPaceMinutes < minPaceFilterMinutes)) {
                    // If run pace is faster (smaller) than minPaceFilter, it fails.
                    // Also fails if runPace is NaN and a minPaceFilter is set.
                    passesAll = false;
                }
            }
            if (filtersToApply.filterPaceMax) {
                const maxPaceFilterMinutes = parseMMSS(filtersToApply.filterPaceMax);
                if (!isNaN(maxPaceFilterMinutes) && (isNaN(runPaceMinutes) || runPaceMinutes > maxPaceFilterMinutes)) {
                    // If run pace is slower (larger) than maxPaceFilter, it fails.
                    // Also fails if runPace is NaN and a maxPaceFilter is set.
                    passesAll = false;
                }
            }

            return passesAll;
        });
    }

    if (filterForm) filterForm.addEventListener('submit', applyFiltersFromModal);
    if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetCurrentUsersFilters);
    if (closeFilterModalBtn) closeFilterModalBtn.addEventListener('click', closeFilterModal);

    if (showFilterModalBtns) {
        showFilterModalBtns.forEach(button => {
            button.addEventListener('click', () => {
                const user = button.dataset.user;
                openFilterModal(user);
            });
        });
    }
    // --- End Filter Modal Logic ---

    // --- New function to update filter count display ---
    function updateFilterCountDisplay(user) {
        const filterCountSpan = document.querySelector(`.filter-count-display[data-user="${user}"]`);
        // if (!filterCountSpan) return; // Original check

        // New: Target the anchor tag wrapping the span
        const filterCountAnchor = document.querySelector(`a.filter-count-clear[data-user="${user}"]`);
        if (!filterCountAnchor) return;

        const userSpecificFilters = currentFilters[user] || {};
        const count = Object.keys(userSpecificFilters).length;

        const displaySpan = filterCountAnchor.querySelector('span.filter-count-text'); // Get the span inside the anchor

        if (count > 0) {
            // filterCountSpan.textContent = `(${count} filter${count > 1 ? 's' : ''})`; // Original
            if (displaySpan) displaySpan.textContent = `(${count} filter${count > 1 ? 's' : ''})`;
            filterCountAnchor.title = "Click to reset filters";
            filterCountAnchor.style.display = 'inline-flex'; // Ensure it's visible
        } else {
            // filterCountSpan.textContent = ''; // Original
            if (displaySpan) displaySpan.textContent = '';
            filterCountAnchor.title = "";
            filterCountAnchor.style.display = 'none'; // Hide if no filters
        }
    }
    // --- End new function ---

    // --- Event listener for clearing filters via count display click ---
    function setupFilterCountClickListeners() {
        const filterClearLinks = document.querySelectorAll('a.filter-count-clear');
        filterClearLinks.forEach(link => {
            // Remove existing listener to prevent duplicates if this function is ever called again
            // Though in the current setup, it's called once. Good practice for future.
            const newLink = link.cloneNode(true);
            link.parentNode.replaceChild(newLink, link);

            newLink.addEventListener('click', (event) => {
                event.preventDefault(); // Prevent default anchor behavior
                console.log("Filter count link clicked for user:", event.currentTarget.dataset.user); // Debug log
                const user = event.currentTarget.dataset.user;
                if (user) {
                    currentFilters[user] = {}; // Clear filters for this user
                    localStorage.setItem(RUN_LOGGER_FILTERS_KEY, JSON.stringify(currentFilters));

                    // If the filter modal is currently open AND active for THIS user, reset its form fields.
                    if (gFilterModalContainer && gFilterModalContainer.classList.contains('visible') &&
                        filterForm && activeFilterUser === user) {
                        filterForm.reset();
                    }

                    renderAllRuns(); // Re-render tables
                    updateFilterCountDisplay(user); // Update this user's count display
                }
            });
        });
    }
    // --- End event listener for clearing filters ---

    // --- New Activity Visualization Functions ---
    function renderActivityVisualization(user, gridId, options, userSpecificRuns) {
        const runsForViz = userSpecificRuns || []; // Default to empty array if undefined

        const gridContainer = document.getElementById(gridId);

        if (!gridContainer) {
            console.warn(`[renderActivityVisualization] Grid element not found for user: ${user}, gridId: ${gridId}`);
            return;
        }
        gridContainer.innerHTML = ''; // Clear previous grid
        gridContainer.style.display = 'flex';
        gridContainer.style.justifyContent = 'center';
        gridContainer.style.overflowX = 'auto';
        gridContainer.style.padding = '5px 0';
        gridContainer.style.position = 'relative'; // New: for stacking context
        gridContainer.style.zIndex = '1'; // New: to lift above card's direct background/padding


        let year, month; // For single month view
        let isSingleMonthView = false;

        if (options && options.targetDate instanceof Date) {
            year = options.targetDate.getFullYear();
            month = options.targetDate.getMonth(); // Already 0-indexed
            isSingleMonthView = true;
        } else if (options && typeof options.displayMonths === 'number' && options.displayMonths > 0) { // More specific check, allows displayMonths: 1 for single month view if needed
            // Multi-week view, or potentially a single month view if displayMonths === 1 and no targetDate
            if (options.displayMonths === 1 && !(options.targetDate)) {
                // If displayMonths is 1 and no targetDate, treat as current month single view
                const today = new Date();
                year = today.getFullYear();
                month = today.getMonth();
                isSingleMonthView = true;
            } else if (options.displayMonths > 1) {
                isSingleMonthView = false; // Multi-week view
            } else {
                isSingleMonthView = false; // Default to multi-week if displayMonths is not > 1 and not specifically 1 for single view
            }
        } else {
            console.error("Invalid or missing options for renderActivityVisualization. Expected targetDate or displayMonths (as a positive number)."); // LINE 2254
            if (gridContainer) gridContainer.innerHTML = '<p style="color:red;">Error: Could not load activity data.</p>';
            return;
        }

        if (isSingleMonthView) { // Current month view (Summary Tab) or selected month
            // const today = new Date(); // Not needed if year/month are passed
            // const currentMonth = today.getMonth(); // Use passed month
            // const currentYear = today.getFullYear(); // Use passed year

            const monthGrid = document.createElement('div');
            monthGrid.style.display = 'grid';
            monthGrid.style.gridTemplateRows = `repeat(7, 30px)`;
            monthGrid.style.gridTemplateColumns = `repeat(5, 30px)`; // Max 5 columns for a month view for now
            monthGrid.style.gridAutoFlow = 'column';
            monthGrid.style.gap = '3px';

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const firstDayOfWeekOfMonth = new Date(year, month, 1).getDay(); // 0 for Sunday

            // Use runsForViz instead of userSpecificRuns directly
            const userRunsThisMonth = runsForViz.filter(run =>
                new Date(run.date).getFullYear() === year &&
                new Date(run.date).getMonth() === month
            );
            const dailyDistances = {};
            userRunsThisMonth.forEach(run => {
                const dayOfMonth = new Date(run.date).getDate();
                dailyDistances[dayOfMonth] = (dailyDistances[dayOfMonth] || 0) + parseFloat(run.distance);
            });

            let dayCounter = 1;
            let addedCells = 0;
            // Max cells for a 5-column, 7-row grid is 35
            for (let cell = 0; cell < 5 * 7; cell++) {
                const square = document.createElement('div');
                square.classList.add('activity-square');
                square.style.width = '30px';
                square.style.height = '30px';

                // Calculate current position in conceptual grid to map to day
                const currentCol = Math.floor(cell / 7);
                const currentRow = cell % 7;

                if (currentRow === 0) { // It's a Sunday
                    square.classList.add('sunday-square');
                }

                if ((currentCol === 0 && currentRow < firstDayOfWeekOfMonth) || dayCounter > daysInMonth) {
                    square.classList.add('empty');
                    square.style.border = 'none';
                    square.style.background = 'transparent';
                } else {
                    const distanceRan = dailyDistances[dayCounter] || 0;
                    if (distanceRan > 0) {
                        let intensityClass = '';
                        if (distanceRan >= 10) intensityClass = 'has-run-very-high';
                        else if (distanceRan >= 7) intensityClass = 'has-run-high';
                        else if (distanceRan >= 4) intensityClass = 'has-run-medium';
                        else intensityClass = 'has-run-low';
                        square.classList.add(intensityClass);
                    }
                    const tooltip = document.createElement('span');
                    tooltip.classList.add('tooltip');
                    const runDate = new Date(year, month, dayCounter);
                    const dateString = runDate.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                    tooltip.textContent = distanceRan > 0 ? `${dateString}: ${distanceRan.toFixed(2)} km` : `${dateString}: No runs`;
                    square.appendChild(tooltip);
                    dayCounter++;
                }
                monthGrid.appendChild(square);
                addedCells++;
                if (dayCounter > daysInMonth && addedCells % 7 === 0) break; // Optimization: stop if month is done and week is filled
            }
            gridContainer.appendChild(monthGrid);

        } else { // Multi-week continuous horizontal view (Jason/Kelvin Tabs)
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Normalize today for accurate comparison

            // Determine grid structure based on the user's *entire* history, not just filtered runsForViz
            const allUserRunsUnfiltered = runs.filter(run => run.user === user);

            if (!allUserRunsUnfiltered || allUserRunsUnfiltered.length === 0) {
                gridContainer.innerHTML = '<p style="text-align: center; color: var(--card-subtle-text-color);">No activity data to display for this user.</p>';
                return;
            }

            // Sort all unfiltered runs to find the absolute earliest for grid structure
            const sortedAllUserRuns = [...allUserRunsUnfiltered].sort((a, b) => new Date(a.date) - new Date(b.date));
            const earliestRunDateForGridStructure = new Date(sortedAllUserRuns[0].date);

            let startDate = new Date(earliestRunDateForGridStructure);
            startDate.setDate(startDate.getDate() - startDate.getDay()); // Set to Sunday of that week
            startDate.setHours(0, 0, 0, 0); // Normalize startDate

            const dayDifference = (today - startDate) / (1000 * 60 * 60 * 24);
            let numWeeksToShow = Math.ceil((dayDifference + 1) / 7); 
            numWeeksToShow = Math.max(1, numWeeksToShow); 

            // The runsForViz (which is already filtered by table criteria) is used for highlighting below
            if (!runsForViz || runsForViz.length === 0) {
                // If, after filtering, there are no runs to highlight, still render the grid structure
                // but no squares will be green.
            }

            const yearGrid = document.createElement('div');
            yearGrid.style.display = 'grid';
            yearGrid.style.gridTemplateRows = `repeat(7, 30px)`;
            yearGrid.style.gridTemplateColumns = `repeat(${numWeeksToShow}, 30px)`; // Dynamic columns
            yearGrid.style.gridAutoFlow = 'column';
            yearGrid.style.gap = '5px';

            // const userRunsAll = runsForViz; // OLD: This was already the filtered list for highlighting
            // For highlighting, we use runsForViz. For grid structure, we used allUserRunsUnfiltered above.
            const dailyDistancesMap = new Map();
            runsForViz.forEach(run => { // Iterate over the FILTERED runsForViz for highlighting
                const dateKey = run.date;
                dailyDistancesMap.set(dateKey, (dailyDistancesMap.get(dateKey) || 0) + parseFloat(run.distance));
            });

            let currentDateInGrid = new Date(startDate);

            for (let i = 0; i < numWeeksToShow * 7; i++) {
                const square = document.createElement('div');
                square.classList.add('activity-square');
                square.style.width = '30px';
                square.style.height = '30px';

                let dateForSquare = new Date(currentDateInGrid);
                dateForSquare.setHours(0, 0, 0, 0);

                if (dateForSquare.getDay() === 0) { 
                    square.classList.add('sunday-square');
                }

                // Add month indicator if it's the 1st of the month
                if (dateForSquare.getDate() === 1) {
                    const monthIndicator = document.createElement('div');
                    monthIndicator.classList.add('month-indicator');
                    monthIndicator.textContent = dateForSquare.toLocaleDateString('en-GB', { month: 'short' });
                    square.appendChild(monthIndicator); // Append to square, CSS will position it
                }

                if (dateForSquare > today) {
                    square.classList.add('empty', 'future');
                    square.style.visibility = 'hidden'; 
                } else {
                    const dateKey = `${dateForSquare.getFullYear()}-${String(dateForSquare.getMonth() + 1).padStart(2, '0')}-${String(dateForSquare.getDate()).padStart(2, '0')}`;
                    const distanceRan = dailyDistancesMap.get(dateKey) || 0;

                    if (distanceRan > 0) {
                        let intensityClass = '';
                        if (distanceRan >= 10) intensityClass = 'has-run-very-high';
                        else if (distanceRan >= 7) intensityClass = 'has-run-high';
                        else if (distanceRan >= 4) intensityClass = 'has-run-medium';
                        else intensityClass = 'has-run-low';
                        square.classList.add(intensityClass);
                    }
                    const tooltip = document.createElement('span');
                    tooltip.classList.add('tooltip');
                    const dateString = dateForSquare.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
                    tooltip.textContent = distanceRan > 0 ? `${dateString}: ${distanceRan.toFixed(2)} km` : `${dateString}: No runs`;
                    square.appendChild(tooltip); // Append tooltip to square first
                }
                yearGrid.appendChild(square); // Append square to yearGrid BEFORE checking its position

                // Check if square is near the right edge of the grid container, now that it's in yearGrid
                if (square.classList.contains('activity-square') && !square.classList.contains('empty')) { // Only for actual data squares
                    const tooltipElement = square.querySelector('.tooltip'); // Get the tooltip again
                    if (tooltipElement) {
                        const currentColumnIndex = Math.floor(i / 7);
                        if (currentColumnIndex <= 3) {
                            tooltipElement.classList.add('tooltip-align-left');
                            tooltipElement.classList.remove('tooltip-align-right');
                        }
                        else if (currentColumnIndex >= numWeeksToShow - 3) {
                            tooltipElement.classList.add('tooltip-align-right');
                            tooltipElement.classList.remove('tooltip-align-left');
                        }
                        else {
                            tooltipElement.classList.remove('tooltip-align-left');
                            tooltipElement.classList.remove('tooltip-align-right');
                        }
                    }
                }

                currentDateInGrid.setDate(currentDateInGrid.getDate() + 1); 
            }
            gridContainer.appendChild(yearGrid);

            // After appending, check for overflow and adjust
            if (yearGrid.scrollWidth > gridContainer.clientWidth) {
                gridContainer.style.justifyContent = 'flex-start'; // Align to left if overflowing
                gridContainer.scrollLeft = yearGrid.scrollWidth; // Scroll to the far right
            } else {
                gridContainer.style.justifyContent = 'center'; // Center if not overflowing
            }
        }
    }
    // --- End New Activity Visualization Functions ---

    function calculateUserStats() {
        // ... existing code ...
    }

    function calculateMinPerKm(kph) {
        if (kph <= 0 || !isFinite(kph)) return Infinity; // Avoid division by zero, handle non-movement or invalid kph
        return 60 / kph;
    }
});

// --- Helper function to add horizontal scroll on mouse wheel to an element ---
function addHorizontalScrollWithMouseWheel(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.addEventListener('wheel', function(event) {
            if (event.deltaY !== 0) {
                event.preventDefault();
                element.scrollLeft += event.deltaY;
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    addHorizontalScrollWithMouseWheel('jasonTabActivityGrid');
    addHorizontalScrollWithMouseWheel('kelvinTabActivityGrid');
});