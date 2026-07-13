# V2 Fundamental Provider Contract

Providers should return normalized economic or corporate event payloads with source, source timestamp, publication timestamp, expiration, and stable provider event IDs. Tests use deterministic fixtures only; normal verification does not call paid APIs.

Provider failures must be classified as unavailable, malformed payload, stale data, conflicting evidence, unsupported event type, future information leakage, data-integrity failure, persistence failure, configuration failure, or unknown terminal failure.
