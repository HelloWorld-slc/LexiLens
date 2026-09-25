mod speech;
mod storage;
mod vault;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex, time::Duration};
use storage::{err, Asset, Backup, Library, Loaded, Result};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "android")]
use tauri_plugin_platform::PlatformExt;

fn credential(app: &tauri::AppHandle) -> Result<String> {
    #[cfg(target_os = "android")]
    {
        let v = app.platform().run("getKey", json!({}))?;
        v["key"]
            .as_str()
            .map(str::to_string)
            .ok_or("请配置个人Key".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        vault::get(&app_root(app)?)
    }
}
fn asset_read(app: &tauri::AppHandle, lib: &Library, id: &str) -> Result<Vec<u8>> {
    lib.asset_path(id)?;
    #[cfg(target_os = "android")]
    {
        check_android_tree(app, lib)?;
        let v = app.platform().run("readAsset", json!({"id":id}))?;
        STANDARD
            .decode(v["bytes"].as_str().ok_or("图像不可读")?)
            .map_err(err)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        fs::read(lib.asset_path(id)?).map_err(|_| "原图不可访问，轻量备份可能未包含原图".into())
    }
}
fn asset_write(app: &tauri::AppHandle, lib: &Library, id: &str, bytes: &[u8]) -> Result<()> {
    lib.asset_path(id)?;
    #[cfg(target_os = "android")]
    {
        check_android_tree(app, lib)?;
        app.platform().run(
            "writeAsset",
            json!({"id":id,"bytes":STANDARD.encode(bytes)}),
        )?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let path = lib.asset_path(id)?;
        if path.exists() {
            if storage::hash(&fs::read(&path).map_err(err)?) != storage::hash(bytes) {
                return Err("已有图像ID冲突，未覆盖".into());
            }
            Ok(())
        } else {
            storage::write_new(&path, bytes)
        }
    }
}
#[cfg(target_os = "android")]
fn check_android_tree(app: &tauri::AppHandle, lib: &Library) -> Result<()> {
    let v = app.platform().run("directoryStatus", json!({}))?;
    let uri = v["uri"].as_str().ok_or("请重新选择原资料目录")?;
    let expected = format!("library-{}", &storage::hash(uri.as_bytes())[..16]);
    if v["available"] != true
        || lib.root.file_name().and_then(|x| x.to_str()) != Some(expected.as_str())
    {
        return Err("原图目录授权不可用或与工作库不匹配，请重新选择原目录；正文仍保留".into());
    }
    Ok(())
}

#[derive(Default)]
struct AppState {
    library: Mutex<Option<Library>>,
    requests: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    backup: Mutex<Option<(String, Backup)>>,
}
fn app_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    let root = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&root).map_err(err)?;
    Ok(root)
}
fn library<'a>(state: &'a State<AppState>) -> Result<std::sync::MutexGuard<'a, Option<Library>>> {
    state.library.lock().map_err(|_| "资料锁错误".into())
}
fn open_root(app: &tauri::AppHandle, state: &State<AppState>, root: PathBuf) -> Result<Loaded> {
    let lib = Library::open(&root)?;
    let loaded = lib.load()?;
    fs::write(
        app_root(app)?.join("last-library.txt"),
        root.to_string_lossy().as_bytes(),
    )
    .map_err(err)?;
    *library(state)? = Some(lib);
    Ok(loaded)
}
#[tauri::command]
async fn choose_library(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Loaded>> {
    #[cfg(target_os = "android")]
    {
        let v = app.platform().run("chooseDirectory", json!({}))?;
        if v["cancelled"] == true {
            return Ok(None);
        }
        let uri = v["uri"].as_str().ok_or("目录选择未返回")?;
        let root =
            app_root(&app)?.join(format!("library-{}", &storage::hash(uri.as_bytes())[..16]));
        let mut loaded = open_root(&app, &state, root)?;
        loaded.path = format!("{}；工作库在应用私有目录，卸载前请导出完整备份", uri);
        Ok(Some(loaded))
    }
    #[cfg(not(target_os = "android"))]
    {
        let Some(path) = app
            .dialog()
            .file()
            .set_title("选择本机资料目录")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let p = path.into_path().map_err(err)?;
        open_root(&app, &state, p).map(Some)
    }
}
#[tauri::command]
async fn reopen_library(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Loaded>> {
    let pointer = app_root(&app)?.join("last-library.txt");
    if !pointer.exists() {
        return Ok(None);
    }
    let path = fs::read_to_string(pointer).map_err(err)?;
    let root = PathBuf::from(path);
    if !root.join("library.sqlite").exists() {
        return Err("原资料目录不可用，请重新授权或选择目录；没有新建空库覆盖旧资料".into());
    }
    let loaded = open_root(&app, &state, root)?;
    #[cfg(target_os = "android")]
    {
        let mut loaded = loaded;
        let v = app.platform().run("directoryStatus", json!({}))?;
        loaded.path = format!(
            "{}；工作库在应用私有目录，卸载前请导出完整备份{}",
            v["uri"].as_str().unwrap_or("原目录待重新授权"),
            if v["available"] == true {
                ""
            } else {
                "；当前无法访问原图目录"
            }
        );
        return Ok(Some(loaded));
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(Some(loaded))
    }
}
#[tauri::command]
fn save_library(state: State<AppState>, data: String, revision: i64) -> Result<i64> {
    library(&state)?
        .as_mut()
        .ok_or("请先选择资料目录")?
        .save(&data, revision)
}
#[tauri::command]
async fn import_image(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> Result<Asset> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("单图不能超过32MiB".into());
    }
    let mime = storage::image_mime(&bytes)?.to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let lock = library(&state)?;
    let lib = lock.as_ref().ok_or("请先选择资料目录")?;
    asset_write(&app, lib, &id, &bytes)?;
    Ok(Asset {
        id,
        mime,
        hash: storage::hash(&bytes),
        size: bytes.len(),
    })
}
#[tauri::command]
async fn read_image(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String> {
    let lock = library(&state)?;
    let lib = lock.as_ref().ok_or("资料库未打开")?;
    let bytes = asset_read(&app, lib, &id)?;
    let mime = storage::image_mime(&bytes)?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}
#[tauri::command]
async fn has_key(app: tauri::AppHandle) -> Result<bool> {
    Ok(credential(&app).is_ok())
}
#[tauri::command]
async fn set_key(app: tauri::AppHandle, key: String) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        app.platform().run("setKey", json!({"key":key}))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        vault::set(&app_root(&app)?, &key)
    }
}
#[tauri::command]
fn cancel_request(state: State<AppState>, request_id: String) -> Result<()> {
    if let Some(sender) = state.requests.lock().map_err(err)?.remove(&request_id) {
        let _ = sender.send(());
    }
    Ok(())
}
#[tauri::command]
async fn model_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    payload: Value,
) -> Result<Value> {
    uuid::Uuid::parse_str(&request_id).map_err(err)?;
    let model = payload["model"].as_str().ok_or("缺少模型")?;
    if !["deepseek-flash", "deepseek-v4-pro"].contains(&model) {
        return Err("当前仅支持已定义的 Flash / Pro 配置".into());
    }
    let encoded = serde_json::to_vec(&payload).map_err(err)?;
    if encoded.len() > 48 * 1024 * 1024 {
        return Err("请求超过48MiB".into());
    }
    if payload.get("tools").is_some() || payload["stream"] != false {
        return Err("不支持该请求能力".into());
    }
    let mut key = credential(&app)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "网络初始化失败".to_string())?;
    let request = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(&key)
        .json(&payload);
    // Drop the plaintext buffer immediately after constructing the authorized request.
    unsafe { key.as_bytes_mut().fill(0) };
    drop(key);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut requests = state.requests.lock().map_err(err)?;
        if requests.len() >= 2 {
            return Err("已有两项请求，请稍后重试".into());
        }
        requests.insert(request_id.clone(), sender);
    }
    let result = tokio::select! {
        _=receiver=>Err("已取消；已发送请求的供应商用量可能仍会产生".to_string()),
        r=async {
            let mut response=request.send().await.map_err(|_|"网络失败或超时；用量未知，可手动重试".to_string())?;
            if !response.status().is_success(){return Err(format!("API返回{}；已有资料未受影响，请检查Key/余额/限流后重试",response.status().as_u16()))}
            if response.content_length().unwrap_or(0)>16*1024*1024{return Err("响应过大".into())}
            let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|"响应读取失败，用量未知".to_string())?{if bytes.len()+chunk.len()>16*1024*1024{return Err("响应过大".into())}bytes.extend_from_slice(&chunk);}
            let raw:Value=serde_json::from_slice(&bytes).map_err(|_|"响应无法解析；用量未知".to_string())?;
            let c=&raw["choices"][0];let content=c["message"]["content"].as_str().unwrap_or("");
            Ok(json!({"raw":content,"model":raw["model"],"usage":raw.get("usage"),"finish_reason":c["finish_reason"],"request_id":raw["id"]}))
        }=>r
    };
    state.requests.lock().map_err(err)?.remove(&request_id);
    result
}
#[tauri::command]
async fn export_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    data: String,
    full: bool,
) -> Result<Option<String>> {
    let b = {
        let lock = library(&state)?;
        let lib = lock.as_ref().ok_or("资料库未打开")?;
        let mut b = storage::create_backup(lib, &data, false)?;
        b.full = full;
        if full {
            let v = storage::validate_data(&data)?;
            let mut total = data.len();
            for id in storage::referenced_assets(&v) {
                let bytes = asset_read(&app, lib, &id)?;
                total += bytes.len();
                if total > 128 * 1024 * 1024 {
                    return Err("备份超过128MiB，请分项目导出".into());
                }
                b.assets.insert(
                    id,
                    storage::BackupAsset {
                        hash: storage::hash(&bytes),
                        bytes: STANDARD.encode(bytes),
                    },
                );
            }
        }
        b
    };
    #[cfg(target_os = "android")]
    {
        let name = format!("LexiLens-{}.lexilens", uuid::Uuid::new_v4());
        let v = app.platform().run(
            "exportDocument",
            json!({"name":name,"bytes":STANDARD.encode(serde_json::to_vec(&b).map_err(err)?)}),
        )?;
        return Ok(v["path"].as_str().map(str::to_string));
    }
    #[cfg(not(target_os = "android"))]
    {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导出备份（不含Key）")
            .set_file_name(if full {
                "LexiLens-full.lexilens"
            } else {
                "LexiLens-light.lexilens"
            })
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(err)?;
        // Create-new avoids overwriting an existing user backup even after dialog confirmation.
        storage::write_new(&path, &serde_json::to_vec(&b).map_err(err)?)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
}
#[tauri::command]
async fn inspect_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Value>> {
    #[cfg(target_os = "android")]
    let bytes = {
        let v = app.platform().run("importDocument", json!({}))?;
        if v["cancelled"] == true {
            return Ok(None);
        }
        STANDARD
            .decode(v["bytes"].as_str().ok_or("备份不可读")?)
            .map_err(err)?
    };
    #[cfg(not(target_os = "android"))]
    let bytes = {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("预览备份导入")
            .add_filter("LexiLens备份", &["lexilens"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(err)?;
        if fs::metadata(&path).map_err(err)?.len() > 180 * 1024 * 1024 {
            return Err("备份超过安全容量".into());
        }
        fs::read(path).map_err(err)?
    };
    let b = storage::inspect_backup(&bytes)?;
    let token = uuid::Uuid::new_v4().to_string();
    let result = json!({"data":b.data,"full":b.full,"assets":b.assets.len(),"token":token});
    *state.backup.lock().map_err(err)? = Some((token, b));
    Ok(Some(result))
}
#[tauri::command]
async fn restore_assets(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> Result<()> {
    let lock = state.backup.lock().map_err(err)?;
    let (stored, b) = lock.as_ref().ok_or("请重新预览备份")?;
    if stored != &token {
        return Err("导入预览已过期".into());
    }
    let library_lock = library(&state)?;
    let lib = library_lock.as_ref().ok_or("资料库未打开")?;
    for (id, a) in &b.assets {
        let bytes = STANDARD.decode(&a.bytes).map_err(err)?;
        asset_write(&app, lib, id, &bytes)?;
    }
    Ok(())
}
#[tauri::command]
async fn export_text(
    app: tauri::AppHandle,
    text: String,
    extension: String,
) -> Result<Option<String>> {
    if !["md", "txt", "html", "json"].contains(&extension.as_str()) {
        return Err("不支持的导出格式".into());
    }
    let name = format!("LexiLens-{}.{}", uuid::Uuid::new_v4(), extension);
    #[cfg(target_os = "android")]
    {
        let v = app.platform().run(
            "exportDocument",
            json!({"name":name,"bytes":STANDARD.encode(text.as_bytes())}),
        )?;
        return Ok(v["path"].as_str().map(str::to_string));
    }
    #[cfg(not(target_os = "android"))]
    {
        let Some(file) = app.dialog().file().set_file_name(name).blocking_save_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(err)?;
        storage::write_new(&path, text.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
}
#[tauri::command]
async fn speak_text(app: tauri::AppHandle, text: String) -> Result<()> {
    #[cfg(target_os = "android")]
    {
        app.platform().run("speak", json!({"text":text}))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        speech::speak(text)
    }
}
#[tauri::command]
async fn capture_photo(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<Asset>> {
    #[cfg(target_os = "android")]
    {
        let v = app.platform().run("capture", json!({}))?;
        if v["cancelled"] == true {
            return Ok(None);
        }
        let bytes = STANDARD
            .decode(v["bytes"].as_str().ok_or("照片不可读")?)
            .map_err(err)?;
        import_image(app, state, bytes).await.map(Some)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state);
        Err("此设备请通过图片文件、粘贴或拖入导入材料".into())
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_platform::init());
    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            choose_library,
            reopen_library,
            save_library,
            import_image,
            read_image,
            has_key,
            set_key,
            model_request,
            cancel_request,
            export_backup,
            inspect_backup,
            restore_assets,
            export_text,
            speak_text,
            capture_photo
        ])
        .run(tauri::generate_context!())
        .expect("LexiLens could not start");
}
