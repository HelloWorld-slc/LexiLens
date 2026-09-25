use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub struct Library {
    pub root: PathBuf,
    pub db: Connection,
}
#[derive(Serialize)]
pub struct Loaded {
    pub path: String,
    pub revision: i64,
    pub data: Option<String>,
}
pub fn validate_data(data: &str) -> Result<Value> {
    if data.len() > 32 * 1024 * 1024 {
        return Err("资料超过当前安全容量限制".into());
    }
    let v: Value = serde_json::from_str(data).map_err(err)?;
    if v["schema"] != 1
        || !v["id"].is_string()
        || !v["projects"].is_array()
        || !v["favorites"].is_array()
        || !v["results"].is_array()
        || !v["tasks"].is_array()
    {
        return Err("资料格式无效或版本过新".into());
    }
    // Credentials are never accepted as settings or structured fields.
    fn walk(v: &Value) -> bool {
        match v {
            Value::Object(o) => o.iter().any(|(k, v)| {
                ["apikey", "api_key", "authorization", "credential", "secret"]
                    .contains(&k.to_lowercase().as_str())
                    || walk(v)
            }),
            Value::Array(a) => a.iter().any(walk),
            _ => false,
        }
    }
    if walk(&v) {
        return Err("资料中含禁止导出的凭据字段".into());
    }
    let mut ids = std::collections::HashSet::new();
    fn entity(v: &Value, ids: &mut std::collections::HashSet<String>) -> Result<()> {
        let id = v["id"].as_str().ok_or("资料缺稳定ID")?;
        uuid::Uuid::parse_str(id).map_err(|_| "资料ID格式无效".to_string())?;
        if !ids.insert(id.into()) {
            return Err("重复资料ID".into());
        }
        Ok(())
    }
    entity(&v, &mut ids)?;
    for p in v["projects"].as_array().unwrap() {
        entity(p, &mut ids)?;
        if !p["title"].is_string() {
            return Err("项目名称无效".into());
        }
        for page in p["pages"].as_array().ok_or("项目缺页面列表")? {
            entity(page, &mut ids)?;
            for key in ["original", "current"] {
                let a = &page[key];
                uuid::Uuid::parse_str(a["id"].as_str().ok_or("图像缺ID")?).map_err(err)?;
                if !a["hash"].is_string() || !a["mime"].is_string() {
                    return Err("图像元数据无效".into());
                }
            }
        }
        for a in p["articles"].as_array().ok_or("项目缺文章列表")? {
            entity(a, &mut ids)?;
            if !a["title"].is_string() {
                return Err("文章名称无效".into());
            }
            for q in a["paragraphs"].as_array().ok_or("文章缺段落")? {
                entity(q, &mut ids)?;
                let versions = q["versions"].as_array().ok_or("段落缺版本")?;
                for version in versions {
                    entity(version, &mut ids)?;
                    if !version["text"].is_string() {
                        return Err("正文不是文字".into());
                    }
                }
                if !versions.iter().any(|x| x["id"] == q["currentVersion"]) {
                    return Err("当前正文版本不存在".into());
                }
            }
        }
    }
    for key in ["favorites", "results", "tasks"] {
        for value in v[key].as_array().unwrap() {
            entity(value, &mut ids)?;
        }
    }
    Ok(v)
}
impl Library {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root).map_err(err)?;
        let root = root.canonicalize().map_err(err)?;
        fs::create_dir_all(root.join("assets")).map_err(err)?;
        if !root
            .join("assets")
            .canonicalize()
            .map_err(err)?
            .starts_with(&root)
        {
            return Err("资产目录不可指向资料目录外部".into());
        }
        let db_path = root.join("library.sqlite");
        if db_path.exists() && !db_path.canonicalize().map_err(err)?.starts_with(&root) {
            return Err("数据库路径越界".into());
        }
        let db = Connection::open(root.join("library.sqlite")).map_err(err)?;
        db.busy_timeout(Duration::from_secs(3)).map_err(err)?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )
        .map_err(err)?;
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if version > 1 {
            return Err("资料库来自更新版本，请使用新版 LexiLens".into());
        }
        if version == 0 {
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))); PRAGMA user_version=1; COMMIT;").map_err(err)?;
        }
        Ok(Self { root, db })
    }
    pub fn load(&self) -> Result<Loaded> {
        let state: Option<(i64, String)> = self
            .db
            .query_row("SELECT revision,data FROM state WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(err)?;
        Ok(Loaded {
            path: self.root.to_string_lossy().into_owned(),
            revision: state.as_ref().map_or(0, |s| s.0),
            data: state.map(|s| s.1),
        })
    }
    pub fn save(&mut self, data: &str, expected: i64) -> Result<i64> {
        validate_data(data)?;
        let tx = self
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let revision: i64 = tx
            .query_row("SELECT revision FROM state WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(err)?
            .unwrap_or(0);
        if revision != expected {
            return Err("资料已由另一操作更新。草稿仍在当前窗口，请导出或重新打开后核对。".into());
        }
        tx.execute("INSERT INTO state(id,revision,data) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data",params![revision+1,data]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(revision + 1)
    }
    pub fn asset_path(&self, id: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(id).map_err(|_| "无效资产ID".to_string())?;
        if id.contains(['/', '\\', ':']) {
            return Err("无效资产路径".into());
        }
        let root = self.root.join("assets");
        let p = root.join(id);
        if p.exists()
            && !p
                .canonicalize()
                .map_err(err)?
                .starts_with(root.canonicalize().map_err(err)?)
        {
            return Err("资产路径越界".into());
        }
        Ok(p)
    }
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Asset {
    pub id: String,
    pub mime: String,
    pub hash: String,
    pub size: usize,
}
pub fn image_mime(bytes: &[u8]) -> Result<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else {
        Err("只接受 JPG / PNG 原始文件".into())
    }
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(err)?;
    f.write_all(bytes).map_err(err)?;
    f.sync_all().map_err(err)
}
#[derive(Serialize, Deserialize)]
pub struct Backup {
    pub format: String,
    pub version: u32,
    pub full: bool,
    pub data: String,
    pub data_hash: String,
    pub assets: std::collections::BTreeMap<String, BackupAsset>,
}
#[derive(Serialize, Deserialize)]
pub struct BackupAsset {
    pub bytes: String,
    pub hash: String,
}
pub fn referenced_assets(v: &Value) -> std::collections::BTreeSet<String> {
    fn walk(v: &Value, out: &mut std::collections::BTreeSet<String>) {
        match v {
            Value::Object(o) => {
                if o.get("mime").is_some() && o.get("hash").is_some() {
                    if let Some(id) = o.get("id").and_then(Value::as_str) {
                        out.insert(id.to_string());
                    }
                }
                for x in o.values() {
                    walk(x, out)
                }
            }
            Value::Array(a) => {
                for x in a {
                    walk(x, out)
                }
            }
            _ => {}
        }
    }
    let mut ids = std::collections::BTreeSet::new();
    walk(v, &mut ids);
    ids
}
pub fn create_backup(lib: &Library, data: &str, full: bool) -> Result<Backup> {
    let v = validate_data(data)?;
    let mut assets = std::collections::BTreeMap::new();
    let mut total = data.len();
    if full {
        for id in referenced_assets(&v) {
            let bytes = fs::read(lib.asset_path(&id)?)
                .map_err(|_| "完整备份缺少原图或副本；请恢复文件或选择轻量备份".to_string())?;
            total += bytes.len();
            if total > 128 * 1024 * 1024 {
                return Err("备份超过当前128MiB安全上限，请分项目导出".into());
            }
            assets.insert(
                id,
                BackupAsset {
                    hash: hash(&bytes),
                    bytes: STANDARD.encode(bytes),
                },
            );
        }
    }
    Ok(Backup {
        format: "lexilens".into(),
        version: 1,
        full,
        data: data.into(),
        data_hash: hash(data.as_bytes()),
        assets,
    })
}
pub fn inspect_backup(bytes: &[u8]) -> Result<Backup> {
    if bytes.len() > 180 * 1024 * 1024 {
        return Err("备份文件过大".into());
    }
    let b: Backup = serde_json::from_slice(bytes).map_err(err)?;
    if b.format != "lexilens" || b.version != 1 || hash(b.data.as_bytes()) != b.data_hash {
        return Err("备份版本或校验失败".into());
    }
    let v = validate_data(&b.data)?;
    if b.full && referenced_assets(&v) != b.assets.keys().cloned().collect() {
        return Err("完整备份资产清单不闭合".into());
    }
    if !b.full && !b.assets.is_empty() {
        return Err("轻量备份不可携带额外资产".into());
    }
    for (id, a) in &b.assets {
        uuid::Uuid::parse_str(id).map_err(|_| "备份包含非法路径".to_string())?;
        let decoded = STANDARD.decode(&a.bytes).map_err(err)?;
        image_mime(&decoded)?;
        if hash(&decoded) != a.hash {
            return Err("图像校验失败".into());
        }
    }
    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> String {
        r#"{"schema":1,"id":"b4d53084-071b-4f67-b3c4-693985a14f54","projects":[],"favorites":[],"results":[],"tasks":[]}"#.into()
    }
    #[test]
    fn reopen_and_conflict() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut lib = Library::open(dir.path()).unwrap();
            assert_eq!(lib.save(&sample(), 0).unwrap(), 1);
            assert!(lib.save(&sample(), 0).is_err());
        }
        let lib = Library::open(dir.path()).unwrap();
        assert_eq!(lib.load().unwrap().revision, 1);
        assert_eq!(lib.load().unwrap().data.unwrap(), sample());
    }
    #[test]
    fn backup_tamper_and_paths() {
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::open(dir.path()).unwrap();
        let b = create_backup(&lib, &sample(), true).unwrap();
        let bytes = serde_json::to_vec(&b).unwrap();
        assert!(inspect_backup(&bytes).is_ok());
        let mut b = b;
        b.data.push(' ');
        assert!(inspect_backup(&serde_json::to_vec(&b).unwrap()).is_err());
        assert!(lib.asset_path("../escape").is_err());
    }
    #[test]
    fn refuse_key_fields() {
        assert!(validate_data(&sample().replace(
            "\"tasks\":[]",
            "\"tasks\":[],\"settings\":{\"apiKey\":\"example\"}"
        ))
        .is_err());
    }
}
