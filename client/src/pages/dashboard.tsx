import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, Zap, Target, BookOpen, AlertCircle, TrendingUp, TrendingDown, Clock, Newspaper, ChevronRight } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from "wouter";
import generatedImage from '@assets/generated_images/abstract_digital_finance_visualization_with_glowing_data_streams.png';

const MOCK_CHART_DATA = [
  { name: '09:00', value: 4000 },
  { name: '10:00', value: 3000 },
  { name: '11:00', value: 2000 },
  { name: '12:00', value: 2780 },
  { name: '13:00', value: 1890 },
  { name: '14:00', value: 2390 },
  { name: '15:00', value: 3490 },
];

export default function Dashboard() {
  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Newspaper Header / Date Line */}
        <div className="flex flex-col md:flex-row justify-between items-end border-b-2 border-primary/20 pb-4 mb-8">
          <div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-white font-serif italic">THE DAILY ALPHA</h1>
            <p className="text-muted-foreground mt-2 font-mono uppercase tracking-widest text-xs">
              Vol. 24 • Issue 102 • London / New York / Tokyo
            </p>
          </div>
          <div className="text-right mt-4 md:mt-0">
            <div className="text-3xl font-bold text-primary font-mono">MARKET OPEN</div>
            <div className="text-sm text-muted-foreground">09:42:12 EST</div>
          </div>
        </div>

        {/* Bento Grid / Newspaper Layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 auto-rows-min">
          
          {/* Main Headline (Hero) - Spans 2 cols, 2 rows */}
          <div className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-xl border border-border/50 bg-card hover:border-primary/50 transition-all cursor-pointer">
            <div className="absolute inset-0 z-0">
              <img 
                src={generatedImage} 
                alt="Background" 
                className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
            </div>
            <div className="relative z-10 p-8 h-full flex flex-col justify-end">
              <div className="bg-primary/90 text-black text-xs font-bold px-2 py-1 inline-block w-fit mb-4 uppercase tracking-wider">
                Breaking Analysis
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight font-serif">
                Inflation Surprise: Why Tech Stocks Are Bleeding Red Today
              </h2>
              <p className="text-lg text-slate-300 mb-6 line-clamp-3">
                CPI data just dropped at 0.4%, signalling the Fed isn't done yet. Learn how duration risk is crushing your growth portfolio and what to do about it right now.
              </p>
              <div className="flex items-center gap-4">
                <Link href="/challenge">
                  <Button size="lg" className="bg-white text-black hover:bg-white/90 font-bold">
                    <Zap className="mr-2 h-4 w-4" /> Take The Live Challenge
                  </Button>
                </Link>
                <span className="text-sm text-slate-400 font-mono flex items-center gap-1">
                  <Clock className="h-3 w-3" /> 12 min read
                </span>
              </div>
            </div>
          </div>

          {/* Top Story 2 - Pending Challenge */}
          <div className="md:col-span-1 md:row-span-2 bg-secondary/20 border border-border/50 rounded-xl p-6 flex flex-col">
            <div className="flex items-center gap-2 text-primary mb-4">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="font-mono text-xs uppercase tracking-wider">Active Position</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">USD/JPY Short</h3>
            <div className="text-4xl font-mono font-bold text-white mb-1">148.20</div>
            <div className="flex items-center gap-2 text-emerald-500 mb-6 font-mono text-sm">
              <TrendingUp className="h-4 w-4" /> +0.45% (Unrealized)
            </div>
            
            <div className="flex-1 space-y-4">
              <div className="p-3 bg-background/50 rounded border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Thesis</p>
                <p className="text-sm text-slate-300">Bank of Japan intervention rumors are heating up. Risk/Reward favors downside.</p>
              </div>
              <div className="p-3 bg-background/50 rounded border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Validation</p>
                <p className="text-sm text-slate-300">Wait for break below 147.80 to confirm trend reversal.</p>
              </div>
            </div>
            
            <Button variant="outline" className="w-full mt-6 border-primary/20 hover:bg-primary/10 hover:text-primary">
              Manage Position
            </Button>
          </div>

          {/* Market Ticker / Quick Stats */}
          <div className="md:col-span-1 md:row-span-1 bg-card border border-border/50 rounded-xl p-6">
            <h4 className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-4 border-b border-border/50 pb-2">Market Pulse</h4>
            <div className="space-y-4">
              {[
                { label: "VIX", value: "14.20", change: "-2.1%", up: false },
                { label: "10Y Yield", value: "4.12%", change: "+1.2%", up: true },
                { label: "Gold", value: "2,340", change: "+0.4%", up: true },
              ].map((stat, i) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="font-medium text-slate-300">{stat.label}</span>
                  <div className="text-right">
                    <div className="text-white font-mono font-bold">{stat.value}</div>
                    <div className={`text-xs ${stat.up ? 'text-emerald-500' : 'text-rose-500'}`}>{stat.change}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

           {/* Learning Progress - Mini */}
           <div className="md:col-span-1 md:row-span-1 bg-primary/10 border border-primary/20 rounded-xl p-6 flex flex-col justify-center">
             <div className="flex justify-between items-center mb-2">
               <span className="font-bold text-primary">Daily Goal</span>
               <span className="font-mono text-white">68%</span>
             </div>
             <Progress value={68} className="h-2 bg-primary/20" />
             <p className="text-xs text-primary/80 mt-3">
               You're on a 12-day streak! Keep it up to unlock the "Hedge Fund Manager" badge.
             </p>
           </div>

          {/* Chart Section - Spans 2 cols */}
          <div className="md:col-span-2 bg-card/50 border border-border/50 rounded-xl p-6">
            <div className="flex justify-between items-center mb-6">
               <h3 className="font-bold text-white flex items-center gap-2">
                 <Newspaper className="h-4 w-4 text-muted-foreground" />
                 Sector Performance
               </h3>
               <select className="bg-background border border-border rounded text-xs px-2 py-1 text-muted-foreground">
                 <option>Intraday</option>
                 <option>1 Week</option>
               </select>
            </div>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCK_CHART_DATA}>
                  <defs>
                    <linearGradient id="colorValue2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" fillOpacity={1} fill="url(#colorValue2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* "Opinion" / Editorial Column */}
          <div className="md:col-span-2 border-t-4 border-white/10 bg-card rounded-xl p-6">
            <h3 className="font-serif italic text-2xl text-white mb-6">Editors' Picks</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3 group cursor-pointer">
                <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                   <div className="absolute inset-0 bg-gradient-to-tr from-purple-900/40 to-blue-900/40" />
                   <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">CRYPTO</div>
                </div>
                <h4 className="font-bold text-white group-hover:text-primary transition-colors">Is Bitcoin the new Digital Gold?</h4>
                <p className="text-sm text-muted-foreground line-clamp-2">Exploring the correlation between BTC and commodities in the 2024 cycle.</p>
              </div>
              <div className="space-y-3 group cursor-pointer">
                 <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                   <div className="absolute inset-0 bg-gradient-to-tr from-emerald-900/40 to-teal-900/40" />
                   <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">FOREX</div>
                 </div>
                <h4 className="font-bold text-white group-hover:text-primary transition-colors">The Carry Trade Unwind</h4>
                <p className="text-sm text-muted-foreground line-clamp-2">What happens when the Yen strengthens? A deep dive into global liquidity.</p>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </Layout>
  );
}