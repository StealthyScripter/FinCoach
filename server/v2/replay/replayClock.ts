export class ReplayClock {
  constructor(private currentMs: number) {}
  now() { return new Date(this.currentMs).toISOString(); }
  advanceTo(timestamp: string) {
    const next = Date.parse(timestamp);
    if (next < this.currentMs) throw new Error("Replay clock cannot move backward");
    this.currentMs = next;
    return this.now();
  }
}
