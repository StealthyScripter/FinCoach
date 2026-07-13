# V2 Market Similarity Policy

Similarity uses normalized weighted distance across numeric and categorical market-state features. Ordering is deterministic by distance, effective timestamp, and state ID.

Search excludes the query state itself, supports regime/asset/timeframe filters, warns when neighbor count is insufficient, and treats future outcome fields as a hard rejection during vector creation.
