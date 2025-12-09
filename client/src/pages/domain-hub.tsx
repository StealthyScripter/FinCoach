import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  BookOpen, 
  PlayCircle, 
  TrendingUp, 
  TrendingDown, 
  Newspaper, 
  History, 
  FlaskConical, 
  Crosshair, 
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  RefreshCcw,
  Calendar,
  Wallet
} from "lucide-react";
import { useRoute } from "wouter";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function DomainHub() {
  const [match, params] = useRoute("/learn/:domain");
  const domain = params?.domain || "portfolio";
  
  // Mock data tailored to the requested structure
  const domainData = {
    balance: 100000,
    pnl: +2450.50,
    pnlPercent: +2.45,
    weeklyBudget: 5000,
    score: "B+",
    news: [
      { time: "10:42", title: "Central Bank Minutes Released", impact: "HIGH", sentiment: "negative" },
      { time: "09:15", title: "Sector Rotation: Tech to Utilities", impact: "MED", sentiment: "neutral" },
      { time: "08:30", title: "New Regulatory Framework Proposed", impact: "LOW", sentiment: "positive" },
    ]
  };

  const MOCK_PERFORMANCE = [
    { day: 'Mon', val: 100000 },
    { day: 'Tue', val: 101200 },
    { day: 'Wed', val: 100800 },
    { day: 'Thu', val: 102450 },
    { day: 'Fri', val: 102450 },
  ];

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        
        {/* Domain Header / Cockpit */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-3 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-primary border-primary/30 uppercase tracking-widest text-[10px]">
                {domain} DOMAIN
              </Badge>
              <Badge variant="secondary" className="text-muted-foreground uppercase tracking-widest text-[10px]">
                WEEK 4 / 12
              </Badge>
            </div>
            <h1 className="text-4xl font-bold text-white capitalize font-serif">{domain} Management</h1>
            <p className="text-muted-foreground max-w-2xl">
              Master the art of {domain} through structured modules, live market simulations, and historical backtesting.
            </p>
          </div>
          
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">Available Capital</div>
              <div className="text-2xl font-bold text-white font-mono">${domainData.balance.toLocaleString()}</div>
              <div className="flex justify-between items-end mt-2">
                <div className={`text-sm font-mono ${domainData.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {domainData.pnl >= 0 ? '+' : ''}{domainData.pnl.toLocaleString()} ({domainData.pnlPercent}%)
                </div>
                <div className="text-xs px-2 py-0.5 rounded bg-white/10 text-white font-bold">Grade: {domainData.score}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="academy" className="space-y-6">
          <div className="border-b border-border/50">
            <TabsList className="bg-transparent p-0 h-auto gap-6 justify-start w-full">
              <TabsTrigger value="academy" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Academy & Materials
              </TabsTrigger>
              <TabsTrigger value="simulator" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Live Simulator
              </TabsTrigger>
              <TabsTrigger value="backtest" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Backtesting Lab
              </TabsTrigger>
              <TabsTrigger value="intel" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Market Intel
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ACADEMY TAB */}
          <TabsContent value="academy" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" /> Current Module: Risk Parity
                </h3>
                <Card className="bg-card border-border/50">
                  <CardContent className="p-0">
                    <div className="aspect-video bg-black/50 relative group cursor-pointer">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform">
                          <PlayCircle className="h-8 w-8 text-white" />
                        </div>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-white font-bold">Lecture 4.2: Understanding Correlation Matrices</p>
                        <p className="text-xs text-slate-300">12:45 • Dr. Sarah Jenkings</p>
                      </div>
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="prose prose-invert max-w-none text-sm text-muted-foreground">
                        <p>
                          In this lesson, we explore how asset classes interact during volatility events. 
                          Key takeaways include calculating covariance and constructing a balanced portfolio 
                          that survives regime changes.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">< Newspaper className="mr-2 h-3 w-3" /> Read Summary</Button>
                        <Button variant="outline" size="sm"><CheckCircle2 className="mr-2 h-3 w-3" /> Take Quiz</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <h4 className="font-semibold text-white">Up Next</h4>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-border/50 bg-card/50 hover:bg-card transition-colors cursor-pointer">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground font-mono text-xs">
                        0{i}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-white">Advanced Diversification Strategies</p>
                        <p className="text-xs text-muted-foreground">Video • 15 mins</p>
                      </div>
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <Card className="border-border/50 bg-card/30">
                  <CardHeader>
                    <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Learning Progress</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white">
                        <span>Module Completion</span>
                        <span>42%</span>
                      </div>
                      <Progress value={42} className="h-1 bg-secondary" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white">
                        <span>Quiz Average</span>
                        <span className="text-emerald-500">88%</span>
                      </div>
                      <Progress value={88} className="h-1 bg-secondary" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Weekly Challenge
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-300 mb-4">
                      Construct a portfolio with a Sharpe Ratio {">"} 1.2 using only commodities and forex.
                    </p>
                    <Button className="w-full bg-primary text-black hover:bg-white">Start Assessment</Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* SIMULATOR TAB */}
          <TabsContent value="simulator" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-border/50 bg-card lg:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        <Crosshair className="h-5 w-5 text-primary" /> Live Market Simulator
                      </CardTitle>
                      <CardDescription>Test your skills against real-time market conditions. Feedback is immediate.</CardDescription>
                    </div>
                    <Badge variant="outline" className="animate-pulse border-red-500 text-red-500 bg-red-500/10">LIVE FEED ACTIVE</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 rounded-lg bg-secondary/30 border border-border/50 space-y-4">
                    <div className="flex items-start gap-4">
                      <AlertTriangle className="h-5 w-5 text-yellow-500 mt-1" />
                      <div>
                        <h4 className="font-bold text-white">Scenario: Unexpected Rate Cut</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          The central bank just cut rates by 25bps against consensus. Yields are crashing.
                          <br />
                          <strong>Your Portfolio:</strong> 40% Cash, 60% Short-term Bonds.
                        </p>
                      </div>
                    </div>
                    <Separator className="bg-border/50" />
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-white">Action Required: Adjust Duration Exposure</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Button variant="outline" className="h-auto py-4 flex flex-col gap-1 hover:border-primary hover:bg-primary/5">
                          <span className="font-bold">Do Nothing</span>
                          <span className="text-xs text-muted-foreground">Maintain current position</span>
                        </Button>
                        <Button variant="outline" className="h-auto py-4 flex flex-col gap-1 hover:border-primary hover:bg-primary/5">
                          <span className="font-bold">Buy Long Bonds</span>
                          <span className="text-xs text-muted-foreground">Increase duration</span>
                        </Button>
                        <Button variant="outline" className="h-auto py-4 flex flex-col gap-1 hover:border-primary hover:bg-primary/5">
                          <span className="font-bold">Short Equities</span>
                          <span className="text-xs text-muted-foreground">Hedge volatility</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded border border-border/50">
                      <h5 className="text-xs font-mono text-muted-foreground uppercase mb-2">Live Grading Criteria</h5>
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center justify-between">
                          <span>Risk Management</span>
                          <span className="text-emerald-500">A</span>
                        </li>
                        <li className="flex items-center justify-between">
                          <span>Timing</span>
                          <span className="text-yellow-500">B-</span>
                        </li>
                        <li className="flex items-center justify-between">
                          <span>Thesis Clarity</span>
                          <span className="text-muted-foreground">Pending</span>
                        </li>
                      </ul>
                    </div>
                    <div className="p-4 rounded border border-border/50">
                      <h5 className="text-xs font-mono text-muted-foreground uppercase mb-2">Your Ledger</h5>
                      <p className="text-xs text-muted-foreground mb-4">Transactions are recorded on the domain blockchain.</p>
                      <Button variant="secondary" size="sm" className="w-full">View Transaction Log</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* BACKTEST TAB */}
          <TabsContent value="backtest" className="space-y-6">
             <Card className="border-border/50 bg-card">
               <CardHeader>
                 <CardTitle className="flex items-center gap-2">
                   <History className="h-5 w-5 text-primary" /> Historical Strategy Lab
                 </CardTitle>
                 <CardDescription>
                   Validate your concepts against past market regimes (2008 Crisis, 2020 Covid Crash, 2022 Inflation).
                 </CardDescription>
               </CardHeader>
               <CardContent>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   <div className="space-y-4">
                     <div className="space-y-2">
                       <label className="text-sm text-muted-foreground">Select Regime</label>
                       <select className="w-full bg-background border border-border rounded p-2 text-sm">
                         <option>2022 Inflation Shock</option>
                         <option>2020 Covid Crash</option>
                         <option>2008 Financial Crisis</option>
                       </select>
                     </div>
                     <div className="space-y-2">
                       <label className="text-sm text-muted-foreground">Initial Capital</label>
                       <div className="flex items-center px-3 border border-border rounded bg-background">
                         <span className="text-muted-foreground">$</span>
                         <input className="bg-transparent border-none p-2 w-full focus:outline-none" defaultValue="100,000" />
                       </div>
                     </div>
                     <Button className="w-full bg-primary text-black font-bold">
                       <RefreshCcw className="mr-2 h-4 w-4" /> Run Backtest
                     </Button>
                   </div>
                   
                   <div className="md:col-span-2 h-[300px] border border-border/30 rounded bg-black/20 p-4">
                     <ResponsiveContainer width="100%" height="100%">
                       <AreaChart data={MOCK_PERFORMANCE}>
                         <defs>
                           <linearGradient id="colorPerf" x1="0" y1="0" x2="0" y2="1">
                             <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                             <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                           </linearGradient>
                         </defs>
                         <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                         <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                         <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                         <Tooltip 
                           contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                           itemStyle={{ color: '#fff' }}
                         />
                         <Area type="monotone" dataKey="val" stroke="#10b981" fillOpacity={1} fill="url(#colorPerf)" strokeWidth={2} />
                       </AreaChart>
                     </ResponsiveContainer>
                   </div>
                 </div>
               </CardContent>
             </Card>
          </TabsContent>

          {/* INTEL TAB */}
          <TabsContent value="intel" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Newspaper className="h-5 w-5 text-primary" /> Domain Bulletins
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {domainData.news.map((item, i) => (
                    <div key={i} className="flex gap-4 items-start p-3 rounded hover:bg-white/5 transition-colors cursor-pointer border-b border-border/30 last:border-0">
                      <div className="flex flex-col items-center min-w-[50px]">
                        <span className="text-xs font-mono text-muted-foreground">{item.time}</span>
                        <Badge variant="outline" className={`mt-1 text-[10px] ${item.impact === 'HIGH' ? 'border-red-500 text-red-500' : 'border-slate-500 text-slate-500'}`}>
                          {item.impact}
                        </Badge>
                      </div>
                      <div>
                        <h4 className="font-medium text-white">{item.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Consensus was expecting lower volatility. This release confirms a structural shift in...
                        </p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FlaskConical className="h-5 w-5 text-primary" /> Analyst Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                   <div className="prose prose-invert text-sm">
                     <p className="text-muted-foreground">
                       <strong>Weekly Outlook:</strong> Volatility is expected to compress as we head into the FOMC meeting. 
                       Traders should look to reduce leverage in high-beta pairings.
                     </p>
                     <ul className="list-disc pl-4 text-muted-foreground mt-2 space-y-1">
                       <li>Key Level to Watch: $102.50</li>
                       <li>Support Zone: $98.00 - $99.50</li>
                       <li>Sentiment: Neutral-Bearish</li>
                     </ul>
                   </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}