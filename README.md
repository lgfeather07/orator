# Orator — Speech Tournament Platform

Tournament software for high school speech: e-ballots that follow the NSAA ballot, judge and speaker check-in, coach tools, and student feedback.

**Live site:** https://orator-1rab.vercel.app/ (rebuilds automatically from the `main` branch)

## Run it

```bash
npm install
```

```bash
npm run dev
```

Without any configuration the app runs as a demo with sample data.

The demo includes a full tournament setup: a coach enters students, the director builds the schedule, publishes it, runs the day, and ends it; the coach then releases results to students. That setup state is kept in the browser (not the database) and can be reset from the director's Details step.

## Turn on real accounts (Supabase)

1. Create a project at supabase.com.
2. In the Supabase dashboard, open SQL Editor and run `supabase/schema.sql`, then `supabase/ballots.sql`, then `supabase/tournaments.sql`, then `supabase/fixes.sql` (saved director settings and linking student accounts to the roster), then `supabase/calendar.sql`, then `supabase/public_results.sql`, then `supabase/judges.sql` (coach-entered judges and judge sign-in links).
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable (anon) key from Project Settings → API.
4. Restart `npm run dev`.
5. In Supabase, open **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Judge sign-in links need it (see below); without it a judge link says “Guest judge sign-in is turned off”. Nothing else changes: anonymous users can only claim a judge seat.

**Updating an existing project:** after pulling new changes, run `supabase/tournaments.sql` again in the SQL Editor. It is safe to re-run and adds new columns (the latest: issue reports, judge check-in, practice goals, director updates to coaches and judges, entries open/closed, the judges-see-a-rating setting, varsity/novice divisions, and clean-judge conflicts) without touching existing data. Then run `supabase/public_results.sql` (also safe to re-run); it must come after `tournaments.sql`.

Then run `supabase/calendar.sql` again too, every time, after `tournaments.sql`: it adds the public tournament calendar (listing, city, ISO date, registration deadline, notes for coaches, saved fees) and the director's "Approve coaches automatically" setting, and it replaces the membership trigger that `tournaments.sql` defines. Tournaments created before it stay off the calendar until their director lists them.

Run `supabase/judges.sql` last, every time (it is safe to re-run): it adds coach-entered judges and their sign-in links, and re-running `tournaments.sql` afterwards would otherwise re-grant its private helpers.

## Coach-entered judges and judge sign-in links

Judges don’t need accounts. On the Team entries page a coach adds the judges their school is bringing (name, optional email and mobile, “clean judge” or the other schools they know). The number entered is what the school’s invoice counts as judges brought (it replaces the old “judges bringing” stepper). Each judge gets a **private sign-in link** the coach can copy, email (`mailto:`) or text (`sms:`).

- **Opening the link** (`#/judge-link/<token>`) signs the judge in with a Supabase anonymous sign-in and calls `claim_judge_link(token)`, which gives that guest an approved judge seat at that one tournament under the coach-entered name and school. They land on `#/judging`: only their own rooms, each opening its ballot. Ballots save exactly as an account judge’s do (the database checks the room is theirs).
- **Tokens** are 32 random bytes made in the database; only a SHA-256 hash is stored, and nobody can read a link back. A coach can copy one again only in the same browser tab; otherwise “Make a new link”, which stops the old one working (a judge already signed in keeps their seat).
- **Another device:** opening the same link on another phone or laptop moves the seat there, with the ballots already started or submitted; the first device loses it. **Turn off link** (coach or director) stops the link and signs out whoever holds the seat (their unsubmitted drafts are discarded; submitted ballots stay). A new link can then be made.
- **Approval:** coach-entered judges are approved straight away, because the coach was approved by the director and answers for their own judges. The director sees them on the Judges step and the People tab, grouped by the school that entered them, and can decline (they leave the judge pool and their link stops working), approve again, or turn off a link. The scheduler places them like any approved judge, with the same clean/known-schools conflicts; until a judge opens their link, their rooms are held by their seat (`sections.coach_judge_id`).
- **Judges with accounts** can still sign up and ask to join. If an account judge has the same name (and school) as a coach-entered one, the director sees “also joined with their own account” and can **Merge**: the account takes the seat, so the person counts once. Otherwise both are listed. A judge who opens their link while signed in to an account can use it with that account.
- **Save my account:** a guest judge can add an email (confirmed by Supabase’s email) and then a password, so they can sign in normally next time.
- Anonymous users can’t create tournaments, ask to join, enter students, set goals, enter judges, or start a ballot without a seat; their profile is always a judge with no school.
- In the demo, links look like `#/judge-link/demo-<judge>-<n>` and work in the same browser.

## Layout

- `src/App.tsx` — the four role workspaces (student, judge, coach, director)
- `src/JudgeBallot.tsx` — the e-ballot
- `src/ballots.ts` — NSAA ballot criteria, time limits, and disqualification grounds for 11 events
- `src/DirectorSetup.tsx` — tournament setup and check-in board
- `src/TeamEntries.tsx` — a coach's entries for the tournament
- `src/tournament.ts` — demo tournament data and the schedule builder
- `src/Issues.tsx` — issue reporting and the director's issue board
- `src/Calendar.tsx` — the public tournament calendar (`#/calendar`, `#/calendar/<id>`, no sign-in needed), registering a school from it, and the director's listing settings
- `src/theme.css` — the visual theme
- `src/CoachTools.tsx` — focus notes, practice log, checklist
- `src/auth.tsx` — sign in, sign up, password reset
- `src/ballotApi.ts` — saving and loading ballots
- `src/tournamentApi.ts` — tournaments, join requests, entries, and schedules in the database
- `src/Access.tsx` — creating a tournament, asking to join, and the director's approval list
- `src/JudgeRooms.tsx` — a judge's assigned rooms
- `src/CoachJudges.tsx`, `src/judgeLinks.ts`, `src/judges.css` — coach-entered judges, their sign-in links, the director's list, and the guest judge page (`supabase/judges.sql`)
- `src/results.ts`, `src/Results.tsx` — breaks, finals, and team points following the NSAA manual
- `src/CutPreview.tsx` — finals cut points: for each contest, what a cut of 4 to 8 would do (how many advance, ties at the line, which tie-break settled the last spot), an all-contests table to set every cut before "Create all finals" (default 6, the NSAA number; a final room holds 8), and "next in" alternates the director can move into a final before any final ballot is in. Cuts are kept in the browser (the demo's saved state, or per tournament for signed-in directors), like the other finals settings. `npm run test:cuts` runs the cut rules' tests (`tests/cuts.test.mjs`).
- `src/PastBallots.tsx` — past-tournament ballots for students and coaches
- `src/EntryImport.tsx` — adding students by hand or from a roster file
- `src/legal.tsx` — privacy, terms, cookies, refund and accessibility pages (drafts) and the footer; business details go in `BUSINESS` at the top
- `src/Payments.tsx` — tournament fees (default $7 an entry and $75 per judge a school doesn't bring), each school's invoice, Orator's size-based fee (placeholder tiers in `ORATOR_PRICING` in `src/tournament.ts`), and the payment simulator (no real money moves)
- `src/PublicResults.tsx`, `src/publicResultsApi.ts`, `src/PublishResults.tsx` — public results pages (`#/results`, `#/results/<id>`, `#/school/<school>`, `#/student/<school>/<student>`), open without an account, and the director's Publish results panel. Only final placings (place, student, school) and team points are public; ballots, comments, and preliminary rankings stay private. The demo shows a fictional sample season.
- `supabase/` — database tables and access rules (`public_results.sql` holds the published-results tables, run after `tournaments.sql`)
- `src/store.tsx` — demo data shared across roles
