# Test Pyramid

```
        /  E2E (few)  \        critical journeys: issue stock, receive against PO, low-stock alert
       /----------------\
      / API / Contract    \    every endpoint: happy path + key error cases
     /----------------------\
    /  Integration           \  use case + real DB: balance derivation, PO state transitions
   /----------------------------\
  /  Unit (many)                 \ domain rules: sufficient-balance check, reorder threshold, state machine transitions
 /--------------------------------\
```
Most tests at the bottom (fast, numerous), fewest at the top (slow,
high-value coverage of full journeys).
