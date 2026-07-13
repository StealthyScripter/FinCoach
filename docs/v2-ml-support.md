# V2 Governed ML Support

The ML support module provides analytical evidence only. It registers versioned model records with training lineage, temporal train/validation/test splits, calibration metadata, model cards, drift detection, and rollback status.

ML evidence has `decisionAuthority: "none"`. It cannot approve execution, promote strategies, or override deterministic governance.

## Events

- `ModelRegistered`
- `ModelRejected`
- `MlEvidenceCreated`
- `ModelDriftDetected`
- `ModelRolledBack`
- `ModelDuplicateSuppressed`
