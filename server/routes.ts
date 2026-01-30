import type { Express } from "express";
import { createServer, type Server } from "http";
import type { Trade, TradesResponse } from "@shared/schema";
import { bech32 } from "bech32";

// Network configurations for Sai Keeper GraphQL API
const NETWORKS = {
  mainnet: {
    graphql: "https://sai-keeper.nibiru.fi/query",
    explorer: "https://nibiscan.io",
  },
  testnet: {
    graphql: "https://sai-keeper.testnet-2.nibiru.fi/query",
    explorer: "https://testnet.nibiscan.io",
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
function convertTrade(perpTrade: PerpTrade, pnlMap: Map<number, { pnlPct: number; pnlAmount: number }>): Trade {
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
  
  if (!isOpen) {
    trade.closePrice = perpTrade.closePrice || undefined;
    // First try to get P&L from state (for open trades with unrealized P&L)
    if (perpTrade.state) {
      trade.profitPct = perpTrade.state.pnlPct;
      trade.pnlAmount = perpTrade.state.pnlCollateralAfterFees / 1e6;
      trade.fees = (perpTrade.state.borrowingFeeCollateral + perpTrade.state.closingFeeCollateral) / 1e6;
    } else {
      // For closed trades, get realized P&L from trade history map
      const pnlData = pnlMap.get(perpTrade.id);
      if (pnlData) {
        trade.profitPct = pnlData.pnlPct;
        trade.pnlAmount = pnlData.pnlAmount;
      }
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
      // Fetch trades from Sai Keeper GraphQL API
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
        const trade = convertTrade(perpTrade, pnlMap);
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

  return httpServer;
}
