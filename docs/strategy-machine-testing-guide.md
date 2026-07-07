# Strategy Machine Testing Guide

Run the focused strategy-machine checks:

- `npx tsx server/strategyMachine.test.ts`
- `npx tsx server/strategyMachineUi.test.ts`

Run the full release checks:

- `npm run check`
- `npm run build`
- `npm test`
- `set -a; source .env; set +a; npm run test:pgstorage`
- `git diff --check`

If `.env` or external credentials are absent, external integration tests should be skipped or fail clearly without committing secrets.
