# V2 Continuous Learning

The learning module converts immutable research journal outcomes into evidence-backed lessons. It performs attribution, aggregates journal evidence, calibrates confidence from sample count and average R, rejects insufficient or contradictory samples, and may emit bounded revision proposals for later modules.

Learning does not mutate strategies, publish signals, approve strategies, or execute trades.

## Events

- `LessonCreated`
- `LessonRejected`
- `LessonSuperseded`
- `RevisionProposed`
- `LessonDuplicateSuppressed`

## Corrections

Corrected learning records create a new lesson with `supersedesLessonId`. Existing lessons and journal entries remain unchanged.
