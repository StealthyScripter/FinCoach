import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SearchCheck } from "lucide-react";
import { useState } from "react";
import { forensicTitle, TradeForensicsChart, type TradeForensics } from "./execution-center";

type ClosedTrade = {
  tradeId: string;
  brokerTradeId: string | null;
  symbol: string;
  side: "long" | "short";
  enteredAt: string;
  closedAt: string;
  netPnl: number;
  authoritativePnlSource: "broker_reconciliation" | "paper_runtime";
  forensicsGenerated: boolean;
};

export default function TradeForensicsPage() {
  const [selected, setSelected] = useState<TradeForensics | null>(null);
  const { data: trades = [], isLoading, error } = useQuery<ClosedTrade[]>({ queryKey: ["/api/marketpilot/trade-forensics"] });
  const load = useMutation({
    mutationFn: async (tradeId: string) => {
      const response = await apiRequest("GET", `/api/marketpilot/trades/${tradeId}/forensics`);
      return response.json() as Promise<TradeForensics>;
    },
    onSuccess: setSelected,
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3"><SearchCheck className="h-7 w-7 text-primary" /><h1 className="text-3xl font-bold text-white">Trade Forensics</h1></div>
          <p className="mt-2 text-muted-foreground">Authoritative before, during, and after analysis for closed trades only.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Closed trades</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading closed trades…</p>}
            {error && <p className="text-sm text-red-300">{error instanceof Error ? error.message : "Closed trades are unavailable."}</p>}
            {!isLoading && !error && trades.length === 0 && <p className="text-sm text-muted-foreground">No closed trades are currently eligible for forensic inspection.</p>}
            {trades.map((trade) => (
              <div key={trade.tradeId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-white">{trade.symbol} · {trade.side.toUpperCase()}</p>
                    <Badge variant="outline">CLOSED</Badge>
                    <Badge variant="secondary">{trade.authoritativePnlSource.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Closed {new Date(trade.closedAt).toLocaleString()} · Net P/L {trade.netPnl >= 0 ? "+" : ""}{trade.netPnl.toFixed(2)}</p>
                </div>
                <Button onClick={() => load.mutate(trade.tradeId)} disabled={load.isPending}>View Forensics</Button>
              </div>
            ))}
            {load.error && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{load.error instanceof Error ? load.error.message : "Trade Forensics is unavailable."}</div>}
          </CardContent>
        </Card>
      </div>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>{selected ? forensicTitle(selected) : "Trade Forensics"}</DialogTitle></DialogHeader>
          {selected && <TradeForensicsChart forensics={selected} />}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
