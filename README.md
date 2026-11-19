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
2. In the Supabase dashboard, open SQL Editor and run `supabase/schema.sql`, then `supabase/ballots.sql`, then `supabase/tournaments.sql`.
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable (anon) key from Project Settings → API.
4. Restart `npm run dev`.

**Updating an existing project:** after pulling new changes, run `supabase/tournaments.sql` again in the SQL Editor. It is safe to re-run and adds new columns (the latest: entries open/closed, the judges-see-a-rating setting, varsity/novice divisions, and clean-judge conflicts) without touching existing data.

## Layout

- `src/App.tsx` — the four role workspaces (student, judge, coach, director)
- `src/JudgeBallot.tsx` — the e-ballot
- `src/ballots.ts` — NSAA ballot criteria, time limits, and disqualification grounds for 11 events
- `src/DirectorSetup.tsx` — tournament setup and check-in board
- `src/TeamEntries.tsx` — a coach's entries for the tournament
- `src/tournament.ts` — demo tournament data and the schedule builder
- `src/Issues.tsx` — issue reporting and the director's issue board
- `src/theme.css` — the visual theme
- `src/CoachTools.tsx` — focus notes, practice log, checklist
- `src/auth.tsx` — sign in, sign up, password reset
- `src/ballotApi.ts` — saving and loading ballots
- `src/tournamentApi.ts` — tournaments, join requests, entries, and schedules in the database
- `src/Access.tsx` — creating a tournament, asking to join, and the director's approval list
- `src/JudgeRooms.tsx` — a judge's assigned rooms
- `src/results.ts`, `src/Results.tsx` — breaks, finals, and team points following the NSAA manual
- `src/PastBallots.tsx` — past-tournament ballots for students and coaches
- `src/EntryImport.tsx` — adding students by hand or from a roster file
- `src/legal.tsx` — privacy, terms, cookies, refund and accessibility pages (drafts) and the footer; business details go in `BUSINESS` at the top
- `src/Payments.tsx` — tournament fees (default $7.50 an entry and $75 per judge a school doesn't bring), each school's invoice, Orator's size-based fee (placeholder tiers in `ORATOR_PRICING` in `src/tournament.ts`), and the payment simulator (no real money moves)
- `supabase/` — database tables and access rules
- `src/store.tsx` — demo data shared across roles
