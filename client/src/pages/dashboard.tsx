import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Bookmark, Clock, Newspaper, TrendingUp, Zap} from "lucide-react";
import { AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from "wouter";
import generatedImage from '@assets/generated_images/abstract_digital_finance_visualization_with_glowing_data_streams.png';
import React, { useState } from 'react';
import { MarketPulse } from "@/components/market-pulse";
import { OpenPosition, OpenPositionData } from "@/components/open-position";
import { ArticleModal } from "@/components/articleModal";
import { SectorChart } from "@/components/sector-chart";

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

const daily_goal = 72;
const day_streak = 8;
const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const edition = {vol: 24, issue: 102, cities: ["New York", "london", "tokyo", "Chicago"]};

const MOCK_CHART_DATA = [
  { name: '09:00', value: 4000 },
  { name: '10:00', value: 3000 },
  { name: '11:00', value: 2000 },
  { name: '12:00', value: 2780 },
  { name: '13:00', value: 1890 },
  { name: '14:00', value: 2390 },
  { name: '15:00', value: 3490 },
];

const exchangeHours: Record<string, { open: number; close: number }> = {
  "New York": { open: 9, close: 16 }, // NYSE 9am - 4pm EST
  London: { open: 8, close: 16 },     // LSE 8am - 4pm GMT
  Tokyo: { open: 9, close: 15 },      // TSE 9am - 3pm JST
};

const marketStats = [
  // Forex
  { category: "forex", label: "USD/JPY", value: "148.20", change: "-0.1%", up: false },
  { category: "forex", label: "EUR/USD", value: "1.08", change: "+0.2%", up: true },
  { category: "forex", label: "GBP/USD", value: "1.25", change: "+0.1%", up: true },
  { category: "forex", label: "AUD/USD", value: "0.65", change: "-0.05%", up: false },
  { category: "forex", label: "CAD/USD", value: "0.73", change: "+0.03%", up: true },

  // Stocks
  { category: "stocks", label: "S&P 500", value: "4,200", change: "+0.5%", up: true },
  { category: "stocks", label: "Dow Jones", value: "34,500", change: "-0.3%", up: false },
  { category: "stocks", label: "Nasdaq", value: "13,200", change: "+0.8%", up: true },

  // Crypto
  { category: "crypto", label: "Bitcoin", value: "29,800", change: "+1.2%", up: true },
  { category: "crypto", label: "Ethereum", value: "1,850", change: "+0.8%", up: true },
  { category: "crypto", label: "Solana", value: "22.5", change: "-0.5%", up: false },
];

const positions: OpenPositionData[] = [
  {
    title: "USD/JPY Short",
    price: "148.20",
    change: "+0.45%",
    changeUp: true,
    thesis: "Bank of Japan intervention rumors are heating up. Risk/Reward favors downside.",
    validation: "Wait for break below 147.80 to confirm trend reversal.",
    position: "open",
  },
  {
    title: "EUR/USD Long",
    price: "1.1050",
    change: "-0.15%",
    changeUp: false,
    thesis: "ECB rate decisions favor USD strength.",
    validation: "Monitor 1.10 support.",
    position: "monitoring",
  },
  {
    title: "BTC Long",
    price: "$36,500",
    change: "+2.3%",
    changeUp: true,
    thesis: "Bullish momentum on-chain, whales accumulating.",
    validation: "Watch $35,000 as support.",
    position: "open",
  },
];

export const MOCK_SECTOR_DATA = {
  stocks: [
    { name: "09:00", high: 4200, low: 4150, avg: 4175 },
    { name: "10:00", high: 4250, low: 4205, avg: 4225 },
    { name: "11:00", high: 4300, low: 4250, avg: 4270 },
    { name: "12:00", high: 4350, low: 4280, avg: 4315 },
    { name: "13:00", high: 4400, low: 4320, avg: 4360 },   // 🚀 strong uptrend
  ],

  forex: [
    { name: "09:00", high: 1.10, low: 1.09, avg: 1.095 },
    { name: "10:00", high: 1.09, low: 1.08, avg: 1.085 },
    { name: "11:00", high: 1.08, low: 1.07, avg: 1.075 },
    { name: "12:00", high: 1.07, low: 1.06, avg: 1.065 },
    { name: "13:00", high: 1.06, low: 1.05, avg: 1.055 }, // 📉 clear downtrend
  ],

  oil: [
    { name: "09:00", high: 78, low: 76, avg: 77 },
    { name: "10:00", high: 80, low: 77, avg: 78.5 },
    { name: "11:00", high: 82, low: 79, avg: 80.5 },
    { name: "12:00", high: 81, low: 78, avg: 79.5 },
    { name: "13:00", high: 83, low: 79, avg: 81 },        // mild up, one dip
  ],

  metals: [
    { name: "09:00", high: 2000, low: 1970, avg: 1985 },
    { name: "10:00", high: 1985, low: 1950, avg: 1965 },
    { name: "11:00", high: 1960, low: 1930, avg: 1945 },
    { name: "12:00", high: 1975, low: 1940, avg: 1958 },
    { name: "13:00", high: 1950, low: 1915, avg: 1932 }, // drop → small bounce → sharper drop
  ],
};

export const editors_pick = [
  {
    id: 1,
    headline: "Tech Stocks Rally as AI Spending Surges",
    content:
      "Markets climbed as investors rotated back into high-growth tech names, driven by stronger-than-expected demand in artificial intelligence infrastructure.",
    source: "Bloomberg",
    time: "2h ago",
    sentiment: "bullish",
    score: 82,
    image: "https://images.unsplash.com/photo-1581091870624-8b4d1a64a5e8?auto=format&fit=crop&w=800&q=80", // placeholder AI/tech image
  },
  {
    id: 2,
    headline: "Oil Slips as Global Demand Outlook Softens",
    content:
      "Crude prices moved lower after new economic data signaled slower industrial activity — raising questions about fuel consumption heading into next quarter.",
    source: "Reuters",
    time: "4h ago",
    sentiment: "bearish",
    score: 61,
    image: "https://images.unsplash.com/photo-1581091012184-f8f8f8147d9b?auto=format&fit=crop&w=800&q=80", // placeholder oil/energy image
  },
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

function isMarketOpen(city: string): boolean {
  const hours = exchangeHours[city];
  if (!hours) return false;

  // Map city to timezone
  const timezoneMap: Record<string, string> = {
    "New York": "America/New_York",
    London: "Europe/London",
    Tokyo: "Asia/Tokyo",
  };

  const tz = timezoneMap[city];
  const now = new Date();
  const localHour = Number(
    now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: tz })
  );

  return localHour >= hours.open && localHour < hours.close;
}

export default function Dashboard() {
  const [selectedArticle, setSelectedArticle] = useState<Story | null>(null);
  const [filter, setFilter] = useState<'all' | 'stocks' | 'crypto' | 'forex' | 'commodities'>('all');
  const anyMarketOpen = edition.cities.some((city) => isMarketOpen(city));
  const filteredStories = filter === 'all' ? stories : stories.filter(s => s.category === filter);
  const editorsPick = editors_pick;

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
              Vol. {edition.vol} • Issue {edition.issue} • {edition.cities.join(" / ")}
            </p>
          </div>
          <div className="text-right mt-4 md:mt-0">
            <div className={`text-3xl font-bold font-mono ${anyMarketOpen ? "text-primary" : "text-red-500"}`}>
              {anyMarketOpen ? "MARKET OPEN" : "MARKET CLOSED"}
            </div>
            <div className="text-sm text-muted-foreground">{currentTime}</div>
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

          {/* Active Position */}
          <OpenPosition positions={positions} />


          {/* Market Pulse / Mini Stats */}
          <MarketPulse stats={marketStats} />

          {/* Learning Progress */}
          <div className="md:col-span-1 md:row-span-1 bg-primary/10 border border-primary/20 rounded-xl p-6 flex flex-col justify-center">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-primary">Daily Goal</span>
              <span className="font-mono text-white">{daily_goal}%</span>
            </div>
            <Progress value={daily_goal} className="h-2 bg-primary/20" />
            <p className="text-xs text-primary/80 mt-3">
              You're on a {day_streak}-day streak! Keep it up to unlock the "Hedge Fund Manager" badge.
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
          <SectorChart data={MOCK_SECTOR_DATA} />

          {/* Editors Picks */}
          <div className="md:col-span-2 border-t-4 border-white/10 bg-card rounded-xl p-6">
            <h3 className="font-serif italic text-2xl text-white mb-6">Editors' Picks</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {editorsPick.map((story, i) => (
                <div key={i} className="space-y-3 group cursor-pointer">
                  <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                    <img src={story.image} alt={story.headline} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-linear-to-tr from-primary/30 to-secondary/30" />
                    <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">
                      {(story as any)?.source?.toUpperCase?.() || "FEATURED"}
                    </div>
                  </div>

                  <h4 className="font-bold text-white group-hover:text-primary transition-colors">
                    {story.headline}
                  </h4>

                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {story.content}
                  </p>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Selected Article Modal */}
        <ArticleModal story={selectedArticle} onClose={() => setSelectedArticle(null)} />

        {/* Headlines Filters */}
        <div>
          <h2 className="text-2xl font-black text-gray-900 mb-4 uppercase tracking-wider">Headlines</h2>
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
