# V2 Structured Signals

The signal gateway emits `fincoach.signal.v2` research records with symbol, side, entry, stop loss, take profit, strategy lineage, court case, forward-test ID, confidence, expiry, and `demoOnly: true`.

It performs validation and duplicate suppression only. It does not send Telegram messages, place broker orders, or activate strategies.
