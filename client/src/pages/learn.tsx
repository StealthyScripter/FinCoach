import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayCircle, Clock, BarChart, CheckCircle2, ArrowRight } from "lucide-react";
import { useRoute } from "wouter";

export default function Learn() {
  const [match, params] = useRoute("/learn/:domain?");
  const currentDomain = params?.domain || "all";

  const allCourses = [
    {
      category: "Portfolio",
      items: [
        { title: "Asset Allocation Strategies", progress: 68, status: "In Progress", lessons: 8, level: "Intermediate" },
        { title: "Risk Management 101", progress: 0, status: "Not Started", lessons: 6, level: "Beginner" },
        { title: "Rebalancing Techniques", progress: 0, status: "Locked", lessons: 4, level: "Advanced" },
      ]
    },
    {
      category: "Budgeting",
      items: [
        { title: "50/30/20 Rule Masterclass", progress: 0, status: "Not Started", lessons: 5, level: "Beginner" },
        { title: "Zero-Based Budgeting", progress: 0, status: "Not Started", lessons: 7, level: "Beginner" },
        { title: "Emergency Fund Building", progress: 0, status: "Not Started", lessons: 4, level: "Beginner" },
      ]
    },
    {
      category: "Forex",
      items: [
        { title: "Currency Pairs Explained", progress: 0, status: "Not Started", lessons: 10, level: "Beginner" },
        { title: "Pip Value & Margin", progress: 0, status: "Locked", lessons: 8, level: "Intermediate" },
        { title: "Forex Trading Strategies", progress: 0, status: "Locked", lessons: 12, level: "Advanced" },
      ]
    },
    {
      category: "Stocks",
      items: [
        { title: "Stock Market Mechanics", progress: 30, status: "In Progress", lessons: 15, level: "Beginner" },
        { title: "Fundamental Analysis", progress: 0, status: "Not Started", lessons: 20, level: "Intermediate" },
        { title: "Technical Analysis Basics", progress: 0, status: "Not Started", lessons: 18, level: "Intermediate" },
      ]
    },
    {
      category: "Crypto",
      items: [
        { title: "Blockchain Fundamentals", progress: 0, status: "Not Started", lessons: 8, level: "Beginner" },
        { title: "DeFi Protocols", progress: 0, status: "Locked", lessons: 12, level: "Advanced" },
        { title: "Crypto Security", progress: 0, status: "Not Started", lessons: 6, level: "Intermediate" },
      ]
    },
    {
      category: "Loans",
      items: [
        { title: "Understanding Interest Rates", progress: 0, status: "Not Started", lessons: 5, level: "Beginner" },
        { title: "Credit Score Hacking", progress: 0, status: "Not Started", lessons: 7, level: "Intermediate" },
        { title: "Debt Consolidation Strategies", progress: 0, status: "Locked", lessons: 6, level: "Advanced" },
      ]
    }
  ];

  const filteredCourses = currentDomain === "all" 
    ? allCourses 
    : allCourses.filter(c => c.category.toLowerCase() === currentDomain.toLowerCase());

  const getDomainTitle = (domain: string) => {
    switch(domain) {
      case "portfolio": return "Portfolio Construction";
      case "loans": return "Loans & Credit";
      case "all": return "All Learning Paths";
      default: return domain.charAt(0).toUpperCase() + domain.slice(1);
    }
  };

  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{getDomainTitle(currentDomain)}</h1>
            <p className="text-muted-foreground">
              {currentDomain === "all" 
                ? "Select a domain from the sidebar to focus your learning or browse all below." 
                : `Master ${getDomainTitle(currentDomain).toLowerCase()} with structured modules and live simulations.`}
            </p>
          </div>
          {currentDomain !== "all" && (
            <div className="flex gap-2">
              <Button variant="outline" className="border-primary/50 text-primary hover:bg-primary/10">
                <PlayCircle className="mr-2 h-4 w-4" /> Resume Path
              </Button>
            </div>
          )}
        </div>

        {filteredCourses.length > 0 ? (
          <div className="space-y-8">
            {filteredCourses.map((section, idx) => (
              <div key={idx} className="space-y-4">
                {currentDomain === "all" && (
                  <h2 className="text-xl font-semibold text-white pl-1 border-l-4 border-primary">{section.category}</h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {section.items.map((course, cIdx) => (
                    <Card key={cIdx} className="group border-border/50 bg-card/50 hover:bg-card/80 transition-all hover:border-primary/50 cursor-pointer overflow-hidden flex flex-col">
                      <div className="h-2 bg-secondary w-full">
                        <div 
                          className="h-full bg-primary transition-all duration-1000" 
                          style={{ width: `${course.progress}%` }}
                        />
                      </div>
                      <CardHeader className="pb-3 flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <Badge variant={course.status === "Completed" ? "default" : "outline"} className={course.status === "Completed" ? "bg-primary text-black" : "border-border text-muted-foreground"}>
                            {course.status}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                            <PlayCircle className="h-3 w-3" /> {course.lessons} lessons
                          </span>
                        </div>
                        <CardTitle className="text-lg text-white group-hover:text-primary transition-colors">
                          {course.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex justify-between items-center text-xs text-muted-foreground mt-auto">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 2h 15m</span>
                          <span className="flex items-center gap-1"><BarChart className="h-3 w-3" /> {course.level}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  
                  {/* "Live Scenario" Card for specific domains */}
                  {currentDomain !== "all" && (
                    <Card className="group border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all cursor-pointer border-dashed flex flex-col justify-center items-center text-center p-6">
                      <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center mb-4 text-primary group-hover:scale-110 transition-transform">
                        <Activity className="h-6 w-6" />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2">Live {section.category} Challenge</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Test your skills with real-time market data in a risk-free simulation.
                      </p>
                      <Button variant="link" className="text-primary p-0">Start Challenge <ArrowRight className="ml-1 h-4 w-4" /></Button>
                    </Card>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-white">No courses found</h2>
            <p className="text-muted-foreground">Select another domain from the sidebar.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}