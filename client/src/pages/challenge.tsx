import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, TrendingDown, DollarSign, BrainCircuit, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function Challenge() {
  const [allocation, setAllocation] = useState([50]);
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "warning" | null>(null);

  const handleSubmit = () => {
    setSubmitted(true);
    // Mock logic: optimal is around 30% for this scenario
    if (allocation[0] >= 20 && allocation[0] <= 40) {
      setFeedback("success");
    } else {
      setFeedback("warning");
    }
  };

  const reset = () => {
    setSubmitted(false);
    setFeedback(null);
    setAllocation([50]);
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10 animate-pulse">
                LIVE SCENARIO
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">Updated: 14 mins ago</span>
            </div>
            <h1 className="text-3xl font-bold text-white">The "Hawk" Has Landed</h1>
            <p className="text-lg text-muted-foreground mt-2">
              The Federal Reserve just announced a surprise 50bps rate hike. Markets are panicking.
            </p>
          </div>
          <div className="hidden md:block text-right">
            <div className="text-sm text-muted-foreground">Difficulty</div>
            <div className="flex gap-1 mt-1">
              <div className="h-2 w-6 bg-primary rounded-full" />
              <div className="h-2 w-6 bg-primary rounded-full" />
              <div className="h-2 w-6 bg-primary rounded-full" />
              <div className="h-2 w-6 bg-secondary rounded-full" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Challenge Area */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="border-border/50 bg-card/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-primary" />
                  Your Decision
                </CardTitle>
                <CardDescription>
                  You manage a $100,000 portfolio currently split 70/30 (Stocks/Bonds).
                  How much should you shift to <strong>Cash/Short-term Bills</strong> immediately?
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                
                {!submitted ? (
                  <div className="space-y-8 py-4">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-muted-foreground">Allocation to Cash</span>
                        <span className="text-2xl font-mono font-bold text-primary">{allocation}%</span>
                      </div>
                      <Slider
                        value={allocation}
                        onValueChange={setAllocation}
                        max={100}
                        step={5}
                        className="py-4"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground font-mono">
                        <span>0% (Stay Invested)</span>
                        <span>100% (Sell Everything)</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-sm flex gap-3">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <p>
                        Remember: Cash drags performance in the long run, but protects capital during volatility. 
                        Bond yields will rise (prices fall) with the rate hike.
                      </p>
                    </div>

                    <Button onClick={handleSubmit} className="w-full bg-primary hover:bg-primary/90 text-white h-12 text-lg">
                      Execute Trade
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6 animate-in zoom-in-95 duration-300">
                    <div className={cn(
                      "p-6 rounded-xl border flex flex-col items-center text-center gap-4",
                      feedback === "success" 
                        ? "bg-emerald-500/10 border-emerald-500/30" 
                        : "bg-orange-500/10 border-orange-500/30"
                    )}>
                      {feedback === "success" ? (
                        <>
                          <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <TrendingUp className="h-6 w-6 text-emerald-500" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-emerald-500">Excellent Analysis</h3>
                            <p className="text-slate-300 mt-2">
                              Shifting {allocation}% to cash was prudent. With a 50bps hike, long-duration assets (tech stocks, long bonds) will suffer most. 
                              Short-term bills now offer attractive risk-free yield.
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                            <TrendingDown className="h-6 w-6 text-orange-500" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-orange-500">Risky Move</h3>
                            <p className="text-slate-300 mt-2">
                              {allocation[0] < 20 ? "You under-reacted." : "You over-reacted."} 
                              {allocation[0] < 20 
                                ? " Staying too heavy in stocks/bonds during a major rate shock exposes you to significant drawdown." 
                                : " Going too heavy into cash locks in losses and misses the eventual rebound."}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                    
                    <Button onClick={reset} variant="outline" className="w-full border-border hover:bg-white/5">
                      <RefreshCw className="mr-2 h-4 w-4" /> Try Another Scenario
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Live Data Context */}
          <div className="space-y-6">
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Real-Time Impact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { name: "S&P 500", val: "-2.4%", down: true },
                  { name: "NASDAQ", val: "-3.1%", down: true },
                  { name: "10Y Treasury", val: "+4.2%", down: false, highlight: true },
                  { name: "USD Index", val: "+0.8%", down: false },
                ].map((item, i) => (
                  <div key={i} className={cn("flex justify-between items-center p-3 rounded bg-background/50", item.highlight && "border border-primary/30 ring-1 ring-primary/20")}>
                    <span className="font-medium text-slate-300">{item.name}</span>
                    <span className={cn("font-mono font-bold", item.down ? "text-rose-500" : "text-emerald-500")}>
                      {item.val}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="p-4 rounded-xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/20">
              <h4 className="font-bold text-blue-100 mb-2">Why does this matter?</h4>
              <p className="text-sm text-blue-200/80 leading-relaxed">
                Interest rates are like gravity for asset prices. When rates go up, the value of future cash flows (stocks) goes down.
              </p>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  );
}