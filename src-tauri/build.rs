fn main() {
    println!("cargo:rerun-if-env-changed=WEAVE_GITHUB_OAUTH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=WEAVE_GITHUB_OAUTH_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=WEAVE_OAUTH_CLIENT_SECRET");
    tauri_build::build()
}
