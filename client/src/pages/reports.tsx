import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { TrendingUp, Award, Target, FileText } from "lucide-react";

const PERFORMANCE_DATA = [
  { month: 'Jan', portfolio: 4000, forex: 2400, crypto: 2400 },
  { month: 'Feb', portfolio: 3000, forex: 1398, crypto: 2210 },
  { month: 'Mar', portfolio: 2000, forex: 9800, crypto: 2290 },
  { month: 'Apr', portfolio: 2780, forex: 3908, crypto: 2000 },
  { month: 'May', portfolio: 1890, forex: 4800, crypto: 2181 },
  { month: 'Jun', portfolio: 2390, forex: 3800, crypto: 2500 },
  { month: 'Jul', portfolio: 3490, forex: 4300, crypto: 2100 },
];

const SKILL_DATA = [
  { subject: 'Risk Mgmt', A: 120, fullMark: 150 },
  { subject: 'Timing', A: 98, fullMark: 150 },
  { subject: 'Analysis', A: 86, fullMark: 150 },
  { subject: 'Execution', A: 99, fullMark: 150 },
  { subject: 'Psychology', A: 85, fullMark: 150 },
  { subject: 'Strategy', A: 65, fullMark: 150 },
];

export default function Reports() {
  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in duration-500">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-border/50 pb-6">
          <div>
             <h1 className="text-3xl font-bold text-white mb-2 font-serif">Performance Reports</h1>
             <p className="text-muted-foreground">Track your P&L, grades, and skill progression across all domains.</p>
          </div>
          <div className="flex gap-4 mt-4 md:mt-0">
             <div className="text-right">
               <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Net Worth (Sim)</p>
               <p className="text-2xl font-mono font-bold text-white">$248,392.00</p>
             </div>
             <div className="text-right">
               <p className="text-xs text-muted-foreground uppercase tracking-wider">Global Grade</p>
               <p className="text-2xl font-mono font-bold text-emerald-500">B+</p>
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Equity Curve */}
          <Card className="lg:col-span-2 border-border/50 bg-card">
            <CardHeader>
              <CardTitle>Equity Growth by Domain</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={PERFORMANCE_DATA}>
                    <defs>
                      <linearGradient id="colorPort" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorForex" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="month" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Area type="monotone" dataKey="portfolio" stackId="1" stroke="#10b981" fill="url(#colorPort)" strokeWidth={2} />
                    <Area type="monotone" dataKey="forex" stackId="1" stroke="#3b82f6" fill="url(#colorForex)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Skill Radar */}
          <Card className="border-border/50 bg-card">
            <CardHeader>
              <CardTitle>Trader DNA</CardTitle>
              <CardDescription>Your strengths and weaknesses analysis</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={SKILL_DATA}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 150]} tick={false} axisLine={false} />
                    <Radar name="Mike" dataKey="A" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Domain Breakdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {['Portfolio', 'Forex', 'Crypto', 'Loans'].map((d, i) => (
            <Card key={i} className="border-border/50 bg-card/50 hover:bg-card transition-colors">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{d}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white mb-2">$54,230</div>
                <div className="flex justify-between items-center text-xs mb-4">
                  <span className="text-emerald-500 font-mono">+12.4% YTD</span>
                  <Badge variant="outline" className="border-primary/20 text-primary">Grade A</Badge>
                </div>
                <Progress value={75} className="h-1 bg-secondary" />
                <p className="text-[10px] text-muted-foreground mt-2 text-right">Next Checkpoint: $60k</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}