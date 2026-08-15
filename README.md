# SELEN Product Studio

Internal tool for the SELEN jewellery team: upload product photos, generate
on-brand imagery and copy with AI, review and edit everything, then publish
straight to Shopify. Not customer-facing.

## Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Data fetching**: TanStack Query
- **Forms**: React Hook Form + Zod
- **UI primitives**: hand-built shadcn/ui-style components (Radix + CVA)
- **Image generation**: Leonardo API
- **Copy generation**: Anthropic Claude API
- **Storage / source of truth**: Google Drive (files) + Google Sheets (metadata) — **no database**
- **Publishing**: n8n Cloud webhook → Shopify Admin GraphQL API
- **Deployment**: Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in every value, see comments in the file
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/login`. Sign in
with the `ADMIN_PASSWORD` you set in `.env.local`.

## Project structure

```
src/
  app/
    (app)/            authenticated shell: Dashboard, Products, Create Product, Templates, Settings
    api/auth/         login/logout route handlers (password + signed session cookie)
    login/            public sign-in page
  components/
    layout/           Sidebar, Header, PageShell
    ui/               hand-built shadcn/ui-style primitives
  lib/                auth, env access, shared constants, cn() helper
  services/           Leonardo, Google Drive, Google Sheets, Shopify, n8n, Anthropic — one file each, backend-only
  types/               shared TypeScript types (ProductType, ProductRecord, ...)
  hooks/              reusable React Query hooks
templates/            local seed copies of the 8 prompt templates (Google Drive is the real source of truth)
```

## Authentication

Single admin user, password only, no registration. `/api/auth/login` checks
the submitted password against `ADMIN_PASSWORD` and, if correct, sets an
httpOnly, signed JWT session cookie (`SESSION_SECRET`). `middleware.ts`
guards every route except `/login` and the login API.

## Environment variables

See `.env.example` for the full list with descriptions. Each backend service
(`src/services/*`) validates its own required env vars lazily, at call time —
the app always builds and boots even if an integration isn't configured yet;
it fails loudly only when that specific integration is actually used.

## Google Drive setup

The Drive service (`src/services/google-drive.ts`) authenticates as a
service account, not as you — so a product's folder structure is created
and owned by that service account, not your personal Google account.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project (or reuse one), enable the **Google Drive API**, then create a **Service Account** under IAM & Admin.
2. Create a JSON key for that service account and open it. Copy the `client_email` value into `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and the `private_key` value (keep the `\n` escapes as-is) into `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
3. In Google Drive, create the root folder (e.g. "SELEN Products") and **share it with the service account's email** (Editor access) — the service account can't see folders it hasn't been shared with.
4. Copy that folder's ID from its URL (`https://drive.google.com/drive/folders/<this-part>`) into `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

Everything else — category folders, product folders, `originals`/`generated`, `metadata.json` — is created automatically under that root the first time a product is generated.

## Build status

This project is being built milestone by milestone. See the in-app page
shells for what's implemented vs. still to come:

- [x] Milestone 0 — project scaffold, auth, layout shell
- [x] Milestone 1 — dashboard with mock data
- [x] Milestone 2 — dynamic Create Product forms
- [x] Milestone 3 — Template Manager (local file store; Drive-backed persistence is a drop-in swap using the Milestone 4 service, not yet wired up)
- [x] Milestone 4 — Google Drive service
- [x] Milestone 5 — Leonardo image generation service
- [x] Milestone 6 — Review screen
- [ ] Milestone 7 — AI product copy generation
- [ ] Milestone 8 — Google Sheets service
- [ ] Milestone 9 — Finalize screen + Publish workflow
- [ ] Milestone 10 — Settings + error handling/retry polish
