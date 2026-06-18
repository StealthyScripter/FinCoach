import type { MarketPilotOverview, SupervisorReport, SupervisorWorkflowStep } from "@shared/schema";
import { agentSupervisorService } from "./agentSupervisorService";

export type SupervisorNode = {
  id: SupervisorWorkflowStep["id"];
  label: string;
  requiresHumanApproval: boolean;
};

export type SupervisorTransition = {
  from: SupervisorNode["id"];
  to: SupervisorNode["id"];
  condition: string;
};

export type SupervisorState = {
  runId: string;
  currentNode: SupervisorNode["id"];
  nodes: SupervisorNode[];
  transitions: SupervisorTransition[];
  report: SupervisorReport;
  executionBlocked: true;
  humanApproval: { required: true; granted: false };
};

export interface HumanApprovalGate {
  requestApproval(state: SupervisorState): SupervisorState;
}

export interface SupervisorRuntime {
  snapshot(overview: MarketPilotOverview): SupervisorState;
}

const nodes: SupervisorNode[] = [
  { id: "idea", label: "Idea", requiresHumanApproval: false },
  { id: "verification", label: "Verification", requiresHumanApproval: false },
  { id: "risk", label: "Risk", requiresHumanApproval: false },
  { id: "portfolio_impact", label: "Portfolio impact", requiresHumanApproval: false },
  { id: "compliance", label: "Compliance", requiresHumanApproval: false },
  { id: "human_approval", label: "Human approval", requiresHumanApproval: true },
  { id: "execution", label: "Blocked execution boundary", requiresHumanApproval: true },
];

const transitions: SupervisorTransition[] = nodes.slice(0, -1).map((node, index) => ({
  from: node.id,
  to: nodes[index + 1].id,
  condition: "prior gate complete",
}));

export class ExistingSupervisorRuntimeAdapter implements SupervisorRuntime, HumanApprovalGate {
  snapshot(overview: MarketPilotOverview): SupervisorState {
    const report = agentSupervisorService.review(overview);
    const firstBlocked = report.ticketReviews.flatMap((review) => review.steps).find((step) => step.status === "blocked");
    return {
      runId: `supervisor-${overview.user.id}`,
      currentNode: firstBlocked?.id ?? "human_approval",
      nodes,
      transitions,
      report,
      executionBlocked: true,
      humanApproval: { required: true, granted: false },
    };
  }

  requestApproval(state: SupervisorState): SupervisorState {
    return { ...state, currentNode: "human_approval", humanApproval: { required: true, granted: false } };
  }
}

export class DemoGraphSupervisorRuntime extends ExistingSupervisorRuntimeAdapter {}

export const supervisorRuntime = new ExistingSupervisorRuntimeAdapter();
