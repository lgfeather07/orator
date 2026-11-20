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
2. In the Supabase dashboard, open SQL Editor and run these files in this order: `supabase/schema.sql`, `supabase/ballots.sql`, `supabase/tournaments.sql`, `supabase/fixes.sql` (saved director settings, linking student accounts, speech titles), `supabase/calendar.sql`, `supabase/public_results.sql`, `supabase/team_compare.sql`, `supabase/semifinals.sql`, `supabase/judges.sql` (coach-entered judges), `supabase/paper_ballots.sql` (tab-room paper ballots), `supabase/alerts.sql` (alerts). Every file is safe to run again. **If you re-run any file, re-run every file after it in this list.**
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable (anon) key from Project Settings → API.
4. Restart `npm run dev`.
5. In Supabase, open **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Judge sign-in links need it (see below); without it a judge link says “Guest judge sign-in is turned off”. Nothing else changes: anonymous users can only claim a judge seat.

**Updating an existing project:** after pulling new changes, run `supabase/tournaments.sql` again in the SQL Editor. It is safe to re-run and adds new columns (the latest: issue reports, judge check-in, practice goals, director updates to coaches and judges, entries open/closed, the judges-see-a-rating setting, varsity/novice divisions, and clean-judge conflicts) without touching existing data. Then run `supabase/public_results.sql` (also safe to re-run); it must come after `tournaments.sql`. Then `supabase/team_compare.sql` (safe to re-run, after `public_results.sql`): it stores each published tournament's team point scale so Compare teams can show team points by event. Until it is run, publishing still works and Compare teams works the scale out from the published totals.

Then run `supabase/calendar.sql` again too, every time, after `tournaments.sql`: it adds the public tournament calendar (listing, city, ISO date, registration deadline, notes for coaches, saved fees) and the director's "Approve coaches automatically" setting, and it replaces the membership trigger that `tournaments.sql` defines. Tournaments created before it stay off the calendar until their director lists them.

Run `supabase/paper_ballots.sql` last, and again whenever you re-run `ballots.sql` or `tournaments.sql`: it replaces three ballot trigger functions those files define (`stamp_ballot`, `check_ballot_submission`, `check_ballot_room`), keeping every rule and adding a pass for paper entry. Until it is run, the Ballots tab still lists rooms but saving a paper ballot asks for the update.

Run `supabase/alerts.sql` again too after any of the files above: it must come last.

## Text and email alerts

Students, judges, and coaches choose under **Alerts** in their menu whether Orator may text them (US mobile number, with consent: “Message and data rates may apply. Reply STOP to opt out.”) or email them (their account email), and which alerts they want: their rooms for each round (students), a ballot or room assignment (judges), schedule changes (everyone), and entries closed or opened (coaches). Directors get an **Alerts** tab with “Send room alerts for Round N” buttons (rounds have no start button, so the director sends each round just before it starts), queued/sent/failed counts, the latest errors, and how many members opted in (counts only, never numbers or emails).

How it works:

- `supabase/alerts.sql` adds `notification_settings` (each person reads and changes only their own row) and the `notifications` outbox (recipients read their own rows; the director reads their tournament's rows; nobody writes them directly). Messages are written in Postgres from the schedule, e.g. `Orator: Round 2 Informative - Room 104 at 9:30 AM. You speak 3rd.`, so a director can't type a message or choose recipients. Only approved members of that tournament who opted in get a row, once per channel; pressing a button twice queues nothing new (a changed room does queue the new message).
- Alerts are queued by `queue_round_alerts(tournament, round)` (director only) and automatically when the director publishes the schedule, swaps a judge after publishing (or adds finals), or opens or closes entries.
- Everything also appears in the in-app “Schedule updated” banner, so nothing depends on texts being set up. In the demo, the settings form saves to the browser and the director's Alerts tab previews exactly which texts and emails a round would send to the sample people; nothing is sent.
- Messages link to `https://orator-1rab.vercel.app`. To use another address: `alter database postgres set app.site_url = 'https://your-site';`

### Delivery (Supabase Edge Function)

`supabase/functions/send-notifications` sends queued rows with Twilio (texts) and Resend (email) and marks each sent or failed. It claims rows with `FOR UPDATE SKIP LOCKED`, so it is safe to run every minute even if runs overlap; a provider outage or rate limit is retried (at most 3 tries). A channel with missing secrets is skipped and its rows stay queued; the function's JSON response names the missing secrets, and the director's Alerts tab warns when alerts have waited more than 5 minutes.

1. Make accounts: [Twilio](https://www.twilio.com) (buy a number; US texting to the public needs A2P 10DLC brand and campaign registration, which takes days, or use a toll-free number with toll-free verification) and [Resend](https://resend.com) (verify your sending domain).
2. Install the Supabase CLI, then `supabase link --project-ref YOUR-PROJECT-REF`.
3. Deploy: `supabase functions deploy send-notifications`
4. Set secrets (never commit these):
   ```bash
   supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+14025550000 \
     RESEND_API_KEY=re_... NOTIFY_FROM_EMAIL="Orator <alerts@your-domain.com>" ORATOR_SITE_URL=https://orator-1rab.vercel.app
   ```
   Leave out a provider's secrets to send only by the other one.
5. Run it every minute with pg_cron and pg_net (Database → Extensions → enable both). The SQL is at the end of `supabase/alerts.sql`, commented out: it stores the project URL and service role key in Vault and schedules a POST to `/functions/v1/send-notifications`. The function only accepts calls carrying the service role key.
6. Test once by hand: `curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/send-notifications -H "Authorization: Bearer YOUR-SERVICE-ROLE-KEY"` returns `{ sent, failed, retrying, claimed, skipped }`.

**Costs (approximate, check current prices):** Twilio US texts are about $0.008 to $0.01 per 160-character segment plus carrier fees, and about $1 to $2 a month per number, plus 10DLC registration fees. Messages are kept under 160 plain characters (no curly quotes or emoji, which halve the limit), so each is one segment. A 300-student, 3-round tournament where half the students opt in costs roughly $5 to $10 in texts. Resend's free tier covers 3,000 emails a month. pg_cron and Edge Functions fit within Supabase's free tier for this volume.

`npm run test:alerts` runs the unit tests for phone numbers, message wording, the demo preview, and the Edge Function's message building and claim-and-send loop (with fake providers; it never reaches Twilio or Resend).

Run `supabase/judges.sql` after `semifinals.sql` (see the order above); re-running `tournaments.sql` means re-running `judges.sql` and everything after it, or its private helpers would be re-granted.

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

## Tournaments without a final round

Early-season meets often run three preliminary rounds and stop. In Setup → Details, set **Final round** to “No finals: place from the preliminary rounds” and choose how many places to announce (top 3 to top 10, default 6). Placings then come straight from the preliminary standings (lowest cumulative rank, with the NSAA tiebreaks), each event is placed as soon as all its rooms are in, and the top places earn team points on the tournament's scale. Speakers still tied after every tiebreak share the place and split the points for the places they cover. Finals, semifinals, the cut preview and finals judge preferences are hidden for these tournaments. `npm run test:prelims` covers the rules.

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
- `src/PaperBallots.tsx`, `src/paperBallots.ts`, `src/paperBallotsApi.ts` — the director's Ballots tab: every room (round, event, room, judge) marked e-ballot in, paper entered, or missing, with filters and search, and keyboard-first entry of paper ballots (rank, optional points 35–50 or five section marks, time, no-show, time penalty; Enter moves to the next box). It checks ranks for typos before saving (no ties, ranks 1 to the number who performed, points 35–50, a higher rank never with fewer points unless the lower speaker had a time penalty, optional double entry of every rank). Saved paper ballots count in breaks, finals and placings exactly like e-ballots. Signed in, they go through `enter_paper_ballot()` (`supabase/paper_ballots.sql`), which checks the caller directs the tournament, checks the ballot again, stores it as a submitted ballot attributed to the room's judge with `source = 'paper'` and who entered it, and logs every entry, correction, and e-ballot override in `paper_ballot_log`. Replacing a judge's submitted e-ballot needs an explicit override. Coaches and (after release) students see paper ballots like any other; they have no comments or private notes. Ranks entered without points count 0 rating points (the last tie-break). In the demo, paper ballots are kept in the browser. `npm run test:paper` runs the entry checks' tests.
- `src/Semifinals.tsx`, `src/semis.ts` (and the semifinal rules at the end of `src/results.ts`) — optional semifinals for big fields. In the cut preview (or the cut table's "Rounds" column) the director chooses, per contest, "Final only" (the default) or "Semifinals, then final"; semifinals are suggested for fields over 30 but never turned on automatically, and need at least 10 entries. The top 10–16 after prelims (default 12) are snake-seeded into two rooms (1, 4, 5, 8… in A; 2, 3, 6, 7… in B), swapping equal seeds to split teammates, with 1–3 judges a room (default 1) chosen like finals judges: by preference, clean judges first, never a judge who heard the event in prelims or has a school (or known-school) conflict in that room, and never two rooms in the same round. Each room ranks on cumulative rank across its judges, then reciprocals, rating points and prelim place; the top 2–4 of each room (default 3) make the final, which then runs as before with fresh judges (not that event's semifinal judges). Semifinalists who miss the final place after the finalists (7th–12th) by their semifinal, and earn team points only where the scale reaches. Semifinals are round `rounds + 1` with `stage: 'semi'` on the section; that contest's final is `rounds + 2` (other finals stay `rounds + 1`, with no stage, so older data reads unchanged). The plan per contest is saved with the tournament settings (`semisByContest`). The Results tab shows the semifinal rooms, ballots in, who advanced and the next step, with "Fill in sample semifinals" in the demo; judges see "Semifinal" rooms and ballots in their list. "Create all" only builds finals or semifinals for contests whose preliminary rooms all have results. `npm run test:semis` runs the semifinal rules' tests (`tests/semis.test.mjs`).
- `src/PastBallots.tsx` — past-tournament ballots for students and coaches
- `src/EntryImport.tsx` — adding students by hand or from a roster file
- `src/legal.tsx` — privacy, terms, cookies, refund and accessibility pages (drafts) and the footer; business details go in `BUSINESS` at the top
- `src/Payments.tsx` — tournament fees (default $7 an entry and $75 per judge a school doesn't bring), each school's invoice, Orator's size-based fee (placeholder tiers in `ORATOR_PRICING` in `src/tournament.ts`), and the payment simulator (no real money moves)
- `src/PublicResults.tsx`, `src/publicResultsApi.ts`, `src/PublishResults.tsx` — public results pages (`#/results`, `#/results/<id>`, `#/school/<school>`, `#/student/<school>/<student>`), open without an account, and the director's Publish results panel. Only final placings (place, student, school) and team points are public; ballots, comments, and preliminary rankings stay private. The demo shows a fictional sample season.
- `src/TeamCompare.tsx`, `src/teamCompare.ts`, `src/teamCompare.css` — Compare teams: one school against another at the tournaments both attended (`#/compare/<school>/<rival>`, open without an account, linked from each school's results page; also a "Compare teams" tab for coaches and students). Pick your team and a rival (searchable, with the schools you meet most often suggested), a season and a tournament; see who finished ahead on team points, total and average team points, finalists and champions, a tournament-by-tournament chart, and "Where they score": team points by event and division as a diverging bar per event with a plain-language takeaway. Students also see the team points they earned themselves. Every chart has a table view. Only published final placings and team points are used; per-event points come from each finalist's place and the tournament's team point scale (`supabase/team_compare.sql`; NSAA 20-18-16-14-12-10 when it wasn't published, checked against the published totals). In the demo, Wrenfield High vs Kestrel Prep is the default; the Kestrel Prep Classic counts novice finals and the Wrenfield Invitational uses its own scale.
- `supabase/` — database tables and access rules (`public_results.sql` holds the published-results tables, run after `tournaments.sql`; `semifinals.sql` adds semifinal rooms; `team_compare.sql` adds the published team point scale, run after `public_results.sql`)
- `src/store.tsx` — demo data shared across roles
- `src/Alerts.tsx`, `src/alerts.ts`, `src/alertsApi.ts`, `src/alerts.css` — text and email alert settings, the director's Alerts tab and round buttons, message wording, and the demo preview
- `supabase/alerts.sql`, `supabase/functions/send-notifications/` — the alerts outbox and the Edge Function that delivers it
