# ObjectForge MVP

ObjectForge is a hackathon prototype that turns short object capture videos into browser-viewable point clouds, GLB assets, capture footprints, and optional Gaussian splats.

The current implementation attempts a real VGGT point-cloud path first, then falls back to a deterministic MVP point cloud if model loading or inference fails:

```text
video upload
-> Clerk-authenticated frontend uploads an object capture
-> Rust API records reconstruction state in Postgres and stores the upload locally for handoff
-> Rust API calls Modal
-> Modal stores files in a Modal Volume, extracts keyframes, and runs VGGT reconstruction
-> frontend displays point cloud, capture footprint, previews, assets, and reconstruction status
```

The Modal worker is intentionally left compatible with the original scene contract. Product language and UI now focus on object reconstruction, while the backend still stores `SceneResult` rows and asset keys.

## Repository Layout

```text
apps/web/             Next.js frontend
apps/api/             Rust Axum API
modal/                Modal Python worker
shared/scene-schema/  Shared SceneResult JSON schema
docs/                 Architecture, setup, and implementation docs
docker-compose.yml    Local Postgres + MinIO
```

Start with these docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Local Setup](docs/LOCAL_SETUP.md)
- [Modal Setup](docs/MODAL_SETUP.md)
- [API Reference](docs/API.md)
- [Frontend Guide](docs/FRONTEND.md)
- [Modal Pipeline](docs/MODAL_PIPELINE.md)

## Quick Start

Install frontend dependencies:

```bash
pnpm install
```

Start local Postgres:

```bash
docker compose up -d postgres
```

Create env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp modal/.env.example modal/.env
```

Add Clerk keys to `apps/web/.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Run the frontend:

```bash
pnpm dev:web
```

Run the Rust API:

```bash
cd apps/api
cargo run
```

Deploy or serve Modal:

```bash
cd modal
modal deploy modal_app.py
```

Then set the printed Modal endpoint URLs as `MODAL_PROCESS_URL`, `MODAL_SPLAT_URL`, and `MODAL_ASSET_URL` in `apps/api/.env`.

## Current Demo Behavior

The app can:

- show a polished landing page and Clerk-gated capture workspace,
- upload an object capture video through the frontend,
- use Modal Volume storage by default, with S3/R2 still available later,
- create and update scene status in Postgres,
- enforce bearer-token auth and strict in-memory API rate limits,
- call a Modal web endpoint,
- generate and serve a VGGT point cloud, GLB, depth/confidence previews, capture footprint, cameras, hotspots, and processing log,
- render the reconstruction in a Three.js point-cloud viewer,
- request optional splat generation from the separate Modal endpoint.

The current Modal worker attempts VGGT first. If the model package, checkpoint access, GPU runtime, or inference fails, it logs a warning and uses the MVP fallback point cloud so the rest of the demo still works.

Expect large files. Short phone videos are often 50-500 MB, point clouds can be 10-200 MB, and Gaussian splats can grow to hundreds of MB. Modal Volume is fine for early demos; R2/S3 is better for longer-term storage and distribution.

## Verification Commands

```bash
pnpm typecheck:web
pnpm build:web
cd apps/api && cargo check
cd ../../modal && python3 -m py_compile modal_app.py
```
