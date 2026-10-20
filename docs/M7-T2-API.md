# M7-T2 backend contract

Both resource families support the following routes (`:id` is a validated `Slug`):

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/resumes?archived=include\|only` | none | `ResumeSummary[]` |
| `GET /api/applications?archived=include\|only` | none | `ApplicationSummary[]` |
| `GET /api/tracker?archived=include\|only` | none | `TrackerList` |
| `POST /api/resumes/:id/archive`, `/unarchive` | `EmptyRequest` | `ResourceMetadataMutation` |
| `POST /api/applications/:id/archive`, `/unarchive` | `EmptyRequest` | `ResourceMetadataMutation` |
| `DELETE /api/resumes/:id` | none | `DeleteResourceResult` |
| `DELETE /api/applications/:id` | none | `DeleteResourceResult` |
| `PUT /api/resumes/:id/instructions` | `PutResumeInstructionsRequest` | `ResourceMetadataMutation` |
| `PUT /api/applications/:id/instructions` | `PutResumeInstructionsRequest` | `ResourceMetadataMutation` |
| `POST /api/resumes/:id/regenerate` | `RegenerateResumeRequest` | `JobMutation` (202, existing base job) |
| `POST /api/applications/:id/regenerate` | `RegenerateResumeRequest` | `JobMutation` (202, existing answers rerun) |

Lists exclude archived resources by default. `include` returns both; `only`
returns archived resources. `ArchivedFilter` exports these query values.
`ResumeSummary`, `ApplicationSummary`, `ResumeResource` and `ApplicationResource`
include optional `archived` (ISO timestamp) and `instructions` fields through
`ResourceMetadata`. The server returns an empty instruction string when unset.
`ApplicationResource.notes` remains a compatibility alias of `instructions`.
Application storage continues to use `meta.yaml` `notes`; base storage uses
`meta.yaml` `instructions`. The existing create routes accept `instructions`
through `CreateApplicationRequest` and `CreateBaseRequest`. If both application
`instructions` and legacy `notes` are provided, `instructions` wins. Instructions
are limited to 20,000 characters; an empty string clears them.

Regeneration saves supplied instructions before enqueueing. Omitting them uses
the saved guidance. Applications reuse analysis and answers and preserve locked
bullets through the existing reviewed tailor path. Bases use the same reviewed
base generator, preserving configuration, metadata and locked bullets. Guidance
is subordinate to core principles, lint and independent review.

Archive/unarchive/instruction mutations are tracked with user commits and emit
`resource.changed`; existing resource undo scopes include `meta.yaml`. The master
returns 409 `master-protected` for base-only actions. Active jobs return 409
`resource-busy`. Deletion requires archive first (409 `archive-first`). A referenced
base returns 409 `base-in-use`, with `error.details.applications: {id,title}[]`,
including archived applications. Delete those applications first.

Permanent deletion removes the entire folder, including tracker/letter/prep and
answers, and returns `{deleted: true, sha}` for the user commit. The app cannot
undo deletion; recovery requires git. Undo requests for deleted resources return
404. Archiving a base keeps existing applications usable.

`ItemLink` is the exported `{label,url}` schema; `Item.links` accepts at most four
explicit overrides, with `[]` hiding links. Missing links are derived from
source evidence during TeX/Markdown rendering. See [the template contract](../templates/README.md).
