import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, TrendingUp, TrendingDown, Activity, Loader2, Wallet, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TradesResponse, Trade } from "@shared/schema";

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
}: { 
  title: string; 
  value: string; 
  icon: typeof TrendingUp;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
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

function TradesTable({ trades, loading, pnlDisplayMode }: { trades: Trade[]; loading: boolean; pnlDisplayMode: PnlDisplayMode }) {
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
            <TableHead>Pair</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead className="text-right">Leverage</TableHead>
            <TableHead className="text-right">Entry Price</TableHead>
            <TableHead className="text-right">Exit Price</TableHead>
            <TableHead className="text-right">{pnlDisplayMode === "percent" ? "P&L %" : "P&L $"}</TableHead>
            <TableHead className="text-right">Collateral</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right">Opening Fee</TableHead>
            <TableHead className="text-right">Closing Fee</TableHead>
            <TableHead className="text-right">Borrowing Fee</TableHead>
            <TableHead className="text-right">Trigger Fee</TableHead>
            <TableHead className="text-right">Net - Fees</TableHead>
            <TableHead>Time Opened</TableHead>
            <TableHead>Time Closed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow key={trade.txHash} data-testid={`row-trade-${trade.txHash.slice(0, 8)}`}>
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
                  trade.pnlAmount !== undefined ? (
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
                {trade.collateral ? `$${trade.collateral.toFixed(2)}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {trade.amountReceived !== undefined ? (
                  <span className={trade.amountReceived >= (trade.collateral || 0) ? "text-emerald-500" : "text-red-500"}>
                    ${trade.amountReceived.toFixed(2)}
                  </span>
                ) : "-"}
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
                {trade.amountReceived !== undefined && trade.totalFees !== undefined ? (
                  <span className={(trade.amountReceived - trade.totalFees) >= (trade.collateral || 0) ? "text-emerald-500" : "text-red-500"}>
                    ${(trade.amountReceived - trade.totalFees).toFixed(2)}
                  </span>
                ) : "-"}
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

type Network = "mainnet" | "testnet";

const NETWORK_CONFIG = {
  mainnet: { label: "Mainnet", explorer: "https://nibiscan.io" },
  testnet: { label: "Testnet", explorer: "https://testnet.nibiscan.io" },
};

export default function Home() {
  const [searchAddress, setSearchAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<Network>("mainnet");
  const [pnlDisplayMode, setPnlDisplayMode] = useState<PnlDisplayMode>("percent");
  
  const form = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      address: "",
    },
  });

  const { data, isLoading, error } = useQuery<TradesResponse>({
    queryKey: ["/api/trades", searchAddress, network],
    queryFn: async () => {
      const res = await fetch(`/api/trades?address=${searchAddress}&network=${network}&limit=500`);
      if (!res.ok) throw new Error("Failed to fetch trades");
      return res.json();
    },
    enabled: !!searchAddress,
  });

  const trades = data?.trades || [];

  const onSubmit = (values: AddressForm) => {
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
  const pnlTrend = totalPnlDollars > 0 ? "up" : totalPnlDollars < 0 ? "down" : "neutral";
  
  const togglePnlMode = () => {
    setPnlDisplayMode(prev => prev === "percent" ? "dollars" : "percent");
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
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Search Section */}
        <div className="max-w-3xl mx-auto mb-10">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-3">Track Your P&L</h2>
            <p className="text-muted-foreground">
              Enter your Nibiru address to view your Sai Perps trading history and profit/loss per trade
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
                      <FormItem className="flex-1">
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isLoading} data-testid="button-search">
                    {isLoading ? (
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
                title="Total P&L"
                value={trades.length > 0 
                  ? pnlDisplayMode === "percent"
                    ? `${totalPnlPct >= 0 ? "+" : ""}${(totalPnlPct * 100).toFixed(2)}%`
                    : `${totalPnlDollars >= 0 ? "+" : ""}$${Math.abs(totalPnlDollars).toFixed(2)}`
                  : "-"}
                icon={totalPnlDollars >= 0 ? TrendingUp : TrendingDown}
                trend={pnlTrend}
                loading={isLoading}
                onToggle={togglePnlMode}
                toggleLabel={pnlDisplayMode === "percent" ? "Show $" : "Show %"}
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

            {/* Trades Table */}
            <Card>
              <CardHeader>
                <CardTitle>Trade History</CardTitle>
                <CardDescription>
                  {searchAddress && (
                    <span className="font-mono text-xs">
                      {searchAddress.slice(0, 6)}...{searchAddress.slice(-4)}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TradesTable trades={trades} loading={isLoading} pnlDisplayMode={pnlDisplayMode} />
              </CardContent>
            </Card>
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
    </div>
  );
}
