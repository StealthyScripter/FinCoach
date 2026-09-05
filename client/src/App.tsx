import { Switch, Route } from "wouter";
import { getQueryFn, queryClient, setCsrfToken } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Learn from "@/pages/learn";
import Challenge from "@/pages/challenge";
import Profile from "./pages/profile";

import Reports from "@/pages/reports";
import TradeDesk from "@/pages/trade-desk";
import SimulationLab from "@/pages/simulation-lab";
import StrategyLab from "@/pages/strategy-lab";
import Intelligence from "@/pages/intelligence";
import AskMarketPilot from "@/pages/ask-marketpilot";
import Opportunities from "@/pages/opportunities";
import PortfolioCoach from "@/pages/portfolio-coach";
import PortfolioLab from "@/pages/portfolio-lab";
import Landing from "@/pages/landing";
import Journal from "@/pages/journal";
import System from "@/pages/system";
import ExecutionCenter from "@/pages/execution-center";
import ResearchLab from "@/pages/research-lab";
import ForwardTesting from "@/pages/forward-testing";
import TradeForensics from "@/pages/trade-forensics";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/learn" component={Learn} />
      <Route path="/learn/:domain" component={Learn} />
      <Route path="/ask" component={AskMarketPilot} />
      <Route path="/research" component={ResearchLab} />
      <Route path="/opportunities" component={Opportunities} />
      <Route path="/portfolio" component={PortfolioLab} />
      <Route path="/portfolio/:id" component={PortfolioLab} />
      <Route path="/portfolio-coach" component={PortfolioCoach} />
      <Route path="/journal" component={Journal} />
      <Route path="/system" component={System} />
      <Route path="/execution" component={ExecutionCenter} />
      <Route path="/trade-forensics" component={TradeForensics} />
      <Route path="/forward-testing" component={ForwardTesting} />
      <Route path="/challenge" component={Challenge} />
      <Route path="/trade-desk" component={TradeDesk} />
      <Route path="/strategy-lab" component={StrategyLab} />
      <Route path="/intelligence" component={Intelligence} />
      <Route path="/simulations" component={SimulationLab} />
      <Route path="/reports" component={Reports} />
      <Route path="/profile" component={Profile} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <SessionGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function SessionGate() {
  const { data, isLoading } = useQuery<{ authenticated: boolean; csrfToken?: string } | null>({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  if (data?.csrfToken) setCsrfToken(data.csrfToken);
  if (isLoading) return <div className="min-h-screen bg-background text-muted-foreground p-8">Loading...</div>;
  if (!data?.authenticated) return <Landing />;
  return <Router />;
}

export default App;
