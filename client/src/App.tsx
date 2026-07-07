import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
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
import Journal from "@/pages/journal";
import System from "@/pages/system";
import ExecutionCenter from "@/pages/execution-center";
import ResearchLab from "@/pages/research-lab";
import ForwardTesting from "@/pages/forward-testing";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/learn" component={Learn} />
      <Route path="/learn/:domain" component={Learn} />
      <Route path="/ask" component={AskMarketPilot} />
      <Route path="/research" component={ResearchLab} />
      <Route path="/opportunities" component={Opportunities} />
      <Route path="/portfolio" component={PortfolioCoach} />
      <Route path="/journal" component={Journal} />
      <Route path="/system" component={System} />
      <Route path="/execution" component={ExecutionCenter} />
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
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
