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
  Wallet,
  FileText,
  Download,
  Eye
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

  // Fixed Income specific materials
  const fixedIncomeModules = [
    {
      id: 1,
      title: "Present Value Primer",
      type: "PDF",
      size: "2.4 MB",
      date: "2024-01-15",
      description: "Master bond markets, credit analysis, and yield dynamics",
      progress: 100,
      status: "Completed"
    },
    {
      id: 2,
      title: "Equity Valuation Masterclass",
      type: "VIDEO",
      size: "156 MB",
      duration: "1h 45m",
      date: "2024-01-18",
      description: "Deep dive into equity pricing models and valuation techniques",
      progress: 0,
      status: "Not Started"
    },
    {
      id: 3,
      title: "Bond Yields Explained",
      type: "ARTICLE",
      size: "12 KB",
      date: "2024-01-20",
      description: "Understanding yield curves, spreads, and market dynamics",
      progress: 0,
      status: "Locked"
    },
    {
      id: 4,
      title: "NPV Case Studies",
      type: "POWERPOINT",
      size: "5.8 MB",
      date: "2024-01-22",
      description: "Real-world examples of net present value calculations",
      progress: 0,
      status: "Not Started"
    },
    {
      id: 5,
      title: "Audio: Credit Spreads Deep Dive",
      type: "AUDIO",
      size: "43 MB",
      date: "2024-01-25",
      description: "Podcast series on credit analysis and spread trading",
      progress: 0,
      status: "Not Started"
    },
    {
      id: 6,
      title: "Equity Research Summary",
      type: "SUMMARY",
      size: "800 KB",
      date: "2024-01-26",
      description: "Comprehensive research notes and investment theses",
      progress: 0,
      status: "Locked"
    }
  ];

  const academyLessons = [
    {
      week: 1,
      title: "Time Value of Money Fundamentals",
      lessons: [
        "Time value basics",
        "Future value calculations",
        "Present value discounting"
      ],
      completed: 3,
      total: 3
    },
    {
      week: 2,
      title: "Compounding vs Discounting",
      lessons: [
        "Simple vs compound interest",
        "Discount rates",
        "Effective annual rates"
      ],
      completed: 2,
      total: 3
    },
    {
      week: 3,
      title: "Cash Flow Analysis",
      lessons: [
        "NPV calculations",
        "IRR methodology",
        "Perpetuities and annuities"
      ],
      completed: 0,
      total: 3
    }
  ];

  const getTypeIcon = (type: string) => {
    switch(type) {
      case "PDF":
        return "📄";
      case "VIDEO":
        return "🎬";
      case "ARTICLE":
        return "📰";
      case "POWERPOINT":
        return "📊";
      case "AUDIO":
        return "🎙️";
      case "SUMMARY":
        return "📑";
      default:
        return "📎";
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case "Completed":
        return "bg-emerald-500/10 border-emerald-500/30 text-emerald-500";
      case "Not Started":
        return "bg-slate-500/10 border-slate-500/30 text-slate-500";
      case "Locked":
        return "bg-red-500/10 border-red-500/30 text-red-500";
      default:
        return "bg-blue-500/10 border-blue-500/30 text-blue-500";
    }
  };

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">

        {/* Domain Header / Cockpit */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-primary border-primary/30 uppercase tracking-widest text-[10px]">
                {domain} DOMAIN
              </Badge>
              <Badge variant="secondary" className="text-muted-foreground uppercase tracking-widest text-[10px]">
                WEEK 4 / 12
              </Badge>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white capitalize font-serif">{domain} Management</h1>
            <p className="text-muted-foreground max-w-2xl text-sm md:text-base">
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
          <div className="border-b border-border/50 overflow-x-auto">
            <TabsList className="bg-transparent p-0 h-auto gap-6 justify-start w-full min-w-max">
              <TabsTrigger value="academy" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Academy & Lessons
              </TabsTrigger>
              <TabsTrigger value="materials" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Materials Library
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" /> Current Lesson
                </h3>
                <Card className="bg-card border-border/50">
                  <CardContent className="p-0">
                    <div className="aspect-video bg-black/50 relative group cursor-pointer">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform">
                          <PlayCircle className="h-8 w-8 text-white" />
                        </div>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-4 bg-linear-to-t from-black/80 to-transparent">
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

                {academyLessons.map((week, idx) => (
                  <Card key={idx} className="bg-card border-border/50 overflow-hidden">
                    <CardHeader className="pb-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <Badge variant="outline" className="mb-2 border-primary/30 text-primary">
                            Week {week.week}
                          </Badge>
                          <CardTitle className="text-lg">{week.title}</CardTitle>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono text-muted-foreground">
                            {week.completed}/{week.total} completed
                          </div>
                          <Progress value={(week.completed / week.total) * 100} className="h-1.5 w-24 mt-2" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {week.lessons.map((lesson, lIdx) => (
                        <div key={lIdx} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
                          <div className={`h-5 w-5 rounded border-2 flex items-center justify-center ${lIdx < week.completed ? 'bg-primary border-primary' : 'border-border'}`}>
                            {lIdx < week.completed && <CheckCircle2 className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-sm text-muted-foreground flex-1">{lesson}</span>
                          <Button variant="ghost" size="sm" className="h-7 px-2">
                            {lIdx < week.completed ? "Review" : "Start"}
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="space-y-6">
                <Card className="border-border/50 bg-card/30">
                  <CardHeader>
                    <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Learning Progress</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white">
                        <span>Overall Completion</span>
                        <span>58%</span>
                      </div>
                      <Progress value={58} className="h-1 bg-secondary" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white">
                        <span>Quiz Average</span>
                        <span className="text-emerald-500">88%</span>
                      </div>
                      <Progress value={88} className="h-1 bg-secondary" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white">
                        <span>Days Streak</span>
                        <span className="text-primary">12 days</span>
                      </div>
                      <Progress value={100} className="h-1 bg-secondary" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Next Milestone
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-300 mb-4">
                      Complete Week 4 to unlock the Advanced Derivatives module.
                    </p>
                    <div className="text-xs text-muted-foreground mb-3">
                      3 lessons remaining
                    </div>
                    <Button className="w-full bg-primary text-black hover:bg-white text-sm">Continue Learning</Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* MATERIALS TAB */}
          <TabsContent value="materials" className="space-y-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" /> Materials Library
                </h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="border-border hover:bg-white/5">
                    <Download className="h-3 w-3 mr-1" /> Download All
                  </Button>
                </div>
              </div>

              {/* Materials Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fixedIncomeModules.map((material) => (
                  <Card
                    key={material.id}
                    className={`border-border/50 overflow-hidden hover:border-primary/50 transition-all cursor-pointer ${
                      material.status === "Locked" ? "opacity-60 pointer-events-none" : ""
                    }`}
                  >
                    <div className="h-1 bg-secondary w-full">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${material.progress}%` }}
                      />
                    </div>

                    <CardContent className="p-6 space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="text-2xl">{getTypeIcon(material.type)}</div>
                          <div className="flex-1">
                            <h4 className="font-bold text-white">{material.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {material.description}
                            </p>
                          </div>
                        </div>
                        {material.status === "Locked" && (
                          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </div>

                      <Separator className="bg-border/30" />

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-4">
                          <span className="font-mono">{material.type}</span>
                          <span>{material.size}</span>
                          {material.duration && <span>{material.duration}</span>}
                        </div>
                        <Badge variant="outline" className={`${getStatusColor(material.status)}`}>
                          {material.status}
                        </Badge>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-border hover:bg-white/5"
                          disabled={material.status === "Locked"}
                        >
                          <Eye className="h-3 w-3 mr-1" /> Preview
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-border hover:bg-white/5"
                          disabled={material.status === "Locked"}
                        >
                          <Download className="h-3 w-3 mr-1" /> Download
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Materials Organization */}
              <Card className="border-border/50 bg-card/30">
                <CardHeader>
                  <CardTitle>Organize by Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {["All", "Videos", "PDFs", "Articles", "Audio", "Presentations"].map((type) => (
                      <Button
                        key={type}
                        variant={type === "All" ? "default" : "outline"}
                        size="sm"
                        className="w-full"
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
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