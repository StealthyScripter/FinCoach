# V2 Reliability and Scale

Version 2 reliability hardening centralizes leases, retry budgets, circuit breakers, payload limits, endpoint allowlists, dead-letter replay requests, and tamper-evident audit records in a governance boundary.

Domain modules do not own worker locks or retry policy.
