/*
 * 杭ナビ → GL.csv 変換ツール (Web) のメイン制御
 *
 * 原本 MainForm.cs のロジックを移植:
 *  - D&D / ファイル選択
 *  - グリッド表示 / 行選択 / Z セル直接編集
 *  - 配置図 / 生データのタブ切替
 *  - Z 単一・一括編集
 *  - エンコーディング選択して保存
 */
(function () {
    'use strict';

    const G = window.GlConverter;
    const $ = (id) => document.getElementById(id);

    // ---- DOM 参照 ----
    const dropzone = $('dropzone');
    const btnSelect = $('btnSelect');
    const btnClear = $('btnClear');
    const btnExport = $('btnExport');
    const btnEditSelectedZ = $('btnEditSelectedZ');
    const btnGroupEditZ = $('btnGroupEditZ');
    const btnAllEditZ = $('btnAllEditZ');
    const encodingSel = $('encoding');
    const gridHeader = $('gridHeader');
    const gridBody = $('gridBody');
    const rawText = $('rawText');
    const outText = $('outText');
    const outInfo = $('outInfo');
    const btnCopyOut = $('btnCopyOut');
    const tabRaw = $('tabRaw');
    const tabPlot = $('tabPlot');
    const tabOut = $('tabOut');
    const tabPlotText = $('tabPlotText');
    const paneRaw = $('paneRaw');
    const panePlot = $('panePlot');
    const paneOut = $('paneOut');
    const statusbar = $('statusbar');
    const splitter = $('splitter');
    const canvas = $('plotCanvas');

    // ---- 状態 ----
    let _rows = [];                 // 現在のデータ
    let _rawText = '';              // 読み込んだ生テキスト
    let _inputFileName = null;      // 入力ファイル名
    let _selectedIndex = -1;        // 選択行 index
    let _editedZ = new Set();       // Z 値が編集された行 index (緑強調用)
    let _outputHandle = null;       // File System Access API のファイルハンドル
    let _suggestedName = '';        // 出力ファイル名 (入力CSV名から自動生成)

    // ---- 配置図 ----
    const plot = new window.PlotPanel(canvas);
    plot.onSelect((idx, dist) => {
        selectRow(idx);
        const r = _rows[idx];
        setStatus(`選択: ${r.name}  出力 X=${G.fmt(r.outX)} / Y=${G.fmt(r.outY)} / Z=${G.fmt(r.outZ)}  (クリック点との距離 ${dist.toFixed(1)} px)`);
    });

    // ---- イベント結線 ----
    btnSelect.addEventListener('click', onSelectFile);
    btnClear.addEventListener('click', onClear);
    btnExport.addEventListener('click', onExport);
    btnEditSelectedZ.addEventListener('click', onEditSelectedZ);
    btnGroupEditZ.addEventListener('click', onGroupEditZ);
    btnAllEditZ.addEventListener('click', onAllEditZ);

    dropzone.addEventListener('click', onSelectFile);
    ['dragenter', 'dragover'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropzone.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropzone.classList.remove('dragover');
        });
    });
    dropzone.addEventListener('drop', onDrop);

    // ウィンドウ全体でも D&D 受け付け
    ['dragenter', 'dragover'].forEach(ev => {
        document.body.addEventListener(ev, (e) => {
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
            }
        });
    });
    document.body.addEventListener('drop', (e) => {
        if (e.target === dropzone || dropzone.contains(e.target)) return;
        if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        loadFile(e.dataTransfer.files[0]);
    });

    // タブ切替 (タブ-ペアを data-pane で対応付け)
    const allTabs = document.querySelectorAll('.tabs .tab');
    const allPanes = document.querySelectorAll('.tab-panes .tab-pane');
    function activateTab(tabEl) {
        const paneId = tabEl.dataset.pane;
        allTabs.forEach(t => t.classList.toggle('active', t === tabEl));
        allPanes.forEach(p => p.classList.toggle('active', p.id === paneId));
        if (paneId === 'panePlot') plot.resize();
    }
    allTabs.forEach(t => t.addEventListener('click', () => activateTab(t)));

    btnCopyOut.addEventListener('click', onCopyOutput);

    // スプリッタ (左右ペイン サイズ調整)
    initSplitter();

    // Canvas リサイズ追従
    new ResizeObserver(() => plot.resize()).observe(canvas);

    // ---- ファイル読み込み ----
    function onSelectFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';
        input.addEventListener('change', () => {
            if (input.files && input.files.length > 0) loadFile(input.files[0]);
        });
        input.click();
    }

    function onDrop(e) {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return;
        loadFile(files[files.length - 1]);
    }

    async function loadFile(file) {
        try {
            const text = await G.readFileSmart(file);
            const rows = G.parseAndConvert(text);
            _rows = rows;
            _rawText = text;
            _inputFileName = file.name;
            _editedZ = new Set();
            _selectedIndex = -1;
            _outputHandle = null;

            populateGrid();
            populateRawText();
            populateOutputText();
            updateGridHeader();
            updatePlotTabTitle();

            _suggestedName = G.suggestOutputName(file.name);
            plot.setData(_rows);

            updateExportButtonState();
            updateEditButtonStates();

            setStatus(`読み込み完了: ${file.name} (${rows.length} 点) — 出力ファイル名を確認し「GL.csv を保存」を押してください`);
        } catch (err) {
            console.error(err);
            alert(`${file && file.name}\n${err && err.message || err}`);
            setStatus(`読み込みエラー: ${err && err.message || err}`);
        }
    }

    function onClear() {
        _rows = [];
        _rawText = '';
        _inputFileName = null;
        _editedZ = new Set();
        _selectedIndex = -1;
        _outputHandle = null;
        gridBody.innerHTML = '';
        rawText.value = '';
        outText.value = '';
        outInfo.textContent = 'プレビュー';
        btnCopyOut.disabled = true;
        _suggestedName = '';
        gridHeader.textContent = '読み込み待ち';
        tabPlotText.textContent = '配置図 (P 杭)';
        plot.setData([]);
        updateExportButtonState();
        updateEditButtonStates();
        setStatus('クリアしました');
    }

    function populateRawText() {
        rawText.value = (_rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function populateOutputText() {
        const csv = G.buildCsv(_rows);
        outText.value = csv;
        const lineCount = _rows.length;
        const bytes = new Blob([csv]).size;
        outInfo.textContent = lineCount > 0
            ? `プレビュー — ${lineCount} 行  /  ${bytes.toLocaleString()} bytes`
            : 'プレビュー';
        btnCopyOut.disabled = lineCount === 0;
    }

    async function onCopyOutput() {
        const text = outText.value;
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setStatus(`出力 CSV をクリップボードにコピーしました (${_rows.length} 行)`);
        } catch (err) {
            // フォールバック: textarea 選択 + execCommand
            outText.focus();
            outText.select();
            try {
                document.execCommand('copy');
                setStatus(`出力 CSV をクリップボードにコピーしました (${_rows.length} 行)`);
            } catch (_) {
                alert('クリップボードへのコピーに失敗しました:\n' + (err && err.message || err));
            }
        }
    }

    function updateGridHeader() {
        const name = _inputFileName || '';
        const lineCount = (_rawText || '').split('\n').length;
        gridHeader.textContent = name
            ? `読み込んだCSV — ${name}  /  ${lineCount} 行  /  ${_rows.length} 点`
            : '読み込み待ち';
    }

    function updatePlotTabTitle() {
        const pRows = _rows.filter(r => G.startsWith(r.name, 'P'));
        const zLevels = new Set(pRows.map(r => Math.round(r.outZ * 1e6) / 1e6)).size;
        tabPlotText.textContent = pRows.length > 0
            ? `配置図 (P 杭 ${pRows.length} 本 / ${zLevels} レベル)`
            : '配置図 (P 杭)';
    }

    // ---- グリッド ----
    function populateGrid() {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < _rows.length; i++) {
            frag.appendChild(buildRow(i, _rows[i]));
        }
        gridBody.innerHTML = '';
        gridBody.appendChild(frag);
    }

    function buildRow(index, p) {
        const tr = document.createElement('tr');
        tr.dataset.index = String(index);
        tr.addEventListener('click', () => selectRow(index));

        const isP = G.startsWith(p.name, 'P');

        tr.appendChild(td('col-name', p.name));
        tr.appendChild(td('col-num', G.fmt(p.inY)));
        tr.appendChild(td('col-num', G.fmt(p.inX)));

        // Z セル (P 杭のみ編集可能)
        const zCell = document.createElement('td');
        zCell.className = 'col-num';
        applyInZCell(zCell, p, isP, index);
        tr.appendChild(zCell);

        tr.appendChild(td('col-num cell-out', G.fmt(p.outX)));
        tr.appendChild(td('col-num cell-out', G.fmt(p.outY)));

        const outZ = td('col-num cell-out', G.fmt(p.outZ));
        if (_editedZ.has(index)) outZ.classList.add('cell-out-z-edited');
        tr.appendChild(outZ);

        return tr;
    }

    function td(className, value) {
        const c = document.createElement('td');
        c.className = className;
        c.textContent = value;
        return c;
    }

    function applyInZCell(cell, p, isP, index) {
        cell.classList.remove('cell-z-empty', 'cell-z-editable');
        cell.removeAttribute('contenteditable');
        cell.removeAttribute('title');

        if (p.inZ == null) {
            cell.textContent = '(空→0)';
            cell.classList.add('cell-z-empty');
        } else {
            cell.textContent = G.fmt(p.inZ);
            if (isP) cell.classList.add('cell-z-editable');
        }

        if (isP) {
            cell.title = 'ダブルクリックで mm 単位で編集';
            cell.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startEditZCell(cell, index);
            });
        } else {
            cell.title = 'P 杭以外は編集できません';
        }
    }

    function startEditZCell(cell, index) {
        const p = _rows[index];
        const original = (p.inZ != null) ? String(p.inZ) : '';
        cell.textContent = original;
        cell.setAttribute('contenteditable', 'true');
        cell.focus();
        // テキスト選択
        const range = document.createRange();
        range.selectNodeContents(cell);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const commit = () => {
            cell.removeEventListener('blur', commit);
            cell.removeEventListener('keydown', onKey);
            const raw = cell.textContent.trim();
            cell.removeAttribute('contenteditable');

            let newZ;
            if (raw.length === 0) {
                newZ = 0;
            } else {
                const v = parseFloat(raw);
                if (!isFinite(v) || !/^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?$/.test(raw)) {
                    alert(`無効な数値です: ${raw}`);
                    refreshRow(index);
                    return;
                }
                newZ = v;
            }
            const oldZ = (p.inZ != null) ? p.inZ : 0;
            if (Math.abs(oldZ - newZ) < 1e-9 && p.inZ != null) {
                refreshRow(index);
                return;
            }
            updateRowsZ([index], () => newZ);
            setStatus(`${p.name} の Z を ${G.fmt(newZ)} mm に変更しました`);
        };

        const onKey = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); cell.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); cell.textContent = original; cell.blur(); refreshRow(index); }
        };
        cell.addEventListener('blur', commit);
        cell.addEventListener('keydown', onKey);
    }

    function refreshRow(index) {
        const tr = gridBody.querySelector(`tr[data-index="${index}"]`);
        if (!tr) return;
        const newTr = buildRow(index, _rows[index]);
        if (index === _selectedIndex) newTr.classList.add('selected');
        tr.parentNode.replaceChild(newTr, tr);
    }

    function selectRow(index) {
        if (index < 0 || index >= _rows.length) return;
        _selectedIndex = index;
        const trs = gridBody.querySelectorAll('tr');
        trs.forEach(tr => tr.classList.remove('selected'));
        const target = gridBody.querySelector(`tr[data-index="${index}"]`);
        if (target) {
            target.classList.add('selected');
            // スクロール (グリッド枠内に表示)
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        plot.setSelectedIndex(index);
        updateEditButtonStates();
    }

    // ---- Z 編集 (単一/一括) ----
    async function onEditSelectedZ() {
        if (_selectedIndex < 0 || _selectedIndex >= _rows.length) return;
        const p = _rows[_selectedIndex];
        if (!G.startsWith(p.name, 'P')) {
            alert('P 杭の行を選択してください。');
            return;
        }
        const result = await window.Dialogs.openSingleZEdit(p.name, p.inZ);
        if (result === null) return;
        updateRowsZ([_selectedIndex], () => result);
        setStatus(`${p.name} の Z を ${G.fmt(result)} mm に変更しました`);
    }

    function collectPIndexes() {
        const out = [];
        for (let i = 0; i < _rows.length; i++) {
            if (G.startsWith(_rows[i].name, 'P')) out.push(i);
        }
        return out;
    }

    function getSZmm() {
        const sRow = _rows.find(r => G.isSPoint(r.name));
        return sRow ? (sRow.inZ != null ? sRow.inZ : 0) : null;
    }

    function getPZGroups(pIndexes) {
        const map = new Map();
        for (const i of pIndexes) {
            const z = _rows[i].inZ != null ? _rows[i].inZ : 0;
            const k = Math.round(z * 1e6) / 1e6;
            map.set(k, (map.get(k) || 0) + 1);
        }
        return Array.from(map.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([zmm, count]) => ({ zmm, count }));
    }

    async function onAllEditZ() {
        if (_rows.length === 0) return;
        const pIndexes = collectPIndexes();
        if (pIndexes.length === 0) { alert('P 杭が見つかりません。'); return; }

        const sZmm = getSZmm();
        const pZGroups = getPZGroups(pIndexes);
        const result = await window.Dialogs.openAllPilesEdit(pIndexes.length, sZmm, pZGroups);
        if (result === null) return;

        let compute, desc;
        switch (result.mode) {
            case 'setAll':
                compute = () => result.value;
                desc = `全 ${pIndexes.length} 本の P を Z=${G.fmt(result.value)} mm に設定`;
                break;
            case 'addDelta':
                compute = (idx) => (_rows[idx].inZ != null ? _rows[idx].inZ : 0) + result.value;
                desc = `全 ${pIndexes.length} 本の P に Z+=${G.fmt(result.value)} mm を加算`;
                break;
            case 'subtractS':
                compute = (idx) => (_rows[idx].inZ != null ? _rows[idx].inZ : 0) - result.value;
                desc = `全 ${pIndexes.length} 本の P から S 点 Z (${G.fmt(result.value)} mm) を減算`;
                break;
            case 'shiftByGroup': {
                const delta = result.value - result.sourceZmm;
                compute = (idx) => (_rows[idx].inZ != null ? _rows[idx].inZ : 0) + delta;
                const sign = delta >= 0 ? '+' : '';
                desc = `基準グループ Z=${G.fmt(result.sourceZmm)} → ${G.fmt(result.value)} mm  (差分 ${sign}${G.fmt(delta)} mm を全 ${pIndexes.length} 本に加算)`;
                break;
            }
            default:
                return;
        }

        updateRowsZ(pIndexes, compute);
        setStatus(desc);
    }

    async function onGroupEditZ() {
        if (_rows.length === 0) return;
        const pIndexes = collectPIndexes();
        if (pIndexes.length === 0) { alert('P 杭が見つかりません。'); return; }

        const pZGroups = getPZGroups(pIndexes);
        if (pZGroups.length === 0) { alert('Z 値のグループが見つかりません。'); return; }

        const result = await window.Dialogs.openGroupPilesEdit(pZGroups);
        if (result === null) return;

        const srcKey = Math.round(result.sourceZmm * 1e6) / 1e6;
        const targetIndexes = pIndexes.filter(i => {
            const z = _rows[i].inZ != null ? _rows[i].inZ : 0;
            return (Math.round(z * 1e6) / 1e6) === srcKey;
        });
        if (targetIndexes.length === 0) {
            alert('対象となる P 杭がありません。');
            return;
        }

        let compute, desc;
        if (result.mode === 'setGroup') {
            compute = () => result.value;
            desc = `${targetIndexes.length} 本の P (Z=${G.fmt(result.sourceZmm)} mm) を Z=${G.fmt(result.value)} mm に変更`;
        } else {
            compute = (idx) => (_rows[idx].inZ != null ? _rows[idx].inZ : 0) + result.value;
            desc = `${targetIndexes.length} 本の P (Z=${G.fmt(result.sourceZmm)} mm) に Z+=${G.fmt(result.value)} mm を加算`;
        }

        updateRowsZ(targetIndexes, compute);
        setStatus(desc);
    }

    function updateRowsZ(indexes, compute) {
        for (const idx of indexes) {
            if (idx < 0 || idx >= _rows.length) continue;
            const newZ = compute(idx);
            const r = _rows[idx];
            _rows[idx] = Object.assign({}, r, {
                inZ: newZ,
                outZ: newZ / 1000.0,
            });
            _editedZ.add(idx);
            refreshRow(idx);
        }
        // 選択状態を保持
        if (_selectedIndex >= 0) {
            const tr = gridBody.querySelector(`tr[data-index="${_selectedIndex}"]`);
            if (tr) tr.classList.add('selected');
        }
        plot.setData(_rows);
        plot.setSelectedIndex(_selectedIndex);
        updatePlotTabTitle();
        populateOutputText();
    }

    // ---- 保存関連ヘルパ ----
    function buildOutputBytes() {
        const csvText = G.buildCsv(_rows);
        const encType = encodingSel.value;
        if (encType === 'utf8bom') {
            return {
                bytes: G.encodeUtf8WithBom(csvText),
                mime: 'text/csv;charset=utf-8',
                label: 'UTF-8 BOM',
            };
        }
        // Shift-JIS
        let hasNonAscii = false;
        for (let i = 0; i < csvText.length; i++) {
            const cp = csvText.charCodeAt(i);
            if (cp > 0x7F && !(cp >= 0xFF61 && cp <= 0xFF9F)) {
                hasNonAscii = true;
                break;
            }
        }
        if (hasNonAscii) {
            if (!confirm(
                '出力データに ASCII / 半角カナ以外の文字が含まれています。\n' +
                'Shift-JIS 簡易エンコーダではこれらは "?" に置換されます。\n' +
                '「UTF-8 (BOM 付)」を選び直すことをお勧めします。\n\n' +
                'このまま Shift-JIS で保存しますか？'
            )) return null;
        }
        return {
            bytes: G.encodeShiftJis(csvText),
            mime: 'text/csv;charset=shift_jis',
            label: 'Shift-JIS',
        };
    }

    async function onExport() {
        if (_rows.length === 0) return;

        let name = _suggestedName || 'GL.csv';
        if (!/\.csv$/i.test(name)) name += '.csv';

        const built = buildOutputBytes();
        if (built === null) return;
        const { bytes, mime, label } = built;

        // 1) 既に保存先ハンドル保持中なら、ダイアログなしで同じ場所へ上書き
        if (_outputHandle) {
            try {
                const writable = await _outputHandle.createWritable();
                await writable.write(bytes);
                await writable.close();
                setStatus(`保存しました: ${_outputHandle.name}  (${_rows.length} 点 / ${label})`);
                return;
            } catch (e) {
                console.error(e);
                alert('既存ファイルへの書き込みに失敗しました。再度ダイアログから保存してください。\n' + (e && e.message || e));
                _outputHandle = null;
                // フォールバックに進む
            }
        }

        // 2) File System Access API が使えれば、ネイティブ保存ダイアログを開く
        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: name,
                    types: [{ description: 'CSV files', accept: { 'text/csv': ['.csv'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(bytes);
                await writable.close();
                _outputHandle = handle;
                setStatus(`保存しました: ${handle.name}  (${_rows.length} 点 / ${label})`);
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                console.error(e);
                // 最後の手段にフォールバック
            }
        }

        // 3) フォールバック: 通常のダウンロード (Downloads フォルダへ)
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        setStatus(`ダウンロードしました: ${name}  (${_rows.length} 点 / ${label})`);
    }

    // ---- ボタン状態 ----
    function updateExportButtonState() {
        btnExport.disabled = !(_rows.length > 0);
    }

    function updateEditButtonStates() {
        const hasP = _rows.some(r => G.startsWith(r.name, 'P'));
        btnAllEditZ.disabled = !hasP;
        btnGroupEditZ.disabled = !hasP;
        const selIsP = _selectedIndex >= 0
            && _selectedIndex < _rows.length
            && G.startsWith(_rows[_selectedIndex].name, 'P');
        btnEditSelectedZ.disabled = !selIsP;
    }

    // ---- ステータスバー ----
    function setStatus(msg) {
        statusbar.textContent = msg;
    }

    // ---- スプリッタ ----
    function initSplitter() {
        let dragging = false;
        let startX = 0;
        let leftStart = 0;
        const main = document.querySelector('.main');

        const setCols = (leftPx) => {
            const total = main.clientWidth;
            const minLeft = 320;
            const minRight = 360;
            const splitterW = 6;
            const max = total - splitterW - minRight;
            const l = Math.max(minLeft, Math.min(max, leftPx));
            main.style.gridTemplateColumns = `${l}px ${splitterW}px 1fr`;
        };

        splitter.addEventListener('mousedown', (e) => {
            dragging = true;
            startX = e.clientX;
            // 現在の左ペイン幅
            leftStart = document.querySelector('.panel-grid').getBoundingClientRect().width;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            setCols(leftStart + (e.clientX - startX));
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            plot.resize();
        });
    }

    // 初期表示メッセージ
    setStatus('CSV ファイルを読み込んでください。');
})();
