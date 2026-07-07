import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, ShieldCheck, Siren, WalletCards } from "lucide-react";

const cards = [
  { title: "Account Verification", value: "Demo/practice required", detail: "Unknown, live, real, and production modes fail closed.", icon: ShieldCheck },
  { title: "Running Tests", value: "Forward testing", detail: "Validated experiments only; allowed instruments and risk limits enforced.", icon: Radio },
  { title: "Open Demo Trades", value: "Journal required", detail: "Every demo trade must link entry, exit, rule version, and snapshots.", icon: WalletCards },
  { title: "Risk Status", value: "Kill switch wins", detail: "Emergency controls override confirmation and provider state.", icon: Siren },
];

export default function ForwardTesting() {
  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <Badge className="w-fit" variant="secondary">Demo-only execution boundary</Badge>
          <h1 className="text-3xl font-bold text-white">Forward Testing</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Run validated experiments in paper, sandbox, practice, or simulated mode with account verification and immutable execution references.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.title} className="border-border/60 bg-card/60">
                <CardHeader className="space-y-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base text-white">{card.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-medium">{card.value}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{card.detail}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
