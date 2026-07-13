# V2 Research Journal

The research journal is the final append-only evidence ledger for the Version 2 validation pipeline. It records institutional research conclusions after forward tests, structured signals, external evaluations, and reconciliation outcomes.

The module owns only journal entries. It does not create forward tests, publish signals, reconcile outcomes, place orders, or mutate source records.

## Contract

Each entry uses `fincoach.v2.research-journal.1` and includes:

- `journalEntryId`
- `subjectType`
- `subjectId`
- `sourceModule`
- `summary`
- `evidence`
- `conclusion`
- `limitations`
- `supersedesEntryId`
- `createdAt`
- `lineageEventIds`
- `correlationId`
- `causationId`

Corrections are represented by a new entry with `supersedesEntryId`. Original entries remain unchanged.

## Events

- `ResearchJournalEntryRecorded`
- `ResearchJournalEntryRejected`
- `ResearchJournalEntrySuperseded`
- `ResearchJournalDuplicateSuppressed`

## Safety

Live execution remains blocked. Journal evidence may describe demo/practice results only when those results already passed through the public forward-testing, signal, and external-evaluation contracts.
