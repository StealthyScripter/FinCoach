# V2 Market Memory

Market memory creates point-in-time state vectors from observation, trader-analysis, context, and fundamental evidence. Vectors are deterministic, versioned, and reject fields that encode future outcomes, labels, or realized P/L.

Similarity search is contextual evidence only. It returns nearest historical states, confidence warnings, and sample-depth metadata. It cannot approve a strategy, publish a signal, or start execution.
