# Code Walkthrough

This document explains how the main files fit together.

## Root

### `package.json`

Defines a workspace for `apps/web` and scripts:

- `pnpm dev:web`
- `pnpm build:web`
- `pnpm typecheck:web`

### `docker-compose.yml`

Runs local dependencies:

- Postgres
- MinIO
- one-shot MinIO bucket creation

## Rust API

### `apps/api/Cargo.toml`

Important dependencies:

- `axum`: HTTP server and routing
- `sqlx`: Postgres access
- `aws-sdk-s3`: S3/R2/MinIO storage
- `reqwest`: calls Modal endpoint
- `serde`: JSON types
- `tower-http`: CORS and request tracing

### `apps/api/src/main.rs`

This is currently a single-file API for MVP speed.

Key structs:

- `AppState`: shared database, S3 client, HTTP client, and config.
- `AppConfig`: environment-derived runtime config.
- `SceneResult`: API response sent to the frontend.
- `SceneAssets`: browser-facing asset URLs.
- `ModalSceneResult`: response shape from Modal.
- `ModalAssetKeys`: raw S3/R2 keys returned by Modal.

Startup flow:

1. load `.env`;
2. connect to Postgres;
3. create the `scenes` table if needed;
4. build the S3 client;
5. mount API routes;
6. start Axum.

Route handlers:

- `create_scene`: accepts upload, writes video to S3/R2, inserts scene row.
- `get_scene`: returns current scene state.
- `process_scene`: calls Modal and stores returned asset keys.
- `get_asset`: reads generated asset from S3/R2 and streams it to the browser.

## Frontend

### `apps/web/app/page.tsx`

Main upload page.

It manages:

- selected upload,
- upload request,
- processing request,
- polling while scene status is `processing`,
- embedded viewer preview.

### `apps/web/app/viewer/[sceneId]/page.tsx`

Full scene viewer page.

It:

- reads `sceneId` from route params,
- polls the API,
- displays viewer, floorplan, status, and info panels.

### `apps/web/components/RoomViewer.tsx`

Top-level viewer switch.

It chooses:

- `SplatViewer` if splat mode and splat URL exist,
- `PointCloudViewer` otherwise.

It also fetches hotspots and handles camera reset.

### `apps/web/components/PointCloudViewer.tsx`

Three.js point-cloud renderer.

It uses:

- `Canvas` from React Three Fiber,
- `PLYLoader` from Three,
- `OrbitControls` from Drei.

If a `.ply` URL is unavailable, it renders a procedural placeholder room.

### `apps/web/lib/api.ts`

Frontend API client. This is the only place components directly call the Rust API.

## Modal

### `modal/modal_app.py`

Modal web endpoint and processing pipeline.

Important functions:

- `process_scene`: orchestrates the full worker job.
- `extract_keyframes`: OpenCV frame sampling/filtering.
- `generate_mvp_pointcloud`: creates MVP `.ply`.
- `generate_floorplan`: creates fallback floorplan assets.
- `generate_cameras`: creates simple camera path metadata.
- `generate_hotspots`: creates navigation points.
- `run_splatfacto`: optional future path.
- `upload_asset`: writes outputs back to S3/R2.

## Shared Schema

### `shared/scene-schema/scene-result.schema.json`

Documents the shared API response contract. Keep this in sync with:

- Rust `SceneResult`
- TypeScript `SceneResult`
- Modal response shape
