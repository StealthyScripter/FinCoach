# Strategy Machine Forward Testing

Forward testing runs only in verified demo-like modes: paper, sandbox, practice, or simulated. Live, production, real, unknown, and unverified account modes are blocked by `DemoOnlyPolicyService`.

OANDA practice integration is allowed only when account mode is verified practice. This implementation uses deterministic mocked tests unless credentials and explicit risk settings are available.
