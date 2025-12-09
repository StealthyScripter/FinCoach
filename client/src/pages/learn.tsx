import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayCircle, Clock, BarChart, CheckCircle2 } from "lucide-react";

export default function Learn() {
  const courses = [
    {
      category: "Fundamentals",
      items: [
        { title: "Finance Theory", progress: 100, status: "Completed", lessons: 12 },
        { title: "Asset Classes Explained", progress: 68, status: "In Progress", lessons: 8 },
        { title: "Budgeting & Savings", progress: 0, status: "Not Started", lessons: 6 },
      ]
    },
    {
      category: "Trading & Markets",
      items: [
        { title: "Stock Market Mechanics", progress: 30, status: "In Progress", lessons: 15 },
        { title: "Forex Trading Strategies", progress: 0, status: "Not Started", lessons: 10 },
        { title: "Crypto & Blockchain", progress: 0, status: "Not Started", lessons: 8 },
      ]
    },
    {
      category: "Advanced Concepts",
      items: [
        { title: "Derivatives & Options", progress: 0, status: "Locked", lessons: 14 },
        { title: "Portfolio Construction", progress: 0, status: "Locked", lessons: 9 },
        { title: "Loan & Credit Optimization", progress: 0, status: "Locked", lessons: 7 },
      ]
    }
  ];

  return (
    <Layout>
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Academy</h1>
            <p className="text-muted-foreground">Master financial concepts through structured modules.</p>
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-mono font-bold">1/12 Completed</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="all" className="space-y-6">
          <TabsList className="bg-card border border-border/50">
            <TabsTrigger value="all">All Courses</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-8">
            {courses.map((section, idx) => (
              <div key={idx} className="space-y-4">
                <h2 className="text-xl font-semibold text-white pl-1 border-l-4 border-primary">{section.category}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {section.items.map((course, cIdx) => (
                    <Card key={cIdx} className="group border-border/50 bg-card/50 hover:bg-card/80 transition-all hover:border-primary/50 cursor-pointer overflow-hidden">
                      <div className="h-2 bg-secondary w-full">
                        <div 
                          className="h-full bg-primary transition-all duration-1000" 
                          style={{ width: `${course.progress}%` }}
                        />
                      </div>
                      <CardHeader className="pb-3">
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
                        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                          Learn the core principles of {course.title.toLowerCase()} and apply them in real-world scenarios.
                        </p>
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 2h 15m</span>
                          <span className="flex items-center gap-1"><BarChart className="h-3 w-3" /> Intermediate</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}