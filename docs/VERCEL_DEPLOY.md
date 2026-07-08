# Vercel Deploy

This repo deploys as two Vercel projects:

- `apps/api`: Rust Axum API using Vercel's Rust runtime.
- `apps/web`: Next.js frontend.

The Modal worker is still deployed separately with `modal deploy modal_app.py`.

## 1. Deploy Modal

From the repo root:

```bash
cd modal
modal deploy modal_app.py
```

Keep the printed endpoint URLs for:

- `MODAL_PROCESS_URL`
- `MODAL_SPLAT_URL`
- `MODAL_ASSET_URL`

## 2. Create Production Postgres

Use a hosted Postgres database reachable from Vercel, for example Vercel Postgres/Neon/Supabase.

Copy the production connection string as `DATABASE_URL`.

## 3. Deploy the Rust API Project

Create a Vercel project with:

- Root Directory: `apps/api`
- Framework Preset: Other

Required environment variables:

```env
DATABASE_URL=postgres://...
API_PUBLIC_URL=https://<api-project>.vercel.app
WEB_ORIGIN=https://<web-project>.vercel.app
STORAGE_BACKEND=modal
LOCAL_DATA_DIR=/tmp/roomfly-data
MODAL_PROCESS_URL=https://<workspace>--roomfly-mvp-process-scene.modal.run
MODAL_SPLAT_URL=https://<workspace>--roomfly-mvp-generate-splat.modal.run
MODAL_ASSET_URL=https://<workspace>--roomfly-mvp-get-asset.modal.run
MODAL_AUTH_TOKEN=
REQUIRE_AUTH=true
MAX_UPLOAD_BYTES=157286400
RUST_LOG=roomfly_api=info,tower_http=info
```

If you later use S3/R2 storage, also set:

```env
S3_BUCKET=
S3_REGION=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

Deploy:

```bash
cd apps/api
vercel deploy --prod
```

After deployment, open:

```text
https://<api-project>.vercel.app/healthz
```

## 4. Deploy the Web Project

Create a second Vercel project with:

- Root Directory: `apps/web`
- Framework Preset: Next.js

Required environment variables:

```env
NEXT_PUBLIC_API_BASE_URL=https://<api-project>.vercel.app
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
```

Deploy:

```bash
cd apps/web
vercel deploy --prod
```

After the web project URL is final, update the API project's `WEB_ORIGIN` to that URL and redeploy the API.

## Notes

The first Rust deployment can take several minutes because Vercel compiles dependencies from a clean cache. Later builds should be faster.

Vercel's Rust runtime is serverless. The API can use `/tmp` for short-lived upload handoff, but it cannot rely on persistent local disk.

The current `/api/scenes/:scene_id/process` endpoint waits for Modal to finish. If Modal processing takes longer than the Vercel function duration available on your plan, move processing to an async job pattern: mark the scene as `processing`, call Modal asynchronously, and update Postgres from a callback or polling worker.
