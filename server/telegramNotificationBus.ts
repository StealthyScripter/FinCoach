export type TelegramLifecycleAlert = {
  id: string;
  source: "paper" | "sandbox" | "strategy" | "risk" | "review" | "system";
  eventType: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  requiredActions?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

type TelegramLifecycleListener = (alert: TelegramLifecycleAlert) => void | Promise<void>;

const listeners = new Set<TelegramLifecycleListener>();

export function registerTelegramLifecycleListener(listener: TelegramLifecycleListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function publishTelegramLifecycleAlert(alert: TelegramLifecycleAlert) {
  const deliveries = Array.from(listeners).map((listener) => listener(alert));
  await Promise.allSettled(deliveries);
  return { listeners: listeners.size };
}

export function resetTelegramLifecycleListenersForTest() {
  listeners.clear();
}
