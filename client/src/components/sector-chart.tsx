import React, { useState } from "react";
import { AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer, YAxis, Legend } from 'recharts';
import { Newspaper } from "lucide-react";

interface SectorDataPoint {
  name: string;
  high?: number;
  low?: number;
  avg?: number;
}

interface SectorChartProps {
  data: Record<string, SectorDataPoint[]>;
}

const sectors = ["stocks", "forex", "oil", "metals"];
const metrics = ["high", "low", "avg"];
const times = ["Intraday", "1 Week", "1 Month"];

// Assign a color for each metric
const metricColors: Record<string, string> = {
  high: "#22c55e", // green
  low: "#ef4444",  // red
  avg: "#3b82f6"   // blue
};

export const SectorChart: React.FC<SectorChartProps> = ({ data }) => {
  const [selectedSector, setSelectedSector] = useState<string>("stocks");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["avg"]);
  const [selectedTime, setSelectedTime] = useState<string>("Intraday");

  const toggleMetric = (metric: string) => {
    setSelectedMetrics(prev =>
      prev.includes(metric) ? prev.filter(m => m !== metric) : [...prev, metric]
    );
  };

  const chartData = data[selectedSector] || [];

  // Convert all values to numbers to satisfy TypeScript
  const yValues = chartData.flatMap(d =>
    selectedMetrics.map(m => Number(d[m as keyof SectorDataPoint] ?? 0))
  );

  const minY = Math.min(...yValues) * 0.98;
  const maxY = Math.max(...yValues) * 1.02;

  return (
    <div className="md:col-span-2 bg-card/50 border border-border/50 rounded-xl p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-2 md:gap-0">
        <h3 className="font-bold text-white flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          {selectedSector.toUpperCase()} Trend
        </h3>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Sector Selector */}
          <select
            className="bg-background border border-border rounded text-xs px-2 py-1 text-muted-foreground"
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
          >
            {sectors.map((s) => (
              <option key={s} value={s}>{s.toUpperCase()}</option>
            ))}
          </select>

          {/* Time Selector */}
          <select
            className="bg-background border border-border rounded text-xs px-2 py-1 text-muted-foreground"
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
          >
            {times.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Metric Checkboxes */}
          <div className="flex gap-2 items-center">
            {metrics.map(metric => (
              <label key={metric} className="flex items-center gap-1 text-xs text-white">
                <input
                  type="checkbox"
                  checked={selectedMetrics.includes(metric)}
                  onChange={() => toggleMetric(metric)}
                  className="accent-blue-500"
                />
                {metric.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              {selectedMetrics.map(metric => (
                <linearGradient key={metric} id={`color-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColors[metric]} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={metricColors[metric]} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis domain={[minY, maxY]} stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }} itemStyle={{ color: '#fff' }} />
            <Legend wrapperStyle={{ color: "#fff", fontSize: 12 }} />
            {selectedMetrics.map(metric => (
              <Area
                key={metric}
                type="monotone"
                dataKey={metric as keyof SectorDataPoint}
                stroke={metricColors[metric]}
                fillOpacity={1}
                fill={`url(#color-${metric})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
