-- Das Trivia: daily leaderboard table.
-- Paste this whole file into the Supabase "SQL Editor" and press Run. It is safe to run once.

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  game       integer     not null,                 -- the game number (one per day)
  player     text        not null,                 -- the name picked before the first question
  score      integer     not null,
  correct    integer     not null,                 -- how many of the 7 were right
  boxes      text        not null,                 -- the green/orange/red boxes
  created_at timestamptz not null default now(),
  unique (game, player)                            -- one score per player per day; the first one counts
);

alter table public.scores enable row level security;

-- Anyone with the site can read the leaderboard and add a score. Nobody can edit or delete one.
create policy "read scores" on public.scores for select using (true);

create policy "add a score" on public.scores for insert with check (
  game between 1 and 100000
  and score between 0 and 1100
  and correct between 0 and 7
  and char_length(player) between 1 and 20
  and char_length(boxes) <= 40
);
