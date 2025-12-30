import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Bookmark, Clock, Newspaper, TrendingUp, Zap } from "lucide-react";
import { AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from "wouter";
import generatedImage from '@assets/generated_images/abstract_digital_finance_visualization_with_glowing_data_streams.png';
import React, { useState } from 'react';

interface Story {
  id: number;
  headline: string;
  excerpt: string;
  category?: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral' | 'positive' | 'negative';
  score?: number;
  image?: string;
  source: string;
  time: string;
  featured: boolean;
  content: string;
  metrics?: Record<string, any>;
  aiAnalysis?: string;
}

const MOCK_CHART_DATA = [
  { name: '09:00', value: 4000 },
  { name: '10:00', value: 3000 },
  { name: '11:00', value: 2000 },
  { name: '12:00', value: 2780 },
  { name: '13:00', value: 1890 },
  { name: '14:00', value: 2390 },
  { name: '15:00', value: 3490 },
];

const stories: Story[] = [
  {
    id: 1,
    headline: "S&P 500 Consolidates Amid Fed Signals",
    excerpt: "Market breadth improves as institutional accumulation continues. VIX holds steady at 18.5 as investors digest rate pause expectations.",
    category: 'stocks',
    sentiment: 'neutral',
    score: 52,
    image: '📈',
    source: 'Market Report',
    time: '2 hours ago',
    featured: true,
    content: "The S&P 500 is showing consolidation patterns with improving breadth suggesting institutional players are accumulating positions. The CBOE Volatility Index remains stable at 18.5, indicating measured investor sentiment. Watch the 4800 resistance level closely.",
    metrics: { vix: 18.5, breadth: '65%', change: '+1.2%' },
    aiAnalysis: 'Market showing consolidation pattern. Breadth improving suggests institutional accumulation. Watch 4800 resistance level.'
  },
  {
    id: 2,
    headline: "Bitcoin ETF Attracts Record Inflows",
    excerpt: "Strong accumulation phase detected on-chain. Whale movements to cold storage signal long-term conviction.",
    category: 'crypto',
    sentiment: 'bullish',
    score: 68,
    image: '₿',
    source: 'Crypto Desk',
    time: '4 hours ago',
    featured: false,
    content: "Bitcoin ETF products are seeing unprecedented inflows as institutional adoption accelerates. On-chain analysis reveals whale entities moving funds to cold storage wallets, a typical indicator of long-term holding conviction.",
    metrics: { fundingRate: '+0.08%', mvrv: 1.15, outflow: 'Cold Storage' },
    aiAnalysis: 'Strong accumulation phase. Funding rates elevated but sustainable. Whale movement to cold wallets suggests long-term holders.'
  },
  {
    id: 3,
    headline: "USD Strengthens as Safe-Haven Demand Rises",
    excerpt: "EUR/USD slips 0.8% as dollar dominance persists. ECB differentials continue favoring US currency.",
    category: 'forex',
    sentiment: 'bearish',
    score: 38,
    image: '💱',
    source: 'FX Wire',
    time: '5 hours ago',
    featured: false,
    content: "The US dollar maintains its strength amid persistent safe-haven demand, pressuring major currency pairs. The EUR/USD has declined 0.8% as interest rate differentials continue to favor the greenback.",
    metrics: { pair: 'EUR/USD', change: '-0.8%', positioning: 'Short-biased' },
    aiAnalysis: 'Dollar strength dominates. ECB differentials favoring USD. Positioning suggests potential short squeeze above 1.12.'
  },
  {
    id: 4,
    headline: "Gold Finds Support in Central Bank Demand",
    excerpt: "Real rates remain elevated but persistent buying from central banks provides downside protection.",
    category: 'commodities',
    sentiment: 'neutral',
    score: 48,
    image: '🏆',
    source: 'Commodity Weekly',
    time: '6 hours ago',
    featured: false,
    content: "Gold prices are stabilizing despite elevated real rates as central banks around the world continue their accumulation strategies. The yellow metal's resilience is being underpinned by increasing institutional demand.",
    metrics: { realRates: '2.1%', cbBuying: 'Active', change: '+0.3%' },
    aiAnalysis: 'Real rates elevated, limiting upside. Central bank demand providing support. Watch DXY for directional cues.'
  },
  {
    id: 5,
    headline: "Tech Earnings Disappoint, Market Eyes Rotation",
    excerpt: "Mixed earnings reports trigger sector rotation. Investors shift focus to value and financials.",
    category: 'stocks',
    sentiment: 'negative',
    score: 35,
    image: '💻',
    source: 'Market Report',
    time: '8 hours ago',
    featured: false,
    content: "Technology sector faces headwinds as several mega-cap companies report earnings that fall short of expectations. Market participants are redirecting capital towards value stocks and financial services.",
    metrics: { sector: 'Tech', change: '-2.3%', rotation: 'To Value' },
    aiAnalysis: 'Tech weakness temporary. Valuations becoming attractive for long-term buyers. Support at previous resistance levels.'
  },
  {
    id: 6,
    headline: "Ethereum Upgrade Boosts Network Activity",
    excerpt: "On-chain metrics accelerate as developers activate latest protocol improvements.",
    category: 'crypto',
    sentiment: 'positive',
    score: 62,
    image: 'Ξ',
    source: 'Crypto Desk',
    time: '10 hours ago',
    featured: false,
    content: "Ethereum's latest network upgrade has successfully activated, leading to measurable improvements in transaction throughput and cost efficiency.",
    metrics: { tps: '+12%', gasAvg: '-18%', activity: 'Rising' },
    aiAnalysis: 'Network improvements positive for long-term utility. Funding rates suggest healthy demand.'
  }
];

export default function Dashboard() {
  const [selectedArticle, setSelectedArticle] = useState<Story | null>(null);
  const [filter, setFilter] = useState<'all' | 'stocks' | 'crypto' | 'forex' | 'commodities'>('all');

  const filteredStories = filter === 'all' ? stories : stories.filter(s => s.category === filter);

  const NewsArticle = ({ story }: { story: Story }) => {
    const borderColorClass =
      story.sentiment === 'bullish'
        ? 'border-green-500'
        : story.sentiment === 'bearish'
        ? 'border-red-500'
        : story.sentiment === 'positive'
        ? 'border-blue-500'
        : story.sentiment === 'negative'
        ? 'border-orange-500'
        : 'border-gray-400';

    return (
      <div
        className={`border-l-4 pl-4 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${borderColorClass}`}
        onClick={() => setSelectedArticle(story)}
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1">
            <h3 className="text-base font-bold text-gray-900 leading-tight mb-2">{story.headline}</h3>
            <p className="text-gray-700 text-sm mb-3">{story.excerpt}</p>
          </div>
          <div className="text-3xl ml-4 shrink-0">{story.image}</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>{story.source}</span>
            <span>{story.time}</span>
            <span
              className={`font-semibold ${
                story.sentiment === 'bullish'
                  ? 'text-green-600'
                  : story.sentiment === 'bearish'
                  ? 'text-red-600'
                  : 'text-gray-600'
              }`}
            >
              Score: {story.score}
            </span>
          </div>
          <Bookmark size={16} className="text-gray-400 hover:text-blue-600" />
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

        {/* Newspaper Header */}
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

        {/* Main Newspaper Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-min">
          {/* Hero Section */}
          <div className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-xl border border-border/50 bg-card hover:border-primary/50 transition-all cursor-pointer min-h-[400px]">
            <div className="absolute inset-0 z-0">
              <img src={generatedImage} alt="Background" className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-linear-to-t from-background via-background/60 to-transparent" />
            </div>
            <div className="relative z-10 p-8 h-full flex flex-col justify-end">
              <div className="bg-primary/90 text-black text-xs font-bold px-2 py-1 inline-block w-fit mb-4 uppercase tracking-wider">Breaking Analysis</div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight font-serif">
                Inflation Surprise: Why Tech Stocks Are Bleeding Red Today
              </h2>
              <p className="text-lg text-slate-300 mb-6 line-clamp-3">
                CPI data just dropped at 0.4%, signalling the Fed isn't done yet. Learn how duration risk is crushing your growth portfolio and what to do about it right now.
              </p>
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-400 font-mono flex items-center gap-1">
                  <Clock className="h-3 w-3" /> 12 min read
                </span>
              </div>
            </div>
          </div>

          {/* Top Story */}
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

          {/* Market Pulse / Mini Stats */}
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

          {/* Learning Progress */}
          <div className="md:col-span-1 md:row-span-1 bg-primary/10 border border-primary/20 rounded-xl p-6 flex flex-col justify-center">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-primary">Daily Goal</span>
              <span className="font-mono text-white">68%</span>
            </div>
            <Progress value={68} className="h-2 bg-primary/20" />
            <p className="text-xs text-primary/80 mt-3">
              You're on a 12-day streak! Keep it up to unlock the "Hedge Fund Manager" badge.
            </p>
            <div>
              <Link href="/challenge">
                  <Button size="lg" className="bg-white text-black hover:bg-white/90 font-bold px-6 py-3 mt-6 w-full">
                    <Zap className="mr-2 h-4 w-4" /> Take The Live Challenge
                  </Button>
              </Link>
            </div>

          </div>

          {/* Sector Chart */}
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
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }} itemStyle={{ color: '#fff' }} />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" fillOpacity={1} fill="url(#colorValue2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Editors Picks */}
          <div className="md:col-span-2 border-t-4 border-white/10 bg-card rounded-xl p-6">
            <h3 className="font-serif italic text-2xl text-white mb-6">Editors' Picks</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3 group cursor-pointer">
                <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                  <div className="absolute inset-0 bg-linear-to-tr from-purple-900/40 to-blue-900/40" />
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">CRYPTO</div>
                </div>
                <h4 className="font-bold text-white group-hover:text-primary transition-colors">Is Bitcoin the new Digital Gold?</h4>
                <p className="text-sm text-muted-foreground line-clamp-2">Exploring the correlation between BTC and commodities in the 2024 cycle.</p>
              </div>
              <div className="space-y-3 group cursor-pointer">
                <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                  <div className="absolute inset-0 bg-linear-to-tr from-emerald-900/40 to-teal-900/40" />
                  <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">FOREX</div>
                </div>
                <h4 className="font-bold text-white group-hover:text-primary transition-colors">The Carry Trade Unwind</h4>
                <p className="text-sm text-muted-foreground line-clamp-2">What happens when the Yen strengthens? A deep dive into global liquidity.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Selected Article Modal */}
        {selectedArticle && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-lg w-full p-6 relative">
              <button
                className="absolute top-3 right-3 text-gray-500 hover:text-gray-900 font-bold"
                onClick={() => setSelectedArticle(null)}
              >
                X
              </button>
              <h2 className="text-xl font-bold mb-2">{selectedArticle.headline}</h2>
              <p className="text-gray-700 mb-4">{selectedArticle.content}</p>
              <p className="text-xs text-gray-500 mb-2">
                Source: {selectedArticle.source} | {selectedArticle.time}
              </p>
              <span
                className={`font-semibold ${
                  selectedArticle.sentiment === 'bullish'
                    ? 'text-green-600'
                    : selectedArticle.sentiment === 'bearish'
                    ? 'text-red-600'
                    : 'text-gray-600'
                }`}
              >
                Score: {selectedArticle.score}
              </span>
            </div>
          </div>
        )}

        {/* Latest Headlines Filters */}
        <div>
          <h2 className="text-2xl font-black text-gray-900 mb-4 uppercase tracking-wider">Latest Headlines</h2>
          <div className="flex gap-4 mb-6">
            {['all', 'stocks', 'crypto', 'forex', 'commodities'].map(cat => (
              <Button
                key={cat}
                variant={filter === cat ? 'default' : 'outline'}
                onClick={() => setFilter(cat as any)}
              >
                {cat.toUpperCase()}
              </Button>
            ))}
          </div>

          <div className="space-y-6">
            {filteredStories.map(story => (
              <NewsArticle key={story.id} story={story} />
            ))}
          </div>
        </div>

      </div>
    </Layout>
  );
}
