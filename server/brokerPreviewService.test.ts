import assert from "node:assert/strict";
import { orderPreviewSchema } from "@shared/schema";
import { BrokerPreviewService } from "./brokerPreviewService";
import { createSeedOverview } from "./storage";

const overview = createSeedOverview();
const service = new BrokerPreviewService();
const approvedTicket = overview.tradeTickets.find((ticket) => ticket.id === "ticket-sgov-rebalance");
assert.ok(approvedTicket);

const preview = service.createOrderPreview({
  ticket: approvedTicket,
  overview,
  now: new Date("2026-06-15T12:00:00.000Z"),
});

assert.doesNotThrow(() => orderPreviewSchema.parse(preview));
assert.equal(preview.tradeTicketId, "ticket-sgov-rebalance");
assert.equal(preview.environment, "paper");
assert.equal(preview.liveExecutionBlocked, true);
assert.equal(preview.complianceAcknowledgementRequired, true);
assert.equal(preview.estimatedNotional, 4016.8);
assert.equal(preview.liquidityCheck, "pass");
assert.ok(preview.approvalSteps.some((step) => /final paper fill/i.test(step)));

const rejectedTicket = overview.tradeTickets.find((ticket) => ticket.id === "ticket-qqq-call");
assert.ok(rejectedTicket);
assert.throws(
  () => service.createOrderPreview({ ticket: rejectedTicket, overview }),
  /Only risk-approved proposed tickets/,
);

console.log("brokerPreviewService smoke tests passed");
