# Vita evaluation comparison

Character/4 input and output estimates; no cache simulation, model calls or charges. Scripted verdicts do not measure quality.
Character/4 input and output estimates; no cache simulation, model calls or charges. Scripted verdicts do not measure quality.

Each cell shows before → after. Cost is a catalog estimate, not an invoice; faux cost is zero.

| Workspace / operation / role / model | Fresh input | Output | Cache read | Cache write | Catalog USD | Role wall ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| developer / master / writer faux/writer | 6988 → 5782 | 572 → 572 | 0 → 0 | 0 → 0 | 0 → 0 | 36 → 36 |
| developer / master / checker faux/checker | 4271 → 3698 | 201 → 201 | 0 → 0 | 0 → 0 | 0 → 0 | 7 → 6 |

developer / master: wall 1589 → 1428 ms; rounds 1 → 1; lint 0 → 0; checker {"supported":6,"overstated":0,"unsupported":0} → {"supported":6,"overstated":0,"unsupported":0}; ATS 0 → 0; done true → true; gaps [] → [].

| developer / tailor / analyst faux/default | 3103 → 1623 | 47 → 47 | 0 → 0 | 0 → 0 | 0 → 0 | 9 → 6 |
| developer / tailor / writer faux/writer | 7380 → 6086 | 572 → 572 | 0 → 0 | 0 → 0 | 0 → 0 | 11 → 14 |
| developer / tailor / checker faux/checker | 4277 → 3698 | 201 → 201 | 0 → 0 | 0 → 0 | 0 → 0 | 5 → 6 |
| developer / tailor / ats-reviewer faux/default | 2990 → 5174 | 6 → 10 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 1120 |

developer / tailor: wall 1316 → 1290 ms; rounds 1 → 1; lint 0 → 0; checker {"supported":6,"overstated":0,"unsupported":0} → {"supported":6,"overstated":0,"unsupported":0}; ATS 0 → 0; done true → true; gaps [] → [].

| nurse / master / writer faux/writer | 7086 → 5871 | 596 → 596 | 0 → 0 | 0 → 0 | 0 → 0 | 9 → 13 |
| nurse / master / checker faux/checker | 4332 → 3765 | 201 → 201 | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 5 |

nurse / master: wall 1216 → 1290 ms; rounds 1 → 1; lint 0 → 0; checker {"supported":6,"overstated":0,"unsupported":0} → {"supported":6,"overstated":0,"unsupported":0}; ATS 0 → 0; done true → true; gaps [] → [].

| nurse / tailor / analyst faux/default | 3135 → 1622 | 41 → 41 | 0 → 0 | 0 → 0 | 0 → 0 | 6 → 9 |
| nurse / tailor / writer faux/writer | 7482 → 6175 | 596 → 596 | 0 → 0 | 0 → 0 | 0 → 0 | 10 → 11 |
| nurse / tailor / checker faux/checker | 4339 → 3765 | 201 → 201 | 0 → 0 | 0 → 0 | 0 → 0 | 3 → 3 |
| nurse / tailor / ats-reviewer faux/default | 3007 → 5209 | 6 → 10 | 0 → 0 | 0 → 0 | 0 → 0 | 3 → 1101 |

nurse / tailor: wall 1253 → 1256 ms; rounds 1 → 1; lint 0 → 0; checker {"supported":6,"overstated":0,"unsupported":0} → {"supported":6,"overstated":0,"unsupported":0}; ATS 0 → 0; done true → true; gaps [] → [].

