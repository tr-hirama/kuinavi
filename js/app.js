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

    // アプリのバージョン (ツールバーバッジとヘルプモーダルで表示)
    const APP_VERSION = 'v0.0';

    // ---- DOM 参照 ----
    const dropzone = $('dropzone');
    const btnSelect = $('btnSelect');
    const btnClear = $('btnClear');
    const btnExport = $('btnExport');
    const btnEditSelectedZ = $('btnEditSelectedZ');
    const btnGroupEditZ = $('btnGroupEditZ');
    const btnAllEditZ = $('btnAllEditZ');
    const btnCoordTransform = $('btnCoordTransform');
    const btnHelp = $('btnHelp');
    const btnUndo = $('btnUndo');
    const btnRedo = $('btnRedo');
    const inputDesignGL = $('inputDesignGL');
    const btnApplyDesignGL = $('btnApplyDesignGL');
    const designGLResult = $('designGLResult');
    const encodingSel = $('encoding');
    const gridHeader = $('gridHeader');
    const gridBody = $('gridBody');
    const outText = $('outText');
    const outInfo = $('outInfo');
    const btnCopyOut = $('btnCopyOut');
    const tabPlot = $('tabPlot');
    const tabOut = $('tabOut');
    const tabPlotText = $('tabPlotText');
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
    let _paletteIdx = 0;            // 次に割り当てるパレット index

    // ---- Undo / Redo 履歴 ----
    let _undoStack = [];
    let _redoStack = [];
    const MAX_UNDO = 50;

    // P 杭の Z 値ごとの色パレット (本数の多い順に割当)
    //   #1 水色 / #2 薄緑 / #3 朱色 / 以降 黄土・紫・ティール・ピンク・ブラウン
    const PALETTE = [
        '#5DADE2',  // 水色 (最多)
        '#A8D86A',  // 薄緑 (次点)
        '#E74C3C',  // 朱色 (3 番目)
        '#B48232',  // 黄土
        '#965AB4',  // 紫
        '#32AAAA',  // ティール
        '#DC5082',  // ピンク
        '#786450',  // ブラウン
    ];

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
    btnCoordTransform.addEventListener('click', onCoordTransform);
    btnHelp.addEventListener('click', openHelp);
    btnUndo.addEventListener('click', onUndo);
    btnRedo.addEventListener('click', onRedo);

    // 設計GL → BM Z 設定
    inputDesignGL.addEventListener('input', updateDesignGLPreview);
    inputDesignGL.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyDesignGL(); }
    });
    // blur 時に入力値を符号付きフォーマット (+200 / ±0 / -200) に整形
    inputDesignGL.addEventListener('blur', () => {
        const v = parseDesignGLInput(inputDesignGL.value);
        if (v !== null) {
            inputDesignGL.value = formatDesignGLDisplay(v);
            updateDesignGLPreview();
        }
    });
    btnApplyDesignGL.addEventListener('click', applyDesignGL);

    // キーボードショートカット: Ctrl+Z (undo) / Ctrl+Y / Ctrl+Shift+Z (redo)
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const active = document.activeElement;
        if (active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable
        )) return; // テキスト編集中はネイティブ undo を優先
        const k = (e.key || '').toLowerCase();
        if (k === 'z' && !e.shiftKey) {
            e.preventDefault();
            onUndo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
            e.preventDefault();
            onRedo();
        }
    });

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
            _paletteIdx = 0;
            // 設計GL の初期値: S 点の Z 値があればそれをセット (BM の基準値として)
            inputDesignGL.value = defaultDesignGLFromS();
            assignInitialColors();
            clearUndoHistory();  // 新規ファイル読込で履歴リセット

            populateGrid();
            populateRawText();
            populateOutputText();
            updateGridHeader();
            updatePlotTabTitle();

            _suggestedName = G.suggestOutputName(file.name);
            plot.setData(_rows);

            updateExportButtonState();
            updateEditButtonStates();

            const designGLNote = inputDesignGL.value
                ? ` / 設計GL 初期値: BM[${inputDesignGL.value}] mm (S 点の Z 値)`
                : '';
            setStatus(`読み込み完了: ${file.name} (${rows.length} 点)${designGLNote}`);
        } catch (err) {
            console.error(err);
            alert(`${file && file.name}\n${err && err.message || err}`);
            setStatus(`読み込みエラー: ${err && err.message || err}`);
        }
    }

    function onClear() {
        if (_rows.length > 0) pushUndo();  // データがあれば取消可能に
        _rows = [];
        _rawText = '';
        _inputFileName = null;
        _editedZ = new Set();
        _selectedIndex = -1;
        _outputHandle = null;
        _paletteIdx = 0;
        inputDesignGL.value = '';
        gridBody.innerHTML = '';
        outText.value = '';
        outInfo.textContent = 'プレビュー';
        btnCopyOut.disabled = true;
        _suggestedName = '';
        gridHeader.textContent = '読み込んだ CSV — 読み込み待ち';
        tabPlotText.textContent = '配置図 (P 杭)';
        plot.setData([]);
        updateExportButtonState();
        updateEditButtonStates();
        setStatus('クリアしました');
    }

    // 生データ表示タブは廃止 (グリッドが「読み込んだ CSV」を表示)
    function populateRawText() { /* no-op */ }

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
        gridHeader.textContent = name
            ? `読み込んだ CSV — ${name}  /  ${_rows.length} 点`
            : '読み込んだ CSV — 読み込み待ち';
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

        const isEditable = G.isEditableZPoint(p.name);

        tr.appendChild(td('col-name', p.name));
        tr.appendChild(td('col-num', G.fmt(p.inY)));
        tr.appendChild(td('col-num', G.fmt(p.inX)));

        // Z セル (P 杭 / BM 水準点のみ編集可能)
        const zCell = document.createElement('td');
        zCell.className = 'col-num';
        applyInZCell(zCell, p, isEditable, index);
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

    function applyInZCell(cell, p, isEditable, index) {
        cell.classList.remove('cell-z-empty', 'cell-z-editable');
        cell.removeAttribute('contenteditable');
        cell.removeAttribute('title');

        if (p.inZ == null) {
            cell.textContent = '(空→0)';
            cell.classList.add('cell-z-empty');
        } else {
            cell.textContent = G.fmt(p.inZ);
            if (isEditable) cell.classList.add('cell-z-editable');
        }

        if (isEditable) {
            cell.title = 'ダブルクリックで mm 単位で編集';
            cell.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startEditZCell(cell, index);
            });
        } else {
            cell.title = 'P 杭 / BM 水準点以外は編集できません';
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
            pushUndo();
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
        if (!G.isEditableZPoint(p.name)) {
            alert('P 杭または BM 水準点の行を選択してください。');
            return;
        }
        const result = await window.Dialogs.openSingleZEdit(p.name, p.inZ);
        if (result === null) return;
        pushUndo();
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

        // 現在選択中の P があれば、そのグループを基準グループの既定値に
        let defaultZmm = null;
        if (_selectedIndex >= 0 && _selectedIndex < _rows.length) {
            const sel = _rows[_selectedIndex];
            if (G.startsWith(sel.name, 'P')) {
                defaultZmm = sel.inZ != null ? sel.inZ : 0;
            }
        }

        const result = await window.Dialogs.openAllPilesEdit(pIndexes.length, sZmm, pZGroups, defaultZmm);
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

        pushUndo();
        updateRowsZ(pIndexes, compute, { preserveColor: true });
        setStatus(desc);
    }

    // ---- 座標変換 (選択 P / BM 基準で全点シフト) ----
    async function onCoordTransform() {
        if (_selectedIndex < 0 || _selectedIndex >= _rows.length) return;
        const p = _rows[_selectedIndex];
        if (!G.isEditableZPoint(p.name)) {
            alert('P 杭または BM 水準点の行を選択してください。');
            return;
        }
        const result = await window.Dialogs.openCoordTransformDialog(p.name, p.outX, p.outY, p.outZ);
        if (result === null) return;

        const dx = result.outX - p.outX;
        const dy = result.outY - p.outY;
        const dz = result.outZ - p.outZ;

        if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && Math.abs(dz) < 1e-9) {
            setStatus('変化なし: 座標は変更されませんでした');
            return;
        }

        pushUndo();
        shiftAllCoords(dx, dy, dz);

        const sign = (v) => (v >= 0 ? '+' : '');
        setStatus(
            `座標変換: 基準 ${p.name}  ` +
            `ΔX=${sign(dx)}${G.fmt(dx)} / ` +
            `ΔY=${sign(dy)}${G.fmt(dy)} / ` +
            `ΔZ=${sign(dz)}${G.fmt(dz)} m を全 ${_rows.length} 点に適用`
        );
    }

    /**
     * 全点の出力 (X, Y, Z) に同じ delta を加算する。
     * 入力 (inX, inY, inZ mm) も整合性を保つよう連動更新する。
     * 色は保持 (全点が同じ方向に平行移動するため意味的に変わらない)。
     */
    function shiftAllCoords(dx, dy, dz) {
        const dxMm = dx * 1000.0;
        const dyMm = dy * 1000.0;
        const dzMm = dz * 1000.0;
        for (let i = 0; i < _rows.length; i++) {
            const r = _rows[i];
            const newInZ = (r.inZ != null) ? (r.inZ + dzMm) : null;
            _rows[i] = Object.assign({}, r, {
                inX: r.inX + dxMm,
                inY: r.inY + dyMm,
                inZ: newInZ,
                outX: r.outX + dx,
                outY: r.outY + dy,
                outZ: r.outZ + dz,
            });
            refreshRow(i);
        }
        // 選択ハイライトを保持
        if (_selectedIndex >= 0) {
            const tr = gridBody.querySelector(`tr[data-index="${_selectedIndex}"]`);
            if (tr) tr.classList.add('selected');
        }
        plot.setData(_rows);
        plot.setSelectedIndex(_selectedIndex);
        updatePlotTabTitle();
        populateOutputText();
    }

    async function onGroupEditZ() {
        if (_rows.length === 0) return;
        const pIndexes = collectPIndexes();
        if (pIndexes.length === 0) { alert('P 杭が見つかりません。'); return; }

        const pZGroups = getPZGroups(pIndexes);
        if (pZGroups.length === 0) { alert('Z 値のグループが見つかりません。'); return; }

        // 現在選択中の P があれば、そのグループを既定値に
        let defaultZmm = null;
        if (_selectedIndex >= 0 && _selectedIndex < _rows.length) {
            const sel = _rows[_selectedIndex];
            if (G.startsWith(sel.name, 'P')) {
                defaultZmm = sel.inZ != null ? sel.inZ : 0;
            }
        }

        const result = await window.Dialogs.openGroupPilesEdit(pZGroups, defaultZmm);
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

        pushUndo();
        updateRowsZ(targetIndexes, compute);
        setStatus(desc);
    }

    // ---- 色の割り当て ----
    function nextPaletteColor() {
        const c = PALETTE[_paletteIdx % PALETTE.length];
        _paletteIdx++;
        return c;
    }

    // 読込直後: P 杭の各 Z グループに「本数の多い順」でパレット色を割り当て
    //   同数の場合は Z 値が小さい方を優先
    function assignInitialColors() {
        const groups = new Map();  // Z(mm) rounded → { count, z }
        for (const r of _rows) {
            if (!G.startsWith(r.name, 'P')) continue;
            const z = r.inZ != null ? r.inZ : 0;
            const k = Math.round(z * 1e6) / 1e6;
            if (!groups.has(k)) groups.set(k, { count: 0, z });
            groups.get(k).count++;
        }
        // 本数 DESC → Z ASC でソート
        const ordered = Array.from(groups.entries())
            .sort((a, b) => (b[1].count - a[1].count) || (a[1].z - b[1].z));
        const colorByZ = new Map();
        for (const [k] of ordered) {
            colorByZ.set(k, nextPaletteColor());
        }
        for (const r of _rows) {
            if (!G.startsWith(r.name, 'P')) continue;
            const z = r.inZ != null ? r.inZ : 0;
            const k = Math.round(z * 1e6) / 1e6;
            r.color = colorByZ.get(k);
        }
    }

    // 個別/グループ編集時: 変更行の色を決定
    //   - 既存の (未変更の) P 行に同じ新 Z があれば、その色を使う
    //   - なければ次のパレット色を割り当て
    //   - 同一バッチ内で同じ新 Z が複数あれば、それらは同色
    function resolveNewColors(indexes, newZs) {
        const result = new Map();         // idx → color
        const cacheByZ = new Map();       // newZ key → color (バッチ内共有)
        const updatedSet = new Set(indexes);
        for (const idx of indexes) {
            const newZ = newZs.get(idx);
            const k = Math.round(newZ * 1e6) / 1e6;
            if (cacheByZ.has(k)) { result.set(idx, cacheByZ.get(k)); continue; }
            // 未変更の P 行で同じ Z を探す
            let found = null;
            for (let i = 0; i < _rows.length; i++) {
                if (updatedSet.has(i)) continue;
                const r = _rows[i];
                if (!G.startsWith(r.name, 'P')) continue;
                const z = r.inZ != null ? r.inZ : 0;
                if (Math.round(z * 1e6) / 1e6 === k) { found = r.color || null; break; }
            }
            const color = found || nextPaletteColor();
            cacheByZ.set(k, color);
            result.set(idx, color);
        }
        return result;
    }

    function updateRowsZ(indexes, compute, opts) {
        opts = opts || {};
        const preserveColor = !!opts.preserveColor;

        // 新 Z 値を先に計算
        const newZs = new Map();
        for (const idx of indexes) {
            if (idx < 0 || idx >= _rows.length) continue;
            newZs.set(idx, compute(idx));
        }
        // 色を割り当て (preserveColor=true なら何もしない)
        const newColors = preserveColor ? null : resolveNewColors(Array.from(newZs.keys()), newZs);

        for (const idx of newZs.keys()) {
            const newZ = newZs.get(idx);
            const r = _rows[idx];
            const updates = { inZ: newZ, outZ: newZ / 1000.0 };
            if (newColors && G.startsWith(r.name, 'P')) {
                updates.color = newColors.get(idx);
            }
            _rows[idx] = Object.assign({}, r, updates);
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

    // ---- Undo / Redo ----
    function captureState() {
        return {
            rows: _rows.map(r => Object.assign({}, r)),
            editedZ: new Set(_editedZ),
            selectedIndex: _selectedIndex,
            paletteIdx: _paletteIdx,
            suggestedName: _suggestedName,
            outputHandle: _outputHandle,
            inputFileName: _inputFileName,
            rawText: _rawText,
        };
    }

    function applyState(s) {
        _rows = s.rows.map(r => Object.assign({}, r));
        _editedZ = new Set(s.editedZ);
        _selectedIndex = s.selectedIndex;
        _paletteIdx = s.paletteIdx;
        _suggestedName = s.suggestedName;
        _outputHandle = s.outputHandle;
        _inputFileName = s.inputFileName;
        _rawText = s.rawText;

        populateGrid();
        populateRawText();
        populateOutputText();
        updateGridHeader();
        updatePlotTabTitle();
        plot.setData(_rows);
        plot.setSelectedIndex(_selectedIndex);
        // グリッド選択ハイライトを復元
        if (_selectedIndex >= 0) {
            const tr = gridBody.querySelector(`tr[data-index="${_selectedIndex}"]`);
            if (tr) {
                tr.classList.add('selected');
                try { tr.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            }
        }
        updateExportButtonState();
        updateEditButtonStates();
        updateUndoRedoButtons();
    }

    function pushUndo() {
        _undoStack.push(captureState());
        _redoStack = [];
        if (_undoStack.length > MAX_UNDO) _undoStack.shift();
        updateUndoRedoButtons();
    }

    function onUndo() {
        if (_undoStack.length === 0) return;
        _redoStack.push(captureState());
        const prev = _undoStack.pop();
        applyState(prev);
        setStatus(`元に戻しました  (undo: ${_undoStack.length} / redo: ${_redoStack.length})`);
    }

    function onRedo() {
        if (_redoStack.length === 0) return;
        _undoStack.push(captureState());
        const next = _redoStack.pop();
        applyState(next);
        setStatus(`やり直しました  (undo: ${_undoStack.length} / redo: ${_redoStack.length})`);
    }

    function clearUndoHistory() {
        _undoStack = [];
        _redoStack = [];
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        btnUndo.disabled = _undoStack.length === 0;
        btnRedo.disabled = _redoStack.length === 0;
    }

    // ---- ボタン状態 ----
    function updateExportButtonState() {
        btnExport.disabled = !(_rows.length > 0);
    }

    function updateEditButtonStates() {
        const hasP = _rows.some(r => G.startsWith(r.name, 'P'));
        btnAllEditZ.disabled = !hasP;
        btnGroupEditZ.disabled = !hasP;
        // 単一 Z 編集 / 座標変換は P または BM が選択中なら有効
        const selIsEditable = _selectedIndex >= 0
            && _selectedIndex < _rows.length
            && G.isEditableZPoint(_rows[_selectedIndex].name);
        btnEditSelectedZ.disabled = !selIsEditable;
        btnCoordTransform.disabled = !selIsEditable;
        // 設計GL バーは BM が存在するときに有効
        updateDesignGLAvailability();
    }

    // ---- 設計GL → BM Z 値設定 ----
    /**
     * 入力欄表示用の符号付きフォーマット:
     *   v > 0  → "+200"
     *   v == 0 → "±0"
     *   v < 0  → "-200"
     */
    function formatDesignGLDisplay(value) {
        if (!isFinite(value)) return '';
        if (value === 0) return '±0';
        const absStr = Number.isInteger(value)
            ? String(Math.abs(value))
            : Math.abs(value).toString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
        return value > 0 ? `+${absStr}` : `-${absStr}`;
    }

    /**
     * 入力文字列をパース。"+200" / "-200" / "200" / "±0" のいずれも受理。
     * 不正なら null。
     */
    function parseDesignGLInput(raw) {
        if (raw == null) return null;
        let s = String(raw).trim();
        if (s.length === 0) return null;
        if (s.charAt(0) === '±') s = s.substring(1);  // "±0" → "0"
        if (!/^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?$/.test(s)) return null;
        const v = parseFloat(s);
        return isFinite(v) ? v : null;
    }

    /**
     * S 点の Z 値を「設計GL = BM[___]」入力の初期値として取得。
     * S 点が無い、または Z 値が空の場合は空文字を返す。
     */
    function defaultDesignGLFromS() {
        const sRow = _rows.find(r => G.isSPoint(r.name));
        if (!sRow || sRow.inZ == null) return '';
        return formatDesignGLDisplay(sRow.inZ);
    }

    function updateDesignGLAvailability() {
        const hasData = _rows.length > 0;
        // BM の有無に関わらず、データがあれば入力欄・ボタン共に有効化
        inputDesignGL.disabled = !hasData;
        btnApplyDesignGL.disabled = !hasData;
        if (!hasData) {
            designGLResult.textContent = 'CSV を読み込むと有効になります';
        } else {
            updateDesignGLPreview();
        }
    }

    function updateDesignGLPreview() {
        const v = parseDesignGLInput(inputDesignGL.value);
        const hasBM = _rows.some(r => G.isBMPoint(r.name));
        if (v === null) {
            designGLResult.textContent = hasBM
                ? '入力 → 全 BM の Z 値を ‒(入力値) mm に設定'
                : 'BM 水準点なし — 設計GL の参照値として保持されます';
            return;
        }
        const newZ = -v;
        const display = formatDesignGLDisplay(v);
        if (!hasBM) {
            designGLResult.textContent = `BM 水準点なし — 設計GL = BM[${display}] mm として保持 (Z 値設定はスキップ)`;
            return;
        }
        const bmCount = _rows.filter(r => G.isBMPoint(r.name)).length;
        designGLResult.textContent = `→ 全 BM (${bmCount} 点) の Z 値を ${G.fmt(newZ)} mm に設定`;
    }

    function applyDesignGL() {
        const v = parseDesignGLInput(inputDesignGL.value);
        if (v === null) {
            alert('数値を入力してください。');
            inputDesignGL.focus();
            return;
        }
        const newZ = -v;
        const display = formatDesignGLDisplay(v);

        const bmIndexes = [];
        for (let i = 0; i < _rows.length; i++) {
            if (G.isBMPoint(_rows[i].name)) bmIndexes.push(i);
        }
        if (bmIndexes.length === 0) {
            // BM が無くてもエラーにしない — 値はそのまま参照値として残す
            setStatus(`設計GL = BM[${display}] mm を保持 (BM 水準点が無いため Z 値の設定はスキップ)`);
            return;
        }

        pushUndo();
        updateRowsZ(bmIndexes, () => newZ);
        setStatus(`設計GL = BM[${display}] → 全 BM (${bmIndexes.length} 点) の Z を ${G.fmt(newZ)} mm に設定`);
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
            // 現在の左カラム幅
            leftStart = document.querySelector('.col-left').getBoundingClientRect().width;
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

    // ---- ヘルプモーダル ----
    function openHelp() {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        const dlg = document.createElement('div');
        dlg.className = 'modal-dialog help-dialog';
        dlg.innerHTML = HELP_HTML;
        backdrop.appendChild(dlg);
        document.body.appendChild(backdrop);

        function close() {
            document.body.removeChild(backdrop);
            document.removeEventListener('keydown', onKey);
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        dlg.querySelector('[data-close]').addEventListener('click', close);
    }

    const HELP_HTML = `
        <div class="help-header">
            <h2>ハウス杭ナビ変換 — 使い方</h2>
            <span class="help-subtitle">${APP_VERSION} · 簡易マニュアル</span>
        </div>
        <div class="help-body">
            <h3>1. ファイルを読み込む</h3>
            <ul>
                <li>左上のドロップエリアに CSV を<strong>ドラッグ&ドロップ</strong>、または「ファイル選択」ボタン</li>
                <li>入力形式: <code>名前, Y(mm), X(mm), Z(mm)</code></li>
                <li>名前の頭文字で種別判定: <code>P</code>=杭 / <code>BM</code>=水準点 / <code>K</code>=基準点 / <code>H</code>=境界 / <code>S</code>=機器位置</li>
            </ul>

            <h3>2. 配置図の操作</h3>
            <table>
                <thead><tr><th>操作</th><th>動作</th></tr></thead>
                <tbody>
                    <tr><td><span class="kbd">ホイール</span></td><td>カーソル位置を中心にズーム</td></tr>
                    <tr><td><span class="kbd">ドラッグ</span></td><td>パン (掴んで動かす)</td></tr>
                    <tr><td><span class="kbd">クリック</span></td><td>最寄り点を選択 (優先度: P &gt; K &gt; H)</td></tr>
                    <tr><td><span class="kbd">ダブルクリック</span></td><td>ズーム/パンをリセット</td></tr>
                </tbody>
            </table>
            <p>P 杭は本数の多い Z グループから順に <strong>水色 → 薄緑 → 朱色</strong> で色分けされます。</p>

            <h3>3. P 杭の Z 値を編集する</h3>
            <table>
                <thead><tr><th>方法</th><th>用途</th></tr></thead>
                <tbody>
                    <tr><td>グリッドの Z セルを<strong>ダブルクリック</strong></td><td>P / BM の 1 行を素早く編集</td></tr>
                    <tr><td>「選択点の Z 編集」ボタン</td><td>選択中の P / BM をダイアログで編集</td></tr>
                    <tr><td>「グループ変更」ボタン</td><td>同じ Z 値の P 群だけ <em>設定</em> / <em>加算</em></td></tr>
                    <tr><td>「全本変更」ボタン</td><td>全 P 対象 (設定 / 加算 / S 減算 / グループ基準シフト)</td></tr>
                </tbody>
            </table>
            <p><strong>全本変更</strong>「グループ基準シフト」: あるグループを目標値に合わせるための差分を計算し、全 P に適用します。</p>

            <h3>設計GL バー (黄色バー)</h3>
            <p>BM 水準点が含まれているとき、画面上部の <strong style="color:#B45309;">設計GL = BM[___] mm</strong> バーが有効になります。</p>
            <ul>
                <li>数値（mm）を入力し、Enter キーまたは「BM に設定」ボタン</li>
                <li>全 BM の Z 値が <strong>−（入力値）</strong> mm に設定されます</li>
                <li>例: <code>200</code> を入力 → BM の Z = <code>-200</code> mm</li>
                <li>例: <code>-150</code> を入力 → BM の Z = <code>+150</code> mm</li>
            </ul>

            <h3>4. 座標変換 (選択 P 基準で全点シフト)</h3>
            <ol>
                <li>P 杭を選択</li>
                <li>「座標変換」ボタン → 現在の X / Y / Z (m) が表示</li>
                <li>目標値を入力 → OK で差分を全点 (P / K / H / S) に加算</li>
            </ol>
            <p>例: P1 を実測したら本来 <code>(10.500, 12.300, 5.200)</code> m だった → ダイアログに入力 → 全点が同じだけシフト。</p>

            <h3>5. 結果を保存する</h3>
            <ul>
                <li>「GL.csv を保存」ボタン → 初回はネイティブ保存ダイアログ、2 回目以降は同じ場所へ上書き</li>
                <li>エンコーディング: <code>Shift-JIS</code>（既存ツール互換）/ <code>UTF-8 (BOM)</code>（Excel 文字化けなし）</li>
                <li>「出力 CSV」タブで保存前にプレビュー / クリップボードコピー可能</li>
            </ul>
            <p>出力形式: <code>1,10.500,10.300,5.000,</code> のように <strong>P 名前は先頭の P を除去</strong>、行末は <code>,</code> で終わります。並びは P 番号昇順を先頭に、その後 K / H / S が入力順で続きます。</p>

            <h3>取り消し / やり直し (Undo / Redo)</h3>
            <table>
                <thead><tr><th>操作</th><th>ショートカット</th></tr></thead>
                <tbody>
                    <tr><td>元に戻す</td><td><span class="kbd">Ctrl+Z</span> または ↶ ボタン</td></tr>
                    <tr><td>やり直し</td><td><span class="kbd">Ctrl+Y</span> / <span class="kbd">Ctrl+Shift+Z</span> または ↷ ボタン</td></tr>
                </tbody>
            </table>
            <p>Z 編集 / グループ変更 / 全本変更 / 座標変換 / クリアの直前の状態を最大 50 件まで保持します。新規ファイル読込で履歴はリセットされます。</p>

            <h3>その他</h3>
            <ul>
                <li>「クリア」ボタンで全データ削除（Ctrl+Z で復元可能）</li>
                <li>編集された Z セルはグリッド上で<strong>緑色</strong>に強調</li>
                <li>推奨ブラウザ: Chrome / Edge (ネイティブ保存ダイアログ対応)</li>
                <li>詳細マニュアル: <a href="https://github.com/tr-hirama/kuinavi/blob/main/MANUAL.md" target="_blank" rel="noopener">GitHub の MANUAL.md</a></li>
            </ul>
        </div>
        <div class="help-footer">
            <button class="btn btn-primary" data-close>閉じる</button>
        </div>
    `;

    // バージョン表示の初期化 (HTML 内のプレースホルダを上書き)
    const versionEl = $('appVersion');
    if (versionEl) versionEl.textContent = APP_VERSION;

    // 初期表示メッセージ
    setStatus('CSV ファイルを読み込んでください。');
})();
