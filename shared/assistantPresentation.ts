import type { DecisionCard } from "./schema";

export type DecisionCardHighlight = {
  label: string;
  value: string;
};

export function decisionCardHighlights(card: DecisionCard): DecisionCardHighlight[] {
  return [
    { label: "Conclusion", value: card.mainConclusion },
    { label: "Suggested action", value: card.suggestedAction },
    {
      label: "Could be wrong if",
      value: card.whatCouldProveWrong[0] ?? "Contradictory evidence strengthens the case.",
    },
  ];
}

export function compactText(value: string, maxWords = 14) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
}

export type MemoryRecallSurfaceItem = {
  kind: string;
  text: string;
  source: "semantic" | "long_term";
  relevance: number;
  metadata: Record<string, unknown>;
  artifactLinks: Array<{
    label: string;
    href: string;
  }>;
};

export function buildMemoryInfluenceCue(items: MemoryRecallSurfaceItem[]) {
  const top = items[0];
  if (!top) return null;

  const label = top.kind.replaceAll("_", " ");
  const sourceLabel = top.source === "semantic" ? "semantic memory" : "long-term memory";
  const reason = typeof top.metadata.predictionId === "string"
    ? "A prior prediction review is present, so confidence should stay lower until newer evidence is verified."
    : top.kind === "lesson_learned"
      ? "A prior lesson is present, so the next decision should reuse that lesson."
      : "This recalled memory should influence the next decision.";

  return {
    label,
    sourceLabel,
    summary: top.text,
    reason,
    relevance: top.relevance,
    link: top.artifactLinks[0] ?? null,
    links: top.artifactLinks.slice(0, 2),
  };
}

export type PredictionInsightTheme = {
  theme: string;
  count: number;
  latestUpdatedLesson: string;
  latestFutureRuleAdjustment: string;
};

export type PredictionInsightRule = {
  reviewedAt: string;
  whatWasMissed: string;
  updatedLesson: string;
  futureRuleAdjustment: string;
};

export function buildPredictionLessonCue(
  topTheme: PredictionInsightTheme | undefined,
  latestRule: PredictionInsightRule | undefined,
) {
  if (!topTheme && !latestRule) return null;

  const lesson = topTheme?.latestUpdatedLesson ?? latestRule?.updatedLesson ?? "Review the latest missed evidence.";
  const rule = latestRule?.futureRuleAdjustment ?? topTheme?.latestFutureRuleAdjustment ?? "Update the next rule with the missed evidence.";

  return {
    theme: topTheme?.theme ?? "Current learning loop",
    count: topTheme?.count ?? 0,
    lesson,
    rule,
    source: latestRule ? `Last reviewed ${latestRule.reviewedAt}` : "Aggregated from repeated themes",
    cue: `Reuse this lesson: ${lesson} ${rule}`,
  };
}

export type IntelligenceGraphNode = {
  id: string;
  type: string;
  label: string;
  metadata: Record<string, unknown>;
};

export function buildIntelligenceLessonHighlight(nodes: IntelligenceGraphNode[]) {
  const predictionReview = nodes.find((node) => node.id.startsWith("prediction-review-") && typeof node.metadata.predictionId === "string");
  if (predictionReview) {
    const predictionId = String(predictionReview.metadata.predictionId);
    const lessonNode = nodes.find((node) => node.id === `prediction-lesson-${predictionId}`);
    return {
      title: predictionReview.label,
      summary: lessonNode?.label ?? predictionReview.label,
      reason: "This review should stay at the front because it produced the lesson now visible in the graph.",
      graphLink: `intelligence?start=${encodeURIComponent(predictionReview.id)}`,
      reviewLink: `/journal?predictionId=${encodeURIComponent(predictionId)}`,
    };
  }

  const lessonNode = nodes.find((node) => node.type === "LessonLearned");
  if (lessonNode) {
    return {
      title: lessonNode.label,
      summary: "A reusable lesson is available in the graph trail.",
      reason: "Show the lesson first so the operator can jump into the underlying memory trail.",
      graphLink: `intelligence?start=${encodeURIComponent(lessonNode.id)}`,
      reviewLink: null,
    };
  }

  return null;
}

export function buildMemoryActionChecklist(lessonCue: { theme: string; cue: string } | null) {
  if (!lessonCue) return [];

  const text = `${lessonCue.theme} ${lessonCue.cue}`.toLowerCase();

  if (/risk|drawdown|loss|size|sizing/.test(text)) {
    return [
      "Write the maximum allowed risk before submitting the ticket.",
      "Verify the position size still fits the current risk limit.",
      "Keep the ticket blocked until the invalidation rule is explicit.",
    ];
  }

  if (/confirm|confirmation|evidence|catalyst/.test(text)) {
    return [
      "List the confirming evidence that would justify the trade.",
      "Write the single strongest reason the thesis could still fail.",
      "Check the latest review before changing size or timing.",
    ];
  }

  if (/review|lesson|mistake|update/.test(text)) {
    return [
      "State the lesson in one sentence before submitting.",
      "Compare the current rationale against the last update.",
      "Keep the paper ticket small until the lesson is reused cleanly.",
    ];
  }

  return [
    "Write what would prove this ticket wrong before submitting.",
    "Confirm the paper-only path is still appropriate.",
  ];
}
