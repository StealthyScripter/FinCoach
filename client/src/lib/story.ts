export interface Story {
  id: number;
  headline: string;
  excerpt?: string;
  category?: string;
  sentiment?: "bullish" | "bearish" | "neutral" | "positive" | "negative";
  score?: number;
  image?: string;
  source: string;
  time: string;
  featured?: boolean;
  content: string;
  metrics?: Record<string, unknown>;
  aiAnalysis?: string;
}
