import { eventLogService } from "../eventLogService";
import type { TelegramAuditEvent } from "./contracts";
import { redactTelegramSecrets } from "./formatter";

export function emitTelegramEvent(type: TelegramAuditEvent, payload: Record<string, unknown>, correlationId?: string) {
  return eventLogService.append({
    type: `telegram.${type}` as never,
    userId: "system",
    sourceService: "telegram-operations",
    correlationId,
    payload: redactTelegramSecrets(payload) as Record<string, unknown>,
  });
}
