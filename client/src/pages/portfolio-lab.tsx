import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowLeft, BarChart3, Filter, RefreshCcw, ShieldAlert } from "lucide-react";
import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type PortfolioSummary = {
  portfolioId: string;
  shortName: string;
  name: string;
  description: string;
  riskLevel: number;
  riskLabel: string;
  mandate: string;
  lifecycleState: string;
  rank: number | null;
  nav: number;
  cash: number;
  marketValue: number;
  dailyPnl: number;
  dailyPct: number;
  weeklyPnl: number;
  weeklyPct: number;
  monthlyPnl: number;
  monthlyPct: number;
  allTimePnl: number;
  allTimePct: number;
  stale: boolean;
  providerSource: string;
  benchmarkSymbol: string;
  readinessStatus?: "ready" | "not_ready";
};

type PortfolioDetail = PortfolioSummary & {
  positions: Array<{ symbol: string; assetClass: string; quantity: number; averageCost: number; currentPrice: number | null; marketValue: number; unrealizedPnl: number; allocationPct: number; stale: boolean }>;
  decisions: Array<{ id: string; eventType: string; symbol: string | null; reason: string; createdAt: string }>;
  metrics: { concentrationPct: number; confidence: number; maxDrawdownPct: number; sharpe: number | null; sortino: number | null };
  equityCurve: Array<{ observedAt: string; nav: number }>;
  benchmark: { symbol: string; available: boolean; reason?: string };
  lineage: { strategyVersion: number; researchHypothesis: string; parameters: Record<string, unknown> };
};

type PortfolioOrder = { id: string; side: string; symbol: string | null; quantity: number | null; status: string; reason: string; submittedAt: string; filledAt: string | null };
type PortfolioTransaction = { id: string; side: string; symbol: string; quantity: number; price: number; fee: number; realizedPnl: number; executedAt: string };

export default function PortfolioLab() {
  const params = useParams<{ id?: string }>();
  return params.id ? <PortfolioDetailPage portfolioId={params.id} /> : <PortfolioOverview />;
}

function PortfolioOverview() {
  const [riskFilter, setRiskFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, isLoading } = useQuery<{ portfolios: PortfolioSummary[] }>({ queryKey: ["/api/portfolio/summary"] });
  const portfolios = useMemo(() => (data?.portfolios ?? []).filter((portfolio) => {
    const riskOk = riskFilter === "all" || String(portfolio.riskLevel) === riskFilter;
    const statusOk = statusFilter === "all" || portfolio.lifecycleState === statusFilter;
    return riskOk && statusOk;
  }), [data, riskFilter, statusFilter]);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wider text-muted-foreground">Portfolio Lab</p>
            <h1 className="text-3xl font-semibold text-white">Virtual Portfolio Research</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-44"><Filter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All risk levels</SelectItem>
                {Array.from({ length: 10 }, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>Risk {index + 1}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lifecycle states</SelectItem>
                <SelectItem value="RESEARCH">Research</SelectItem>
                <SelectItem value="VIRTUAL_LIVE_DATA">Virtual live data</SelectItem>
                <SelectItem value="LIVE_CANDIDATE">Live candidate</SelectItem>
                <SelectItem value="RETIRED">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Metric title="Active portfolios" value={String(data?.portfolios?.length ?? 0)} />
          <Metric title="Top NAV" value={currency(Math.max(0, ...((data?.portfolios ?? []).map((item) => item.nav))))} />
          <Metric title="Stale data" value={`${(data?.portfolios ?? []).filter((item) => item.stale).length}`} />
        </div>

        <Card className="border-border/70">
          <CardHeader><CardTitle className="text-white">Strategy Leaderboard</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead><TableHead>Strategy</TableHead><TableHead>NAV</TableHead><TableHead>Daily</TableHead><TableHead>Weekly</TableHead><TableHead>Monthly</TableHead><TableHead>All-time</TableHead><TableHead>Risk</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9}>Loading portfolios...</TableCell></TableRow>}
                {portfolios.map((portfolio) => (
                  <TableRow key={portfolio.portfolioId}>
                    <TableCell>{portfolio.rank ?? "-"}</TableCell>
                    <TableCell>
                      <Link href={`/portfolio/${portfolio.portfolioId}`}><span className="cursor-pointer font-semibold text-primary">{portfolio.shortName}</span></Link>
                      <div className="text-xs text-muted-foreground">{portfolio.name}</div>
                    </TableCell>
                    <TableCell>{currency(portfolio.nav)}</TableCell>
                    <TableCell className={pnlClass(portfolio.dailyPnl)}>{signedCurrency(portfolio.dailyPnl)} ({signedPct(portfolio.dailyPct)})</TableCell>
                    <TableCell className={pnlClass(portfolio.weeklyPnl)}>{signedCurrency(portfolio.weeklyPnl)}</TableCell>
                    <TableCell className={pnlClass(portfolio.monthlyPnl)}>{signedPct(portfolio.monthlyPct)}</TableCell>
                    <TableCell className={pnlClass(portfolio.allTimePnl)}>{signedPct(portfolio.allTimePct)}</TableCell>
                    <TableCell>{portfolio.riskLevel} {portfolio.riskLabel}</TableCell>
                    <TableCell><Badge variant={portfolio.readinessStatus === "ready" && !portfolio.stale ? "secondary" : "destructive"}>{portfolio.stale ? "stale" : portfolio.readinessStatus ?? portfolio.lifecycleState}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function PortfolioDetailPage({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useQuery<PortfolioDetail>({ queryKey: [`/api/portfolio/strategies/${portfolioId}`] });
  const { data: orders } = useQuery<{ orders: PortfolioOrder[] }>({ queryKey: [`/api/portfolio/strategies/${portfolioId}/orders`] });
  const { data: transactions } = useQuery<{ transactions: PortfolioTransaction[] }>({ queryKey: [`/api/portfolio/strategies/${portfolioId}/transactions`] });
  const rebalance = async () => {
    await apiRequest("POST", `/api/portfolio/strategies/${portfolioId}/rebalance`);
    await queryClient.invalidateQueries({ queryKey: ["/api/portfolio/summary"] });
    await queryClient.invalidateQueries({ queryKey: [`/api/portfolio/strategies/${portfolioId}`] });
  };
  if (isLoading || !data) return <Layout><p className="text-muted-foreground">Loading portfolio...</p></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/portfolio"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></Link>
            <h1 className="mt-3 text-3xl font-semibold text-white">{data.shortName} {data.name}</h1>
            <p className="max-w-3xl text-muted-foreground">{data.description}</p>
          </div>
          <Button onClick={rebalance}><RefreshCcw className="mr-2 h-4 w-4" />Virtual Rebalance</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Metric title="NAV" value={currency(data.nav)} />
          <Metric title="Cash" value={currency(data.cash)} />
          <Metric title="All-time P&L" value={`${signedCurrency(data.allTimePnl)} (${signedPct(data.allTimePct)})`} tone={data.allTimePnl} />
          <Metric title="Confidence" value={`${Math.round(data.metrics.confidence * 100)}%`} />
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-white"><BarChart3 className="h-5 w-5" />Equity Curve</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.equityCurve}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="observedAt" tickFormatter={(value) => new Date(value).toLocaleDateString()} />
                <YAxis tickFormatter={(value) => currency(Number(value))} width={90} />
                <Tooltip formatter={(value) => currency(Number(value))} labelFormatter={(value) => new Date(String(value)).toLocaleString()} />
                <Area type="monotone" dataKey="nav" stroke="#10b981" fill="#10b98133" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-white">Positions</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Value</TableHead><TableHead>P&L</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.positions.length === 0 && <TableRow><TableCell colSpan={5}>No open positions.</TableCell></TableRow>}
                  {data.positions.map((position) => (
                    <TableRow key={position.symbol}>
                      <TableCell>{position.symbol}</TableCell><TableCell>{position.quantity.toFixed(4)}</TableCell><TableCell>{position.currentPrice ? currency(position.currentPrice) : "Unavailable"}</TableCell><TableCell>{currency(position.marketValue)}</TableCell><TableCell className={pnlClass(position.unrealizedPnl)}>{signedCurrency(position.unrealizedPnl)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-white"><Activity className="h-5 w-5" />Decision Journal</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.decisions.slice(0, 10).map((event) => (
                <div key={event.id} className="border-b border-border pb-3 last:border-0">
                  <div className="flex items-center justify-between gap-3"><Badge>{event.eventType}</Badge><span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span></div>
                  <p className="mt-2 text-sm text-muted-foreground">{event.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-white">Virtual Orders</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Side</TableHead><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(orders?.orders ?? []).length === 0 && <TableRow><TableCell colSpan={5}>No orders.</TableCell></TableRow>}
                  {(orders?.orders ?? []).slice(0, 20).map((order) => <TableRow key={order.id}><TableCell>{order.side}</TableCell><TableCell>{order.symbol ?? "-"}</TableCell><TableCell>{order.quantity?.toFixed(4) ?? "-"}</TableCell><TableCell>{order.status}</TableCell><TableCell>{new Date(order.submittedAt).toLocaleString()}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-white">Transactions</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Side</TableHead><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Fee</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(transactions?.transactions ?? []).length === 0 && <TableRow><TableCell colSpan={5}>No transactions.</TableCell></TableRow>}
                  {(transactions?.transactions ?? []).slice(0, 20).map((tx) => <TableRow key={tx.id}><TableCell>{tx.side}</TableCell><TableCell>{tx.symbol}</TableCell><TableCell>{tx.quantity.toFixed(4)}</TableCell><TableCell>{currency(tx.price)}</TableCell><TableCell>{currency(tx.fee)}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {!data.benchmark.available && <Card className="border-yellow-500/40"><CardContent className="flex gap-3 pt-6 text-yellow-200"><ShieldAlert className="h-5 w-5" />{data.benchmark.reason}</CardContent></Card>}
      </div>
    </Layout>
  );
}

function Metric({ title, value, tone }: { title: string; value: string; tone?: number }) {
  return <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{title}</p><p className={cn("mt-2 text-2xl font-semibold text-white", tone !== undefined && pnlClass(tone))}>{value}</p></CardContent></Card>;
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function signedCurrency(value: number) {
  const formatted = currency(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
}

function signedPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pnlClass(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted-foreground";
}
