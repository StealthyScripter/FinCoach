import { Bookmark } from "lucide-react";
import React from "react";
import { Story } from "../pages/dashboard";

interface newsCardProps {
  story: Story;
  onSelect?: React.Dispatch<React.SetStateAction<Story | null>>;
}

export const NewsCard: React.FC<newsCardProps> = ({ story, onSelect }) => {
  const borderColorClass =
    story.sentiment === "bullish"
      ? "border-green-500"
      : story.sentiment === "bearish"
      ? "border-red-500"
      : story.sentiment === "positive"
      ? "border-blue-500"
      : story.sentiment === "negative"
      ? "border-orange-500"
      : "border-gray-400";

  return (
    <div
      className={`border-l-4 pl-4 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${borderColorClass}`}
      onClick={() => onSelect?.(story)}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <h3 className="text-base font-bold text-gray-900 leading-tight mb-2">
            {story.headline}
          </h3>

          {story.excerpt && (
            <p className="text-gray-700 text-sm mb-3">{story.excerpt}</p>
          )}
        </div>

        {story.image && (
          <img
            src={story.image}
            alt=""
            className="w-10 h-10 object-cover rounded ml-4 shrink-0"
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>{story.source}</span>
          <span>{story.time}</span>

          {typeof story.score === "number" && (
            <span
              className={`font-semibold ${
                story.sentiment === "bullish"
                  ? "text-green-600"
                  : story.sentiment === "bearish"
                  ? "text-red-600"
                  : "text-gray-600"
              }`}
            >
              Score: {story.score}
            </span>
          )}
        </div>

        <Bookmark size={16} className="text-gray-400 hover:text-blue-600" />
      </div>
    </div>
  );
};
