import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, Zap, Target, BookOpen, AlertCircle, TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from "wouter";
import generatedImage from '@assets/generated_images/abstract_digital_finance_visualization_with_glowing_data_streams.png';

const MOCK_CHART_DATA = [
  { name: 'Mon', value: 4000 },
  { name: 'Tue', value: 3000 },
  { name: 'Wed', value: 2000 },
  { name: 'Thu', value: 2780 },
  { name: 'Fri', value: 1890 },
  { name: 'Sat', value: 2390 },
  { name: 'Sun', value: 3490 },
];

export default function Dashboard() {
  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Welcome Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card p-8">
          <div className="absolute inset-0 z-0 opacity-20">
            <img 
              src={generatedImage} 
              alt="Background" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
          </div>

          <div className="relative z-10 max-w-2xl">
            <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
              Good Morning, Alex.
            </h1>
            <p className="text-lg text-muted-foreground mb-6">
              The market is volatile today. Inflation data just dropped, and tech stocks are reacting. 
              Your "Risk Management" module has a new live scenario waiting.
            </p>
            <div className="flex gap-4">
              <Link href="/challenge">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-white font-semibold shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                  <Zap className="mr-2 h-4 w-4" /> Start Live Challenge
                </Button>
              </Link>
              <Link href="/learn">
                <Button size="lg" variant="outline" className="border-border hover:bg-white/5">
                  Continue Learning
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Daily Insight */}
          <Card className="col-span-1 md:col-span-2 border-border/50 bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-primary" />
                    Market Context: Inflation Report
                  </CardTitle>
                  <CardDescription>How today's CPI data impacts your portfolio strategy</CardDescription>
                </div>
                <span className="text-xs font-mono px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20">LIVE DATA</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Core inflation came in at 0.4% vs 0.3% expected. This suggests the Fed might keep rates higher for longer. 
                    <br/><br/>
                    <strong>Learning Point:</strong> In this environment, growth stocks (high duration assets) typically sell off while value stocks and cash equivalents might outperform.
                  </p>
                  <Button variant="link" className="text-primary p-0 h-auto">Read full analysis <ArrowRight className="ml-1 h-3 w-3" /></Button>
                </div>
                <div className="h-[200px] w-full rounded-lg border border-border/50 bg-background/50 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={MOCK_CHART_DATA}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#10b981" fillOpacity={1} fill="url(#colorValue)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Progress Card */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm flex flex-col justify-between">
            <CardHeader>
              <CardTitle>Current Module</CardTitle>
              <CardDescription>Portfolio Construction</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-mono text-primary">68%</span>
                </div>
                <Progress value={68} className="h-2 bg-secondary" />
              </div>
              
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-background/50 border border-border/50 flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center text-primary">
                    <Target className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Asset Allocation</p>
                    <p className="text-xs text-muted-foreground">Next Topic</p>
                  </div>
                </div>
                
                <div className="p-3 rounded-lg bg-background/50 border border-border/50 flex items-center gap-3 opacity-60">
                  <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center text-muted-foreground">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Rebalancing</p>
                    <p className="text-xs text-muted-foreground">Locked</p>
                  </div>
                </div>
              </div>

              <Button className="w-full bg-white/5 hover:bg-white/10 text-white border border-white/10">
                Resume Module
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Recommended Paths */}
        <div>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Recommended For You
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Derivatives 101", level: "Intermediate", duration: "2h 30m", color: "from-blue-500/20 to-purple-500/20" },
              { title: "Forex Trading Strategies", level: "Advanced", duration: "4h 15m", color: "from-emerald-500/20 to-teal-500/20" },
              { title: "Crypto Risk Management", level: "Beginner", duration: "1h 45m", color: "from-orange-500/20 to-red-500/20" }
            ].map((course, i) => (
              <div key={i} className={`group relative p-6 rounded-xl border border-border/50 bg-gradient-to-br ${course.color} hover:border-primary/50 transition-all cursor-pointer overflow-hidden`}>
                <div className="absolute inset-0 bg-background/90 z-0 transition-opacity group-hover:opacity-80" />
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-xs font-mono px-2 py-1 rounded bg-white/10 text-white border border-white/10">
                      {course.level}
                    </span>
                    <span className="text-xs text-muted-foreground">{course.duration}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{course.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">Master the fundamentals and apply them in live simulations.</p>
                  <div className="flex items-center text-primary text-sm font-medium group-hover:translate-x-1 transition-transform">
                    Start Learning <ArrowRight className="ml-1 h-3 w-3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}