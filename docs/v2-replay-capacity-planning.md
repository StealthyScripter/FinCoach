# V2 Replay Capacity Planning

These are planning estimates, not guarantees. Operators must run `scripts/v2-replay/cloud-preflight.sh` with campaign-specific gates.

| Campaign | Free Disk | Memory | Notes |
| --- | ---: | ---: | --- |
| verify | 1 GB | 1 GB | Fixture-only environment check |
| one-symbol five-year | 200 GB | 16 GB | Depends on timeframe density |
| multi-symbol five-year | 500 GB | 32 GB | Start with bounded symbol set |
| one-symbol ten-year | 400 GB | 24 GB | Use validated continuous coverage |
| multi-symbol ten-year | 1000 GB | 64 GB | Consider deterministic shards |

Primary cost factors are dataset size, PostgreSQL growth, checkpoint frequency, worker count, symbol count, timeframe count, artifact retention, restart campaign density, cloud storage IOPS, database write throughput, and CPU throttling.

Historical replay source memory is bounded by `BATCH_SIZE` plus parser/readline buffers. Very small batches increase repeated source scans in the current release-candidate adapter; operators should start at `BATCH_SIZE=1000` and adjust only after observing throughput and memory.

Preflight supports `FINCOACH_REPLAY_MIN_FREE_DISK_GB`, `FINCOACH_REPLAY_MIN_MEMORY_GB`, and `FINCOACH_REPLAY_MIN_POSTGRES_FREE_GB`. The script fails when configured minimums are not met.
