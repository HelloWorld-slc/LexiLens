use crate::storage::{err, Result};
use std::{fs, path::Path};
#[cfg(windows)]
fn protect(input: &[u8], decrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let src = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut dst = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    unsafe {
        let ok = if decrypt {
            CryptUnprotectData(
                &src,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut dst,
            )
        } else {
            CryptProtectData(
                &src,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut dst,
            )
        };
        if ok == 0 {
            return Err("Windows 系统凭据保护不可用，未保存 Key".into());
        }
        let result = std::slice::from_raw_parts(dst.pbData, dst.cbData as usize).to_vec();
        std::ptr::write_bytes(dst.pbData, 0, dst.cbData as usize);
        LocalFree(dst.pbData as _);
        Ok(result)
    }
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err("当前平台系统凭据桥尚未接入，不能明文保存 Key".into())
}
pub fn set(root: &Path, key: &str) -> Result<()> {
    if key.trim().is_empty() {
        if root.join("credential.bin").exists() {
            fs::remove_file(root.join("credential.bin")).map_err(err)?;
        }
        return Ok(());
    }
    if key.len() > 512 || key.contains(['\r', '\n']) {
        return Err("Key 格式无效".into());
    }
    let mut bytes = key.trim().as_bytes().to_vec();
    let cipher = protect(&bytes, false);
    bytes.fill(0);
    fs::write(root.join("credential.bin"), cipher?).map_err(err)
}
pub fn get(root: &Path) -> Result<String> {
    let cipher = fs::read(root.join("credential.bin"))
        .map_err(|_| "请先在设置中配置个人 Key".to_string())?;
    let bytes = protect(&cipher, true)?;
    String::from_utf8(bytes).map_err(|_| "凭据无法读取".into())
}
#[cfg(all(test,windows))]
mod tests {
    use super::*;
    #[test]
    fn credential_roundtrip_and_remove(){
        let dir=tempfile::tempdir().unwrap();let value="local-test-placeholder-not-a-real-key";
        set(dir.path(),value).unwrap();let stored=fs::read(dir.path().join("credential.bin")).unwrap();
        assert!(!stored.windows(value.len()).any(|s|s==value.as_bytes()));assert_eq!(get(dir.path()).unwrap(),value);
        set(dir.path(),"").unwrap();assert!(get(dir.path()).is_err());
    }
}
