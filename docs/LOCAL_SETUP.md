# Local Setup

## Prerequisites

Install:

- Node.js 22+
- Rust 1.95+
- Docker
- Python 3.10+
- Modal CLI

## Environment Files

From the repo root:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp modal/.env.example modal/.env
```

## Local Services

Start Postgres:

```bash
docker compose up -d postgres
```

For the default `STORAGE_BACKEND=modal` flow, Postgres is the only local service you need. Modal stores generated scene files in a Modal Volume.

If you switch to `STORAGE_BACKEND=s3`, you can also start MinIO:

```bash
docker compose up -d minio create-bucket
```

That creates:

- Postgres on `localhost:5432`
- MinIO S3 API on `localhost:9000`
- MinIO console on `localhost:9001`
- bucket `roomfly-mvp`

Default MinIO credentials:

```text
username: minioadmin
password: minioadmin
```

## API Configuration

`apps/api/.env` defaults to local Docker services:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/roomfly
API_BIND_ADDR=127.0.0.1:8080
API_PUBLIC_URL=http://localhost:8080
WEB_ORIGIN=http://localhost:3000,http://localhost:3001

STORAGE_BACKEND=modal
LOCAL_DATA_DIR=../../data

S3_BUCKET=roomfly-mvp
S3_REGION=auto
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin

MODAL_PROCESS_URL=https://<workspace>--roomfly-mvp-process-scene.modal.run
MODAL_SPLAT_URL=https://<workspace>--roomfly-mvp-generate-splat.modal.run
MODAL_ASSET_URL=https://<workspace>--roomfly-mvp-get-asset.modal.run
MODAL_AUTH_TOKEN=
MAX_UPLOAD_BYTES=157286400
```

You must replace the Modal URLs after deploying or serving Modal.

## Frontend Configuration

`apps/web/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

## Run Everything

Terminal 1:

```bash
cd /home/user/Documents/Github/roomfly-mvp
docker compose up -d postgres
```

Terminal 2:

```bash
cd /home/user/Documents/Github/roomfly-mvp/apps/api
cargo run
```

Terminal 3:

```bash
cd /home/user/Documents/Github/roomfly-mvp
pnpm dev:web
```

Open:

```text
http://localhost:3000
```

## Validation

```bash
pnpm typecheck:web
pnpm build:web
cd apps/api && cargo check
cd ../../modal && python3 -m py_compile modal_app.py
```
