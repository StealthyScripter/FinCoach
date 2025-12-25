import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  User,
  Mail,
  Shield,
  Settings,
  Award,
  TrendingUp,
  Clock,
  Zap,
  Edit,
  Save,
  X,
  Calendar,
  Trophy,
  Target,
  BookOpen,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { useState } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const ACTIVITY_DATA = [
  { week: 'W1', lessons: 4, challenges: 2, hours: 8 },
  { week: 'W2', lessons: 6, challenges: 3, hours: 12 },
  { week: 'W3', lessons: 5, challenges: 4, hours: 11 },
  { week: 'W4', lessons: 7, challenges: 5, hours: 14 },
  { week: 'W5', lessons: 8, challenges: 6, hours: 16 },
];

const ACHIEVEMENTS = [
  { name: 'First Steps', desc: 'Complete your first lesson', unlocked: true, date: 'Jan 15, 2025' },
  { name: 'Week Warrior', desc: '7-day learning streak', unlocked: true, date: 'Jan 22, 2025' },
  { name: 'Challenge Master', desc: 'Win 5 live challenges', unlocked: true, date: 'Feb 03, 2025' },
  { name: 'Portfolio Pro', desc: 'Complete portfolio domain', unlocked: false, date: null },
  { name: 'Diamond Trader', desc: 'Achieve 30-day streak', unlocked: false, date: null },
  { name: 'Hedge Fund Manager', desc: '68% overall grade', unlocked: false, date: null },
];

export default function Profile() {
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState({
    name: 'Alex Chen',
    email: 'alex.chen@example.com',
    location: 'San Francisco, CA',
    bio: 'Aspiring trader passionate about quantitative finance and risk management.',
  });

  const [formData, setFormData] = useState(profile);

  const handleSave = () => {
    setProfile(formData);
    setIsEditing(false);
  };

  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in duration-500">

        {/* Profile Header / Hero Section */}
        <div className="relative rounded-2xl border border-border/50 bg-gradient-to-r from-primary/10 via-card/50 to-card/30 overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -z-0" />

          <div className="relative z-10 p-8 md:p-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
              <div className="flex gap-6 items-end">
                <div className="h-24 w-24 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border-2 border-primary/50 flex items-center justify-center">
                  <User className="h-12 w-12 text-primary" />
                </div>

                <div>
                  {!isEditing ? (
                    <>
                      <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 font-sans">{profile.name}</h1>
                      <div className="flex flex-wrap gap-3">
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Mail className="h-4 w-4" /> {profile.email}
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Calendar className="h-4 w-4" /> Joined Jan 2025
                        </div>
                      </div>
                      <p className="text-slate-300 mt-3 max-w-2xl">{profile.bio}</p>
                    </>
                  ) : (
                    <div className="space-y-3 w-full max-w-md">
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        placeholder="Full name"
                        className="w-full bg-background border border-border rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        placeholder="Email"
                        className="w-full bg-background border border-border rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <textarea
                        value={formData.bio}
                        onChange={(e) => setFormData({...formData, bio: e.target.value})}
                        placeholder="Bio"
                        className="w-full bg-background border border-border rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none h-20"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {!isEditing ? (
                  <Button
                    onClick={() => setIsEditing(true)}
                    className="bg-primary text-black hover:bg-white gap-2 font-sans font-semibold"
                  >
                    <Edit className="h-4 w-4" /> Edit Profile
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={handleSave}
                      className="bg-primary text-black hover:bg-white gap-2 font-sans font-semibold"
                    >
                      <Save className="h-4 w-4" /> Save
                    </Button>
                    <Button
                      onClick={() => {
                        setIsEditing(false);
                        setFormData(profile);
                      }}
                      variant="outline"
                      className="gap-2 font-sans font-semibold"
                    >
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">Current Streak</p>
                  <p className="text-3xl font-bold text-white font-mono">12</p>
                  <p className="text-xs text-muted-foreground mt-2">Days in a row</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">Total Hours</p>
                  <p className="text-3xl font-bold text-white font-mono">73</p>
                  <p className="text-xs text-muted-foreground mt-2">Time invested</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">Overall Grade</p>
                  <p className="text-3xl font-bold text-white font-mono">B+</p>
                  <p className="text-xs text-emerald-400 mt-2">+2.4% this week</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">Badges Earned</p>
                  <p className="text-3xl font-bold text-white font-mono">3</p>
                  <p className="text-xs text-muted-foreground mt-2">of 6 unlocked</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Trophy className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="activity" className="space-y-6">
          <div className="border-b border-border/50 overflow-x-auto">
            <TabsList className="bg-transparent p-0 h-auto gap-6 justify-start w-full min-w-max">
              <TabsTrigger value="activity" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Activity & Stats
              </TabsTrigger>
              <TabsTrigger value="achievements" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Achievements
              </TabsTrigger>
              <TabsTrigger value="security" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Security
              </TabsTrigger>
              <TabsTrigger value="settings" className="bg-transparent border-b-2 border-transparent text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary hover:text-white rounded-none px-0 py-2 font-serif text-lg">
                Settings
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ACTIVITY TAB */}
          <TabsContent value="activity" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="font-sans">Weekly Activity</CardTitle>
                  <CardDescription>Your learning engagement over the past 5 weeks</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ACTIVITY_DATA}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="week" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Bar dataKey="lessons" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="challenges" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-4 mt-6 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded bg-emerald-500" />
                      <span className="text-muted-foreground">Lessons</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded bg-blue-500" />
                      <span className="text-muted-foreground">Challenges</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card/50 space-y-6">
                <CardHeader>
                  <CardTitle className="text-lg">Domain Progress</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { domain: 'Portfolio', progress: 68, grade: 'A' },
                    { domain: 'Stocks', progress: 30, grade: 'C+' },
                    { domain: 'Forex', progress: 15, grade: 'C' },
                    { domain: 'Crypto', progress: 0, grade: '-' },
                  ].map((item, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-white">{item.domain}</span>
                        <span className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded text-primary">{item.grade}</span>
                      </div>
                      <Progress value={item.progress} className="h-1.5 bg-secondary" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ACHIEVEMENTS TAB */}
          <TabsContent value="achievements" className="space-y-6">
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">You've unlocked {ACHIEVEMENTS.filter(a => a.unlocked).length} of {ACHIEVEMENTS.length} badges. Keep grinding!</p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {ACHIEVEMENTS.map((achievement, i) => (
                  <Card
                    key={i}
                    className={achievement.unlocked
                      ? "border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                      : "border-border/30 bg-card/30 opacity-50"}
                  >
                    <CardContent className="pt-6 text-center">
                      <div className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4 ${achievement.unlocked ? 'bg-primary/20' : 'bg-secondary/20'}`}>
                        {achievement.unlocked ? (
                          <Trophy className={`h-8 w-8 ${achievement.unlocked ? 'text-primary' : 'text-muted-foreground'}`} />
                        ) : (
                          <AlertCircle className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <h3 className="font-bold text-white mb-1">{achievement.name}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{achievement.desc}</p>
                      {achievement.unlocked ? (
                        <p className="text-xs font-mono text-primary">{achievement.date}</p>
                      ) : (
                        <p className="text-xs font-mono text-muted-foreground">Locked</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* SECURITY TAB */}
          <TabsContent value="security" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" /> Password
                  </CardTitle>
                  <CardDescription>Change your password regularly</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded bg-secondary/30 border border-border/50">
                    <p className="text-sm text-muted-foreground mb-1">Last changed</p>
                    <p className="text-white font-mono">Dec 15, 2024</p>
                  </div>
                  <Button className="w-full bg-primary text-black hover:bg-white">Update Password</Button>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" /> Two-Factor Auth
                  </CardTitle>
                  <CardDescription>Add an extra layer of security</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded bg-secondary/30 border border-border/50">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Not Enabled</Badge>
                    </div>
                  </div>
                  <Button variant="outline" className="w-full border-primary/50 hover:bg-primary/10">Enable 2FA</Button>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card md:col-span-2">
                <CardHeader>
                  <CardTitle>Active Sessions</CardTitle>
                  <CardDescription>Manage your active login sessions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { device: 'Chrome on MacBook Pro', location: 'San Francisco, CA', lastActive: 'Just now' },
                    { device: 'Safari on iPhone', location: 'San Francisco, CA', lastActive: '2 hours ago' },
                    { device: 'Firefox on Windows PC', location: 'New York, NY', lastActive: '1 day ago' },
                  ].map((session, i) => (
                    <div key={i} className="flex justify-between items-center p-4 rounded border border-border/50 bg-secondary/20">
                      <div>
                        <p className="font-medium text-white text-sm">{session.device}</p>
                        <p className="text-xs text-muted-foreground mt-1">{session.location} • {session.lastActive}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                        Logout
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings" className="space-y-6">
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" /> Preferences
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-white">Email Notifications</label>
                  <div className="space-y-2">
                    {['Daily Summary', 'Weekly Report', 'Challenge Results', 'Achievement Unlocked'].map((pref, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`pref-${i}`}
                          defaultChecked={i < 2}
                          className="w-4 h-4 rounded border-border bg-secondary accent-primary"
                        />
                        <label htmlFor={`pref-${i}`} className="text-sm text-muted-foreground">{pref}</label>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator className="bg-border/50" />

                <div className="space-y-3">
                  <label className="text-sm font-medium text-white">Theme</label>
                  <div className="flex gap-3">
                    {['Dark', 'Light', 'Auto'].map((theme, i) => (
                      <Button
                        key={i}
                        variant={i === 0 ? "default" : "outline"}
                        className={i === 0 ? "bg-primary text-black" : ""}
                      >
                        {theme}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator className="bg-border/50" />

                <div className="space-y-3">
                  <label className="text-sm font-medium text-white">Data & Privacy</label>
                  <Button variant="outline" className="w-full border-border/50">
                    Download My Data
                  </Button>
                  <Button variant="outline" className="w-full border-destructive/50 text-destructive hover:bg-destructive/10">
                    Delete Account
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}