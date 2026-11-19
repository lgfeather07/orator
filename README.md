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
2. In the Supabase dashboard, open SQL Editor and run `supabase/schema.sql`, then `supabase/ballots.sql`, then `supabase/tournaments.sql`, then `supabase/fixes.sql` (saved director settings and linking student accounts to the roster), then `supabase/calendar.sql`, then `supabase/public_results.sql`, then `supabase/paper_ballots.sql` (tab-room entry of paper ballots).
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable (anon) key from Project Settings → API.
4. Restart `npm run dev`.

**Updating an existing project:** after pulling new changes, run `supabase/tournaments.sql` again in the SQL Editor. It is safe to re-run and adds new columns (the latest: issue reports, judge check-in, practice goals, director updates to coaches and judges, entries open/closed, the judges-see-a-rating setting, varsity/novice divisions, and clean-judge conflicts) without touching existing data. Then run `supabase/public_results.sql` (also safe to re-run); it must come after `tournaments.sql`.

Then run `supabase/calendar.sql` again too, every time, after `tournaments.sql`: it adds the public tournament calendar (listing, city, ISO date, registration deadline, notes for coaches, saved fees) and the director's "Approve coaches automatically" setting, and it replaces the membership trigger that `tournaments.sql` defines. Tournaments created before it stay off the calendar until their director lists them.

Run `supabase/paper_ballots.sql` last, and again whenever you re-run `ballots.sql` or `tournaments.sql`: it replaces three ballot trigger functions those files define (`stamp_ballot`, `check_ballot_submission`, `check_ballot_room`), keeping every rule and adding a pass for paper entry. Until it is run, the Ballots tab still lists rooms but saving a paper ballot asks for the update.

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
- `src/results.ts`, `src/Results.tsx` — breaks, finals, and team points following the NSAA manual
- `src/CutPreview.tsx` — finals cut points: for each contest, what a cut of 4 to 8 would do (how many advance, ties at the line, which tie-break settled the last spot), an all-contests table to set every cut before "Create all finals" (default 6, the NSAA number; a final room holds 8), and "next in" alternates the director can move into a final before any final ballot is in. Cuts are kept in the browser (the demo's saved state, or per tournament for signed-in directors), like the other finals settings. `npm run test:cuts` runs the cut rules' tests (`tests/cuts.test.mjs`).
- `src/PaperBallots.tsx`, `src/paperBallots.ts`, `src/paperBallotsApi.ts` — the director's Ballots tab: every room (round, event, room, judge) marked e-ballot in, paper entered, or missing, with filters and search, and keyboard-first entry of paper ballots (rank, optional points 35–50 or five section marks, time, no-show, time penalty; Enter moves to the next box). It checks ranks for typos before saving (no ties, ranks 1 to the number who performed, points 35–50, a higher rank never with fewer points unless the lower speaker had a time penalty, optional double entry of every rank). Saved paper ballots count in breaks, finals and placings exactly like e-ballots. Signed in, they go through `enter_paper_ballot()` (`supabase/paper_ballots.sql`), which checks the caller directs the tournament, checks the ballot again, stores it as a submitted ballot attributed to the room's judge with `source = 'paper'` and who entered it, and logs every entry, correction, and e-ballot override in `paper_ballot_log`. Replacing a judge's submitted e-ballot needs an explicit override. Coaches and (after release) students see paper ballots like any other; they have no comments or private notes. Ranks entered without points count 0 rating points (the last tie-break). In the demo, paper ballots are kept in the browser. `npm run test:paper` runs the entry checks' tests.
- `src/PastBallots.tsx` — past-tournament ballots for students and coaches
- `src/EntryImport.tsx` — adding students by hand or from a roster file
- `src/legal.tsx` — privacy, terms, cookies, refund and accessibility pages (drafts) and the footer; business details go in `BUSINESS` at the top
- `src/Payments.tsx` — tournament fees (default $7 an entry and $75 per judge a school doesn't bring), each school's invoice, Orator's size-based fee (placeholder tiers in `ORATOR_PRICING` in `src/tournament.ts`), and the payment simulator (no real money moves)
- `src/PublicResults.tsx`, `src/publicResultsApi.ts`, `src/PublishResults.tsx` — public results pages (`#/results`, `#/results/<id>`, `#/school/<school>`, `#/student/<school>/<student>`), open without an account, and the director's Publish results panel. Only final placings (place, student, school) and team points are public; ballots, comments, and preliminary rankings stay private. The demo shows a fictional sample season.
- `supabase/` — database tables and access rules (`public_results.sql` holds the published-results tables, run after `tournaments.sql`)
- `src/store.tsx` — demo data shared across roles
