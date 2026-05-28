/*
 * Z 値編集ダイアログ
 *  - ZSingleEditDialog: 1 つの P 杭の Z (mm) を入力
 *  - ZBulkEditDialog: 一括変更 (SetAll / AddDelta / SubtractSReference / SameZGroup)
 *
 * Promise ベースで結果を返す。
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

    function showModal(contentEl, opts) {
        opts = opts || {};
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

            // 子側に close を提供
            contentEl._close = close;
            // 最初の入力にフォーカス
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

    /**
     * 単一 P 杭の Z (mm) 編集ダイアログ
     * @returns {Promise<number|null>}
     */
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
                        if (v === null) {
                            alert(`無効な数値です: ${txt.value}`);
                            return;
                        }
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

    /**
     * P 杭の Z 一括変更ダイアログ
     * @param {number} pCount
     * @param {number|null} sZmm
     * @param {Array<{zmm:number,count:number}>} pZGroups
     * @returns {Promise<null | {mode:string, value:number, sourceZmm?:number}>}
     */
    async function openBulkZEdit(pCount, sZmm, pZGroups) {
        const summary = el('div', { class: 'dlg-summary' },
            `対象: 全 P 杭 (${pCount} 本)  /  Z レベル: ${pZGroups.length} 種類`);

        const rdSet = el('input', { type: 'radio', name: 'zmode', value: 'setAll', checked: true });
        const rdAdd = el('input', { type: 'radio', name: 'zmode', value: 'addDelta' });
        const rdSubS = el('input', {
            type: 'radio', name: 'zmode', value: 'subtractS',
            disabled: sZmm == null,
        });
        const rdSameZ = el('input', {
            type: 'radio', name: 'zmode', value: 'sameZ',
            disabled: pZGroups.length === 0,
        });

        const subSLabel = sZmm != null
            ? `S 点の Z (=${(sZmm).toString()} mm) を全 P から減算  (Z = Z − S_Z)`
            : 'S 点の Z を全 P から減算  (S 点なしのため無効)';

        const cmbGroup = el('select', { class: 'dlg-input mono', disabled: true });
        for (const g of pZGroups) {
            const opt = el('option', { value: String(g.zmm) },
                `Z = ${String(g.zmm).padStart(12)} mm  (${g.count} 本)`);
            cmbGroup.appendChild(opt);
        }
        if (pZGroups.length > 0) cmbGroup.selectedIndex = 0;

        const lblValue = el('label', { class: 'dlg-label' }, '新しい Z 値 (mm):');
        const txtValue = el('input', { type: 'text', class: 'dlg-input mono', value: '0' });

        function updateEnable() {
            txtValue.disabled = rdSubS.checked;
            cmbGroup.disabled = !rdSameZ.checked;
            lblValue.textContent = rdAdd.checked ? '加算する値 Δ (mm):' : '新しい Z 値 (mm):';
        }
        [rdSet, rdAdd, rdSubS, rdSameZ].forEach(r => r.addEventListener('change', updateEnable));

        const root = el('div', { class: 'dlg-body wide' },
            el('h3', { class: 'dlg-title' }, 'P 杭の Z 一括変更'),
            summary,
            el('div', { class: 'dlg-section' }, '操作モード:'),
            el('label', { class: 'dlg-radio' }, rdSet, ' 全 P の Z を一律に設定する  (Z = 値)'),
            el('label', { class: 'dlg-radio' }, rdAdd, ' 全 P の Z に加算する  (Z = Z + Δ)'),
            el('label', { class: 'dlg-radio' }, rdSubS, ' ' + subSLabel),
            el('label', { class: 'dlg-radio' }, rdSameZ, ' 同じ Z 値のグループだけ変更する'),
            el('div', { class: 'dlg-group' },
                el('span', { class: 'dlg-sublabel' }, '対象 Z:'),
                cmbGroup,
            ),
            el('div', { class: 'dlg-group' },
                lblValue,
                txtValue,
            ),
            el('p', { class: 'dlg-hint' },
                '※「設定」/「同じ Z」モードでは新しい Z 値、「加算」モードでは Δ 値を mm 単位で入力します。'),
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
                        if (rdSameZ.checked) {
                            if (cmbGroup.selectedIndex < 0) {
                                alert('対象 Z を選択してください。');
                                return;
                            }
                            const v = tryParse(txtValue.value);
                            if (v === null) { alert(`無効な数値です: ${txtValue.value}`); return; }
                            const srcZ = parseFloat(cmbGroup.value);
                            root._close({ mode: 'sameZ', value: v, sourceZmm: srcZ });
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

    global.Dialogs = { openSingleZEdit, openBulkZEdit };
})(window);
