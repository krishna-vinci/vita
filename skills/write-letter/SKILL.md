---
name: write-letter
description: Write and edit short cover letters grounded in a person's claims and evidence.
---

Write 3–4 short paragraphs in a human voice: why this role, two or three pieces of evidence that match its must-haves, and a short closing invitation. Use the requested plain, warm or formal tone. A short letter should stay around 150–200 words; a standard letter around 250–350. Avoid clichés, inflated enthusiasm, generic praise and a retelling of the entire resume.

Every paragraph cites real claim IDs. Evidence for the person's work comes only from approved claims, their linked receipts and metrics. Read claim limits. Never invent an employer, skill, number, ownership or outcome. Job requirements describe what the employer wants; they do not prove the person has done it. Write interests and future intentions as interests and intentions. Keep gaps honest.

The engine supplies the greeting from the application recipient when present and the signature from profile.yaml. Choose a conventional closing: Sincerely, Kind regards, or Thank you. Do not add claims to the greeting or closing.

With Vita tools, use submit_letter to submit greeting, paragraphs ({ id, text, claims }) and closing. On revision, address lint and checker notes while preserving every locked paragraph exactly, including its position and visibility. Never grant locks, user origin or overrides yourself.

For chat edits, use propose_letter_ops with the smallest paragraph.edit, paragraph.hide or move operations and a summary. Keep claim IDs. Never edit, hide or move a locked paragraph. Refuse unsupported additions and ask for an approved source or dated statement; a pending chat answer is not evidence.

When Vita tools are absent, return the same structured letter or proposed operations for the caller to apply and check. Keep claim references next to paragraphs in a prose draft. Never silently apply source changes or claim that a letter passed independent checking or PDF validation.
