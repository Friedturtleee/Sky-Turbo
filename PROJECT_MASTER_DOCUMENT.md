# Sky Turbo 專案企劃書

## 1. 產品定位

Sky Turbo 是面向 Hypixel SkyBlock 玩家、以決策速度為核心的 Bazaar 看盤工具。第一階段聚焦兩件事：找出 Bazaar 掛單價差，以及從 SkyShards Fusion Lines 找出最低成本的 Shard Fusion。它提供市場參考資訊，不保證訂單成交、Fusion RNG 或實際收益。

目標使用者是會進行 Bazaar flip、但不想自行整理掛單深度、稅率、交易量和 Fusion 路徑的玩家。首版為個人公開測試、非商業用途，符合 Vercel Hobby 的使用情境。

## 2. 核心功能

### Bazaar Flips

- 將所有有雙邊報價的 Bazaar 商品計算為 `Sell Order × (1 − 1.125%) − Buy Order`。
- 支援 Coins per Hour、Margin (%)、Margin (coins)、7 日 volatility 排序。
- 支援 volatility、sell/buy/total volume、Buy Order cost、price、CPH、margin coins／% 的上下限篩選。
- 首頁顯示價格、24 小時變化、7 日交易量、±5% 深度數量與名目金額，以及 Lightweight Charts 簡圖。
- 詳情頁顯示 1h／1d／1mo／all 圖表、前 30 檔掛單與 10m／1h／1d／1mo 漲跌。

### Shard Flip

- 使用固定 commit 的 SkyShards `fusion-data.json`，避免未審核上游變更直接進正式環境。
- 對 Fusion hypergraph 進行最低單位成本迭代，允許輸入 Shard 自身由更便宜的 Fusion 路徑取得，並防止循環路徑無限展開。
- 分別計算 Buy Order → Sell Order、Instant Buy → Sell Order、Buy Order → Instant Sell、Instant Buy → Instant Sell。
- 每個輸入槽乘以該 Shard 的 `fuse_amount`；每個輸出 Shard 僅顯示當前最佳 Fusion recipe。
- Crocodile 等級 0–10；若最終 Fusion 任一輸入屬 Reptile Family，預期產量乘以 `1 + 0.02 × level`。畫面標示 EV，明確說明不保證單次結果。
- Bazaar 的 Sell、Buy、Total volume 篩選會同時限制最終成品與所有直接購入原料，三者預設皆不限制；若某項原料不合格，求解器會嘗試由其他合格市場組成替代 Fusion 路徑。
- 依策略逐檔模擬前 30 檔，顯示總 Profit 符合 Min Profit 門檻的最大完整 Fusion 次數與預期成品量；Order 模式明確標示為排隊深度估算。
- Max Fusion 上限可由使用者限制最多點擊融合按鈕的次數，留空時不限制；實際 Max Fusion 會取市場深度、Min Profit、Min Flip Profit 與此上限共同允許的最大值。
- Shard 詳細檢視會顯示完整遞迴合成樹，以及清空符合門檻深度所需的所有整數原料總量、估計成本與總 Profit。
- 使用者可輸入所需成品數量；預設值為所有市場深度、門檻、上限及原料／成品篩選共同允許的最大整數成品量。詳細檢視會自動調整最終 Fusion 倍率、所有中間路徑、整數原料需求、預期產出與 Profit。
- 單次與深度的 Instant Buy / Sell 會依最佳價格順序逐檔消耗 orderbook，避免以最低一檔價格乘上全部數量；Buy / Sell Order 固定使用目前最佳掛單價，可見掛單量僅作排隊深度上限。
- Min Profit 可用原料總成本百分比或固定 coins 金額，預設為 0.1%；Min Flip Profit 可用最高單次 Flip Profit 的百分比或固定 coins 金額排除深度後段低利潤掛單，預設為最高單次 Profit 的 50%；Crocodile 預設等級為 10，並會計入最終預期成品、Profit 與市場深度，每次 Fusion 的原料購買量不變。

### Crashing

- 將目前 Buy Order 與最接近 24 小時前的 Hypixel hourly Buy Order 歷史價比較，只列出跌幅超過 30% 的商品；目標點前後兩小時內無資料時不列入。
- Crashing 篩選器的 Min Cost 以目前 Buy Order 計算，預設為 1,000 coins。

### Bookmarks

- 無登入設定時使用 localStorage，讓開發與公開 demo 不被金鑰阻塞。
- Clerk 設定完成且登入後，前端取得短效 JWT，Cloudflare Worker 驗證簽章與 issuer，再以 `(user_id, product_id)` 寫入 D1。
- 書籤頁集中呈現所有關注商品。

## 3. 技術架構

```text
Hypixel Bazaar API
        │ every 60s
        ▼
Cloudflare Cron ──authenticated POST──▶ Vercel ingestion
                                             │
                                   compute normalized snapshot
                                             │
                              authenticated Worker write
                                             ▼
                                  D1 gzip history + latest
                                              │
Browser ──▶ Next.js public API/UI ────────────┘
   │
   └── optional Clerk JWT ──▶ Worker ──▶ D1 bookmarks
```

Cloudflare Worker 不執行完整行情或 Fusion 計算；Vercel 負責 Hypixel JSON 正規化與計算，Worker 只執行 Cron、受保護的 D1 儲存 API 與書籤。D1 binding 不需要額外資料庫金鑰。未設定 D1 時，API 會回退到 Hypixel 的 60 秒快取資料。

## 4. 歷史資料策略

- 每分鐘更新 latest；跨越 5 分鐘、1 小時、1 日 bucket 時才封存上一份 compact snapshot。
- 每個時間切片依商品 hash 分成 8 個 gzip BLOB；1mo 使用 hourly，all 使用 daily。
- 缺少的既有歷史可透過獲准使用的 SkyCofl API 一次性回填至 D1；固定 90 req/min、逐商品 checkpoint、可續跑，合併時 Hypixel 自有資料優先。
- 自動保留：5m 8 天、1h 93 天、1d 長期。此配置保留所有圖表所需解析度，同時預留 D1 Free 的 500 MB 單庫空間。
- Volatility 定義為 `abs(current midpoint − window SMA) / window SMA × 100`，預設顯示 7 日。

## 5. UI 原則

主色為黑、白、灰；正負數只使用低飽和淡綠／淡紅。沒有 glow、霓虹漸層或大面積強色。資訊密度以表格為主，卡片只用於摘要與圖表。所有物品資料都包含 `icon` placeholder schema，未來可替換圖片而不改 API 主結構。

## 6. 免費與可行性

在個人、非商業且流量小的前提下，架構使用 Vercel Hobby、Cloudflare Workers Free／D1 Free、可選 Clerk Hobby，以及免費的 Hypixel Bazaar endpoint。不使用 R2、付費網域或任何需要綁信用卡的資源；直接使用 `vercel.app` 與 `workers.dev` 網域。免費代表有限額而非無上限，達限時服務會暫停／回傳錯誤，不會自動產生帳單。

D1 Free 每日含 5,000,000 rows read、100,000 rows written，單庫上限 500 MB，且每次 Free Worker invocation 最多 50 個 D1 queries。8 分區設計在最密集的每日切換約使用 29 queries；進入穩定 retention 後，包含 secondary-index 維護與舊資料刪除估計約 13,000 billed rows written/day。若使用者或 history reads 顯著增加，應先加強 CDN 快取或縮短 retention，不能在未經使用者決定下升級付費方案。

本方案不需要 Hypixel API key 讀取 Bazaar，但仍會使用 60 秒 server cache、不提供原始 API proxy，並標示非官方關係。

## 7. 交付階段

- Phase 1（本次）：可建置 monorepo、真實行情、計算核心、主要 UI、Worker/D1 儲存與 Clerk 路徑、測試與文件。
- Phase 2：建立正式 Cloudflare／Vercel／Clerk 資源、累積真實 history、觀察免費額度。
- Phase 3：加入額度告警、快取失敗回退、更多計算 fixtures、item icon provider。

## 8. 成功指標

- 行情延遲正常時小於 2 分鐘。
- 同一 snapshot 的稅後 Margin 在 API、列表、詳情一致。
- 四種 Shard 策略不混用價格邊，Crocodile 僅套用符合條件的 Fusion。
- 首頁在 1440px 與 390px 寬度均可操作，無高飽和裝飾。
- 未設定外部服務金鑰時，本機仍可完成市場功能與 local bookmarks。
