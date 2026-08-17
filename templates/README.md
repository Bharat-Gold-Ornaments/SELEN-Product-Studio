# Templates

Seed / local-dev fallback copies of the 19 prompt templates managed in-app:
Hero/Lifestyle/Closeup — one independently-editable prompt per product type
(Earrings, Ring, Pendant, Necklace, Bracelet), named `{productType}-{category}.txt`
— plus the shared Title, Description, SEO, and Tags copy prompts.

Built starting **Milestone 3 (Template Manager)**. At runtime in production,
the app reads and writes the live templates from Google Drive — Vercel's
filesystem is read-only outside of build time, so these local files can only
ever serve as seed defaults for a fresh environment, never as the
source of truth.
