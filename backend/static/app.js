const API_URL = "http://localhost:8000";

window.onerror = function (msg, url, line, col, error) {
    if (msg && msg.includes('ResizeObserver')) return;
    alert("Błąd Krytyczny JS:\n" + msg + "\nLinia: " + line);
};

// STATE
let projects = [];
let editId = null;
let currentProcessingProject = null;
let folders = []; // [{id, paths: [{code, suffix}]}]
let powerBiLinks = []; // [ { id: '...', value: 'https://...' } ]
let excelPaths = []; // [ { id: '...', value: 'C:/...' } ]

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
        alert("Błąd pobierania projektów: " + e);
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



// ...

// CREATOR LOGIC
function initCreator() {
    editId = null;
    document.getElementById('creatorTitle').innerText = 'Nowy Projekt';
    document.getElementById('projName').value = '';
    document.getElementById('projManager').value = '';
    document.getElementById('projCc').value = '';
    document.getElementById('cancelEditBtn').classList.add('hidden');

    folders = [{ id: crypto.randomUUID(), name: '', paths: [{ code: '', suffix: '' }] }];
    powerBiLinks = []; // Start empty
    excelPaths = []; // Start empty

    renderFolders();
    renderPowerBiLinks();
    renderExcelPaths();

    // Auto-generate initial template
    generateEmailTemplate();

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
        // Ensure name property exists if older project
        folders.forEach(f => { if (!f.name) f.name = ''; });
    } else {
        folders = [{ id: crypto.randomUUID(), name: '', paths: [{ code: '', suffix: '' }] }];
    }

    // Load Power BI Links
    if (p.power_bi_links && Array.isArray(p.power_bi_links)) {
        powerBiLinks = p.power_bi_links.map(link => ({ id: crypto.randomUUID(), value: link }));
    } else {
        powerBiLinks = [];
    }

    // Load Excel Paths
    if (p.excel_paths && Array.isArray(p.excel_paths)) {
        excelPaths = p.excel_paths.map(path => ({ id: crypto.randomUUID(), value: path }));
    } else {
        excelPaths = [];
    }

    renderFolders();
    renderPowerBiLinks();
    renderExcelPaths();

    // If empty, maybe generate?
    if (!p.email_template) {
        generateEmailTemplate();
    } else {
        document.getElementById('emailTemplate').value = p.email_template;
    }

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

function renderPowerBiLinks() {
    const container = document.getElementById('powerBiContainer');
    container.innerHTML = '';

    powerBiLinks.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'folder-box'; // Reuse existing box style or create new one
        div.style.marginBottom = '10px';
        div.style.padding = '10px';
        div.style.display = 'flex';
        div.style.gap = '10px';
        div.style.alignItems = 'center';

        div.innerHTML = `
            <div style="flex:1;">
                <input type="text" placeholder="https://app.powerbi.com/..." value="${item.value}" 
                       onchange="updatePowerBiLink(${idx}, this.value)" style="width:100%">
            </div>
            <button class="btn-icon" onclick="removePowerBiLink(${idx})" style="color:#ef4444;">
                <i data-lucide="trash-2"></i>
            </button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

function updatePowerBiLink(idx, val) {
    powerBiLinks[idx].value = val;
}

function addPowerBiLink() {
    powerBiLinks.push({ id: crypto.randomUUID(), value: '' });
    renderPowerBiLinks();
}

function removePowerBiLink(idx) {
    powerBiLinks.splice(idx, 1);
    renderPowerBiLinks();
}

function renderExcelPaths() {
    const container = document.getElementById('excelPathsContainer');
    container.innerHTML = '';

    excelPaths.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'folder-box';
        div.style.marginBottom = '10px';
        div.style.padding = '10px';
        div.style.display = 'flex';
        div.style.gap = '10px';
        div.style.alignItems = 'center';

        div.innerHTML = `
            <div style="flex:1;">
                <input type="text" placeholder="Ścieżka do pliku Excel..." value="${item.value}" 
                       onchange="updateExcelPath(${idx}, this.value)" style="width:100%">
            </div>
            <button class="btn-icon" onclick="removeExcelPath(${idx})" style="color:#ef4444;">
                <i data-lucide="trash-2"></i>
            </button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

function updateExcelPath(idx, val) {
    excelPaths[idx].value = val;
}

function addExcelPath() {
    excelPaths.push({ id: crypto.randomUUID(), value: '' });
    renderExcelPaths();
}

function removeExcelPath(idx) {
    excelPaths.splice(idx, 1);
    renderExcelPaths();
}

function resolveFolderName(f, idx, projName) {
    if (f.name && f.name.trim()) return f.name.trim();
    if (idx === 0) return projName;
    return `#${idx + 1} ${projName}`;
}

function generateEmailTemplate() {
    const name = document.getElementById('projName').value || '(Nazwa Projektu)';
    const hasStructure = folders.length > 0;
    const hasPbi = powerBiLinks.some(x => x.value && x.value.trim().length > 0);

    let text = `Cześć, przesyłam raport ${name}\n\n`;

    if (hasPbi) {
        if (powerBiLinks.length === 1) {
            text += `Raport Power BI: ${powerBiLinks[0].value}\n\n`;
        } else if (powerBiLinks.length > 1) {
            text += `Raporty Power BI:\n`;
            powerBiLinks.forEach(l => {
                if (l.value) text += `- ${l.value}\n`;
            });
            text += `\n`;
        }
    }

    if (hasStructure) {
        folders.forEach((f, idx) => {
            const fName = resolveFolderName(f, idx, name);
            // Append just the folder name as label, waiting for link
            text += `${fName}: \n\n`;
        });
    }

    document.getElementById('emailTemplate').value = text;
}


function updateFolder(fIdx, key, val) {
    folders[fIdx][key] = val;
}

function updatePath(fIdx, pIdx, key, val) {
    folders[fIdx].paths[pIdx][key] = val;
}

// ... addPath, addFolder, removeFolder ...

function renderFolders() {
    const container = document.getElementById('foldersContainer');
    container.innerHTML = '';
    const projName = document.getElementById('projName').value || '';

    folders.forEach((f, fIdx) => {
        const div = document.createElement('div');
        div.className = 'folder-box';

        // Default placeholder Logic:
        // Folder 1: Project Name
        // Folder 2: #2 Project Name
        let placeholder = '';
        if (fIdx === 0) placeholder = projName;
        else placeholder = `#${fIdx + 1} ${projName}`;

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
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <div class="folder-header" style="margin:0;">Folder #${fIdx + 1}</div>
                <button class="btn-del-folder" onclick="removeFolder(${fIdx})" style="position:static;"><i data-lucide="x-circle"></i></button>
            </div>
            
            <div style="background:#111; padding:8px; border-radius:6px; margin-bottom:10px;">
                <label style="display:block; font-size:0.75rem; color:#888; margin-bottom:4px;">Nazwa Folderu (Nazwa pliku ZIP)</label>
                <input type="text" placeholder="Domyślnie: ${placeholder}" value="${f.name || ''}" 
                       onchange="updateFolder(${fIdx}, 'name', this.value)" 
                       style="width:100%; background:#222; border:1px solid #333; height:32px; font-size:0.9rem;">
            </div>

            ${pathsHtml}
            <button class="btn-add-path" onclick="addPath(${fIdx})">+ Dodaj ścieżkę</button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

async function saveProject() {
    const rawName = document.getElementById('projName').value;
    const name = cleanStr(rawName);

    if (!name) return alert("Podaj nazwę!");

    const manager = cleanStr(document.getElementById('projManager').value);
    const cc = cleanStr(document.getElementById('projCc').value);

    // Clean folders
    const cleanFolders = folders.map((f, i) => {
        // Apply default logic if name is empty
        let finalName = f.name ? cleanStr(f.name) : '';
        if (!finalName) {
            if (i === 0) finalName = name;
            else finalName = `#${i + 1} ${name}`;
        }

        return {
            id: f.id,
            name: finalName,
            paths: f.paths.map(p => ({
                code: cleanStr(p.code),
                suffix: cleanStr(p.suffix)
            }))
        };
    });

    // Clean Power BI
    const cleanPowerBi = powerBiLinks.filter(x => x.value && x.value.trim().length > 0).map(x => x.value.trim());

    // Clean Excel Paths
    const cleanExcel = excelPaths.filter(x => x.value && x.value.trim().length > 0).map(x => x.value.trim());

    const emailTpl = document.getElementById('emailTemplate').value;

    const payload = {
        id: editId || crypto.randomUUID(),
        name: name,
        manager: manager,
        cc: cc,
        structure: cleanFolders,
        has_photos: true,
        power_bi_links: cleanPowerBi,
        excel_paths: cleanExcel,
        email_template: emailTpl
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

    // NEW: Reset Email Button
    const btnEmail = document.getElementById('btnEmail');
    if (btnEmail) btnEmail.disabled = true;

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
        <div style="display:flex; gap:20px; align-items:stretch; height: 100%;">
            <!-- Download Button -->
            <button class="btn-primary disabled-look" disabled 
                    style="min-height:44px; height:auto; display:flex; gap:10px; align-items:center; justify-content:center; opacity:0.5; cursor:not-allowed; padding: 0 24px;">
                <i data-lucide="download"></i> Pobierz ZIP
            </button>
            
            <!-- Link Copy Group (Placeholder) -->
            <div style="position:relative; width:380px; min-height:44px; visibility:hidden;">
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

    console.log("Starting Task...", { id, dFrom, dTo }); // DEBUG

    try {
        const response = await fetch(`${API_URL}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: id, date_from: dFrom, date_to: dTo })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let grandTotal = 0;
        let grandProcessed = 0;

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
                    console.log("MSG:", msg);

                    // 1. LOGS
                    if (msg.log) {
                        if (msg.log.startsWith("Utworzono ZIP: ")) {
                            lastZipName = msg.log.replace("Utworzono ZIP: ", "").trim();
                            showZipPopup(lastZipName);
                        }
                    }

                    // 2. DONE STATE
                    if (msg.done) {
                        stopTimers(); // FIXED: Was stopAllTimers()
                        document.getElementById('statusText').innerText = "ZAKOŃCZONO";
                        if (document.getElementById('progressBar')) document.getElementById('progressBar').style.width = '100%';
                        if (document.getElementById('progressPercent')) document.getElementById('progressPercent').innerText = '100%';
                        document.getElementById('btnEmail').disabled = false;

                        const btnContainer = document.getElementById('runBtnContainer');
                        if (btnContainer) {
                            // ZIP Button
                            const zipName = `${currentProcessingProject.name} ${currentProcessingProject.dateRange || ''}.zip`;

                            const dlHtml = `
                                <button class="btn-primary hover-scale" onclick="downloadZip('${lastZipName || zipName}')" 
                                        style="height:44px; min-width:160px; flex-shrink:0; display:flex; gap:10px; align-items:center; padding: 0 24px;">
                                    <i data-lucide="download"></i> Pobierz ZIP
                                </button>
                            `;

                            // Power BI Link (New Style)
                            let pbiHtml = '';
                            if (currentProcessingProject && currentProcessingProject.power_bi_links) {
                                currentProcessingProject.power_bi_links.forEach((pbiLink, idx) => {
                                    if (!pbiLink) return;
                                    const inputId = `pbiLinkInput_${idx}`;
                                    // PBI usually doesn't have folder names, just generic or from project?
                                    // Use "Raport Power BI" as label
                                    const label = "Raport Power BI";

                                    pbiHtml += `
                                    <div class="link-bar" style="flex: 1; min-width: 300px; display:flex; align-items:center; background:#18181b; padding:4px 8px; border-radius:6px; border:1px solid #333; margin-right: 10px;">
                                        <div style="display:flex; align-items:center; gap:6px; margin-right:8px; color:#aaa; font-size:0.8rem; white-space:nowrap;">
                                            <i data-lucide="bar-chart-2" style="width:14px; color:#facc15;"></i>
                                            <span>${label}</span>
                                        </div>
                                        <input type="text" id="${inputId}" readonly value="${pbiLink}"
                                            style="flex:1; background:transparent; border:none; color:#facc15; font-family:monospace; font-size:0.85rem; text-overflow:ellipsis;">
                                        <button onclick="copyLinkPbi('${inputId}')" title="Kopiuj"
                                            style="background:transparent; border:none; color:#a855f7; cursor:pointer; padding:2px;">
                                            <i data-lucide="copy" style="width:16px;"></i>
                                        </button>
                                    </div>
                                    `;
                                });
                            }

                            // S3 Links (New Style)
                            let photosHtml = '';
                            const finalLinks = msg.s3_links || [];
                            // Fallback if only single link provided
                            if (finalLinks.length === 0 && msg.s3_link) finalLinks.push(msg.s3_link);

                            if (finalLinks.length > 0) {
                                finalLinks.forEach((link, idx) => {
                                    const inputId = `finalLinkInput_${idx}`;

                                    // Start with generic label
                                    let label = "Raport Zdjęciowy";
                                    // Try to resolve folder name if structure matches
                                    if (currentProcessingProject.structure_raw && currentProcessingProject.structure_raw[idx]) {
                                        const f = currentProcessingProject.structure_raw[idx];
                                        if (f.name) label = f.name;
                                        else label = `Folder ${idx + 1}`;
                                    } else if (idx === 0 && currentProcessingProject.name) {
                                        label = currentProcessingProject.name;
                                    }

                                    photosHtml += `
                                    <div class="link-bar" style="flex: 1; min-width: 300px; display:flex; align-items:center; background:#18181b; padding:4px 8px; border-radius:6px; border:1px solid #333; margin-right: 10px;">
                                        <div style="display:flex; align-items:center; gap:6px; margin-right:8px; color:#aaa; font-size:0.8rem; white-space:nowrap;">
                                            <i data-lucide="image" style="width:14px; color:#3b82f6;"></i>
                                            <span>${label}</span>
                                        </div>
                                        <input type="text" id="${inputId}" readonly value="${link}"
                                            style="flex:1; background:transparent; border:none; color:#4ade80; font-family:monospace; font-size:0.85rem; text-overflow:ellipsis;">
                                        <button onclick="copyLinkCurrent('${inputId}')" title="Kopiuj"
                                            style="background:transparent; border:none; color:#a855f7; cursor:pointer; padding:2px;">
                                            <i data-lucide="copy" style="width:16px;"></i>
                                        </button>
                                    </div>
                                    `;
                                });
                            }

                            // Wrap photos and pbi in a scrolling container if needed
                            btnContainer.innerHTML = `
                            <div style="display:flex; gap:12px; align-items:center; width:100%;">
                                ${dlHtml}
                                <div class="photos-container-dynamic" style="display:flex; gap:12px; flex:1; overflow-x:auto; padding-bottom:4px;">
                                    ${photosHtml}
                                    ${pbiHtml}
                                </div>
                            </div>
                        `;
                            lucide.createIcons();
                        }
                    }

                    // 3. SET TOTAL -> AI Phase
                    if (msg.type === 'set_total') {
                        switchToAiTimer();
                        grandTotal += msg.count; // Accumulate

                        // Update Total Counter
                        animateValue(document.getElementById('statTot'), parseInt(document.getElementById('statTot').innerText || 0), grandTotal, 1000);
                        currentTotal = grandTotal;

                        // Re-calc progress (don't reset to 0 unless really 0)
                        if (grandTotal > 0) {
                            const pct = Math.round((grandProcessed / grandTotal) * 100);
                            if (document.getElementById('progressBar')) document.getElementById('progressBar').style.width = `${pct}%`;
                            if (document.getElementById('progressPercent')) document.getElementById('progressPercent').innerText = `${pct}%`;
                        }
                    }

                    // 4. UPLOAD START (Explicit Event)
                    if (msg.type === 'upload_start') {
                        switchToUploadTimer();
                    }

                    // 4b. LINK RESULT (Incremental)
                    if (msg.type === 'link_result') {
                        // Dynamically add this link to the UI immediately
                        const btnContainer = document.getElementById('runBtnContainer');

                        // Hide placeholder if exists
                        const placeholder = btnContainer.querySelector('div[style*="visibility:hidden"]');
                        if (placeholder) placeholder.style.display = 'none';

                        // Generate ID
                        const existingInputs = btnContainer.querySelectorAll('input[id^="finalLinkInput"]');
                        const nextIdx = existingInputs.length;
                        const linkId = `finalLinkInput-${nextIdx}`;

                        // Create HTML for this link bar
                        // Fixed width 380px per user request "standard width as when there are three".
                        // Label width 130px.
                        const linkHtml = `
                            <div class="link-bar" style="flex: 0 0 auto; width: 380px; display:flex; align-items:center; background:#18181b; padding:4px 8px; border-radius:6px; border:1px solid #333;">
                                <div style="width: 130px; flex-shrink:0; display:flex; align-items:center; gap:6px; margin-right:8px; color:#aaa; font-size:0.8rem; white-space:nowrap; overflow:hidden;">
                                    <i data-lucide="image" style="width:14px; flex-shrink:0;"></i>
                                    <span style="text-overflow:ellipsis; overflow:hidden;">${msg.folder || 'Zdjęcia'}</span>
                                </div>
                                <input type="text" readonly value="${msg.link}" id="${linkId}"
                                    style="flex:1; background:transparent; border:none; color:#4ade80; font-family:monospace; font-size:0.85rem; text-overflow:ellipsis;">
                                <button onclick="copyLinkCurrent('${linkId}')" title="Kopiuj"
                                    style="background:transparent; border:none; color:#a855f7; cursor:pointer; padding:2px; margin-left:4px;">
                                    <i data-lucide="copy" style="width:16px;"></i>
                                </button>
                            </div>
                        `;

                        // Check/Create Container
                        let photosContainer = btnContainer.querySelector('.photos-container-dynamic');
                        if (!photosContainer) {
                            const d = document.createElement('div');
                            d.className = 'photos-container-dynamic';
                            d.style.display = 'flex';
                            d.style.gap = '10px';
                            d.style.flex = '1';
                            d.style.overflowX = 'auto'; // Horizontal scroll
                            d.style.paddingBottom = '4px'; // Scrollbar space
                            d.style.marginRight = '20px'; // Spacing from right elements

                            btnContainer.appendChild(d);
                            photosContainer = d;
                        }

                        // Append
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = linkHtml;
                        photosContainer.appendChild(tempDiv.firstElementChild);
                        lucide.createIcons();
                    }

                    // 5. IMAGE RESULT
                    // 5. IMAGE RESULT
                    if (msg.type === 'image_result') {
                        grandProcessed++;

                        // Update Stats
                        // Protect against division by zero
                        const totalForPct = grandTotal || 1;
                        const pct = Math.round((grandProcessed / totalForPct) * 100);
                        if (document.getElementById('progressBar')) document.getElementById('progressBar').style.width = `${pct}%`;
                        if (document.getElementById('progressPercent')) document.getElementById('progressPercent').innerText = `${pct}%`;

                        // We rely on set_total to update grandTotal/statTot. 
                        // But if msg.total > currentTotal (unexpected per-folder logic), ignore it or log it.
                        // We strictly use grandProcessed for the counter.
                        const sp = document.getElementById('statProc');
                        if (sp) sp.innerText = grandProcessed;

                        // Add to arrays
                        const isKeep = (msg.decision === 'keep');
                        const targetArr = isKeep ? allKeep : allTrash;
                        const item = {
                            file: msg.file,
                            src: `${API_URL}/image?path=${encodeURIComponent(msg.path)}`,
                            title: `${msg.file}${msg.reason ? ` [${msg.reason}]` : ''}`
                        };
                        targetArr.push(item);

                        // Update Counters
                        const targetCount = isKeep ? document.getElementById('statKeep') : document.getElementById('statTrash');
                        const targetHeaderCount = isKeep ? document.getElementById('countKeep') : document.getElementById('countTrash');
                        if (targetCount) targetCount.innerText = targetArr.length;
                        if (targetHeaderCount) targetHeaderCount.innerText = targetArr.length;

                        // Render
                        prependImageToGrid(isKeep ? 'keep' : 'trash', item);
                    }

                } catch (e) {
                    console.error("JSON Loop Error:", e);
                }
            }
        }
    } catch (e) {
        stopTimers();
        console.error("Fetch Error:", e);
    }
}

function copyLinkCurrent(id) {
    const input = document.getElementById(id || 'finalLinkInput');
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

// ... copyLinkCurrent existing ...
function copyLinkPbi(id) {
    const input = document.getElementById(id || 'pbiLinkInput');
    // Find button: it's the next sibling in the DOM structure
    const btn = input ? input.nextElementSibling : null;

    if (!input || !input.value) return;

    // Attempt Copy
    input.select();
    input.setSelectionRange(0, 99999);

    let success = false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(input.value).then(() => showSuccess(btn, input)).catch(() => tryFallback(btn, input));
        } else {
            tryFallback(btn, input);
        }
    } catch (e) {
        tryFallback(btn, input);
    }
}

// ... existing tryFallback / showSuccess ...

// TIMER UTILS
let dlInterval = null;
let aiInterval = null;
let uploadInterval = null;
let dlStartTime = null;
let aiStartTime = null;
let uploadStartTime = null;

function formatElapsed(start, acc = 0) {
    if (!start) return "00:00";
    const diff = Math.floor(((Date.now() - start) + acc) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, '0');
    const secs = (diff % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function startDlTimer() {
    stopTimers();
    dlStartTime = Date.now();
    // Reset accumulators for new run
    aiTimeAcc = 0;
    uploadTimeAcc = 0;

    document.getElementById('timerDownload').classList.remove('hidden');
    document.getElementById('timerDownload').style.color = '#3b82f6'; // Blue
    document.getElementById('timerDownload').innerText = "⬇️ DL: 00:00";
    document.getElementById('timerAI').classList.add('hidden');
    document.getElementById('timerUpload').classList.add('hidden');

    dlInterval = setInterval(() => {
        // DL doesn't accumulate because it runs once at start
        document.getElementById('timerDownload').innerText = `⬇️ DL: ${formatElapsed(dlStartTime)}`;
        document.getElementById('statusText').innerText = "Pobieranie zdjęć...";
    }, 1000);
}

let aiTimeAcc = 0;
let uploadTimeAcc = 0;

function switchToAiTimer() {
    if (dlInterval) clearInterval(dlInterval);

    // Pause Upload Timer if running
    if (uploadInterval) {
        clearInterval(uploadInterval);
        if (uploadStartTime) uploadTimeAcc += (Date.now() - uploadStartTime);
    }

    document.getElementById('timerDownload').style.color = '#555';
    document.getElementById('timerUpload').style.color = '#555';

    aiStartTime = Date.now();
    document.getElementById('timerAI').classList.remove('hidden');
    document.getElementById('timerAI').style.color = '#a855f7';

    // Update immediately
    document.getElementById('timerAI').innerText = `🤖 AI: ${formatElapsed(aiStartTime, aiTimeAcc)}`;

    aiInterval = setInterval(() => {
        document.getElementById('timerAI').innerText = `🤖 AI: ${formatElapsed(aiStartTime, aiTimeAcc)}`;
    }, 1000);
}

function switchToUploadTimer() {
    // Pause AI Timer if running
    if (aiInterval) {
        clearInterval(aiInterval);
        if (aiStartTime) aiTimeAcc += (Date.now() - aiStartTime);
    }

    if (dlInterval) clearInterval(dlInterval);

    document.getElementById('timerAI').style.color = '#555';
    document.getElementById('timerDownload').style.color = '#555';

    uploadStartTime = Date.now();
    document.getElementById('timerUpload').classList.remove('hidden');
    document.getElementById('timerUpload').style.color = '#facc15';

    document.getElementById('timerUpload').innerText = `☁️ UP: ${formatElapsed(uploadStartTime, uploadTimeAcc)}`;

    uploadInterval = setInterval(() => {
        document.getElementById('timerUpload').innerText = `☁️ UP: ${formatElapsed(uploadStartTime, uploadTimeAcc)}`;
    }, 1000);
}

function stopTimers() {
    // Final accumulation for display freezing?
    if (aiInterval && aiStartTime) aiTimeAcc += (Date.now() - aiStartTime);
    if (uploadInterval && uploadStartTime) uploadTimeAcc += (Date.now() - uploadStartTime);

    if (dlInterval) clearInterval(dlInterval);
    if (aiInterval) clearInterval(aiInterval);
    if (uploadInterval) clearInterval(uploadInterval);
    dlInterval = null;
    aiInterval = null;
    uploadInterval = null;

    document.getElementById('timerDownload').style.color = '#555';
    document.getElementById('timerAI').style.color = '#555';
    document.getElementById('timerUpload').style.color = '#555';

    // Optional: Final update of text to show total time?
    // document.getElementById('timerAI').innerText = `🤖 AI: ${formatElapsed(null, aiTimeAcc)}`;
}

function openMailClient() {
    if (!currentProcessingProject) return;

    const p = currentProcessingProject;
    const to = p.manager || '';
    const cc = p.cc || '';
    const dFrom = document.getElementById(`dFrom-${p.id}`)?.value || '';
    const dTo = document.getElementById(`dTo-${p.id}`)?.value || '';
    const subject = `${p.name} ${dFrom} - ${dTo}`;

    let body = p.email_template || '';

    // Collect all generated S3 links
    const s3Links = [];
    const container = document.getElementById('runBtnContainer');
    if (container) {
        const inputs = container.querySelectorAll('input[id^="finalLinkInput"]');
        inputs.forEach(inp => {
            if (inp.value) s3Links.push(inp.value);
        });
    }

    if (s3Links.length > 0) {
        s3Links.forEach((link, idx) => {
            // Determine the label for this link based on folder structure
            let label = "Raport Zdjęciowy";
            if (p.structure_raw && p.structure_raw[idx]) {
                label = resolveFolderName(p.structure_raw[idx], idx, p.name);
            } else if (idx === 0) {
                label = p.name;
            }

            // Escape regex chars
            const escLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Regex 1: Exact label match "FolderName :"
            const labelRegex = new RegExp(`${escLabel}\\s*:(?!\\s*http)`);

            // Regex 2: Legacy "Link do zdjęć :" match (only for first item or if explicitly present)
            const legacyRegex = /Link do zdjęć\s*:(?!\s*http)/;

            if (labelRegex.test(body)) {
                body = body.replace(labelRegex, `${label}: ${link}`);
            } else if (legacyRegex.test(body) && idx === 0) {
                // Fallback: overwrite legacy placeholder for the first link
                body = body.replace(legacyRegex, `${label}: ${link}`);
            } else {
                // If no placeholder found, append cleanly
                body += `\n\n${label}: ${link}`;
            }
        });
    }

    // Cleanup: Remove any remaining empty "Link do zdjęć:" lines that weren't replaced
    body = body.replace(/Link do zdjęć\s*:\s*(?=\n|$)/g, '');
    // Cleanup: Remove any matched Folder Name lines that are still empty? 
    // No, maybe the user wants to see them empty if no link was generated.
    // But we should clean up multiple newlines.
    body = body.replace(/\n{3,}/g, '\n\n');

    const fullLink = `mailto:${to}?cc=${cc}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = fullLink;
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

    // Fix Pagination Label update
    const items = (type === 'keep') ? allKeep : allTrash;
    const totalPages = Math.ceil(items.length / PAGE_SIZE) || 1;
    const label = (type === 'keep') ? document.getElementById('pageKeep') : document.getElementById('pageTrash');
    if (label) label.innerText = `Strona ${page} / ${totalPages}`;
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
