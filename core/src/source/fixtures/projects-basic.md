# Fictional evidence inventory
## Community Archive
```yaml
kind: project
links:
  - https://example.org/archive
stack:
  - TypeScript
  - SQLite
verified:
  at: 2026-10-08
  ref: abc123def
evidence:
  - id: ev-archive-search
    kind: code
    ref: catalogue/search.ts
  - id: ev-archive-guide
    kind: doc
    ref: evidence/files/guide.pdf
custom:
  audience: volunteers
```
### Selection notes
Keep the volunteer context.

### Claims
- Built a searchable catalogue. <!-- c:archive-search ev:ev-archive-search -->
- Documented the review process. <!-- c:archive-guide ev:ev-archive-guide -->
### Limits
- No measured usage or time savings.
### Variants
- Product: Built an archive catalogue with a review queue. <!-- v:archive-product -->
- Kept maintenance instructions with the records. <!-- v:archive-maintenance -->
## First Aid Certificate
```yaml
kind: certification
links:
  - https://example.org/northbank/certificate
stack: []
evidence:
  - id: ev-first-aid
    kind: doc
    ref: evidence/files/first-aid.pdf
```
### Claims
- Completed a practical first aid assessment. <!-- c:first-aid-assessment ev:ev-first-aid -->
### Limits
- Do not describe the certificate as a clinical licence.
### Variants
