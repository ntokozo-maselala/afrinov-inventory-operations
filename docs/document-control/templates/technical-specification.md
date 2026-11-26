<!-- Afrinov template: technical specification (architecture, data, API, security,
     frontend, testing). Copy this file to its folder, replace every <placeholder>,
     delete this comment, then run `npm run docs:stamp` from afrinov-platform/. The
     Afrinov header is added for you. Documents in 06–12 carry an Evidence section
     (00-governance/documentation-guide.md). -->
# <Specification title>

**Status:** DRAFT · **Owner:** <role> · **Last verified against code:** <commit>, <YYYY-MM-DD>

<What this specifies and its boundary: which modules, routes or tables it covers.>

## Overview

<How the part fits together. A Mermaid diagram if it earns its place: GitHub's
default theme, no custom colours, a one-line italic caption under it.>

## <Rules / behaviour>

<Each rule stated once, testable. Mark anything described but not built as
**Planned**, and anything not checkable in the repository as *Unverified*
(listed in 00-governance/assumptions-register.md).>

| Rule | Where enforced | Test |
|---|---|---|
| <Rule> | `<path/to/file.ts>` | `<path/to/test.ts>` |

## <Interfaces / data>

```text
<request, response, schema or command, exactly as the code has it>
```

## Evidence

- `<path/to/source>`: <what it shows>

## Related documents

- [<Title>](<relative/path.md>)
