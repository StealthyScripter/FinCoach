import React from "react";

export interface Story {
  id: number;
  headline: string;
  content: string;
  source: string;
  time: string;
  sentiment?: "bullish" | "bearish" | "neutral" | "positive" | "negative";
  score?: number;
}

interface ArticleModalProps {
  story: Story | null;
  onClose: () => void;
}

export const ArticleModal: React.FC<ArticleModalProps> = ({ story, onClose }) => {
  if (!story) return null;

  const sentimentColor =
    story.sentiment === "bullish"
      ? "text-green-600"
      : story.sentiment === "bearish"
      ? "text-red-600"
      : "text-gray-600";

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center p-4 z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg max-w-lg w-full p-6 relative overflow-auto max-h-[90vh]">
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-900 font-bold"
          onClick={onClose}
          aria-label="Close article"
        >
          X
        </button>
        <h2 className="text-xl font-bold mb-2">{story.headline}</h2>
        <p className="text-gray-700 mb-4">{story.content}</p>
        <p className="text-xs text-gray-500 mb-2">
          Source: {story.source} | {story.time}
        </p>
        <span className={`font-semibold ${sentimentColor}`}>Score: {story.score}</span>
      </div>
    </div>
  );
};
