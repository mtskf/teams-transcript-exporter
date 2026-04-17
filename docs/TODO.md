# TODO

## Medium Priority

- [x] ~~スクロールループに絶対イテレーション上限を追加~~ (content.js:220) (resolved)
  - MAX_ITERATIONS=1000 を追加、上限到達時は収集済みデータで処理を続行
  - EXTRACTION_TIMEOUT_MS を 180s → 360s に倍増（長時間ミーティング対応）
- [ ] `extractingTabId` を `chrome.storage.session` で永続化 (background.js)
  - MV3 Service Worker のスリープで in-memory 変数が失われるリスク
  - `storage` パーミッション追加が必要

## Low Priority

- [ ] `window._meetingInfo` 未設定時のフォールバック改善 (content.js:119)
  - 現在は warn ログのみで `'Teams Meeting (metadata unavailable)'` にフォールバック
  - ユーザーにアクション可能なフィードバック（badge 通知等）を提供すべき
  - レースコンディションでしか起きず、フォールバック自体は機能するため LOW
- [ ] `TRANSCRIPT_READY` / `SCRAPING_ERROR` ハンドラで `sender.tab.id === extractingTabId` を検証 (background.js)
  - 現在はどのタブからのメッセージでも受け付ける（同拡張コンテンツスクリプトに限定されるためリスクは低い）
  - defense-in-depth として sender を検証すべき
- [ ] `onUpdated` リスナーでタブリロード時のリセットを追加 (background.js:151)
  - 現在は `changeInfo.url` のみ監視するためリロードを検出しない
  - リロードで content script コンテキストが破棄されるが `extractingTabId` がセットされたまま残る
  - 既存の 180s タイムアウトがカバーするためリスクは低い
- [ ] manifest.json と background.js のサブドメインパターン不一致の解消
  - background.js は `*.teams.microsoft.com` を許可するが manifest は bare domain のみ
  - 実際に Teams がサブドメインを使用するか要調査
- [ ] スクロール停止判定の改善 — 仮想スクロールの丸め誤差対策 (content.js:281)
- [ ] 重複排除キーを複合化: speaker + timestamp + text (content.js:229)
  - 現在の innerText 全体比較は機能的に問題ないが可読性が低い
- [ ] DOM パーサーの高スキップ率検出 — スキップ数が全セル数の一定割合を超えたら警告 (content.js)
- [ ] manifest.json の content_scripts ブロックと programmatic injection (background.js) の二重注入を解消
  - content_scripts を削除し programmatic injection のみにするか、逆に programmatic injection を削除するか要検討
  - 動作変更を伴うため十分なテストが必要

## Completed

- [x] ~~`isExtracting` をタブ単位にスコープし、タブ閉じ/ナビゲーション時にリセット~~ (background.js) (resolved)
  - `extractingTabId` に変更、`chrome.tabs.onRemoved` / `chrome.tabs.onUpdated` でクリーンアップ
- [x] ~~parent-side message listener に event.origin 検証を追加~~ (content.js:98) (resolved)
  - `iframe.src` 取得可能時に `event.origin` と突合（Teams が動的に設定するため空の場合あり）
  - `event.source === iframe.contentWindow` チェックとの二重防御（src 不在時は source のみ）
- [x] ~~postMessage の targetOrigin を `'*'` から実際のオリジンに変更~~ (resolved)
  - 親→iframe: `new URL(iframe.src).origin`（取得できない場合は `'*'` にフォールバック）
  - iframe→親: `parentOrigin`（受信時の event.origin をキャプチャ）
- [x] ~~transcriptData 要素のフィールドレベル型ガード追加~~ (content.js:134) (resolved)
  - Array.isArray チェックはあるが個別フィールド (speaker, timestamp, text) の typeof 検証がない
  - 非文字列値がサイレントに markdown に混入する可能性
