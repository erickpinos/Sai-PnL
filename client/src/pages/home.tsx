import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, TrendingUp, TrendingDown, Activity, ExternalLink, Loader2, Wallet, ChevronDown, History } from "lucide-react";
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

function StatsCard({ 
  title, 
  value, 
  icon: Icon, 
  trend,
  loading 
}: { 
  title: string; 
  value: string; 
  icon: typeof TrendingUp;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardDescription className="text-sm font-medium">{title}</CardDescription>
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

function TradesTable({ trades, loading, explorerUrl }: { trades: Trade[]; loading: boolean; explorerUrl: string }) {
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
            <TableHead>Type</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Trade Index</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">P&L %</TableHead>
            <TableHead className="text-right">Collateral</TableHead>
            <TableHead className="text-right">Fees</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow key={trade.txHash} data-testid={`row-trade-${trade.txHash.slice(0, 8)}`}>
              <TableCell>
                <Badge 
                  variant={trade.type === "open" ? "default" : "secondary"}
                  className={trade.type === "open" ? "bg-primary/20 text-primary border-primary/30" : ""}
                >
                  {trade.type === "open" ? "Open" : "Close"}
                </Badge>
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
              <TableCell className="font-mono text-sm text-muted-foreground">
                {trade.tradeIndex || "-"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {trade.type === "open" && trade.openPrice 
                  ? `$${trade.openPrice.toLocaleString()}`
                  : trade.closePrice 
                    ? `$${trade.closePrice.toLocaleString()}`
                    : "-"
                }
              </TableCell>
              <TableCell className="text-right">
                {trade.profitPct !== undefined ? (
                  <span className={`font-semibold ${
                    trade.profitPct >= 0 ? "text-emerald-500" : "text-red-500"
                  }`}>
                    {trade.profitPct >= 0 ? "+" : ""}{(trade.profitPct * 100).toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {trade.collateral ? `$${(trade.collateral / 1e6).toFixed(2)}` : "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                {trade.fees ? `$${(trade.fees / 1e6).toFixed(4)}` : "-"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(trade.timestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TableCell>
              <TableCell>
                <a
                  href={`${explorerUrl}/tx/${trade.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                  data-testid={`link-tx-${trade.txHash.slice(0, 8)}`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
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
  const [currentPage, setCurrentPage] = useState(0);
  const [accumulatedTrades, setAccumulatedTrades] = useState<Trade[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const form = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      address: "",
    },
  });

  const { data, isLoading, error } = useQuery<TradesResponse>({
    queryKey: ["/api/trades", searchAddress, network, currentPage],
    queryFn: async () => {
      const res = await fetch(`/api/trades?address=${searchAddress}&network=${network}&page=${currentPage}`);
      if (!res.ok) throw new Error("Failed to fetch trades");
      const result = await res.json();
      
      // On first page, replace trades; on subsequent pages, append
      if (currentPage === 0) {
        setAccumulatedTrades(result.trades);
      } else {
        setAccumulatedTrades(prev => [...prev, ...result.trades]);
      }
      
      setHasMore(result.pagination?.hasMore ?? false);
      setIsLoadingMore(false);
      
      return result;
    },
    enabled: !!searchAddress,
  });

  const explorerUrl = data?.explorer || NETWORK_CONFIG[network].explorer;

  const onSubmit = (values: AddressForm) => {
    // Reset pagination when searching new address
    setCurrentPage(0);
    setAccumulatedTrades([]);
    setHasMore(false);
    setSearchAddress(values.address);
  };

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      setIsLoadingMore(true);
      setCurrentPage(prev => prev + 1);
    }
  }, [hasMore, isLoadingMore]);

  // Function to change network and reset pagination
  const handleNetworkChange = (newNetwork: Network) => {
    setNetwork(newNetwork);
    setCurrentPage(0);
    setAccumulatedTrades([]);
    setHasMore(false);
  };

  // Calculate stats from accumulated trades
  const closeTrades = accumulatedTrades.filter(t => t.type === "close" && t.profitPct !== undefined);
  const wins = closeTrades.filter(t => (t.profitPct ?? 0) > 0).length;
  const winRate = closeTrades.length > 0 ? wins / closeTrades.length : 0;
  const totalPnl = closeTrades.reduce((sum, t) => sum + (t.profitPct ?? 0), 0);
  const pnlTrend = totalPnl > 0 ? "up" : totalPnl < 0 ? "down" : "neutral";

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
                              placeholder="0x5DBa7Aa28074201a2c3Abe4e743Adaf8E74BD183"
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
                value={accumulatedTrades.length > 0 ? `${totalPnl >= 0 ? "+" : ""}${(totalPnl * 100).toFixed(2)}%` : "-"}
                icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
                trend={pnlTrend}
                loading={isLoading && currentPage === 0}
              />
              <StatsCard
                title="Win Rate"
                value={accumulatedTrades.length > 0 ? `${(winRate * 100).toFixed(1)}%` : "-"}
                icon={Activity}
                trend={winRate >= 0.5 ? "up" : "neutral"}
                loading={isLoading && currentPage === 0}
              />
              <StatsCard
                title="Total Trades"
                value={accumulatedTrades.length > 0 ? accumulatedTrades.length.toString() : "-"}
                icon={Activity}
                trend="neutral"
                loading={isLoading && currentPage === 0}
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
                <TradesTable trades={accumulatedTrades} loading={isLoading && currentPage === 0} explorerUrl={explorerUrl} />
                
                {/* Load More Button */}
                {hasMore && !isLoading && (
                  <div className="mt-6 flex justify-center">
                    <Button
                      variant="outline"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      data-testid="button-load-more"
                      className="gap-2"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <History className="h-4 w-4" />
                          Load More History
                        </>
                      )}
                    </Button>
                  </div>
                )}
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
          <p>Data sourced from Nibiru via nibiscan.io</p>
        </div>
      </footer>
    </div>
  );
}
