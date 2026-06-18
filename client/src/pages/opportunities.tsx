import { AssistantSignalCard } from "@/components/assistant-signal-card";
import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useAssistantOpportunities } from "@/lib/marketpilot";
import { ChevronDown } from "lucide-react";

export default function Opportunities() {
  const { data, isLoading } = useAssistantOpportunities();
  const ranked = data?.all ?? [];
  const highConviction = ranked.filter((signal) => signal.category === "opportunity" && signal.confidence >= 70).slice(0, 5);
  const riskWarnings = ranked.filter((signal) => signal.category === "risk_warning" || signal.riskSeverity >= 85).slice(0, 5);
  const learning = ranked.filter((signal) => signal.category === "learning").slice(0, 5);
  const avoid = ranked.filter((signal) => signal.actionability < 50 || signal.displayTier === "advanced").slice(0, 5);
  const watchlist = ranked
    .filter((signal) => !highConviction.includes(signal) && !riskWarnings.includes(signal) && !learning.includes(signal) && !avoid.includes(signal))
    .slice(0, 5);

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold text-white">Opportunities</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ranked signals only: high conviction, watchlist, risk warning, learning opportunity, or avoid trade.</p>
        </div>

        {isLoading && <div className="text-muted-foreground">Ranking signals...</div>}

        {data && (
          <>
            <SignalSection title="High conviction" signals={highConviction.length > 0 ? highConviction : data.primary.slice(0, 3)} />
            <SignalSection title="Watchlist" signals={watchlist} />
            <SignalSection title="Risk warning" signals={riskWarnings} />
            <SignalSection title="Learning opportunity" signals={learning} />
            <SignalSection title="Avoid trade" signals={avoid} />

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  Show advanced/low-priority analytics
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 grid gap-4 md:grid-cols-2">
                {data.advanced.map((signal) => (
                  <AssistantSignalCard key={signal.id} signal={signal} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    </Layout>
  );
}

function SignalSection({ title, signals }: { title: string; signals: NonNullable<ReturnType<typeof useAssistantOpportunities>["data"]>["all"] }) {
  if (signals.length === 0) return null;

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <CardTitle className="text-white">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {signals.slice(0, 5).map((signal) => (
          <AssistantSignalCard key={signal.id} signal={signal} />
        ))}
      </CardContent>
    </Card>
  );
}
