/*======================================================================
  1️⃣ GLOBAL STATE
======================================================================*/
let currentPage = 'home';
let darkMode = false;
let ctxTarget = null;
let selectedFolderId = null;
let folderNavStack = [];
let pageHistory = [];
let editorStep = 1;
let inputRows = [];
let currentFolderId = null;

// Review state
let reviewFileId = null;
let reviewFileItem = null;
let reviewVocabulary = [];
let reviewStats = { total: 0, correct: 0, wrong: 0, startTime: null, endTime: null, wrongWords: [] };
let currentQuestionIndex = 0;
let reviewMode = null;

/*======================================================================
  1b️⃣ PERSISTENCE – localStorage
======================================================================*/
const DB_KEY_TREE = 'hanyu_tree';
const DB_KEY_SETTINGS = 'hanyu_settings';
const DB_KEY_STATS = 'hanyu_review_stats';

const DEFAULT_TREE = [
    {
        id: 1, type: 'folder', name: 'HSK 1', open: true, children: [
            { id: 2, type: 'file', name: 'Bài 1 - Chào hỏi', createdAt: Date.now() },
            { id: 3, type: 'file', name: 'Bài 2 - Gia đình', createdAt: Date.now() }
        ]
    },
    {
        id: 4, type: 'folder', name: 'HSK 2', open: false, children: [
            { id: 5, type: 'file', name: 'Bài 1 - Thời gian', createdAt: Date.now() }
        ]
    },
    { id: 6, type: 'folder', name: 'Từ vựng thêm', open: false, children: [] }
];

function dbLoad(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
}
function dbSave(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Storage full', e); }
}
function saveTree() { dbSave(DB_KEY_TREE, tree); }

/* Settings helpers --------------------------------------------------- */
function loadSettings() {
    const s = dbLoad(DB_KEY_SETTINGS, {});

    darkMode = !!s.darkMode;
    document.body.setAttribute('data-theme', darkMode ? 'dark' : '');
    const dt = document.getElementById('darkToggle');
    if (dt) darkMode ? dt.classList.add('on') : dt.classList.remove('on');

    _applyToggle('audioToggle', s.audioOn !== undefined ? s.audioOn : false);
    _applyToggle('pinyinToggle', s.pinyinOn !== undefined ? s.pinyinOn : true);
    _applyToggle('notifToggle', s.notifOn !== undefined ? s.notifOn : true);

    const name = s.username || 'Diệu';
    _applyUsername(name);

    const keyEl = document.getElementById('geminiApiKey');
    if (keyEl) keyEl.value = s.geminiApiKey || '';
}
function _applyToggle(id, on) {
    const el = document.getElementById(id);
    if (!el) return;
    on ? el.classList.add('on') : el.classList.remove('on');
}
function _applyUsername(name) {
    const greet = document.querySelector('.greeting');
    if (greet) greet.textContent = 'Xin chào ' + name;
    const nameEl = document.getElementById('settingsUsername');
    if (nameEl) nameEl.textContent = name;
}
function saveSettings() {
    const s = dbLoad(DB_KEY_SETTINGS, {});
    s.darkMode = darkMode;
    s.audioOn = document.getElementById('audioToggle')?.classList.contains('on') || false;
    s.pinyinOn = document.getElementById('pinyinToggle')?.classList.contains('on') ?? true;
    s.notifOn = document.getElementById('notifToggle')?.classList.contains('on') ?? true;
    s.geminiApiKey = document.getElementById('geminiApiKey')?.value || '';
    dbSave(DB_KEY_SETTINGS, s);
}
function saveUsername(name) {
    if (!name || !name.trim()) return;
    const s = dbLoad(DB_KEY_SETTINGS, {});
    s.username = name.trim();
    dbSave(DB_KEY_SETTINGS, s);
    _applyUsername(s.username);
    showToast('✅ Đã lưu tên: ' + s.username);
}

/* Review stats ------------------------------------------------------ */
function saveReviewStat(fileId, stats) {
    const all = dbLoad(DB_KEY_STATS, {});
    const key = String(fileId);
    if (!all[key]) all[key] = { sessions: 0, totalCorrect: 0, totalWrong: 0, bestPercent: 0, lastPlayed: null };
    const e = all[key];
    e.sessions++;
    e.totalCorrect += stats.correct;
    e.totalWrong += stats.wrong;
    const pct = stats.total ? Math.round(stats.correct / stats.total * 100) : 0;
    if (pct > e.bestPercent) e.bestPercent = pct;
    e.lastPlayed = Date.now();
    dbSave(DB_KEY_STATS, all);
}
function getReviewStat(fileId) {
    const all = dbLoad(DB_KEY_STATS, {});
    return all[String(fileId)] || null;
}

/* Load tree -------------------------------------------------------- */
let tree = dbLoad(DB_KEY_TREE, DEFAULT_TREE);

/*======================================================================
  2️⃣ UTILS
======================================================================*/
function escHtml(s) {
    return (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatDate(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/*======================================================================
  3️⃣ PAGE NAVIGATION & HISTORY
======================================================================*/
function showPage(id, isBack = false) {
    // Luôn đảm bảo đóng các lớp phủ và sidebar khi chuyển trang
    closeSidebar();
    closeBottomSheet();
    closeAllCtx();

    if (!isBack && currentPage && currentPage !== id) pageHistory.push(currentPage);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
    currentPage = id;

    if (id === 'learning') {
        // Reset trạng thái thư mục khi vào trang học
        currentFolderId = null;
        selectedFolderId = null;
        folderNavStack = [];
        renderTree();
        renderWorkspace();
        const bc = document.getElementById('wsBreadcrumb');
        if (bc) bc.textContent = 'Tất cả tài liệu';
    }
    if (id === 'review') { renderReviewFileList(); }

    const fab = document.getElementById('fabBtn');
    if (fab) {
        if (id === 'learning') {
            fab.classList.add('fab-visible');
            updateFabLabel();
        } else {
            fab.classList.remove('fab-visible');
        }
    }

    if (id !== 'review') {
        const bar = document.getElementById('rvMobileBar');
        if (bar) bar.classList.remove('visible');
    }
}
function goBack() {
    if (pageHistory.length === 0) { showPage('home', true); return; }
    const prev = pageHistory.pop();
    showPage(prev, true);
}
function goFolderBack() {
    if (folderNavStack.length === 0) {
        // Đã ở gốc (root) của trang học → về trang chủ
        currentFolderId = null;
        selectedFolderId = null;
        showPage('home', true);
        return;
    }
    const prevId = folderNavStack.pop();
    if (prevId === null) {
        // Trở về trang tổng thư mục (root) trong trang học
        currentFolderId = null;
        selectedFolderId = null;
        const bc = document.getElementById('wsBreadcrumb');
        if (bc) bc.textContent = 'Tất cả tài liệu';
        renderWorkspace();
        updateFabLabel();
    } else {
        const prevFolder = findItem(tree, prevId);
        if (prevFolder) {
            currentFolderId = prevId;
            selectedFolderId = prevId;
            document.getElementById('wsBreadcrumb').textContent = prevFolder.name;
            renderWorkspace(prevFolder);
        } else {
            currentFolderId = null;
            selectedFolderId = null;
            document.getElementById('wsBreadcrumb').textContent = 'Tất cả tài liệu';
            renderWorkspace();
        }
        updateFabLabel();
    }
}

/*======================================================================
  4️⃣ THEME & TOAST
======================================================================*/
function toggleTheme() {
    darkMode = !darkMode;
    document.body.setAttribute('data-theme', darkMode ? 'dark' : '');
    const dt = document.getElementById('darkToggle');
    if (dt) darkMode ? dt.classList.add('on') : dt.classList.remove('on');
    saveSettings();
    showToast(darkMode ? '🌙 Chế độ tối' : '☀️ Chế độ sáng');
}
function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerHTML = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
}

/*======================================================================
  5️⃣ SIDEBAR (MOBILE)
======================================================================*/
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('visible');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
}

/*======================================================================
  6️⃣ TREE RENDERING
======================================================================*/
function renderTree() {
    const container = document.getElementById('sidebarTree');
    container.innerHTML = renderTreeItems(tree);
}
function renderTreeItems(items, depth = 0) {
    return items.map(item => {
        if (item.type === 'folder') {
            const selected = item.id === selectedFolderId ? ' folder-selected' : '';
            return `<div>
<div class="tree-item${item.open ? ' open' : ''}${selected}"
  onclick="if(!longPressFired){toggleFolder(${item.id})}"
  oncontextmenu="onTreeCtx(event,'folder',${item.id})"
  ontouchstart="onItemTouchStart(event,'folder',${item.id})"
  ontouchend="onItemTouchEnd(event)"
  ontouchmove="onItemTouchMove()">
  <span class="fi">${item.open ? '<i class="ph-fill ph-folder-open" style="color:var(--gold)"></i>' : '<i class="ph-fill ph-folder" style="color:var(--gold)"></i>'}</span>
  <span style="flex:1">${item.name}</span>
  <span class="tree-arrow"><i class="ph-bold ph-caret-right"></i></span>
</div>
<div class="tree-children" style="display:${item.open ? 'block' : 'none'}">
  ${renderTreeItems(item.children, depth + 1)}
</div>
</div>`;
        } else {
            return `<div class="tree-item"
  onclick="if(!longPressFired){openFile(${item.id})}"
  oncontextmenu="onTreeCtx(event,'file',${item.id})"
  ontouchstart="onItemTouchStart(event,'file',${item.id})"
  ontouchend="onItemTouchEnd(event)"
  ontouchmove="onItemTouchMove()">
  <span class="fi"><i class="ph-fill ph-file-text" style="color:var(--accent1)"></i></span>
  <span style="flex:1">${item.name}</span>
</div>`;
        }
    }).join('');
}
function toggleFolder(id) {
    const item = findItem(tree, id);
    if (item) item.open = !item.open;

    folderNavStack.push(currentFolderId);
    currentFolderId = id;
    selectedFolderId = id;

    renderTree();

    const folder = findItem(tree, id);
    if (folder) {
        document.getElementById('wsBreadcrumb').innerHTML = folder.name;
        renderWorkspace(folder);
        updateFabLabel();
    }
}
function findItem(items, id) {
    for (const i of items) {
        if (i.id === id) return i;
        if (i.children) {
            const f = findItem(i.children, id);
            if (f) return f;
        }
    }
    return null;
}

/*======================================================================
  7️⃣ WORKSPACE (TRONG PAGE LEARNING)
======================================================================*/
function renderWorkspace(folder = null) {
    const ws = document.getElementById('workspaceContent');
    const items = folder ? folder.children : tree;

    if (!items || items.length === 0) {
        ws.innerHTML = `<div style="text-align:center;padding:60px 24px;color:var(--text2);">
  <div style="font-size:56px;margin-bottom:16px;filter:drop-shadow(0 4px 8px rgba(232,84,122,.2))"><i class="ph-fill ph-folder-open"></i></div>
  <div style="font-size:17px;font-weight:800;color:var(--text);margin-bottom:8px;">Thư mục trống</div>
  <div style="font-size:13px;line-height:1.7;max-width:240px;margin:0 auto;">
    Nhấn nút <strong style="color:var(--accent1)"><i class="ph-bold ph-plus"></i> Thêm mới</strong> ở góc phải dưới<br>
    để tạo file hoặc folder tại đây
  </div>
</div>`;
        return;
    }

    ws.innerHTML = `<div class="ws-grid">${items.map(i => {
        const hasSavedData = i.type === 'file' && i.vocabData && i.vocabData.length > 0;
        const wordCount = hasSavedData ? i.vocabData.length : 0;
        const selectedClass = (i.type === 'folder' && i.id === selectedFolderId) ? ' folder-selected' : '';
        const clickAction = i.type === 'folder' ? `toggleFolder(${i.id})` : `openFile(${i.id})`;
        return `<div class="ws-card${selectedClass}"
  onclick="if(!longPressFired){${clickAction}}"
  oncontextmenu="onTreeCtx(event,'${i.type}',${i.id})"
  ontouchstart="onItemTouchStart(event,'${i.type}',${i.id})"
  ontouchend="onItemTouchEnd(event)"
  ontouchmove="onItemTouchMove()">
  <div class="ws-card-icon">${i.type === 'folder' ? '<i class="ph-fill ph-folder" style="color:var(--gold)"></i>' : (hasSavedData ? '<i class="ph-fill ph-notebook" style="color:var(--accent1)"></i>' : '<i class="ph-fill ph-file-text" style="color:var(--accent1)"></i>')}</div>
  <div class="ws-card-name">${i.name}</div>
  ${hasSavedData ? `<div class="ws-card-badge">${wordCount} từ</div>` : ''}</div>`;
    }).join('')}</div>`;
}
let currentFileId = null;
let editorRows = [];

/* Khi mở file → reset các biến folder để nút back trong sidebar quay về root */
function openFile(id) {
    selectedFolderId = null;
    currentFolderId = null;
    showPage('file-editor');
    currentFileId = id;
    const item = findItem(tree, id);
    document.getElementById('editorTitle').innerHTML = '<i class="ph-fill ph-file-text" style="color:var(--accent1);margin-right:8px"></i>' + (item ? item.name : 'File');

    if (item && item.vocabData && item.vocabData.length > 0) {
        editorStep = 2;
        updateStepIndicator();
        renderVocabTable(item.vocabData);
    } else {
        showEditorStep1();
    }
}

/*======================================================================
  8️⃣ EDITOR – STEP 1 (NHẬP TỪ)
======================================================================*/
function showEditorStep1(keepRows = false) {
    editorStep = 1;
    updateStepIndicator();
    if (!keepRows) editorRows = [
        { uid: 'u1', val: '' },
        { uid: 'u2', val: '' },
        { uid: 'u3', val: '' }
    ];
    renderStep1();
}
function renderStep1() {
    const body = document.getElementById('editorBody');
    body.innerHTML = `
<div style="max-width:560px;">
  <p style="color:var(--text2);font-size:13px;margin-bottom:16px;">
    Nhập hoặc <strong>chỉnh sửa</strong> từ Hán tự. Nhấn <kbd style="background:var(--border);padding:1px 6px;border-radius:4px;font-size:11px;">Enter</kbd> để thêm dòng mới.
  </p>
  <table class="input-table">
    <thead><tr>
      <th style="width:48px;text-align:center;">STT</th>
      <th>Tiếng Trung</th>
      <th style="width:40px;"></th>
    </tr></thead>
    <tbody id="inputBody">${renderInputRows()}</tbody>
  </table>
  <button class="add-row-btn" onclick="addInputRow(true)">＋ Thêm dòng</button>
  <br>
  <button class="confirm-btn" onclick="confirmStep1()">✔ Xác nhận &amp; tạo bảng</button>
</div>`;
    const inputs = document.querySelectorAll('#inputBody input');
    const firstEmpty = [...inputs].find(i => !i.value);
    if (firstEmpty) setTimeout(() => firstEmpty.focus(), 50);
}
function renderInputRows() {
    return editorRows.map((r, idx) => `
<tr id="erow-${r.uid}">
  <td class="stt-cell">${idx + 1}</td>
  <td><input type="text" placeholder="Nhập từ Hán tự..."
    value="${escHtml(r.val)}"
    oninput="updateRowVal('${r.uid}',this.value)"
    onkeydown="handleRowKey(event,'${r.uid}')"
    style="font-family:'Noto Sans SC',sans-serif;font-size:18px;"></td>
  <td style="text-align:center;">
    <button onclick="deleteInputRow('${r.uid}')" title="Xóa dòng"
      style="background:none;border:none;cursor:pointer;color:#ccc;font-size:15px;padding:4px 7px;border-radius:6px;line-height:1;transition:all .15s;"
      onmouseover="this.style.color='#e74c3c';this.style.background='rgba(231,76,60,.1)'"
      onmouseout="this.style.color='#ccc';this.style.background='none'">✕</button>
  </td>
</tr>`).join('');
}
function updateRowVal(uid, val) {
    const r = editorRows.find(x => x.uid === uid);
    if (r) r.val = val;
}
function handleRowKey(e, uid) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addInputRow(true, uid);
    }
    if (e.key === 'Backspace') {
        const r = editorRows.find(x => x.uid === uid);
        if (r && r.val === '' && editorRows.length > 1) {
            e.preventDefault();
            deleteInputRow(uid, true);
        }
    }
}
function addInputRow(focusNew = false, afterUid = null) {
    const newRow = { uid: 'u' + Date.now(), val: '' };
    if (afterUid) {
        const idx = editorRows.findIndex(x => x.uid === afterUid);
        editorRows.splice(idx + 1, 0, newRow);
    } else {
        editorRows.push(newRow);
    }
    document.getElementById('inputBody').innerHTML = renderInputRows();
    if (focusNew) {
        const input = document.querySelector(`#erow-${newRow.uid} input`);
        if (input) input.focus();
    }
}
function deleteInputRow(uid, focusPrev = false) {
    if (editorRows.length <= 1) {
        showToast('⚠️ Cần ít nhất một dòng!');
        return;
    }
    const idx = editorRows.findIndex(x => x.uid === uid);
    editorRows.splice(idx, 1);
    document.getElementById('inputBody').innerHTML = renderInputRows();
    if (focusPrev) {
        const inputs = document.querySelectorAll('#inputBody input');
        const target = inputs[Math.max(0, idx - 1)];
        if (target) target.focus();
    }
}
function confirmStep1() {
    const filled = editorRows.filter(r => r.val.trim());
    if (!filled.length) {
        showToast('⚠️ Vui lòng nhập ít nhất một từ!');
        return;
    }
    editorStep = 2;
    updateStepIndicator();
    showStep2(filled);
}

/*======================================================================
  9️⃣ STEP 2 – TẠO BẢNG TỪ VỰNG (KHÔNG TỰ ĐỘNG DỊCH)
======================================================================*/
function showStep2(words) {
    const fileItem = currentFileId ? findItem(tree, currentFileId) : null;
    const existing = fileItem?.vocabData ? [...fileItem.vocabData] : [];

    // Tạo dòng từ dữ liệu nhập vào, giữ lại dữ liệu cũ nếu có
    const result = words.map((w, i) => {
        const existingRow = w.vocabUid ? existing.find(r => r.uid === w.vocabUid) : null;
        if (existingRow && existingRow.from === w.val) {
            return { ...existingRow };
        }
        return {
            uid: existingRow?.uid || ('v' + Date.now() + i),
            from: w.val,
            hanzi: w.val,
            pinyin: '',
            meaning: '',
            exHan: '',
            exPin: '',
            exVi: ''
        };
    });

    const allRows = result.map((r, i) => ({ ...r, id: i + 1 }));
    saveVocabToFile(allRows);
    renderVocabTable(allRows);

    // Tự động dịch luôn sau khi xác nhận bước 1
    const hasEmptyFields = allRows.some(r => !r.pinyin || !r.meaning);
    if (hasEmptyFields) {
        translateAllWithGemini();
    }
}

function saveVocabToFile(rows) {
    if (!currentFileId) return;
    const item = findItem(tree, currentFileId);
    if (item) {
        item.vocabData = rows;
        saveTree();
        renderTree();
    }
}

/*======================================================================
  10️⃣ BẢNG TỪ VỰNG – CHỈNH SỬA TRỰC TIẾP
======================================================================*/
const VOCAB_FIELDS = [
    { key: 'from', label: 'Từ mới', cls: 'hanzi', font: 'Noto Serif SC' },
    { key: 'pinyin', label: 'Phiên âm', cls: 'pinyin', font: 'Nunito' },
    { key: 'hanzi', label: 'Hán Việt', cls: 'hanzi', font: 'Noto Serif SC', fontSize: '16px' },
    { key: 'meaning', label: 'Dịch', cls: 'meaning', font: 'Nunito' },
    { key: 'exHan', label: 'Ví dụ (汉字)', cls: 'example-han', font: 'Noto Serif SC' },
    { key: 'exPin', label: 'Ví dụ (Pinyin)', cls: 'example-pin', font: 'Nunito' },
    { key: 'exVi', label: 'Ví dụ (Dịch)', cls: 'example-vi', font: 'Nunito' }
];

function renderVocabTable(rows) {
    const body = document.getElementById('editorBody');
    body.innerHTML = `
<div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
  <div style="background:var(--border);border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;color:var(--text2);display:flex;align-items:center;gap:4px;">
    <i class="ph-fill ph-notebook"></i> ${rows.length} từ vựng
  </div>
  <div style="font-size:12px;color:var(--text2);display:flex;align-items:center;gap:5px;">
    <i class="ph-fill ph-pencil-simple"></i> <span>Nhấp vào ô bất kỳ để chỉnh sửa trực tiếp</span>
  </div>
  <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
    <button class="confirm-btn" style="padding:8px 16px;font-size:12px;" onclick="goBackStep1FromTable()"><i class="ph-fill ph-pencil-simple"></i> Sửa từ</button>
    <button class="confirm-btn" style="padding:8px 16px;font-size:12px;background:linear-gradient(135deg,#27ae60,#1e8449);" onclick="addNewWordFromTable()"><i class="ph-bold ph-plus"></i> Thêm từ</button>
    <button class="confirm-btn" style="padding:8px 16px;font-size:12px;background:linear-gradient(135deg,#6366f1,#4f46e5);" onclick="exportExcelFromVocab()"><i class="ph-fill ph-chart-bar"></i> Xuất Excel</button>
  </div>
</div>
<div class="vocab-table-wrap">
  <table class="vocab-table" id="vocabEditTable">
    <thead><tr>
      <th>STT</th>
      ${VOCAB_FIELDS.map(f => `<th>${f.label}</th>`).join('')}
      <th style="width:40px;"></th>
    </tr></thead>
    <tbody id="vocabBody">
      ${renderVocabRows(rows)}
    </tbody>
  </table>
</div>`;
}

function renderVocabRows(rows) {
    return rows.map(r => `
<tr id="vrow-${r.uid || r.id}">
  <td style="text-align:center;font-weight:700;color:var(--text2);font-size:13px;">${r.id}</td>
  ${VOCAB_FIELDS.map(f => `
    <td>
      <div class="${f.cls}" 
        contenteditable="true"
        spellcheck="false"
        data-field="${f.key}" data-uid="${r.uid || r.id}"
        oninput="onVocabCellEdit(this,'${r.uid || r.id}','${f.key}')"
        onblur="onVocabCellBlur(this,'${r.uid || r.id}')"
        onkeydown="if(event.key==='Escape')this.blur()"
        style="outline:none;cursor:text;border-radius:4px;padding:2px 4px;min-width:40px;
               transition:background .15s,box-shadow .15s;font-family:'${f.font}',sans-serif;
               ${f.fontSize ? 'font-size:' + f.fontSize + ';' : ''}"
        onmouseover="this.style.background='rgba(232,84,122,.07)'"
        onmouseout="if(document.activeElement!==this)this.style.background=''"
        onfocus="this.style.background='rgba(232,84,122,.10)';this.style.boxShadow='0 0 0 2px rgba(232,84,122,.3)';selectAllContent(this)">${escHtml(r[f.key] || '')}</div>
    </td>`).join('')}
  <td style="text-align:center;">
    <button onclick="deleteVocabRow('${r.uid || r.id}')" title="Xóa từ"
      style="background:none;border:none;cursor:pointer;color:#ccc;font-size:16px;padding:3px 7px;border-radius:6px;transition:all .15s;"
      onmouseover="this.style.color='#e74c3c';this.style.background='rgba(231,76,60,.1)'"
      onmouseout="this.style.color='#ccc';this.style.background='none'"><i class="ph-bold ph-x"></i></button>
  </td>
</tr>`).join('');
}

function selectAllContent(el) {
    setTimeout(() => {
        const range = document.createRange(); range.selectNodeContents(el);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }, 0);
}
function onVocabCellEdit(el, uid, field) {
    const item = currentFileId ? findItem(tree, currentFileId) : null;
    if (!item?.vocabData) return;
    const row = item.vocabData.find(r => (r.uid || r.id) == uid);
    if (row) row[field] = el.innerText.trim();
}
function onVocabCellBlur(el, uid) {
    el.style.background = '';
    el.style.boxShadow = '';
    const item = currentFileId ? findItem(tree, currentFileId) : null;
    if (item?.vocabData) { saveTree(); renderTree(); }
    showAutoSavedIndicator();
}

/* Gemini Translation ------------------------------------------------ */
async function translateAllWithGemini() {
    // Ensure key is saved and trimmed
    saveSettings(); 
    const s = dbLoad(DB_KEY_SETTINGS, {});
    const key = (s.geminiApiKey || '').trim();

    if (!key) {
        showToast('⚠️ Vui lòng nhập Gemini API Key trong phần Cài đặt!');
        showPage('settings');
        return;
    }

    const item = currentFileId ? findItem(tree, currentFileId) : null;
    if (!item || !item.vocabData || !item.vocabData.length) return;

    const btn = document.getElementById('btnAutoTranslate');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ph-fill ph-hourglass-high ph-spin"></i> Đang dịch...';
    } else {
        showToast('<i class="ph-fill ph-hourglass-high ph-spin"></i> Đang tự động dịch bằng Gemini...');
    }

    try {
        const words = item.vocabData.map(r => r.from);
        // Prompt cực ngắn để giảm token đầu vào và tăng tốc phản hồi
        const prompt = `Return JSON array only, no extra text. For each word: {"from":"","pinyin":"","hanzi":"Hán Việt","meaning":"nghĩa VN","exHan":"ví dụ HZ","exPin":"pinyin ví dụ","exVi":"dịch VN"}. Words: ${words.join(',')}`;

        // Lấy model đã làm việc trước đó từ settings để tăng tốc
        const settings = dbLoad(DB_KEY_SETTINGS, {});
        const cachedModel = settings.workingModel;
        const cachedVer = settings.workingVer;

        // Thử gemini-2.5-flash trước tiên theo yêu cầu
        const models = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-pro'];
        const versions = ['v1', 'v1beta'];
        
        let successResult = null;
        let lastError = '';
        let isQuotaIssue = false;

        const listToTry = [];
        if (cachedModel && cachedVer) {
            listToTry.push({ model: cachedModel, ver: cachedVer });
        }
        models.forEach(m => {
            versions.forEach(v => {
                if (!(m === cachedModel && v === cachedVer)) {
                    listToTry.push({ model: m, ver: v });
                }
            });
        });

        for (const step of listToTry) {
            if (successResult) break;
            const { model, ver } = step;
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.0,
                            maxOutputTokens: Math.max(512, words.length * 120),
                            candidateCount: 1
                        }
                    })
                });

                if (!response.ok) {
                    const errBody = await response.text();
                    const errJson = JSON.parse(errBody);
                    if (response.status === 429) {
                        isQuotaIssue = true;
                        lastError = `Hạn mức 429: ${errJson.error?.message}`;
                    } else {
                        lastError = errJson.error?.message || 'Error';
                    }
                    continue; 
                }

                const data = await response.json();
                if (data.candidates && data.candidates[0].content.parts[0].text) {
                    successResult = data.candidates[0].content.parts[0].text;
                    // Lưu lại model chạy thành công để lần sau không cần dò nữa
                    settings.workingModel = model;
                    settings.workingVer = ver;
                    dbSave(DB_KEY_SETTINGS, settings);
                    console.log(`🚀 Dùng model: ${model} (${ver})`);
                    break; 
                }
            } catch (err) {
                lastError = err.message;
            }
        }

        if (!successResult) {
            if (isQuotaIssue) throw new Error(`⚠️ Lỗi Hạn Mức: ${lastError}`);
            throw new Error(`Dịch thất bại. Hãy kiểm tra Key hoặc thử lại sau. Lỗi: ${lastError}`);
        }
        
        let contentText = successResult;
        
        // Remove markdown wrappers if any
        contentText = contentText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const results = JSON.parse(contentText);

        if (Array.isArray(results)) {
            item.vocabData.forEach(row => {
                const res = results.find(r => r.from === row.from);
                if (res) {
                    row.pinyin = res.pinyin || row.pinyin;
                    row.hanzi = res.hanzi || row.hanzi;
                    row.meaning = res.meaning || row.meaning;
                    row.exHan = res.exHan || row.exHan;
                    row.exPin = res.exPin || row.exPin;
                    row.exVi = res.exVi || row.exVi;
                }
            });
            saveTree();
            renderVocabTable(item.vocabData);
            showToast('<i class="ph-fill ph-sparkle"></i> Đã dịch tự động hoàn tất!');
        } else {
            throw new Error('Dữ liệu trả về không đúng định dạng mảng.');
        }
    } catch (e) {
        console.error(e);
        showToast('❌ ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

async function testGeminiConnection() {
    const key = (document.getElementById('geminiApiKey')?.value || '').trim();
    const resDiv = document.getElementById('geminiTestResult');
    if (!key) {
        showToast('⚠️ Vui lòng nhập Key trước!');
        return;
    }

    resDiv.style.display = 'block';
    resDiv.innerHTML = '<i class="ph-fill ph-hourglass-high ph-spin"></i> Đang kiểm tra...';
    resDiv.style.color = 'var(--text)';

    try {
        // Thử lấy danh sách model mà Key này được phép dùng
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Lỗi không xác định');
        }

        const models = data.models || [];
        const names = models.map(m => m.name.split('/').pop());
        
        if (names.length === 0) {
            resDiv.innerHTML = '<i class="ph-fill ph-x-circle"></i> Kết nối được nhưng Key này không có model nào khả dụng.';
            resDiv.style.color = '#e74c3c';
        } else {
            resDiv.innerHTML = `<i class="ph-fill ph-check-circle"></i> Kết nối thành công!<br><b>Model khả dụng:</b> <br>${names.slice(0, 10).join(', ')}${names.length > 10 ? '...' : ''}`;
            resDiv.style.color = '#27ae60';
            console.log('Full models list:', names);
        }
    } catch (e) {
        resDiv.innerHTML = `<i class="ph-fill ph-x-circle"></i> Lỗi: ${e.message}<br><small>Hãy đảm bảo Key đúng và bạn không dùng VPN/Proxy bị chặn.</small>`;
        resDiv.style.color = '#e74c3c';
    }
}

let autoSaveTimer;
function showAutoSavedIndicator() {
    clearTimeout(autoSaveTimer);
    const badge = document.getElementById('autoSaveBadge');
    if (badge) {
        badge.style.opacity = '1';
        autoSaveTimer = setTimeout(() => badge.style.opacity = '0', 1800);
    }
}
function deleteVocabRow(uid) {
    const item = currentFileId ? findItem(tree, currentFileId) : null;
    if (!item?.vocabData) return;
    item.vocabData = item.vocabData.filter(r => (r.uid || r.id) != uid).map((r, i) => ({ ...r, id: i + 1 }));
    saveTree();
    renderVocabTable(item.vocabData);
    renderTree();
    showToast('<i class="ph-fill ph-trash"></i> Đã xóa từ!');
}
function goBackStep1FromTable() {
    const item = currentFileId ? findItem(tree, currentFileId) : null;
    editorRows = (item?.vocabData || []).map(r => ({
        uid: 'u' + r.id,
        val: r.from,
        vocabUid: r.uid
    }));
    if (!editorRows.length) editorRows = [{ uid: 'u1', val: '' }, { uid: 'u2', val: '' }, { uid: 'u3', val: '' }];
    showEditorStep1(true);
}
function addNewWordFromTable() {
    const item = currentFileId ? findItem(tree, currentFileId) : null;
    editorRows = (item?.vocabData || []).map(r => ({
        uid: 'u' + r.id,
        val: r.from,
        vocabUid: r.uid
    }));
    editorRows.push({ uid: 'u' + Date.now(), val: '' });
    showEditorStep1(true);
    setTimeout(() => {
        const inputs = document.querySelectorAll('#inputBody input');
        if (inputs.length) {
            inputs[inputs.length - 1].focus();
            inputs[inputs.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}
function exportExcelFromVocab() {
    showToast('<i class="ph-fill ph-chart-bar"></i> Đang xuất Excel...');
    setTimeout(() => showToast('<i class="ph-fill ph-check-circle"></i> Đã xuất thành công!'), 1500);
}
function updateStepIndicator() {
    document.getElementById('step1Ind').className = 'step' + (editorStep === 1 ? ' active' : '');
    document.getElementById('step2Ind').className = 'step' + (editorStep === 2 ? ' active' : '');
}

/*======================================================================
  11️⃣ CONTEXT MENU & TẠO FILE/FOLDER
======================================================================*/
function getTargetFolderId() {
    if (ctxTarget && ctxTarget.type === 'folder' && ctxTarget.id) return ctxTarget.id;
    return selectedFolderId;
}
function onTreeCtx(e, type, id = null) {
    e.preventDefault(); e.stopPropagation();
    closeAllCtx();
    ctxTarget = { type, id };
    const menu = document.getElementById('ctx-' + type);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
    menu.classList.add('visible');
}
function closeAllCtx() {
    document.querySelectorAll('.ctx-menu').forEach(m => m.classList.remove('visible'));
}
document.addEventListener('click', closeAllCtx);

/* ----- TẠO THƯ MỤC ----- */
function createFolder() {
    closeAllCtx();
    const name = prompt('Tên folder mới:');
    if (!name) return;

    const parentId = getTargetFolderId();

    if (parentId) {
        const parent = findItem(tree, parentId);
        if (parent && parent.type === 'folder') {
            parent.children.push({ id: Date.now(), type: 'folder', name, open: false, children: [] });
            parent.open = true;
            saveTree(); renderTree(); renderWorkspace(parent);
            showToast('<i class="ph-fill ph-folder-plus"></i> Đã tạo folder con: ' + name);
            ctxTarget = null;
            return;
        }
    }

    // Tạo ở root
    tree.push({ id: Date.now(), type: 'folder', name, open: false, children: [] });
    saveTree(); renderTree(); renderWorkspace(); showToast('<i class="ph-fill ph-folder-plus"></i> Đã tạo folder: ' + name);
}

/* ----- TẠO TẬP TIN ----- */
function createFile() {
    closeAllCtx();
    const name = prompt('Tên file mới:');
    if (!name) return;

    const parentId = getTargetFolderId();

    if (parentId) {
        const parent = findItem(tree, parentId);
        if (parent && parent.type === 'folder') {
            parent.children.push({ id: Date.now(), type: 'file', name, createdAt: Date.now() });
            parent.open = true;
            saveTree(); renderTree(); renderWorkspace(parent);
            showToast('<i class="ph-fill ph-file-plus"></i> Đã tạo file trong folder: ' + name);
            ctxTarget = null;
            return;
        }
    }

    // Tạo ở root
    tree.push({ id: Date.now(), type: 'file', name, createdAt: Date.now() });
    saveTree(); renderTree(); renderWorkspace(); showToast('<i class="ph-fill ph-file-plus"></i> Đã tạo file: ' + name);
}

/* ----- CÁC HÀM KHÁC TRONG MENU NGỎ ----- */
function renameItem() {
    closeAllCtx();
    if (!ctxTarget?.id) return;
    const item = findItem(tree, ctxTarget.id);
    const newName = prompt('Tên mới:', item?.name);
    if (newName && item) {
        item.name = newName;
        saveTree(); renderTree(); renderWorkspace(); showToast('<i class="ph-fill ph-pencil-simple"></i> Đã đổi tên thành: ' + newName);
    }
}
function copyItem() { closeAllCtx(); showToast('<i class="ph-fill ph-copy"></i> Đã sao chép!'); }
function cutItem() { closeAllCtx(); showToast('<i class="ph-fill ph-scissors"></i> Đã cắt!'); }
function createSubFolder() {
    closeAllCtx();
    if (!ctxTarget?.id) return;
    const parent = findItem(tree, ctxTarget.id);
    const name = prompt('Tên folder con:');
    if (name && parent?.children !== undefined) {
        parent.children.push({ id: Date.now(), type: 'folder', name, open: false, children: [] });
        parent.open = true;
        saveTree(); renderTree(); showToast('<i class="ph-fill ph-folder-plus"></i> Đã tạo folder con: ' + name);
    }
}
function exportExcel() { closeAllCtx(); showToast('<i class="ph-fill ph-chart-bar"></i> Đang xuất Excel...'); setTimeout(() => showToast('<i class="ph-fill ph-check-circle"></i> Đã xuất thành công!'), 1500); }
function deleteItem(id) {
    closeAllCtx(); closeBottomSheet();
    function removeFromArr(arr) {
        const idx = arr.findIndex(i => i.id === id);
        if (idx > -1) { arr.splice(idx, 1); return true; }
        for (const i of arr) {
            if (i.children && removeFromArr(i.children)) return true;
        }
        return false;
    }
    removeFromArr(tree);
    saveTree(); renderTree(); renderWorkspace(); showToast('<i class="ph-fill ph-trash"></i> Đã xóa!');
}

/*======================================================================
  12️⃣ BOTTOM SHEET
======================================================================*/
function openBottomSheet(title, items) {
    document.getElementById('bottomSheetTitle').textContent = title;
    const container = document.getElementById('bottomSheetItems');
    container.innerHTML = items.map(item => {
        if (item === 'divider') return `<div class="bs-divider"></div>`;
        const act = `'${item.action}'`;
        const bg = item.danger ? 'rgba(231,76,60,.12)' : (item.color || 'rgba(232,84,122,.1)');
        return `<button class="bs-item${item.danger ? ' danger' : ''}" onclick="bsAction(${act})">
  <div class="bs-item-icon" style="background:${bg}">${item.icon}</div>
  <div style="flex:1;min-width:0;">
    <div style="font-size:15px;font-weight:700;">${item.label}</div>
    ${item.desc ? `<div class="bs-item-desc">${item.desc}</div>` : ''}
  </div>
</button>`;
    }).join('');
    document.getElementById('bottomSheetOverlay').style.display = 'block';
    requestAnimationFrame(() => {
        document.getElementById('bottomSheet').style.transform = 'translateY(0)';
    });
}
function closeBottomSheet() {
    document.getElementById('bottomSheet').style.transform = 'translateY(100%)';
    setTimeout(() => {
        document.getElementById('bottomSheetOverlay').style.display = 'none';
    }, 300);
}
function bsAction(action) {
    closeBottomSheet();
    if (typeof action === 'function') action();
    else if (typeof action === 'string') {
        const fn = window[action];
        if (typeof fn === 'function') fn();
        else {
            try { eval(action); } catch (e) { console.error('bsAction error:', e); }
        }
    }
}

/*======================================================================
  13️⃣ FAB (Floating Action Button) – CONTEXT‑AWARE
======================================================================*/
function showFabMenu() {
    const fab = document.getElementById('fabBtn');
    fab.classList.add('spin');
    setTimeout(() => fab.classList.remove('spin'), 260);

    const inFolder = currentFolderId !== null;
    const folder = inFolder ? findItem(tree, currentFolderId) : null;
    const location = inFolder ? folder?.name : 'Tài liệu gốc';

    openBottomSheet('<i class="ph-bold ph-plus"></i> Tạo mới tại: ' + location, [
        {
            icon: '<i class="ph-fill ph-folder"></i>',
            label: 'Tạo Folder',
            desc: inFolder ? `Folder con trong "${location}"` : 'Folder ở thư mục gốc',
            color: 'rgba(212,169,106,.18)',
            action: 'createFolder()'
        },
        {
            icon: '<i class="ph-fill ph-file-text"></i>',
            label: 'Tạo File từ vựng',
            desc: inFolder ? `File trong "${location}"` : 'File ở thư mục gốc',
            color: 'rgba(99,102,241,.15)',
            action: 'createFile()'
        }
    ]);
}
function updateFabLabel() {
    const labelEl = document.getElementById('fabLabel');
    if (!labelEl) return;
    if (currentFolderId) {
        const f = findItem(tree, currentFolderId);
        labelEl.textContent = f ? '+ ' + f.name : '+ Thêm mới';
    } else {
        labelEl.textContent = 'Thêm mới';
    }
}

/*======================================================================
  14️⃣ LONG‑PRESS & CONTEXT MENU HANDLER
======================================================================*/
let longPressTimer = null;
let longPressTarget = null;
let longPressFired = false;   // prevents click after long‑press

function onItemTouchStart(e, type, id) {
    longPressFired = false;
    longPressTarget = { type, id };
    const el = e.currentTarget;

    const pressTimer = setTimeout(() => {
        el?.classList.add('pressing');
    }, 120);

    longPressTimer = setTimeout(() => {
        longPressFired = true;
        el?.classList.remove('pressing');
        el?.classList.add('long-pressed');
        navigator.vibrate && navigator.vibrate([30, 10, 30]);
        showItemBottomSheet(type, id);
        setTimeout(() => el?.classList.remove('long-pressed'), 600);
    }, 450);

    el._pressTimer = pressTimer;
}
function onItemTouchEnd(e) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    const el = e?.currentTarget;
    if (el) {
        clearTimeout(el._pressTimer);
        el.classList.remove('pressing');
    }
}
function onItemTouchMove(e) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    const el = e?.currentTarget;
    if (el) {
        clearTimeout(el._pressTimer);
        el.classList.remove('pressing');
    }
}

/* Called from both long‑press AND right‑click context menu */
function showItemBottomSheet(type, id) {
    ctxTarget = { type, id };
    const item = findItem(tree, id);
    if (!item) return;
    const name = item.name || '';
    const wordCount = item.vocabData?.length || 0;
    const hasVocab = wordCount > 0;

    if (type === 'folder') {
        openBottomSheet('<i class="ph-fill ph-folder" style="color:var(--gold)"></i> ' + name, [
            { icon: '<i class="ph-fill ph-pencil-simple"></i>', label: 'Đổi tên folder', desc: 'Đặt lại tên cho folder này', color: 'rgba(99,102,241,.15)', action: 'renameItem()' },
            'divider',
            { icon: '<i class="ph-fill ph-folder-plus"></i>', label: 'Tạo folder con', desc: 'Thêm folder bên trong "' + name + '"', color: 'rgba(212,169,106,.18)', action: 'createSubFolder()' },
            { icon: '<i class="ph-fill ph-file-plus"></i>', label: 'Tạo file trong folder', desc: 'File từ vựng mới trong "' + name + '"', color: 'rgba(232,84,122,.12)', action: 'createFile()' },
            'divider',
            { icon: '<i class="ph-fill ph-trash"></i>', label: 'Xóa folder', desc: 'Xóa folder và toàn bộ nội dung', danger: true, action: `deleteItem(${id})` }
        ]);
    } else {
        const meta = hasVocab ? `<i class="ph-fill ph-books"></i> ${wordCount} từ vựng` : 'Chưa có từ vựng';
        openBottomSheet('<i class="ph-fill ph-file-text" style="color:var(--accent1)"></i> ' + name, [
            { icon: '<i class="ph-fill ph-book-open-text"></i>', label: 'Mở file', desc: meta, color: 'rgba(232,84,122,.12)', action: `openFile(${id})` },
            { icon: '<i class="ph-fill ph-pencil-simple"></i>', label: 'Đổi tên file', desc: 'Đặt lại tên cho file này', color: 'rgba(99,102,241,.15)', action: 'renameItem()' },
            hasVocab ? { icon: '<i class="ph-fill ph-brain"></i>', label: 'Ôn tập ngay', desc: `Ôn ${wordCount} từ trong file này`, color: 'rgba(39,174,96,.15)', action: `startReviewFromFile(${id})` } : null,
            'divider',
            { icon: '<i class="ph-fill ph-trash"></i>', label: 'Xóa file', desc: 'Không thể khôi phục sau khi xóa', danger: true, action: `deleteItem(${id})` }
        ].filter(Boolean));
    }
}

/* Shortcut: jump straight to review for a specific file */
function startReviewFromFile(id) {
    closeBottomSheet();
    const item = findItem(tree, id);
    if (!item || !item.vocabData?.length) {
        showToast('<i class="ph-fill ph-warning-circle"></i> File chưa có từ vựng!');
        return;
    }
    reviewFileId = id;
    reviewFileItem = item;
    reviewVocabulary = shuffleArray(item.vocabData.map(v => ({
        uid: v.uid || ('v' + Date.now() + Math.random()),
        from: v.from,
        hanzi: v.hanzi,
        pinyin: v.pinyin,
        meaning: v.meaning,
        exHan: v.exHan,
        exPin: v.exPin,
        exVi: v.exVi
    })));
    reviewStats = {
        total: reviewVocabulary.length,
        correct: 0,
        wrong: 0,
        startTime: Date.now(),
        endTime: null,
        wrongWords: []
    };
    currentQuestionIndex = 0;
    showPage('review-game-select');
    renderGameSelect();
    showToast('<i class="ph-fill ph-brain"></i> Đang ôn tập: ' + item.name);
}

/*======================================================================
  15️⃣ FLASHCARD – MẶT TRƯỚC LÀ NGHĨA, MẶT SAU LÀ HÁN + PINYIN
======================================================================*/
function renderFlashcard() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    if (!vocab) { goToResultPage(); return; }

    const pct = Math.round(currentQuestionIndex / reviewStats.total * 100);
    const body = document.getElementById('flashBody');
    body.innerHTML = `
<div style="width:100%;max-width:560px;display:flex;flex-direction:column;gap:20px;align-items:center;">
  <div class="rv-progress-bar" style="width:100%;">
    <div class="rv-progress-fill" style="width:${pct}%"></div>
  </div>
  <div class="flashcard" onclick="flipFlashcard()">
    <div class="flash-inner" id="flashInner">
      <div class="flash-front">
        <div class="flash-hanzi">${vocab.from}</div>
        <div class="flash-pinyin">${vocab.pinyin}</div>
        <div class="flash-tap-hint">Nhấn để xem nghĩa</div>
      </div>
      <div class="flash-back">
        <div class="flash-meaning">${vocab.meaning}</div>
        ${vocab.exHan ? `<div class="flash-example"><em>${vocab.exHan}</em><br><span style="color:var(--gold)">${vocab.exVi || ''}</span></div>` : ''}
        <div class="flash-tap-hint">Nhấn để lật lại</div>
      </div>
    </div>
  </div>
  <div class="flash-controls">
    <button class="confirm-btn" style="background:linear-gradient(135deg,#e74c3c,#c0392b);min-width:140px;" onclick="recordFlashResult(false)"><i class="ph-bold ph-x"></i> Chưa nhớ</button>
    <button class="confirm-btn" style="background:linear-gradient(135deg,#27ae60,#1e8449);min-width:140px;" onclick="recordFlashResult(true)"><i class="ph-bold ph-check"></i> Đã nhớ</button>
  </div>
</div>`;
}

/*======================================================================
  16️⃣ FLASHCARD HELPERS
======================================================================*/
function flipFlashcard() {
    const inner = document.getElementById('flashInner');
    if (!inner) return;
    inner.classList.toggle('flipped');
}
function recordFlashResult(remembered) {
    const vocab = reviewVocabulary[currentQuestionIndex];
    remembered ? reviewStats.correct++ : (reviewStats.wrong++, reviewStats.wrongWords.push(vocab));
    currentQuestionIndex++;
    updateFlashHeader();
    renderFlashcard();
}

/*======================================================================
  17️⃣ REVIEW – CHỌN FILE / TRÒ CHƠI / KẾT QUẢ
======================================================================*/
/* ---- 17.1 CHỌN FILE ---- */
function renderReviewFileList() {
    const flatten = arr => {
        let res = [];
        arr.forEach(i => {
            if (i.type === 'file') res.push(i);
            if (i.type === 'folder' && i.children) res = res.concat(flatten(i.children));
        });
        return res;
    };
    const files = flatten(tree);

    if (!files.length) {
        document.getElementById('reviewFileList').innerHTML = `<div class="rv-empty"><div style="font-size: 32px; color: var(--gold); margin-bottom: 8px;"><i class="ph-fill ph-mailbox"></i></div>Chưa có file nào.<br>Hãy tạo file trong mục <strong>Học tập</strong>!</div>`;
        return;
    }

    const html = files.map(f => {
        const sel = f.id === reviewFileId;
        const wordCount = f.vocabData?.length || 0;
        const stat = getReviewStat(f.id);
        const bestBadge = stat ? `<span class="rfc-badge"><i class="ph-fill ph-trophy"></i> ${stat.bestPercent}%</span>` : '';
        return `<div class="review-file-card${sel ? ' selected' : ''}" onclick="selectReviewFile(${f.id})">
            <div class="rfc-icon">${sel ? '<i class="ph-fill ph-notebook" style="color:var(--accent1)"></i>' : '<i class="ph-fill ph-file-text" style="color:var(--text2)"></i>'}</div>
            <div class="rfc-info">
                <div class="review-file-name">${f.name}</div>
                <div class="review-file-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span><i class="ph-fill ph-books" style="margin-right:2px"></i> ${wordCount} từ</span>
                    ${bestBadge}
                </div>
            </div>
            <div class="rfc-check"><i class="ph-bold ph-check"></i></div>
        </div>`;
    }).join('');
    document.getElementById('reviewFileList').innerHTML = html;

    const btn = document.getElementById('btnStartReview');
    if (btn) btn.disabled = !reviewFileId;
}
function selectReviewFile(id) {
    reviewFileId = id;
    reviewFileItem = findItem(tree, id);
    const wordCount = reviewFileItem?.vocabData?.length || 0;

    // Desktop panel
    const nameEl = document.getElementById('reviewFileName');
    const countEl = document.getElementById('reviewWordCount');
    const dateEl = document.getElementById('reviewFileDate');
    const startBtn = document.getElementById('btnStartReview');
    if (nameEl) nameEl.textContent = reviewFileItem?.name || 'Chưa chọn file';
    if (countEl) countEl.textContent = wordCount;
    if (dateEl) dateEl.textContent = formatDate(reviewFileItem?.createdAt);
    if (startBtn) startBtn.disabled = false;

    // Mobile bar
    const bar = document.getElementById('rvMobileBar');
    const barName = document.getElementById('rvMobileFileName');
    const barMeta = document.getElementById('rvMobileFileMeta');
    const barBtn = document.getElementById('btnStartReviewMobile');
    if (barName) barName.innerHTML = reviewFileItem?.name || '';
    if (barMeta) barMeta.innerHTML = `<i class="ph-fill ph-books"></i> ${wordCount} từ`;
    if (barBtn) barBtn.disabled = wordCount === 0;
    if (bar) bar.classList.add('visible');

    renderReviewFileList();
}
function startReviewSession() {
    if (!reviewFileItem) {
        showToast('<i class="ph-fill ph-warning-circle"></i> Vui lòng chọn một file để ôn tập');
        return;
    }
    const vocab = (reviewFileItem.vocabData || []).map(v => ({
        uid: v.uid || ('v' + Date.now() + Math.random()),
        from: v.from,
        hanzi: v.hanzi,
        pinyin: v.pinyin,
        meaning: v.meaning,
        exHan: v.exHan,
        exPin: v.exPin,
        exVi: v.exVi
    }));
    if (!vocab.length) { showToast('<i class="ph-fill ph-warning-circle"></i> File chưa có từ vựng nào!'); return; }

    reviewVocabulary = shuffleArray(vocab);
    currentQuestionIndex = 0;
    showPage('review-game-select');
    renderGameSelect();
}

function resetToFullVocabulary() {
    if (!reviewFileItem || !reviewFileItem.vocabData) return;
    reviewVocabulary = shuffleArray(reviewFileItem.vocabData.map(v => ({
        uid: v.uid || ('v' + Date.now() + Math.random()),
        from: v.from,
        hanzi: v.hanzi,
        pinyin: v.pinyin,
        meaning: v.meaning,
        exHan: v.exHan,
        exPin: v.exPin,
        exVi: v.exVi
    })));
}

function goToGameSelect() {
    resetToFullVocabulary();
    showPage('review-game-select');
    renderGameSelect();
}

/* ---- 17.2 CHỌN TRÒ CHƠI ---- */
function renderGameSelect() {
    const games = [
        { key: 'abc', icon: '<i class="ph-fill ph-text-a-underline"></i>', label: 'Trắc nghiệm ABCD', desc: 'Chọn đáp án đúng' },
        { key: 'flash', icon: '<i class="ph-fill ph-cards"></i>', label: 'Flashcard', desc: 'Lật thẻ nhớ' },
        { key: 'writeMean', icon: '<i class="ph-fill ph-pencil-line"></i>', label: 'Nhìn Hán → nghĩa', desc: 'Nhập nghĩa tiếng Việt' },
        { key: 'writeZh', icon: '<i class="ph-bold ph-arrows-clockwise"></i>', label: 'Nhìn nghĩa → Hán', desc: 'Nhập Hán hoặc pinyin' }
    ];
    const grid = document.getElementById('gameSelectGrid');
    grid.innerHTML = games.map(g => `
        <div class="gs-card" data-mode="${g.key}">
            <div class="gs-icon">${g.icon}</div>
            <div class="gs-label">${g.label}</div>
            <div class="gs-desc">${g.desc}</div>
            <button class="confirm-btn" onclick="openGameMode('${g.key}');event.stopPropagation();">Chơi ngay</button>
        </div>`).join('');
    document.querySelectorAll('.gs-card').forEach(c => c.addEventListener('click', () => openGameMode(c.dataset.mode)));
}
function openGameMode(mode) {
    reviewMode = mode;
    currentQuestionIndex = 0;

    // Reset stats for the new game session
    reviewStats.total = reviewVocabulary.length;
    reviewStats.correct = 0;
    reviewStats.wrong = 0;
    reviewStats.startTime = Date.now();
    reviewStats.endTime = null;
    reviewStats.wrongWords = [];

    switch (mode) {
        case 'abc': showPage('review-game-abc'); initABCGame(); break;
        case 'flash': showPage('review-game-flash'); initFlashcardGame(); break;
        case 'writeMean': showPage('review-game-write-meaning'); initWriteMeaningGame(); break;
        case 'writeZh': showPage('review-game-write-zh'); initWriteZhGame(); break;
        default: console.warn('Chế độ chưa xác định:', mode);
    }
}

/* ---- 17.3 GAME 1 – Trắc nghiệm ABCD ---- */
function initABCGame() {
    updateABCHeader();
    renderABCQuestion();
}
function updateABCHeader() {
    const p = document.getElementById('abcProgress');
    const s = document.getElementById('abcScore');
    if (p) p.innerHTML = `Câu ${currentQuestionIndex + 1}/${reviewStats.total}`;
    if (s) s.innerHTML = `<i class="ph-bold ph-check" style="color:#27ae60; margin-right:4px;"></i> Đúng: ${reviewStats.correct} &nbsp;&nbsp;&nbsp; <i class="ph-bold ph-x" style="color:#e74c3c; margin-right:4px;"></i> Sai: ${reviewStats.wrong}`;
}
function renderABCQuestion() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    if (!vocab) { goToResultPage(); return; }

    const pct = Math.round(currentQuestionIndex / reviewStats.total * 100);
    const wrong = reviewVocabulary.filter(v => v.meaning !== vocab.meaning).sort(() => 0.5 - Math.random()).slice(0, 3);
    const choices = shuffleArray([vocab.meaning, ...wrong.map(w => w.meaning)]);

    const body = document.getElementById('abcBody');
    body.innerHTML = `
<div class="abc-question-card" style="animation:fadeInUp .3s ease;">
    <div class="rv-progress-bar" style="width:100%;margin-bottom:8px;">
        <div class="rv-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="abc-question-prompt">${vocab.from}</div>
    <div class="abc-choices">
        ${choices.map((c, i) => `
            <button class="confirm-btn abc-choice" data-answer="${c}"
                    onclick="handleABCAnswerV2(this)">${String.fromCharCode(65 + i)}. ${c}</button>`).join('')}
    </div>
    <button class="confirm-btn" id="abcNextBtn" onclick="nextABCQuestion()" disabled style="margin-top:4px;">Câu tiếp theo →</button>
</div>`;
}
function handleABCAnswerV2(btn) {
    const vocab = reviewVocabulary[currentQuestionIndex];
    const selected = btn.dataset.answer;
    const isCorrect = selected === vocab.meaning;
    const body = document.getElementById('abcBody');
    const buttons = [...body.querySelectorAll('.abc-choice')];
    buttons.forEach(b => {
        if (b.dataset.answer === vocab.meaning) b.classList.add('correct-ans');
        else if (b === btn && !isCorrect) {
            b.classList.add('wrong-ans', 'shake');
            setTimeout(() => b.classList.remove('shake'), 600);
        }
        b.disabled = true;
    });
    if (isCorrect) reviewStats.correct++;
    else { reviewStats.wrong++; reviewStats.wrongWords.push(vocab); }
    const nextBtn = document.getElementById('abcNextBtn');
    if (nextBtn) nextBtn.disabled = false;
    updateABCHeader();
}
function nextABCQuestion() {
    currentQuestionIndex++;
    renderABCQuestion();
}

/* ---- 17.4 GAME 2 – Flashcard (đã sửa front/back) ---- */
function initFlashcardGame() {
    updateFlashHeader();
    renderFlashcard();
}
function updateFlashHeader() {
    const p = document.getElementById('flashProgress');
    const s = document.getElementById('flashScore');
    if (p) p.innerHTML = `Thẻ ${currentQuestionIndex + 1}/${reviewStats.total}`;
    if (s) s.innerHTML = `<i class="ph-bold ph-check" style="color:#27ae60; margin-right:4px;"></i> Đúng: ${reviewStats.correct} &nbsp;&nbsp;&nbsp; <i class="ph-bold ph-x" style="color:#e74c3c; margin-right:4px;"></i> Sai: ${reviewStats.wrong}`;
}

/* ---- 17.5 GAME 3 – Nhìn Hán → viết nghĩa ---- */
function initWriteMeaningGame() {
    updateWriteMeanHeader();
    renderWriteMeaning();
}
function updateWriteMeanHeader() {
    const p = document.getElementById('writeMeanProgress');
    const s = document.getElementById('writeMeanScore');
    if (p) p.innerHTML = `Câu ${currentQuestionIndex + 1}/${reviewStats.total}`;
    if (s) s.innerHTML = `<i class="ph-bold ph-check" style="color:#27ae60; margin-right:4px;"></i> Đúng: ${reviewStats.correct} &nbsp;&nbsp;&nbsp; <i class="ph-bold ph-x" style="color:#e74c3c; margin-right:4px;"></i> Sai: ${reviewStats.wrong}`;
}
function renderWriteMeaning() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    if (!vocab) { goToResultPage(); return; }

    const pct = Math.round(currentQuestionIndex / reviewStats.total * 100);
    const body = document.getElementById('writeMeanBody');
    body.innerHTML = `
<div class="write-card">
    <div class="rv-progress-bar">
        <div class="rv-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="write-prompt-box">${vocab.from}</div>
    <input class="write-input" type="text" id="writeMeanInput" placeholder="Nhập nghĩa tiếng Việt..."
        onkeydown="if(event.key==='Enter')checkWriteMeaning()">
    <div id="writeMeanFeedback" class="write-feedback"></div>
    <button class="confirm-btn" onclick="checkWriteMeaning()">Kiểm tra ✓</button>
    <button class="confirm-btn secondary-btn" id="writeMeanShowAnsBtn" style="display:none; margin-top:10px; background:var(--surface); color:var(--text); border:1px solid var(--border);" onclick="showWriteMeaningAnswer()">Hiện đáp án</button>
</div>`;
    
    // Reset state for new question
    window.currentWriteQuestionFailed = false;

    setTimeout(() => document.getElementById('writeMeanInput')?.focus(), 50);
}
function checkWriteMeaning() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    const user = document.getElementById('writeMeanInput').value.trim().toLowerCase();
    const correct = vocab.meaning.trim().toLowerCase();

    const exact = user === correct;
    const approx = correct.includes(user) || user.includes(correct);

    const feedback = document.getElementById('writeMeanFeedback');
    const inputEl = document.getElementById('writeMeanInput');
    const btn = document.querySelector('#writeMeanBody .confirm-btn');
    const showAnsBtn = document.getElementById('writeMeanShowAnsBtn');

    if (exact) {
        feedback.innerHTML = '<i class="ph-bold ph-check"></i> Đúng';
        feedback.style.color = '#27ae60';
        
        if (!window.currentWriteQuestionFailed) {
            reviewStats.correct++;
        }
        
        inputEl.disabled = true;
        if (showAnsBtn) showAnsBtn.style.display = 'none';
        btn.textContent = 'Câu tiếp theo';
        btn.onclick = nextWriteMeaning;
    } else {
        feedback.innerHTML = `<i class="ph-bold ph-x"></i> Sai. Hãy thử lại!`;
        feedback.style.color = '#e74c3c';
        
        // Mark as failed on first mistake
        if (!window.currentWriteQuestionFailed) {
            reviewStats.wrong++;
            reviewStats.wrongWords.push(vocab);
            window.currentWriteQuestionFailed = true;
        }
        
        // Do not disable input, do not change main button
        if (showAnsBtn) showAnsBtn.style.display = 'inline-block';
        inputEl.focus();
    }
}
function showWriteMeaningAnswer() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    const feedback = document.getElementById('writeMeanFeedback');
    
    // Mark as wrong if they gave up without any attempt
    if (!window.currentWriteQuestionFailed) {
        reviewStats.wrong++;
        reviewStats.wrongWords.push(vocab);
        window.currentWriteQuestionFailed = true;
    }
    
    feedback.innerHTML = `<i class="ph-fill ph-info"></i> Đáp án: <strong>${vocab.meaning}</strong>`;
    feedback.style.color = 'var(--text)';
    
    document.getElementById('writeMeanInput').disabled = true;
    document.getElementById('writeMeanShowAnsBtn').style.display = 'none';
    
    const btn = document.querySelector('#writeMeanBody .confirm-btn');
    btn.textContent = 'Câu tiếp theo';
    btn.onclick = nextWriteMeaning;
}
function nextWriteMeaning() {
    currentQuestionIndex++;
    renderWriteMeaning();
    updateWriteMeanHeader();
}

/* ---- 17.6 GAME 4 – Nhìn nghĩa → viết Hán hoặc pinyin ---- */
function initWriteZhGame() {
    updateWriteZhHeader();
    renderWriteZh();
}
function updateWriteZhHeader() {
    const p = document.getElementById('writeZhProgress');
    const s = document.getElementById('writeZhScore');
    if (p) p.innerHTML = `Câu ${currentQuestionIndex + 1}/${reviewStats.total}`;
    if (s) s.innerHTML = `<i class="ph-bold ph-check" style="color:#27ae60; margin-right:4px;"></i> Đúng: ${reviewStats.correct} &nbsp;&nbsp;&nbsp; <i class="ph-bold ph-x" style="color:#e74c3c; margin-right:4px;"></i> Sai: ${reviewStats.wrong}`;
}
function renderWriteZh() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    if (!vocab) { goToResultPage(); return; }

    const pct = Math.round(currentQuestionIndex / reviewStats.total * 100);
    const body = document.getElementById('writeZhBody');
    body.innerHTML = `
<div class="write-card">
    <div class="rv-progress-bar">
        <div class="rv-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="write-prompt-box write-meaning-prompt">${vocab.meaning}</div>
    <input class="write-input" type="text" id="writeZhInput" placeholder="Nhập Hán tự hoặc pinyin..."
        onkeydown="if(event.key==='Enter')checkWriteZh()" style="font-family:'Noto Sans SC',sans-serif;">
    <div id="writeZhFeedback" class="write-feedback"></div>
    <button class="confirm-btn" onclick="checkWriteZh()">Kiểm tra ✓</button>
    <button class="confirm-btn secondary-btn" id="writeZhShowAnsBtn" style="display:none; margin-top:10px; background:var(--surface); color:var(--text); border:1px solid var(--border);" onclick="showWriteZhAnswer()">Hiện đáp án</button>
</div>`;

    // Reset state for new question
    window.currentWriteQuestionFailed = false;
    
    setTimeout(() => document.getElementById('writeZhInput')?.focus(), 50);
}
function normalizePinyin(str) {
    const map = {
        'á': 'a', 'à': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a', 'ă': 'a', 'ắ': 'a', 'ằ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a', 'â': 'a', 'ấ': 'a', 'ầ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
        'é': 'e', 'è': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e', 'ê': 'e', 'ế': 'e', 'ề': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
        'í': 'i', 'ì': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
        'ó': 'o', 'ò': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o', 'ô': 'o', 'ố': 'o', 'ồ': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o', 'ơ': 'o', 'ớ': 'o', 'ờ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
        'ú': 'u', 'ù': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u', 'ư': 'u', 'ứ': 'u', 'ừ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
        'ý': 'y', 'ỳ': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
        'đ': 'd', 'Đ': 'D'
    };
    return str.replace(/[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđĐ]/g, m => map[m] || m);
}
function checkWriteZh() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    const user = document.getElementById('writeZhInput').value.trim().toLowerCase();
    const han = vocab.from.trim().toLowerCase();
    const pin = vocab.pinyin.trim().toLowerCase();

    const pinyinOn = document.getElementById('pinyinToggle')?.classList.contains('on');
    const normUser = pinyinOn ? normalizePinyin(user) : user;
    const normPin = pinyinOn ? normalizePinyin(pin) : pin;

    const isHan = normUser === han;
    const isPin = normUser === normPin;

    const feedback = document.getElementById('writeZhFeedback');
    const inputEl = document.getElementById('writeZhInput');
    const btn = document.querySelector('#writeZhBody .confirm-btn');
    const showAnsBtn = document.getElementById('writeZhShowAnsBtn');

    if (isHan || isPin) {
        feedback.innerHTML = '<i class="ph-bold ph-check"></i> Đúng';
        feedback.style.color = '#27ae60';
        
        if (!window.currentWriteQuestionFailed) {
            reviewStats.correct++;
        }
        
        inputEl.disabled = true;
        if (showAnsBtn) showAnsBtn.style.display = 'none';
        btn.textContent = 'Câu tiếp theo';
        btn.onclick = nextWriteZh;
    } else {
        feedback.innerHTML = `<i class="ph-bold ph-x"></i> Sai. Hãy thử lại!`;
        feedback.style.color = '#e74c3c';
        
        // Mark as failed on first mistake
        if (!window.currentWriteQuestionFailed) {
            reviewStats.wrong++;
            reviewStats.wrongWords.push(vocab);
            window.currentWriteQuestionFailed = true;
        }
        
        // Do not disable input, do not change main button
        if (showAnsBtn) showAnsBtn.style.display = 'inline-block';
        inputEl.focus();
    }
}
function showWriteZhAnswer() {
    const vocab = reviewVocabulary[currentQuestionIndex];
    const feedback = document.getElementById('writeZhFeedback');
    
    // Mark as wrong if they gave up without any attempt
    if (!window.currentWriteQuestionFailed) {
        reviewStats.wrong++;
        reviewStats.wrongWords.push(vocab);
        window.currentWriteQuestionFailed = true;
    }
    
    feedback.innerHTML = `<i class="ph-fill ph-info"></i> Đáp án Hán: <strong>${vocab.from}</strong><br>Pinyin: <strong>${vocab.pinyin}</strong>`;
    feedback.style.color = 'var(--text)';
    
    document.getElementById('writeZhInput').disabled = true;
    document.getElementById('writeZhShowAnsBtn').style.display = 'none';
    
    const btn = document.querySelector('#writeZhBody .confirm-btn');
    btn.textContent = 'Câu tiếp theo';
    btn.onclick = nextWriteZh;
}
function nextWriteZh() {
    currentQuestionIndex++;
    renderWriteZh();
    updateWriteZhHeader();
}

/* ---- 17.7 KẾT QUẢ ---- */
function goToResultPage() {
    reviewStats.endTime = Date.now();
    const durationSec = Math.round((reviewStats.endTime - reviewStats.startTime) / 1000);
    const percent = reviewStats.total ? Math.round((reviewStats.correct / reviewStats.total) * 100) : 0;
    const emoji = percent >= 90 ? '<i class="ph-fill ph-trophy"></i>' : percent >= 70 ? '<i class="ph-fill ph-confetti"></i>' : percent >= 50 ? '<i class="ph-fill ph-barbell"></i>' : '<i class="ph-fill ph-book-open-text"></i>';

    const body = document.getElementById('resultBody');
    const wrongItems = reviewStats.wrongWords.map(w => `
    <div class="rv-wrong-item">
        <div class="rv-wrong-hanzi">${w.from}</div>
        <div>
            <div style="font-size:12px;color:var(--gold);font-weight:600">${w.pinyin || ''}</div>
            <div class="rv-wrong-meaning">${w.meaning}</div>
        </div>
    </div>`).join('');

    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const timeStr = min > 0 ? `${min}p ${sec}s` : `${sec}s`;

    body.innerHTML = `
        <div class="rv-result-emoji">${emoji}</div>
        <div class="rv-result-score">${percent}%</div>
        <div class="rv-result-pct-label">Tỷ lệ đúng</div>
        <div class="rv-result-stats">
            <div class="rv-stat-box">
                <div class="rv-stat-num" style="color:#27ae60">${reviewStats.correct}</div>
                <div class="rv-stat-label">Đúng</div>
            </div>
            <div class="rv-stat-box">
                <div class="rv-stat-num" style="color:#e74c3c">${reviewStats.wrong}</div>
                <div class="rv-stat-label">Sai</div>
            </div>
            <div class="rv-stat-box">
                <div class="rv-stat-num" style="color:var(--gold)">${timeStr}</div>
                <div class="rv-stat-label">Thời gian</div>
            </div>
        </div>
        ${reviewStats.wrongWords.length ? `
        <div class="rv-wrong-list">
            <div class="rv-wrong-list-title"><i class="ph-bold ph-x"></i> Từ cần ôn lại (${reviewStats.wrongWords.length})</div>
            ${wrongItems}
        </div>` : '<div style="text-align:center;font-size:32px;padding:12px 0;"><i class="ph-fill ph-confetti" style="color:var(--accent1)"></i> Xuất sắc! Không có từ sai!</div>'}
    `;
    if (reviewFileId) saveReviewStat(reviewFileId, reviewStats);
    showPage('review-result');
}
function restartCurrentGame() {
    if (!reviewFileItem) return;
    reviewVocabulary = shuffleArray(reviewVocabulary);
    openGameMode(reviewMode);
}
function reviewWrongWords() {
    if (!reviewStats.wrongWords.length) {
        showToast('<i class="ph-fill ph-confetti"></i> Không có từ sai để ôn lại!');
        return;
    }
    reviewVocabulary = shuffleArray(reviewStats.wrongWords);
    openGameMode(reviewMode);
}

/*======================================================================
  18️⃣ INIT
======================================================================*/
document.addEventListener('DOMContentLoaded', function () {
    loadSettings();
});
if (document.readyState !== 'loading') loadSettings();
renderTree();
renderWorkspace();

/* Monkey‑patch showPage để cập nhật dung lượng lưu trữ khi vào Settings */
const _origShowPage = window.showPage;
window.showPage = function (id, isBack) {
    _origShowPage(id, isBack);
    if (id === 'settings') updateStorageSize();
};

/*======================================================================
  19️⃣ SETTINGS – EXTRA FUNCTIONS
======================================================================*/
function promptEditUsername() {
    const current = dbLoad(DB_KEY_SETTINGS, {}).username || 'Diệu';
    const name = prompt('Nhập tên của bạn:', current);
    if (name !== null) saveUsername(name);
}
function updateStorageSize() {
    const el = document.getElementById('storageSizeEl');
    if (!el) return;
    try {
        let total = 0;
        for (const k of [DB_KEY_TREE, DB_KEY_SETTINGS, DB_KEY_STATS]) {
            const v = localStorage.getItem(k);
            if (v) total += v.length;
        }
        el.textContent = (total / 1024).toFixed(1) + ' KB';
    } catch (e) {
        el.textContent = 'N/A';
    }
}
function confirmClearData() {
    const ok = confirm('⚠️ Bạn có chắc muốn XÓA TOÀN BỘ dữ liệu?\nHành động này không thể hoàn tác!');
    if (!ok) return;
    try {
        localStorage.removeItem(DB_KEY_TREE);
        localStorage.removeItem(DB_KEY_SETTINGS);
        localStorage.removeItem(DB_KEY_STATS);
    } catch (e) { }
    showToast('<i class="ph-fill ph-trash"></i> Đã xóa dữ liệu. Tải lại trang...');
    setTimeout(() => location.reload(), 1500);
}

/*======================================================================
  20️⃣ SOUND FEEDBACK
======================================================================*/
const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
function playSound(type) {
    if (!audioCtx) return;
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        if (type === 'correct') {
            o.frequency.setValueAtTime(523, audioCtx.currentTime);
            o.frequency.setValueAtTime(659, audioCtx.currentTime + 0.1);
        } else {
            o.frequency.setValueAtTime(220, audioCtx.currentTime);
            o.frequency.setValueAtTime(180, audioCtx.currentTime + 0.1);
        }
        g.gain.setValueAtTime(0.15, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        o.start(); o.stop(audioCtx.currentTime + 0.3);
    } catch (e) { }
}

/*======================================================================
  END OF FILE
======================================================================*/