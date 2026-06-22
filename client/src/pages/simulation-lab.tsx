import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { useMarketPilotOverview, usePortfolioModels, usePortfolioRiskAnalytics, useScenarioSimulation, useStrategyValidationMutation, type BacktestRequest, type BacktestResult, type OptionsSimulation, type OptionsSimulationRequest, type ScenarioName, type StrategyValidationInput } from "@/lib/marketpilot";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Gauge, LineChart, PieChart, ShieldAlert, Sigma, WalletCards } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

const scenarios: Array<{ id: ScenarioName; label: string; description: string }> = [
  {
    id: "2022_rate_shock",
    label: "2022 Rate Shock",
    description: "Stocks and bonds reprice together as inflation and yields rise.",
  },
  {
    id: "2020_covid_crash",
    label: "2020 COVID Crash",
    description: "Fast equity drawdown with a shorter recovery path.",
  },
  {
    id: "2008_crisis",
    label: "2008 Crisis",
    description: "Deep equity stress with long recovery and liquidity pressure.",
  },
  {
    id: "oil_shock",
    label: "Oil Shock",
    description: "Inflation-sensitive stress from commodity supply disruption.",
  },
];

const defaultOptionsRequest: OptionsSimulationRequest = {
  underlying: "SPY",
  underlyingPrice: 500,
  daysToExpiration: 30,
  impliedVolatilityPct: 22,
  legs: [{ action: "buy", type: "call", strike: 505, premium: 6, contracts: 1 }],
};

const backtestPresets: Record<string, BacktestRequest> = {
  three_fund: {
    strategyName: "Three-fund portfolio",
    startYear: 2008,
    endYear: 2026,
    initialCapital: 25000,
    monthlyContribution: 500,
    rebalanceFrequency: "annual",
    allocation: [
      { symbol: "VTI", targetPct: 55 },
      { symbol: "VXUS", targetPct: 25 },
      { symbol: "BND", targetPct: 20 },
    ],
  },
  sixty_forty: {
    strategyName: "60/40 diversified portfolio",
    startYear: 2008,
    endYear: 2026,
    initialCapital: 25000,
    monthlyContribution: 500,
    rebalanceFrequency: "annual",
    allocation: [
      { symbol: "VTI", targetPct: 45 },
      { symbol: "VXUS", targetPct: 15 },
      { symbol: "BND", targetPct: 40 },
    ],
  },
  equity_satellite: {
    strategyName: "Equity satellite portfolio",
    startYear: 2019,
    endYear: 2026,
    initialCapital: 25000,
    monthlyContribution: 500,
    rebalanceFrequency: "quarterly",
    allocation: [
      { symbol: "VTI", targetPct: 65 },
      { symbol: "QQQ", targetPct: 20 },
      { symbol: "SGOV", targetPct: 15 },
    ],
  },
};

export default function SimulationLab() {
  const [scenario, setScenario] = useState<ScenarioName>("2022_rate_shock");
  const [optionsRequest, setOptionsRequest] = useState<OptionsSimulationRequest>(defaultOptionsRequest);
  const [backtestRequest, setBacktestRequest] = useState<BacktestRequest>(backtestPresets.three_fund);
  const { data: simulation, isLoading } = useScenarioSimulation(scenario);
  const { data: overview } = useMarketPilotOverview();
  const { data: portfolioModels } = usePortfolioModels();
  const { data: riskAnalytics } = usePortfolioRiskAnalytics();
  const strategyValidation = useStrategyValidationMutation();
  const activeScenario = scenarios.find((item) => item.id === scenario) ?? scenarios[0];
  const drawdownMagnitude = Math.min(100, Math.abs(simulation?.estimatedDrawdownPct ?? 0) * 3);
  const optionsSimulation = useMutation<OptionsSimulation, Error, OptionsSimulationRequest>({
    mutationFn: async (request) => {
      const response = await apiRequest("POST", "/api/marketpilot/options/simulate", request);
      return response.json();
    },
  });
  const backtest = useMutation<BacktestResult, Error, BacktestRequest>({
    mutationFn: async (request) => {
      const response = await apiRequest("POST", "/api/marketpilot/backtests", request);
      return response.json();
    },
  });
  const strategyValidationInput = backtest.data ? buildStrategyValidationInput(backtestRequest, backtest.data) : null;

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-3 border-b border-border/50 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary">
                Paper portfolio only
              </Badge>
              <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                Simulation, not a forecast
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold text-white">Simulation Lab</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Stress-test the current paper portfolio against historical-style regimes before any trade idea advances.
            </p>
          </div>
          {overview && (
            <div className="rounded-lg border border-border/60 bg-card/70 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Current risk score</div>
              <div className="mt-1 font-mono text-2xl font-bold text-white">{overview.portfolio.riskScore}/100</div>
            </div>
          )}
        </div>

        <Tabs value={scenario} onValueChange={(value) => setScenario(value as ScenarioName)}>
          <TabsList className="grid h-auto grid-cols-1 gap-2 bg-card/40 p-2 md:grid-cols-4">
            {scenarios.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="justify-start px-3 py-2 text-left">
                <span>
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {riskAnalytics && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldAlert className="h-5 w-5 text-primary" />
                Portfolio Risk Analytics
              </CardTitle>
              <CardDescription>
                Institutional-style paper portfolio metrics for sizing, concentration, liquidity, and scenario discipline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <Metric icon={Gauge} label="VaR 95" value={`$${riskAnalytics.valueAtRisk95.toLocaleString()}`} />
                <Metric icon={ShieldAlert} label="CVaR 95" value={`$${riskAnalytics.conditionalValueAtRisk95.toLocaleString()}`} />
                <Metric icon={LineChart} label="Annual vol" value={`${riskAnalytics.estimatedAnnualVolatilityPct.toFixed(2)}%`} />
                <Metric icon={WalletCards} label="Beta" value={riskAnalytics.beta.toFixed(2)} />
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <InfoBlock title="Sharpe" value={riskAnalytics.sharpeRatio.toFixed(2)} />
                <InfoBlock title="Sortino" value={riskAnalytics.sortinoRatio.toFixed(2)} />
                <InfoBlock title="Liquidity score" value={`${riskAnalytics.liquidityScore}/100`} />
                <InfoBlock
                  title="Largest position"
                  value={`${riskAnalytics.largestPosition.symbol} ${riskAnalytics.largestPosition.allocation.toFixed(1)}%`}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ListBlock
                  title="Risk Breaches"
                  items={riskAnalytics.riskBreaches.length > 0 ? riskAnalytics.riskBreaches : ["No portfolio analytics breach flagged."]}
                />
                <ListBlock title="Required Actions" items={riskAnalytics.requiredActions} />
              </div>

              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Correlation snapshot</div>
                <div className="grid gap-2 md:grid-cols-3">
                  {riskAnalytics.correlationMatrix.slice(0, 6).map((item) => (
                    <div key={item.pair} className="grid grid-cols-[1fr_auto] rounded-md border border-border/60 bg-background/35 px-3 py-2 text-sm">
                      <span className="text-slate-200">{item.pair}</span>
                      <span className="font-mono text-white">{item.correlation.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading || !simulation ? (
          <Card className="border-border/50 bg-card/70">
            <CardContent className="p-6 text-muted-foreground">Running scenario...</CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <LineChart className="h-5 w-5 text-primary" />
                    {activeScenario.label}
                  </CardTitle>
                  <CardDescription>{activeScenario.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Metric
                      icon={WalletCards}
                      label="Before"
                      value={`$${simulation.portfolioValueBefore.toLocaleString()}`}
                    />
                    <Metric
                      icon={ShieldAlert}
                      label="After shock"
                      value={`$${simulation.estimatedPortfolioValueAfter.toLocaleString()}`}
                    />
                    <Metric
                      icon={Clock3}
                      label="Recovery estimate"
                      value={`${simulation.estimatedRecoveryMonths} mo`}
                    />
                  </div>

                  <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Estimated drawdown</div>
                        <div className="mt-1 font-mono text-3xl font-bold text-rose-300">
                          {simulation.estimatedDrawdownPct.toFixed(2)}%
                        </div>
                      </div>
                      <Gauge className="h-8 w-8 text-rose-300" />
                    </div>
                    <Progress value={drawdownMagnitude} className="mt-4 h-2" />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoBlock title="Largest risk contributor" value={simulation.largestRiskContributor} />
                    <InfoBlock title="Liquidity" value={simulation.liquidityWarning ?? "No liquidity warning from this stress run."} />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <AlertTriangle className="h-5 w-5 text-amber-300" />
                    Risk Review
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {simulation.riskBreaches.length > 0 ? (
                    simulation.riskBreaches.map((breach) => (
                      <div key={breach} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                        {breach}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      No scenario-specific risk breach flagged.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="text-white">Scenario Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {simulation.notes.map((note) => (
                    <div key={note} className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-slate-200">
                      {note}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <Card className="border-border/50 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <LineChart className="h-5 w-5 text-primary" />
              Strategy Backtest
            </CardTitle>
            <CardDescription>
              Compare paper-only allocation presets against historical-style return fixtures before any rebalance ticket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Preset">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-white"
                  value={Object.entries(backtestPresets).find(([, preset]) => preset.strategyName === backtestRequest.strategyName)?.[0] ?? "three_fund"}
                  onChange={(event) => setBacktestRequest(backtestPresets[event.target.value])}
                >
                  <option value="three_fund">Three fund</option>
                  <option value="sixty_forty">60/40</option>
                  <option value="equity_satellite">Equity satellite</option>
                </select>
              </Field>
              <Field label="Start">
                <Input
                  type="number"
                  min="2000"
                  max="2026"
                  value={backtestRequest.startYear}
                  onChange={(event) => setBacktestRequest({ ...backtestRequest, startYear: Number(event.target.value) })}
                />
              </Field>
              <Field label="End">
                <Input
                  type="number"
                  min="2000"
                  max="2026"
                  value={backtestRequest.endYear}
                  onChange={(event) => setBacktestRequest({ ...backtestRequest, endYear: Number(event.target.value) })}
                />
              </Field>
              <Field label="Initial">
                <Input
                  type="number"
                  min="1"
                  step="100"
                  value={backtestRequest.initialCapital}
                  onChange={(event) => setBacktestRequest({ ...backtestRequest, initialCapital: Number(event.target.value) })}
                />
              </Field>
              <Field label="Monthly">
                <Input
                  type="number"
                  min="0"
                  step="50"
                  value={backtestRequest.monthlyContribution}
                  onChange={(event) => setBacktestRequest({ ...backtestRequest, monthlyContribution: Number(event.target.value) })}
                />
              </Field>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              {backtestRequest.allocation.map((item) => (
                <div key={item.symbol} className="grid grid-cols-[1fr_auto] rounded-md border border-border/60 bg-background/35 px-3 py-2 text-sm">
                  <span className="text-slate-200">{item.symbol}</span>
                  <span className="font-mono text-white">{item.targetPct.toFixed(1)}%</span>
                </div>
              ))}
            </div>

            {backtest.error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                {backtest.error.message}
              </div>
            )}

            <Button className="gap-2" disabled={backtest.isPending} onClick={() => backtest.mutate(backtestRequest)}>
              <LineChart className="h-4 w-4" />
              {backtest.isPending ? "Running..." : "Run Backtest"}
            </Button>

            {backtest.data && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <InfoBlock title="Final value" value={`$${backtest.data.finalValue.toLocaleString()}`} />
                  <InfoBlock title="Annualized" value={`${backtest.data.annualizedReturnPct.toFixed(2)}%`} />
                  <InfoBlock title="Max drawdown" value={`${backtest.data.maxDrawdownPct.toFixed(2)}%`} />
                  <InfoBlock title="Sharpe" value={backtest.data.sharpeRatio.toFixed(2)} />
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <ListBlock
                    title="Backtest Breaches"
                    items={backtest.data.riskBreaches.length > 0 ? backtest.data.riskBreaches : ["No backtest risk breach flagged."]}
                  />
                  <ListBlock title="Required Actions" items={backtest.data.requiredActions} />
                </div>

                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Annual path</div>
                  <div className="grid gap-2 md:grid-cols-4">
                    {backtest.data.annualResults.slice(-8).map((year) => (
                      <div key={year.year} className="rounded-md border border-border/60 bg-background/35 p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-200">{year.year}</span>
                          <span className={year.returnPct >= 0 ? "font-mono text-emerald-300" : "font-mono text-rose-300"}>
                            {year.returnPct >= 0 ? "+" : ""}{year.returnPct.toFixed(2)}%
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">${year.endingValue.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {strategyValidationInput && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <LineChart className="h-5 w-5 text-primary" />
                Strategy Research Scorecard
              </CardTitle>
              <CardDescription>
                Validate the backtest against walk-forward, Monte Carlo, regime, and symbol-suitability evidence before any automation claim.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <InfoBlock title="Strategy" value={strategyValidationInput.strategyId} />
                <InfoBlock title="Instrument" value={strategyValidationInput.instrument} />
                <InfoBlock title="Walk-forward" value={`${strategyValidationInput.walkForward.profitableWindowsPct.toFixed(0)}%`} />
                <InfoBlock title="Ruin risk" value={`${strategyValidationInput.monteCarlo.riskOfRuinPct.toFixed(1)}%`} />
              </div>

              {strategyValidation.error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  {strategyValidation.error.message}
                </div>
              )}

              <Button
                className="gap-2"
                disabled={strategyValidation.isPending}
                onClick={() => strategyValidation.mutate(strategyValidationInput)}
              >
                <LineChart className="h-4 w-4" />
                {strategyValidation.isPending ? "Evaluating..." : "Run Strategy Validation"}
              </Button>

              {strategyValidation.data && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <InfoBlock title="Verdict" value={strategyValidation.data.verdict.replaceAll("_", " ")} />
                    <InfoBlock title="Overall" value={`${strategyValidation.data.overallScore}/100`} />
                    <InfoBlock title="Overfitting" value={strategyValidation.data.overfittingWarning ? "warning" : "clear"} />
                    <InfoBlock title="Regime" value={strategyValidation.data.regimeSensitivity} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ListBlock
                      title="Reasons"
                      items={strategyValidation.data.reasons.length > 0 ? strategyValidation.data.reasons : ["No blockers in the current research snapshot."]}
                    />
                    <ListBlock
                      title="Validation guidance"
                      items={strategyValidation.data.verdict === "supervised_live_candidate"
                        ? ["Validated for supervised-live consideration only, not authorization."]
                        : ["Review the weaker scores, especially walk-forward and Monte Carlo robustness."]}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-border/50 bg-card/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Sigma className="h-5 w-5 text-primary" />
              Options Payoff Simulator
            </CardTitle>
            <CardDescription>
              Model defined-risk and single-leg options structures before any options ticket can be considered.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Underlying">
                <Input
                  value={optionsRequest.underlying}
                  onChange={(event) => setOptionsRequest({ ...optionsRequest, underlying: event.target.value })}
                />
              </Field>
              <Field label="Spot">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={optionsRequest.underlyingPrice}
                  onChange={(event) => setOptionsRequest({ ...optionsRequest, underlyingPrice: Number(event.target.value) })}
                />
              </Field>
              <Field label="Days">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={optionsRequest.daysToExpiration}
                  onChange={(event) => setOptionsRequest({ ...optionsRequest, daysToExpiration: Number(event.target.value) })}
                />
              </Field>
              <Field label="IV %">
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={optionsRequest.impliedVolatilityPct}
                  onChange={(event) => setOptionsRequest({ ...optionsRequest, impliedVolatilityPct: Number(event.target.value) })}
                />
              </Field>
              <Field label="Strategy">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-white"
                  value={optionsRequest.legs.length === 2 ? "call_spread" : `${optionsRequest.legs[0].action}_${optionsRequest.legs[0].type}`}
                  onChange={(event) => setOptionsRequest(nextOptionsPreset(event.target.value, optionsRequest))}
                >
                  <option value="buy_call">Long call</option>
                  <option value="buy_put">Long put</option>
                  <option value="sell_call">Short call</option>
                  <option value="call_spread">Call spread</option>
                </select>
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {optionsRequest.legs.map((leg, index) => (
                <div key={`${leg.action}-${leg.type}-${index}`} className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">
                      {leg.action.toUpperCase()} {leg.type.toUpperCase()}
                    </div>
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      {leg.contracts} contract
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Strike">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={leg.strike}
                        onChange={(event) => updateOptionLeg(index, { strike: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Premium">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={leg.premium}
                        onChange={(event) => updateOptionLeg(index, { premium: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Contracts">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={leg.contracts}
                        onChange={(event) => updateOptionLeg(index, { contracts: Number(event.target.value) })}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>

            {optionsSimulation.error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                {optionsSimulation.error.message}
              </div>
            )}

            <Button
              className="gap-2"
              disabled={optionsSimulation.isPending}
              onClick={() => optionsSimulation.mutate(optionsRequest)}
            >
              <Sigma className="h-4 w-4" />
              {optionsSimulation.isPending ? "Simulating..." : "Run Options Simulation"}
            </Button>

            {optionsSimulation.data && (
              <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
                <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{optionsSimulation.data.strategyName}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{optionsSimulation.data.riskRewardSummary}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={optionsSimulation.data.proficiencyGate.unlocked ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}
                    >
                      Options score {optionsSimulation.data.proficiencyGate.currentScore}/{optionsSimulation.data.proficiencyGate.requiredScore}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <InfoBlock title="Net debit/credit" value={formatMoney(optionsSimulation.data.netDebit)} />
                    <InfoBlock title="Max loss" value={formatNullableMoney(optionsSimulation.data.maxLoss)} />
                    <InfoBlock title="Max profit" value={formatNullableMoney(optionsSimulation.data.maxProfit)} />
                    <InfoBlock title="Breakeven" value={optionsSimulation.data.breakevens.map((price) => price.toFixed(2)).join(" / ") || "None"} />
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    {optionsSimulation.data.priceRange.slice(0, 9).map((point) => (
                      <div key={point.price} className="grid grid-cols-2 rounded-md bg-card/60 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">${point.price.toFixed(2)}</span>
                        <span className={point.payoff >= 0 ? "text-right font-mono text-emerald-300" : "text-right font-mono text-rose-300"}>
                          {formatMoney(point.payoff)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                    <div className="text-sm font-semibold text-white">Assignment Risk</div>
                    <p className="mt-2 text-sm text-muted-foreground">{optionsSimulation.data.assignmentRisk}</p>
                  </div>
                  <ListBlock title="Gate Actions" items={optionsSimulation.data.proficiencyGate.requiredActions} />
                  <ListBlock title="Safety Notes" items={optionsSimulation.data.safetyNotes} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {portfolioModels && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <PieChart className="h-5 w-5 text-primary" />
                Portfolio Model Comparison
              </CardTitle>
              <CardDescription>
                Compare the current paper allocation with model portfolios before creating any rebalance ticket.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              {portfolioModels.map((model) => (
                <div key={model.id} className="rounded-lg border border-border/60 bg-background/35 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-white">{model.name}</h3>
                        <Badge variant="outline" className="border-primary/30 text-primary">
                          {model.level}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{model.objective}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Turnover</div>
                      <div className="font-mono text-sm text-white">${model.turnoverEstimate.toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {model.targetAllocation.map((target) => (
                      <div key={`${model.id}-${target.symbol}`} className="grid grid-cols-[1fr_auto] gap-3 rounded-md bg-card/60 p-2">
                        <div>
                          <div className="text-sm font-medium text-white">{target.sleeve}</div>
                          <div className="text-xs text-muted-foreground">
                            {target.symbol} / current {target.currentPct.toFixed(1)}% / target {target.targetPct.toFixed(1)}%
                          </div>
                        </div>
                        <div className={target.driftPct >= 0 ? "text-right text-emerald-300" : "text-right text-rose-300"}>
                          <div className="font-mono text-sm">{target.driftPct >= 0 ? "+" : ""}{target.driftPct.toFixed(1)}%</div>
                          <div className="text-xs">${target.estimatedTradeValue.toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Risk notes</div>
                      <div className="space-y-2">
                        {model.riskNotes.map((note) => (
                          <div key={note} className="rounded-md border border-border/60 bg-background/40 p-2 text-xs text-slate-200">
                            {note}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Gates</div>
                      <div className="space-y-2">
                        {model.suitabilityGates.map((gate) => (
                          <div key={gate} className="rounded-md border border-border/60 bg-background/40 p-2 text-xs text-slate-200">
                            {gate}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );

  function updateOptionLeg(index: number, patch: Partial<OptionsSimulationRequest["legs"][number]>) {
    setOptionsRequest({
      ...optionsRequest,
      legs: optionsRequest.legs.map((leg, legIndex) => (legIndex === index ? { ...leg, ...patch } : leg)),
    });
  }
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/35 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 font-mono text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 text-sm text-white">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-4">
      <div className="mb-2 text-sm font-semibold text-white">{title}</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-md bg-card/60 p-2 text-xs text-slate-200">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function nextOptionsPreset(value: string, current: OptionsSimulationRequest): OptionsSimulationRequest {
  const baseStrike = Math.round(current.underlyingPrice / 5) * 5;
  const common = {
    underlying: current.underlying,
    underlyingPrice: current.underlyingPrice,
    daysToExpiration: current.daysToExpiration,
    impliedVolatilityPct: current.impliedVolatilityPct,
  };

  if (value === "buy_put") {
    return { ...common, legs: [{ action: "buy", type: "put", strike: baseStrike - 5, premium: 5.5, contracts: 1 }] };
  }
  if (value === "sell_call") {
    return { ...common, legs: [{ action: "sell", type: "call", strike: baseStrike + 10, premium: 4, contracts: 1 }] };
  }
  if (value === "call_spread") {
    return {
      ...common,
      legs: [
        { action: "buy", type: "call", strike: baseStrike, premium: 8, contracts: 1 },
        { action: "sell", type: "call", strike: baseStrike + 15, premium: 3, contracts: 1 },
      ],
    };
  }
  return { ...common, legs: [{ action: "buy", type: "call", strike: baseStrike + 5, premium: 6, contracts: 1 }] };
}

function buildStrategyValidationInput(backtestRequest: BacktestRequest, backtest: BacktestResult): StrategyValidationInput {
  const returns = backtest.annualResults.map((year) => year.returnPct);
  const positiveYears = returns.filter((value) => value >= 0).length;
  const half = Math.max(1, Math.floor(returns.length / 2));
  const firstHalf = returns.slice(0, half);
  const secondHalf = returns.slice(-half);
  const firstHalfAverage = firstHalf.length > 0 ? firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length : 0;
  const secondHalfAverage = secondHalf.length > 0 ? secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length : 0;
  const degradationPct = Math.max(0, firstHalfAverage - secondHalfAverage);
  const worstYear = Math.min(...returns, backtest.maxDrawdownPct * -1);
  const riskOfRuinPct = Math.min(100, Math.max(0, Math.abs(backtest.maxDrawdownPct) * 2 + (backtest.sharpeRatio < 0 ? 20 : 0)));
  const symbol = backtestRequest.allocation[0]?.symbol ?? "VTI";

  return {
    strategyId: slugify(backtest.strategyName),
    instrument: symbol,
    backtest: {
      netReturnPct: backtest.cumulativeReturnPct,
      sharpe: backtest.sharpeRatio,
      profitFactor: backtest.annualizedReturnPct > 0 ? Math.max(0.1, 1 + backtest.annualizedReturnPct / 20) : 0.4,
      maxDrawdownPct: Math.abs(backtest.maxDrawdownPct),
      tradeCount: backtest.annualResults.length * 12,
    },
    walkForward: {
      profitableWindowsPct: returns.length > 0 ? (positiveYears / returns.length) * 100 : 0,
      outOfSampleReturnPct: secondHalfAverage,
      degradationPct,
    },
    monteCarlo: {
      profitableRunsPct: returns.length > 0 ? (positiveYears / returns.length) * 100 : 0,
      medianEndingReturnPct: backtest.annualizedReturnPct,
      riskOfRuinPct,
    },
    regimePerformance: {
      stress: worstYear,
      baseline: backtest.annualizedReturnPct,
      recovery: Math.max(...returns, 0),
    },
    symbolPerformance: {
      [symbol]: backtest.annualizedReturnPct,
    },
  };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatMoney(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatNullableMoney(value: number | null) {
  return value === null ? "Unlimited" : formatMoney(value);
}
