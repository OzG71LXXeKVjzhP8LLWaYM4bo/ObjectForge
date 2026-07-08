# API Reference

The Rust API lives in `apps/api`.

## Environment

Required variables:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/roomfly
API_BIND_ADDR=127.0.0.1:8080
API_PUBLIC_URL=http://localhost:8080
WEB_ORIGIN=http://localhost:3000,http://localhost:3001
S3_BUCKET=roomfly-mvp
S3_REGION=auto
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
MODAL_PROCESS_URL=https://...
MODAL_SPLAT_URL=https://...
MODAL_ASSET_URL=https://...
REQUIRE_AUTH=true
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_UPLOADS_PER_WINDOW=3
RATE_LIMIT_PROCESS_PER_WINDOW=4
RATE_LIMIT_READS_PER_WINDOW=90
RATE_LIMIT_ASSETS_PER_WINDOW=240
```

Optional:

```env
MODAL_AUTH_TOKEN=
MAX_UPLOAD_BYTES=524288000
RUST_LOG=roomfly_api=info,tower_http=info
```

When `REQUIRE_AUTH=true`, mutating and scene-read endpoints require an `Authorization: Bearer <Clerk token>` header. Asset proxy requests remain URL-loadable for Three.js and images, but are still rate limited.

## Database

The API creates this table on startup:

```sql
create table if not exists scenes (
  id uuid primary key,
  status text not null,
  input_video_key text not null,
  output_prefix text not null,
  visual_mode text null,
  assets jsonb not null default '{}',
  warnings jsonb not null default '[]',
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Endpoints

### `GET /healthz`

Returns:

```text
ok
```

### `POST /api/scenes`

Creates a reconstruction record and uploads the raw object capture video.

Request:

```text
multipart/form-data
field: video
```

Response:

```json
{
  "sceneId": "uuid",
  "status": "uploaded",
  "assets": {},
  "warnings": []
}
```

Important behavior:

- Creates a UUID scene ID.
- Uploads the video to S3/R2.
- Inserts a Postgres scene row.
- Does not automatically run Modal; the frontend separately calls `process`.

### `GET /api/scenes/{scene_id}`

Returns the current scene state.

Response:

```json
{
  "sceneId": "uuid",
  "status": "done",
  "visualMode": "pointcloud",
  "assets": {
    "pointcloudUrl": "http://localhost:8080/api/scenes/uuid/assets/pointcloud/room_pointcloud.ply",
    "floorplanSvgUrl": "http://localhost:8080/api/scenes/uuid/assets/floorplan/floorplan.svg",
    "depthPreviewUrl": "http://localhost:8080/api/scenes/uuid/assets/previews/depth_00.png",
    "confidencePreviewUrl": "http://localhost:8080/api/scenes/uuid/assets/previews/confidence_00.png"
  },
  "warnings": []
}
```

### `POST /api/scenes/{scene_id}/process`

Starts Modal processing.

Behavior:

- Reads `input_video_key` and `output_prefix` from Postgres.
- Sets status to `processing`.
- Calls `MODAL_PROCESS_URL` with JSON.
- Stores returned Modal asset keys.
- Returns the updated `SceneResult`.

This endpoint is currently synchronous from the Rust API perspective: it waits for Modal to return. For larger reconstruction jobs, change this to enqueue work and poll a job handle.

### `POST /api/scenes/{scene_id}/splat`

Generates a browser-viewable Gaussian splat for a completed scene.

Behavior:

- Requires the scene status to be `done`.
- Calls `MODAL_SPLAT_URL` with the same storage fields used by `/process`.
- Merges returned `splatKey` into existing scene assets.
- Sets `visualMode` to `splat` when generation succeeds.
- Keeps the point-cloud scene usable and appends a warning when splat generation fails.

### `GET /api/scenes/{scene_id}/assets/{asset_name}`

Proxies a generated asset from S3/R2.

Examples:

```text
GET /api/scenes/{scene_id}/assets/pointcloud/room_pointcloud.ply
GET /api/scenes/{scene_id}/assets/floorplan/floorplan.svg
GET /api/scenes/{scene_id}/assets/metadata/hotspots.json
```

The browser never receives S3 credentials.

## Error Shape

Errors return:

```json
{
  "error": "message"
}
```

Typical causes:

- missing `video` form field,
- missing bearer token when auth is required,
- rate limit exhaustion,
- upload larger than `MAX_UPLOAD_BYTES`,
- missing scene ID,
- S3/R2 credential or bucket error,
- Modal endpoint failure.
