use tauri::{plugin::{Builder,TauriPlugin},Runtime};
#[cfg(target_os="android")]
use tauri::{Manager,plugin::PluginHandle};
#[cfg(target_os="android")]
pub struct Platform<R:Runtime>(PluginHandle<R>);
#[cfg(target_os="android")]
impl<R:Runtime> Platform<R>{pub fn run(&self,command:&str,payload:serde_json::Value)->Result<serde_json::Value,String>{self.0.run_mobile_plugin(command,payload).map_err(|_|"Android系统操作失败，请检查目录授权、声音包或权限".into())}}
#[cfg(target_os="android")]
pub trait PlatformExt<R:Runtime>{fn platform(&self)->&Platform<R>;}
#[cfg(target_os="android")]
impl<R:Runtime,T:Manager<R>> PlatformExt<R> for T {fn platform(&self)->&Platform<R>{self.state::<Platform<R>>().inner()}}
pub fn init<R:Runtime>()->TauriPlugin<R>{Builder::new("platform").setup(|_app,_api|{
  #[cfg(target_os="android")]
  {let handle=_api.register_android_plugin("io.lexilens.platform","PlatformPlugin")?;_app.manage(Platform(handle));}
  Ok(())
}).build()}
