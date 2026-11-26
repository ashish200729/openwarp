# OpenWarp functionality review

The review started from `918e5f8` on November 26, 2026. Each row covers a dedicated source review. The team traced ordinary user actions through the interface, permissions, writes, dependent records and existing browser tests.

| Area | What the review found |
| --- | --- |
| Teams and org chart | Archiving a team could widen an announcement or routine’s audience. Active rules could still refer to the old team. Large charts omitted people and misidentified their managers. |
| Employee directory and profiles | Administrators could see a restricted field on their own profile, save it and lose the edit. The custom-field CSV silently stopped at 10,000 people. |
| Employment lifecycle | Cancelling a departure could lose planned shifts and leave device return dates behind. Rehires needed a visible account-restoration step. Old open work could carry into the new employment. |
| Time off | Approved leave disappeared from the shared calendar as soon as offboarding began, even when the employee was still working. |
| Timesheets | Clock, submission, decision and reopening paths were checked. A downstream pay draft can use the current overtime multiplier after a policy change instead of the multiplier stored with the approved week. Payroll calculation is outside this release. |
| Shift scheduling | Copying a week ignored half-day leave. The person selector and save/delete redirects lost the chosen team. The existing employee shift label already identifies overnight work. |
| Documents and upload requests | The company library had no second page, the API returned superseded files, and pending requests could lose their visible reviewer or file. |
| Electronic signatures | Manual drafts omitted template signer defaults. A later name change could change the name required for consent. Pending signatures needed a terminal state at archive. |
| Devices and application access | People leaving could request more equipment or app access after the return checklist had already been prepared. Device return, repair and inventory transitions were also traced. |
| Training | Cancelled work disappeared from history and exports. Changing questions after an open assignment had a quiz attempt could make a recorded pass apply to different questions. |
| Compliance | Category counters disagreed with filtered lists. Demoting or offboarding an administrator could strand assigned obligations and notices. |
| Workforce reporting | Rehire overwrote employment dates used by historical reports. Cancelled hires could count as joiners. Date controls and captions disagreed with what some reports measured. |
| Sign-in, onboarding and access | Existing invite, password, SSO, MFA and role checks were traced. Rehire needs an explicit access handoff so an administrator can decide whether to restore a disabled login. |
| Announcements | Edited and removed announcements could leave stale recipient notices. Adding an acknowledgement requirement after publication needed a fresh prompt. |
| Notifications and email | An email could remain queued after the recipient lost access or its invitation was superseded. Personal-change requests were classified as general updates. |
| REST, MCP and CLI | MCP writes lacked the REST retry contract. Tool and internal errors needed consistent machine-readable codes and correlation IDs. |
| Routines | A failed action could consume its occurrence permanently. Large scheduled audiences could stop after the first 5,000 people. |
| Webhooks | Pausing delivery could silently skip matching events. A retried delivery could show the previous HTTP response while waiting. |
| Benefits enrollment | New-hire windows could open before the start date. A previous employment’s election could count towards rehire onboarding. Existing dependent selections were absent from the edit form. |
| Expense approvals | Archiving someone with a pending claim could remove it from the administrator’s review queue. The receipt and manager approval paths were also checked. |
| Activity history and retention | Team-name filters missed team events. Old labels followed renames instead of preserving the names present when events were written. Retention respects the consumer cursors. |
| Workspace navigation and search | Unlinked accounts saw shortcuts they could not use. Same-page mobile navigation could leave the menu open. Home silently hid tasks beyond the first twelve. |
| Deployment and public entry | Readiness could report success on an older database. Worker replicas needed to distinguish acquiring the maintenance lock from skipping it. Public entry links and self-hosting commands were also checked. |

## Changes in this release

- Team archiving checks live dependencies, and editors preserve an archived audience until an administrator chooses a new one. Large org charts let members open a reporting level and page through it. Administrative custom fields follow the editor’s role, and large field exports can be narrowed by employee name or email.
- The schedule uses employment dates to hide shifts during notice. Cancelling departure makes them available again. Device return dates and system-created checklist deadlines follow the last day, while explicit returns and completed work retain their history. Archiving closes unfinished employee requests and training, voids open signature requests with an evidence event, and waits for pending expenses. Rehire links administrators to account restoration.
- Reports use retained employment periods and label current-attribute groupings. Activity entries preserve new actor and subject names. Company and personal documents page independently, the API lists current versions, and an upload under review must be resolved before archival. New signature requests capture signer names at send time.
- Queued communications are checked against their source and recipient before delivery. Automatic routines use bounded retries and process large audiences in batches. Paused webhook deliveries retain matching events for up to 30 days. MCP callers can reuse an idempotency key when retrying a write and receive structured tool errors.
- A release checks its migration name and checksum before declaring readiness or running background work. Navigation uses account eligibility, the mobile menu closes on selection, and Home exposes additional loaded tasks.

## Historical limits

Data deleted before an upgrade cannot be recreated from a new migration. In particular, a previously discarded shift or overwritten employment date requires a backup or another reliable business record to recover. Preserve a database backup before upgrading. Earlier activity and signature rows without a saved name continue to use the evidence available for those records.

For upgrades, pending legacy password emails are checked against the live recipient and token before sending. Older announcement notices without a trustworthy source are suppressed so a removed announcement or former team audience cannot receive stale content. Current announcements remain available in the workspace. Delivery records retain the suppression reason.

## Operational choices

- A rehire keeps the old login disabled until an administrator explicitly restores access.
- Declined signatures keep their evidence. A replacement starts as a new draft.
- Changing a training renewal interval applies to future completions. Existing certificates and scheduled renewals retain their dates.
- Payment-provider integration and changes to payroll calculations were excluded. The approved-timesheet multiplier issue above remains relevant when preparing pay drafts after a policy change.

## Verification

The production build passed lint, TypeScript checks and all 14 browser regression workflows against PostgreSQL 17. The dependency audit reported zero known vulnerabilities. Upgrade checks included a populated 011 database, all seven new migrations, an idempotent second migration run, runtime-role access and readiness before and after upgrade. Separate service checks covered a directory of more than 10,000 people, 5,001 routine recipients, superseded mail and paused webhook delivery. Test recipients and databases were local fixtures.
