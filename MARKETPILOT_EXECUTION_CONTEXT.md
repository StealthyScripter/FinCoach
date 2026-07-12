# MarketPilot execution foundation

Application code is maintained in `FinCoach/`. Development context, standalone execution tests, generated reports, and future non-runtime assets belong in this outer `FinCoachFiles/` workspace.

Safety invariant: live execution remains disabled unless a supervised workflow passes every readiness gate and receives explicit user confirmation. Limited autonomy defaults to disabled.

