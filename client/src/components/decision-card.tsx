import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { DecisionCard as DecisionCardData } from "@/lib/marketpilot";
import { decisionCardHighlights } from "@shared/assistantPresentation";
import { AlertTriangle, CheckCircle2, ChevronDown, ShieldCheck, Target } from "lucide-react";
import type { ReactNode } from "react";

export function DecisionCard({ card }: { card: DecisionCardData }) {
  return (
    <Card className="border-primary/30 bg-card/75">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {card.asset && <Badge variant="outline" className="border-primary/40 text-primary">{card.asset}</Badge>}
          <Badge variant="secondary">Confidence {card.confidence}%</Badge>
          <Badge variant="outline" className={riskTone(card.riskLevel)}>{card.riskLevel} risk</Badge>
          <Badge variant="outline" className="border-border/70 text-muted-foreground">{card.verificationStatus}</Badge>
        </div>
        <CardTitle className="text-2xl text-white">{card.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{card.situation}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {decisionCardHighlights(card).map((item, index) => (
          <KeyItem
            key={item.label}
            icon={
              index === 0 ? <Target className="h-4 w-4 text-primary" /> :
              index === 1 ? <ShieldCheck className="h-4 w-4 text-primary" /> :
              <AlertTriangle className="h-4 w-4 text-amber-300" />
            }
            label={item.label}
            value={item.value}
          />
        ))}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between border-border/60">
              Show details
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <ListPanel title="Why" items={card.why.slice(0, 3)} />
              <ListPanel title="Next step" items={[card.nextStep]} />
            </div>
            <ListPanel title="Learning note" items={[card.learningNote]} />
            <div className="grid gap-3 lg:grid-cols-3">
              <ListPanel title="Facts" items={card.details.facts} />
              <ListPanel title="Interpretations" items={card.details.interpretations} />
              <ListPanel title="Contradictions" items={card.details.contradictoryEvidence} />
            </div>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between text-muted-foreground">
                  Advanced analytics
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ListPanel title="Raw checks" items={[...card.details.risks, ...card.details.advancedAnalytics]} />
              </CollapsibleContent>
            </Collapsible>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function KeyItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-sm text-slate-100">{value}</p>
    </div>
  );
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2">
        {items.length > 0 ? items.map((item) => (
          <div key={item} className="flex gap-2 text-sm text-slate-200">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{item}</span>
          </div>
        )) : (
          <div className="text-sm text-muted-foreground">No item surfaced.</div>
        )}
      </div>
    </div>
  );
}

function riskTone(level: DecisionCardData["riskLevel"]) {
  if (level === "low") return "border-emerald-500/40 text-emerald-300";
  if (level === "medium") return "border-amber-500/40 text-amber-300";
  return "border-rose-500/40 text-rose-300";
}
