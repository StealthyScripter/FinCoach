# V2 Market Replay

Replay delivers historical source events through a deterministic clock. It performs no real provider calls, broker calls, signal publishing, or wall-clock waiting in tests.

Checkpoints include replay ID, clock, cursor, delivered event IDs, and seed so resume can avoid duplicates and skipped events.
