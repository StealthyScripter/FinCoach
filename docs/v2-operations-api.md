# V2 Operations API

Version 2 operations endpoints expose transport-safe read models under `/api/v2/*`. Routes validate pagination, propagate request correlation IDs, redact sensitive signal fields, and always report `liveExecutionBlocked: true`.

Routes do not rank strategies, compute verdicts, reconcile evaluations, publish signals, or place orders.
