export type ControlledLiveWorkflowHistoryItem = {
  type:
    | "controlled_live.quiz_recorded"
    | "controlled_live.permission_evaluated"
    | "controlled_live.preview_created"
    | "controlled_live.confirmation_recorded"
    | "controlled_live.sandbox_submitted";
  createdAt?: string;
};

export type ControlledLiveSequenceStep = {
  key: "quiz" | "permission" | "preview" | "confirmation";
  label: string;
  completed: boolean;
  current: boolean;
  detail: string;
};

export type ControlledLiveSequenceSummary = {
  completedStepCount: number;
  totalStepCount: number;
  latestTransitionAt: string | null;
  workflowComplete: boolean;
};

export function buildControlledLiveSequence(history: ControlledLiveWorkflowHistoryItem[]) {
  const steps: ControlledLiveSequenceStep[] = [
    {
      key: "quiz",
      label: "Quiz",
      completed: hasEvent(history, "controlled_live.quiz_recorded"),
      current: false,
      detail: "Live safety knowledge check",
    },
    {
      key: "permission",
      label: "Permission",
      completed: hasEvent(history, "controlled_live.permission_evaluated"),
      current: false,
      detail: "Operator evidence gates",
    },
    {
      key: "preview",
      label: "Preview",
      completed: hasEvent(history, "controlled_live.preview_created"),
      current: false,
      detail: "Order economics and risk hash",
    },
    {
      key: "confirmation",
      label: "Confirmation",
      completed: hasEvent(history, "controlled_live.confirmation_recorded") || hasEvent(history, "controlled_live.sandbox_submitted"),
      current: false,
      detail: "Single-use explicit acknowledgement",
    },
  ];

  const currentIndex = steps.findIndex((step) => !step.completed);
  const activeIndex = currentIndex === -1 ? steps.length - 1 : currentIndex;
  const latestTransitionAt = history.reduce<string | null>((latest, entry) => {
    if (!latest) return entry.createdAt ?? null;
    if (!entry.createdAt) return latest;
    return Date.parse(entry.createdAt) > Date.parse(latest) ? entry.createdAt : latest;
  }, null);

  return {
    steps: steps.map((step, index) => ({
      ...step,
      current: index === activeIndex && !step.completed,
    })),
    currentStepLabel: currentIndex === -1 ? "Workflow complete" : `Current step: ${steps[currentIndex].label}`,
    nextRequiredStep: currentIndex === -1 ? null : steps[currentIndex].label,
    completedStepCount: steps.filter((step) => step.completed).length,
    totalStepCount: steps.length,
    latestTransitionAt,
    workflowComplete: currentIndex === -1,
  };
}

function hasEvent(history: ControlledLiveWorkflowHistoryItem[], type: ControlledLiveWorkflowHistoryItem["type"]) {
  return history.some((entry) => entry.type === type);
}
