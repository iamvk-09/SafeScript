// ════════════════════════════════════════════════════════════════
//  SafeScript — admin.js
//  Admin Dashboard Logic with Firebase Auth
// ════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Firebase Config (must match script.js) ──
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

let allHistory = [];
let currentToken = null;

const authCheck  = document.getElementById('admin-auth-check');
const adminApp   = document.getElementById('admin-app');
const accessErr  = document.getElementById('admin-access-error');
const adminName  = document.getElementById('admin-user-name');
const adminEmail = document.getElementById('admin-user-email');

// ── Auth state ──
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/';
        return;
    }
    currentToken = await user.getIdToken();
    adminName.textContent = user.displayName || 'Admin';
    adminEmail.textContent = user.email || '';

    // Verify admin access via backend
    try {
        const statsRes = await fetch('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (statsRes.status === 403) {
            accessErr.textContent = 'Access denied. You do not have admin privileges.';
            accessErr.classList.remove('hidden');
            document.querySelector('.pulse-ring').style.display = 'none';
            return;
        }
        const statsData = await statsRes.json();
        authCheck.style.display = 'none';
        adminApp.style.display = 'flex';
        renderStats(statsData.stats || {});
        loadAllHistory();
        loadTopDrugs();
    } catch (e) {
        accessErr.textContent = 'Failed to connect to admin API.';
        accessErr.classList.remove('hidden');
    }
});

// ── Logout ──
document.getElementById('admin-logout-btn').addEventListener('click', () => signOut(auth));

// ── Navigation ──
const navItems = document.querySelectorAll('.nav-item[data-view]');
const views    = document.querySelectorAll('.view');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const target = item.getAttribute('data-view');
        views.forEach(v => {
            v.id === `view-${target}` ? v.classList.add('active') : v.classList.remove('active');
        });
    });
});

// ── Refresh ──
document.getElementById('refresh-admin-btn').addEventListener('click', async () => {
    if (!currentToken) return;
    const statsRes = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const statsData = await statsRes.json();
    renderStats(statsData.stats || {});
    loadAllHistory();
    loadTopDrugs();
});

// ── Render Stats ──
function renderStats(stats) {
    document.getElementById('stat-total-checks').textContent  = stats.total_checks?.toLocaleString() ?? '0';
    document.getElementById('stat-severe').textContent        = stats.severe_caught?.toLocaleString() ?? '0';
    document.getElementById('stat-users').textContent         = stats.total_users?.toLocaleString() ?? '0';
    document.getElementById('stat-interactions').textContent  = stats.total_interactions_found?.toLocaleString() ?? '0';
}

// ── Load All History ──
async function loadAllHistory() {
    const tbody = document.getElementById('all-history-body');
    const recentBody = document.getElementById('recent-table-body');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.5;">Loading...</td></tr>';

    try {
        const res = await fetch('/api/admin/history', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        allHistory = data.history || [];
        renderHistoryTable(allHistory, tbody);

        // Recent 10 for overview
        renderHistoryTable(allHistory.slice(0, 10), recentBody);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#fca5a5;">Error: ${err.message || 'Failed to load.'}</td></tr>`;
    }
}

function renderHistoryTable(items, tbody) {
    tbody.innerHTML = '';
    if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;opacity:.5;">No data yet.</td></tr>';
        return;
    }
    items.forEach(item => {
        const tr = document.createElement('tr');
        const sev = item.severity || 'None';
        const sevClass = sev === 'Severe' ? 'sev-badge sev-severe' :
                         sev === 'Moderate' ? 'sev-badge sev-moderate' :
                         sev === 'Mild' ? 'sev-badge sev-mild' : '';
        const date = item.timestamp ? new Date(item.timestamp).toLocaleString() : '—';
        const uid = item.uid || '—';
        tr.innerHTML = `
            <td>${(item.drugs || []).join(', ')}</td>
            <td>${item.interactions_count ?? '—'}</td>
            <td>${sevClass ? `<span class="${sevClass}">${sev}</span>` : sev}</td>
            <td>${date}</td>
            <td class="uid-cell" title="${uid}">${uid.slice(0, 10)}...</td>
        `;
        tbody.appendChild(tr);
    });
}

// ── Search Filter ──
document.getElementById('search-filter').addEventListener('input', function () {
    const q = this.value.toLowerCase();
    const filtered = allHistory.filter(h =>
        (h.drugs || []).some(d => d.toLowerCase().includes(q))
    );
    renderHistoryTable(filtered, document.getElementById('all-history-body'));
});

// ── Top Drugs ──
async function loadTopDrugs() {
    const container = document.getElementById('top-drugs-list');
    container.innerHTML = '<p class="text-muted">Loading...</p>';
    try {
        const res = await fetch('/api/admin/top_drugs', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const drugs = data.top_drugs || [];
        if (drugs.length === 0) {
            container.innerHTML = '<p class="text-muted">No data yet.</p>';
            return;
        }
        const max = drugs[0]?.count || 1;
        container.innerHTML = '';
        drugs.forEach((item, i) => {
            const pct = Math.round((item.count / max) * 100);
            const div = document.createElement('div');
            div.className = 'top-drug-row';
            div.innerHTML = `
                <div class="rank-num">#${i + 1}</div>
                <div class="rank-info">
                    <div class="rank-name">${item.drug.charAt(0).toUpperCase() + item.drug.slice(1)}</div>
                    <div class="rank-bar-wrap">
                        <div class="rank-bar" style="width:${pct}%"></div>
                    </div>
                </div>
                <div class="rank-count">${item.count} searches</div>
            `;
            container.appendChild(div);
        });
    } catch (err) {
        container.innerHTML = `<p style="color:#fca5a5;">Error: ${err.message || 'Failed to load.'}</p>`;
    }
}
