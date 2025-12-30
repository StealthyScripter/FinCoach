// components/SwipeableOpenPosition.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from "lucide-react";

export interface OpenPositionData {
  title: string;
  price: string;
  change: string;
  changeUp?: boolean;
  thesis: string;
  validation: string;
  position: "open" | "closed" | "monitoring" | "other";
}

interface OpenPositionProps {
  positions: OpenPositionData[];
}

export const OpenPosition: React.FC<OpenPositionProps> = ({ positions }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<"left" | "right">("right");

  const prevPosition = () => {
    setSlideDirection("left");
    setCurrentIndex((prev) => (prev === 0 ? positions.length - 1 : prev - 1));
  };

  const nextPosition = () => {
    setSlideDirection("right");
    setCurrentIndex((prev) => (prev === positions.length - 1 ? 0 : prev + 1));
  };

  const position = positions[currentIndex];

  const positionColorMap: Record<OpenPositionData["position"], string> = {
    open: "bg-emerald-500",
    closed: "bg-rose-500",
    monitoring: "bg-yellow-400",
    other: "bg-gray-400",
  };

  return (
    <div className="md:col-span-1 md:row-span-2 bg-secondary/20 border border-border/50 rounded-xl p-6 flex flex-col relative h-[450px] overflow-hidden">
      {/* Header with arrows */}
      <div className="flex items-center justify-between gap-2 text-primary mb-4 relative z-10">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${positionColorMap[position.position]} transition-colors duration-500`}
          />
          <span className="font-mono text-xs uppercase tracking-wider">{position.position.toUpperCase()}</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button className="text-white hover:text-primary" onClick={prevPosition}>
            <ChevronLeft size={20} />
          </button>
          <button className="text-white hover:text-primary" onClick={nextPosition}>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Slide Container */}
      <div className="relative flex-1">
        {positions.map((pos, index) => {
          const isActive = index === currentIndex;
          const offset = slideDirection === "right" ? (index - currentIndex) * 100 : (index - currentIndex) * -100;

          return (
            <div
              key={index}
              className={`absolute top-0 left-0 w-full h-full transition-transform duration-500 ease-in-out`}
              style={{ transform: `translateX(${isActive ? 0 : offset}%)`, opacity: isActive ? 1 : 0 }}
            >
              <h3 className="text-xl font-bold text-white mb-2">{pos.title}</h3>
              <div className="text-4xl font-mono font-bold text-white mb-1">{pos.price}</div>
              <div
                className={`flex items-center gap-2 ${
                  pos.changeUp ? "text-emerald-500" : "text-rose-500"
                } mb-6 font-mono text-sm`}
              >
                {pos.changeUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {pos.change} (Unrealized)
              </div>

              <div className="flex-1 space-y-4">
                <div className="p-3 bg-background/50 rounded border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1">Thesis</p>
                  <p className="text-sm text-slate-300">{pos.thesis}</p>
                </div>
                <div className="p-3 bg-background/50 rounded border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1">Validation</p>
                  <p className="text-sm text-slate-300">{pos.validation}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button
        variant="outline"
        className="w-full mt-6 border-primary/20 hover:bg-primary/10 hover:text-primary relative z-10"
      >
        Manage Position
      </Button>
    </div>
  );
};
