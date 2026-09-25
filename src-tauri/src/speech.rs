use crate::storage::Result;
use std::sync::{mpsc, OnceLock};
type Message = (String, mpsc::Sender<Result<()>>);
static WORKER: OnceLock<mpsc::Sender<Message>> = OnceLock::new();
pub fn speak(text: String) -> Result<()> {
    if text.chars().count() > 500 {
        return Err("发音仅支持单词或短句（最多500字符）".into());
    }
    let sender = WORKER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<Message>();
        std::thread::spawn(move || worker(receiver));
        sender
    });
    let (tx, rx) = mpsc::channel();
    sender
        .send((text, tx))
        .map_err(|_| "语音引擎已停止".to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "语音引擎初始化超时".to_string())?
}
#[cfg(windows)]
fn worker(receiver: mpsc::Receiver<Message>) {
    use windows::{
        core::BSTR,
        Win32::{
            Media::Speech::{ISpeechVoice, SpVoice, SpeechVoiceSpeakFlags},
            System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED},
        },
    };
    let initialized: Result<ISpeechVoice> = (|| unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|_| "无法初始化系统语音".to_string())?;
        let voice: ISpeechVoice = CoCreateInstance(&SpVoice, None, CLSCTX_ALL)
            .map_err(|_| "没有系统语音引擎".to_string())?;
        let voices = voice
            .GetVoices(&BSTR::from("Language=409"), &BSTR::new())
            .map_err(|_| "无法枚举英语声音".to_string())?;
        if voices.Count().unwrap_or(0) == 0 {
            return Err("未安装本机英语声音，请在系统语言设置中安装英语语音包".into());
        }
        voice
            .putref_Voice(&voices.Item(0).map_err(|_| "英语声音不可用".to_string())?)
            .map_err(|_| "无法选择英语声音".to_string())?;
        Ok(voice)
    })();
    for (text, reply) in receiver {
        let result = match &initialized {
            Ok(voice) => unsafe {
                voice
                    .Speak(&BSTR::from(text), SpeechVoiceSpeakFlags(3))
                    .map(|_| ())
                    .map_err(|_| "系统语音未能播放".to_string())
            },
            Err(e) => Err(e.clone()),
        };
        let _ = reply.send(result);
    }
}
#[cfg(not(windows))]
fn worker(receiver: mpsc::Receiver<Message>) {
    for (_, reply) in receiver {
        let _ = reply.send(Err("当前平台语音桥不可用".into()));
    }
}
