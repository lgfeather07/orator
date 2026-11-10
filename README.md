# Orator — Speech Tournament Platform

Tournament software for high school speech: e-ballots that follow the NSAA ballot, judge and speaker check-in, coach tools, and student feedback.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Without any configuration the app runs as a demo with sample data.

## Turn on real accounts (Supabase)

1. Create a project at supabase.com.
2. In the Supabase dashboard, open SQL Editor and run `supabase/schema.sql`, then `supabase/ballots.sql`.
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable (anon) key from Project Settings → API.
4. Restart `npm run dev`.

## Layout

- `src/App.tsx` — the four role workspaces (student, judge, coach, director)
- `src/JudgeBallot.tsx` — the e-ballot
- `src/ballots.ts` — NSAA ballot criteria, time limits, and disqualification grounds for 11 events
- `src/DirectorSetup.tsx` — tournament setup and check-in board
- `src/CoachTools.tsx` — focus notes, practice log, checklist
- `src/auth.tsx` — sign in, sign up, password reset
- `src/ballotApi.ts` — saving and loading ballots
- `supabase/` — database tables and access rules
- `src/store.tsx` — demo data shared across roles
