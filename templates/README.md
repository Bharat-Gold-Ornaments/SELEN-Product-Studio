# Templates

Seed / local-dev fallback copies of the 7 prompt templates managed in-app
(Hero, Lifestyle, Closeup, Title, Description, SEO, Tags).

Built starting **Milestone 3 (Template Manager)**. At runtime in production,
the app reads and writes the live templates from Google Drive — Vercel's
filesystem is read-only outside of build time, so these local files can only
ever serve as seed defaults for a fresh environment, never as the
source of truth.
