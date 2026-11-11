/*
  LEADERBOARD CONNECTION
  The shared leaderboard is stored in a free Supabase database. Paste the two values from the
  Supabase project here (Project Settings > API). The "anon public" key is meant to be public;
  never put the "service_role" key in this file.
  While these are empty, the game works normally and the leaderboard shows only your own score.
*/
window.DAS_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
};
