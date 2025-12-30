import { Link, useLocation } from "wouter";
import { LayoutDashboard, BookOpen, Activity, User, TrendingUp, Menu, X, PieChart, Wallet, Globe, CandlestickChart, Bitcoin, CreditCard } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import MarketTicker from "@/components/market-ticker";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/learn", icon: BookOpen, label: "Academy" },
    { href: "/challenge", icon: Activity, label: "Live Challenge" },
    { href: "/reports", icon: PieChart, label: "Reports" },
    { href: "/profile", icon: User, label: "Profile" },
  ];

  const domains = [
    { href: "/learn/portfolio", icon: PieChart, label: "Portfolio" },
    { href: "/learn/budgeting", icon: Wallet, label: "Budgeting" },
    { href: "/learn/forex", icon: Globe, label: "Forex" },
    { href: "/learn/stocks", icon: CandlestickChart, label: "Stocks" },
    { href: "/learn/crypto", icon: Bitcoin, label: "Crypto" },
    { href: "/learn/loans", icon: CreditCard, label: "Loans & Credit" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <MarketTicker />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card/30 backdrop-blur-xl">
          <div className="p-6 border-b border-border/50">
            <div className="flex items-center gap-2 text-primary">
              <TrendingUp className="h-8 w-8" />
              <span className="text-xl font-bold tracking-tight text-white">FinMind AI</span>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
            <div className="space-y-2">
              <p className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Main</p>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;

                return (
                  <Link key={item.href} href={item.href}>
                    <div className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group",
                      isActive
                        ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                        : "text-muted-foreground hover:text-white hover:bg-white/5"
                    )}>
                      <Icon className={cn("h-4 w-4", isActive && "animate-pulse")} />
                      <span className="font-medium text-sm">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="space-y-2">
              <p className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Domains</p>
              {domains.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;

                return (
                  <Link key={item.href} href={item.href}>
                    <div className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group",
                      isActive
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:text-white hover:bg-white/5"
                    )}>
                      <Icon className={cn("h-4 w-4")} />
                      <span className="font-medium text-sm">{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="p-4 border-t border-border/50">
            <div className="bg-card p-4 rounded-lg border border-border/50">
              <p className="text-xs text-muted-foreground mb-1">Daily Streak</p>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-[70%] bg-primary rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                </div>
                <span className="text-sm font-mono text-white">12d</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile Header */}
        <div className="md:hidden absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-background/80 backdrop-blur-md border-b border-border z-50">
          <div className="flex items-center gap-2 text-primary">
            <TrendingUp className="h-6 w-6" />
            <span className="text-lg font-bold text-white">FinMind AI</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X className="text-white" /> : <Menu className="text-white" />}
          </button>
        </div>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-background/95 backdrop-blur-xl pt-20 px-6 overflow-y-auto pb-10">
            <nav className="space-y-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Main</p>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={cn(
                          "flex items-center gap-4 p-4 rounded-xl border transition-colors",
                          isActive
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-muted-foreground"
                        )}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="font-medium">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Domains</p>
                {domains.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={cn(
                          "flex items-center gap-4 p-4 rounded-xl border transition-colors",
                          isActive
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-muted-foreground"
                        )}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="font-medium">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </nav>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pt-16 md:pt-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-slate-900 via-background to-background">
          <div className="container max-w-7xl mx-auto p-6 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}