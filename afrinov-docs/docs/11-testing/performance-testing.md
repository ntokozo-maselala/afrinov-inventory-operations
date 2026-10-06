# Performance Testing

Load-test the transaction-heavy paths (issue, receive) and the
report-heavy paths (movement history, stock value) at a multiple of
current observed volume — the largest AS-IS sheet (`Project Material
Issued`) has 4,514 rows accumulated over time; size test data at least an
order of magnitude beyond that to leave headroom for growth.
