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
export type CraftStrategy = ShardStrategy;
export type NpcStrategy = ShardStrategy;

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
  /** Base number of output items available per day, before conditional bonuses or Diaz. */
  dailyLimit?: number;
  dailyLimitSource?: "shop-stock" | "standard-shop-limit" | "manual-wiki";
  /** Shopping Spree normally multiplies a limited shop by 10; Kiara is a known exception. */
  diazEligible?: boolean;
  conditionalDailyLimitBonus?: number;
  conditionalLimitRequirement?: string;
  requirement?: string;
  source: { label: string; url: string };
};

export type NpcShopData = {
  schemaVersion: 2;
  generatedAt: string;
  sources: string[];
  audit?: {
    sourceShopFiles: number;
    selectedShopFiles: number;
    generatedOffers: number;
    skippedNoCost: number;
    skippedNonSingleOutput: number;
    skippedUnsupportedCost: number;
    skippedBazaarOffers: Array<{ file: string; slotId: string; productId: string; reason: string }>;
  };
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
  /** Selected Bazaar side used to cap the executable quantity for maker and taker strategies. */
  capacityDepth?: OrderLevel[];
  capacityDepthPartial?: boolean;
  /** Visible sell offers consumed when the selected input strategy is Instant Buy. */
  executionDepth?: OrderLevel[];
  executionDepthPartial?: boolean;
};

export type NpcBazaarQuote = {
  productId: string;
  instantBuyPrice?: number;
  buyOrderPrice?: number;
  instantSellPrice?: number;
  sellOrderPrice?: number;
  /** Hypixel buy_summary: sell offers available to an Instant Buy taker. */
  instantBuyDepth?: OrderLevel[];
  /** Hypixel sell_summary: buy orders available to an Instant Sell taker. */
  instantSellDepth?: OrderLevel[];
  instantBuyDepthPartial?: boolean;
  instantSellDepthPartial?: boolean;
  buyMovingWeek: number;
  sellMovingWeek: number;
};

export type AuctionPriceQuote = {
  lowestBin: number;
  recentMedian?: number;
  recentVolume?: number;
  model?: "exact-lbin-and-median" | "adjusted-estimate";
};

export type NpcFlip = {
  offerId: string;
  strategy: NpcStrategy;
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
  /** Both Bazaar output paths, calculated against the currently selected input-cost strategy. */
  bazaarInstaSellAvailable?: boolean;
  bazaarInstaSellPriceGross?: number;
  bazaarInstaSellPriceNet?: number;
  bazaarInstaSellProfit?: number;
  bazaarSellOrderPriceGross?: number;
  bazaarSellOrderPriceNet?: number;
  bazaarSellOrderProfit?: number;
  /** Selected Bazaar side used to cap output quantity for Sell Order and Instant Sell. */
  bazaarCapacityDepth?: OrderLevel[];
  bazaarCapacityDepthPartial?: boolean;
  /** Visible buy orders consumed when the selected output strategy is Instant Sell. */
  bazaarExecutionDepth?: OrderLevel[];
  bazaarExecutionDepthPartial?: boolean;
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
  maxProfitPerPurchase: number;
  maxProfitStrategy: "insta-sell" | "sell-order" | "ah";
  dailyLimit?: number;
  dailyLimitSource?: "shop-stock" | "standard-shop-limit" | "manual-wiki";
  diazEligible: boolean;
  conditionalDailyLimitBonus?: number;
  conditionalLimitRequirement?: string;
  maxPurchases?: number;
  maxDailyProfit?: number;
  requirement?: string;
  source: { label: string; url: string };
};

export type NpcProfitPlanCost = {
  kind: "coins" | "item";
  productId?: string;
  name: string;
  amountPerPurchase: number;
  requiredAmount: number;
  unitPrice: number;
  totalPrice: number;
  priceSource: "coins" | "bazaar" | "ah-lowest-bin";
};

export type NpcProfitPlan = {
  fraction: 1 | 0.8;
  purchaseCount: number;
  outputQuantity: number;
  effectiveDailyLimit: number;
  stockPurchaseLimit: number;
  executionPurchaseLimit: number;
  maxProfitPurchaseCount: number;
  depthLimited: boolean;
  depthPartial: boolean;
  limitedBy: string;
  totalCost: number;
  revenueAfterTax: number;
  totalProfit: number;
  profitStrategy: NpcFlip["maxProfitStrategy"];
  diazApplied: boolean;
  conditionalBonusApplied: boolean;
  costs: NpcProfitPlanCost[];
};

export type NpcMayorContext = {
  name: string;
  lastUpdated: number;
  shoppingSpreeActive: boolean;
  shoppingSpreeHolder?: string;
};

export type CraftRecipeIngredient = {
  productId: string;
  name: string;
  amount: number;
};

export type CraftRequirementProgress = {
  key: string;
  label: string;
  level: number;
  format: "roman" | "number";
};

export type CraftRequirementScale = {
  key: string;
  label: string;
  maxLevel: number;
  format: "roman" | "number";
};

export type CraftRecipe = {
  id: string;
  type: "crafting";
  output: { productId: string; name: string; amount: number };
  ingredients: CraftRecipeIngredient[];
  requirement?: string;
  source: { label: string; url: string; file: string };
};

export type CraftData = {
  schemaVersion: 1;
  generatedAt: string;
  source: {
    project: string;
    commit: string;
    branch: string;
    archiveUrl: string;
    license: "MIT";
  };
  warnings: string[];
  recipes: CraftRecipe[];
};

export type CraftFlipIngredient = CraftRecipeIngredient & {
  unitCost: number;
  totalCost: number;
};

export type CraftProfitPlanIngredient = CraftRecipeIngredient & {
  unitCost: number;
  totalCost: number;
};

export type CraftProfitPlan = {
  fraction: 1 | 0.8;
  craftCount: number;
  outputQuantity: number;
  ingredients: CraftProfitPlanIngredient[];
  inputCost: number;
  grossRevenue: number;
  revenueAfterTax: number;
  totalProfit: number;
};

export type CraftProfitDepth = {
  available: boolean;
  partial: boolean;
  maxCrafts: number;
  maxOutput: number;
  maxProfit: number;
  limitedBy: string;
  fullPlan?: CraftProfitPlan;
  eightyPercentPlan?: CraftProfitPlan;
};

export type CraftFlip = {
  recipeId: string;
  strategy: CraftStrategy;
  productId: string;
  name: string;
  outputAmount: number;
  ingredients: CraftFlipIngredient[];
  inputCost: number;
  grossRevenue: number;
  revenueAfterTax: number;
  profit: number;
  profitPerOutput: number;
  marginPercent: number;
  buyMovingWeek: number;
  sellMovingWeek: number;
  matchedVolume7d: number;
  partial: boolean;
  depth: CraftProfitDepth;
  requirement?: string;
  source: { label: string; url: string; file: string };
};

export type AhRiskLevel = "low" | "medium" | "high";
export type AhValuationSource = "skycofl-nbt" | "component-estimate";
export type AhFeatureCategory =
  | "reforge"
  | "enchantment"
  | "gemstone"
  | "dye"
  | "skin"
  | "potato-book"
  | "rarity"
  | "stars"
  | "pet"
  | "attribute"
  | "drill-part"
  | "modifier"
  | "counter"
  | "special"
  | "unknown";

export type AhItemFeature = {
  key: string;
  label: string;
  value: string;
  category: AhFeatureCategory;
  recognized: boolean;
  marketProductId?: string;
  replacementCost?: number;
  estimatedContribution?: number;
};

export type AhHistoryStats = {
  productId: string;
  fetchedAt: number;
  days: 7;
  totalSales: number;
  salesPerDay: number;
  averagePrice: number;
  medianPrice: number;
  minimumPrice: number;
  maximumPrice: number;
  averageSellTimeSeconds: number;
  medianSellTimeSeconds: number;
  binPercentage: number;
  priceStdDev: number;
  priceCoefficientVariation: number;
};

export type AhHistorySummary = {
  schemaVersion: 1;
  provider: "skycofl";
  generatedAt: number;
  items: Record<string, AhHistoryStats>;
};

export type AhImportedHistoryRecord = {
  schemaVersion: 1;
  provider: "skycofl";
  productId: string;
  fetchedAt: number;
  status: "ok" | "unavailable";
  stats?: AhHistoryStats;
};

export type AhNbtEstimate = {
  lbin: number;
  median: number;
  fastSell: number;
  volume: number;
  lbinLink?: string;
  lbinKey?: string;
  medianKey?: string;
  itemKey?: string;
};

export type AhValuationInput = {
  auctionId: string;
  productId: string;
  name: string;
  category: string;
  tier: string;
  quantity: number;
  listingPrice: number;
  start: number;
  end: number;
  componentEstimate: number;
  features: AhItemFeature[];
  unknownAttributeKeys: string[];
  nbtEstimate?: AhNbtEstimate;
  history?: AhHistoryStats;
};

export type AhFlip = {
  auctionId: string;
  productId: string;
  name: string;
  category: string;
  tier: string;
  quantity: number;
  listingPrice: number;
  start: number;
  end: number;
  estimatedValue: number;
  fastSellValue?: number;
  componentEstimate: number;
  resaleAfterTax: number;
  auctionFees: number;
  feeRate: number;
  profit: number;
  fastSellProfit?: number;
  roiPercent: number;
  discountPercent: number;
  valuationSource: AhValuationSource;
  riskLevel: AhRiskLevel;
  confidence: number;
  riskReasons: string[];
  features: AhItemFeature[];
  unknownAttributeKeys: string[];
  history?: AhHistoryStats;
  comparableVolume?: number;
  valuationKey?: string;
  comparableAuctionUrl?: string;
  viewAuctionCommand: string;
};

export type AhFlipSnapshot = {
  schemaVersion: 1;
  source: "hypixel-auctions+skycofl";
  generatedAt: number;
  auctionUpdatedAt: number;
  totalPages: number;
  totalAuctions: number;
  parsedAuctions: number;
  candidateAuctions: number;
  evaluatedAuctions: number;
  skippedAuctions: number;
  partial: boolean;
  historyGeneratedAt?: number;
  flips: AhFlip[];
};
