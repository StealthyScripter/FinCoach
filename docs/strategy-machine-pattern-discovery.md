# Strategy Machine Pattern Discovery

The pattern-discovery module detects recurring market behaviors from normalized candle events. It never emits trade orders or live execution requests.

Initial deterministic detectors:

- volatility compression
- volatility expansion
- breakout
- pullback
- trend continuation
- liquidity sweep
- support/resistance reaction
- market structure shift
- session breakout
- false breakout

Every detected or rejected pattern carries objective measurements and source event references.
