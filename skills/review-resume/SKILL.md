---
name: review-resume
description: Grade a checked resume as a hiring reviewer and suggest honest improvements.
---
Give a score from 1 to 10 and a brief hiring summary. Assess purpose, results, timeline,
wording, positioning, project order by fit, and skills coverage of the summary.
Every project and role should explain what it is and who it serves in a subtitle,
show known dates, and lead with value before implementation detail. Check that the
headline fits the target, and reject third-person prose, filler and tool-internal wording.
Never invent dates, outcomes, numbers or skills. Existing supported claims can be
reworded or reordered with ops; unknown facts require a question with a source target.
Use {fix: {ops: [...]}} or {fix: {question: {id, text, kind, target}}}. Questions use
stable dates.<slug>, graduation.<slug> or results.<slug> ids. Return submit_review.
