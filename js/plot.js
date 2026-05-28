/*
 * 配置図 (Plot Panel) 描画
 *  - 原本 MainForm.cs / PlotPanel.cs の描画ロジックを Canvas に移植
 *  - 表示は X / Y を入れ替える: 画面横 = データ Y, 画面縦 = データ X (上が +)
 */
(function (global) {
    'use strict';

    const palette = [
        '#4682DC',  // 青
        '#E66E46',  // オレンジレッド
        '#3CA05A',  // 緑
        '#B48232',  // 黄土
        '#965AB4',  // 紫
        '#32AAAA',  // ティール
        '#DC5082',  // ピンク
        '#786450',  // ブラウン
    ];

    function darken(hex, factor) {
        factor = factor == null ? 0.55 : factor;
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        const dr = Math.max(0, Math.min(255, Math.floor(r * factor)));
        const dg = Math.max(0, Math.min(255, Math.floor(g * factor)));
        const db = Math.max(0, Math.min(255, Math.floor(b * factor)));
        return `rgb(${dr},${dg},${db})`;
    }

    function keyZ(z) { return Math.round(z * 1e6) / 1e6; }

    /**
     * Canvas プロット描画クラス
     */
    class PlotPanel {
        constructor(canvas) {
            this.canvas = canvas;
            this.rows = [];
            this.selectedIndex = -1;
            this._transform = null;
            this._onSelect = null;

            this.canvas.addEventListener('click', (e) => this._onClick(e));
        }

        setData(rows) {
            this.rows = rows || [];
            this.draw();
        }

        setSelectedIndex(idx) {
            this.selectedIndex = idx;
            this.draw();
        }

        onSelect(cb) { this._onSelect = cb; }

        resize() { this.draw(); }

        draw() {
            const canvas = this.canvas;
            const dpr = window.devicePixelRatio || 1;
            const cssW = canvas.clientWidth;
            const cssH = canvas.clientHeight;
            if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
                canvas.width = Math.max(1, Math.floor(cssW * dpr));
                canvas.height = Math.max(1, Math.floor(cssH * dpr));
            }
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cssW, cssH);

            const rows = this.rows;
            if (!rows || rows.length === 0) {
                this._drawCenteredMessage(ctx, cssW, cssH, 'CSV を読み込むと、ここに配置図を表示します');
                return;
            }

            const G = global.GlConverter;
            const bboxRows = rows.filter(r => !G.isSPoint(r.name));
            if (bboxRows.length === 0) {
                this._drawCenteredMessage(ctx, cssW, cssH, '描画対象の点がありません');
                return;
            }

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const r of bboxRows) {
                if (r.outX < minX) minX = r.outX;
                if (r.outX > maxX) maxX = r.outX;
                if (r.outY < minY) minY = r.outY;
                if (r.outY > maxY) maxY = r.outY;
            }
            if (maxX - minX < 0.001) maxX += 0.5;
            if (maxY - minY < 0.001) maxY += 0.5;

            const marginL = 40, marginR = 165, marginT = 25, marginB = 30;
            const availW = cssW - marginL - marginR;
            const availH = cssH - marginT - marginB;
            if (availW < 20 || availH < 20) return;

            const scale = Math.min(availW / (maxY - minY), availH / (maxX - minX));
            const drawnW = (maxY - minY) * scale;
            const drawnH = (maxX - minX) * scale;
            const offX = marginL + (availW - drawnW) / 2;
            const offY = marginT + (availH - drawnH) / 2;

            const toPx = (x, y) => ({
                x: offX + (y - minY) * scale,        // 横位置 = データ Y
                y: offY + (maxX - x) * scale,        // 縦位置 = データ X (上が +)
            });

            this._transform = { minX, maxX, minY, maxY, scale, offX, offY };

            // 描画エリア枠 + グリッド (1 m 単位)
            ctx.strokeStyle = '#dcdcdc';
            ctx.lineWidth = 1;
            ctx.strokeRect(marginL - 4, marginT - 4, availW + 8, availH + 8);

            const ix0 = Math.ceil(minX), ix1 = Math.floor(maxX);
            for (let xi = ix0; xi <= ix1; xi++) {
                const p1 = toPx(xi, minY), p2 = toPx(xi, maxY);
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
            }
            const iy0 = Math.ceil(minY), iy1 = Math.floor(maxY);
            for (let yi = iy0; yi <= iy1; yi++) {
                const p1 = toPx(minX, yi), p2 = toPx(maxX, yi);
                ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
            }

            // 軸ラベル
            ctx.fillStyle = '#808080';
            ctx.font = '10px "Yu Gothic UI", "Yu Gothic", sans-serif';
            ctx.textBaseline = 'top';
            const pBL = toPx(minX, minY);
            const pTL = toPx(maxX, minY);
            const pBR = toPx(minX, maxY);
            ctx.fillText(`Y=${minY.toFixed(2)}`, pBL.x - 18, pBL.y + 4);
            ctx.fillText(`Y=${maxY.toFixed(2)}`, pBR.x - 18, pBR.y + 4);
            ctx.fillText(`X=${minX.toFixed(2)}`, pBL.x - 38, pBL.y - 14);
            ctx.fillText(`X=${maxX.toFixed(2)}`, pTL.x - 38, pTL.y - 14);

            // H 点 (境界 — 緑の小四角 + 折れ線)
            const hRows = rows.filter(r => G.startsWith(r.name, 'H'));
            ctx.strokeStyle = 'rgba(60,160,60,0.78)';
            ctx.lineWidth = 1.2;
            for (const r of hRows) {
                const p = toPx(r.outX, r.outY);
                ctx.strokeRect(p.x - 3, p.y - 3, 6, 6);
            }
            if (hRows.length >= 2) {
                ctx.strokeStyle = 'rgba(60,160,60,0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                const first = toPx(hRows[0].outX, hRows[0].outY);
                ctx.moveTo(first.x, first.y);
                for (let i = 1; i < hRows.length; i++) {
                    const p = toPx(hRows[i].outX, hRows[i].outY);
                    ctx.lineTo(p.x, p.y);
                }
                ctx.closePath();
                ctx.stroke();
            }

            // K 点 (基準点) を番号順にソート
            const kSorted = rows
                .filter(r => G.startsWith(r.name, 'K'))
                .map(r => ({ row: r, num: G.tryParsePointNumber(r.name) }))
                .filter(x => x.num !== null)
                .sort((a, b) => a.num - b.num);

            if (kSorted.length >= 2) {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1.5;
                for (let i = 0; i < kSorted.length - 1; i++) {
                    if (kSorted[i + 1].num - kSorted[i].num === 1) {
                        const p1 = toPx(kSorted[i].row.outX, kSorted[i].row.outY);
                        const p2 = toPx(kSorted[i + 1].row.outX, kSorted[i + 1].row.outY);
                        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                    }
                }
                const first = kSorted[0], last = kSorted[kSorted.length - 1];
                if (first.num !== last.num) {
                    const p1 = toPx(first.row.outX, first.row.outY);
                    const p2 = toPx(last.row.outX, last.row.outY);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                }
            }

            // K 点 (赤い三角形)
            ctx.strokeStyle = '#B22222';
            ctx.fillStyle = '#B22222';
            ctx.lineWidth = 1.5;
            ctx.font = 'bold 11px "Yu Gothic UI", "Yu Gothic", sans-serif';
            for (const r of rows.filter(r => G.startsWith(r.name, 'K'))) {
                const p = toPx(r.outX, r.outY);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y - 7);
                ctx.lineTo(p.x - 6, p.y + 5);
                ctx.lineTo(p.x + 6, p.y + 5);
                ctx.closePath();
                ctx.stroke();
                ctx.fillText(r.name, p.x + 7, p.y - 12);
            }

            // P 点 (Z 値ごとに色分け)
            const pZValues = Array.from(new Set(
                rows.filter(r => G.startsWith(r.name, 'P')).map(r => keyZ(r.outZ))
            )).sort((a, b) => a - b);
            const pColorMap = new Map();
            pZValues.forEach((z, i) => pColorMap.set(z, palette[i % palette.length]));

            ctx.font = 'bold 11px "Yu Gothic UI", "Yu Gothic", sans-serif';
            for (const r of rows.filter(r => G.startsWith(r.name, 'P'))) {
                const p = toPx(r.outX, r.outY);
                const color = pColorMap.get(keyZ(r.outZ)) || '#4169E1';
                const dark = darken(color);
                ctx.fillStyle = color;
                ctx.strokeStyle = dark;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = dark;
                ctx.fillText(r.name, p.x + 6, p.y - 10);
            }

            // 選択行のハイライト
            if (this.selectedIndex >= 0 && this.selectedIndex < rows.length
                && !G.isSPoint(rows[this.selectedIndex].name)) {
                const sel = rows[this.selectedIndex];
                const hp = toPx(sel.outX, sel.outY);
                ctx.strokeStyle = '#FF4500';
                ctx.lineWidth = 2.5;
                ctx.beginPath(); ctx.arc(hp.x, hp.y, 10, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = 'rgba(255,69,0,0.47)';
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(hp.x, hp.y, 14, 0, Math.PI * 2); ctx.stroke();
            }

            // 凡例
            this._drawLegend(ctx, cssW - marginR + 10, marginT, pZValues, pColorMap);

            // 倍率表示
            ctx.fillStyle = '#696969';
            ctx.font = '11px "Yu Gothic UI", "Yu Gothic", sans-serif';
            const info = `範囲: X ${minX.toFixed(2)}~${maxX.toFixed(2)} m / Y ${minY.toFixed(2)}~${maxY.toFixed(2)} m / 1 m ≒ ${scale.toFixed(1)} px`;
            ctx.fillText(info, marginL, cssH - 18);
        }

        _drawCenteredMessage(ctx, w, h, msg) {
            ctx.fillStyle = '#c0c0c0';
            ctx.font = '15px "Yu Gothic UI", "Yu Gothic", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(msg, w / 2, h / 2);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }

        _drawLegend(ctx, x, y, pZValues, pColorMap) {
            ctx.textBaseline = 'top';
            const rowH = 18;
            ctx.fillStyle = '#000';
            ctx.font = 'bold 11px "Yu Gothic UI", "Yu Gothic", sans-serif';
            ctx.fillText('[ P 杭 — Z 別 ]', x - 4, y);
            y += rowH;

            ctx.font = '11.5px "Yu Gothic UI", "Yu Gothic", sans-serif';
            if (pZValues.length === 0) {
                ctx.fillStyle = '#808080';
                ctx.fillText('(なし)', x + 4, y);
                y += rowH;
            } else {
                for (const z of pZValues) {
                    const color = pColorMap.get(z);
                    const dark = darken(color);
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(x + 5, y + 7, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = dark;
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    ctx.fillStyle = '#000';
                    ctx.fillText(`Z = ${z.toFixed(3)} m`, x + 14, y);
                    y += rowH;
                }
            }

            y += 6;
            ctx.fillStyle = '#000';
            ctx.font = 'bold 11px "Yu Gothic UI", "Yu Gothic", sans-serif';
            ctx.fillText('[ その他 ]', x - 4, y);
            y += rowH;

            // K 三角
            ctx.strokeStyle = '#B22222';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x + 5, y + 1);
            ctx.lineTo(x, y + 11);
            ctx.lineTo(x + 10, y + 11);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = '#000';
            ctx.font = '11.5px "Yu Gothic UI", "Yu Gothic", sans-serif';
            ctx.fillText('K  基準点', x + 14, y);
            y += rowH;

            // H 四角
            ctx.strokeStyle = '#228B22';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(x + 2, y + 3, 7, 7);
            ctx.fillStyle = '#000';
            ctx.fillText('H  境界', x + 14, y);
        }

        _onClick(e) {
            if (!this._transform || this.rows.length === 0) return;
            const rect = this.canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            const G = global.GlConverter;
            const t = this._transform;

            // 点の種類ごとの「ヒット半径」と「優先度 (rank)」
            //   P 杭: 大きく描画 / 編集対象 → 最優先
            //   K 基準点: 三角形でやや大 → 次点
            //   H 境界: 小さく描画 / 補助情報 → 直接クリック時のみ
            function classify(name) {
                if (G.startsWith(name, 'P')) return { rank: 3, radius: 12 };
                if (G.startsWith(name, 'K')) return { rank: 2, radius: 12 };
                if (G.startsWith(name, 'H')) return { rank: 1, radius: 6 };
                return { rank: 0, radius: 8 };
            }

            const candidates = [];
            for (let i = 0; i < this.rows.length; i++) {
                const r = this.rows[i];
                if (G.isSPoint(r.name)) continue;
                const px = t.offX + (r.outY - t.minY) * t.scale;
                const py = t.offY + (t.maxX - r.outX) * t.scale;
                const dx = px - cx, dy = py - cy;
                const d = Math.sqrt(dx * dx + dy * dy);
                const c = classify(r.name);
                candidates.push({ idx: i, d, rank: c.rank, radius: c.radius });
            }
            if (candidates.length === 0) return;

            // step 1: ヒット半径内の候補があれば優先度→距離でソート
            const hits = candidates.filter(c => c.d <= c.radius);
            let winner = null;
            if (hits.length > 0) {
                hits.sort((a, b) => (b.rank - a.rank) || (a.d - b.d));
                winner = hits[0];
            } else {
                // step 2: 半径外なら P/K のみで最寄りを採用 (H 点は遠距離フォールバック対象外)
                const pk = candidates.filter(c => c.rank >= 2);
                if (pk.length > 0) {
                    pk.sort((a, b) => a.d - b.d);
                    winner = pk[0];
                } else {
                    // step 3: P/K が一切なければ最寄り点 (H 含む)
                    candidates.sort((a, b) => a.d - b.d);
                    winner = candidates[0];
                }
            }

            if (winner && this._onSelect) {
                this._onSelect(winner.idx, winner.d);
            }
        }
    }

    global.PlotPanel = PlotPanel;
})(window);
