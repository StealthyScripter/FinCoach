# V2 Historical Replay Resume

Historical replay resume is bound to the replay manifest and dataset manifest hash. Replay commands validate the dataset manifest before execution and reject changed dataset hashes.

The supported operator flow is:

```bash
npm run v2:dataset:oanda:build -- --symbols <SYMBOLS> --timeframes <TIMEFRAMES> --start <START> --end <END> --price <PRICE> --output <DATASET_OUTPUT> --compression gzip
npm run v2:dataset:validate -- --manifest <DATASET_OUTPUT>/manifest.json
npm run v2:replay:prepare -- --mode historical --dataset-manifest <DATASET_OUTPUT>/manifest.json --output <REPLAY_OUTPUT> --start <START> --end <END> --symbols <SYMBOLS> --timeframes <TIMEFRAMES>
npm run v2:replay:run -- --manifest <REPLAY_OUTPUT>/manifest.json
npm run v2:replay:resume -- --manifest <REPLAY_OUTPUT>/manifest.json
```

Dataset build is a separate explicit stage. Replay and resume never fetch OANDA data or mutate historical dataset partitions.

Current limitation: local tests cover manifest hash binding, validation, restart scripts, and deterministic replay contracts, but the full five-year and ten-year cloud resume campaigns must still be executed by an operator with retained artifacts before declaring those cloud campaigns complete.
