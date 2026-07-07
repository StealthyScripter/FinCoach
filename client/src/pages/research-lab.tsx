import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlaskConical, GitBranch, Microscope, ScrollText, TrendingUp } from "lucide-react";

const pipeline = [
  { title: "Observations", value: "Forex first", detail: "EUR/USD, GBP/USD, USD/JPY, XAU/USD, XAG/USD" },
  { title: "Patterns", value: "10 detectors", detail: "Compression, breakout, sweep, shift, false breakout" },
  { title: "Hypotheses", value: "Evidence linked", detail: "Sample-size estimate and regime tags required" },
  { title: "Rule Sets", value: "Objective only", detail: "Machine-readable filters and versioned rules" },
  { title: "Experiments", value: "Pipeline owner", detail: "Backtest, validate, forward test, journal, rank" },
];

const pipelineIcons = [TrendingUp, Microscope, GitBranch, ScrollText, FlaskConical];

export default function ResearchLab() {
  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <Badge className="w-fit" variant="secondary">Demo-only research machine</Badge>
          <h1 className="text-3xl font-bold text-white">Research Lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Observe markets, detect repeatable behavior, generate hypotheses, define objective rules, and move experiments through evidence gates.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          {pipeline.map((item, index) => {
            const Icon = pipelineIcons[index];
            return (
              <Card key={item.title} className="border-border/60 bg-card/60">
                <CardHeader className="space-y-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base text-white">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-medium">{item.value}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
