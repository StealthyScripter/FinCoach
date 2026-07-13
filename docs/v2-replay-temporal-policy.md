# V2 Replay Temporal Policy

Events become visible only when both `publishedAt` and `effectiveAt` are at or before replay time. Stable ordering is: published timestamp, effective timestamp, priority, source ID, event ID.
