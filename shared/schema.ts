import { z } from "zod";

// Trade types for Sai Perps
export const tradeSchema = z.object({
  txHash: z.string(),
  timestamp: z.string(),
  type: z.enum(["open", "close"]),
  pair: z.string().optional(),
  direction: z.enum(["long", "short"]).optional(),
  leverage: z.number().optional(),
  collateral: z.number().optional(),
  openPrice: z.number().optional(),
  closePrice: z.number().optional(),
  profitPct: z.number().optional(),
  pnlAmount: z.number().optional(),
  tradeIndex: z.string().optional(),
  openTimestamp: z.string().optional(),
  closeTimestamp: z.string().optional(),
  openingFee: z.number().optional(),
  closingFee: z.number().optional(),
  borrowingFee: z.number().optional(),
  triggerFee: z.number().optional(),
  totalFees: z.number().optional(),
});

export type Trade = z.infer<typeof tradeSchema>;

export const addressQuerySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address"),
});

export type AddressQuery = z.infer<typeof addressQuerySchema>;

export interface TradesResponse {
  address: string;
  trades: Trade[];
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  explorer?: string;
  pagination?: {
    currentPage: number;
    hasMore: boolean;
    fromBlock: number;
    toBlock: number;
    latestBlock: number;
  };
}
