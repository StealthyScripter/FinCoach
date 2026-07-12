import { telegramRepository, type TelegramRepository } from "./repository";

const TRANSPORT = "telegram-getUpdates";

export class TelegramUpdateCursor {
  constructor(private readonly repository: Pick<TelegramRepository, "loadUpdateCursor" | "saveUpdateCursor"> = telegramRepository) {}

  async loadOffset() {
    const lastUpdateId = await this.repository.loadUpdateCursor(TRANSPORT);
    return lastUpdateId === null ? 0 : lastUpdateId + 1;
  }

  async saveProcessed(updateId: number) {
    await this.repository.saveUpdateCursor(TRANSPORT, updateId);
  }
}

export const telegramUpdateCursor = new TelegramUpdateCursor();
