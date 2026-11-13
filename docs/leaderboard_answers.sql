-- Das Trivia: save each player's answers with their score, so tapping a name on a leaderboard shows them.
-- Paste this whole file into the Supabase "SQL Editor" and press Run. It is safe to run more than once.

alter table public.scores add column if not exists answers jsonb;

-- The rule for adding a score, now also limiting the size of the saved answers.
drop policy if exists "add a score" on public.scores;
create policy "add a score" on public.scores for insert with check (
  game between 1 and 100000
  and score between 0 and 1100
  and correct between 0 and 7
  and char_length(player) between 1 and 20
  and char_length(boxes) <= 40
  and (answers is null or (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) <= 10
                           and length(answers::text) <= 8000))
);
