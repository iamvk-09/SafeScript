// ════════════════════════════════════════════════════════════════
//  SafeScript — script.js
//  Firebase Auth + Firestore History + Drug Interaction Engine
// ════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    updateProfile,
    signOut,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Firebase Config (replace with your config from Firebase Console) ──
const firebaseConfig = {
  apiKey: "AIzaSyD1QLU_S96MJN_QE14H3U-g-plHB-XCNJY",
  authDomain: "ai-safescript.firebaseapp.com",
  projectId: "ai-safescript",
  storageBucket: "ai-safescript.firebasestorage.app",
  messagingSenderId: "958294995951",
  appId: "1:958294995951:web:02fb15c7594e911664bc1a",
  measurementId: "G-ZXSNQDDHWT"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// ── State ──
let currentUser = null;
let idToken = null;
let selectedDrugs = []; // Array of { name: string, dosage: string }
let cloudHistory = [];
let patientProfile = { age: '', conditions: '' };

// ── DOM Refs ──
const authOverlay    = document.getElementById('auth-overlay');
const appContainer   = document.getElementById('app-container');
const loginForm      = document.getElementById('login-form');
const signupForm     = document.getElementById('signup-form');
const tabLogin       = document.getElementById('tab-login');
const tabSignup      = document.getElementById('tab-signup');
const loginError     = document.getElementById('login-error');
const signupError    = document.getElementById('signup-error');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn      = document.getElementById('logout-btn');
const userName       = document.getElementById('user-name');
const userEmail      = document.getElementById('user-email');
const userAvatar     = document.getElementById('user-avatar');
const syncIndicator  = document.getElementById('sync-indicator');
const adminNavLink   = document.getElementById('admin-nav-link');

// ════════════════════════════════════════════════════════════════
//  AUTH LOGIC
// ════════════════════════════════════════════════════════════════

// Tab switching
tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabSignup.classList.remove('active');
    loginForm.classList.remove('hidden'); signupForm.classList.add('hidden');
    loginError.classList.add('hidden');
});
tabSignup.addEventListener('click', () => {
    tabSignup.classList.add('active'); tabLogin.classList.remove('active');
    signupForm.classList.remove('hidden'); loginForm.classList.add('hidden');
    signupError.classList.add('hidden');
});

function showAuthError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
}

function setButtonLoading(btn, loading) {
    if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Please wait...';
        btn.disabled = true;
    } else {
        btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
        btn.disabled = false;
    }
}

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const statusEl = document.getElementById('auth-status-login');
    setButtonLoading(btn, true);
    statusEl.textContent = 'Connecting to Secure Server...';

    // Safety timeout to reset button if things hang
    const timeout = setTimeout(() => {
        setButtonLoading(btn, false);
        statusEl.textContent = 'Connection timeout. Please check your internet and try again.';
    }, 15000);

    try {
        statusEl.textContent = 'Verifying credentials...';
        const cred = await signInWithEmailAndPassword(auth,
            document.getElementById('login-email').value,
            document.getElementById('login-password').value
        );
        clearTimeout(timeout);
        statusEl.textContent = 'Identity verified. Checking security...';

        if (!cred.user.emailVerified) {
            statusEl.textContent = 'Email verification required.';
            await sendEmailVerification(cred.user);
            await signOut(auth);
            showAuthError(loginError, "Please verify your email address to log in. A new verification link has been sent to your email.");
            setButtonLoading(btn, false);
            statusEl.textContent = '';
            return;
        }
        statusEl.textContent = 'Access granted. Opening dashboard...';
        showApp(cred.user);
    } catch (err) {
        clearTimeout(timeout);
        console.error("Login Error:", err);
        showAuthError(loginError, friendlyAuthError(err.code));
        setButtonLoading(btn, false);
        statusEl.textContent = '';
    }
});

// Signup
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupError.classList.add('hidden');
    const btn = document.getElementById('signup-btn');
    setButtonLoading(btn, true);
    try {
        const cred = await createUserWithEmailAndPassword(auth,
            document.getElementById('signup-email').value,
            document.getElementById('signup-password').value
        );
        await updateProfile(cred.user, {
            displayName: document.getElementById('signup-name').value
        });
        await sendEmailVerification(cred.user);
        await signOut(auth);
        
        signupError.textContent = "Account created! Please verify your email before logging in.";
        signupError.classList.remove('hidden');
        signupError.style.color = '#6ee7b7';
        signupError.style.background = 'var(--success-bg)';
        signupError.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        signupForm.reset();
        setButtonLoading(btn, false);
    } catch (err) {
        showAuthError(signupError, friendlyAuthError(err.code));
        setButtonLoading(btn, false);
    }
});

// Google login
googleLoginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (err) {
        showAuthError(loginError, friendlyAuthError(err.code));
    }
});

// Logout
logoutBtn.addEventListener('click', () => signOut(auth));

function friendlyAuthError(code) {
    const map = {
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/popup-closed-by-user': 'Sign-in popup was closed.',
        'auth/network-request-failed': 'Network error. Check your connection.',
        'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    };
    return map[code] || `Authentication failed: ${code || 'Unknown Error'}. Please try again.`;
}

// Auth state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        // If password user but not verified, only allow if they are in the middle of login
        if (!user.emailVerified && user.providerData.some(p => p.providerId === 'password')) {
            return;
        }
        currentUser = user;
        // SHOW APP IMMEDIATELY
        showApp(user);
        
        // Background tasks
        user.getIdToken().then(token => {
            idToken = token;
            if (window.loadCloudHistory) window.loadCloudHistory();
        }).catch(err => console.error("Background token fetch failed", err));
    } else {
        currentUser = null;
        idToken = null;
        showAuth();
    }
});

async function showApp(user) {
    currentUser = user;
    // Hide overlay immediately to prevent "Please wait" hangs
    authOverlay.style.display = 'none';
    appContainer.style.display = 'flex';

    userName.textContent = user.displayName || 'User';
    userEmail.textContent = user.email || '';
    if (user.photoURL) {
        userAvatar.innerHTML = `<img src="${user.photoURL}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    }
    
    // Background Admin Check
    checkAdminStatus(user);

    // Load user-specific patient profile
    const profileKey = `safescript_profile_${user.uid}`;
    patientProfile = JSON.parse(localStorage.getItem(profileKey)) || { age: '', conditions: '' };
    
    const profileAge = document.getElementById('profile-age');
    const profileConditions = document.getElementById('profile-conditions');
    const useProfileToggle = document.getElementById('use-profile-toggle');
    if (profileAge) profileAge.value = patientProfile.age || '';
    if (profileConditions) profileConditions.value = patientProfile.conditions || '';
    if (useProfileToggle) useProfileToggle.checked = !!(patientProfile.age || patientProfile.conditions);
}

async function checkAdminStatus(user) {
    try {
        const token = await user.getIdToken();
        const res = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.isAdmin) {
            const adminLink = document.getElementById('admin-nav-link');
            if (adminLink) adminLink.style.display = 'flex';
        }
    } catch (e) {
        console.warn("Admin check skipped or failed", e);
    }
}

function showAuth() {
    authOverlay.style.display = 'flex';
    appContainer.style.display = 'none';
}

// Refresh token before API calls
async function getToken() {
    if (!currentUser) return null;
    return await currentUser.getIdToken(false);
}

function setSyncStatus(status) {
    // status: 'syncing' | 'synced' | 'error'
    if (status === 'syncing') {
        syncIndicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        syncIndicator.title = 'Syncing to cloud...';
        syncIndicator.style.color = 'var(--gold)';
    } else if (status === 'synced') {
        syncIndicator.innerHTML = '<i class="fa-solid fa-cloud-check"></i>';
        syncIndicator.title = 'Synced to cloud';
        syncIndicator.style.color = '#6ee7b7';
        setTimeout(() => {
            syncIndicator.innerHTML = '<i class="fa-solid fa-cloud"></i>';
            syncIndicator.style.color = '';
        }, 3000);
    } else {
        syncIndicator.innerHTML = '<i class="fa-solid fa-cloud-slash"></i>';
        syncIndicator.title = 'Sync failed';
        syncIndicator.style.color = '#fca5a5';
    }
}

// ════════════════════════════════════════════════════════════════
//  MAIN APP LOGIC
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

    // ── Navigation ──
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('page-title');

    const pageTitles = {
        dashboard: 'Interaction Check Dashboard',
        history: 'Cloud History',
        profile: 'Patient Context Profile'
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const targetView = item.getAttribute('data-view');
            views.forEach(v => {
                v.id === `view-${targetView}` ? v.classList.add('active') : v.classList.remove('active');
            });
            pageTitle.textContent = pageTitles[targetView] || 'SafeScript';
            if (targetView === 'history' && window.loadCloudHistory) window.loadCloudHistory();
        });
    });

    // ── Input Tabs ──
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabContents.forEach(c => {
                c.id === btn.getAttribute('data-tab') ? c.classList.add('active') : c.classList.remove('active');
            });
        });
    });

    // ── Drug Management ──
    const drugInput     = document.getElementById('drug-input');
    const addDrugBtn    = document.getElementById('add-drug-btn');
    const drugsList     = document.getElementById('drugs-list');
    const drugCount     = document.getElementById('drug-count');
    const checkBtn      = document.getElementById('check-btn');
    const clearBtn      = document.getElementById('clear-btn');
    const drugSuggestions = document.getElementById('drug-suggestions');

    const renderDrugs = () => {
        drugsList.innerHTML = '';
        selectedDrugs.forEach((drug, index) => {
            const tag = document.createElement('div');
            tag.className = 'drug-tag';
            tag.innerHTML = `<div>
                                <span class="drug-name-tag">${drug.name.charAt(0).toUpperCase() + drug.name.slice(1)}</span>
                                <span class="dosage-tag">${drug.dosage || ''}</span>
                             </div>
                             <button aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>`;
            tag.querySelector('button').addEventListener('click', () => {
                selectedDrugs.splice(index, 1);
                renderDrugs();
            });
            drugsList.appendChild(tag);
        });
        drugCount.textContent = selectedDrugs.length;
        checkBtn.disabled = selectedDrugs.length < 2;
    };

    const addDrug = async () => {
        const nameVal = drugInput.value.trim().toLowerCase();
        const dosageVal = document.getElementById('dosage-input').value.trim();
        
        if (!nameVal) return;
        if (selectedDrugs.some(d => d.name === nameVal && d.dosage === dosageVal)) return;

        const originalIcon = addDrugBtn.innerHTML;
        addDrugBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        addDrugBtn.disabled = true;
        drugSuggestions.classList.add('hidden');
        drugSuggestions.innerHTML = '';

        try {
            const response = await fetch('/api/validate_drug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ drug: nameVal })
            });
            const data = await response.json();
            if (!data.valid) {
                drugSuggestions.classList.remove('hidden');
                let suggHtml = '';
                if (data.suggestions && data.suggestions.length > 0) {
                    suggHtml = `<span class="sugg-title"><i class="fa-solid fa-circle-exclamation"></i> Did you mean:</span>`;
                    data.suggestions.forEach(sugg => {
                        suggHtml += `<div class="sugg-pill">${sugg}</div>`;
                    });
                } else {
                    suggHtml = `<span class="sugg-title" style="color:#fca5a5;"><i class="fa-solid fa-triangle-exclamation"></i> Unrecognized medication.</span>`;
                }
                suggHtml += `<button class="sugg-ignore">Add "${nameVal}" anyway</button>`;
                drugSuggestions.innerHTML = suggHtml;
                drugSuggestions.querySelectorAll('.sugg-pill').forEach(pill => {
                    pill.addEventListener('click', () => {
                        const correctVal = pill.textContent.toLowerCase();
                        selectedDrugs.push({ name: correctVal, dosage: dosageVal });
                        renderDrugs();
                        drugInput.value = '';
                        document.getElementById('dosage-input').value = '';
                        drugSuggestions.classList.add('hidden');
                    });
                });
                drugSuggestions.querySelector('.sugg-ignore').addEventListener('click', () => {
                    selectedDrugs.push({ name: nameVal, dosage: dosageVal });
                    renderDrugs();
                    drugInput.value = '';
                    document.getElementById('dosage-input').value = '';
                    drugSuggestions.classList.add('hidden');
                });
            } else {
                selectedDrugs.push({ name: nameVal, dosage: dosageVal });
                renderDrugs();
                drugInput.value = '';
                document.getElementById('dosage-input').value = '';
            }
        } catch {
            selectedDrugs.push({ name: nameVal, dosage: dosageVal });
            renderDrugs();
            drugInput.value = '';
            document.getElementById('dosage-input').value = '';
        } finally {
            addDrugBtn.innerHTML = originalIcon;
            addDrugBtn.disabled = false;
        }
    };

    addDrugBtn.addEventListener('click', addDrug);
    drugInput.addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('dosage-input').focus(); } });
    document.getElementById('dosage-input').addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); addDrug(); } });
    clearBtn.addEventListener('click', () => { selectedDrugs = []; renderDrugs(); resetResults(); });

    // ── File Upload ──
    const dropZone    = document.getElementById('drop-zone');
    const fileInput   = document.getElementById('file-input');
    const uploadStatus = document.getElementById('upload-status');

    const handleFile = async (file) => {
        if (!file) return;
        const formData = new FormData();
        formData.append('image', file);
        uploadStatus.className = 'status-msg';
        uploadStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Rx Image...';
        try {
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (data.drugs_detected && data.drugs_detected.length > 0) {
                data.drugs_detected.forEach(d => {
                    if (!selectedDrugs.some(sd => sd.name === d.toLowerCase())) {
                        selectedDrugs.push({ name: d.toLowerCase(), dosage: '' });
                    }
                });
                renderDrugs();
                uploadStatus.className = 'status-msg success';
                uploadStatus.textContent = `Scanned ${data.drugs_detected.length} medicines.`;
            } else {
                uploadStatus.className = 'status-msg error';
                uploadStatus.textContent = 'No medicines recognized.';
            }
        } catch (error) {
            uploadStatus.className = 'status-msg error';
            uploadStatus.textContent = error.message;
        }
    };

    fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    // ── Profile ──
    const profileAge        = document.getElementById('profile-age');
    const profileConditions = document.getElementById('profile-conditions');
    const saveProfileBtn    = document.getElementById('save-profile-btn');
    const profileStatus     = document.getElementById('profile-status');
    const useProfileToggle  = document.getElementById('use-profile-toggle');

    profileAge.value = patientProfile.age || '';
    profileConditions.value = patientProfile.conditions || '';
    useProfileToggle.checked = !!(patientProfile.age || patientProfile.conditions);

    saveProfileBtn.addEventListener('click', () => {
        patientProfile = { age: profileAge.value.trim(), conditions: profileConditions.value.trim() };
        if (currentUser) {
            localStorage.setItem(`safescript_profile_${currentUser.uid}`, JSON.stringify(patientProfile));
        }
        useProfileToggle.checked = true;
        profileStatus.textContent = "Profile Saved!";
        profileStatus.className = "status-msg success";
        setTimeout(() => profileStatus.className = "status-msg hidden", 3000);
    });

    // ── Results ──
    const resultsContent     = document.getElementById('results-content');
    const loader             = document.getElementById('loader');
    const interactionSummary = document.getElementById('interaction-summary');
    const printBtn           = document.getElementById('print-btn');

    const resetResults = () => {
        resultsContent.innerHTML = `<div class="empty-state"><div class="icon-bg"><i class="fa-solid fa-file-waveform"></i></div><p>Add 2 or more medicines to view safety analysis and AI report.</p></div>`;
        interactionSummary.textContent = 'Awaiting Input';
        interactionSummary.style.background = '';
        interactionSummary.style.color = '';
    };

    const getSevClass = sev => {
        const s = sev.toLowerCase();
        if (s.includes('severe') || s.includes('high')) return 'sev-severe';
        if (s.includes('mild') || s.includes('low')) return 'sev-mild';
        if (s.includes('warning') || s.includes('unknown')) return 'sev-warning';
        return 'sev-moderate';
    };

    checkBtn.addEventListener('click', async () => {
        if (selectedDrugs.length < 2) return;
        resultsContent.innerHTML = '';
        loader.classList.remove('hidden');
        interactionSummary.textContent = 'Analyzing...';

        const payload = { drugs: selectedDrugs };
        if (useProfileToggle.checked && (patientProfile.age || patientProfile.conditions)) {
            payload.patient_age = parseInt(patientProfile.age) || null;
            payload.patient_conditions = patientProfile.conditions || null;
        }

        try {
            const token = await getToken();
            const response = await fetch('/api/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            loader.classList.add('hidden');

            // Cache badge
            if (data.from_cache) {
                const cacheBadge = document.createElement('div');
                cacheBadge.className = 'cache-badge';
                cacheBadge.innerHTML = '<i class="fa-solid fa-bolt"></i> Served from AI Cache';
                resultsContent.appendChild(cacheBadge);
            }

            // Interactions
            if (data.interactions && data.interactions.length > 0) {
                interactionSummary.textContent = `${data.interactions.length} Interactions`;
                interactionSummary.style.background = 'var(--danger-bg)';
                interactionSummary.style.color = '#fca5a5';
                data.interactions.forEach(int => {
                    const card = document.createElement('div');
                    card.className = 'interaction-card';
                    card.innerHTML = `
                        <div class="card-top">
                            <div class="drug-pair">${int.drugs[0]} <i class="fa-solid fa-arrow-right-arrow-left"></i> ${int.drugs[1] || ''}</div>
                            <span class="sev-badge ${getSevClass(int.severity)}">${int.severity}</span>
                        </div>
                        <div class="card-desc">${int.description}</div>
                        <div class="card-source"><i class="fa-solid fa-database"></i> Source: ${int.source}</div>
                    `;
                    resultsContent.appendChild(card);
                });
            } else {
                interactionSummary.textContent = 'Safe to Combine';
                interactionSummary.style.background = 'var(--success-bg)';
                interactionSummary.style.color = '#6ee7b7';
                resultsContent.innerHTML += `
                    <div class="interaction-card" style="text-align:center;padding:2rem;">
                        <i class="fa-solid fa-circle-check" style="font-size:3rem;color:var(--success);margin-bottom:1rem;"></i>
                        <h3 style="justify-content:center;margin-bottom:0.5rem;color:var(--success)">No known interactions found</h3>
                        <p class="text-muted">The selected combination appears safe. Always consult your doctor.</p>
                    </div>`;
            }

            // AI Report
            if (data.ai_report) {
                const aiDiv = document.createElement('div');
                aiDiv.className = 'ai-report';
                
                // Enhanced simple markdown parser
                let fmt = data.ai_report;
                fmt = fmt.replace(/### (.*?)\n/g, '<h5>$1</h5>'); // Headers
                fmt = fmt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
                fmt = fmt.replace(/^\* (.*?)$/gm, '<li>$1</li>'); // Bullets
                fmt = fmt.replace(/\n/g, '<br>'); // Line breaks
                
                // Wrap lists
                if (fmt.includes('<li>')) {
                    fmt = fmt.replace(/(<li>.*?<\/li>)/gs, '<ul class="ai-list">$1</ul>');
                }

                aiDiv.innerHTML = `
                    <h4><i class="fa-solid fa-robot"></i> AI Safety Report</h4>
                    <div class="ai-content">${fmt}</div>`;
                resultsContent.appendChild(aiDiv);
            }

            // Save to Firestore
            const topSeverity = data.interactions && data.interactions.length > 0
                ? (data.interactions.find(i => i.severity === 'Severe')?.severity || data.interactions[0].severity)
                : 'None';
            await saveToCloud(selectedDrugs.map(d => `${d.name} (${d.dosage || 'no dosage'})`), data.interactions?.length || 0, topSeverity, data.ai_report || '');

        } catch (error) {
            loader.classList.add('hidden');
            resetResults();
            alert("Analysis failed: " + error.message);
        }
    });

    // ── Cloud History ──
    window.loadCloudHistory = async function() {
        const historyList    = document.getElementById('history-list');
        const historyLoading = document.getElementById('history-loading');
        const badge          = document.getElementById('history-count-badge');

        historyLoading.classList.remove('hidden');
        historyList.innerHTML = '';
        const token = await getToken();
        if (!token) {
            historyLoading.classList.add('hidden');
            historyList.innerHTML = '<div class="text-muted">Sign in to view cloud history.</div>';
            return;
        }
        try {
            const res = await fetch('/api/history', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            cloudHistory = data.history || [];
            badge.textContent = cloudHistory.length > 0 ? cloudHistory.length : '';
            renderCloudHistory(cloudHistory);
        } catch (e) {
            historyList.innerHTML = '<div class="text-muted">Failed to load history.</div>';
        } finally {
            historyLoading.classList.add('hidden');
        }
    };

    function renderCloudHistory(items) {
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = '';
        if (!items || items.length === 0) {
            historyList.innerHTML = '<div class="text-muted" style="grid-column:1/-1;">No analyses yet. Start checking drug interactions!</div>';
            return;
        }
        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';
            const isSafe = item.interactions_count === 0;
            const resClass = isSafe ? 'sev-mild' : 'sev-severe';
            const resText = isSafe ? 'Safe' : `${item.interactions_count} Risk(s)`;
            const date = item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Unknown time';
            card.innerHTML = `
                <div class="hist-date"><i class="fa-solid fa-clock"></i> ${date}</div>
                <div class="hist-drugs">${(item.drugs || []).join(', ')}</div>
                <div class="flex-between mt-2">
                    <div class="hist-result ${resClass}">
                        <i class="fa-solid ${isSafe ? 'fa-check' : 'fa-triangle-exclamation'}"></i> ${resText}
                    </div>
                    <button class="delete-hist-btn" data-id="${item.id}" title="Delete">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>`;
            card.querySelector('.delete-hist-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await deleteHistoryItem(item.id, card);
            });
            card.addEventListener('click', (e) => {
                if (e.target.closest('.delete-hist-btn')) return;
                selectedDrugs = (item.drugs || []).map(d => {
                    const parts = d.match(/^(.*?) \((.*?)\)$/);
                    return parts ? { name: parts[1], dosage: parts[2] } : { name: d, dosage: '' };
                });
                renderDrugs();
                document.querySelector('[data-view="dashboard"]').click();
                setTimeout(() => checkBtn.click(), 300);
            });
            historyList.appendChild(card);
        });
    }

    async function deleteHistoryItem(id, cardEl) {
        const token = await getToken();
        if (!token) return;
        cardEl.style.opacity = '0.4';
        try {
            await fetch(`/api/history/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            cardEl.remove();
            cloudHistory = cloudHistory.filter(h => h.id !== id);
            const badge = document.getElementById('history-count-badge');
            badge.textContent = cloudHistory.length > 0 ? cloudHistory.length : '';
        } catch {
            cardEl.style.opacity = '1';
        }
    }

    document.getElementById('refresh-history-btn').addEventListener('click', () => {
        if (window.loadCloudHistory) window.loadCloudHistory();
    });

    document.getElementById('clear-history-btn').addEventListener('click', async () => {
        if (!confirm('Delete all your history? This cannot be undone.')) return;
        const token = await getToken();
        if (!token) return;
        for (const item of cloudHistory) {
            try {
                await fetch(`/api/history/${item.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch {}
        }
        cloudHistory = [];
        renderCloudHistory([]);
        document.getElementById('history-count-badge').textContent = '';
    });

    // ── Save to Cloud ──
    async function saveToCloud(drugs, interactionsCount, severity, aiReport) {
        const token = await getToken();
        if (!token || !currentUser) return;
        setSyncStatus('syncing');
        try {
            const response = await fetch('/api/history/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    uid: currentUser.uid,
                    drugs,
                    interactions_count: interactionsCount,
                    severity,
                    ai_report_summary: aiReport.substring(0, 500)
                })
            });
            const result = await response.json();
            if (result.saved) {
                console.log("SafeScript: History saved successfully. ID:", result.id);
                setSyncStatus('synced');
                const badge = document.getElementById('history-count-badge');
                if (badge) {
                    const current = parseInt(badge.textContent) || 0;
                    badge.textContent = current + 1;
                }
            } else {
                console.error("SafeScript: Server failed to save history.", result.error, result.details);
                setSyncStatus('error');
            }
        } catch (err) {
            console.error("SafeScript: Save network error.", err);
            setSyncStatus('error');
        }
    }

    // ── Print ──
    printBtn.addEventListener('click', () => {
        if (selectedDrugs.size < 2) return alert("Run an analysis first.");
        window.print();
    });

    // ── User Account Profile ──
    const userCard = document.getElementById('user-card');
    const accountEmail = document.getElementById('account-email');
    const accountName = document.getElementById('account-name');
    const saveAccountBtn = document.getElementById('save-account-btn');
    const accountStatus = document.getElementById('account-status');

    userCard.addEventListener('click', (e) => {
        // Prevent opening if clicking the logout button directly
        if (e.target.closest('#logout-btn')) return;
        
        // Deactivate all sidebar nav items
        navItems.forEach(n => n.classList.remove('active'));
        
        // Activate account view
        views.forEach(v => {
            v.id === `view-account` ? v.classList.add('active') : v.classList.remove('active');
        });
        pageTitle.textContent = 'Account Settings';
        
        // Populate fields
        if (currentUser) {
            accountEmail.value = currentUser.email || '';
            accountName.value = currentUser.displayName || '';
        }
    });

    userCard.style.cursor = 'pointer'; // Make it look clickable

    saveAccountBtn.addEventListener('click', async () => {
        if (!currentUser) return;
        const originalText = saveAccountBtn.textContent;
        saveAccountBtn.disabled = true;
        saveAccountBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        
        try {
            await updateProfile(currentUser, {
                displayName: accountName.value.trim()
            });
            accountStatus.textContent = "Profile updated successfully!";
            accountStatus.className = "status-msg success";
            
            // Instantly update the sidebar name
            document.getElementById('user-name').textContent = accountName.value.trim() || 'User';
        } catch (error) {
            accountStatus.textContent = "Error updating profile: " + error.message;
            accountStatus.className = "status-msg error";
        } finally {
            saveAccountBtn.disabled = false;
            saveAccountBtn.textContent = originalText;
            accountStatus.classList.remove('hidden');
            setTimeout(() => accountStatus.classList.add('hidden'), 3000);
        }
    });

    // ── Camera Feature ──
    const cameraOverlay = document.getElementById('camera-overlay');
    const openCameraBtn = document.getElementById('open-camera-btn');
    const closeCameraBtn = document.getElementById('close-camera-btn');
    const captureBtn = document.getElementById('capture-btn');
    const cameraFeed = document.getElementById('camera-feed');
    const cameraCanvas = document.getElementById('camera-canvas');
    let stream = null;

    const startCamera = async () => {
        try {
            // Prefer back camera on mobile
            stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: { ideal: "environment" },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            cameraFeed.srcObject = stream;
            cameraOverlay.classList.remove('hidden');
        } catch (err) {
            console.error("Camera access failed:", err);
            alert("Unable to access camera. Please ensure you have granted permission and are using HTTPS.");
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        cameraOverlay.classList.add('hidden');
    };

    const captureImage = () => {
        if (!cameraFeed.videoWidth) return;

        const context = cameraCanvas.getContext('2d');
        cameraCanvas.width = cameraFeed.videoWidth;
        cameraCanvas.height = cameraFeed.videoHeight;
        
        // Flash effect
        cameraFeed.style.filter = 'brightness(2) contrast(1.5)';
        setTimeout(() => cameraFeed.style.filter = '', 100);

        context.drawImage(cameraFeed, 0, 0, cameraCanvas.width, cameraCanvas.height);
        
        cameraCanvas.toBlob(async (blob) => {
            const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
            stopCamera();
            
            // Switch to dashboard view if not already there
            const dashboardTab = document.querySelector('[data-view="dashboard"]');
            if (dashboardTab) dashboardTab.click();
            
            // Process the captured file
            handleFile(file);
        }, 'image/jpeg', 0.8);
    };

    if (openCameraBtn) openCameraBtn.addEventListener('click', startCamera);
    if (closeCameraBtn) closeCameraBtn.addEventListener('click', stopCamera);
    if (captureBtn) captureBtn.addEventListener('click', captureImage);

    // Close on overlay click
    cameraOverlay.addEventListener('click', (e) => {
        if (e.target === cameraOverlay) stopCamera();
    });

    // ── Initialize ──
    renderDrugs();
});
