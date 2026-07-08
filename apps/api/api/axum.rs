use tower::ServiceBuilder;
use vercel_runtime::{axum::VercelLayer, Error};

#[path = "../src/main.rs"]
#[allow(dead_code)]
mod roomfly_api;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let router = roomfly_api::build_router().await?;
    let app = ServiceBuilder::new()
        .layer(VercelLayer::new())
        .service(router);

    vercel_runtime::run(app).await
}
