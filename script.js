let runs = []; // Define runs in the global scope

// --- New Security Setup ---
const MASTER_PASSWORD_LOCALSTORAGE_KEY = "runLoggerMasterPassword";
// SHARED_PASSWORD and SUPABASE_SECRET_KEY_VALUE are removed.

// Global functions that don't need DOMContentLoaded scope or don't call UI updaters
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

// --- Time Format Helper Functions ---
function parseMMSS(timeString) {
    if (!timeString || typeof timeString !== 'string') return NaN;

    // Check if the input is just a number (e.g., "40") and convert to "MM:00"
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
// --- End Time Format Helper Functions ---

// Helper function to get the number of days passed in a specific year until today
function getNumberOfDaysSoFarInYear(year) {
    const today = new Date();
    const startOfYear = new Date(year, 0, 1); // January 1st of the specified year
    if (today.getFullYear() < year) return 0; // If year is in future, 0 days passed
    if (today.getFullYear() > year) { // If year is in past, return total days in that year
        const isLeap = new Date(year, 1, 29).getDate() === 29;
        return isLeap ? 366 : 365;
    }
    // If current year, calculate difference in days
    const diffInMilliseconds = today - startOfYear;
    const diffInDays = Math.ceil(diffInMilliseconds / (1000 * 60 * 60 * 24));
    return diffInDays;
}

// Supabase Client Initialization
const SUPABASE_URL = 'https://qrjstijzhumrhwvdkuls.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyanN0aWp6aHVtcmh3dmRrdWxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc5MjQ0MzksImV4cCI6MjA2MzUwMDQzOX0.5CCuhm8rdwJQ_Of_B-XUWjNY9JyQb1EOMSmRREh7x6w';
let supabase = null; // This variable will store our client instance

// ---- Global-like variables ----
let activeCalculatorInput = 'mph'; 
let isCalculating = false; 
let tabSpecificLogButtons = null; // Assigned in DOMContentLoaded
let gModalContainer, gModalTitleEl, gModalMessageEl;
let gModalConfirmBtn, gModalCancelBtn; 
let gFormOverlay; 
let gLogRunFormContainer; // Declared here, assigned in DOMContentLoaded
let runForm = null;
let runIdToEditInput = null;
let deleteRunFromFormBtn = null;
let logForUserSpan = null; 
let currentUserForRunInput = null; 
// ---- End Global-like variables ----

// --- Filter Modal Globals ---
let gFilterModalContainer, filterForm, filterForUserSpan, closeFilterModalBtn, resetFiltersBtn;
let activeFilterUser = null; // To store which user's filter is active ('Jason' or 'Kelvin')
let currentFilters = {}; // Object to store active filters for each user
// ---- End Global-like variables ----

// Check for the global `window.supabase` object from the CDN and its `createClient` method
if (typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function') {
    // Initialize our script-scoped `supabase` variable with the client instance
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        db: {
            schema: 'public', // Explicitly state schema, though it's default
            // detectChanges: true, // This was for realtime, might not be relevant for schema cache for inserts
        },
        auth: {
            // autoRefreshToken: true, // Defaults to true
            // persistSession: true, // Defaults to true
            // detectSessionInUrl: true // Defaults to true for OAuth
        },
        global: {
            // headers: { 'x-my-custom-header': 'my-app-v1' } // Example custom headers
        }
    });
    console.log("Supabase client initialized with custom options (attempting schema awareness).");
} else {
    console.error("Supabase JS SDK (window.supabase.createClient) not loaded or found. Ensure SDK is included before this script.");
    alert("Critical error: Supabase SDK not loaded. App may not function correctly.");
}

// Helper function to get SHA256 hash (async)
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
        console.log("[getSha256Hash] Hashed \"" + inputString + "\" to: " + hashHex);
        return hashHex;
    } catch (error) {
        console.error("[getSha256Hash] Error hashing string:", error);
        return null;
    }
}

// Function to fetch runs from Supabase
async function fetchRunsFromSupabase() {
    if (!supabase) {
        console.warn('Supabase client not initialized. Cannot fetch runs.');
        return []; // Return empty array or handle as an error
    }
    try {
        const { data, error } = await supabase
            .from('runs')
            .select('*') // Selects all columns
            .order('date', { ascending: false }); // Default sort by date descending

        if (error) {
            console.error('Error fetching runs from Supabase:', error);
            alert(`Error fetching runs: ${error.message}. Check console for details.`);
            return [];
        }
        console.log('Fetched runs from Supabase:', data);
        return data || [];
    } catch (err) {
        console.error('Catch block error fetching runs:', err);
        alert(`Error fetching runs: ${err.message}. Check console for details.`);
        return [];
    }
}

// Function to add a run to Supabase
async function addRunToSupabase(runObjectWithAuthKey) {
    console.log("[addRunToSupabase] Received run object:", JSON.parse(JSON.stringify(runObjectWithAuthKey)));
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
        console.log('Added run to Supabase:', data ? data[0] : null);
        return data ? data[0] : null;
    } catch (err) {
        console.error('Catch block error adding run:', err);
        openModal("Client-Side Error", `Error during add operation: ${err.message}`, 'error');
        return null;
    }
}

// Function to update a run in Supabase
async function updateRunInSupabase(runId, updatedRunObjectWithAuthKey) {
    console.log("[updateRunInSupabase] Received ID:", runId, "and run object:", JSON.parse(JSON.stringify(updatedRunObjectWithAuthKey)));
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
        console.log('Updated run in Supabase:', data ? data[0] : null);
        return data ? data[0] : null;
    } catch (err) {
        console.error('Catch block error updating run:', err);
        openModal("Client-Side Error", `Error during update operation: ${err.message}`, 'error');
        return null;
    }
}

// --- Global variables for Modal Elements (Error Modal and shared) ---
// let gModalContainer, gModalTitleEl, gModalMessageEl; // Moved to global-like section
// let gModalConfirmBtn, gModalCancelBtn; // New button refs // Moved
// let gFormOverlay; // Moved
// let gLogRunFormContainer; // To be assigned in DOMContentLoaded // Moved

// --- Global variables for Log Run Form Elements (needed for global closeLogRunForm) ---
// let runForm = null; // Moved
// let runIdToEditInput = null; // Moved
// let deleteRunFromFormBtn = null; // Moved
// let logForUserSpan = null; // Also used by closeLogRunForm indirectly via runForm.querySelector // Moved
// let currentUserForRunInput = null; // Used by openLogRunForm/openEditForm, good to have if those become global // Moved
// let gLogRunFormContainer = null; // Made this global-like for read-only class toggling // Already moved and handled

// --- Global Modal Functions (Refactored from Error Modal) ---
function openModal(title, message, type = 'error', onConfirm = null) {
    console.log("[openModal] Called with title:", title, "message:", message, "type:", type);
    // ... (logging for gModalTitleEl etc. can remain for debugging if needed)

    if (gModalTitleEl) {
        gModalTitleEl.textContent = title;
        // Style title based on type
        if (type === 'error') {
            gModalTitleEl.style.color = 'var(--danger-color)';
        } else if (type === 'success') {
            gModalTitleEl.style.color = 'var(--success-color)';
        } else {
            gModalTitleEl.style.color = 'var(--card-title-color)'; // Default for confirmation or other types
        }
    }
    if (gModalMessageEl) gModalMessageEl.textContent = message;
    
    gModalConfirmCallback = null; // Reset callback

    if (gModalConfirmBtn && gModalCancelBtn) {
        if (type === 'confirmation' && typeof onConfirm === 'function') {
            gModalConfirmBtn.classList.remove('hidden', 'btn-danger', 'btn-success');
            gModalConfirmBtn.classList.add('btn-danger'); 
            gModalConfirmBtn.style.display = ''; 
            gModalCancelBtn.textContent = 'Cancel';
            gModalConfirmCallback = onConfirm;
        } else if (type === 'success') {
            gModalConfirmBtn.style.display = 'none'; // Hide confirm button for success
            gModalCancelBtn.textContent = 'Close'; 
        } else { // 'error' type or no valid onConfirm
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

// --- Global Function to Close Filter Modal ---
function closeFilterModal() {
    if (gFilterModalContainer) {
        gFilterModalContainer.classList.remove('visible');
        setTimeout(() => {
            gFilterModalContainer.classList.add('hidden');
            // Only hide overlay if neither the general modal nor the log run form is active
            if (gFormOverlay && 
                (!gModalContainer || !gModalContainer.classList.contains('modal-active')) &&
                (!gLogRunFormContainer || !gLogRunFormContainer.classList.contains('visible'))
            ) {
                 gFormOverlay.classList.add('hidden');
            }
        }, 300);
    }
}

// --- Global Function to Close Log Run Form ---
function closeLogRunForm() {
    if (gLogRunFormContainer) { 
        gLogRunFormContainer.classList.remove('visible');
        setTimeout(() => {
            gLogRunFormContainer.classList.add('hidden');
            
            // Only hide overlay if the general modal is NOT active
            if (gFormOverlay && (!gModalContainer || !gModalContainer.classList.contains('modal-active'))) {
                 gFormOverlay.classList.add('hidden');
            }

            // Reset form to "Add Run" mode after closing
            if (runForm) { // runForm is now global
                runForm.reset();
                if(runIdToEditInput) runIdToEditInput.value = ''; // runIdToEditInput is now global
                const submitButton = runForm.querySelector('button[type="submit"]');
                if (submitButton) submitButton.textContent = 'Add Run';
                // logForUserSpan is trickier if we don't make it global, query it inside if needed or ensure it is global.
                // For now, assuming runForm.querySelector is sufficient as logForUserSpan itself is not directly manipulated by closeLogRunForm
                // but rather its container h2 is. The #logForUser span will be within the h2.
                const h2Title = runForm.querySelector('h2');
                if (h2Title) {
                    const existingSpan = h2Title.querySelector('#logForUser');
                    if (existingSpan) h2Title.innerHTML = `Log New Run for <span id="logForUser"></span>`;
                    else h2Title.innerHTML = `Log New Run for <span></span>`; // Fallback if span wasn't there
                }
            }
            if (deleteRunFromFormBtn) deleteRunFromFormBtn.classList.add('hidden'); // deleteRunFromFormBtn is now global
        }, 300); 
    } else if (gFormOverlay && (!gModalContainer || !gModalContainer.classList.contains('modal-active'))) { 
        // If only overlay is somehow visible without log form AND general modal is not active
         gFormOverlay.classList.add('hidden');
         if (deleteRunFromFormBtn) deleteRunFromFormBtn.classList.add('hidden'); // Also hide here as a fallback
    }
}

// Modified deleteRun function
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
    const confirmMsg = runToDelete 
        ? `Are you sure you want to delete this run? \n${runToDelete.date} - ${runToDelete.user} - ${runToDelete.distance} Km`
        : `Are you sure you want to delete run with ID: ${runIdToDelete}? (Run details not found in local cache)`;

    openModal("Confirm Deletion", confirmMsg, 'confirmation', async () => {
        // This is the onConfirm callback
        try {
            if (!supabase) {
                openModal("Connection Error", "Supabase client not available. Cannot delete run.", 'error');
                return; // Still inside the callback, modal stays with error
            }
            
            console.log(`[deleteRun] Calling PostgreSQL function 'secure_delete_run' with run_id: ${runIdToDelete} and client_auth_key.`);
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
                return; // Modal stays open with the error message
            }
            
            // If successful so far
            console.log('[deleteRun] secure_delete_run RPC returned data:', data);
            runs = runs.filter(run => run.id !== runIdToDelete);
            document.dispatchEvent(new CustomEvent('dataChanged', { detail: { operation: 'delete', id: runIdToDelete } }));
            
            if (typeof data === 'string' && data.toLowerCase().includes('successfully deleted')){
                console.log("Delete successful message from PG function:", data);
                // Success! Close the modal.
                closeModal(); 
                closeLogRunForm(); // Close the edit form as well
            } else if (typeof data === 'string') { // Some other message from PG func, treat as info/error
                openModal("Delete Operation Note", data, 'error'); // Stays open with this message
            } else {
                // Default success case if PG func returns no specific string or unexpected data
                closeModal(); // Assume success and close
            }

        } catch (rpcCatchError) { // Catch errors from the try block itself (e.g. if supabase was null and we missed the check somehow)
            console.error('[deleteRun onConfirm callback] Catch block: Error during RPC call or processing:', rpcCatchError);
            openModal("Client-Side Error", `Error during delete operation: ${rpcCatchError.message}`, 'error');
            // Modal stays open with error
        }
        // No explicit return needed here, if an error occurred and called openModal, it stays open.
        // If success occurred and called closeModal, it closes.
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Assign to global modal element variables FIRST
    gModalContainer = document.getElementById('modalContainer');
    gModalTitleEl = document.getElementById('modalTitle');
    gModalMessageEl = document.getElementById('modalMessage');
    gModalConfirmBtn = document.getElementById('modalConfirmBtn');
    gModalCancelBtn = document.getElementById('modalCancelBtn');
    gFormOverlay = document.getElementById('formOverlay');
    gLogRunFormContainer = document.getElementById('logRunFormContainer'); // Assign here
    console.log("[DOMContentLoaded] Global modal element variables assigned:", 
        { gModalContainer, gModalTitleEl, gModalMessageEl, gModalConfirmBtn, gModalCancelBtn, gFormOverlay, gLogRunFormContainer }
    );

    // Dark Mode Elements
    const darkModeToggle = document.getElementById('darkModeToggle'); // This is now the checkbox input
    const documentElement = document.documentElement; // Use documentElement for theme class

    // Assign to global form element variables (previously const within DOMContentLoaded)
    runForm = document.getElementById('runForm');
    logForUserSpan = document.getElementById('logForUser');
    currentUserForRunInput = document.getElementById('currentUserForRun');
    runIdToEditInput = document.getElementById('runIdToEdit'); 
    deleteRunFromFormBtn = document.getElementById('deleteRunFromFormBtn');
    // Ensure these are logged or checked if issues persist
    console.log("[DOMContentLoaded] Global form element variables assigned:", { runForm, logForUserSpan, currentUserForRunInput, runIdToEditInput, deleteRunFromFormBtn });

    // const formOverlay = document.getElementById('formOverlay'); // Now global gFormOverlay
    // const logRunFormContainer = document.getElementById('logRunFormContainer'); // Now global gLogRunFormContainer
    tabSpecificLogButtons = document.querySelectorAll('.showLogRunFormBtn'); // Assign to global-like variable
    const closeLogRunFormBtn = document.getElementById('closeLogRunFormBtn'); // New close button
    // const logForUserSpan = document.getElementById('logForUser'); // Now global
    // const currentUserForRunInput = document.getElementById('currentUserForRun'); // Now global
    // const runIdToEditInput = document.getElementById('runIdToEdit'); // Now global
    // const deleteRunFromFormBtn = document.getElementById('deleteRunFromFormBtn'); // Now global

    // ---- ADD THESE INPUT CONSTS ----
    const timeInput = document.getElementById('time');
    const mphInput = document.getElementById('mph');
    const distanceInput = document.getElementById('distance');
    // ---- END OF ADDING INPUT CONSTS ----

    // Table bodies
    const runsTableBodySummary = document.getElementById('runsTableBodySummary');
    const runsTableBodyJason = document.getElementById('runsTableBodyJason');
    const runsTableBodyKelvin = document.getElementById('runsTableBodyKelvin');
    const userStatsTableBody = document.getElementById('userStatsTableBody'); // New reference

    // Statistics elements (summary tab - updated)
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

    // Canvas contexts for charts
    const distanceOverTimeChartCanvas = document.getElementById('distanceOverTimeChart')?.getContext('2d');
    // const totalKmOverallChartCanvas = document.getElementById('totalKmOverallChart')?.getContext('2d'); // Removed
    // const totalKm2025ChartCanvas = document.getElementById('totalKm2025Chart')?.getContext('2d');     // Removed
    // const totalVisitsOverallChartCanvas = document.getElementById('totalVisitsOverallChart')?.getContext('2d'); // Removed
    // const totalVisits2025ChartCanvas = document.getElementById('totalVisits2025Chart')?.getContext('2d');   // Removed
    const totalKmChartCanvas = document.getElementById('totalKmChart')?.getContext('2d'); // New Consolidated
    const totalVisitsChartCanvas = document.getElementById('totalVisitsChart')?.getContext('2d'); // New Consolidated

    // Tabs
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    let currentTheme = localStorage.getItem('theme') || 'dark'; // Default to dark mode

    // Chart instances
    let distanceOverTimeChartInstance;
    // let totalKmOverallChartInstance; // Removed
    // let totalKm2025ChartInstance;    // Removed
    // let totalVisitsOverallChartInstance; // Removed
    // let totalVisits2025ChartInstance;   // Removed
    let totalKmChartInstance; // New Consolidated
    let totalVisitsChartInstance; // New Consolidated

    let activeTab = 'summary'; // Default active tab

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
                mphInput.value = calculatedMph.toFixed(1);
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
            console.log("Active calculator input set to: MPH");
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
            console.log("Active calculator input set to: Distance");
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
        console.log(`[applyTheme] Called with theme: ${theme}`); // Log entry
        if (theme === 'dark') {
            console.log('[applyTheme] Applying dark mode.'); // Log branch
            documentElement.classList.add('dark-mode');
            if (darkModeToggle) darkModeToggle.checked = true; // Set checkbox to checked for dark mode
        } else {
            console.log('[applyTheme] Applying light mode.'); // Log branch
            documentElement.classList.remove('dark-mode');
            if (darkModeToggle) darkModeToggle.checked = false; // Set checkbox to unchecked for light mode
        }
        currentTheme = theme;
        localStorage.setItem('theme', theme);
        console.log(`[applyTheme] documentElement classList after apply: ${documentElement.classList}`); // Log state
        console.log(`[applyTheme] localStorage theme: ${localStorage.getItem('theme')}`); // Log state

        // Update charts whenever theme changes
        if (activeTab === 'summary') {
             updateStatistics(); // This will re-render charts with new theme colors
        }
        updateMasterPasswordStatus(); // Also call here after everything is loaded
    }

    if (darkModeToggle) {
        // Set initial state of the toggle based on currentTheme which was set by the IIFE or localStorage
        darkModeToggle.checked = (currentTheme === 'dark');

        darkModeToggle.addEventListener('change', () => { // Listen for change on the checkbox
            const newTheme = darkModeToggle.checked ? 'dark' : 'light';
            console.log(`[Toggle Change] Calculated newTheme: ${newTheme}`);
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
            kphCell.textContent = run.kph.toFixed(3);
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
                case 'kph':
                case 'distance':
                    return parseFloat(valA) - parseFloat(valB);
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
                    const runsForThisTable = getRunsForTableFunction();
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
            // Explicitly call with 'date' and 'desc' for initial sort
            sortTableByColumn(runsTableBodySummary, 'date', summaryRunsToRender, true, 'desc');
        }

        // For Jason's Table
        const jasonEntryCountEl = document.getElementById('jasonEntryCount');
        if (runsTableBodyJason) {
            let jasonRunsToRender = runs.filter(run => run.user === 'Jason');
            // Apply type filter for Jason - NOW HANDLED BY applyAllFilters
            // const jasonFilter = document.getElementById('jasonTypeFilter');
            // if (jasonFilter && jasonFilter.value !== 'all') {
            //     jasonRunsToRender = jasonRunsToRender.filter(run => run.type === jasonFilter.value);
            // }
            jasonRunsToRender = applyAllFilters(jasonRunsToRender, 'Jason');
            sortTableByColumn(runsTableBodyJason, 'date', jasonRunsToRender, false, 'desc');
            if (jasonEntryCountEl) {
                jasonEntryCountEl.textContent = ` (${jasonRunsToRender.length} entries)`;
            }
        }

        // For Kelvin's Table
        const kelvinEntryCountEl = document.getElementById('kelvinEntryCount');
        if (runsTableBodyKelvin) {
            let kelvinRunsToRender = runs.filter(run => run.user === 'Kelvin');
            // Apply type filter for Kelvin - NOW HANDLED BY applyAllFilters
            // const kelvinFilter = document.getElementById('kelvinTypeFilter');
            // if (kelvinFilter && kelvinFilter.value !== 'all') {
            //     kelvinRunsToRender = kelvinRunsToRender.filter(run => run.type === kelvinFilter.value);
            // }
            kelvinRunsToRender = applyAllFilters(kelvinRunsToRender, 'Kelvin');
            sortTableByColumn(runsTableBodyKelvin, 'date', kelvinRunsToRender, false, 'desc');
            if (kelvinEntryCountEl) {
                kelvinEntryCountEl.textContent = ` (${kelvinRunsToRender.length} entries)`;
            }
        }
    }

    function updateStatistics() {
        let totalDistanceOverall = 0; 
        let totalDistance2025Jason = 0, totalVisits2025Jason = 0, totalOverallJason = 0, totalVisitsOverallJason = 0;
        let totalDistance2025Kelvin = 0, totalVisits2025Kelvin = 0, totalOverallKelvin = 0, totalVisitsOverallKelvin = 0;

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
            if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
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
                        title: { display: true, text: yAxisLabel, font: {size: 14}, color: colors.ticksColor },
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
                        labels: { font: {size: 14}, color: colors.legendLabelColor }
                    }, 
                    title: { 
                        display: !!chartTitle, // only display if title is provided
                        text: chartTitle, 
                        font: {size: 16},
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
            ['Jason', 'Kelvin'],
            [{
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
            ['Jason', 'Kelvin'],
            [{
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
            const lastVal = acc.length > 0 ? acc[acc.length -1].y : 0;
            acc.push({x: run.date, y: lastVal + dist});
            return acc;
        }, []);
        const kelvinCumulative = kelvinRuns.reduce((acc, run) => {
            const dist = parseFloat(run.distance) || 0;
            const lastVal = acc.length > 0 ? acc[acc.length -1].y : 0;
            acc.push({x: run.date, y: lastVal + dist});
            return acc;
        }, []);
        
        // Create a unique set of all dates for the x-axis
        const allDates = [...new Set([...jasonCumulative.map(d => d.x), ...kelvinCumulative.map(d => d.x)])].sort((a,b) => new Date(a) - new Date(b));

        const colors = getChartColors();

        distanceOverTimeChartInstance = new Chart(distanceOverTimeChartCanvas, {
            type: 'line',
            data: {
                // labels: allDates, // Using time scale, labels are inferred
                datasets: [
                    {
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
                        title: { display: true, text: 'Date', font: {size: 14}, color: colors.ticksColor },
                        grid: { color: colors.gridColor },
                        ticks: { color: colors.ticksColor }
                    },
                    y: { 
                        beginAtZero: true, 
                        title: { display: true, text: 'Cumulative Distance (Km)', font: {size: 14}, color: colors.ticksColor },
                        grid: { color: colors.gridColor },
                        ticks: { color: colors.ticksColor }
                    }
                },
                plugins: { 
                    legend: { 
                        labels: { font: {size: 14}, color: colors.legendLabelColor }
                    }, 
                    title: { 
                        display: false, // Title is now in HTML H2
                        // text: 'Distance Ran Over Time (Km)', // Title now in HTML
                        font: {size: 16},
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
            runForm.mph.value = runToEdit.mph;
            // Ensure distance is populated with 3 decimal places
            const distanceToEdit = parseFloat(runToEdit.distance);
            runForm.distance.value = isNaN(distanceToEdit) ? '' : distanceToEdit.toFixed(3); 
            runForm.bpm.value = runToEdit.bpm || '';
            runForm.plus1.value = runToEdit.plus1 || '';
            runForm.notes.value = runToEdit.notes || '';
            runForm.type.value = runToEdit.type || 'Treadmill'; // Populate type, default if not present
            currentUserForRunInput.value = runToEdit.user;
            runIdToEditInput.value = runId;

            // ---- Store original values for comparison on save ----
            runForm.dataset.originalTime = runToEdit.time;
            runForm.dataset.originalMph = runToEdit.mph.toString();
            // Store original distance with 3 decimal places if it's a valid number
            runForm.dataset.originalDistance = isNaN(distanceToEdit) ? '' : distanceToEdit.toFixed(3);
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
        
        let mphInput = formData.get('mph');
        let distanceInput = formData.get('distance');
        const type = formData.get('type'); // Get the type

        const bpm = formData.get('bpm') ? parseInt(formData.get('bpm')) : null;
        const plus1 = formData.get('plus1') ? parseInt(formData.get('plus1')) : null;
        const notes = formData.get('notes');

        const parsedTimeMinutes = parseMMSS(timeInputString);
        let timeStringToStore = timeInputString; 

        if (!date || !user || isNaN(parsedTimeMinutes) || parsedTimeMinutes <= 0) {
            closeLogRunForm();
            let error = "Please fill in User, Date, and a valid Time (MM:SS, greater than 0).";
            if (isNaN(parsedTimeMinutes) && timeInputString) {
                 error = "Invalid time format. Please use MM:SS (e.g., 30:45 or 30 for 30:00).";
            } else if (parsedTimeMinutes <= 0 && timeInputString) {
                 error = "Time must be greater than 00:00.";
            }
            openModal("Input Error", error, 'error');
            return;
        }
        
        if (!isNaN(parsedTimeMinutes)) {
            timeStringToStore = formatMinutesToMMSS(parsedTimeMinutes);
        }

        let finalMph = mphInput ? parseFloat(mphInput) : 0; // mphInput is formData.get('mph')
        let finalDistance = distanceInput ? parseFloat(distanceInput) : 0; // distanceInput is formData.get('distance')
        let finalKph = 0;

        // --- MODIFICATION FOR EDIT MODE: Check if values changed ---
        if (editingRunId) {
            const originalTime = runForm.dataset.originalTime;
            const originalMphStr = runForm.dataset.originalMph;
            const originalDistanceStr = runForm.dataset.originalDistance;

            // Use a small tolerance for float comparison if necessary, or rely on string comparison for exactness if that was intended
            const mphIsUnchanged = mphInput === originalMphStr; // mphInput is string from formData
            const distanceIsUnchanged = distanceInput === originalDistanceStr; // distanceInput is string from formData
            const timeIsUnchanged = timeInputString === originalTime;

            if (timeIsUnchanged && mphIsUnchanged && distanceIsUnchanged) {
                console.log("[addRun - Edit Mode] No changes to time, mph, or distance. Using original values.");
                finalMph = parseFloat(originalMphStr);
                finalDistance = parseFloat(originalDistanceStr); // Already stored as 3dp string
                finalKph = calculateKph(finalMph); 
            } else {
                console.log("[addRun - Edit Mode] Changes detected or not all original values found. Proceeding with recalculation logic.");
                // Original recalculation logic based on activeCalculatorInput
                if (activeCalculatorInput === 'distance' && !isNaN(finalDistance) && finalDistance > 0) {
                    console.log("[addRun] Prioritizing DISTANCE based on activeCalculatorInput. Original MPH was:", finalMph);
                    finalDistance = parseFloat(finalDistance.toFixed(3));
                    finalMph = parseFloat(calculateMph(parsedTimeMinutes, finalDistance).toFixed(1));
                    finalKph = calculateKph(finalMph);
                    console.log("[addRun] Distance priority: Calculated MPH:", finalMph, "KPH:", finalKph, "Final Distance:", finalDistance);
                } else if (activeCalculatorInput === 'mph' && !isNaN(finalMph) && finalMph > 0) {
                    console.log("[addRun] Prioritizing MPH based on activeCalculatorInput. Original Distance was:", finalDistance);
                    finalMph = parseFloat(finalMph.toFixed(1));
                    finalKph = calculateKph(finalMph);
                    finalDistance = parseFloat(calculateDistance(parsedTimeMinutes, finalKph).toFixed(3));
                    console.log("[addRun] MPH priority: Calculated Distance:", finalDistance, "Final MPH:", finalMph, "KPH:", finalKph);
                } else if (!isNaN(finalDistance) && finalDistance > 0) {
                    console.log("[addRun] Fallback: Only valid Distance provided. Original MPH was:", finalMph);
                    finalDistance = parseFloat(finalDistance.toFixed(3));
                    finalMph = parseFloat(calculateMph(parsedTimeMinutes, finalDistance).toFixed(1));
                    finalKph = calculateKph(finalMph);
                    console.log("[addRun] Fallback (Distance only): Calculated MPH:", finalMph, "KPH:", finalKph, "Final Distance:", finalDistance);
                } else if (!isNaN(finalMph) && finalMph > 0) {
                    console.log("[addRun] Fallback: Only valid MPH provided. Original Distance was:", finalDistance);
                    finalMph = parseFloat(finalMph.toFixed(1));
                    finalKph = calculateKph(finalMph);
                    finalDistance = parseFloat(calculateDistance(parsedTimeMinutes, finalKph).toFixed(3));
                    console.log("[addRun] Fallback (MPH only): Calculated Distance:", finalDistance, "Final MPH:", finalMph, "KPH:", finalKph);
                } else {
                    closeLogRunForm();
                    openModal("Input Error", "Please provide either a valid MPH or a valid Distance (Km).", 'error');
                    return;
                }
            }
        } else {
            // --- This is the ADD mode logic (unchanged from your existing code) ---
            if (activeCalculatorInput === 'distance' && !isNaN(finalDistance) && finalDistance > 0) {
                console.log("[addRun] Prioritizing DISTANCE based on activeCalculatorInput. Original MPH was:", finalMph);
                finalDistance = parseFloat(finalDistance.toFixed(3));
                finalMph = parseFloat(calculateMph(parsedTimeMinutes, finalDistance).toFixed(1));
                finalKph = calculateKph(finalMph);
                console.log("[addRun] Distance priority: Calculated MPH:", finalMph, "KPH:", finalKph, "Final Distance:", finalDistance);
            } else if (activeCalculatorInput === 'mph' && !isNaN(finalMph) && finalMph > 0) {
                console.log("[addRun] Prioritizing MPH based on activeCalculatorInput. Original Distance was:", finalDistance);
                finalMph = parseFloat(finalMph.toFixed(1));
                finalKph = calculateKph(finalMph);
                finalDistance = parseFloat(calculateDistance(parsedTimeMinutes, finalKph).toFixed(3));
                console.log("[addRun] MPH priority: Calculated Distance:", finalDistance, "Final MPH:", finalMph, "KPH:", finalKph);
            } else if (!isNaN(finalDistance) && finalDistance > 0) {
                console.log("[addRun] Fallback: Only valid Distance provided. Original MPH was:", finalMph);
                finalDistance = parseFloat(finalDistance.toFixed(3));
                finalMph = parseFloat(calculateMph(parsedTimeMinutes, finalDistance).toFixed(1));
                finalKph = calculateKph(finalMph);
                console.log("[addRun] Fallback (Distance only): Calculated MPH:", finalMph, "KPH:", finalKph, "Final Distance:", finalDistance);
            } else if (!isNaN(finalMph) && finalMph > 0) {
                console.log("[addRun] Fallback: Only valid MPH provided. Original Distance was:", finalDistance);
                finalMph = parseFloat(finalMph.toFixed(1));
                finalKph = calculateKph(finalMph);
                finalDistance = parseFloat(calculateDistance(parsedTimeMinutes, finalKph).toFixed(3));
                console.log("[addRun] Fallback (MPH only): Calculated Distance:", finalDistance, "Final MPH:", finalMph, "KPH:", finalKph);
            } else {
                closeLogRunForm();
                openModal("Input Error", "Please provide either a valid MPH or a valid Distance (Km).", 'error');
                return;
            }
        }
        // --- End of New Prioritization Logic / Edit mode modification ---

        const day = getDayOfWeek(date);
        const delta = (bpm !== null && plus1 !== null) ? (bpm - plus1) : null;

        const fullRunObject = {
            user, date, time: timeStringToStore, 
            mph: finalMph, 
            kph: parseFloat(finalKph.toFixed(3)), 
            distance: parseFloat(finalDistance.toFixed(3)), // Ensure stored distance is a number with 3dp
            type, // Add type here
            bpm, plus1, delta, notes, day,
            auth_key: hashedAuthKey 
        };

        if (editingRunId) {
            console.log('[addRun - Edit Mode] Attempting to update run ID:', editingRunId);
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
            console.log('[addRun - Add Mode] Attempting to add new run.');
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
                updateStatistics(); // Re-render charts when switching to summary tab
            } else {
                // If switching away from summary, destroy chart instances to prevent issues if they are not visible
                if (distanceOverTimeChartInstance) { distanceOverTimeChartInstance.destroy(); distanceOverTimeChartInstance = null; }
                if (totalKmChartInstance) { totalKmChartInstance.destroy(); totalKmChartInstance = null; }
                if (totalVisitsChartInstance) { totalVisitsChartInstance.destroy(); totalVisitsChartInstance = null; }
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
        console.log('dataChanged event received:', event.detail);
        // Call your main UI refresh functions here
        if (typeof renderAllRuns === 'function' && typeof updateStatistics === 'function') {
            // populateTypeFilters(); // REMOVED
            renderAllRuns();
            updateStatistics();
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
    (async () => {
        if (supabase) {
            runs = await fetchRunsFromSupabase();
            // populateTypeFilters(); // REMOVED
        } else {
            console.error("CRITICAL: Supabase client not initialized. Data cannot be loaded.");
            alert("Failed to connect to the database. Please check your internet connection or contact support.");
            runs = [];
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
        if(runsTableBodySummary) attachSortListenersToTable(runsTableBodySummary, () => [...runs], true);
        if(runsTableBodyJason) attachSortListenersToTable(runsTableBodyJason, () => runs.filter(run => run.user === 'Jason'), false);
        if(runsTableBodyKelvin) attachSortListenersToTable(runsTableBodyKelvin, () => runs.filter(run => run.user === 'Kelvin'), false);
        
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
        updateStatistics(); // This will calculate and render the initial state of the user stats table (sorted by default)
        
        // Add event listeners for the new filters (REMOVED)
        // const jasonTypeFilter = document.getElementById('jasonTypeFilter');
        // if (jasonTypeFilter) {
        //     jasonTypeFilter.addEventListener('change', renderAllRuns);
        // }
        // const kelvinTypeFilter = document.getElementById('kelvinTypeFilter');
        // if (kelvinTypeFilter) {
        //     kelvinTypeFilter.addEventListener('change', renderAllRuns);
        // }

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

        // Load current filters for this user into the form
        if (filterForm) {
            filterForm.reset(); // Reset form first
            const userSpecificFilters = currentFilters[userForFilter] || {};
            console.log(`[openFilterModal] Loading filters for ${userForFilter}:`, userSpecificFilters);
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
        console.log(`[applyFiltersFromModal] Filters saved for ${activeFilterUser}:`, currentFilters[activeFilterUser]);

        closeFilterModal();
        renderAllRuns(); // Re-render tables with new filters
    }

    function resetCurrentUsersFilters() {
        if (!activeFilterUser) return;
        currentFilters[activeFilterUser] = {}; // Clear filters for the active user
        if (filterForm) filterForm.reset(); // Reset the form fields
        console.log(`[resetCurrentUsersFilters] Filters reset for ${activeFilterUser}`);
        // Optionally, re-apply (which means showing all data) and re-render immediately
        // renderAllRuns(); 
        // Or, wait for user to click "Apply Filters" after reset, which is current behavior without the line above.
    }
    
    function applyAllFilters(runsToFilter, user) {
        const filtersToApply = currentFilters[user] || {};
        if (Object.keys(filtersToApply).length === 0) {
            return runsToFilter; // No filters for this user, return original array
        }
        console.log(`[applyAllFilters] Applying filters for ${user}:`, filtersToApply, `on ${runsToFilter.length} runs`);

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
}); 

function calculateUserStats() {
    // This function mirrors the data gathering part of updateStatistics for the stats table
    const yearForStats = 2025;
    const daysSoFarIn2025 = getNumberOfDaysSoFarInYear(yearForStats);

    let totalDistance2025Jason = 0, totalVisits2025Jason = 0, totalOverallJason = 0, totalVisitsOverallJason = 0;
    let totalDistance2025Kelvin = 0, totalVisits2025Kelvin = 0, totalOverallKelvin = 0, totalVisitsOverallKelvin = 0;

    runs.forEach(run => {
        const runDistance = parseFloat(run.distance) || 0;
        // totalDistanceOverall += runDistance; // Not needed for userStats specifically

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

    return [
        {
            user: "Jason",
            totalKm: totalOverallJason,
            totalKm2025: totalDistance2025Jason,
            visits2025: totalVisits2025Jason,
            avgKmDay2025: daysSoFarIn2025 > 0 ? (totalDistance2025Jason / daysSoFarIn2025) : 0,
            goal2025: jasonGoal,
            percentToGoal2025: jasonGoal > 0 ? (totalDistance2025Jason / jasonGoal) * 100 : 0,
            // Raw values for sorting if needed, e.g. percentToGoal2025 could be stored raw
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