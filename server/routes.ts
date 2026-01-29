import type { Express } from "express";
import { createServer, type Server } from "http";
import type { Trade, TradesResponse } from "@shared/schema";

// Network configurations
const NETWORKS = {
  mainnet: {
    rpc: "https://evm-rpc.nibiru.fi",
    explorer: "https://nibiscan.io",
  },
  testnet: {
    rpc: "https://evm-rpc.testnet-2.nibiru.fi",
    explorer: "https://testnet.nibiscan.io",
  },
};

const SAI_PERPS_CONTRACT = "0x9F48A925Dda8528b3A5c2A6717Df0F03c8b167c0".toLowerCase();
const WASM_PRECOMPILE = "0x0000000000000000000000000000000000000802".toLowerCase();

// Event topic signatures for Sai Perps
const WASM_EVENT_TOPIC = "0xd18c87af9a802d065969706ff77c671073731c5e7a56bf6748098c6014f84800";

interface TransactionReceipt {
  transactionHash: string;
  blockNumber: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
  to: string | null;
  from: string;
}

// Decode ABI-encoded bytes to UTF-8 string
function decodeAbiString(hex: string): string {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  
  // ABI encoding: first 32 bytes is offset, next 32 bytes is length, then data
  // Skip first 64 chars (32 bytes offset), read next 64 chars (32 bytes length)
  if (cleanHex.length >= 128) {
    const lengthHex = cleanHex.substring(64, 128);
    const length = parseInt(lengthHex, 16);
    const dataHex = cleanHex.substring(128, 128 + length * 2);
    
    // Convert hex to bytes
    const bytes: number[] = [];
    for (let i = 0; i < dataHex.length; i += 2) {
      const byte = parseInt(dataHex.substr(i, 2), 16);
      bytes.push(byte);
    }
    
    try {
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(new Uint8Array(bytes));
    } catch {
      // Fallback to ASCII
      return bytes.filter(b => b >= 32 && b < 127).map(b => String.fromCharCode(b)).join('');
    }
  }
  
  // Fallback: just decode as raw hex
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = parseInt(cleanHex.substr(i, 2), 16);
    if (byte !== 0) bytes.push(byte);
  }
  try {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(new Uint8Array(bytes));
  } catch {
    return bytes.filter(b => b >= 32 && b < 127).map(b => String.fromCharCode(b)).join('');
  }
}

// Parse JSON from hex-encoded event data
function parseEventData(data: string): any {
  try {
    const text = decodeAbiString(data);
    // Find the start of JSON object
    const jsonStart = text.indexOf('{');
    if (jsonStart === -1) return null;
    
    // Find matching closing brace, handling nested objects
    let depth = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          jsonEnd = i;
          break;
        }
      }
    }
    
    if (jsonEnd === -1) return null;
    
    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
    
    // Try standard JSON parse first
    try {
      return JSON.parse(jsonStr);
    } catch {
      // If JSON parsing fails, try regex extraction for key fields
      // This handles malformed JSON with unescaped nested objects
      const result: any = {};
      
      // Extract eventType
      const eventTypeMatch = jsonStr.match(/"eventType"\s*:\s*"([^"]+)"/);
      if (eventTypeMatch) result.eventType = eventTypeMatch[1];
      
      // Extract profit_pct (the key value we need for P&L)
      const profitPctMatch = jsonStr.match(/"profit_pct"\s*:\s*"([^"]+)"/);
      if (profitPctMatch) result.profit_pct = profitPctMatch[1];
      
      // Extract close_price
      const closePriceMatch = jsonStr.match(/"close_price"\s*:\s*"([^"]+)"/);
      if (closePriceMatch) result.close_price = closePriceMatch[1];
      
      // Extract collateral_left
      const collateralLeftMatch = jsonStr.match(/"collateral_left"\s*:\s*"([^"]+)"/);
      if (collateralLeftMatch) result.collateral_left = collateralLeftMatch[1];
      
      // Extract final_closing_fee
      const closingFeeMatch = jsonStr.match(/"final_closing_fee"\s*:\s*"([^"]+)"/);
      if (closingFeeMatch) result.final_closing_fee = closingFeeMatch[1];
      
      // Extract final_trigger_fee
      const triggerFeeMatch = jsonStr.match(/"final_trigger_fee"\s*:\s*"([^"]+)"/);
      if (triggerFeeMatch) result.final_trigger_fee = triggerFeeMatch[1];
      
      // Extract collateral_sent_to_trader
      const sentToTraderMatch = jsonStr.match(/"collateral_sent_to_trader"\s*:\s*"([^"]+)"/);
      if (sentToTraderMatch) result.collateral_sent_to_trader = sentToTraderMatch[1];
      
      // Extract available_collateral
      const availableCollateralMatch = jsonStr.match(/"available_collateral"\s*:\s*"([^"]+)"/);
      if (availableCollateralMatch) result.available_collateral = availableCollateralMatch[1];
      
      // Extract action
      const actionMatch = jsonStr.match(/"action"\s*:\s*"([^"]+)"/);
      if (actionMatch) result.action = actionMatch[1];
      
      // Extract long
      const longMatch = jsonStr.match(/"long"\s*:\s*(true|false|"true"|"false")/);
      if (longMatch) result.long = longMatch[1].replace(/"/g, '');
      
      // Extract collateral
      const collateralMatch = jsonStr.match(/"collateral"\s*:\s*"([^"]+)"/);
      if (collateralMatch) result.collateral = collateralMatch[1];
      
      if (Object.keys(result).length > 0) return result;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

// Make JSON-RPC call to Nibiru
async function rpcCall(rpcUrl: string, method: string, params: any[]): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    }),
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || "RPC error");
  }
  return json.result;
}

// Get block timestamp
async function getBlockTimestamp(rpcUrl: string, blockNumber: string): Promise<string> {
  try {
    const block = await rpcCall(rpcUrl, "eth_getBlockByNumber", [blockNumber, false]);
    if (block && block.timestamp) {
      const timestamp = parseInt(block.timestamp, 16) * 1000;
      return new Date(timestamp).toISOString();
    }
  } catch {
    // Ignore errors
  }
  return new Date().toISOString();
}

// Get logs in chunks (max 10000 blocks per request)
async function getLogsInChunks(rpcUrl: string, fromBlock: number, toBlock: number, address: string, topics: string[]): Promise<any[]> {
  const allLogs: any[] = [];
  const chunkSize = 9000; // Stay under 10000 limit
  
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    try {
      const logs = await rpcCall(rpcUrl, "eth_getLogs", [{
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
        address,
        topics,
      }]);
      if (logs && Array.isArray(logs)) {
        allLogs.push(...logs);
      }
    } catch (error) {
      console.error(`Error fetching logs for blocks ${start}-${end}:`, error);
    }
  }
  
  return allLogs;
}

// Get transaction count and recent transactions
async function getAddressTransactions(rpcUrl: string, address: string): Promise<Trade[]> {
  const trades: Trade[] = [];
  const lowerAddress = address.toLowerCase();
  
  try {
    // Get the latest block number
    const latestBlock = await rpcCall(rpcUrl, "eth_blockNumber", []);
    const latestBlockNum = parseInt(latestBlock, 16);
    
    // Search last 50000 blocks (about 1 day with ~1.8s blocks)
    const blocksToSearch = 50000;
    const fromBlock = Math.max(0, latestBlockNum - blocksToSearch);
    
    
    // Get logs from WASM precompile with the Sai Perps event topic in chunks
    const logs = await getLogsInChunks(rpcUrl, fromBlock, latestBlockNum, WASM_PRECOMPILE, [WASM_EVENT_TOPIC]);


    // First pass: identify transactions that contain our address
    const matchingTxHashes = new Set<string>();
    const txBlockMap = new Map<string, string>();
    const addressSuffix = lowerAddress.slice(2); // Remove 0x prefix

    for (const log of logs) {
      const eventData = parseEventData(log.data);
      if (!eventData) continue;
      
      // Check if this event contains our EVM address
      const dataStr = JSON.stringify(eventData).toLowerCase();
      
      // Check for EVM address in various forms
      if (dataStr.includes(addressSuffix) || dataStr.includes(lowerAddress)) {
        matchingTxHashes.add(log.transactionHash);
        txBlockMap.set(log.transactionHash, log.blockNumber);
      }
    }


    // Second pass: get ALL logs from each matching transaction by fetching receipt
    const txLogsMap = new Map<string, any[]>();
    for (const txHash of matchingTxHashes) {
      try {
        const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash]);
        if (receipt && receipt.logs) {
          const parsedLogs: any[] = [];
          for (const log of receipt.logs) {
            const eventData = parseEventData(log.data);
            if (eventData) {
              parsedLogs.push({ ...log, parsedData: eventData });
            }
          }
          txLogsMap.set(txHash, parsedLogs);
        }
      } catch (err) {
        console.error(`Error fetching receipt for ${txHash}:`, err);
      }
    }

    // Process each transaction
    for (const [txHash, txLogs] of txLogsMap) {
      const blockNumber = txBlockMap.get(txHash)!;
      const timestamp = await getBlockTimestamp(rpcUrl, blockNumber);
      
      let trade: Trade = {
        txHash,
        timestamp,
        type: "close",
      };

      // Parse logs to extract trade info
      for (const log of txLogs) {
        const eventData = log.parsedData;
        if (!eventData) continue;

        const eventType = (eventData.eventType || "").toLowerCase();

        // Open trade event
        if (eventType.includes("register_trade") || eventType.includes("open_trade") || eventType.includes("trigger_trade/register_trade")) {
          trade.type = "open";
          if (eventData.open_price) {
            trade.openPrice = parseFloat(eventData.open_price);
          }
          if (eventData.long !== undefined) {
            trade.direction = eventData.long === "true" || eventData.long === true ? "long" : "short";
          }
          if (eventData.leverage) {
            trade.leverage = parseFloat(eventData.leverage);
          }
          if (eventData.collateral || eventData.position_size_collateral) {
            trade.collateral = parseFloat(eventData.collateral || eventData.position_size_collateral);
          }
          if (eventData.user_trade_index || eventData.trade_index) {
            const idx = eventData.user_trade_index || eventData.trade_index;
            trade.tradeIndex = typeof idx === "string" ? idx : JSON.stringify(idx);
          }
        }

        // Close trade event - user_close_order
        if (eventType.includes("close_order") || eventType.includes("user_close")) {
          trade.type = "close";
          if (eventData.close_price) {
            trade.closePrice = parseFloat(eventData.close_price);
          }
          if (eventData.profit_pct !== undefined) {
            trade.profitPct = parseFloat(eventData.profit_pct);
          }
          if (eventData.global_trade_index) {
            try {
              const indexData = typeof eventData.global_trade_index === "string" 
                ? JSON.parse(eventData.global_trade_index.replace(/'/g, '"'))
                : eventData.global_trade_index;
              trade.tradeIndex = indexData.user_trade_index || String(indexData);
            } catch {
              trade.tradeIndex = String(eventData.global_trade_index);
            }
          }
        }
        
        // user_close_order event - contains the accurate profit_pct
        if (eventType.includes("user_close_order")) {
          trade.type = "close";
          if (eventData.close_price) {
            trade.closePrice = parseFloat(eventData.close_price);
          }
          // This is the actual trade profit/loss percentage before fees
          if (eventData.profit_pct !== undefined) {
            trade.profitPct = parseFloat(eventData.profit_pct);
          }
        }
        
        // Market close order (fallback)
        if (eventType.includes("pending_order_type") && eventData.pending_order_type === "market_close") {
          trade.type = "close";
          if (eventData.close_price && !trade.closePrice) {
            trade.closePrice = parseFloat(eventData.close_price);
          }
          if (eventData.profit_pct !== undefined && trade.profitPct === undefined) {
            trade.profitPct = parseFloat(eventData.profit_pct);
          }
        }

        // Handle trade PNL - this is the key event for close trades
        if (eventType.includes("handle_trade_pnl")) {
          if (eventData.collateral_sent_to_trader) {
            trade.pnlAmount = parseFloat(eventData.collateral_sent_to_trader);
          }
          // available_collateral is the collateral left after the trade P&L calculation but before fees
          if (eventData.available_collateral && !trade.collateral) {
            trade.collateral = parseFloat(eventData.available_collateral);
          }
          if (eventData.action === "SendToTrader") {
            trade.type = "close";
          }
        }
        
        // Handle trade borrowing - extract direction
        if (eventType.includes("handle_trade_borrowing")) {
          if (eventData.long !== undefined) {
            trade.direction = eventData.long === "true" || eventData.long === true ? "long" : "short";
          }
        }

        // Process closing fees - get the original collateral amount
        if (eventType.includes("process_closing_fees")) {
          trade.type = "close";
          // Calculate total fees
          const closingFee = eventData.final_closing_fee ? parseFloat(eventData.final_closing_fee) : 0;
          const triggerFee = eventData.final_trigger_fee ? parseFloat(eventData.final_trigger_fee) : 0;
          trade.fees = closingFee + triggerFee;
          
          // collateral_left is after closing fees are taken
          if (eventData.collateral_left) {
            const collateralAfterFees = parseFloat(eventData.collateral_left);
            // Calculate original collateral: what they had before fees were deducted
            trade.collateral = collateralAfterFees + trade.fees;
          }
        }

        // Unregister trade (close)
        if (eventType.includes("unregister_trade")) {
          trade.type = "close";
          if (eventData.trade_value_collateral) {
            trade.pnlAmount = parseFloat(eventData.trade_value_collateral);
          }
          if (eventData.trade_index) {
            trade.tradeIndex = String(eventData.trade_index);
          }
          // Calculate P&L from collateral values
          if (eventData.collateral_left_in_storage && eventData.trade_value_collateral) {
            const collateralLeft = parseFloat(eventData.collateral_left_in_storage);
            const tradeValue = parseFloat(eventData.trade_value_collateral);
            // Estimate original collateral (before fees)
            const totalFees = (eventData.vault_closing_fee ? parseFloat(eventData.vault_closing_fee) : 0) +
                             (eventData.trigger_fee_collateral ? parseFloat(eventData.trigger_fee_collateral) : 0) +
                             (eventData.gov_fee ? parseFloat(eventData.gov_fee) : 0);
            const originalCollateral = collateralLeft + totalFees;
            if (originalCollateral > 0) {
              trade.profitPct = (tradeValue - originalCollateral) / originalCollateral;
            }
          }
        }
        
        // Update OI events for direction
        if (eventType.includes("update_pair_oi") || eventType.includes("update_group_oi")) {
          if (eventData.long !== undefined && eventData.open === "false") {
            // This is a close event, use the direction
            trade.direction = eventData.long === "true" || eventData.long === true ? "long" : "short";
          }
        }
      }

      // Calculate P&L if not already set from user_close_order event
      // Only fall back to proxy calculation if we don't have actual profit_pct
      if (trade.type === "close" && trade.profitPct === undefined && trade.pnlAmount && trade.collateral && trade.collateral > 0) {
        // Fallback proxy: (what they received - original collateral) / original collateral
        // Note: This is a rough estimate, not actual trade P&L
        trade.profitPct = (trade.pnlAmount - trade.collateral) / trade.collateral;
      }

      trades.push(trade);
    }

  } catch (error) {
    console.error("Error fetching transactions:", error);
  }

  // Sort by timestamp descending
  trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  return trades;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Get trades for an address
  app.get("/api/trades", async (req, res) => {
    const address = req.query.address as string;
    const network = (req.query.network as string) || "mainnet";
    
    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid EVM address format" });
    }

    // Validate network
    if (network !== "mainnet" && network !== "testnet") {
      return res.status(400).json({ error: "Invalid network. Use 'mainnet' or 'testnet'" });
    }

    const networkConfig = NETWORKS[network as keyof typeof NETWORKS];

    try {
      const trades = await getAddressTransactions(networkConfig.rpc, address);
      
      // Calculate stats
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
