import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMarketPilotOverview } from "@/lib/marketpilot";
import { CheckCircle2 } from "lucide-react";
import { useRoute } from "wouter";

const lessons = [
  ["forex", "Forex", "Rate differentials", "Currencies often move when interest-rate expectations change.", "If US yields rise faster than eurozone yields, EUR/USD can weaken.", "What would usually pressure EUR/USD?", "Connect FX moves to central banks, inflation, and growth data.", "Using high leverage before understanding pip value."],
  ["stocks", "Stocks", "Ownership and expectations", "A stock price reflects changing expectations about future cash flows and risk.", "A strong company can fall if guidance disappoints.", "Can good companies have falling stocks?", "Separate company news from sector and macro pressure.", "Assuming a drop automatically means the stock is cheap."],
  ["etfs", "ETFs", "Basket exposure", "ETFs package many securities into one tradable fund.", "VTI gives broad US stock exposure; SGOV behaves more like cash-like Treasury exposure.", "Why can ETFs reduce single-name risk?", "Use ETFs for diversified implementation or hedging.", "Ignoring overlap between funds."],
  ["options", "Options", "Defined risk", "Options are contracts with nonlinear payoff, time decay, and volatility exposure.", "A put spread limits loss compared with shorting unlimited downside risk.", "What is max loss?", "Use options only after checking breakeven, assignment, and liquidity.", "Buying options without knowing time decay."],
  ["portfolio", "Portfolio management", "Allocation drives outcomes", "Your mix of assets usually matters more than one trade idea.", "A 70% equity portfolio behaves differently from a 40% equity portfolio.", "What is the largest risk contributor?", "Review concentration before adding new exposure.", "Chasing trades that duplicate current risk."],
  ["crypto", "Crypto", "Reflexive risk", "Crypto moves can be driven by liquidity, leverage, flows, and narrative.", "A rally can fail if funding and leverage are overheated.", "What confirms a crypto move is healthier?", "Check volume, flows, liquidity, and exchange risk.", "Treating a narrative as proof."],
  ["bonds", "Bonds", "Duration", "Bond prices move opposite yields, and longer duration means more rate sensitivity.", "A rate spike can hurt long bond ETFs.", "What happens to bond prices when yields rise?", "Use bonds for income, ballast, or duration exposure consciously.", "Calling bonds risk-free without checking duration."],
  ["loans", "Loans and credit", "Borrowing cost", "Loan decisions depend on rate, term, fees, cash flow, and credit profile.", "A lower payment can still cost more if the term is much longer.", "What matters besides monthly payment?", "Use this as planning guidance, not a trade.", "Ignoring total interest paid."],
  ["commodities", "Commodities", "Supply and demand shocks", "Commodity prices react to inventories, production, geopolitics, and currency moves.", "Oil can rise after a supply disruption even if growth is slowing.", "What evidence confirms a commodity shock?", "Tie claims to inventories, supply, and macro impact.", "Trading headlines without checking positioning."],
  ["risk-management", "Risk management", "Invalidation first", "A strategy is incomplete until it defines what proves it wrong.", "A stop-loss turns a thesis into a controlled experiment.", "What proves your thesis wrong?", "Position size should follow the stop and portfolio risk.", "Choosing size before defining risk."],
  ["macroeconomics", "Macroeconomics", "Rates, inflation, growth", "Markets reprice when expectations for growth, inflation, or policy change.", "Hot inflation can lift yields and pressure duration-sensitive stocks.", "Which macro input changed?", "Separate the data release from the market interpretation.", "Blaming every move on the Fed without evidence."],
  ["trading-psychology", "Trading psychology", "Process over impulse", "Good decisions require pre-committed rules and post-trade review.", "After a loss, a cooling-off rule prevents revenge trading.", "What emotion changes your next decision?", "Use the journal to spot recurring mistakes.", "Increasing size to win back losses."],
];

export default function Learn() {
  const [, params] = useRoute("/learn/:domain?");
  const currentDomain = params?.domain ?? "all";
  const { data } = useMarketPilotOverview();
  const filtered = currentDomain === "all"
    ? lessons
    : lessons.filter(([slug]) => slug === currentDomain);

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="rounded-xl border border-border/60 bg-card/70 p-5">
          <div className="text-xs uppercase tracking-widest text-primary">Learn Mode</div>
          <h1 className="mt-2 text-3xl font-bold text-white">Financial topics without dashboard overload.</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Each lesson gives one concept, a simple explanation, an example, a mini quiz, real-market application, and mistakes to avoid.
          </p>
        </div>

        {data && (
          <div className="grid gap-3 md:grid-cols-4">
            {data.proficiencyScores.slice(0, 4).map((score) => (
              <Card key={score.id} className="border-border/60 bg-card/55">
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">{score.label}</div>
                  <div className="mt-1 text-2xl font-bold text-white">{score.score}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map(([slug, topic, concept, explanation, example, quiz, application, mistake]) => (
            <Card key={slug} className="border-border/60 bg-card/60">
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-primary/30 text-primary">{topic}</Badge>
                  <Badge variant="secondary">Mini lesson</Badge>
                </div>
                <CardTitle className="text-white">{concept}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <LessonRow label="Simple explanation" value={explanation} />
                <LessonRow label="Example" value={example} />
                <LessonRow label="Mini quiz" value={quiz} />
                <LessonRow label="Real-market application" value={application} />
                <LessonRow label="Mistake to avoid" value={mistake} />
                <Button variant="outline" className="mt-1 w-fit">Start Lesson</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}

function LessonRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <p className="mt-1 text-slate-200">{value}</p>
    </div>
  );
}
