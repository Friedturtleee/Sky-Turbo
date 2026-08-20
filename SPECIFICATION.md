# Sky Turbo 技術規格

## 市場語意與公式

Hypixel 的欄位名稱以 maker 方向表示：

- `buy_summary[0]` 是現有 sell offer，因此是 Instant Buy／Sell Order 價格。
- `sell_summary[0]` 是現有 buy order，因此是 Instant Sell／Buy Order 價格。

固定常數 `taxRate = 0.01125`。

```text
orderMarginCoins = sellOrderPrice × (1 − taxRate) − buyOrderPrice
orderMarginPct   = orderMarginCoins / buyOrderPrice × 100
matchedPerHour   = min(buyMovingWeek, sellMovingWeek) / 168
estimatedCPH     = orderMarginCoins × matchedPerHour
midpoint         = (bestSellOffer + bestBuyOrder) / 2
```

CPH 是歷史成交能力推估，不是保證成交量。±5% 深度僅彙總 Hypixel 提供的前 30 檔，因此當任一邊剛好 30 檔時標示 partial。

## Shard 公式

每個 recipe pair 消耗：

```text
inputCost = unitCost(A) × fuseAmount(A) + unitCost(B) × fuseAmount(B)
expectedOutput = baseOutput × (hasReptileInput ? 1 + 0.02 × crocodileLevel : 1)
revenueAfterTax = selectedOutputPrice × expectedOutput × (1 − taxRate)
profit = revenueAfterTax − inputCost
```

當單次 Fusion 的需求量跨越 orderbook 多檔時，`inputCost` 與 `revenueAfterTax` 都必須逐檔消耗數量後加總，不得使用第一檔價格直接乘以全部數量。

`bo` input 使用 Buy Order，`ib` input 使用 Instant Buy；`so` output 使用 Sell Order，`is` output 使用 Instant Sell。輸入的 `unitCost` 是 direct market 與可達 Fusion 路徑中的最低值。最終 route 必須至少包含一次 Fusion。

原料規劃只允許完整的 Fusion 操作：中間成品不足時以 `ceil(required / baseOutput)` 增加 Fusion 次數，最後所有 Bazaar 購買量都是整數。Crocodile 不降低中間 Fusion 或原材料數量，只套用在最終 Fusion 的預期成品與稅後 Profit。

詳細視窗接受使用者輸入的目標成品數量。最終 Fusion 倍率為 `ceil(desiredOutput / expectedOutputPerFinalFusion)`，接著由上而下重新展開每一層完整 Fusion，並更新整數原料、預期實際產出與估計 Profit；若超過目前可獲利深度會顯示警告。

Shard 市場篩選會在最低成本求解之前執行：直接購入的葉節點原料若不符合條件，就不會成為 direct cost seed，但仍可由其他合格原料經 Fusion 取得。最終成品市場也必須通過相同條件。這讓篩選改變實際合成路徑，而不只是隱藏計算完成的列。

### 可獲利市場深度

每條最佳路徑會先遞迴展開為真正需要從 Bazaar 購入的葉節點原料，再依所選策略逐檔消耗原料與成品的前 30 檔。深度 `N` 必須滿足：

```text
depthProfit(N) = depthRevenueAfterTax(N) − depthInputCost(N)
depthProfit(N) > 0
depthProfit(N) >= (mode = percent ? depthInputCost(N) × minProfitValue / 100 : minProfitValue)
marginalFlipProfit(N) >= (mode = percent ? maxFlipProfit × minFlipProfitValue / 100 : minFlipProfitValue)
```

Min Profit 可選原料總成本百分比或固定 coins 金額，預設為 `0.1%`。Min Flip Profit 可選最高單次 Flip Profit 的百分比或固定 coins 金額，預設 `0%`（不限制），用來排除深度後段單次利潤過低的掛單。Max Fusion 是套用 Min Profit 與 Min Flip Profit 後，吃完所有符合門檻掛單所需執行的完整 Fusion 次數，也就是 `maxProfitableFusions`；預期成品為該次數乘以已含 Crocodile 倍率的 `expectedOutput`。Instant 策略代表可立即消耗的掛單；Order 策略是目前可見排隊深度估算，不能視為保證成交量。任一 orderbook 達到 30 檔時標示 partial。

## Public API

- `GET /api/v1/market/items`
- `GET /api/v1/market/items/:productId`
- `GET /api/v1/market/items/:productId/history?range=1h|1d|1mo|all`
- `GET /api/v1/market/items/:productId/orderbook`
- `GET /api/v1/shard-flips?strategy=bo-so|ib-so|bo-is|ib-is&crocodileLevel=0..10`（Crocodile 預設等級 `10`）

Shard endpoint 的原料與成品篩選接受 `sellVolumeMin/Max`、`buyVolumeMin/Max`、`totalVolumeMin/Max`，三者預設皆不限制。Min Profit 使用 `minProfitMode=percent|coins` 與 `minProfitValue`（預設 `percent / 0.1`）；Min Flip Profit 使用 `minFlipProfitMode=percent|coins` 與 `minFlipProfitValue`（預設 `coins / 0`）。
- `POST /api/v1/internal/ingest`（Bearer secret）

成功 envelope 為 `{ data, error: null }`；失敗為 `{ data: null, error: { message, details? } }`。

## Edge API

- `GET /health`
- `GET /v1/storage/latest`
- `GET /v1/storage/history-live/:productId?range=1h|1d|1mo|all`
- `GET /v1/storage/history-daily`
- `POST /v1/internal/market-snapshot`（Bearer ingestion secret）
- `GET|PUT /v1/internal/history-import/:productId`（Bearer ingestion secret）
- `GET|PUT /v1/internal/history-import-meta/:key`（Bearer ingestion secret）
- `GET /v1/me/bookmarks`
- `PUT /v1/me/bookmarks/:productId`
- `DELETE /v1/me/bookmarks/:productId`

書籤端點都需要 Clerk bearer token。Worker 只接受符合 `[A-Z0-9_:.-]`、長度不超過 128 的 product ID。

## 資料物件

`MarketItem` 預留：

```ts
icon: { kind: "placeholder"; key: string }
changes?: Partial<Record<"10m" | "1h" | "1d" | "1mo", number>>
volatility?: Partial<Record<"1d" | "3d" | "7d" | "30d", number>>
```

歷史資料使用同一個 D1 database：

```text
market_state       latest_snapshot、latest_compact
market_history     (tier, epochBucket, partition) gzip BLOB
imported_history   每個 SkyCofl 商品一列 gzip JSON BLOB
imported_meta      summary、manifest gzip JSON BLOB
bookmarks          (user_id, product_id)
```

`market_history` 以 FNV-1a 將商品穩定分配到 8 個分區，降低每分鐘寫入列數。5m 保留 8 天、1h 保留 93 天、1d 長期保留；只有跨越對應 bucket 時才封存上一份快照。8 分區也讓每日邊界包含 state read/write 與 retention 在內約 29 個 D1 queries，低於 Workers Free 每次 invocation 的 50 個限制。

SkyCofl 回填器逐商品抓取 day／week／history，限制為 90 req/min 並對 429 遵守 `Retry-After`。每個 product row 同時是 checkpoint；已存在的 range 不重抓。圖表會在請求的 5m／1h／1d bucket 合併來源，先放 SkyCofl、再放 Hypixel，因此同一 bucket 永遠由第一方 Hypixel snapshot 覆蓋。

## 安全與快取

- Hypixel server fetch：60 秒 Next data cache，12 秒 timeout。
- Internal ingestion 與 Cron 共用高熵 secret，production 只放 secret store。
- Clerk JWT 以 remote JWKS 驗證 signature、expiration、issuer；JWKS resolver 可在 isolate 中安全重用。
- D1 全部使用 prepared statement，沒有字串拼接 SQL。
- Public market response 可被 CDN 快取 60 秒；個人書籤一律 `no-store`。
- 大型 request body 有明確上限，SkyCofl JSON 在 Worker 內壓縮後才寫入 D1。
- 不向瀏覽器暴露 Clerk secret 或 ingestion secret；D1 以 Worker binding 存取，不需要資料庫 API key。
