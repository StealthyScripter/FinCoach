import React from "react";
import { Story } from "../pages/dashboard";

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
      : story.sentiment === "positive"
      ? "text-blue-600"
      : story.sentiment === "negative"
      ? "text-orange-600"
      : "text-gray-600";

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center p-4 z-50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-lg max-w-2xl w-full p-6 relative overflow-auto max-h-[90vh]">
        {/* Close button */}
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-900 font-bold"
          onClick={onClose}
          aria-label="Close article"
        >
          X
        </button>

        {/* Headline */}
        <h2 className="text-2xl font-bold mb-2">{story.headline}</h2>

        {/* Excerpt */}
        {story.excerpt && (
          <p className="text-gray-700 italic mb-4">{story.excerpt}</p>
        )}

        {/* Image */}
        {story.image && (
          <img
            src={story.image}
            alt=""
            className="w-full h-48 object-cover rounded mb-4"
          />
        )}

        {/* Full content */}
        <p className="text-gray-700 mb-4">{story.content}</p>

        {/* AI Analysis */}
        {story.aiAnalysis && (
          <div className="bg-gray-50 p-4 rounded mb-4 text-gray-800">
            <h3 className="font-semibold mb-2">AI Analysis</h3>
            <p>{story.aiAnalysis}</p>
          </div>
        )}

        {/* Source, Time, Score */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Source: {story.source} | {story.time}
          </span>
          {typeof story.score === "number" && (
            <span className={`font-semibold ${sentimentColor}`}>
              Score: {story.score}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
