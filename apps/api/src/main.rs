use std::{
    collections::HashMap,
    env, fs,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::Context;
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::{
    config::{Builder as S3ConfigBuilder, Region},
    primitives::ByteStream,
    Client as S3Client,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use thiserror::Error;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    s3: Option<S3Client>,
    http: HttpClient,
    config: Arc<AppConfig>,
    rate_limiter: Arc<Mutex<RateLimiter>>,
}

#[derive(Clone)]
struct AppConfig {
    api_bind_addr: SocketAddr,
    api_public_url: String,
    web_origins: Vec<String>,
    storage_backend: StorageBackend,
    local_data_dir: PathBuf,
    s3_bucket: Option<String>,
    modal_process_url: String,
    modal_splat_url: Option<String>,
    modal_asset_url: Option<String>,
    modal_auth_token: Option<String>,
    require_auth: bool,
    rate_limit_window: Duration,
    upload_limit: usize,
    process_limit: usize,
    read_limit: usize,
    asset_limit: usize,
    max_upload_bytes: usize,
}

#[derive(Debug, Clone, Copy)]
enum RateClass {
    Upload,
    Process,
    Read,
    Asset,
}

#[derive(Debug)]
struct RateLimit {
    retry_after: u64,
}

#[derive(Default)]
struct RateLimiter {
    buckets: HashMap<String, RateBucket>,
}

struct RateBucket {
    started_at: Instant,
    count: usize,
}

impl RateLimiter {
    fn check(&mut self, key: String, limit: usize, window: Duration) -> Result<(), RateLimit> {
        let now = Instant::now();
        let bucket = self.buckets.entry(key).or_insert(RateBucket {
            started_at: now,
            count: 0,
        });

        if now.duration_since(bucket.started_at) >= window {
            bucket.started_at = now;
            bucket.count = 0;
        }

        if bucket.count >= limit {
            let elapsed = now.duration_since(bucket.started_at);
            let retry_after = window.saturating_sub(elapsed).as_secs().max(1);
            return Err(RateLimit { retry_after });
        }

        bucket.count += 1;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StorageBackend {
    S3,
    Modal,
}

impl StorageBackend {
    fn from_env() -> Self {
        match env::var("STORAGE_BACKEND")
            .unwrap_or_else(|_| "s3".to_string())
            .to_lowercase()
            .as_str()
        {
            "modal" => Self::Modal,
            _ => Self::S3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SceneResult {
    scene_id: String,
    status: SceneStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    visual_mode: Option<VisualMode>,
    assets: SceneAssets,
    warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "text")]
enum SceneStatus {
    Uploaded,
    Processing,
    Done,
    Failed,
}

impl SceneStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Uploaded => "uploaded",
            Self::Processing => "processing",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum VisualMode {
    Splat,
    Pointcloud,
}

impl VisualMode {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "splat" => Some(Self::Splat),
            "pointcloud" => Some(Self::Pointcloud),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Splat => "splat",
            Self::Pointcloud => "pointcloud",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SceneAssets {
    #[serde(skip_serializing_if = "Option::is_none")]
    pointcloud_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pointcloud_glb_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    splat_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw_splat_ply_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    floorplan_png_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    floorplan_svg_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    floorplan_json_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cameras_json_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hotspots_json_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previews_json_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    depth_preview_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    confidence_preview_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    processing_log_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModalSceneResult {
    scene_id: String,
    status: SceneStatus,
    visual_mode: Option<VisualMode>,
    assets: ModalAssetKeys,
    warnings: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModalAssetKeys {
    pointcloud_key: Option<String>,
    pointcloud_glb_key: Option<String>,
    splat_key: Option<String>,
    raw_splat_ply_key: Option<String>,
    floorplan_png_key: Option<String>,
    floorplan_svg_key: Option<String>,
    floorplan_json_key: Option<String>,
    cameras_json_key: Option<String>,
    hotspots_json_key: Option<String>,
    previews_json_key: Option<String>,
    depth_preview_key: Option<String>,
    confidence_preview_key: Option<String>,
    processing_log_key: Option<String>,
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("authentication required")]
    Unauthorized,
    #[error("rate limit exceeded; retry after {0} seconds")]
    RateLimited(u64),
    #[error("scene not found")]
    NotFound,
    #[error("storage error: {0}")]
    Storage(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("upstream error: {0}")]
    Upstream(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Storage(_) | Self::Database(_) | Self::Upstream(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let body = Json(json!({
            "error": self.to_string()
        }));

        (status, body).into_response()
    }
}

fn enforce_request(
    state: &AppState,
    headers: &HeaderMap,
    class: RateClass,
    auth_required_for_endpoint: bool,
) -> Result<(), ApiError> {
    let identity = request_identity(headers);
    if state.config.require_auth && auth_required_for_endpoint && identity.auth_subject.is_none() {
        return Err(ApiError::Unauthorized);
    }

    let limit = match class {
        RateClass::Upload => state.config.upload_limit,
        RateClass::Process => state.config.process_limit,
        RateClass::Read => state.config.read_limit,
        RateClass::Asset => state.config.asset_limit,
    };

    let key = format!("{}:{:?}:{}", identity.rate_key, class, state.config.rate_limit_window.as_secs());
    let mut limiter = state
        .rate_limiter
        .lock()
        .map_err(|_| ApiError::Storage("rate limiter lock poisoned".to_string()))?;

    limiter
        .check(key, limit, state.config.rate_limit_window)
        .map_err(|err| ApiError::RateLimited(err.retry_after))
}

struct RequestIdentity {
    auth_subject: Option<String>,
    rate_key: String,
}

fn request_identity(headers: &HeaderMap) -> RequestIdentity {
    let auth_subject = bearer_token(headers)
        .and_then(|token| clerk_subject_from_jwt(token).or_else(|| Some(format!("token:{}", token_prefix(token)))));
    let forwarded_for = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let real_ip = headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty());

    let rate_key = auth_subject
        .clone()
        .unwrap_or_else(|| format!("ip:{}", forwarded_for.or(real_ip).unwrap_or("unknown")));

    RequestIdentity {
        auth_subject,
        rate_key,
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn clerk_subject_from_jwt(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: Value = serde_json::from_slice(&decoded).ok()?;
    value
        .get("sub")
        .and_then(Value::as_str)
        .filter(|subject| !subject.is_empty())
        .map(|subject| format!("clerk:{subject}"))
}

fn token_prefix(token: &str) -> String {
    token.chars().take(16).collect()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            env::var("RUST_LOG").unwrap_or_else(|_| "roomfly_api=info,tower_http=info".to_string()),
        )
        .init();

    let config = Arc::new(load_config()?);
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&env::var("DATABASE_URL").context("DATABASE_URL is required")?)
        .await?;
    init_db(&db).await?;

    let s3 = if config.storage_backend == StorageBackend::S3 {
        Some(build_s3_client().await?)
    } else {
        fs::create_dir_all(&config.local_data_dir)?;
        None
    };
    let state = AppState {
        db,
        s3,
        http: HttpClient::new(),
        config: config.clone(),
        rate_limiter: Arc::new(Mutex::new(RateLimiter::default())),
    };

    let cors_origins = config
        .web_origins
        .iter()
        .map(|origin| origin.parse::<HeaderValue>())
        .collect::<Result<Vec<_>, _>>()?;
    let max_upload_bytes = config.max_upload_bytes;
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/scenes", post(create_scene))
        .route("/api/scenes/{scene_id}", get(get_scene))
        .route("/api/scenes/{scene_id}/process", post(process_scene))
        .route("/api/scenes/{scene_id}/splat", post(generate_scene_splat))
        .route("/api/scenes/{scene_id}/assets/{*asset_name}", get(get_asset))
        .layer(DefaultBodyLimit::max(max_upload_bytes))
        .layer(
            CorsLayer::new()
                .allow_origin(cors_origins)
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    info!("listening on {}", config.api_bind_addr);
    let listener = tokio::net::TcpListener::bind(config.api_bind_addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn load_config() -> anyhow::Result<AppConfig> {
    let api_bind_addr = env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()?;

    Ok(AppConfig {
        api_bind_addr,
        api_public_url: env::var("API_PUBLIC_URL").unwrap_or_else(|_| "http://localhost:8080".to_string()),
        web_origins: env::var("WEB_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:3000,http://localhost:3001".to_string())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        storage_backend: StorageBackend::from_env(),
        local_data_dir: env::var("LOCAL_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("../../data")),
        s3_bucket: env::var("S3_BUCKET").ok().filter(|value| !value.is_empty()),
        modal_process_url: env::var("MODAL_PROCESS_URL").context("MODAL_PROCESS_URL is required")?,
        modal_splat_url: env::var("MODAL_SPLAT_URL").ok().filter(|value| !value.is_empty()),
        modal_asset_url: env::var("MODAL_ASSET_URL").ok().filter(|value| !value.is_empty()),
        modal_auth_token: env::var("MODAL_AUTH_TOKEN").ok().filter(|value| !value.is_empty()),
        require_auth: env_bool("REQUIRE_AUTH", true),
        rate_limit_window: Duration::from_secs(env_usize("RATE_LIMIT_WINDOW_SECONDS", 60) as u64),
        upload_limit: env_usize("RATE_LIMIT_UPLOADS_PER_WINDOW", 3),
        process_limit: env_usize("RATE_LIMIT_PROCESS_PER_WINDOW", 4),
        read_limit: env_usize("RATE_LIMIT_READS_PER_WINDOW", 90),
        asset_limit: env_usize("RATE_LIMIT_ASSETS_PER_WINDOW", 240),
        max_upload_bytes: env::var("MAX_UPLOAD_BYTES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(500 * 1024 * 1024),
    })
}

fn env_bool(name: &str, default: bool) -> bool {
    env::var(name)
        .ok()
        .map(|value| matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}

fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

async fn build_s3_client() -> anyhow::Result<S3Client> {
    let access_key = env::var("S3_ACCESS_KEY_ID").context("S3_ACCESS_KEY_ID is required")?;
    let secret_key = env::var("S3_SECRET_ACCESS_KEY").context("S3_SECRET_ACCESS_KEY is required")?;
    let region = env::var("S3_REGION").unwrap_or_else(|_| "auto".to_string());
    let endpoint = env::var("S3_ENDPOINT").ok();

    let credentials = Credentials::new(access_key, secret_key, None, None, "roomfly-env");
    let base_config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(region.clone()))
        .credentials_provider(credentials)
        .load()
        .await;

    let mut builder = S3ConfigBuilder::from(&base_config)
        .region(Region::new(region))
        .force_path_style(true);

    if let Some(endpoint) = endpoint {
        builder = builder.endpoint_url(endpoint);
    }

    Ok(S3Client::from_conf(builder.build()))
}

async fn init_db(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
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
        "#,
    )
    .execute(db)
    .await?;

    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}

async fn create_scene(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<SceneResult>, ApiError> {
    enforce_request(&state, &headers, RateClass::Upload, true)?;

    let mut video_bytes: Option<Vec<u8>> = None;
    let mut file_name = "input.mp4".to_string();

    while let Some(field) = multipart.next_field().await.map_err(|err| ApiError::BadRequest(err.to_string()))? {
        if field.name() != Some("video") {
            continue;
        }

        if let Some(name) = field.file_name() {
            file_name = name.to_string();
        }

        let bytes = field
            .bytes()
            .await
            .map_err(|err| ApiError::BadRequest(err.to_string()))?;
        if bytes.len() > state.config.max_upload_bytes {
            return Err(ApiError::BadRequest("video exceeds MAX_UPLOAD_BYTES".to_string()));
        }
        video_bytes = Some(bytes.to_vec());
    }

    let video_bytes = video_bytes.ok_or_else(|| ApiError::BadRequest("missing video field".to_string()))?;
    let scene_id = Uuid::new_v4();
    let ext = file_name
        .rsplit('.')
        .next()
        .filter(|value| value.len() <= 5)
        .unwrap_or("mp4");
    let input_video_key = format!("scenes/{scene_id}/input/input.{ext}");
    let output_prefix = format!("scenes/{scene_id}/outputs");

    match state.config.storage_backend {
        StorageBackend::S3 => {
            let s3 = state
                .s3
                .as_ref()
                .ok_or_else(|| ApiError::Storage("S3 client is not configured".to_string()))?;
            let bucket = state
                .config
                .s3_bucket
                .as_ref()
                .ok_or_else(|| ApiError::Storage("S3_BUCKET is required for s3 storage".to_string()))?;
            s3.put_object()
                .bucket(bucket)
                .key(&input_video_key)
                .body(ByteStream::from(video_bytes))
                .content_type("video/mp4")
                .send()
                .await
                .map_err(|err| ApiError::Storage(err.to_string()))?;
        }
        StorageBackend::Modal => {
            let local_path = local_input_path(&state.config, scene_id, ext);
            if let Some(parent) = local_path.parent() {
                fs::create_dir_all(parent).map_err(|err| ApiError::Storage(err.to_string()))?;
            }
            fs::write(local_path, video_bytes).map_err(|err| ApiError::Storage(err.to_string()))?;
        }
    }

    sqlx::query(
        r#"
        insert into scenes (id, status, input_video_key, output_prefix)
        values ($1, $2, $3, $4)
        "#,
    )
    .bind(scene_id)
    .bind(SceneStatus::Uploaded.as_str())
    .bind(&input_video_key)
    .bind(&output_prefix)
    .execute(&state.db)
    .await?;

    Ok(Json(scene_result_from_db(&state, scene_id).await?))
}

async fn get_scene(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(scene_id): Path<Uuid>,
) -> Result<Json<SceneResult>, ApiError> {
    enforce_request(&state, &headers, RateClass::Read, true)?;
    Ok(Json(scene_result_from_db(&state, scene_id).await?))
}

async fn process_scene(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(scene_id): Path<Uuid>,
) -> Result<Json<SceneResult>, ApiError> {
    enforce_request(&state, &headers, RateClass::Process, true)?;

    let row = sqlx::query("select input_video_key, output_prefix from scenes where id = $1")
        .bind(scene_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    let input_video_key: String = row.try_get("input_video_key")?;
    let output_prefix: String = row.try_get("output_prefix")?;

    update_scene_status(&state.db, scene_id, SceneStatus::Processing, None, None, None).await?;

    let payload = match state.config.storage_backend {
        StorageBackend::S3 => {
            let bucket = state
                .config
                .s3_bucket
                .as_ref()
                .ok_or_else(|| ApiError::Storage("S3_BUCKET is required for s3 storage".to_string()))?;
            json!({
                "storage_backend": "s3",
                "scene_id": scene_id.to_string(),
                "input_video_key": input_video_key,
                "output_prefix": output_prefix,
                "s3_bucket": bucket
            })
        }
        StorageBackend::Modal => {
            let input_path = local_input_path_from_key(&state.config, scene_id, &input_video_key);
            let bytes = fs::read(input_path).map_err(|err| ApiError::Storage(err.to_string()))?;
            json!({
                "storage_backend": "modal",
                "scene_id": scene_id.to_string(),
                "video_bytes_base64": BASE64.encode(bytes),
                "input_video_key": input_video_key,
                "output_prefix": output_prefix
            })
        }
    };

    let mut request = state.http.post(&state.config.modal_process_url).json(&payload);
    if let Some(token) = &state.config.modal_auth_token {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|err| {
            error!("modal request failed: {err}");
            ApiError::Upstream(err.to_string())
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        update_scene_status(
            &state.db,
            scene_id,
            SceneStatus::Failed,
            None,
            Some(vec![format!("Modal returned HTTP {status}")]),
            Some(body.clone()),
        )
        .await?;
        return Err(ApiError::Upstream(body));
    }

    let modal_result = response
        .json::<ModalSceneResult>()
        .await
        .map_err(|err| ApiError::Upstream(err.to_string()))?;
    if modal_result.scene_id != scene_id.to_string() {
        return Err(ApiError::Upstream(
            "Modal returned a different scene_id".to_string(),
        ));
    }

    let assets = serde_json::to_value(modal_result.assets).unwrap_or_else(|_| json!({}));
    update_scene_status(
        &state.db,
        scene_id,
        modal_result.status,
        modal_result.visual_mode,
        Some(modal_result.warnings),
        modal_result.error,
    )
    .await?;

    sqlx::query("update scenes set assets = $2, updated_at = now() where id = $1")
        .bind(scene_id)
        .bind(assets)
        .execute(&state.db)
        .await?;

    Ok(Json(scene_result_from_db(&state, scene_id).await?))
}

async fn generate_scene_splat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(scene_id): Path<Uuid>,
) -> Result<Json<SceneResult>, ApiError> {
    enforce_request(&state, &headers, RateClass::Process, true)?;

    let row = sqlx::query("select status, input_video_key, output_prefix, assets, warnings from scenes where id = $1")
        .bind(scene_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    let status: String = row.try_get("status")?;
    if parse_status(&status) != SceneStatus::Done {
        return Err(ApiError::BadRequest(
            "splat generation requires a completed scene".to_string(),
        ));
    }

    let modal_splat_url = match &state.config.modal_splat_url {
        Some(url) => url.clone(),
        None => {
            append_scene_warning(&state.db, scene_id, "MODAL_SPLAT_URL is not configured").await?;
            return Ok(Json(scene_result_from_db(&state, scene_id).await?));
        }
    };
    let input_video_key: String = row.try_get("input_video_key")?;
    let output_prefix: String = row.try_get("output_prefix")?;
    let existing_assets: Value = row.try_get("assets")?;
    let existing_warnings: Value = row.try_get("warnings")?;

    let payload = match state.config.storage_backend {
        StorageBackend::S3 => {
            let bucket = state
                .config
                .s3_bucket
                .as_ref()
                .ok_or_else(|| ApiError::Storage("S3_BUCKET is required for s3 storage".to_string()))?;
            json!({
                "storage_backend": "s3",
                "scene_id": scene_id.to_string(),
                "input_video_key": input_video_key,
                "output_prefix": output_prefix,
                "s3_bucket": bucket
            })
        }
        StorageBackend::Modal => {
            let input_path = local_input_path_from_key(&state.config, scene_id, &input_video_key);
            let bytes = fs::read(input_path).map_err(|err| ApiError::Storage(err.to_string()))?;
            json!({
                "storage_backend": "modal",
                "scene_id": scene_id.to_string(),
                "video_bytes_base64": BASE64.encode(bytes),
                "input_video_key": input_video_key,
                "output_prefix": output_prefix
            })
        }
    };

    let mut request = state.http.post(&modal_splat_url).json(&payload);
    if let Some(token) = &state.config.modal_auth_token {
        request = request.bearer_auth(token);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(err) => {
            error!("modal splat request failed: {err}");
            append_scene_warning(&state.db, scene_id, &format!("Splat generation failed: {err}")).await?;
            return Ok(Json(scene_result_from_db(&state, scene_id).await?));
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        append_scene_warning(
            &state.db,
            scene_id,
            &format!("Splat generation failed with HTTP {status}: {body}"),
        )
        .await?;
        return Ok(Json(scene_result_from_db(&state, scene_id).await?));
    }

    let modal_result = match response.json::<ModalSceneResult>().await {
        Ok(result) => result,
        Err(err) => {
            append_scene_warning(&state.db, scene_id, &format!("Splat response was invalid: {err}")).await?;
            return Ok(Json(scene_result_from_db(&state, scene_id).await?));
        }
    };
    if modal_result.scene_id != scene_id.to_string() {
        append_scene_warning(&state.db, scene_id, "Splat response referenced a different scene").await?;
        return Ok(Json(scene_result_from_db(&state, scene_id).await?));
    }
    if modal_result.assets.splat_key.is_none() {
        append_scene_warning(&state.db, scene_id, "Splat generation completed without a splat asset").await?;
        return Ok(Json(scene_result_from_db(&state, scene_id).await?));
    }

    let mut warnings: Vec<String> = serde_json::from_value(existing_warnings).unwrap_or_default();
    warnings.extend(modal_result.warnings);
    let merged_assets = merge_asset_values(existing_assets, serde_json::to_value(modal_result.assets).unwrap_or_else(|_| json!({})));

    update_scene_status(
        &state.db,
        scene_id,
        SceneStatus::Done,
        Some(VisualMode::Splat),
        Some(warnings),
        None,
    )
    .await?;

    sqlx::query("update scenes set assets = $2, updated_at = now() where id = $1")
        .bind(scene_id)
        .bind(merged_assets)
        .execute(&state.db)
        .await?;

    Ok(Json(scene_result_from_db(&state, scene_id).await?))
}

async fn get_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((scene_id, asset_name)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    enforce_request(&state, &headers, RateClass::Asset, false)?;

    if state.config.storage_backend == StorageBackend::Modal {
        return get_modal_asset(state, scene_id, asset_name).await;
    }

    let row = sqlx::query("select output_prefix from scenes where id = $1")
        .bind(scene_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    let output_prefix: String = row.try_get("output_prefix")?;
    let asset_name = asset_name.trim_start_matches('/');
    if asset_name.contains("..") {
        return Err(ApiError::BadRequest("invalid asset path".to_string()));
    }

    let key = format!("{output_prefix}/{asset_name}");
    let s3 = state
        .s3
        .as_ref()
        .ok_or_else(|| ApiError::Storage("S3 client is not configured".to_string()))?;
    let bucket = state
        .config
        .s3_bucket
        .as_ref()
        .ok_or_else(|| ApiError::Storage("S3_BUCKET is required for s3 storage".to_string()))?;
    let object = s3
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|err| ApiError::Storage(err.to_string()))?;

    let bytes = object
        .body
        .collect()
        .await
        .map_err(|err| ApiError::Storage(err.to_string()))?
        .into_bytes();

    let mut headers = HeaderMap::new();
    if let Some(content_type) = object.content_type {
        if let Ok(value) = HeaderValue::from_str(&content_type) {
            headers.insert(header::CONTENT_TYPE, value);
        }
    }

    Ok((headers, Body::from(bytes)).into_response())
}

async fn get_modal_asset(state: AppState, scene_id: Uuid, asset_name: String) -> Result<Response, ApiError> {
    let asset_name = asset_name.trim_start_matches('/');
    if asset_name.contains("..") {
        return Err(ApiError::BadRequest("invalid asset path".to_string()));
    }

    let modal_asset_url = state
        .config
        .modal_asset_url
        .as_ref()
        .ok_or_else(|| ApiError::Storage("MODAL_ASSET_URL is required for modal storage".to_string()))?;
    let mut request = state.http.get(modal_asset_url).query(&[
        ("scene_id", scene_id.to_string()),
        ("asset_path", asset_name.to_string()),
    ]);
    if let Some(token) = &state.config.modal_auth_token {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|err| ApiError::Upstream(err.to_string()))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ApiError::Upstream(format!("Modal asset returned HTTP {status}: {body}")));
    }

    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("application/octet-stream"));
    let bytes = response
        .bytes()
        .await
        .map_err(|err| ApiError::Upstream(err.to_string()))?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, content_type);
    Ok((headers, Body::from(bytes)).into_response())
}

async fn scene_result_from_db(state: &AppState, scene_id: Uuid) -> Result<SceneResult, ApiError> {
    let row = sqlx::query(
        r#"
        select id, status, visual_mode, assets, warnings, error
        from scenes
        where id = $1
        "#,
    )
    .bind(scene_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;

    let id: Uuid = row.try_get("id")?;
    let status: String = row.try_get("status")?;
    let visual_mode: Option<String> = row.try_get("visual_mode")?;
    let asset_keys: Value = row.try_get("assets")?;
    let warnings: Value = row.try_get("warnings")?;
    let error: Option<String> = row.try_get("error")?;

    let modal_assets: ModalAssetKeys = serde_json::from_value(asset_keys).unwrap_or_default();
    let warnings = serde_json::from_value(warnings).unwrap_or_default();

    Ok(SceneResult {
        scene_id: id.to_string(),
        status: parse_status(&status),
        visual_mode: visual_mode.as_deref().and_then(VisualMode::parse),
        assets: asset_urls(state, id, modal_assets),
        warnings,
        error,
    })
}

fn parse_status(value: &str) -> SceneStatus {
    match value {
        "uploaded" => SceneStatus::Uploaded,
        "processing" => SceneStatus::Processing,
        "done" => SceneStatus::Done,
        "failed" => SceneStatus::Failed,
        _ => SceneStatus::Failed,
    }
}

fn asset_urls(state: &AppState, scene_id: Uuid, keys: ModalAssetKeys) -> SceneAssets {
    SceneAssets {
        pointcloud_url: keys.pointcloud_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        pointcloud_glb_url: keys.pointcloud_glb_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        splat_url: keys.splat_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        raw_splat_ply_url: keys.raw_splat_ply_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        floorplan_png_url: keys.floorplan_png_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        floorplan_svg_url: keys.floorplan_svg_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        floorplan_json_url: keys.floorplan_json_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        cameras_json_url: keys.cameras_json_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        hotspots_json_url: keys.hotspots_json_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        previews_json_url: keys.previews_json_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        depth_preview_url: keys.depth_preview_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        confidence_preview_url: keys.confidence_preview_key.as_deref().map(|key| asset_url(state, scene_id, key)),
        processing_log_url: keys.processing_log_key.as_deref().map(|key| asset_url(state, scene_id, key)),
    }
}

fn merge_asset_values(mut existing: Value, incoming: Value) -> Value {
    let Some(existing_object) = existing.as_object_mut() else {
        return incoming;
    };
    let Some(incoming_object) = incoming.as_object() else {
        return existing;
    };

    for (key, value) in incoming_object {
        if !value.is_null() {
            existing_object.insert(key.clone(), value.clone());
        }
    }

    existing
}

fn asset_url(state: &AppState, scene_id: Uuid, key: &str) -> String {
    let asset_name = key
        .split("/outputs/")
        .nth(1)
        .unwrap_or(key)
        .trim_start_matches('/');
    format!(
        "{}/api/scenes/{}/assets/{}",
        state.config.api_public_url.trim_end_matches('/'),
        scene_id,
        asset_name
    )
}

fn local_input_path(config: &AppConfig, scene_id: Uuid, ext: &str) -> PathBuf {
    config
        .local_data_dir
        .join("scenes")
        .join(scene_id.to_string())
        .join("input")
        .join(format!("input.{ext}"))
}

fn local_input_path_from_key(config: &AppConfig, scene_id: Uuid, input_video_key: &str) -> PathBuf {
    let file_name = input_video_key.rsplit('/').next().unwrap_or("input.mp4");
    config
        .local_data_dir
        .join("scenes")
        .join(scene_id.to_string())
        .join("input")
        .join(file_name)
}

async fn update_scene_status(
    db: &PgPool,
    scene_id: Uuid,
    status: SceneStatus,
    visual_mode: Option<VisualMode>,
    warnings: Option<Vec<String>>,
    error: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        update scenes
        set status = $2,
            visual_mode = coalesce($3, visual_mode),
            warnings = coalesce($4, warnings),
            error = $5,
            updated_at = now()
        where id = $1
        "#,
    )
    .bind(scene_id)
    .bind(status.as_str())
    .bind(visual_mode.map(VisualMode::as_str))
    .bind(warnings.map(|value| serde_json::to_value(value).unwrap_or_else(|_| json!([]))))
    .bind(error)
    .execute(db)
    .await?;

    Ok(())
}

async fn append_scene_warning(db: &PgPool, scene_id: Uuid, warning: &str) -> Result<(), sqlx::Error> {
    let row = sqlx::query("select warnings from scenes where id = $1")
        .bind(scene_id)
        .fetch_optional(db)
        .await?;
    let mut warnings: Vec<String> = match row {
        Some(row) => {
            let value: Value = row.try_get("warnings")?;
            serde_json::from_value(value).unwrap_or_default()
        }
        None => return Ok(()),
    };
    warnings.push(warning.to_string());

    sqlx::query("update scenes set warnings = $2, updated_at = now() where id = $1")
        .bind(scene_id)
        .bind(serde_json::to_value(warnings).unwrap_or_else(|_| json!([])))
        .execute(db)
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
