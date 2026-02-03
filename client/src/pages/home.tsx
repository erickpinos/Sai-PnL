import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, TrendingUp, TrendingDown, Activity, Loader2, Wallet, ChevronDown, Target, ShieldAlert, Link2, Share2, Eye, EyeOff } from "lucide-react";
import html2canvas from "html2canvas";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isMetaMask?: boolean;
    };
  }
}
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TradesResponse, Trade, OpenPositionsResponse, OpenPosition, GlobalStatsResponse, VaultPositionsResponse, VaultPosition } from "@shared/schema";

const addressSchema = z.object({
  address: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/i, "Please enter a valid EVM address")
    .transform(addr => addr.toLowerCase()),
});

type AddressForm = z.infer<typeof addressSchema>;
type PnlDisplayMode = "dollars" | "percent";

function StatsCard({ 
  title, 
  value, 
  icon: Icon, 
  trend,
  loading,
  onToggle,
  toggleLabel,
  onToggle2,
  toggleLabel2,
}: { 
  title: string; 
  value: string; 
  icon: typeof TrendingUp;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
  onToggle2?: () => void;
  toggleLabel2?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CardDescription className="text-sm font-medium">{title}</CardDescription>
          {onToggle && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-6 px-2 text-xs"
              onClick={onToggle}
              data-testid="button-toggle-pnl"
            >
              {toggleLabel}
            </Button>
          )}
          {onToggle2 && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-6 px-2 text-xs"
              onClick={onToggle2}
              data-testid="button-toggle-fees"
            >
              {toggleLabel2}
            </Button>
          )}
        </div>
        <Icon className={`h-4 w-4 ${
          trend === "up" ? "text-emerald-500" : 
          trend === "down" ? "text-red-500" : 
          "text-muted-foreground"
        }`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className={`text-2xl font-bold ${
            trend === "up" ? "text-emerald-500" : 
            trend === "down" ? "text-red-500" : 
            "text-foreground"
          }`}>
            {value}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TradesTable({ trades, loading, pnlDisplayMode, onShare, hideValues }: { trades: Trade[]; loading: boolean; pnlDisplayMode: PnlDisplayMode; onShare?: (trade: Trade) => void; hideValues?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Activity className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg">No trades found for this address</p>
        <p className="text-sm">Try a different address or check back later</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            <TableHead>Pair</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead className="text-right">Leverage</TableHead>
            <TableHead className="text-right">Entry Price</TableHead>
            <TableHead className="text-right">Exit Price</TableHead>
            <TableHead className="text-right">Collateral</TableHead>
            <TableHead className="text-right">{pnlDisplayMode === "percent" ? "PnL %" : "PnL $"}</TableHead>
            <TableHead className="text-right">Returned</TableHead>
            <TableHead className="text-right">Opening Fee</TableHead>
            <TableHead className="text-right">Closing Fee</TableHead>
            <TableHead className="text-right">Borrowing Fee</TableHead>
            <TableHead className="text-right">Trigger Fee</TableHead>
            <TableHead className="text-right">Net After Fees</TableHead>
            <TableHead>Time Opened</TableHead>
            <TableHead>Time Closed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow key={trade.txHash} data-testid={`row-trade-${trade.txHash.slice(0, 8)}`}>
              <TableCell>
                {onShare && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onShare(trade)}
                    data-testid={`button-share-trade-${trade.txHash.slice(0, 8)}`}
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
              <TableCell className="font-medium">
                {trade.pair || "-"}
              </TableCell>
              <TableCell>
                {trade.direction && (
                  <Badge 
                    variant="outline"
                    className={trade.direction === "long" 
                      ? "border-emerald-500/50 text-emerald-500" 
                      : "border-red-500/50 text-red-500"
                    }
                  >
                    {trade.direction === "long" ? (
                      <TrendingUp className="h-3 w-3 mr-1" />
                    ) : (
                      <TrendingDown className="h-3 w-3 mr-1" />
                    )}
                    {trade.direction.toUpperCase()}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {trade.leverage ? `${trade.leverage}x` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {trade.openPrice ? `$${trade.openPrice.toLocaleString()}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {trade.closePrice ? `$${trade.closePrice.toLocaleString()}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {hideValues ? "•••••" : (trade.collateral ? `$${trade.collateral.toFixed(2)}` : "-")}
              </TableCell>
              <TableCell className="text-right">
                {pnlDisplayMode === "percent" ? (
                  trade.profitPct !== undefined ? (
                    <span className={`font-semibold ${
                      trade.profitPct >= 0 ? "text-emerald-500" : "text-red-500"
                    }`}>
                      {trade.profitPct >= 0 ? "+" : ""}{(trade.profitPct * 100).toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )
                ) : (
                  hideValues ? (
                    <span className="text-muted-foreground">•••••</span>
                  ) : trade.pnlAmount !== undefined ? (
                    <span className={`font-semibold ${
                      trade.pnlAmount >= 0 ? "text-emerald-500" : "text-red-500"
                    }`}>
                      {trade.pnlAmount >= 0 ? "+" : ""}${trade.pnlAmount.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {hideValues ? "•••••" : (trade.amountReceived !== undefined ? `$${trade.amountReceived.toFixed(2)}` : "-")}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {trade.openingFee !== undefined ? `$${trade.openingFee.toFixed(4)}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {trade.closingFee !== undefined ? `$${trade.closingFee.toFixed(4)}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {trade.borrowingFee !== undefined ? `$${trade.borrowingFee.toFixed(4)}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {trade.triggerFee !== undefined && trade.triggerFee > 0 ? `$${trade.triggerFee.toFixed(4)}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {hideValues ? "•••••" : (trade.amountReceived !== undefined && trade.totalFees !== undefined 
                  ? `$${(trade.amountReceived - trade.totalFees).toFixed(2)}`
                  : "-")}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {trade.openTimestamp ? new Date(trade.openTimestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }) : "-"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {trade.closeTimestamp ? new Date(trade.closeTimestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }) : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OpenPositionsTable({ positions, isLoading, onShare, hideValues }: { positions: OpenPosition[]; isLoading: boolean; onShare?: (position: OpenPosition) => void; hideValues?: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No open positions found
      </div>
    );
  }

  const formatPrice = (price: number | null | undefined) => {
    if (price === null || price === undefined) return "-";
    if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return `$${price.toFixed(4)}`;
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            <TableHead>Pair</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead className="text-right">Collateral</TableHead>
            <TableHead className="text-right">Entry Price</TableHead>
            <TableHead className="text-right">Mark Price</TableHead>
            <TableHead className="text-right">Liq. Price</TableHead>
            <TableHead className="text-right">
              <div className="flex items-center justify-end gap-1">
                <ShieldAlert className="h-3 w-3" />
                Stop Loss
              </div>
            </TableHead>
            <TableHead className="text-right">
              <div className="flex items-center justify-end gap-1">
                <Target className="h-3 w-3" />
                Take Profit
              </div>
            </TableHead>
            <TableHead className="text-right">Unrealized P&L</TableHead>
            <TableHead className="text-right">Borrowing Fee</TableHead>
            <TableHead>Opened</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((position) => {
            const pnlColor = (position.unrealizedPnlPct ?? 0) >= 0 ? "text-green-500" : "text-red-500";
            
            const markPrice = position.unrealizedPnlPct !== undefined && position.leverage > 0
              ? position.direction === "long"
                ? position.entryPrice * (1 + position.unrealizedPnlPct / position.leverage)
                : position.entryPrice * (1 - position.unrealizedPnlPct / position.leverage)
              : undefined;
            
            return (
              <TableRow key={position.tradeId} data-testid={`row-position-${position.tradeId}`}>
                <TableCell>
                  {onShare && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onShare(position)}
                      data-testid={`button-share-position-${position.tradeId}`}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
                <TableCell className="font-medium">{position.pair}</TableCell>
                <TableCell>
                  <Badge variant={position.direction === "long" ? "default" : "secondary"}>
                    {position.direction.toUpperCase()} {position.leverage}x
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {hideValues ? "•••••" : `$${position.collateral.toFixed(2)}`}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatPrice(position.entryPrice)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatPrice(markPrice)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {formatPrice(position.liquidationPrice)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatPrice(position.stopLoss)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatPrice(position.takeProfit)}
                </TableCell>
                <TableCell className={`text-right font-mono text-sm ${pnlColor}`}>
                  {hideValues ? (
                    <span className="text-muted-foreground">•••••</span>
                  ) : position.unrealizedPnl !== undefined ? (
                    <>
                      {position.unrealizedPnl >= 0 ? "+" : "-"}${Math.abs(position.unrealizedPnl).toFixed(2)}
                      <span className="text-xs ml-1">
                        ({position.unrealizedPnlPct !== undefined 
                          ? `${position.unrealizedPnlPct >= 0 ? "+" : ""}${(position.unrealizedPnlPct * 100).toFixed(2)}%` 
                          : "-"})
                      </span>
                    </>
                  ) : "-"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {position.borrowingFee !== undefined ? `$${position.borrowingFee.toFixed(4)}` : "-"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(position.openedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

type Network = "mainnet" | "testnet";

const NETWORK_CONFIG = {
  mainnet: { label: "Mainnet", explorer: "https://nibiscan.io" },
  testnet: { label: "Testnet", explorer: "https://testnet.nibiscan.io" },
};

export default function Home() {
  const [searchAddress, setSearchAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<Network>("mainnet");
  const [pnlDisplayMode, setPnlDisplayMode] = useState<PnlDisplayMode>("percent");
  const [showAfterFees, setShowAfterFees] = useState(false);
  const [activeTab, setActiveTab] = useState<"trades" | "positions" | "vaults" | "stats">("trades");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [addressHidden, setAddressHidden] = useState(false);
  const statsCardRef = useRef<HTMLDivElement>(null);
  
  const form = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      address: "",
    },
  });

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask or Rabby Wallet to connect");
      return;
    }
    
    try {
      setIsConnecting(true);
      const accounts = await window.ethereum.request({ 
        method: "eth_requestAccounts" 
      }) as string[];
      
      if (accounts && accounts.length > 0) {
        const address = accounts[0].toLowerCase();
        setConnectedWallet(address);
        form.setValue("address", address);
        form.handleSubmit(onSubmit)();
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setConnectedWallet(null);
    setSearchAddress(null);
    form.reset();
  };

  const downloadStatsCard = async () => {
    if (!statsCardRef.current || !searchAddress) return;
    
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(statsCardRef.current, {
        backgroundColor: "#1a1a2e",
        scale: 2,
        logging: false,
        useCORS: true,
      });
      
      const link = document.createElement("a");
      link.download = `sai-perps-stats-${searchAddress.slice(0, 8)}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      console.error("Failed to download stats card:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadGlobalStatsCard = async () => {
    if (!globalStatsData?.stats) return;
    
    const stats = globalStatsData.stats;
    const lsRatio = stats.shortOpenInterest > 0 
      ? (stats.longOpenInterest / stats.shortOpenInterest).toFixed(2)
      : stats.longOpenInterest > 0 ? "∞" : "-";
    
    const html = `
      <div style="padding: 24px; border-radius: 12px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; font-family: system-ui, -apple-system, sans-serif; width: 400px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <h3 style="margin: 0; font-size: 20px; font-weight: bold; color: white;">Sai Perps Protocol Stats</h3>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">${network === "mainnet" ? "Mainnet" : "Testnet"}</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8;">TVL</p>
            <p style="margin: 0; font-size: 22px; font-weight: bold; color: #60a5fa; font-family: monospace;">$${stats.totalTvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Total Open Interest</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white; font-family: monospace;">$${stats.totalOpenInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Open Positions</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white;">${stats.totalOpenPositions.toLocaleString()}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Long OI</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #4ade80; font-family: monospace;">$${stats.longOpenInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Short OI</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #f87171; font-family: monospace;">$${stats.shortOpenInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8); grid-column: span 2;">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Long/Short Ratio</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white; font-family: monospace;">${lsRatio}</p>
          </div>
        </div>
        <p style="margin: 16px 0 0 0; text-align: center; font-size: 11px; color: #64748b;">sai.nibiru.fi • ${new Date().toLocaleDateString()}</p>
      </div>
    `;
    
    await showShareModal(html);
  };

  const showShareModal = async (htmlContent: string) => {
    const container = document.createElement("div");
    container.innerHTML = htmlContent;
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.width = "1200px";
    container.style.height = "675px";
    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        backgroundColor: "#0f172a",
        scale: 2,
        logging: false,
        useCORS: true,
      });
      
      const imageUrl = canvas.toDataURL("image/png");
      setShareImageUrl(imageUrl);
      setShareModalOpen(true);
    } catch (error) {
      console.error("Failed to generate share image:", error);
    } finally {
      document.body.removeChild(container);
    }
  };

  const downloadTradeCard = (trade: Trade) => {
    const pnlColor = (trade.pnlAmount ?? 0) >= 0 ? "#4ade80" : "#f87171";
    const directionColor = trade.direction === "long" ? "#4ade80" : "#f87171";
    
    // Calculate duration
    let durationText = "-";
    if (trade.openTimestamp && trade.closeTimestamp) {
      const openDate = new Date(trade.openTimestamp);
      const closeDate = new Date(trade.closeTimestamp);
      const diffMs = closeDate.getTime() - openDate.getTime();
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      const parts = [];
      if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
      if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
      if (minutes > 0 || parts.length === 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
      durationText = parts.join(" ");
    }
    
    const html = `
      <div style="width: 1200px; height: 675px; padding: 48px; border-radius: 16px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; font-family: system-ui, -apple-system, sans-serif; box-sizing: border-box; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;">
          <div>
            <h3 style="margin: 0; font-size: 36px; font-weight: bold; color: white;">Sai Perps Trade</h3>
            <p style="margin: 8px 0 0 0; font-size: 18px; color: #94a3b8;">${network === "mainnet" ? "Mainnet" : "Testnet"}</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 18px; color: #94a3b8;">P&L</p>
            <p style="margin: 0; font-size: 48px; font-weight: bold; color: ${pnlColor}; font-family: monospace;">
              ${(trade.pnlAmount ?? 0) >= 0 ? "+" : ""}$${(trade.pnlAmount ?? 0).toFixed(2)}
            </p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; flex: 1;">
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Pair</p>
            <p style="margin: 0; font-size: 28px; font-weight: bold; color: white;">${trade.pair || "-"}</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Direction</p>
            <p style="margin: 0; font-size: 28px; font-weight: bold; color: ${directionColor};">${trade.direction?.toUpperCase() || "-"} ${trade.leverage}x</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Entry</p>
            <p style="margin: 0; font-size: 28px; font-weight: bold; color: white; font-family: monospace;">$${trade.openPrice?.toLocaleString() || "-"}</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Exit</p>
            <p style="margin: 0; font-size: 28px; font-weight: bold; color: white; font-family: monospace;">$${trade.closePrice?.toLocaleString() || "-"}</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Return</p>
            <p style="margin: 0; font-size: 28px; font-weight: bold; color: ${pnlColor}; font-family: monospace;">${(trade.profitPct ?? 0) >= 0 ? "+" : ""}${((trade.profitPct ?? 0) * 100).toFixed(2)}%</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Opened</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: white;">${trade.openTimestamp ? new Date(trade.openTimestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-"}</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Closed</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: white;">${trade.closeTimestamp ? new Date(trade.closeTimestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-"}</p>
          </div>
          <div style="padding: 24px; border-radius: 12px; background: rgba(30, 41, 59, 0.8); display: flex; flex-direction: column; justify-content: center;">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #94a3b8;">Duration</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: white;">${durationText}</p>
          </div>
        </div>
      </div>
    `;
    showShareModal(html);
  };

  const downloadPositionCard = (position: OpenPosition) => {
    const pnlColor = (position.unrealizedPnlPct ?? 0) >= 0 ? "#4ade80" : "#f87171";
    const directionColor = position.direction === "long" ? "#4ade80" : "#f87171";
    const html = `
      <div style="padding: 24px; border-radius: 12px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; font-family: system-ui, -apple-system, sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: bold; color: white;">Sai Perps Position</h3>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">${network === "mainnet" ? "Mainnet" : "Testnet"} • Open</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8;">Unrealized P&L</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: ${pnlColor}; font-family: monospace;">
              ${(position.unrealizedPnl ?? 0) >= 0 ? "+" : ""}$${Math.abs(position.unrealizedPnl ?? 0).toFixed(2)}
            </p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Pair</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white;">${position.pair}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Direction</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: ${directionColor};">${position.direction.toUpperCase()} ${position.leverage}x</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Entry Price</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white; font-family: monospace;">$${position.entryPrice.toLocaleString()}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Collateral</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white; font-family: monospace;">$${position.collateral.toFixed(2)}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Liq. Price</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #94a3b8; font-family: monospace;">$${position.liquidationPrice?.toLocaleString() || "-"}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Return</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: ${pnlColor}; font-family: monospace;">${(position.unrealizedPnlPct ?? 0) >= 0 ? "+" : ""}${((position.unrealizedPnlPct ?? 0) * 100).toFixed(2)}%</p>
          </div>
        </div>
      </div>
    `;
    showShareModal(html);
  };

  const downloadVaultCard = (position: VaultPosition) => {
    const earningsColor = position.earnings >= 0 ? "#4ade80" : "#f87171";
    const actionColor = position.action === "deposit" ? "#4ade80" : "#fb923c";
    const html = `
      <div style="padding: 24px; border-radius: 12px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; font-family: system-ui, -apple-system, sans-serif;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: bold; color: white;">Sai Vault Position</h3>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">${network === "mainnet" ? "Mainnet" : "Testnet"} • SLP-${position.vaultSymbol}</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8;">Earnings</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: ${earningsColor}; font-family: monospace;">
              ${position.action === "withdraw" ? "Realized" : `${position.earnings >= 0 ? "+" : ""}$${position.earnings.toFixed(4)}`}
            </p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Type</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: ${actionColor};">${position.action === "deposit" ? "Deposit" : "Withdraw"}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Amount</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white; font-family: monospace;">${position.depositAmount.toFixed(2)} ${position.vaultSymbol}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Shares</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white; font-family: monospace;">${position.shares.toFixed(4)}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">APY</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #60a5fa; font-family: monospace;">${position.apy.toFixed(2)}%</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Date</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: white;">${position.depositDate ? new Date(position.depositDate).toLocaleDateString() : "-"}</p>
          </div>
          <div style="padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.8);">
            <p style="margin: 0 0 4px 0; font-size: 11px; color: #94a3b8;">Return</p>
            <p style="margin: 0; font-size: 16px; font-weight: bold; color: ${earningsColor}; font-family: monospace;">${position.action === "withdraw" ? "-" : `+${position.earningsPercent.toFixed(2)}%`}</p>
          </div>
        </div>
      </div>
    `;
    showShareModal(html);
  };

  const abridgeAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const { data, isLoading, isFetching, error } = useQuery<TradesResponse>({
    queryKey: ["/api/trades", searchAddress, network],
    queryFn: async () => {
      const res = await fetch(`/api/trades?address=${searchAddress}&network=${network}&limit=500`);
      if (!res.ok) throw new Error("Failed to fetch trades");
      return res.json();
    },
    enabled: !!searchAddress,
  });

  const { data: positionsData, isLoading: positionsLoading, isFetching: positionsFetching } = useQuery<OpenPositionsResponse>({
    queryKey: ["/api/positions", searchAddress, network],
    queryFn: async () => {
      const res = await fetch(`/api/positions?address=${searchAddress}&network=${network}`);
      if (!res.ok) throw new Error("Failed to fetch positions");
      return res.json();
    },
    enabled: !!searchAddress,
  });

  const { data: vaultPositionsData, isLoading: vaultPositionsLoading } = useQuery<VaultPositionsResponse>({
    queryKey: ["/api/vault-positions", searchAddress, network],
    queryFn: async () => {
      const res = await fetch(`/api/vault-positions?address=${searchAddress}&network=${network}`);
      if (!res.ok) throw new Error("Failed to fetch vault positions");
      return res.json();
    },
    enabled: !!searchAddress,
  });

  const { data: globalStatsData, isLoading: globalStatsLoading } = useQuery<GlobalStatsResponse>({
    queryKey: ["/api/stats", network],
    queryFn: async () => {
      const res = await fetch(`/api/stats?network=${network}`);
      if (!res.ok) throw new Error("Failed to fetch global stats");
      return res.json();
    },
  });

  const isSearching = isFetching || positionsFetching;

  const trades = data?.trades || [];
  const positions = positionsData?.positions || [];

  const addressValue = form.watch("address");
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/i.test(addressValue);

  const onSubmit = (values: AddressForm) => {
    queryClient.invalidateQueries({ queryKey: ["/api/trades", values.address, network] });
    queryClient.invalidateQueries({ queryKey: ["/api/positions", values.address, network] });
    setSearchAddress(values.address);
  };

  const handleNetworkChange = (newNetwork: Network) => {
    setNetwork(newNetwork);
  };

  // Calculate stats from trades
  const closeTrades = trades.filter(t => t.type === "close" && t.profitPct !== undefined);
  const wins = closeTrades.filter(t => (t.profitPct ?? 0) > 0).length;
  const winRate = closeTrades.length > 0 ? wins / closeTrades.length : 0;
  const totalPnlPct = closeTrades.reduce((sum, t) => sum + (t.profitPct ?? 0), 0);
  const totalPnlDollars = closeTrades.reduce((sum, t) => sum + (t.pnlAmount ?? 0), 0);
  const totalFees = closeTrades.reduce((sum, t) => sum + (t.totalFees ?? 0), 0);
  const totalCollateral = closeTrades.reduce((sum, t) => sum + (t.collateral ?? 0), 0);
  const totalPnlAfterFees = totalPnlDollars - totalFees;
  const totalPnlAfterFeesPct = totalCollateral > 0 ? totalPnlAfterFees / totalCollateral : 0;
  const displayPnl = showAfterFees ? totalPnlAfterFees : totalPnlDollars;
  const displayPnlPct = showAfterFees ? totalPnlAfterFeesPct : totalPnlPct;
  const pnlTrend = displayPnl > 0 ? "up" : displayPnl < 0 ? "down" : "neutral";
  
  const togglePnlMode = () => {
    setPnlDisplayMode(prev => prev === "percent" ? "dollars" : "percent");
  };
  
  const toggleAfterFees = () => {
    setShowAfterFees(prev => !prev);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/20 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Sai Perps Tracker</h1>
              <p className="text-xs text-muted-foreground">Nibiru</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-2" data-testid="dropdown-network">
                  <span className={`w-2 h-2 rounded-full ${network === "mainnet" ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`} />
                  {NETWORK_CONFIG[network].label}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  onClick={() => handleNetworkChange("mainnet")}
                  data-testid="menu-item-mainnet"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                  Mainnet
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => handleNetworkChange("testnet")}
                  data-testid="menu-item-testnet"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                  Testnet
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {connectedWallet ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="font-mono text-xs gap-2" data-testid="button-wallet-connected">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    {addressHidden ? "••••••••••" : abridgeAddress(connectedWallet)}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem 
                    onClick={disconnectWallet}
                    data-testid="menu-item-disconnect"
                  >
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button 
                onClick={connectWallet} 
                disabled={isConnecting || isSearching}
                size="sm"
                data-testid="button-connect-wallet"
              >
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Connect Wallet
              </Button>
            )}
            {/* Hide Address Toggle */}
            {searchAddress && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setAddressHidden(!addressHidden)}
                title={addressHidden ? "Show address" : "Hide address"}
                data-testid="button-toggle-address-visibility"
              >
                {addressHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Search Section */}
        <div className="max-w-3xl mx-auto mb-10">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-3">Track Your PnL</h2>
            <p className="text-muted-foreground">
              Connect your wallet or enter your Nibiru address to view your Sai Perps trading history and profit/loss per trade
            </p>
          </div>

          <Card>
            <CardContent className="pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-3">
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem className="flex-1 relative">
                        <FormControl>
                          <div className="relative">
                            <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="0x0000000000000000000000000000000000000000"
                              className="pl-10 font-mono text-sm"
                              data-testid="input-address"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <div className="absolute -bottom-5 left-0">
                          <FormMessage className="text-xs" />
                        </div>
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isSearching || !isValidAddress} data-testid="button-search">
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    <span className="ml-2">Search</span>
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Error State */}
        {error && (
          <Card className="max-w-3xl mx-auto mb-8 border-destructive/50">
            <CardContent className="pt-6">
              <p className="text-destructive text-center">
                Failed to fetch trades. Please check the address and try again.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {(searchAddress || isLoading) && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <StatsCard
                title="Total PnL"
                value={trades.length > 0 
                  ? pnlDisplayMode === "percent"
                    ? `${displayPnlPct >= 0 ? "+" : ""}${(displayPnlPct * 100).toFixed(2)}%`
                    : addressHidden 
                      ? "•••••"
                      : `${displayPnl >= 0 ? "+" : "-"}$${Math.abs(displayPnl).toFixed(2)}`
                  : "-"}
                icon={displayPnl >= 0 ? TrendingUp : TrendingDown}
                trend={pnlTrend}
                loading={isLoading}
                onToggle={togglePnlMode}
                toggleLabel={pnlDisplayMode === "percent" ? "%" : "$"}
                onToggle2={toggleAfterFees}
                toggleLabel2={showAfterFees ? "After Fees" : "Before Fees"}
              />
              <StatsCard
                title="Win Rate"
                value={trades.length > 0 ? `${(winRate * 100).toFixed(1)}%` : "-"}
                icon={Activity}
                trend={winRate >= 0.5 ? "up" : "neutral"}
                loading={isLoading}
              />
              <StatsCard
                title="Total Trades"
                value={trades.length > 0 ? trades.length.toString() : "-"}
                icon={Activity}
                trend="neutral"
                loading={isLoading}
              />
            </div>

            {/* Tabs for Trades, Positions, and Stats */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "trades" | "positions" | "vaults" | "stats")} className="w-full">
              <TabsList className="grid w-full max-w-2xl grid-cols-4">
                <TabsTrigger value="trades" data-testid="tab-trades">
                  Trade History {trades.length > 0 && `(${trades.length})`}
                </TabsTrigger>
                <TabsTrigger value="positions" data-testid="tab-positions">
                  Open Positions {positions.length > 0 && `(${positions.length})`}
                </TabsTrigger>
                <TabsTrigger value="vaults" data-testid="tab-vaults">
                  My Vaults {vaultPositionsData?.positions && vaultPositionsData.positions.length > 0 && `(${vaultPositionsData.positions.length})`}
                </TabsTrigger>
                <TabsTrigger value="stats" data-testid="tab-stats">
                  Stats
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="trades" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Trade History</CardTitle>
                    <CardDescription>
                      {searchAddress && (
                        <span className="font-mono text-xs">
                          {addressHidden ? "••••••••••" : `${searchAddress.slice(0, 6)}...${searchAddress.slice(-4)}`}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TradesTable trades={trades.filter(t => t.type === "close")} loading={isLoading} pnlDisplayMode={pnlDisplayMode} onShare={downloadTradeCard} hideValues={addressHidden} />
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="positions" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Open Positions</CardTitle>
                    <CardDescription>
                      {positions.length > 0 
                        ? `${positions.length} active position${positions.length > 1 ? "s" : ""}`
                        : "No open positions"
                      }
                      {positionsData?.totalUnrealizedPnl !== undefined && positions.length > 0 && (
                        <span className={`ml-2 font-mono ${positionsData.totalUnrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                          Unrealized: {positionsData.totalUnrealizedPnl >= 0 ? "+" : "-"}${Math.abs(positionsData.totalUnrealizedPnl).toFixed(2)}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <OpenPositionsTable positions={positions} isLoading={positionsLoading} onShare={downloadPositionCard} hideValues={addressHidden} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="vaults" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>My Vault Positions</CardTitle>
                    <CardDescription>
                      {vaultPositionsData?.positions && vaultPositionsData.positions.length > 0 
                        ? `${vaultPositionsData.positions.length} vault deposit${vaultPositionsData.positions.length > 1 ? "s" : ""}`
                        : "No vault deposits found"
                      }
                      {vaultPositionsData?.totalEarnings !== undefined && vaultPositionsData.positions.length > 0 && vaultPositionsData.totalDeposited > 0 && (
                        <span className={`ml-2 font-mono ${vaultPositionsData.totalEarnings >= 0 ? "text-green-500" : "text-red-500"}`}>
                          Earnings: {vaultPositionsData.totalEarnings >= 0 ? "+" : ""}{vaultPositionsData.totalEarnings < 1 ? vaultPositionsData.totalEarnings.toFixed(4) : vaultPositionsData.totalEarnings.toFixed(2)} ({((vaultPositionsData.totalEarnings / vaultPositionsData.totalDeposited) * 100).toFixed(2)}%)
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {vaultPositionsLoading ? (
                      <div className="space-y-3">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : vaultPositionsData?.positions && vaultPositionsData.positions.length > 0 ? (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead></TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Vault</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Shares</TableHead>
                              <TableHead>Current Value</TableHead>
                              <TableHead>Earnings</TableHead>
                              <TableHead>APY</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead>Tx</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {vaultPositionsData.positions.map((position, index) => (
                              <TableRow key={`${position.vaultSymbol}-${index}`} data-testid={`vault-row-${index}`} className={position.action === "withdraw" ? "opacity-70" : ""}>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => downloadVaultCard(position)}
                                    data-testid={`button-share-vault-${index}`}
                                  >
                                    <Share2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                                <TableCell>
                                  <Badge 
                                    variant={position.action === "deposit" ? "default" : "secondary"}
                                    className={`font-mono text-xs ${position.action === "withdraw" ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"}`}
                                  >
                                    {position.action === "deposit" ? "Deposit" : "Withdraw"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="font-mono">
                                    SLP-{position.vaultSymbol}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono">
                                  {position.action === "withdraw" ? "-" : ""}
                                  {position.depositAmount < 1 
                                    ? position.depositAmount.toFixed(4) 
                                    : position.depositAmount.toFixed(2)
                                  } {position.vaultSymbol}
                                </TableCell>
                                <TableCell className="font-mono text-muted-foreground">
                                  {position.action === "withdraw" ? "-" : ""}
                                  {position.shares < 1 
                                    ? position.shares.toFixed(4) 
                                    : position.shares.toFixed(2)
                                  }
                                </TableCell>
                                <TableCell className="font-mono">
                                  {position.action === "withdraw" ? (
                                    <span className="text-muted-foreground">-</span>
                                  ) : (
                                    <>
                                      {position.currentValue < 1 
                                        ? position.currentValue.toFixed(4) 
                                        : position.currentValue.toFixed(2)
                                      } {position.vaultSymbol}
                                    </>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {position.action === "withdraw" ? (
                                    <span className="text-muted-foreground text-xs">Realized</span>
                                  ) : (
                                    <span className={`font-mono ${position.earnings >= 0 ? "text-green-500" : "text-red-500"}`}>
                                      {position.earnings >= 0 ? "+" : ""}
                                      {position.earnings < 0.01 && position.earnings > -0.01 
                                        ? position.earnings.toFixed(6)
                                        : position.earnings.toFixed(4)
                                      }
                                      <span className="text-xs text-muted-foreground ml-1">
                                        ({position.earningsPercent >= 0 ? "+" : ""}{position.earningsPercent.toFixed(2)}%)
                                      </span>
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <span className="font-mono text-primary">
                                    {position.apy.toFixed(2)}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {position.depositDate ? new Date(position.depositDate).toLocaleDateString() : "-"}
                                </TableCell>
                                <TableCell>
                                  {position.evmTxHash && (
                                    <a
                                      href={`https://nibiscan.io/tx/${position.evmTxHash}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-primary hover:underline font-mono text-xs"
                                      data-testid={`vault-tx-link-${index}`}
                                    >
                                      {position.evmTxHash.slice(0, 8)}...
                                    </a>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        {/* Totals Summary */}
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">Total Deposited</p>
                              <p className="font-mono font-medium">
                                ${vaultPositionsData.totalDeposited.toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Current Value</p>
                              <p className="font-mono font-medium">
                                ${vaultPositionsData.totalCurrentValue.toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Total Earnings</p>
                              <p className={`font-mono font-medium ${vaultPositionsData.totalEarnings >= 0 ? "text-green-500" : "text-red-500"}`}>
                                {vaultPositionsData.totalEarnings >= 0 ? "+" : ""}${vaultPositionsData.totalEarnings.toFixed(4)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
                          <Wallet className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground">No vault deposits found for this address</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Deposit into SLP-USDC or SLP-stNIBI vaults to earn yield
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="stats" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>Trading Statistics</CardTitle>
                      <CardDescription>Personal trading performance metrics</CardDescription>
                    </div>
                    {trades.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadStatsCard}
                        disabled={isDownloading}
                        data-testid="button-share-stats"
                      >
                        {isDownloading ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Share2 className="h-4 w-4 mr-2" />
                        )}
                        Share
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <div className="space-y-3">
                        {[...Array(6)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : trades.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Activity className="h-12 w-12 mb-4 opacity-50" />
                        <p className="text-lg">No trading data available</p>
                      </div>
                    ) : (
                      <>
                        {/* Visible UI - original styling */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {(() => {
                            const allTrades = trades;
                            const closedTrades = trades.filter(t => t.type === "close");
                            
                            const totalVolume = allTrades.reduce((sum, t) => sum + (t.collateral ?? 0) * (t.leverage ?? 1), 0);
                            const avgTradeSize = allTrades.length > 0 ? allTrades.reduce((sum, t) => sum + (t.collateral ?? 0), 0) / allTrades.length : 0;
                            const avgLeverage = allTrades.length > 0 ? allTrades.reduce((sum, t) => sum + (t.leverage ?? 1), 0) / allTrades.length : 0;
                            
                            const profitTrades = closedTrades.filter(t => (t.pnlAmount ?? 0) > 0);
                            const lossTrades = closedTrades.filter(t => (t.pnlAmount ?? 0) < 0);
                            const biggestWin = profitTrades.length > 0 ? Math.max(...profitTrades.map(t => t.pnlAmount ?? 0)) : 0;
                            const biggestLoss = lossTrades.length > 0 ? Math.min(...lossTrades.map(t => t.pnlAmount ?? 0)) : 0;
                            
                            const pairCounts: Record<string, number> = {};
                            allTrades.forEach(t => {
                              const pair = t.pair ?? "Unknown";
                              pairCounts[pair] = (pairCounts[pair] || 0) + 1;
                            });
                            const mostTradedPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];
                            
                            const longTrades = allTrades.filter(t => t.direction === "long").length;
                            const shortTrades = allTrades.filter(t => t.direction === "short").length;
                            
                            const totalFeesPaid = closedTrades.reduce((sum, t) => sum + (t.totalFees ?? 0), 0);

                            return (
                              <>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Total Trading Volume</p>
                                  <p className="text-xl font-bold font-mono">${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Average Trade Size</p>
                                  <p className="text-xl font-bold font-mono">${avgTradeSize.toFixed(2)}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Average Leverage</p>
                                  <p className="text-xl font-bold font-mono">{avgLeverage.toFixed(1)}x</p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Biggest Win</p>
                                  <p className="text-xl font-bold font-mono text-green-500">
                                    {biggestWin > 0 ? `+$${biggestWin.toFixed(2)}` : "-"}
                                  </p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Biggest Loss</p>
                                  <p className="text-xl font-bold font-mono text-red-500">
                                    {biggestLoss < 0 ? `-$${Math.abs(biggestLoss).toFixed(2)}` : "-"}
                                  </p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Most Traded Pair</p>
                                  <p className="text-xl font-bold">{mostTradedPair ? `${mostTradedPair[0]} (${mostTradedPair[1]})` : "-"}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Long vs Short</p>
                                  <p className="text-xl font-bold">{longTrades} / {shortTrades}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Total Fees Paid</p>
                                  <p className="text-xl font-bold font-mono text-orange-500">${totalFeesPaid.toFixed(2)}</p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted/50">
                                  <p className="text-sm text-muted-foreground mb-1">Profit Factor</p>
                                  <p className="text-xl font-bold font-mono">
                                    {(() => {
                                      const totalProfit = profitTrades.reduce((sum, t) => sum + (t.pnlAmount ?? 0), 0);
                                      const totalLoss = Math.abs(lossTrades.reduce((sum, t) => sum + (t.pnlAmount ?? 0), 0));
                                      return totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : totalProfit > 0 ? "∞" : "-";
                                    })()}
                                  </p>
                                </div>
                              </>
                            );
                          })()}
                        </div>

                        {/* Hidden shareable card for download */}
                        <div ref={statsCardRef} className="absolute -left-[9999px] p-6 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700" style={{ width: '600px' }}>
                          <div className="flex items-center justify-between mb-6">
                            <div>
                              <h3 className="text-xl font-bold text-white">Sai Perps Trading Stats</h3>
                              <p className="text-sm text-slate-400">{searchAddress ? (addressHidden ? "••••••••••" : abridgeAddress(searchAddress)) : ""} • {network === "mainnet" ? "Mainnet" : "Testnet"}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-slate-400">Total PnL</p>
                              <p className={`text-2xl font-bold font-mono ${(data?.totalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {(data?.totalPnl ?? 0) >= 0 ? "+" : "-"}${Math.abs(data?.totalPnl ?? 0).toFixed(2)}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {(() => {
                              const allTrades = trades;
                              const closedTrades = trades.filter(t => t.type === "close");
                              
                              const totalVolume = allTrades.reduce((sum, t) => sum + (t.collateral ?? 0) * (t.leverage ?? 1), 0);
                              const avgTradeSize = allTrades.length > 0 ? allTrades.reduce((sum, t) => sum + (t.collateral ?? 0), 0) / allTrades.length : 0;
                              const avgLeverage = allTrades.length > 0 ? allTrades.reduce((sum, t) => sum + (t.leverage ?? 1), 0) / allTrades.length : 0;
                              
                              const profitTrades = closedTrades.filter(t => (t.pnlAmount ?? 0) > 0);
                              const lossTrades = closedTrades.filter(t => (t.pnlAmount ?? 0) < 0);
                              const biggestWin = profitTrades.length > 0 ? Math.max(...profitTrades.map(t => t.pnlAmount ?? 0)) : 0;
                              const biggestLoss = lossTrades.length > 0 ? Math.min(...lossTrades.map(t => t.pnlAmount ?? 0)) : 0;
                              
                              const pairCounts: Record<string, number> = {};
                              allTrades.forEach(t => {
                                const pair = t.pair ?? "Unknown";
                                pairCounts[pair] = (pairCounts[pair] || 0) + 1;
                              });
                              const mostTradedPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];
                              
                              const longTrades = allTrades.filter(t => t.direction === "long").length;
                              const shortTrades = allTrades.filter(t => t.direction === "short").length;
                              
                              const totalFeesPaid = closedTrades.reduce((sum, t) => sum + (t.totalFees ?? 0), 0);

                              return (
                                <>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Total Volume</p>
                                    <p className="text-lg font-bold font-mono text-white">${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Avg Trade Size</p>
                                    <p className="text-lg font-bold font-mono text-white">${avgTradeSize.toFixed(2)}</p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Avg Leverage</p>
                                    <p className="text-lg font-bold font-mono text-white">{avgLeverage.toFixed(1)}x</p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Biggest Win</p>
                                    <p className="text-lg font-bold font-mono text-green-400">
                                      {biggestWin > 0 ? `+$${biggestWin.toFixed(2)}` : "-"}
                                    </p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Biggest Loss</p>
                                    <p className="text-lg font-bold font-mono text-red-400">
                                      {biggestLoss < 0 ? `-$${Math.abs(biggestLoss).toFixed(2)}` : "-"}
                                    </p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Most Traded</p>
                                    <p className="text-lg font-bold text-white">{mostTradedPair ? mostTradedPair[0] : "-"}</p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Long / Short</p>
                                    <p className="text-lg font-bold text-white">{longTrades} / {shortTrades}</p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Fees Paid</p>
                                    <p className="text-lg font-bold font-mono text-orange-400">${totalFeesPaid.toFixed(2)}</p>
                                  </div>
                                  <div className="p-3 rounded-lg bg-slate-800/80">
                                    <p className="text-xs text-slate-400 mb-1">Profit Factor</p>
                                    <p className="text-lg font-bold font-mono text-white">
                                      {(() => {
                                        const totalProfit = profitTrades.reduce((sum, t) => sum + (t.pnlAmount ?? 0), 0);
                                        const totalLoss = Math.abs(lossTrades.reduce((sum, t) => sum + (t.pnlAmount ?? 0), 0));
                                        return totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : totalProfit > 0 ? "∞" : "-";
                                      })()}
                                    </p>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Global Protocol Stats */}
                <Card className="mt-4">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle>Protocol Stats</CardTitle>
                      <CardDescription>Global Sai Perps metrics on {network === "mainnet" ? "Mainnet" : "Testnet"}</CardDescription>
                    </div>
                    {globalStatsData?.stats && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadGlobalStatsCard}
                        className="flex items-center gap-2"
                        data-testid="button-share-global-stats"
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    {globalStatsLoading ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-20 w-full" />
                        ))}
                      </div>
                    ) : globalStatsData?.stats ? (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Total Value Locked</p>
                            <p className="text-xl font-bold font-mono text-primary">
                              ${globalStatsData.stats.totalTvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Total Open Interest</p>
                            <p className="text-xl font-bold font-mono">
                              ${globalStatsData.stats.totalOpenInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Open Positions</p>
                            <p className="text-xl font-bold">{globalStatsData.stats.totalOpenPositions.toLocaleString()}</p>
                          </div>
                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Long Open Interest</p>
                            <p className="text-xl font-bold font-mono text-green-500">
                              ${globalStatsData.stats.longOpenInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Short Open Interest</p>
                            <p className="text-xl font-bold font-mono text-red-500">
                              ${globalStatsData.stats.shortOpenInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-1">Long/Short Ratio</p>
                            <p className="text-xl font-bold font-mono">
                              {globalStatsData.stats.shortOpenInterest > 0 
                                ? (globalStatsData.stats.longOpenInterest / globalStatsData.stats.shortOpenInterest).toFixed(2)
                                : globalStatsData.stats.longOpenInterest > 0 ? "∞" : "-"}
                            </p>
                          </div>
                        </div>
                        
                        {/* Vault Breakdown */}
                        {globalStatsData.stats.vaults && globalStatsData.stats.vaults.length > 0 && (() => {
                          const seenSymbols = new Set<string>();
                          const activeVaults: any[] = [];
                          const deprecatedVaults: any[] = [];
                          
                          globalStatsData.stats.vaults.forEach((vault: any) => {
                            if (seenSymbols.has(vault.symbol)) {
                              deprecatedVaults.push(vault);
                            } else {
                              seenSymbols.add(vault.symbol);
                              activeVaults.push(vault);
                            }
                          });
                          
                          return (
                            <div className="mt-6">
                              <h4 className="text-sm font-medium text-muted-foreground mb-3">Vault Breakdown</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {activeVaults.map((vault: any, index: number) => (
                                  <div key={vault.id || index} className="p-4 rounded-lg border border-border/50 bg-card" data-testid={`vault-card-${index}`}>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                      <span className="font-medium">{vault.symbol} Vault</span>
                                      {vault.apy !== undefined && vault.apy !== null && vault.apy > 0 && (
                                        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                                          {vault.apy.toFixed(2)}% APY
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-lg font-bold font-mono">
                                      ${vault.tvl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </p>
                                    {vault.balance && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        {vault.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {vault.symbol}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                              
                              {deprecatedVaults.length > 0 && (
                                <details className="mt-4">
                                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                                    Deprecated/Hidden ({deprecatedVaults.length})
                                  </summary>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 opacity-60">
                                    {deprecatedVaults.map((vault: any, index: number) => (
                                      <div key={vault.id || `deprecated-${index}`} className="p-4 rounded-lg border border-border/30 bg-card/50" data-testid={`vault-card-deprecated-${index}`}>
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                          <span className="font-medium text-muted-foreground">{vault.symbol} Vault</span>
                                          <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                            Deprecated
                                          </span>
                                        </div>
                                        <p className="text-lg font-bold font-mono">
                                          ${vault.tvl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </p>
                                        {vault.balance && (
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {vault.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {vault.symbol}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          );
                        })()}

                        {/* Methodology */}
                        <div className="mt-6 pt-4 border-t border-border/50">
                          <h4 className="text-sm font-medium text-muted-foreground mb-3">Methodology</h4>
                          <div className="space-y-2 text-xs text-muted-foreground">
                            <p>
                              <span className="font-medium text-foreground/80">Total Value Locked:</span>{" "}
                              Sum of all vault balances (availableAssets) multiplied by oracle token prices. USDC priced at ~$1.00, stNIBI priced via Sai Keeper oracle.
                            </p>
                            <p>
                              <span className="font-medium text-foreground/80">Total Open Interest:</span>{" "}
                              Sum of Long OI + Short OI across all perpetual markets. This is the notional value (collateral × leverage), sourced from the borrowings endpoint.
                            </p>
                            <p>
                              <span className="font-medium text-foreground/80">Open Positions:</span>{" "}
                              Count of active perpetual markets with open positions from the borrowings query.
                            </p>
                            <p>
                              <span className="font-medium text-foreground/80">Long/Short Open Interest:</span>{" "}
                              Notional value (collateral × leverage) for long and short positions respectively, aggregated from each market's oiLong and oiShort values.
                            </p>
                            <p>
                              <span className="font-medium text-foreground/80">Long/Short Ratio:</span>{" "}
                              Calculated as Long Open Interest divided by Short Open Interest.
                            </p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground text-center py-4">Unable to load protocol stats</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        {/* Initial State */}
        {!searchAddress && !isLoading && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
              <Wallet className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Enter an Address to Begin</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Paste your Nibiru address above to analyze your Sai Perps trading performance
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-auto">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>Data sourced from Sai Keeper API</p>
        </div>
      </footer>

      {/* Share Modal */}
      <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Your Stats</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {shareImageUrl && (
              <img 
                src={shareImageUrl} 
                alt="Share card" 
                className="max-w-full rounded-lg border border-border shadow-lg"
                data-testid="share-image-preview"
              />
            )}
            <p className="text-sm text-muted-foreground text-center">
              Right-click the image and select "Save image as..." to download
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
