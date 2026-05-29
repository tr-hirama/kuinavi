/*
 * 各種編集ダイアログ
 *  - openSingleZEdit       : 単一 P / BM の Z (mm) を入力
 *  - openAllPilesEdit      : 全 P 杭への一括変更 (ShiftByGroup / Set / AddDelta / SubtractS)
 *  - openGroupPilesEdit    : 同じ Z 値の P 杭群に対する変更 (Set / AddDelta)
 *  - openCoordTransformDialog: 選択点を基準に全点を平行移動
 *
 * Promise ベースで結果を返す。キャンセル時は null。
 */
(function (global) {
    'use strict';

    function el(tag, attrs, ...children) {
        const e = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'class') e.className = v;
                else if (k === 'style') e.setAttribute('style', v);
                else if (k.startsWith('on') && typeof v === 'function') {
                    e.addEventListener(k.substring(2).toLowerCase(), v);
                } else if (k in e) {
                    e[k] = v;
                } else {
                    e.setAttribute(k, v);
                }
            }
        }
        for (const c of children) {
            if (c == null) continue;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return e;
    }

    function showModal(contentEl) {
        return new Promise((resolve) => {
            const backdrop = el('div', { class: 'modal-backdrop' });
            const dlg = el('div', { class: 'modal-dialog' }, contentEl);
            backdrop.appendChild(dlg);
            document.body.appendChild(backdrop);

            function close(result) {
                document.body.removeChild(backdrop);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }

            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); close(null); }
            }
            document.addEventListener('keydown', onKey);
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) close(null);
            });

            contentEl._close = close;
            requestAnimationFrame(() => {
                const focusEl = contentEl.querySelector('input, select, button');
                if (focusEl) focusEl.focus();
                if (focusEl && focusEl.tagName === 'INPUT' && focusEl.type === 'text') focusEl.select();
            });
        });
    }

    function tryParse(s) {
        if (s == null) return null;
        const t = String(s).trim();
        if (t.length === 0) return null;
        if (!/^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?$/.test(t)) return null;
        const v = parseFloat(t);
        return isFinite(v) ? v : null;
    }

    /* =====================================================
     * 単一 P 杭の Z (mm) 編集
     * @returns {Promise<number|null>}
     * ===================================================== */
    async function openSingleZEdit(pointName, currentZmm) {
        const txt = el('input', {
            type: 'text',
            class: 'dlg-input mono',
            value: (currentZmm != null ? currentZmm : 0).toString(),
        });

        const root = el('div', { class: 'dlg-body' },
            el('h3', { class: 'dlg-title' }, `${pointName} の Z (mm) を編集`),
            el('p', { class: 'dlg-desc' },
                `${pointName} の杭頭レベル Z を mm 単位で入力してください。`),
            txt,
            el('div', { class: 'dlg-buttons' },
                el('button', {
                    type: 'button', class: 'btn',
                    onclick: () => root._close(null),
                }, 'キャンセル'),
                el('button', {
                    type: 'button', class: 'btn btn-primary',
                    onclick: () => {
                        const v = tryParse(txt.value);
                        if (v === null) { alert(`無効な数値です: ${txt.value}`); return; }
                        root._close(v);
                    },
                }, 'OK'),
            ),
        );

        txt.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const v = tryParse(txt.value);
                if (v === null) { alert(`無効な数値です: ${txt.value}`); return; }
                root._close(v);
            }
        });

        return await showModal(root);
    }

    /* =====================================================
     * 全 P 杭への一括変更 (Set / AddDelta / SubtractS / ShiftByGroup)
     * @param {number} pCount
     * @param {number|null} sZmm
     * @param {Array<{zmm:number,count:number}>} pZGroups
     * @param {number|null} defaultZmm  基準グループの既定値 (通常は選択中 P の Z)
     * @returns {Promise<null | {mode:'setAll'|'addDelta'|'subtractS'|'shiftByGroup', value:number, sourceZmm?:number}>}
     * ===================================================== */
    async function openAllPilesEdit(pCount, sZmm, pZGroups, defaultZmm) {
        pZGroups = pZGroups || [];

        // shiftByGroup を既定モードに (グループが存在する場合)
        const canShift = pZGroups.length > 0;
        const rdShift = el('input', {
            type: 'radio', name: 'allmode', value: 'shiftByGroup',
            disabled: !canShift,
            checked: canShift,
        });
        const rdSet = el('input', {
            type: 'radio', name: 'allmode', value: 'setAll',
            checked: !canShift,
        });
        const rdAdd = el('input', { type: 'radio', name: 'allmode', value: 'addDelta' });
        const rdSubS = el('input', {
            type: 'radio', name: 'allmode', value: 'subtractS',
            disabled: sZmm == null,
        });

        const subSLabel = sZmm != null
            ? `S 点の Z (=${sZmm} mm) を全 P から減算  (Z = Z − S_Z)`
            : 'S 点の Z を全 P から減算  (S 点なしのため無効)';

        const cmbGroup = el('select', { class: 'dlg-input mono', disabled: true });
        const defaultKey = defaultZmm != null
            ? Math.round(defaultZmm * 1e6) / 1e6
            : null;
        let defaultIdx = 0;
        for (let i = 0; i < pZGroups.length; i++) {
            const g = pZGroups[i];
            const opt = el('option', { value: String(g.zmm) },
                `Z = ${String(g.zmm).padStart(12)} mm  (${g.count} 本)`);
            cmbGroup.appendChild(opt);
            if (defaultKey !== null && Math.round(g.zmm * 1e6) / 1e6 === defaultKey) {
                defaultIdx = i;
            }
        }
        if (pZGroups.length > 0) cmbGroup.selectedIndex = defaultIdx;
        const lblGroup = el('span', { class: 'dlg-sublabel' }, '基準グループ:');

        const lblValue = el('label', { class: 'dlg-label' }, '新しい Z 値 (mm):');
        const txtValue = el('input', { type: 'text', class: 'dlg-input mono', value: '0' });

        // 計算プレビュー (ShiftByGroup モードのみ)
        const previewBox = el('div', { class: 'dlg-preview' });
        function updatePreview() {
            if (!rdShift.checked) { previewBox.textContent = ''; return; }
            const srcZ = parseFloat(cmbGroup.value);
            const tgtZ = tryParse(txtValue.value);
            if (!isFinite(srcZ) || tgtZ === null) {
                previewBox.textContent = '差分 Δ: —';
                return;
            }
            const delta = tgtZ - srcZ;
            const sign = delta >= 0 ? '+' : '';
            previewBox.textContent = `差分 Δ = ${tgtZ} − ${srcZ} = ${sign}${delta} mm  → 全 ${pCount} 本に加算`;
        }

        function updateEnable() {
            txtValue.disabled = rdSubS.checked;
            cmbGroup.disabled = !rdShift.checked;
            lblValue.textContent = rdAdd.checked
                ? '加算する値 Δ (mm):'
                : (rdShift.checked ? '基準グループの目標 Z (mm):' : '新しい Z 値 (mm):');
            updatePreview();
        }
        [rdSet, rdAdd, rdSubS, rdShift].forEach(r => r.addEventListener('change', updateEnable));
        cmbGroup.addEventListener('change', updatePreview);
        txtValue.addEventListener('input', updatePreview);

        const root = el('div', { class: 'dlg-body wide' },
            el('h3', { class: 'dlg-title' }, 'P 杭の Z — 全本変更'),
            el('div', { class: 'dlg-summary' },
                `対象: 全 P 杭 (${pCount} 本)`),
            el('div', { class: 'dlg-section' }, '操作モード'),
            el('label', { class: 'dlg-radio' }, rdShift,
                ' あるグループの Z を目標値に合わせて、その差を全本に適用'),
            el('div', { class: 'dlg-group' }, lblGroup, cmbGroup),
            el('label', { class: 'dlg-radio' }, rdSet, ' 全 P の Z を一律に設定する  (Z = 値)'),
            el('label', { class: 'dlg-radio' }, rdAdd, ' 全 P の Z に加算する  (Z = Z + Δ)'),
            el('label', { class: 'dlg-radio' }, rdSubS, ' ' + subSLabel),
            el('div', { class: 'dlg-group' }, lblValue, txtValue),
            previewBox,
            el('p', { class: 'dlg-hint' },
                '※「グループ基準シフト」=基準グループの目標値を入力 / 「設定」=新しい Z 値 / 「加算」=Δ を mm 単位で入力します。'),
            el('div', { class: 'dlg-buttons' },
                el('button', { type: 'button', class: 'btn', onclick: () => root._close(null) }, 'キャンセル'),
                el('button', {
                    type: 'button', class: 'btn btn-primary',
                    onclick: () => {
                        if (rdSubS.checked) {
                            if (sZmm == null) {
                                alert('S 点がないため、このモードは選択できません。');
                                return;
                            }
                            root._close({ mode: 'subtractS', value: sZmm });
                            return;
                        }
                        if (rdShift.checked) {
                            if (cmbGroup.selectedIndex < 0) {
                                alert('基準グループを選択してください。');
                                return;
                            }
                            const tgt = tryParse(txtValue.value);
                            if (tgt === null) { alert(`無効な数値です: ${txtValue.value}`); return; }
                            const srcZ = parseFloat(cmbGroup.value);
                            root._close({ mode: 'shiftByGroup', value: tgt, sourceZmm: srcZ });
                            return;
                        }
                        const v = tryParse(txtValue.value);
                        if (v === null) { alert(`無効な数値です: ${txtValue.value}`); return; }
                        root._close({ mode: rdSet.checked ? 'setAll' : 'addDelta', value: v });
                    },
                }, 'OK'),
            ),
        );

        updateEnable();
        return await showModal(root);
    }

    /* =====================================================
     * 同じ Z 値の P 杭グループに対する変更 (Set / AddDelta)
     * @param {Array<{zmm:number,count:number}>} pZGroups
     * @param {number|null} defaultZmm  既定で選択する Z 値 (mm) — 通常は選択中 P の Z
     * @returns {Promise<null | {mode:'setGroup'|'addGroup', value:number, sourceZmm:number}>}
     * ===================================================== */
    async function openGroupPilesEdit(pZGroups, defaultZmm) {
        const cmbGroup = el('select', { class: 'dlg-input mono' });
        const defaultKey = defaultZmm != null
            ? Math.round(defaultZmm * 1e6) / 1e6
            : null;
        let defaultIdx = 0;
        for (let i = 0; i < pZGroups.length; i++) {
            const g = pZGroups[i];
            const opt = el('option', { value: String(g.zmm) },
                `Z = ${String(g.zmm).padStart(12)} mm  (${g.count} 本)`);
            cmbGroup.appendChild(opt);
            if (defaultKey !== null && Math.round(g.zmm * 1e6) / 1e6 === defaultKey) {
                defaultIdx = i;
            }
        }
        if (pZGroups.length > 0) cmbGroup.selectedIndex = defaultIdx;

        const rdSet = el('input', { type: 'radio', name: 'grpmode', value: 'setGroup', checked: true });
        const rdAdd = el('input', { type: 'radio', name: 'grpmode', value: 'addGroup' });

        const lblValue = el('label', { class: 'dlg-label' }, '新しい Z 値 (mm):');
        const txtValue = el('input', { type: 'text', class: 'dlg-input mono', value: '0' });

        function updateLabel() {
            lblValue.textContent = rdAdd.checked ? '加算する値 Δ (mm):' : '新しい Z 値 (mm):';
        }
        [rdSet, rdAdd].forEach(r => r.addEventListener('change', updateLabel));

        const root = el('div', { class: 'dlg-body' },
            el('h3', { class: 'dlg-title' }, 'P 杭の Z — グループ変更'),
            el('div', { class: 'dlg-summary' },
                `対象: 同じ Z 値の P 杭群 (${pZGroups.length} グループ)`),
            el('div', { class: 'dlg-section' }, '対象グループ'),
            el('div', { class: 'dlg-group' },
                el('span', { class: 'dlg-sublabel' }, '対象 Z:'),
                cmbGroup,
            ),
            el('div', { class: 'dlg-section' }, '操作モード'),
            el('label', { class: 'dlg-radio' }, rdSet, ' このグループを新しい Z 値に設定  (Z = 値)'),
            el('label', { class: 'dlg-radio' }, rdAdd, ' このグループに加算する  (Z = Z + Δ)'),
            el('div', { class: 'dlg-group' }, lblValue, txtValue),
            el('div', { class: 'dlg-buttons' },
                el('button', { type: 'button', class: 'btn', onclick: () => root._close(null) }, 'キャンセル'),
                el('button', {
                    type: 'button', class: 'btn btn-primary',
                    onclick: () => {
                        if (cmbGroup.selectedIndex < 0) {
                            alert('対象 Z を選択してください。');
                            return;
                        }
                        const v = tryParse(txtValue.value);
                        if (v === null) { alert(`無効な数値です: ${txtValue.value}`); return; }
                        const srcZ = parseFloat(cmbGroup.value);
                        root._close({
                            mode: rdSet.checked ? 'setGroup' : 'addGroup',
                            value: v,
                            sourceZmm: srcZ,
                        });
                    },
                }, 'OK'),
            ),
        );

        updateLabel();
        return await showModal(root);
    }

    /* =====================================================
     * 座標変換: 選択 P の X / Y / Z (m) を表示し、差分を全点に適用
     * @param {string} pointName
     * @param {number} curX, curY, curZ  (m 単位)
     * @returns {Promise<null | {outX:number, outY:number, outZ:number}>}
     * ===================================================== */
    async function openCoordTransformDialog(pointName, curX, curY, curZ) {
        const fmt3 = (v) => Number(v).toFixed(3);
        const txtX = el('input', { type: 'text', class: 'dlg-input mono', value: fmt3(curX) });
        const txtY = el('input', { type: 'text', class: 'dlg-input mono', value: fmt3(curY) });
        const txtZ = el('input', { type: 'text', class: 'dlg-input mono', value: fmt3(curZ) });

        const previewBox = el('div', { class: 'dlg-preview' });
        function updatePreview() {
            const nx = tryParse(txtX.value);
            const ny = tryParse(txtY.value);
            const nz = tryParse(txtZ.value);
            if (nx === null || ny === null || nz === null) {
                previewBox.textContent = '差分 Δ: —';
                return;
            }
            const dx = nx - curX, dy = ny - curY, dz = nz - curZ;
            const s = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
            previewBox.textContent = `ΔX = ${s(dx)} / ΔY = ${s(dy)} / ΔZ = ${s(dz)} m  → 全点に加算`;
        }
        [txtX, txtY, txtZ].forEach(t => t.addEventListener('input', updatePreview));

        const root = el('div', { class: 'dlg-body wide' },
            el('h3', { class: 'dlg-title' }, `座標変換 — 基準点 ${pointName}`),
            el('div', { class: 'dlg-summary' },
                `${pointName} の現在座標を表示しています。値を変更すると差分が全点 (P / K / H / S) に加算されます。`),
            el('div', { class: 'dlg-section' }, '新しい座標 (m)'),
            el('div', { class: 'dlg-group' }, el('label', { class: 'dlg-label' }, 'X (m):'), txtX),
            el('div', { class: 'dlg-group' }, el('label', { class: 'dlg-label' }, 'Y (m):'), txtY),
            el('div', { class: 'dlg-group' }, el('label', { class: 'dlg-label' }, 'Z (m):'), txtZ),
            previewBox,
            el('p', { class: 'dlg-hint' },
                '※ 各座標の差分 (新 − 旧) を計算し、すべての点 (P / K / H / S) に加算します。'),
            el('div', { class: 'dlg-buttons' },
                el('button', { type: 'button', class: 'btn', onclick: () => root._close(null) }, 'キャンセル'),
                el('button', {
                    type: 'button', class: 'btn btn-primary',
                    onclick: () => {
                        const nx = tryParse(txtX.value);
                        const ny = tryParse(txtY.value);
                        const nz = tryParse(txtZ.value);
                        if (nx === null) { alert(`X が無効です: ${txtX.value}`); return; }
                        if (ny === null) { alert(`Y が無効です: ${txtY.value}`); return; }
                        if (nz === null) { alert(`Z が無効です: ${txtZ.value}`); return; }
                        root._close({ outX: nx, outY: ny, outZ: nz });
                    },
                }, 'OK'),
            ),
        );

        updatePreview();
        return await showModal(root);
    }

    global.Dialogs = {
        openSingleZEdit,
        openAllPilesEdit,
        openGroupPilesEdit,
        openCoordTransformDialog,
    };
})(window);
