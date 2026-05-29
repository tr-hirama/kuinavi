/*
 * 杭ナビ CSV → GL.csv 変換ロジック
 *
 * 【入力 CSV 形式】 ポイント名 , Y座標(mm) , X座標(mm) , Z座標(mm)
 *   ※ Z 座標が空欄の場合は 0 として扱う
 *
 * 【出力 CSV 形式】 ポイント名 , X座標(m) , Y座標(m) , Z座標(m)
 *
 * 【変換式】
 *   X_out = X_in / 1000 + OffsetX
 *   Y_out = Y_in / 1000 + OffsetY
 *   Z_out = Z_in / 1000
 */
(function (global) {
    'use strict';

    const OffsetX = 10.0;
    const OffsetY = 10.0;

    /**
     * 数値フォーマット (小数点以下 3 桁固定: 12.5 → "12.500")
     */
    function fmt(value) {
        if (typeof value !== 'number' || !isFinite(value)) return '0.000';
        return value.toFixed(3);
    }

    function tryParseDouble(s) {
        if (s == null) return null;
        const t = String(s).trim();
        if (t.length === 0) return null;
        // 数値として完全に解釈できる場合のみ採用
        if (!/^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?$/.test(t)) return null;
        const v = parseFloat(t);
        return isFinite(v) ? v : null;
    }

    /**
     * テキストをパースして変換結果の行配列を返す。
     * @param {string} text - 入力CSVテキスト
     * @returns {Array<{name:string,inY:number,inX:number,inZ:number|null,outX:number,outY:number,outZ:number}>}
     */
    function parseAndConvert(text) {
        const rows = [];
        const lines = String(text).split(/\r?\n/);

        for (const raw of lines) {
            const line = raw.replace(/\r$/, '').trim();
            if (line.length === 0) continue;

            const parts = line.split(',');
            if (parts.length < 3) continue;

            const name = parts[0].trim();
            if (name.length === 0) continue;

            // 入力列: name, Y, X, Z  (X/Y が入れ替わっている点に注意)
            const inY = tryParseDouble(parts[1]);
            const inX = tryParseDouble(parts[2]);
            if (inY === null || inX === null) continue;

            let inZ = null;
            if (parts.length > 3) {
                const zStr = (parts[3] || '').trim();
                if (zStr.length > 0) {
                    const zv = tryParseDouble(zStr);
                    if (zv === null) continue; // 不正な Z は行スキップ
                    inZ = zv;
                }
            }
            const zForCalc = inZ === null ? 0.0 : inZ;

            const outX = inX / 1000.0 + OffsetX;
            const outY = inY / 1000.0 + OffsetY;
            const outZ = zForCalc / 1000.0;

            rows.push({ name, inY, inX, inZ, outX, outY, outZ });
        }
        return rows;
    }

    /**
     * 行データから CSV テキストを構築 (出力用)
     *  - 対象: P 杭のみ
     *  - 名前: 先頭の "P" (大小区別なし) を除去 (例: P1 → 1)
     *  - 順序: P 番号の昇順 (数値解釈可能なものを先、不可は末尾)
     *  - 各行末尾に "," を付加
     */
    function buildCsv(rows) {
        function stripPrefix(name) {
            return String(name || '').replace(/^[Pp]/, '');
        }
        function pNum(name) {
            const tail = stripPrefix(name);
            const n = parseInt(tail, 10);
            return isNaN(n) ? Number.POSITIVE_INFINITY : n;
        }
        const pRows = rows
            .filter(r => /^[Pp]/.test(r.name || ''))
            .slice()
            .sort((a, b) => {
                const na = pNum(a.name), nb = pNum(b.name);
                if (na !== nb) return na - nb;
                // 同番号 (異形名) は名前で安定化
                return String(a.name).localeCompare(String(b.name));
            });

        const lines = [];
        for (const p of pRows) {
            const name = stripPrefix(p.name);
            // 末尾に "," を付与 (列の最後を "," で終える)
            lines.push(`${name},${fmt(p.outX)},${fmt(p.outY)},${fmt(p.outZ)},`);
        }
        return lines.join('\n') + (lines.length > 0 ? '\n' : '');
    }

    /**
     * ファイルをエンコーディング推定して読み込む (Shift-JIS 優先、ダメなら UTF-8)
     * @param {File} file
     * @returns {Promise<string>}
     */
    function readFileSmart(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
                const buf = reader.result;
                if (!(buf instanceof ArrayBuffer)) {
                    resolve(String(buf || ''));
                    return;
                }
                resolve(decodeSmart(buf));
            };
            reader.readAsArrayBuffer(file);
        });
    }

    function decodeSmart(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);

        // BOM 検出
        if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            return new TextDecoder('utf-8').decode(bytes.subarray(3));
        }

        // UTF-8 として厳密にデコード (失敗したら SJIS 系を試す)
        try {
            const txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            // 制御文字や ASCII 以外を一切含まないテキストは
            // 文字化けの可能性が低いと判断して採用
            return txt;
        } catch (_) {
            // fallback
        }

        // Shift-JIS (Windows-31J) として読む。ブラウザは shift_jis ラベルをサポート
        try {
            return new TextDecoder('shift_jis').decode(bytes);
        } catch (_) {
            // 最終フォールバック
            return new TextDecoder('utf-8').decode(bytes);
        }
    }

    /**
     * Shift-JIS 出力用バイト列を生成。
     * ASCII (<= 0x7F) はそのまま 1 バイト、それ以外は本ライブラリに含めた
     * 簡易な変換表で 2 バイトに変換する (未収録文字は '?')。
     * 杭ナビ用途では実データはほぼ ASCII のため十分。
     */
    function encodeShiftJis(text) {
        const out = [];
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (cp <= 0x7F) {
                out.push(cp);
            } else if (cp >= 0xFF61 && cp <= 0xFF9F) {
                // 半角カナ
                out.push(cp - 0xFEC0);
            } else {
                // 全角文字は本実装ではサポートせず "?" を出力
                out.push(0x3F);
            }
        }
        return new Uint8Array(out);
    }

    /**
     * UTF-8 BOM 付きでエンコード
     */
    function encodeUtf8WithBom(text) {
        const utf8 = new TextEncoder().encode(text);
        const out = new Uint8Array(utf8.length + 3);
        out[0] = 0xEF; out[1] = 0xBB; out[2] = 0xBF;
        out.set(utf8, 3);
        return out;
    }

    /**
     * 出力ファイル名候補 (入力ファイル名末尾に _GL を付与)
     */
    function suggestOutputName(inputName) {
        const dot = inputName.lastIndexOf('.');
        if (dot < 0) return inputName + '_GL.csv';
        return inputName.substring(0, dot) + '_GL.csv';
    }

    /**
     * 文字列の先頭が指定の英字 (大小区別なし) かどうか
     */
    function startsWith(s, c) {
        if (!s || s.length === 0) return false;
        return s[0] === c || s[0] === c.toLowerCase() || s[0] === c.toUpperCase();
    }

    function isSPoint(name) {
        return typeof name === 'string' && name.length === 1 && (name === 'S' || name === 's');
    }

    /** "K1", "P12" 等の末尾数字を取り出す。なければ null */
    function tryParsePointNumber(name) {
        if (!name || name.length < 2) return null;
        const tail = name.substring(1);
        if (!/^-?\d+$/.test(tail)) return null;
        const n = parseInt(tail, 10);
        return isNaN(n) ? null : n;
    }

    global.GlConverter = {
        OffsetX, OffsetY,
        parseAndConvert,
        buildCsv,
        readFileSmart,
        encodeShiftJis,
        encodeUtf8WithBom,
        suggestOutputName,
        fmt,
        startsWith,
        isSPoint,
        tryParsePointNumber,
    };
})(window);
