import type { Express } from "express";
import { createServer, type Server } from "http";
import type { Trade, TradesResponse, OpenPosition, OpenPositionsResponse } from "@shared/schema";
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
  };
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
    };
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
    throw new Error(result.errors.map(e => e.message).join(", "));
  }
  
  if (!result.data) {
    throw new Error("No data returned from GraphQL query");
  }
  
  return result.data;
}

// Convert GraphQL trade data to our Trade type
function convertTrade(perpTrade: PerpTrade, pnlMap: Map<number, { pnlPct: number; pnlAmount: number }>, feeMap: Map<number, TradeFees>): Trade {
  const isOpen = perpTrade.isOpen;
  const timestamp = isOpen 
    ? (perpTrade.openBlock?.block_ts || new Date().toISOString())
    : (perpTrade.closeBlock?.block_ts || perpTrade.openBlock?.block_ts || new Date().toISOString());
  
  const trade: Trade = {
    txHash: `trade-${perpTrade.id}`,
    timestamp,
    type: isOpen ? "open" : "close",
    pair: perpTrade.perpBorrowing?.baseToken?.symbol || "Unknown",
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
      const [tradesResult, historyResult] = await Promise.all([
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

      // Query open trades
      const tradesResponse = await fetch(networkConfig.graphql, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: TRADES_QUERY,
          variables: { trader: bech32Address, limit: 100, offset: 0 },
        }),
      });

      const tradesData = await tradesResponse.json() as GraphQLResponse<TradesQueryResult>;
      
      if (tradesData.errors) {
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

  return httpServer;
}
