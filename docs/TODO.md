# TODO

## High Priority

- [ ] postMessage の targetOrigin を `'*'` から実際のオリジンに変更 (content.js:60,205,208,216)
  - 親→iframe: `new URL(iframe.src).origin` （例外ガード付き）
  - iframe→親: cross-origin のため困難。受信側の event.source 検証で緩和中

## Medium Priority

- [ ] `isExtracting` を `chrome.storage.session` で永続化 (background.js)
  - MV3 Service Worker のスリープで in-memory 変数が失われるリスク
  - `storage` パーミッション追加が必要
- [ ] 重複排除キーを複合化: speaker + timestamp + text (content.js:165-167)
  - 現在の innerText 全体比較は機能的に問題ないが可読性が低い
