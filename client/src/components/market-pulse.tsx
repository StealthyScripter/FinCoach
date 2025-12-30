import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Stat {
  category: string;
  label: string;
  value: string;
  change: string;
  up: boolean;
}

interface MarketPulseProps {
  stats: Stat[];
  pageSize?: number; // items per swipe/page
}

export const MarketPulse: React.FC<MarketPulseProps> = ({ stats, pageSize = 4 }) => {
  const categories = useMemo(() => Array.from(new Set(stats.map((s) => s.category))), [stats]);
  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);

  const currentCategory = categories[currentCategoryIndex];
  const categoryStats = stats.filter((s) => s.category === currentCategory);
  const totalPages = Math.ceil(categoryStats.length / pageSize);
  const pageStats = categoryStats.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const prevCategory = () => {
    const newIndex = (currentCategoryIndex - 1 + categories.length) % categories.length;
    setCurrentCategoryIndex(newIndex);
    setCurrentPage(0);
  };
  const nextCategory = () => {
    const newIndex = (currentCategoryIndex + 1) % categories.length;
    setCurrentCategoryIndex(newIndex);
    setCurrentPage(0);
  };

  const prevPage = () => setCurrentPage((prev) => (prev - 1 + totalPages) % totalPages);
  const nextPage = () => setCurrentPage((prev) => (prev + 1) % totalPages);

  // Calculate dynamic container height for current category
  const itemHeight = 40; // h-10
  const spacing = 16; // space-y-4
  const pagesForCategory = Math.ceil(categoryStats.length / pageSize);
  const containerHeight = Math.min(pageSize, categoryStats.length) * itemHeight
    + (Math.min(pageSize, categoryStats.length) - 1) * spacing;

  return (
    <div className="md:col-span-1 md:row-span-1 bg-card border border-border/50 rounded-xl p-6">
      <h4 className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-4 border-b border-border/50 pb-2">
        Market Pulse
      </h4>

      {/* Category navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevCategory} className="text-gray-400 hover:text-white">
          <ChevronLeft size={20} />
        </button>
        <span className="text-xs text-muted-foreground uppercase">{currentCategory}</span>
        <button onClick={nextCategory} className="text-gray-400 hover:text-white">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Stats list with dynamic height per category */}
      <div
        className="space-y-4 overflow-hidden transition-all duration-300"
        style={{ height: `${containerHeight}px` }}
      >
        {pageStats.map((stat, i) => (
          <div key={i} className="flex justify-between items-center h-10">
            <span className="font-medium text-slate-300">{stat.label}</span>
            <div className="text-right">
              <div className="text-white font-mono font-bold">{stat.value}</div>
              <div className={`text-xs ${stat.up ? "text-emerald-500" : "text-rose-500"}`}>
                {stat.change}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Page navigation if needed */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-4">
          <button
            onClick={prevPage}
            className="px-2 py-1 border rounded border-border/50 text-gray-400 hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-muted-foreground">
            {currentPage + 1}/{totalPages}
          </span>
          <button
            onClick={nextPage}
            className="px-2 py-1 border rounded border-border/50 text-gray-400 hover:text-white"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
