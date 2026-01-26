const API_URL = "http://localhost:8000";

// STATE
let projects = [];
let editId = null;
let currentProcessingProject = null;
let folders = []; // [{id, paths: [{code, suffix}]}]

// IMAGE ARRAYS (for pagination)
let allKeep = [];
let allTrash = [];
let pageKeep = 1;
let pageTrash = 1;
const PAGE_SIZE = 15; // User requested split for 18 items (15+3)

// INIT
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchSettings();
    fetchProjects();
    setDefaultDates();
});

function toggleSettings() {
    const content = document.getElementById('settingsContent');
    const header = document.querySelector('.settings-header');

    content.classList.toggle('open');
    header.classList.toggle('open');
}

// FUNCTIONS
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');

    // Update nav
    if (btn) {
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
    }
}

function setDefaultDates() {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date();
    start.setDate(start.getDate() - 7);

    document.getElementById('execDateTo').value = end.toISOString().split('T')[0];
    document.getElementById('execDateFrom').value = start.toISOString().split('T')[0];
}

async function fetchProjects() {
    try {
        const res = await fetch(`${API_URL}/projects`);
        projects = await res.json();
        renderProjects();
    } catch (e) {
        console.error(e);
    }
}

// Helper to remove quotes everywhere
const cleanStr = (s) => s ? s.replace(/"/g, '').trim() : '';

function renderProjects() {
    const container = document.getElementById('projectsList');
    container.innerHTML = '';

    if (projects.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#555; padding: 20px;">Brak projektów.</div>';
        return;
    }

    const today = new Date();
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date();
    start.setDate(start.getDate() - 7);

    const defStart = start.toISOString().split('T')[0];
    const defEnd = end.toISOString().split('T')[0];

    projects.forEach(p => {
        // CLEAN DISPLAY DATA
        const cleanName = cleanStr(p.name);
        const cleanManager = cleanStr(p.manager);

        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
            <div class="card-info">
                <h3>${cleanName}</h3>
                <div class="manager-text">${cleanManager}</div>
            </div>
            
            <div class="card-controls">
                <div class="local-date-group">
                    <input type="date" id="dFrom-${p.id}" value="${defStart}">
                    <span>-</span>
                    <input type="date" id="dTo-${p.id}" value="${defEnd}">
                </div>
                
                <div class="btn-group">
                    <button class="btn-primary center-flex" onclick="initExecution('${p.id}')">
                        <i data-lucide="play"></i> Generuj
                    </button>
                    <button class="btn-icon center-flex" onclick="editProject('${p.id}')">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn-icon center-flex" onclick="deleteProject('${p.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    lucide.createIcons();
}

async function fetchSettings() {
    try {
        const res = await fetch(`${API_URL}/settings`);
        const data = await res.json();
        document.getElementById('ftpHost').value = data.ftp_host || '';
        document.getElementById('ftpUser').value = data.ftp_user || '';
        document.getElementById('ftpPass').value = data.ftp_pass || '';
        document.getElementById('geminiKey').value = data.gemini_key || '';
        document.getElementById('awsAccessKey').value = data.aws_access_key || '';
        document.getElementById('awsSecretKey').value = data.aws_secret_key || '';
        document.getElementById('awsBucketName').value = data.aws_bucket_name || '';
        document.getElementById('awsRegion').value = data.aws_region || '';
    } catch (e) { }
}

async function saveSettings() {
    const payload = {
        ftp_host: document.getElementById('ftpHost').value,
        ftp_user: document.getElementById('ftpUser').value,
        ftp_pass: document.getElementById('ftpPass').value,
        gemini_key: document.getElementById('geminiKey').value,
        aws_access_key: document.getElementById('awsAccessKey').value,
        aws_secret_key: document.getElementById('awsSecretKey').value,
        aws_bucket_name: document.getElementById('awsBucketName').value,
        aws_region: document.getElementById('awsRegion').value
    };
    await fetch(`${API_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    alert("Zapisano!");
}

// CREATOR LOGIC
function initCreator() {
    editId = null;
    document.getElementById('creatorTitle').innerText = 'Nowy Projekt';
    document.getElementById('projName').value = '';
    document.getElementById('projManager').value = '';
    document.getElementById('projCc').value = '';
    document.getElementById('cancelEditBtn').classList.add('hidden');

    folders = [{ id: crypto.randomUUID(), paths: [{ code: '', suffix: '' }] }];
    renderFolders();
    switchTab('create');
    // Highlight nav manually
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn')[2].classList.add('active'); // 3rd button is creator
}

function editProject(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;

    editId = id;
    document.getElementById('creatorTitle').innerText = 'Edycja Projektu: ' + p.name;
    document.getElementById('projName').value = p.name;
    document.getElementById('projManager').value = p.manager;
    document.getElementById('projCc').value = p.cc;
    document.getElementById('cancelEditBtn').classList.remove('hidden');

    if (p.structure_raw && p.structure_raw.length > 0) {
        folders = JSON.parse(JSON.stringify(p.structure_raw));
    } else {
        folders = [{ id: crypto.randomUUID(), paths: [{ code: '', suffix: '' }] }];
    }

    renderFolders();
    switchTab('create');
}

function cancelEdit() {
    initCreator(); // Resets form
    switchTab('projects'); // Go back to list
}

function renderFolders() {
    const container = document.getElementById('foldersContainer');
    container.innerHTML = '';

    folders.forEach((f, fIdx) => {
        const div = document.createElement('div');
        div.className = 'folder-box';

        let pathsHtml = '';
        f.paths.forEach((p, pIdx) => {
            pathsHtml += `
                <div class="path-row">
                    <input type="text" placeholder="np. nivea_biedronki" value="${p.code}" onchange="updatePath(${fIdx}, ${pIdx}, 'code', this.value)">
                    <input type="text" placeholder="ankiety-cząstkowe/raport-zdjeciowy/" value="${p.suffix}" onchange="updatePath(${fIdx}, ${pIdx}, 'suffix', this.value)">
                </div>
            `;
        });

        div.innerHTML = `
            <button class="btn-del-folder" onclick="removeFolder(${fIdx})"><i data-lucide="x-circle"></i></button>
            <div class="folder-header">Folder #${fIdx + 1}</div>
            ${pathsHtml}
            <button class="btn-add-path" onclick="addPath(${fIdx})">+ Dodaj ścieżkę</button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

function updatePath(fIdx, pIdx, key, val) {
    folders[fIdx].paths[pIdx][key] = val;
}

function addPath(fIdx) {
    folders[fIdx].paths.push({ code: '', suffix: '' });
    renderFolders();
}

function addFolder() {
    folders.push({ id: crypto.randomUUID(), paths: [{ code: '', suffix: '' }] });
    renderFolders();
}

function removeFolder(idx) {
    folders.splice(idx, 1);
    renderFolders();
}

async function saveProject() {
    const rawName = document.getElementById('projName').value;
    const name = cleanStr(rawName);

    if (!name) return alert("Podaj nazwę!");

    const manager = cleanStr(document.getElementById('projManager').value);
    const cc = cleanStr(document.getElementById('projCc').value);

    // Clean folders
    const cleanFolders = folders.map(f => ({
        id: f.id,
        paths: f.paths.map(p => ({
            code: cleanStr(p.code),
            suffix: cleanStr(p.suffix)
        }))
    }));

    const payload = {
        id: editId || crypto.randomUUID(),
        name: name,
        manager: manager,
        cc: cc,
        structure: cleanFolders,
        has_photos: true
    };

    await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    alert("Zapisano!");
    fetchProjects();
    switchTab('projects');
}

async function deleteProject(id) {
    if (!confirm("Usunąć?")) return;
    await fetch(`${API_URL}/projects/${id}`, { method: 'DELETE' });
    fetchProjects();
}

// PAGINATION LOGIC
function changePage(type, delta) {
    if (type === 'keep') {
        const maxPage = Math.ceil(allKeep.length / PAGE_SIZE) || 1;
        const newPage = pageKeep + delta;
        if (newPage >= 1 && newPage <= maxPage) {
            pageKeep = newPage;
            renderBucket('keep');
        }
    } else {
        const maxPage = Math.ceil(allTrash.length / PAGE_SIZE) || 1;
        const newPage = pageTrash + delta;
        if (newPage >= 1 && newPage <= maxPage) {
            pageTrash = newPage;
            renderBucket('trash');
        }
    }
}

function renderBucket(type) {
    const grid = (type === 'keep') ? document.getElementById('gridKeep') : document.getElementById('gridTrash');
    const items = (type === 'keep') ? allKeep : allTrash;
    const page = (type === 'keep') ? pageKeep : pageTrash;
    const label = (type === 'keep') ? document.getElementById('pageKeep') : document.getElementById('pageTrash');

    grid.innerHTML = '';

    // Sort oldest first? Or newest first? 
    // Usually newest first to see latest additions at the top.
    // Let's assume input array is chronological (pushed).
    // So to show newest -> slice from end? Or just reverse?
    // Let's reverse for display so first item is latest.
    const reversed = [...items].reverse();

    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const slice = reversed.slice(start, end);

    slice.forEach(item => {
        const img = document.createElement('img');
        img.className = 'img-thumb';
        img.src = item.src;
        img.title = item.file;
        img.onclick = () => openLightbox(item.src);
        grid.appendChild(img);
    });

    // Update label
    const totalPages = Math.ceil(items.length / PAGE_SIZE) || 1;
    label.innerText = `Strona ${page} / ${totalPages}`;
}

// LIGHTBOX
function openLightbox(src) {
    const modal = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    img.src = src;
    modal.classList.add('active');
}
function closeLightbox() {
    document.getElementById('lightbox').classList.remove('active');
}

// ANIMATION UTILS
function animateValue(obj, start, end, duration) {
    if (start === end) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end;
        }
    };
    window.requestAnimationFrame(step);
}

// EXECUTION
function initExecution(id) {
    const p = projects.find(x => x.id === id);
    currentProcessingProject = p;

    document.getElementById('processInfo').classList.remove('hidden');
    document.getElementById('procName').innerText = p.name;
    const dFrom = document.getElementById(`dFrom-${id}`).value;
    const dTo = document.getElementById(`dTo-${id}`).value;
    document.getElementById('procRange').innerText = `${dFrom} - ${dTo}`;

    // Update Sidebar Manually
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    // Assumption: 2nd button is Process (index 1)
    if (document.querySelectorAll('.nav-btn')[1]) {
        document.querySelectorAll('.nav-btn')[1].classList.add('active');
    }

    // Reset UI SAFE
    try {
        if (document.getElementById('statProc')) document.getElementById('statProc').innerText = '0';
        if (document.getElementById('statTot')) document.getElementById('statTot').innerText = '0';
        if (document.getElementById('statKeep')) document.getElementById('statKeep').innerText = '0';
        if (document.getElementById('statTrash')) document.getElementById('statTrash').innerText = '0';
        if (document.getElementById('progressBar')) document.getElementById('progressBar').style.width = '0%';
        if (document.getElementById('progressPercent')) document.getElementById('progressPercent').innerText = '0%';

        const stEl = document.getElementById('statusText') || document.getElementById('progressText');
        if (stEl) stEl.innerText = 'Gotowy do startu';

        if (document.getElementById('countKeep')) document.getElementById('countKeep').innerText = '0';
        if (document.getElementById('countTrash')) document.getElementById('countTrash').innerText = '0';
    } catch (e) { console.warn("UI Reset warning:", e); }

    // Reset toggle - AUTO HIDE (User Request 3)
    document.getElementById('bucketsWrapper').classList.add('hidden');
    document.getElementById('btnTogglePhotos').classList.remove('active');

    // Reset Data
    allKeep = [];
    allTrash = [];
    pageKeep = 1;
    pageTrash = 1;
    renderBucket('keep');
    renderBucket('trash');

    // INITIAL BUTTON STATE (User Request: Visible but inactive)
    const btnContainer = document.getElementById('runBtnContainer');
    btnContainer.innerHTML = `
        <div style="display:flex; gap:12px; align-items:center;">
            <!-- Download Button -->
            <button class="btn-primary disabled-look" disabled 
                    style="height:44px; display:flex; gap:10px; align-items:center; opacity:0.5; cursor:not-allowed; padding: 0 24px;">
                <i data-lucide="download"></i> Pobierz ZIP
            </button>
            
            <!-- Link Copy Group -->
            <div style="position:relative; width:400px; height:44px; visibility:hidden;">
                <input type="text" class="link-bar" placeholder="Link do zdjęć..." readonly 
                       style="width:100%; height:100%; background:#1a1a1a; border:1px solid #333; color:#aaa; padding:0 45px 0 15px; border-radius:6px; font-size:0.9rem;">
                <button class="btn-icon" disabled style="position:absolute; right:6px; top:50%; transform:translateY(-50%); color:#555;">
                    <i data-lucide="copy" style="width:18px;"></i>
                </button>
            </div>
        </div>
    `;
    lucide.createIcons();

    switchTab('process');

    // AUTO RUN (User Request 2)
    runTask(id, dFrom, dTo);
}

function togglePhotos() {
    const wrap = document.getElementById('bucketsWrapper');
    const btn = document.getElementById('btnTogglePhotos');

    wrap.classList.toggle('hidden');
    btn.classList.toggle('active');
    lucide.createIcons();
}

async function runTask(id, dFrom, dTo) {
    // DO NOT overwrite button here, keep the disabled state visible

    // Clear data again to be safe
    allKeep = [];
    allTrash = [];
    pageKeep = 1;
    pageTrash = 1;
    renderBucket('keep');
    renderBucket('trash');

    let currentTotal = 0;
    let lastZipName = null;

    startDlTimer(); // START INPUT TIMER

    try {
        const response = await fetch(`${API_URL}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: id, date_from: dFrom, date_to: dTo })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;

                const jsonStr = trimmed.replace('data: ', '');
                if (!jsonStr) continue;

                try {
                    const msg = JSON.parse(jsonStr);

                    if (msg.log) {
                        // User Request 2: "Mozemy usunac terminal" -> Removed logic logging to miniLog

                        if (msg.done) {
                            stopTimers();
                            document.getElementById('statusText').innerText = "Gotowe!";
                            document.getElementById('progressBar').style.width = '100%';

                            // FINAL ACTIVE STATE
                            const btnContainer = document.getElementById('runBtnContainer');

                            let dlHtml = '';
                            if (lastZipName) {
                                dlHtml = `
                                    <button class="btn-primary blink-effect" onclick="window.location.href='${API_URL}/download_zip?filename=${lastZipName}'" 
                                            style="height:44px; display:flex; gap:10px; align-items:center; padding: 0 24px;">
                                        <i data-lucide="download"></i> Pobierz ZIP
                                    </button>
                                `;
                            } else {
                                dlHtml = `<button class="btn-primary" disabled style="height:44px; opacity:0.5; padding: 0 24px;">Brak ZIP</button>`;
                            }

                            // Mock link for user to copy (or empty as requested, but "Copy" implies functionality)
                            // User said: "pasek z linkiem do skopiowania... ale jak narazie niech bedzie pusty"
                            // But usually you want to copy something. I'll leave it empty/placeholder.
                            // Assuming logic for link will be added later.

                            btnContainer.innerHTML = `
                                <div style="display:flex; gap:12px; align-items:center; animation: fadeIn 0.5s;">
                                    ${dlHtml}
                                    
                                    <div style="position:relative; width:400px; height:44px;">
                                        <input type="text" id="finalLinkInput" class="link-bar" placeholder="Link do zdjęć (Wymaga konfiguracji AWS S3)" readonly value="${msg.s3_link || ''}"
                                               style="width:100%; height:100%; background:#1a1a1a; border:1px solid #333; color:#eee; padding:0 45px 0 15px; border-radius:6px; font-size:0.9rem;">
                                        <button class="btn-icon hover-scale" onclick="copyLinkCurrent()" 
                                                style="position:absolute; right:6px; top:50%; transform:translateY(-50%); color:#a855f7; background:transparent; border:none; cursor:pointer;">
                                            <i data-lucide="copy" style="width:20px;"></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                            lucide.createIcons();
                        }

                        if (msg.log.startsWith("Utworzono ZIP: ")) {
                            lastZipName = msg.log.replace("Utworzono ZIP: ", "").trim();
                            showZipPopup(lastZipName);
                        }
                    }

                    if (msg.type === 'set_total') {
                        switchToAiTimer(); // SWITCH TO AI TIMER
                        animateValue(document.getElementById('statTot'), currentTotal, msg.count, 1000);
                        currentTotal = msg.count;
                    }

                    if (msg.type === 'image_result') {
                        // Update Stats
                        const pct = Math.round((msg.current / msg.total) * 100);
                        if (document.getElementById('progressBar')) document.getElementById('progressBar').style.width = `${pct}%`;
                        if (document.getElementById('progressPercent')) document.getElementById('progressPercent').innerText = `${pct}%`;

                        // Timer updates text, so we don't overwrite it here unless we want to
                        // 4. Removed the `pct < 100` check that overwrites `progressText`
                        // if (pct < 100) {
                        //     document.getElementById('progressText').innerText = `Analiza...`;
                        // }

                        if (msg.total > currentTotal) {
                            animateValue(document.getElementById('statTot'), currentTotal, msg.total, 1000);
                            currentTotal = msg.total;
                        }

                        // FIX: Direct check instead of missing function
                        const sp = document.getElementById('statProc');
                        if (sp) sp.innerText = msg.current;

                        // Handle Data
                        const isKeep = (msg.decision === 'keep');
                        const targetArr = isKeep ? allKeep : allTrash;
                        const targetCount = isKeep ? document.getElementById('statKeep') : document.getElementById('statTrash');
                        const targetHeaderCount = isKeep ? document.getElementById('countKeep') : document.getElementById('countTrash');

                        // Push
                        const encPath = encodeURIComponent(msg.path);
                        const reasonText = msg.reason ? ` [${msg.reason}]` : '';
                        const item = {
                            file: msg.file,
                            src: `${API_URL}/image?path=${encPath}`,
                            title: `${msg.file}${reasonText}`
                        };
                        targetArr.push(item);

                        // Update text counters
                        if (targetCount) targetCount.innerText = targetArr.length;
                        if (targetHeaderCount) targetHeaderCount.innerText = targetArr.length;

                        // Optimized Render
                        prependImageToGrid(isKeep ? 'keep' : 'trash', item); // 3. Replaced renderBucket with prependImageToGrid
                    }
                } catch (e) {
                    console.error("JSON/Loop Error:", e);
                }
            }
        }
    } catch (e) {
        stopTimers();
        console.error("Fetch Error:", e);
    }
}

function copyLinkCurrent() {
    const input = document.getElementById('finalLinkInput');
    // Find button: it's the next sibling in the DOM structure
    const btn = input ? input.nextElementSibling : null;

    if (!input || !input.value) {
        // Feedback for empty link
        if (btn) {
            const originalIcon = btn.innerHTML;
            btn.innerHTML = `<i data-lucide="x" style="color:#ef4444; width:20px;"></i>`; // Red X
            lucide.createIcons();
            setTimeout(() => {
                btn.innerHTML = originalIcon;
                lucide.createIcons();
            }, 2000);
        }
        return;
    }

    // Attempt Copy
    input.select();
    input.setSelectionRange(0, 99999); // Mobile compatibility

    let success = false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(input.value).then(() => showSuccess(btn, input)).catch(() => tryFallback(btn, input));
            return;
        } else {
            tryFallback(btn, input);
        }
    } catch (e) {
        tryFallback(btn, input);
    }
}

function tryFallback(btn, input) {
    try {
        document.execCommand('copy');
        showSuccess(btn, input);
    } catch (err) {
        alert("Nie udało się skopiować automatycznie. Zaznaczono tekst do skopiowania.");
    }
}

function showSuccess(btn, input) {
    if (!btn) return;
    const originalIcon = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="check" style="color:#4ade80; width:20px;"></i>`; // Green Check
    lucide.createIcons();

    // Visual highlight
    const originalBg = input.style.background;
    input.style.transition = "background 0.3s";
    input.style.background = "#064e3b"; // dark green bg

    setTimeout(() => {
        btn.innerHTML = originalIcon;
        input.style.background = originalBg;
        lucide.createIcons();
    }, 2000);
}

// TIMER UTILS
let dlInterval = null;
let aiInterval = null;
let dlStartTime = null;
let aiStartTime = null;

function formatElapsed(start) {
    if (!start) return "00:00";
    const diff = Math.floor((Date.now() - start) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, '0');
    const secs = (diff % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function startDlTimer() {
    stopTimers();
    dlStartTime = Date.now();
    document.getElementById('timerDownload').classList.remove('hidden');
    document.getElementById('timerDownload').style.color = '#3b82f6'; // Blue
    document.getElementById('timerDownload').innerText = "⬇️ DL: 00:00";

    document.getElementById('timerAI').classList.add('hidden');

    dlInterval = setInterval(() => {
        document.getElementById('timerDownload').innerText = `⬇️ DL: ${formatElapsed(dlStartTime)}`;
        document.getElementById('statusText').innerText = "Pobieranie zdjęć...";
    }, 1000);
}

function switchToAiTimer() {
    if (dlInterval) clearInterval(dlInterval);
    document.getElementById('timerDownload').style.color = '#666'; // Dim previous

    aiStartTime = Date.now();
    document.getElementById('timerAI').classList.remove('hidden');
    document.getElementById('timerAI').style.color = '#a855f7'; // Purple
    document.getElementById('timerAI').innerText = "🤖 AI: 00:00";

    aiInterval = setInterval(() => {
        document.getElementById('timerAI').innerText = `🤖 AI: ${formatElapsed(aiStartTime)}`;
        document.getElementById('statusText').innerText = "Analiza AI...";
    }, 1000);
}

function stopTimers() {
    if (dlInterval) clearInterval(dlInterval);
    if (aiInterval) clearInterval(aiInterval);
    dlInterval = null;
    aiInterval = null;
}

// In runTask, update calls:
// 1. Start: startDlTimer() (instead of startTimer)
// 2. set_total: switchToAiTimer()
// 3. done: stopTimers(), update statusText to "Gotowe!"

// Optimized helper to add image without re-rendering everything
function prependImageToGrid(type, item) {
    const grid = (type === 'keep') ? document.getElementById('gridKeep') : document.getElementById('gridTrash');
    const page = (type === 'keep') ? pageKeep : pageTrash;

    // Only prepend if we are on the first page
    if (page !== 1) return;

    const img = document.createElement('img');
    img.className = 'img-thumb';
    img.src = item.src;
    img.title = item.title || item.file; // Use title if available
    img.onclick = () => openLightbox(item.src);

    // Animation
    img.style.animation = "fadeIn 0.5s";

    grid.prepend(img);

    // Maintain page size limit visually
    if (grid.children.length > PAGE_SIZE) {
        grid.lastChild.remove();
    }
}

function showZipPopup(name) {
    const popup = document.getElementById('zipPopup');
    document.getElementById('zipPathDisplay').innerText = "Dokumenty/Sorted Photos/" + name;
    popup.classList.remove('hidden');
    let seconds = 6;
    document.getElementById('popupTimer').innerText = seconds;
    const interval = setInterval(() => {
        seconds--;
        document.getElementById('popupTimer').innerText = seconds;
        if (seconds <= 0) {
            clearInterval(interval);
            popup.classList.add('hidden');
        }
    }, 1000);
}
