# Afrinov Inventory Platform: Project Tracking Roadmap

Nov 7, 2026 · Sbonakaliso Ngcobo

## Summary

Six phases that bring job tracking into the platform, aligned with the **03 Projects Tracking Schedule** workbook. Before 2026 a project manager kept that workbook: one sheet per month, each job broken into steps (Kick-off, Engineering, Procurement, Manufacturing, FAT, Packaging, Data Pack, Delivery, Postmortem, Closure), each step with planned and actual dates, the person assigned, % complete and a day-by-day chart. The team now uses ClickUp, which the business says holds the same things, and plans to move away from it. In the app, each project holds one or more schedules of steps, managers keep them up to date, the chart and a board of open jobs show what is late, and the Procurement step reads the project's orders and deliveries, which neither the workbook nor ClickUp could.

This goes against the current scope: `01-product/product-scope.md` lists production scheduling and full project management as out of scope, and `01-product/capability-map.md` lists project management as "Future or never". Phase 0 changes both and records the decision as **ADR-032**. It stays job tracking: no budgets, step dependencies or resource levelling.

**Status:** Phases 0 and 1 merged (#163, #164). Phase 2 on `feature/project-tracking-2`, Phase 3 on `feature/project-tracking-3` (branched from Phase 2); Phases 4 and 5 not started. Every question was decided on 7 Nov 2026: the business answered the main ones and left the rest to engineering (marked "Engineering" under Decisions). Progress is tracked in the **Project Tracking — Implementation Tracker** Claude doc.

| Phase | What | Size | Status |
|---|---|---|---|
| 0 | Scope change and ADR | S | Built |
| 1 | A project has schedules and steps | L | Built |
| 2 | The project page | M | Built |
| 3 | The chart and the board of open jobs | M | Built |
| 4 | The Procurement step reads the orders | S–M | Not started |
| 5 | Moving off ClickUp | S | Not started |

Sizes used below: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

## How to run this

### Before release, on every database

1. Apply the Phase 1 migrations (`npx prisma migrate deploy`). They only add tables, columns and settings rows.
2. Under **Settings → Projects**, check the step templates against how the team works now, and enter the year's **closed days** (public holidays, shutdowns), so working days count correctly.
3. Make sure every open project has its **Project manager** set: only the project's manager and Admin can update its schedules.
4. Agree the cut-over date with the business, from which jobs are tracked in the app only and ClickUp is no longer updated.

### Order of work

One branch and pull request per phase, in order: `feature/project-tracking-0` to `feature/project-tracking-5`. Phase 0 is docs only and goes first, so the scope change is agreed before any code. Phase 1 changes nothing on screen, so it can merge and deploy on its own. Phases 2 and 3 should reach the business together. Phase 4 can come before or after Phase 3.

### How it works, start to finish

1. A project is created as today. Its manager adds a **schedule** from a template (workshop job, site job, buy-and-deliver or maintenance visit), names it, and gives it a due date if the client was promised one. Most projects have one schedule; a split job has one per part; a joint job is tracked on one of its projects, naming the others it covers.
2. While the schedule is **Planning**, the manager adds, removes or renames steps, assigns each to a platform user and sets its planned dates. This is the **baseline**.
3. The manager makes the schedule **Active**. The baseline is locked; from now on each step has a **forecast** (when it is now expected) beside it.
4. As work goes on, the manager updates each step's progress and forecast. If a step slips, the screen offers to move the later steps by the same number of working days. A step at 100% gets its **actual** end date.
5. If the plan itself changes, **Re-plan** sets a new baseline with a reason; the old one stays in the Activity.
6. The chart shows each step's baseline, forecast or actual, and progress. The **board** lists every open schedule by how late it is forecast to finish, flagging those that will miss their due date. **My steps** shows each user what is assigned to them.
7. The Procurement step lists the project's orders, what each still owes and when it is expected. When everything has arrived, it offers to mark the step done.
8. When every step is done, the schedule is **Done**. When every schedule is done or cancelled, the project can be marked **Completed**.

A recurring job (monthly maintenance) is one project: **New month** adds the next month's schedule, copying the steps at 0% with their dates moved on a month.

### Decisions

| Decision | Choice | Decided | Phase |
|---|---|---|---|
| Where job tracking lives | In the platform, replacing ClickUp | 7 Nov 2026 | All |
| What it must cover | What the workbook covered: ClickUp holds the same | 7 Nov 2026 | All |
| The expected finish before a step is done | A separate forecast date; the actual date is set only once the step is done (the workbook used "Actual End" for both) | 7 Nov 2026 | 1 |
| A completed job | The project's Completed status, not strikethrough | 7 Nov 2026 | 1 |
| Buy-and-deliver jobs | Their own template, without Engineering or Manufacturing (the workbook hid these rows) | 7 Nov 2026 | 1 |
| Recurring jobs | A new schedule each month on the same project, each from 0% to 100% | 7 Nov 2026 | 1 |
| Joint and split jobs | Up to the user: a project can hold several schedules (a split job such as `AFRI-02A-1119-04-1` to `-3`); a joint job (`0960&0961`) can be tracked on one of its projects, its schedule naming the others it covers, or each project can keep its own | 7 Nov 2026 | 1 |
| Who updates schedules and steps | Managers, for now: the project's manager (the user named as Project manager on it) and Admin. People assigned to a step don't update it themselves yet | 7 Nov 2026 | 1 |
| Who a step is assigned to | Any active platform user | 7 Nov 2026 | 1 |
| Jobs already in ClickUp | Not imported: open jobs are set up afresh from the cut-over date | 7 Nov 2026 | 5 |
| Weighting progress | By each step's planned working days, a zero-day step counting as one so a milestone still counts | Engineering, 7 Nov 2026 | 1 |
| Working days | Monday to Friday, less closed days an administrator lists in Settings | Engineering, 7 Nov 2026 | 1 |
| The client's due date | Optional, on each schedule (so a recurring job has one per month); the project's start and end dates stay as they are | Engineering, 7 Nov 2026 | 1, 3 |
| Gaps between steps | No gap column: each step's dates are planned directly, and the screen offers to move later steps when one slips | Engineering, 7 Nov 2026 | 2 |
| Reminders | Not in this roadmap: My steps and the board stand in (see [Later](#later)) | Engineering, 7 Nov 2026 | 3 |
| The Procurement step when everything has arrived | Offered, not automatic: the manager confirms it | Engineering, 7 Nov 2026 | 4 |

### Rule of thumb

Copy what the workbook means, not how it works. Its layout was sound; its formulas and habits had faults (see [Workbook faults not to copy](#workbook-faults-not-to-copy)). The server enforces each rule, and the screens never offer what the server would refuse.

## Phase 0: Scope change and ADR

Size S. Docs only.

*Built on `feature/project-tracking-0`.* The product roadmap gained a Job tracking section too, and the change log an entry.

- [x] **0.1 The scope.** Move job tracking into scope in `01-product/product-scope.md`, and update the project-management row of `01-product/capability-map.md`, saying what stays out (budgets, step dependencies, resource levelling).
- [x] **0.2 ADR-032.** Record in `00-governance/decision-log.md` that job tracking moves from ClickUp into the platform, with the decisions above. Add this roadmap to `docs/README.md` among the specialist plans.

**Done when:**
- The scope documents and the decision log agree that job tracking is in scope.

## Phase 1: A project has schedules and steps

Size L. Backend, with a migration, and the mock API.

*Built on `feature/project-tracking-1` (migrations `20260101000051_projects_setting_category` and `20260101000052_project_schedules`).* Changes from the plan:
- **Routes by id.** A schedule and a step are addressed by their own id (`/project-schedules/:id`, `/project-steps/:id`), not under the project, so a step can't be named under the wrong project; each change answers with the whole schedule. `GET /project-step-templates` lists the templates for the form.
- **Templates and closed days are text settings**, in a new Settings category, Projects: one template per line ("Workshop job: Kick-off, Engineering, …") and one closed day per line ("2026-12-25 Christmas Day"). Settings stores only text, numbers, yes/no or a fixed choice, so no new table or admin screen was needed. The Settings panel that shows them comes with Phase 2's screens.
- **The mock API moves to Phase 2**, with the page that calls these routes: nothing on screen calls them yet, and the page's tests are what exercise the mock.
- **A started schedule's plan** changes through a re-plan, adding a step (with its planned dates) or removing one, each with a reason; a planning schedule records no progress, expected or actual dates. Done goes back to Active (reopening); a done or cancelled schedule is otherwise read-only.

Tests: 23 unit tests for working days and the rules, one for completing a project, a migration test, and 13 over real HTTP (`project-schedules.real-http.test.ts`). The whole suite passes on a clean database (backend 1148 unit, 273 integration), and the migrations match the schema.

- [x] **1.1 Schedules.** A new `project_schedules` table: project, name ("Main", "Frame modification", "January 2026"), status (`PLANNING`, `ACTIVE`, `DONE`, `CANCELLED`), an optional due date, and the other project numbers it covers, for a joint job. A project can hold any number. Deleting a project that has schedules is refused, as for a project holding stock.
  Files: `backend/prisma/schema.prisma`, a new migration
- [x] **1.2 Steps.** A new `project_steps` table: schedule, position, name, baseline start and end, forecast start and end, actual start and end, progress (0 to 100), the user assigned (referencing `users`), notes.
  Files: `backend/prisma/schema.prisma`, the same migration
- [x] **1.3 Step templates.** Standard step lists kept in Settings: workshop job (Kick-off, Engineering, Procurement, Manufacturing, FAT, Packaging, Data Pack, Delivery, Postmortem, Closure), site job (adds Site induction and safety file, Site installation, Commissioning), buy-and-deliver (no Engineering or Manufacturing) and maintenance visit (Site induction, Site inspection, Oil testing, Site report, Closure). A new schedule starts from one, and its steps can then be changed.
  Files: `backend/src/modules/settings/settings.service.ts`, a new `backend/src/modules/operations/project-schedule.service.ts`
- [x] **1.4 New month.** For a recurring job, adds a schedule with the previous month's steps at 0%, dates moved on a month and still editable. The previous month's schedule stays as it was.
  Files: `project-schedule.service.ts`
- [x] **1.5 Working days.** One shared function counts working days between two dates and adds working days to a date: Monday to Friday, less the closed days in a new setting (`projects.closedDays`). Everything that counts days uses it.
  Files: a new `backend/src/shared/working-days.ts`, `settings.service.ts`
- [x] **1.6 The rules, on the server.**
  - Only the project's manager and Admin change its schedules and steps: a new permission, `manage:project_schedule`, held by Admin, or being the project's manager. Everyone signed in can see them.
  - A schedule's baseline is edited only while it is Planning. Re-planning an Active one sets a new baseline, needs a reason, and keeps the old dates in the audit log.
  - An actual end is set only with progress at 100%, and progress at 100% needs an actual end.
  - A schedule is Done only when every step is done. A project is marked Completed only when every schedule is Done or Cancelled.
  - A step is assigned only to an active user.
  - Every change is written to the audit log in the same transaction, as `project.service.ts` does for projects.
  Files: `project-schedule.service.ts`, `backend/src/modules/operations/project.service.ts`, `backend/src/shared/permissions.ts`
- [x] **1.7 The totals.** Worked out on the server from the schedule's own steps, never stored: start (earliest), forecast end (latest), progress (weighted by planned working days), variance in working days (forecast or actual end against baseline end), working days past the due date if forecast to miss it, and the step that is late. A project's totals cover its open schedules.
  Files: `project-schedule.service.ts`
- [x] **1.8 Routes.** `GET /project-step-templates`; `GET`/`POST /projects/:projectNumber/schedules`; `GET`/`PATCH /project-schedules/:id`, `POST /project-schedules/:id/next-month`, `/replan` and `/steps`; `PATCH`/`DELETE /project-steps/:id` (`?reason=` once started). A step update can move the later steps' forecasts by a number of working days (`shiftLaterBy`), in the same transaction. The POSTs that create take an `Idempotency-Key`, as inventory writes do.
  Files: `backend/src/modules/operations/project.routes.ts`, `backend/src/openapi/document.ts`, `backend/src/shared/idempotency.ts`

Tests: working days (weekends, closed days, a span over a month end); totals (weighted progress, variance by end date, a late start that finishes on time showing none); a locked baseline; New month copying at 0%; and over real HTTP, who may change what (the project's manager and Admin may; another user's manager, Procurement and a technician are refused). A migration test, and the existing suites unchanged.

**Done when:**
- A project can be given schedules from a template, a recurring job can start its next month, and the server refuses a change by anyone but the project's manager or Admin, an actual end without 100%, a baseline change without a reason, and Completed with a schedule still open.

## Phase 2: The project page

Size M. Frontend.

**Where it shows:** Projects → a project's number → its page.

*Built on `feature/project-tracking-2` (branched from Phase 1).* Two additions to Phase 1's API, found while building the page:
- **`GET /projects/:projectNumber/assignees`:** the active users a step can be assigned to, for the project's manager and Admin. `/users/lookup` needs `view:users`, which a manager in another role (Procurement, say) doesn't hold.
- **`PATCH /project-steps/:id` is retry-safe** with an `Idempotency-Key`: moving the later steps adds days, so a replay after a lost answer must not move them twice.

The step form works out how many working days a step slipped (`lib/workingDays.ts`, the server's count, with the closed days from Settings) and offers to move the later steps by that much; it is never done unasked.

- [x] **2.1 A page for one project.** `/projects/:projectNumber`: its details as today, its schedules (open ones first, each with its steps in order), and the links the Projects list already has (Stock used, Orders).
  Files: a new `frontend/src/pages/ProjectDetail.tsx`, `App.tsx`, `pages/Projects.tsx`
- [x] **2.2 Adding a schedule.** Pick a template, name the schedule and give it a due date. For a joint job, pick the other projects it covers. On a recurring job, **New month** starts the next one.
- [x] **2.3 Updating a step.** Progress, forecast dates, the user assigned and a note. Marking a step done asks for its actual end, today by default. When a forecast end moves later, the form offers to move the later steps by the same number of working days. Only the project's manager and Admin see these controls.
  Files: a new `frontend/src/components/ProjectStepForm.tsx`
- [x] **2.4 Planning and re-planning.** While a schedule is Planning, its baseline dates are edited in place. Once Active, **Re-plan** asks for the new dates and a reason.
- [x] **2.5 Settings → Projects.** A panel for the step templates and the closed days (both multi-line text), for Admin.
  Files: `pages/Settings.tsx`, `pages/SettingsSections.tsx`
- [x] **2.6 The mock API.** The Phase 1 routes in `mock/mockApi.ts`, with the same rules, and the two Projects settings rows, so the page works in frontend-only mode (moved here from Phase 1).
  Files: `frontend/src/mock/mockApi.ts`

Tests: schedules listed open first; someone who isn't the manager sees no controls; marking a step done asks for its actual end; moving later steps when one slips; re-plan needs a reason. The mock serves the page in frontend-only mode.

Built with: `ProjectDetail.test.tsx` (7), `SettingsProjects.test.tsx`, `mockSchedules.test.ts` (6), `workingDays.test.ts`, and two more real-HTTP checks (the assignees list, and a retried step update moving the later steps once). Frontend 1380 tests, backend 1148 unit and 273 integration.

**Done when:**
- A project manager sets up a job from a template, keeps its steps up to date, and the project's progress and variance follow.

## Phase 3: The chart and the board of open jobs

Size M. Frontend, and one report endpoint.

**Where it shows:** a project's page (the chart); Projects → **Board** (open jobs and My steps); the Dashboard.

*Built on `feature/project-tracking-3` (branched from Phase 2).* Changes from the plan:
- **Two read routes in the schedule service**, not the reporting service, as they share its totals: `GET /project-board` (`?managerId=`, `?assigneeId=`) and `GET /my-project-steps`. The board's order is `boardOrder` in `project-schedule.rules.ts`: past the due date first, then late against plan, then the soonest finish.
- **The board is its own menu entry**, Project board under Sales (`/projects/board`, with My steps at `?view=mine`), rather than a tab on Projects.
- **The chart is a Steps / Chart switch** on each schedule. It stretches to today only when today is within a month of the plan, so an old job isn't squeezed, and stops shading weekends beyond 200 days.
- **The user filter is "Only jobs with steps assigned to me"**, not a picker of every user: listing users needs `view:users`, which most people on the board don't hold.
- **The Dashboard gets a notice, not a card,** shown only when the user has steps late or due this week. The top row is a fixed grid of cards, and a notice says more.

- [x] **3.1 The chart.** One per schedule, a line per step: the baseline as one bar, the forecast or actual as another, progress filled in. Weekends and closed days shaded, a line for today and a marker for the due date. Built in CSS, with no chart library.
  Files: a new `frontend/src/components/ProjectGantt.tsx`
- [x] **3.2 The board.** Every open schedule (not Done or Cancelled) with its project, progress, forecast end, variance, due date and the step it is on, sorted by how late it is forecast to finish. One forecast to miss its due date is flagged. Filters by manager and by user assigned.
  Files: a new `frontend/src/pages/ProjectBoard.tsx`, `backend/src/modules/reporting/reporting.service.ts`, `hooks/useNavGroups.tsx`
- [x] **3.3 My steps.** The steps assigned to the signed-in user, due first, and a count on the Dashboard of those due this week or late. This stands in for reminders.
  Files: `pages/ProjectBoard.tsx`, `pages/Dashboard.tsx`

Tests: bars drawn from the right dates, closed days shaded, the due-date marker; only open schedules on the board, sorted by lateness, with the flag and filters; the Dashboard count; the board endpoint.

Built with: `ProjectGantt.test.tsx` (6), `ProjectBoard.test.tsx` (3), two Dashboard tests, the chart switch on the project page, the sidebar entries, `boardOrder` in the rules tests, the mock, and a real-HTTP check of the board and My steps. Frontend 1406 tests, backend 1168 unit and 304 integration.

**Done when:**
- A manager sees on one page which open jobs are late and why, and no open job drops off.

## Phase 4: The Procurement step reads the orders

Size S–M. Backend and frontend. No migration: orders and receipts already record what is owed and what arrived.

**Where it shows:** a project's page → the Procurement step.

- [ ] **4.1 What is ordered and what has arrived.** The purchase orders of the project, and of any other projects its schedule covers: each one's expected delivery date and what is still owed.
  Files: `project-schedule.service.ts`, `pages/ProjectDetail.tsx`
- [ ] **4.2 A warning when the dates disagree.** The step says so when an order is overdue, or expected after the step's forecast end.
- [ ] **4.3 Finishing the step.** Once every order line is received, the step offers **Mark done**, with the last receipt's date as its actual end. The manager confirms; nothing happens on its own.

Tests: orders of the project and of the projects a joint schedule covers; what is owed; an overdue order and one expected after the step; the offer appearing only when everything has arrived.

**Done when:**
- Nobody has to ask Procurement whether a job's material is in.

## Phase 5: Moving off ClickUp

Size S. Docs and the cut-over. Nothing is imported from ClickUp.

- [ ] **5.1 Check roles end to end.** Over real HTTP and on screen: the project's manager and Admin change schedules and steps; any other user sees them and My steps but gets 403 on every change.
  Files: a new `backend/integration/project-schedules.real-http.test.ts`
- [ ] **5.2 Docs.** The README, `task_context.md`, the user guide, the page inventory, the product roadmap, and this roadmap's status.
- [ ] **5.3 Cut over.** The business sets the date (see Before release). From it, managers set up each open job afresh, with today's plan as its baseline, and ClickUp is no longer updated.

**Done when:**
- Every open job is tracked in the app and nobody updates ClickUp.

## Field map

Each part of the workbook's month sheets (the July 2025 to January 2026 layout) and where the app holds it.

| Workbook | In the app | Phase |
|---|---|---|
| **Job row** | | |
| ITEM (1, 2, 3 …) | Not kept: projects are found by number | — |
| DESCRIPTION (`AFRI-1086 …` and the job's name) | The project's number and name; the schedule's name | 1 |
| Baseline Start / End (MIN and MAX of its steps) | Worked out from the schedule's steps | 1 |
| Duration (SUM of its steps) | Not kept: the start-to-end span in working days is shown instead | 1 |
| Actual Start / End (MIN and MAX of its steps) | Worked out: start, and forecast or actual end | 1 |
| Assigned To | The project's manager | — |
| Status (AVERAGE of its steps) | Progress, weighted by planned working days | 1 |
| Variance (days) | Variance in working days, by end date | 1 |
| **Step row** | | |
| ITEM (1.1, 1.2 …) | `project_steps.position` | 1 |
| DESCRIPTION (Project Kick-off, Engineering …) | `project_steps.name`, from a template | 1 |
| Before After (days), planned | Not kept: each step's dates are planned directly | 2 |
| Baseline Start / End | Baseline start and end, locked when the schedule starts | 1 |
| Duration (days), planned | Worked out in working days | 1 |
| Before After (days), actual | Not kept | — |
| Actual Start / End, before the step is done | Forecast start and end | 1 |
| Actual Start / End, once done | Actual start and end | 1 |
| Duration (days), actual | Worked out in working days | 1 |
| Assigned To | The user assigned | 1 |
| Status (0 to 100%) | `project_steps.progress` | 1 |
| Variance (days) | Worked out by end date | 1 |
| **Chart** | | |
| Day columns from the first baseline start | The chart, on the project page | 3 |
| Baseline bar and progress bar per step | Baseline bar; forecast or actual bar; progress | 3 |
| Weekend shading | Weekends and closed days shaded | 3 |
| **Habits** | | |
| A sheet per month; unfinished jobs moved on | No months: open schedules stay on the board | 3 |
| Strikethrough for a completed job | The project's Completed status | 1 |
| Hidden rows for buy-and-deliver jobs | The buy-and-deliver template | 1 |
| A recurring job copied onto each month's sheet | **New month** on the same project | 1 |
| **Not carried over** | | |
| Document No, Owner, Approved by (2023 layout) | Out of scope: the app's audit log records who changed what | — |
| Delivery Date (2023 layout) | Brought back as the schedule's due date | 1 |
| Legend | Out of scope | — |

## Workbook faults not to copy

Found by reading all six month sheets (about 45 jobs) and confirmed with the workbook's owner on 7 Nov 2026:

- **"Actual End" meant two things.** It held the expected finish until a step reached 100%, then the real date. All 392 unfinished steps had an "actual" end.
- **The baseline moved.** Each baseline date was worked out from the step before and a gap, so editing a step moved the plan. AFRI-1021's planned end moved from 19 Sep to 15 Oct, so a finish 26 days after the first plan read as 3 days behind.
- **Variance compared durations, not dates.** (Planned end − planned start) − (actual end − actual start): a step that started late and took its planned time showed no variance. 76 steps did.
- **Progress was a plain average.** A zero-day kick-off counted as much as a month of manufacturing.
- **Totals read the wrong rows.** Job totals were formulas over row ranges, and some pointed at another job: AFRI-1088 showed 91% while its own steps were all at 0%. AFRI-1000 showed −16% against 80%.
- **Status lived in formatting.** Strikethrough meant completed and a hidden row meant buy-and-deliver, which no formula can read; completed jobs still showed low progress.
- **Jobs fell off at month end.** Unfinished jobs were meant to move to the next month's sheet; 0961, 0999, 1047 and 1073 were neither completed nor moved to October.
- **A recurring job's months were wrong.** AFRI-0993 should reach 100% each month; it read 33%, 57%, 57% and 14%.
- **Weekends counted as working days.** The chart shaded them, but durations counted every day.

## Later

- **Reminders** by email or in the app for steps due or late, once mail or notifications are set up on the server.
- **People updating their own steps**, not only managers.
- **Step dependencies, budgets and resource levelling**, if full project management is ever brought into scope.
- **Time booked against steps**, which overlaps with the Manhours workbook.

## Before each pull request

- From `afrinov-platform/`, run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. For backend changes, also run `npm run test:integration --workspace=@afrinov/backend`.
- Update `mock/mockApi.ts` for any new or changed endpoint, so `npm run dev:frontend-only` keeps working, and add new endpoints to `openapi/document.ts`, keeping `openapi.test.ts` green.
- Migrations only add: tables and columns (with their indexes, keys and constraints) or settings rows. Nothing existing is changed or dropped.
- Check the field map above and mark what the phase closed.
- Update the phase's status and ticks in the tracker doc, with a line in its progress log.

File references are relative to `afrinov-platform/apps/`, except the docs in Phase 0, which are relative to `afrinov-docs/docs/`.
