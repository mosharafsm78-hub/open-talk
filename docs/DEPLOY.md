# Deploying

**Every migration must be additive and backward-compatible**, so the previous
version of the site keeps working while the new one deploys.

Add tables, columns (nullable or with a default), indexes and functions. Never
drop, rename, truncate, delete rows without a `where`, or change a column's
type in the same release that stops using the old shape. To retire something,
ship the code change first, then remove the old shape in a later release.

The deploy workflow enforces the destructive part: it blocks the whole deploy,
applying nothing, if a pending migration contains one of those statements.
