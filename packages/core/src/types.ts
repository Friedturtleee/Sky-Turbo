export const BAZAAR_TAX_RATE = 0.01125;

export type OrderLevel = {
  amount: number;
  orders: number;
  pricePerUnit: number;
};

export type HypixelBazaarProduct = {
  product_id: string;
  buy_summary: OrderLevel[];
  sell_summary: OrderLevel[];
  quick_status: {
    productId: string;
    buyPrice: number;
    buyVolume: number;
    buyMovingWeek: number;
    buyOrders: number;
    sellPrice: number;
    sellVolume: number;
    sellMovingWeek: number;
    sellOrders: number;
  };
};

export type HypixelBazaarResponse = {
  success: boolean;
  lastUpdated: number;
  products: Record<string, HypixelBazaarProduct>;
};

export type DepthSide = {
  quantity: number;
  notional: number;
  levels: number;
};

export type MarketItem = {
  productId: string;
  name: string;
  updatedAt: number;
  buyOrderPrice: number;
  sellOrderPrice: number;
  instantBuyPrice: number;
  instantSellPrice: number;
  marginCoins: number;
  marginPercent: number;
  coinsPerHour: number;
  coinsPerHourEstimated: true;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  buyMovingWeek: number;
  sellMovingWeek: number;
  weeklyVolume: number;
  buyOrders: number;
  sellOrders: number;
  midpoint: number;
  depthWithinFivePercent: {
    buyOrders: DepthSide;
    sellOffers: DepthSide;
    partial: boolean;
  };
  icon: {
    kind: "placeholder";
    key: string;
  };
  changes?: Partial<Record<"10m" | "1h" | "1d" | "1mo", number>>;
  buyOrderChange24h?: number;
  volatility?: Partial<Record<"1d" | "3d" | "7d" | "30d", number>>;
};

export type MarketSnapshot = {
  source: "hypixel";
  success: true;
  updatedAt: number;
  taxRate: number;
  items: MarketItem[];
};

export type PricePoint = {
  time: number;
  price: number;
  buyOrderPrice?: number;
  sellOrderPrice?: number;
  volume?: number;
  source?: "hypixel" | "coflnet";
};

export type CompactPricePoint = [
  time: number,
  price: number,
  buyOrderPrice: number,
  sellOrderPrice: number,
  volume: number,
];

export type ImportedHistoryRangeKey = "day" | "week" | "history";

export type ImportedHistoryRange = {
  fetchedAt: number;
  status: "ok" | "unavailable";
  points: CompactPricePoint[];
};

export type ImportedProductHistory = {
  schemaVersion: 1;
  provider: "coflnet";
  productId: string;
  fetchedAt: number;
  ranges: Partial<Record<ImportedHistoryRangeKey, ImportedHistoryRange>>;
};

export type ImportedHistorySummary = {
  schemaVersion: 1;
  provider: "coflnet";
  generatedAt: number;
  items: Record<string, Array<[time: number, price: number]>>;
};

export type CompactMarketItem = [
  midpoint: number,
  buyOrderPrice: number,
  sellOrderPrice: number,
  totalVolume: number,
];

export type CompactMarketSnapshot = {
  updatedAt: number;
  items: Record<string, CompactMarketItem>;
};

export type CompactHistoryPartition = {
  updatedAt: number;
  partition: number;
  items: Record<string, CompactMarketItem>;
};

export type MarketHistoryIngest = {
  snapshot: MarketSnapshot;
  compact: CompactMarketSnapshot;
};

export type FusionShard = {
  name: string;
  family: string;
  type: string;
  rarity: string;
  fuse_amount: number;
  internal_id: string;
};

export type FusionData = {
  recipes: Record<string, Record<string, [string, string][]>>;
  shards: Record<string, FusionShard>;
};

export type ShardStrategy = "bo-so" | "ib-so" | "bo-is" | "ib-is";

export type MinProfitThreshold = {
  mode: "percent" | "coins";
  value: number;
};

export type MarketFilterKey =
  | "volatility"
  | "sellVolume"
  | "buyVolume"
  | "totalVolume"
  | "buyOrderPrice"
  | "price"
  | "coinsPerHour"
  | "marginCoins"
  | "marginPercent";

export type NumericRange = { min?: number; max?: number };
export type MarketFilters = Partial<Record<MarketFilterKey, NumericRange>>;

export type ShardOrderBook = {
  buyOrders: OrderLevel[];
  sellOffers: OrderLevel[];
  partial: boolean;
};

export type ShardDepth = {
  available: boolean;
  /** Maximum allowed Fusion operations across the complete recursive route. */
  maxFusionLimit?: number;
  /** Total Fusion operations across every node in the selected recursive route. */
  maxProfitableFusions: number;
  maxProfitableOutput: number;
  totalInputCost: number;
  totalRevenueAfterTax: number;
  totalProfit: number;
  minProfit: MinProfitThreshold;
  minFlipProfit: MinProfitThreshold;
  maxFlipProfit: number;
  materialsRequired: Array<{
    shardId: string;
    productId: string;
    name: string;
    quantity: number;
    estimatedCost: number;
  }>;
  limitedBy: string;
  partial: boolean;
  model: "selected-side-top-30";
};

export type ShardRouteNode =
  | {
      kind: "market";
      shardId: string;
      productId: string;
      name: string;
      requiredQuantity: number;
      quantity: number;
      unitCost: number;
    }
  | {
      kind: "fusion";
      shardId: string;
      productId: string;
      name: string;
      requiredQuantity: number;
      fusionCount: number;
      baseOutput: number;
      expectedOutput: number;
      inputs: [ShardRouteNode, ShardRouteNode];
    };

export type ShardFlip = {
  shardId: string;
  productId: string;
  name: string;
  family: string;
  rarity: string;
  strategy: ShardStrategy;
  crocodileLevel: number;
  crocodileApplied: boolean;
  expectedOutput: number;
  baseOutput: number;
  inputCost: number;
  revenueAfterTax: number;
  profit: number;
  profitPerOutput: number;
  marginPercent: number;
  change24h?: number;
  volatility7d?: number;
  inputs: [
    { shardId: string; name: string; quantity: number; unitCost: number },
    { shardId: string; name: string; quantity: number; unitCost: number },
  ];
  materials: Array<{
    shardId: string;
    productId: string;
    name: string;
    quantityPerFusion: number;
    unitCost: number;
  }>;
  route: ShardRouteNode;
  depth: ShardDepth;
  path: string[];
};

export type NpcShopCost =
  | { kind: "coins"; amount: number }
  | { kind: "item"; productId: string; name: string; amount: number };

export type NpcShopOffer = {
  id: string;
  npc: string;
  output: { productId: string; name: string; amount: number };
  costs: NpcShopCost[];
  dailyLimit?: number;
  requirement?: string;
  source: { label: string; url: string };
};

export type NpcShopData = {
  schemaVersion: 1;
  generatedAt: string;
  sources: string[];
  offers: NpcShopOffer[];
};

export type NpcFlipCost = {
  kind: "coins" | "item";
  productId?: string;
  name: string;
  amount: number;
  unitPrice: number;
  totalPrice: number;
  priceSource: "coins" | "bazaar" | "ah-lowest-bin";
};

export type AuctionPriceQuote = {
  lowestBin: number;
  recentMedian?: number;
  recentVolume?: number;
  model?: "exact-lbin-and-median" | "adjusted-estimate";
};

export type NpcFlip = {
  offerId: string;
  npc: string;
  productId: string;
  name: string;
  quantity: number;
  costs: NpcFlipCost[];
  totalCost: number;
  saleSource: "bazaar" | "ah-lowest-bin";
  salePriceGross: number;
  salePriceNet: number;
  saleFeeRate: number;
  /** Bazaar sell-order proceeds and profit, using the same instant-buy costs. */
  bazaarSellOrderPriceGross?: number;
  bazaarSellOrderPriceNet?: number;
  bazaarSellOrderProfit?: number;
  /** Estimated matched Bazaar volume for the preceding seven days. */
  bazaarMatchedVolume7d?: number;
  auctionLowestBin?: number;
  auctionRecentMedian?: number;
  auctionRecentVolume?: number;
  auctionPriceCapped?: boolean;
  auctionPriceModel?: "exact-lbin-and-median" | "adjusted-estimate";
  /** Number of AH sales recorded during the preceding seven days. */
  ahSalesLast7d?: number;
  profit: number;
  marginPercent: number;
  dailyLimit?: number;
  maxPurchases?: number;
  maxDailyProfit?: number;
  requirement?: string;
  source: { label: string; url: string };
};
