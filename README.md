# ハウス杭ナビ変換 (Web 版)

杭ナビ CSV (mm 単位) を GL.csv (m 単位) に変換する Web アプリ。
元の `KuiNaviToGL` (Windows Forms / .NET 8) を完全に Web 移植したもの。

## 公開URL
**https://tr-hirama.github.io/kuinavi/**

GitHub Actions による自動デプロイ運用中。
`main` ブランチへ push されると自動で公開されます。

## 使い方
詳細は [MANUAL.md](MANUAL.md) を参照。
アプリ右上の「ヘルプ」ボタンからも簡易マニュアルを開けます。

## 起動方法 (ローカル)
`index.html` をダブルクリックしてブラウザで開くだけ。
ビルドもサーバーも不要・完全オフライン動作。

## 構成

```
kuinavi/
├── index.html         レイアウト
├── styles.css         スタイル
├── js/
│   ├── converter.js   変換ロジック (原本 GlConverter.cs 相当)
│   ├── plot.js        配置図描画 (原本 PlotPanel.cs 相当)
│   ├── dialogs.js     Z 編集ダイアログ (原本 ZEditDialogs.cs 相当)
│   └── app.js         画面制御 (原本 MainForm.cs 相当)
├── MANUAL.md          使用マニュアル
└── README.md
```

## 機能

- ドラッグ&ドロップ / ファイル選択で CSV 読み込み
- 入力: `名前, Y(mm), X(mm), Z(mm)` (X/Y 入れ替え注意)
- 出力: `名前, X(m), Y(m), Z(m)` (Offset X/Y = 10.0、Z は /1000)
- グリッド + 配置図 + 出力 CSV プレビューの表示
- 配置図上で
  - P (杭): Z 値ごとに色分けした円
  - BM (水準点): 濃紺のダイヤモンド
  - K (境界): 赤い三角形 + 番号順に黒線で結ぶ
  - H / S (機器位置): 表示対象外
- P 杭 / BM の Z 値編集
  - グリッドのセルをダブルクリックで直接編集
  - 「選択点の Z 編集」ボタンでダイアログ
  - 「グループ変更」: 同じ Z 値の P 群を設定 / 加算
  - 「全本変更」: 全 P 対象 (一律設定 / 加算 / S 点 Z 減算 / グループ基準シフト)
- 設計GL バー: 全 BM の Z を −(入力値) mm に設定 (S 点の Z が初期値、読込時に自動適用)
- 座標変換: 選択した P / BM を基準に全点を平行移動
- Undo / Redo (Ctrl+Z / Ctrl+Y、最大 50 件)
- 配置図クリックで最寄り点を選択
- 出力 CSV の並び順: P (番号昇順) → BM → K → その他 (入力順)
- 出力時は **Shift-JIS (原本互換)** または **UTF-8 BOM 付** を選択可

## 仕様メモ

- 入力エンコーディング: UTF-8 を試し、失敗したら Shift-JIS で再読込
- Shift-JIS 出力: ASCII + 半角カナのみ対応 (CSV 実データは ASCII のため十分)
  - それ以外の文字は `?` に置換され、保存時に警告ダイアログ
- 数値表示: 小数点以下 3 桁固定 (`12.5` → `12.500`)
