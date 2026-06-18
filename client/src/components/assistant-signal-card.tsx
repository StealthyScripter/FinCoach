import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrioritizedSignal } from "@/lib/marketpilot";

export function AssistantSignalCard({ signal }: { signal: PrioritizedSignal }) {
  return (
    <Card className="border-border/60 bg-card/65">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/30 text-primary">{signal.category.replace("_", " ")}</Badge>
          <Badge variant="secondary">{signal.priorityScore.toFixed(0)}</Badge>
        </div>
        <CardTitle className="text-base text-white">{signal.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-200">{signal.summary}</p>
        <p className="text-xs text-muted-foreground">{signal.reason}</p>
      </CardContent>
    </Card>
  );
}
