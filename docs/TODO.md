# TODO

## High Priority

- [ ] parent-side message listener に event.origin 検証を追加 (content.js:87)
  - 現在は event.source === iframe.contentWindow のみ
  - *.sharepoint.com を content_scripts から削除したため攻撃面は縮小
  - 完全対策には iframe origin リスト（sharepoint サブドメイン等）の調査が必要
- [x] ~~postMessage の targetOrigin を `'*'` から実際のオリジンに変更~~ (resolved)
  - 親→iframe: `new URL(iframe.src).origin`（パース失敗時は abort）
  - iframe→親: `parentOrigin`（受信時の event.origin をキャプチャ）

## Medium Priority

- [ ] transcriptData 要素のフィールドレベル型ガード追加 (content.js:127)
  - Array.isArray チェックはあるが個別フィールド (speaker, timestamp, text) の typeof 検証がない
  - 非文字列値がサイレントに markdown に混入する可能性
- [ ] manifest.json と background.js のサブドメインパターン不一致の解消
  - background.js は `*.teams.microsoft.com` を許可するが manifest は bare domain のみ
  - 実際に Teams がサブドメインを使用するか要調査
- [ ] スクロールループに絶対イテレーション上限を追加 (content.js:203)
  - DOM がライブ更新で微動し続ける場合に無限ループのリスク
  - 上限到達時は収集済みデータで処理を続行すべき
- [ ] `isExtracting` を `chrome.storage.session` で永続化 (background.js)
  - MV3 Service Worker のスリープで in-memory 変数が失われるリスク
  - `storage` パーミッション追加が必要
- [ ] 重複排除キーを複合化: speaker + timestamp + text (content.js:165-167)
  - 現在の innerText 全体比較は機能的に問題ないが可読性が低い
- [ ] DOM パーサーの高スキップ率検出 — スキップ数が全セル数の一定割合を超えたら警告 (content.js)
- [ ] スクロール停止判定の改善 — 仮想スクロールの丸め誤差対策 (content.js:191-200)
- [ ] manifest.json の content_scripts ブロックと programmatic injection (background.js) の二重注入を解消
  - content_scripts を削除し programmatic injection のみにするか、逆に programmatic injection を削除するか要検討
  - 動作変更を伴うため十分なテストが必要
