import type { Express } from "express";
import { createServer, type Server } from "http";
import type { Trade, TradesResponse, OpenPosition, OpenPositionsResponse, GlobalStats, GlobalStatsResponse, VaultPosition, VaultPositionsResponse } from "@shared/schema";
import { bech32 } from "bech32";

// Network configurations for Sai Keeper GraphQL API and EVM RPC
const NETWORKS = {
  mainnet: {
    graphql: "https://sai-keeper.nibiru.fi/query",
    explorer: "https://nibiscan.io",
    rpc: "https://evm-rpc.nibiru.fi",
  },
  testnet: {
    graphql: "https://sai-keeper.testnet-2.nibiru.fi/query",
    explorer: "https://testnet.nibiscan.io",
    rpc: "https://evm-rpc.testnet-2.nibiru.fi",
  },
};

// Convert EVM address (0x...) to Nibiru bech32 address (nibi1...)
function evmToBech32(evmAddress: string): string {
  const cleanAddress = evmAddress.toLowerCase().replace("0x", "");
  const addressBytes: number[] = [];
  for (let i = 0; i < cleanAddress.length; i += 2) {
    addressBytes.push(parseInt(cleanAddress.substr(i, 2), 16));
  }
  const words = bech32.toWords(new Uint8Array(addressBytes));
  return bech32.encode("nibi", words);
}

// GraphQL query for trades
const TRADES_QUERY = `
  query GetTrades($trader: String!, $limit: Int, $offset: Int) {
    perp {
      trades(
        where: { trader: $trader }
        limit: $limit
        offset: $offset
        order_by: sequence
        order_desc: true
      ) {
        id
        trader
        isOpen
        isLong
        tradeType
        leverage
        collateralAmount
        openCollateralAmount
        openPrice
        closePrice
        sl
        tp
        perpBorrowing {
          marketId
          baseToken {
            symbol
            name
          }
          collateralToken {
            symbol
          }
        }
        openBlock {
          block
          block_ts
        }
        closeBlock {
          block
          block_ts
        }
        state {
          pnlCollateral
          pnlPct
          pnlCollateralAfterFees
          positionValue
          liquidationPrice
          borrowingFeeCollateral
          borrowingFeePct
          closingFeeCollateral
          closingFeePct
          remainingCollateralAfterFees
        }
      }
    }
  }
`;

// Fallback query without perpBorrowing (for when API has null perpBorrowing issues)
const TRADES_QUERY_FALLBACK = `
  query GetTrades($trader: String!, $limit: Int, $offset: Int) {
    perp {
      trades(
        where: { trader: $trader }
        limit: $limit
        offset: $offset
        order_by: sequence
        order_desc: true
      ) {
        id
        trader
        isOpen
        isLong
        tradeType
        leverage
        collateralAmount
        openCollateralAmount
        openPrice
        closePrice
        sl
        tp
        openBlock {
          block
          block_ts
        }
        closeBlock {
          block
          block_ts
        }
        state {
          pnlCollateral
          pnlPct
          pnlCollateralAfterFees
          positionValue
          liquidationPrice
          borrowingFeeCollateral
          borrowingFeePct
          closingFeeCollateral
          closingFeePct
          remainingCollateralAfterFees
        }
      }
    }
  }
`;

// GraphQL query for global protocol stats - using borrowings for open interest
const GLOBAL_STATS_QUERY = `
  query GetGlobalStats {
    perp {
      borrowings {
        marketId
        baseToken {
          symbol
        }
        oiLong
        oiShort
        oiMax
        price
      }
    }
    lp {
      vaults {
        tvl
        availableAssets
        apy
        collateralToken {
          symbol
        }
      }
    }
    oracle {
      tokenPricesUsd {
        token {
          symbol
        }
        priceUsd
      }
    }
  }
`;

// GraphQL query for user vault deposit history
const VAULT_POSITIONS_QUERY = `
  query GetVaultPositions($depositor: String!) {
    lp {
      depositHistory(
        where: { depositor: $depositor }
        limit: 100
      ) {
        id
        action
        depositor
        amount
        shares
        collateralPrice
        block {
          block
          block_ts
        }
        txHash
        evmTxHash
        vault {
          availableAssets
          apy
          collateralToken {
            symbol
          }
        }
      }
      vaults {
        availableAssets
        apy
        collateralToken {
          symbol
        }
      }
    }
  }
`;

// GraphQL query for trade history (for realized P&L on closed trades)
const TRADE_HISTORY_QUERY = `
  query GetTradeHistory($trader: String!, $limit: Int, $offset: Int) {
    perp {
      tradeHistory(
        where: { trader: $trader }
        limit: $limit
        offset: $offset
        order_by: sequence
        order_desc: true
      ) {
        id
        tradeChangeType
        evmTxHash
        block {
          block
          block_ts
        }
        trade {
          id
          isLong
          leverage
          openPrice
          closePrice
          perpBorrowing {
            baseToken {
              symbol
            }
          }
        }
        realizedPnlCollateral
        realizedPnlPct
      }
    }
  }
`;

// Fallback query without perpBorrowing
const TRADE_HISTORY_QUERY_FALLBACK = `
  query GetTradeHistory($trader: String!, $limit: Int, $offset: Int) {
    perp {
      tradeHistory(
        where: { trader: $trader }
        limit: $limit
        offset: $offset
        order_by: sequence
        order_desc: true
      ) {
        id
        tradeChangeType
        evmTxHash
        block {
          block
          block_ts
        }
        trade {
          id
          isLong
          leverage
          openPrice
          closePrice
        }
        realizedPnlCollateral
        realizedPnlPct
      }
    }
  }
`;

// GraphQL query for fee transactions
const FEE_TRANSACTIONS_QUERY = `
  query GetFeeTransactions($trader: String!, $limit: Int) {
    fee {
      feeTransactions(
        filter: { traderAddress: $trader }
        limit: $limit
      ) {
        id
        tradeId
        feeType
        totalFeeCharged
        govFee
        vaultFee
        referrerAllocation
        triggerFee
        blockTime
      }
    }
  }
`;

// GraphQL query for all trade history (global volume calculation)
// Using tradeHistory which doesn't require a trader filter
const ALL_TRADE_HISTORY_QUERY = `
  query GetAllTradeHistory($limit: Int, $offset: Int) {
    perp {
      tradeHistory(
        limit: $limit
        offset: $offset
        order_by: sequence
        order_desc: true
      ) {
        id
        tradeChangeType
        trade {
          id
          collateralAmount
          openCollateralAmount
          leverage
        }
      }
    }
  }
`;

// In-memory cache for global trading volume
interface VolumeCache {
  mainnet: {
    totalVolume: number;
    tradeCount: number;
    lastUpdated: string | null;
  };
  testnet: {
    totalVolume: number;
    tradeCount: number;
    lastUpdated: string | null;
  };
}

const volumeCache: VolumeCache = {
  mainnet: { totalVolume: 0, tradeCount: 0, lastUpdated: null },
  testnet: { totalVolume: 0, tradeCount: 0, lastUpdated: null },
};

// Fetch all trade history and calculate total volume
async function fetchGlobalVolume(network: "mainnet" | "testnet"): Promise<void> {
  const config = NETWORKS[network];
  let totalVolume = 0;
  let tradeCount = 0;
  let offset = 0;
  const batchSize = 1000;
  const seenTradeIds = new Set<number>();
  
  console.log(`[Volume] Starting global volume fetch for ${network}...`);
  
  try {
    while (true) {
      const response = await fetch(config.graphql, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: ALL_TRADE_HISTORY_QUERY,
          variables: { limit: batchSize, offset },
        }),
      });
      
      const result: GraphQLResponse<{ perp: { tradeHistory: Array<{ 
        id: number; 
        tradeChangeType: string;
        trade: { id: number; collateralAmount: number; openCollateralAmount: number; leverage: number } | null 
      }> } }> = await response.json();
      
      if (result.errors || !result.data?.perp?.tradeHistory) {
        console.error(`[Volume] Error fetching trade history for ${network}:`, result.errors);
        // Keep previous cache value on error instead of zeroing out
        return;
      }
      
      const historyItems = result.data.perp.tradeHistory;
      if (historyItems.length === 0) break;
      
      for (const item of historyItems) {
        // Count unique trades for position opening events (position_opened includes market/limit/trigger orders)
        const isOpeningEvent = item.tradeChangeType === "position_opened";
        if (item.trade && isOpeningEvent && !seenTradeIds.has(item.trade.id)) {
          seenTradeIds.add(item.trade.id);
          // Volume = collateral * leverage (position size at opening)
          const collateral = item.trade.openCollateralAmount || item.trade.collateralAmount;
          const positionSize = (collateral / 1e6) * item.trade.leverage;
          totalVolume += positionSize;
          tradeCount++;
        }
      }
      
      offset += batchSize;
      
      // Safety limit - don't fetch more than 100k history entries
      if (offset >= 100000) {
        console.log(`[Volume] Reached safety limit of 100k entries for ${network}`);
        break;
      }
    }
    
    volumeCache[network] = {
      totalVolume,
      tradeCount,
      lastUpdated: new Date().toISOString(),
    };
    
    console.log(`[Volume] ${network} volume updated: $${totalVolume.toLocaleString()} from ${tradeCount} trades`);
  } catch (error) {
    console.error(`[Volume] Failed to fetch global volume for ${network}:`, error);
  }
}

// Initialize volume cache on startup and set up 8-hour refresh
async function initializeVolumeCache(): Promise<void> {
  console.log("[Volume] Initializing volume cache...");
  await Promise.all([
    fetchGlobalVolume("mainnet"),
    fetchGlobalVolume("testnet"),
  ]);
  
  // Refresh every 8 hours (8 * 60 * 60 * 1000 = 28800000 ms)
  setInterval(() => {
    console.log("[Volume] Running scheduled 8-hour refresh...");
    fetchGlobalVolume("mainnet");
    fetchGlobalVolume("testnet");
  }, 8 * 60 * 60 * 1000);
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface PerpTrade {
  id: number;
  trader: string;
  isOpen: boolean;
  isLong: boolean;
  tradeType: string;
  leverage: number;
  collateralAmount: number;
  openCollateralAmount: number;
  openPrice: number;
  closePrice: number | null;
  sl: number | null;
  tp: number | null;
  perpBorrowing: {
    marketId: number;
    baseToken: {
      symbol: string;
      name: string;
    };
    collateralToken: {
      symbol: string;
    };
  } | null;
  openBlock: {
    block: number;
    block_ts: string;
  } | null;
  closeBlock: {
    block: number;
    block_ts: string;
  } | null;
  state: {
    pnlCollateral: number;
    pnlPct: number;
    pnlCollateralAfterFees: number;
    positionValue: number;
    liquidationPrice: number;
    borrowingFeeCollateral: number;
    borrowingFeePct: number;
    closingFeeCollateral: number;
    closingFeePct: number;
    remainingCollateralAfterFees: number;
  } | null;
}

interface TradeHistoryItem {
  id: number;
  tradeChangeType: string;
  evmTxHash: string | null;
  block: {
    block: number;
    block_ts: string;
  };
  trade: {
    id: number;
    isLong: boolean;
    leverage: number;
    openPrice: number;
    closePrice: number | null;
    perpBorrowing: {
      baseToken: {
        symbol: string;
      };
    } | null;
  };
  realizedPnlCollateral: number | null;
  realizedPnlPct: number | null;
}

// Interface for RPC transaction receipt
interface TransactionReceipt {
  logs: Array<{
    data: string;
    topics: string[];
  }>;
}

// Fee data extracted from transaction receipt
interface ExtractedFees {
  openingFee: number;
  closingFee: number;
  openingTriggerFee: number;
  closingTriggerFee: number;
}

// Extract fee data from transaction receipt logs
function extractFeesFromReceipt(receipt: TransactionReceipt): ExtractedFees {
  let openingFee = 0;
  let closingFee = 0;
  let openingTriggerFee = 0;
  let closingTriggerFee = 0;
  
  for (const log of receipt.logs) {
    try {
      const dataHex = log.data.slice(2);
      if (dataHex.length <= 128) continue;
      
      const contentHex = dataHex.slice(128);
      const decoded = Buffer.from(contentHex, 'hex').toString('utf8').replace(/\x00/g, '');
      const json = JSON.parse(decoded);
      
      if (json.eventType === 'wasm-sai/perp/process_opening_fees') {
        openingFee = Number(json.total_fee_charged || 0) / 1e6;
        openingTriggerFee = Number(json.trigger_fee_component || 0) / 1e6;
      } else if (json.eventType === 'wasm-sai/perp/process_closing_fees') {
        closingFee = Number(json.final_closing_fee || 0) / 1e6;
        closingTriggerFee = Number(json.final_trigger_fee || 0) / 1e6;
      }
    } catch (e) {
      // Skip invalid logs
    }
  }
  
  return { openingFee, closingFee, openingTriggerFee, closingTriggerFee };
}

// Fee data structure for a trade
interface TradeFees {
  openingFee: number;
  closingFee: number;
  triggerFee: number;
}

// Fetch fees from RPC for a list of transaction hashes
async function fetchFeesFromRpc(
  rpcUrl: string, 
  txHashes: { tradeId: number; evmTxHash: string; isOpening: boolean }[]
): Promise<Map<number, TradeFees>> {
  const feeMap = new Map<number, TradeFees>();
  
  // Filter out null hashes and deduplicate
  const validTxs = txHashes.filter(tx => tx.evmTxHash);
  
  // Fetch receipts in parallel (batch of 10 at a time to avoid overwhelming the RPC)
  const batchSize = 10;
  for (let i = 0; i < validTxs.length; i += batchSize) {
    const batch = validTxs.slice(i, i + batchSize);
    
    const receipts = await Promise.all(
      batch.map(async (tx) => {
        try {
          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_getTransactionReceipt',
              params: [tx.evmTxHash],
              id: 1
            })
          });
          const result = await response.json() as { result?: TransactionReceipt };
          if (result.result) {
            const fees = extractFeesFromReceipt(result.result);
            return { tradeId: tx.tradeId, isOpening: tx.isOpening, ...fees };
          }
        } catch (e) {
          console.log(`Failed to fetch receipt for ${tx.evmTxHash}:`, e);
        }
        return null;
      })
    );
    
    // Aggregate fees by trade ID
    for (const receipt of receipts) {
      if (!receipt) continue;
      
      const existing = feeMap.get(receipt.tradeId) || { openingFee: 0, closingFee: 0, triggerFee: 0 };
      if (receipt.isOpening) {
        existing.openingFee = receipt.openingFee;
        existing.triggerFee += receipt.openingTriggerFee;
      } else {
        existing.closingFee = receipt.closingFee;
        existing.triggerFee += receipt.closingTriggerFee;
      }
      feeMap.set(receipt.tradeId, existing);
    }
  }
  
  return feeMap;
}

interface TradesQueryResult {
  perp: {
    trades: PerpTrade[];
  };
}

interface TradeHistoryQueryResult {
  perp: {
    tradeHistory: TradeHistoryItem[];
  };
}

interface FeeTransaction {
  id: string;
  tradeId: number;
  feeType: "OPENING" | "CLOSING";
  totalFeeCharged: number;
  govFee: number;
  vaultFee: number;
  referrerAllocation: number;
  triggerFee: number;
  blockTime: string;
}

interface FeeTransactionsQueryResult {
  fee: {
    feeTransactions: FeeTransaction[];
  };
}

// Market info for pair inference
interface MarketInfo {
  symbol: string;
  price: number;
}

// Fetch market data and create a price->pair mapping
async function fetchMarketData(graphqlEndpoint: string): Promise<MarketInfo[]> {
  try {
    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{ perp { borrowings { baseToken { symbol } price } } }`
      }),
    });
    const data = await response.json();
    const borrowings = data?.data?.perp?.borrowings || [];
    // Deduplicate by symbol
    const seen = new Set<string>();
    const markets: MarketInfo[] = [];
    for (const b of borrowings) {
      if (b.baseToken?.symbol && !seen.has(b.baseToken.symbol)) {
        seen.add(b.baseToken.symbol);
        markets.push({ symbol: b.baseToken.symbol, price: b.price });
      }
    }
    return markets;
  } catch (e) {
    console.error("Failed to fetch market data:", e);
    return [];
  }
}

// Infer pair from entry price using market data
function inferPairFromPrice(entryPrice: number, markets: MarketInfo[]): string {
  if (markets.length === 0) return "Unknown";
  
  // Find the market with the closest price ratio (allow up to 5x difference for historical price changes)
  let bestMatch = "Unknown";
  let bestRatio = Infinity;
  
  for (const market of markets) {
    if (market.price <= 0) continue;
    const ratio = Math.max(entryPrice / market.price, market.price / entryPrice);
    // Allow up to 5x difference to account for historical price changes
    if (ratio < bestRatio && ratio < 5) {
      bestRatio = ratio;
      bestMatch = market.symbol;
    }
  }
  
  return bestMatch;
}

async function graphqlQuery<T>(endpoint: string, query: string, variables: Record<string, any>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  
  const result: GraphQLResponse<T> = await response.json();
  
  if (result.errors && result.errors.length > 0) {
    console.log("GraphQL errors:", result.errors);
    if (!result.data) {
      throw new Error(result.errors.map(e => e.message).join(", "));
    }
  }
  
  if (!result.data) {
    throw new Error("No data returned from GraphQL query");
  }
  
  return result.data;
}

// Convert GraphQL trade data to our Trade type
function convertTrade(perpTrade: PerpTrade, pnlMap: Map<number, { pnlPct: number; pnlAmount: number }>, feeMap: Map<number, TradeFees>, markets: MarketInfo[] = []): Trade {
  const isOpen = perpTrade.isOpen;
  const timestamp = isOpen 
    ? (perpTrade.openBlock?.block_ts || new Date().toISOString())
    : (perpTrade.closeBlock?.block_ts || perpTrade.openBlock?.block_ts || new Date().toISOString());
  
  // Get pair from perpBorrowing, or infer from price if not available
  let pair = perpTrade.perpBorrowing?.baseToken?.symbol;
  if (!pair && markets.length > 0) {
    pair = inferPairFromPrice(perpTrade.openPrice, markets);
  }
  
  const trade: Trade = {
    txHash: `trade-${perpTrade.id}`,
    timestamp,
    type: isOpen ? "open" : "close",
    pair: pair || "Unknown",
    direction: perpTrade.isLong ? "long" : "short",
    leverage: perpTrade.leverage,
    collateral: perpTrade.openCollateralAmount / 1e6,
    openPrice: perpTrade.openPrice,
    tradeIndex: String(perpTrade.id),
    openTimestamp: perpTrade.openBlock?.block_ts,
    closeTimestamp: perpTrade.closeBlock?.block_ts,
  };
  
  // Get fees from feeMap (RPC-based)
  const fees = feeMap.get(perpTrade.id);
  if (fees) {
    trade.openingFee = fees.openingFee;
    trade.closingFee = fees.closingFee;
    trade.triggerFee = fees.triggerFee;
    trade.totalFees = fees.openingFee + fees.closingFee + fees.triggerFee;
  }
  
  // Get borrowing fee from GraphQL state (available for open trades, shows accumulated borrowing)
  if (perpTrade.state) {
    trade.borrowingFee = perpTrade.state.borrowingFeeCollateral / 1e6;
    // Update total fees to include borrowing
    if (trade.totalFees !== undefined) {
      trade.totalFees += trade.borrowingFee;
    } else {
      trade.totalFees = trade.borrowingFee;
    }
  }
  
  if (!isOpen) {
    trade.closePrice = perpTrade.closePrice || undefined;
    // First try to get P&L from state (for open trades with unrealized P&L)
    if (perpTrade.state) {
      trade.profitPct = perpTrade.state.pnlPct;
      trade.pnlAmount = perpTrade.state.pnlCollateralAfterFees / 1e6;
    } else {
      // For closed trades, get realized P&L from trade history map
      const pnlData = pnlMap.get(perpTrade.id);
      if (pnlData) {
        trade.profitPct = pnlData.pnlPct;
        trade.pnlAmount = pnlData.pnlAmount;
      }
    }
    // Calculate amount received at closing (collateral + P&L)
    if (trade.collateral !== undefined && trade.pnlAmount !== undefined) {
      trade.amountReceived = trade.collateral + trade.pnlAmount;
    }
  }
  
  return trade;
}

// Convert trade history item to our Trade type (for closed trades with realized P&L)
function convertTradeHistoryItem(item: TradeHistoryItem): Trade | null {
  // Only process close events
  const closeTypes = ["position_closed_user", "position_closed_sl", "position_closed_tp", "position_liquidated"];
  if (!closeTypes.includes(item.tradeChangeType)) {
    return null;
  }
  
  const trade: Trade = {
    txHash: `history-${item.id}`,
    timestamp: item.block.block_ts,
    type: "close",
    pair: item.trade.perpBorrowing?.baseToken?.symbol || "Unknown",
    direction: item.trade.isLong ? "long" : "short",
    leverage: item.trade.leverage,
    openPrice: item.trade.openPrice,
    closePrice: item.trade.closePrice || undefined,
    tradeIndex: String(item.trade.id),
  };
  
  if (item.realizedPnlPct !== null) {
    trade.profitPct = item.realizedPnlPct;
  }
  if (item.realizedPnlCollateral !== null) {
    trade.pnlAmount = item.realizedPnlCollateral / 1e6;
  }
  // Calculate amount received at closing (collateral + P&L)
  if (trade.collateral !== undefined && trade.pnlAmount !== undefined) {
    trade.amountReceived = trade.collateral + trade.pnlAmount;
  }
  
  return trade;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize volume cache on startup
  initializeVolumeCache();
  
  // API endpoint for global trading volume
  app.get("/api/protocol-stats/volume", (req, res) => {
    const network = (req.query.network as string) || "mainnet";
    
    if (network !== "mainnet" && network !== "testnet") {
      return res.status(400).json({ error: "Invalid network. Use 'mainnet' or 'testnet'" });
    }
    
    const cache = volumeCache[network];
    
    res.json({
      totalVolume: cache.totalVolume,
      tradeCount: cache.tradeCount,
      lastUpdated: cache.lastUpdated,
      network,
    });
  });
  
  app.get("/api/trades", async (req, res) => {
    const address = req.query.address as string;
    const network = (req.query.network as string) || "mainnet";
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    // Validate address format (0x EVM address)
    if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) {
      return res.status(400).json({ error: "Invalid EVM address format" });
    }

    // Validate network
    if (network !== "mainnet" && network !== "testnet") {
      return res.status(400).json({ error: "Invalid network. Use 'mainnet' or 'testnet'" });
    }

    const networkConfig = NETWORKS[network as keyof typeof NETWORKS];
    
    // Convert EVM address to Nibiru bech32 format
    const nibiAddress = evmToBech32(address);
    console.log(`Converting ${address} to ${nibiAddress}`);

    try {
      // Fetch trades and trade history from Sai Keeper GraphQL API
      // Try main query first, fallback to query without perpBorrowing if it fails
      let tradesResult: TradesQueryResult;
      let historyResult: TradeHistoryQueryResult;
      
      try {
        [tradesResult, historyResult] = await Promise.all([
          graphqlQuery<TradesQueryResult>(networkConfig.graphql, TRADES_QUERY, {
            trader: nibiAddress,
            limit,
            offset,
          }),
          graphqlQuery<TradeHistoryQueryResult>(networkConfig.graphql, TRADE_HISTORY_QUERY, {
            trader: nibiAddress,
            limit: limit * 2,
            offset,
          }),
        ]);
      } catch (mainQueryError) {
        console.log("Main query failed, trying fallback without perpBorrowing...");
        [tradesResult, historyResult] = await Promise.all([
          graphqlQuery<TradesQueryResult>(networkConfig.graphql, TRADES_QUERY_FALLBACK, {
            trader: nibiAddress,
            limit,
            offset,
          }),
          graphqlQuery<TradeHistoryQueryResult>(networkConfig.graphql, TRADE_HISTORY_QUERY_FALLBACK, {
            trader: nibiAddress,
            limit: limit * 2,
            offset,
          }),
        ]);
      }
      
      // Collect transaction hashes for RPC fee extraction
      const txHashesForFees: { tradeId: number; evmTxHash: string; isOpening: boolean }[] = [];
      const openingTypes = ["position_opened"];
      const closingTypes = ["position_closed_user", "position_closed_sl", "position_closed_tp", "position_liquidated"];
      
      for (const historyItem of historyResult.perp.tradeHistory) {
        if (historyItem.evmTxHash) {
          if (openingTypes.includes(historyItem.tradeChangeType)) {
            txHashesForFees.push({
              tradeId: historyItem.trade.id,
              evmTxHash: historyItem.evmTxHash,
              isOpening: true
            });
          } else if (closingTypes.includes(historyItem.tradeChangeType)) {
            txHashesForFees.push({
              tradeId: historyItem.trade.id,
              evmTxHash: historyItem.evmTxHash,
              isOpening: false
            });
          }
        }
      }
      
      // Fetch fees from RPC in parallel
      console.log(`Fetching fees for ${txHashesForFees.length} transactions from RPC...`);
      const feeMap = await fetchFeesFromRpc(networkConfig.rpc, txHashesForFees);
      console.log(`Got fees for ${feeMap.size} trades`);
      
      // Build a map of trade ID to realized P&L from trade history
      const pnlMap = new Map<number, { pnlPct: number; pnlAmount: number }>();
      const closeTypes = ["position_closed_user", "position_closed_sl", "position_closed_tp", "position_liquidated"];
      for (const historyItem of historyResult.perp.tradeHistory) {
        if (closeTypes.includes(historyItem.tradeChangeType) && historyItem.realizedPnlPct !== null) {
          pnlMap.set(historyItem.trade.id, {
            pnlPct: historyItem.realizedPnlPct,
            pnlAmount: (historyItem.realizedPnlCollateral || 0) / 1e6,
          });
        }
      }
      
      // Convert trades
      const trades: Trade[] = [];
      const seenTradeIds = new Set<number>();
      
      // First, add trades from the trades query (includes open positions)
      for (const perpTrade of tradesResult.perp.trades) {
        const trade = convertTrade(perpTrade, pnlMap, feeMap);
        trades.push(trade);
        seenTradeIds.add(perpTrade.id);
      }
      
      // Add closed trades from history that might not be in the trades list
      for (const historyItem of historyResult.perp.tradeHistory) {
        if (!seenTradeIds.has(historyItem.trade.id)) {
          const trade = convertTradeHistoryItem(historyItem);
          if (trade) {
            trades.push(trade);
            seenTradeIds.add(historyItem.trade.id);
          }
        }
      }
      
      // Sort by timestamp descending
      trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      // Calculate stats for closed trades only
      const closeTrades = trades.filter(t => t.type === "close" && t.profitPct !== undefined);
      const wins = closeTrades.filter(t => (t.profitPct ?? 0) > 0).length;
      const winRate = closeTrades.length > 0 ? wins / closeTrades.length : 0;
      const totalPnl = closeTrades.reduce((sum, t) => sum + (t.profitPct ?? 0), 0);

      const response: TradesResponse = {
        address,
        trades,
        totalPnl,
        winRate,
        totalTrades: trades.length,
        explorer: networkConfig.explorer,
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching trades:", error);
      res.status(500).json({ error: "Failed to fetch trades" });
    }
  });

  // Open positions endpoint
  app.get("/api/positions", async (req, res) => {
    try {
      const address = req.query.address as string;
      const network = (req.query.network as string) || "mainnet";
      
      if (!address) {
        return res.status(400).json({ error: "Address is required" });
      }

      const networkConfig = NETWORKS[network as keyof typeof NETWORKS];
      if (!networkConfig) {
        return res.status(400).json({ error: "Invalid network" });
      }

      // Convert EVM address to bech32
      const bech32Address = evmToBech32(address);
      console.log(`Fetching open positions for ${address} (${bech32Address}) on ${network}`);

      // Query open trades - try main query first, fallback if perpBorrowing is null
      let tradesData: GraphQLResponse<TradesQueryResult>;
      
      const tradesResponse = await fetch(networkConfig.graphql, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: TRADES_QUERY,
          variables: { trader: bech32Address, limit: 100, offset: 0 },
        }),
      });

      tradesData = await tradesResponse.json() as GraphQLResponse<TradesQueryResult>;
      
      if (tradesData.errors && !tradesData.data) {
        console.log("Main positions query failed, trying fallback...");
        const fallbackResponse = await fetch(networkConfig.graphql, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: TRADES_QUERY_FALLBACK,
            variables: { trader: bech32Address, limit: 100, offset: 0 },
          }),
        });
        tradesData = await fallbackResponse.json() as GraphQLResponse<TradesQueryResult>;
      }
      
      if (tradesData.errors && !tradesData.data) {
        console.error("GraphQL errors:", tradesData.errors);
        return res.status(500).json({ error: "Failed to fetch positions" });
      }

      const allTrades = tradesData.data?.perp?.trades || [];
      const openTrades = allTrades.filter(t => t.isOpen);

      // Convert to OpenPosition format
      const positions: OpenPosition[] = openTrades.map(trade => ({
        tradeId: trade.id,
        pair: trade.perpBorrowing?.baseToken?.symbol || "Unknown",
        direction: trade.isLong ? "long" : "short",
        leverage: trade.leverage,
        collateral: (trade.openCollateralAmount || trade.collateralAmount) / 1e6,
        entryPrice: trade.openPrice,
        currentPrice: undefined,
        stopLoss: trade.sl,
        takeProfit: trade.tp,
        liquidationPrice: trade.state?.liquidationPrice,
        unrealizedPnl: trade.state ? trade.state.pnlCollateral / 1e6 : undefined,
        unrealizedPnlPct: trade.state?.pnlPct,
        positionValue: trade.state ? trade.state.positionValue / 1e6 : undefined,
        borrowingFee: trade.state ? trade.state.borrowingFeeCollateral / 1e6 : undefined,
        openedAt: trade.openBlock?.block_ts || new Date().toISOString(),
      }));

      // Calculate total unrealized PnL
      const totalUnrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);

      const response: OpenPositionsResponse = {
        address,
        positions,
        totalPositions: positions.length,
        totalUnrealizedPnl,
        explorer: networkConfig.explorer,
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching positions:", error);
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  // Global protocol stats endpoint
  app.get("/api/stats", async (req, res) => {
    try {
      const network = (req.query.network as string) || "mainnet";
      const networkConfig = NETWORKS[network as keyof typeof NETWORKS];
      
      if (!networkConfig) {
        return res.status(400).json({ error: "Invalid network" });
      }

      // Fetch global stats from GraphQL
      const response = await fetch(networkConfig.graphql, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: GLOBAL_STATS_QUERY,
        }),
      });

      const data = await response.json();
      
      if (data.errors) {
        console.error("GraphQL errors:", data.errors);
        return res.status(500).json({ error: "Failed to fetch global stats" });
      }

      const borrowings = data.data?.perp?.borrowings || [];
      const vaultsData = data.data?.lp?.vaults || [];
      const tokenPrices = data.data?.oracle?.tokenPricesUsd || [];
      
      // Note: Trading volume is not yet available from the Sai Keeper GraphQL API
      // TODO: Add volume when API supports it
      const totalVolume = 0;

      // Build a price map from oracle data
      const priceMap: Record<string, number> = {};
      tokenPrices.forEach((tp: any) => {
        if (tp.token?.symbol && tp.priceUsd) {
          priceMap[tp.token.symbol] = tp.priceUsd;
        }
      });

      // Calculate open interest from borrowings data
      let longOpenInterest = 0;
      let shortOpenInterest = 0;
      
      borrowings.forEach((borrowing: any) => {
        const oiLong = borrowing.oiLong || 0;
        const oiShort = borrowing.oiShort || 0;
        longOpenInterest += oiLong / 1e6;
        shortOpenInterest += oiShort / 1e6;
      });

      // Calculate TVL from vaults using availableAssets and oracle prices
      const vaults = vaultsData.map((vault: any, index: number) => {
        const symbol = vault.collateralToken?.symbol || "USDC";
        const availableAssets = vault.availableAssets || 0;
        const tokenPrice = priceMap[symbol] || 1; // Default to 1 for USDC-like stablecoins
        // availableAssets is in 6 decimals (micro units)
        const tvlUsd = (availableAssets / 1e6) * tokenPrice;
        
        return {
          id: `vault-${index}`,
          tvl: tvlUsd,
          balance: availableAssets / 1e6,
          depositsActive: 0,
          depositsAvailable: 0,
          symbol,
          apy: vault.apy || null,
          tokenPrice,
        };
      });

      const totalTvl = vaults.reduce((sum: number, v: any) => sum + v.tvl, 0);

      const stats: GlobalStats = {
        totalTvl,
        totalOpenInterest: longOpenInterest + shortOpenInterest,
        totalOpenPositions: borrowings.length, // Number of markets with positions
        longOpenInterest,
        shortOpenInterest,
        totalVolume,
        vaults,
      };

      const statsResponse: GlobalStatsResponse = {
        stats,
        network,
      };

      res.json(statsResponse);
    } catch (error) {
      console.error("Error fetching global stats:", error);
      res.status(500).json({ error: "Failed to fetch global stats" });
    }
  });

  // Get vault positions for a specific address
  app.get("/api/vault-positions", async (req, res) => {
    try {
      const { address, network: networkParam } = req.query;
      
      if (!address || typeof address !== "string") {
        return res.status(400).json({ error: "Address is required" });
      }

      const network = (networkParam as string) || "mainnet";
      const networkConfig = NETWORKS[network as keyof typeof NETWORKS];
      
      if (!networkConfig) {
        return res.status(400).json({ error: "Invalid network" });
      }

      // Convert EVM address to bech32 if needed
      let nibiAddress = address;
      if (address.startsWith("0x")) {
        nibiAddress = evmToBech32(address);
      }

      // Fetch vault positions from GraphQL
      const response = await fetch(networkConfig.graphql, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: VAULT_POSITIONS_QUERY,
          variables: { depositor: nibiAddress },
        }),
      });

      const data = await response.json();
      
      if (data.errors) {
        console.error("GraphQL errors:", data.errors);
        return res.status(500).json({ error: "Failed to fetch vault positions" });
      }

      const depositHistory = data.data?.lp?.depositHistory || [];
      const vaults = data.data?.lp?.vaults || [];

      // Create a map of current vault data (for calculating current share value)
      const vaultMap = new Map<string, { availableAssets: number; apy: number; totalShares?: number }>();
      vaults.forEach((vault: any) => {
        const symbol = vault.collateralToken?.symbol || "Unknown";
        vaultMap.set(symbol, {
          availableAssets: parseFloat(vault.availableAssets) || 0,
          apy: parseFloat(vault.apy) || 0,
        });
      });

      // Process deposit history to calculate positions
      // Group deposits by vault symbol and aggregate
      const positionsByVault = new Map<string, {
        deposits: any[];
        totalShares: number;
        totalDeposited: number;
      }>();

      depositHistory.forEach((deposit: any) => {
        const symbol = deposit.vault?.collateralToken?.symbol || "Unknown";
        const action = deposit.action;
        const amount = parseFloat(deposit.amount) / 1e6; // Convert from micro-units
        const shares = parseFloat(deposit.shares) / 1e6;

        if (!positionsByVault.has(symbol)) {
          positionsByVault.set(symbol, { deposits: [], totalShares: 0, totalDeposited: 0 });
        }

        const position = positionsByVault.get(symbol)!;
        position.deposits.push(deposit);

        if (action === "deposit") {
          position.totalShares += shares;
          position.totalDeposited += amount;
        } else if (action === "withdraw") {
          position.totalShares -= shares;
          position.totalDeposited -= amount;
        }
      });

      // Convert to vault positions array with earnings calculation
      const positions: VaultPosition[] = [];
      const now = new Date();

      positionsByVault.forEach((data, symbol) => {
        const vaultData = vaultMap.get(symbol);
        const currentApy = vaultData?.apy || data.deposits[0]?.vault?.apy || 0;
        const isVaultOpen = data.totalShares > 0;

        // Create individual position entries for each deposit and withdrawal
        data.deposits.forEach((entry: any) => {
          const action = entry.action as "deposit" | "withdraw";
          const amount = parseFloat(entry.amount) / 1e6;
          const shares = parseFloat(entry.shares) / 1e6;
          const entryDate = entry.block?.block_ts || "";
          
          if (action === "deposit") {
            // For deposits, calculate earnings if vault is still open
            const depositDaysElapsed = entryDate ? (now.getTime() - new Date(entryDate).getTime()) / (1000 * 60 * 60 * 24) : 0;
            const depositYearsElapsed = depositDaysElapsed / 365;
            const depositEstimatedGrowth = isVaultOpen ? amount * currentApy * depositYearsElapsed : 0;
            const depositCurrentValue = isVaultOpen ? amount + depositEstimatedGrowth : 0;
            const depositEarnings = isVaultOpen ? depositEstimatedGrowth : 0;
            const depositEarningsPercent = amount > 0 && isVaultOpen ? (depositEarnings / amount) * 100 : 0;

            positions.push({
              vaultSymbol: symbol,
              depositAmount: amount,
              shares,
              currentValue: depositCurrentValue,
              earnings: depositEarnings,
              earningsPercent: depositEarningsPercent,
              depositDate: entryDate,
              txHash: entry.txHash || "",
              evmTxHash: entry.evmTxHash || "",
              apy: currentApy,
              collateralPriceAtDeposit: parseFloat(entry.collateralPrice) || 0,
              action: "deposit",
              status: isVaultOpen ? "open" : "closed",
            });
          } else if (action === "withdraw") {
            // For withdrawals, show as closed position with realized earnings
            positions.push({
              vaultSymbol: symbol,
              depositAmount: amount,
              shares,
              currentValue: amount, // Withdrawn amount is the realized value
              earnings: 0, // Earnings already realized at withdrawal
              earningsPercent: 0,
              depositDate: entryDate,
              txHash: entry.txHash || "",
              evmTxHash: entry.evmTxHash || "",
              apy: currentApy,
              collateralPriceAtDeposit: parseFloat(entry.collateralPrice) || 0,
              action: "withdraw",
              status: "closed",
            });
          }
        });
      });

      // Sort by deposit date (most recent first), handle invalid dates
      positions.sort((a, b) => {
        const dateA = a.depositDate ? new Date(a.depositDate).getTime() : 0;
        const dateB = b.depositDate ? new Date(b.depositDate).getTime() : 0;
        return dateB - dateA;
      });

      // Calculate totals
      const totalDeposited = positions.reduce((sum, p) => sum + p.depositAmount, 0);
      const totalCurrentValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
      const totalEarnings = positions.reduce((sum, p) => sum + p.earnings, 0);

      const vaultPositionsResponse: VaultPositionsResponse = {
        address,
        positions,
        totalDeposited,
        totalCurrentValue,
        totalEarnings,
        network,
      };

      res.json(vaultPositionsResponse);
    } catch (error) {
      console.error("Error fetching vault positions:", error);
      res.status(500).json({ error: "Failed to fetch vault positions" });
    }
  });

  return httpServer;
}
