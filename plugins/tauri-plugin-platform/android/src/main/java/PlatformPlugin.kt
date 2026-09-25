package io.lexilens.platform

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.speech.tts.TextToSpeech
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg class AssetArgs { lateinit var id:String; var bytes:String="" }
@InvokeArg class KeyArgs { var key:String="" }
@InvokeArg class SpeechArgs { var text:String="" }
@InvokeArg class ExportArgs { lateinit var name:String; lateinit var bytes:String }

@TauriPlugin
class PlatformPlugin(private val activity:Activity):Plugin(activity) {
  private val prefs=activity.getSharedPreferences("lexilens-platform",Activity.MODE_PRIVATE)
  private var tts:TextToSpeech?=null
  private var ready=false
  private var speechInit:Invoke?=null
  private var cameraFile:File?=null
  private fun fail(invoke:Invoke)=invoke.reject("系统操作失败，请检查本机目录授权或英语声音包")
  private fun tree():DocumentFile {
    val raw=prefs.getString("tree",null)?:throw IllegalStateException()
    val uri=Uri.parse(raw)
    if(uri.authority!="com.android.externalstorage.documents")throw SecurityException()
    if(activity.contentResolver.persistedUriPermissions.none{it.uri==uri&&it.isReadPermission&&it.isWritePermission})throw SecurityException()
    return DocumentFile.fromTreeUri(activity,uri)?.takeIf{it.canRead()&&it.canWrite()}?:throw SecurityException()
  }
  private fun assetName(id:String):String { UUID.fromString(id);return "asset-$id" }
  private fun read(uri:Uri,max:Int):ByteArray=activity.contentResolver.openInputStream(uri)!!.use { stream ->
    val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(65536);var total=0
    while(true){val n=stream.read(buffer);if(n<0)break;total+=n;if(total>max)throw IllegalArgumentException();out.write(buffer,0,n)};out.toByteArray()
  }
  @Command fun chooseDirectory(invoke:Invoke){
    val intent=Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    startActivityForResult(invoke,intent,"directoryResult")
  }
  @ActivityCallback fun directoryResult(invoke:Invoke,result:ActivityResult){try{
    val uri=result.data?.data
    if(result.resultCode!=Activity.RESULT_OK||uri==null){invoke.resolve(JSObject().put("cancelled",true));return}
    if(uri.authority!="com.android.externalstorage.documents"){invoke.reject("请选择设备内部存储或SD卡中的本机文件夹");return}
    activity.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    val root=DocumentFile.fromTreeUri(activity,uri)?:throw IllegalArgumentException()
    val probe=root.createFile("application/octet-stream",".lexilens-probe-${UUID.randomUUID()}")?:throw IllegalStateException()
    activity.contentResolver.openOutputStream(probe.uri,"w")!!.use{it.write(byteArrayOf(76,76))}
    if(!read(probe.uri,10).contentEquals(byteArrayOf(76,76)))throw IllegalStateException()
    probe.delete();prefs.edit().putString("tree",uri.toString()).commit()
    invoke.resolve(JSObject().put("uri",uri.toString()))
  }catch(_:Exception){fail(invoke)}}
  @Command fun directoryStatus(invoke:Invoke){val uri=prefs.getString("tree",null);invoke.resolve(JSObject().put("uri",uri).put("available",try{tree();true}catch(_:Exception){false}))}
  @Command fun writeAsset(invoke:Invoke){try{
    val args=invoke.parseArgs(AssetArgs::class.java);val bytes=Base64.decode(args.bytes,Base64.NO_WRAP);if(bytes.size>32*1024*1024)throw IllegalArgumentException()
    val root=tree();val name=assetName(args.id);val existing=root.findFile(name)
    if(existing!=null){if(!read(existing.uri,32*1024*1024).contentEquals(bytes))throw IllegalStateException()}
    else {val file=root.createFile("application/octet-stream",name)?:throw IllegalStateException();activity.contentResolver.openOutputStream(file.uri,"w")!!.use{it.write(bytes);it.flush()};if(!read(file.uri,32*1024*1024).contentEquals(bytes))throw IllegalStateException()}
    invoke.resolve(JSObject().put("saved",true))
  }catch(_:Exception){fail(invoke)}}
  @Command fun readAsset(invoke:Invoke){try{val args=invoke.parseArgs(AssetArgs::class.java);val file=tree().findFile(assetName(args.id))?:throw IllegalStateException();invoke.resolve(JSObject().put("bytes",Base64.encodeToString(read(file.uri,32*1024*1024),Base64.NO_WRAP)))}catch(_:Exception){fail(invoke)}}
  @Command fun exportDocument(invoke:Invoke){try{val args=invoke.parseArgs(ExportArgs::class.java);if(args.name.contains('/')||args.name.contains('\\'))throw IllegalArgumentException();val bytes=Base64.decode(args.bytes,Base64.NO_WRAP);val file=tree().createFile("application/octet-stream",args.name)?:throw IllegalStateException();activity.contentResolver.openOutputStream(file.uri,"w")!!.use{it.write(bytes);it.flush()};if(!read(file.uri,180*1024*1024).contentEquals(bytes))throw IllegalStateException();invoke.resolve(JSObject().put("path",file.uri.toString()))}catch(_:Exception){fail(invoke)}}
  @Command fun importDocument(invoke:Invoke){val intent=Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(invoke,intent,"documentResult")}
  @ActivityCallback fun documentResult(invoke:Invoke,result:ActivityResult){try{val uri=result.data?.data;if(result.resultCode!=Activity.RESULT_OK||uri==null){invoke.resolve(JSObject().put("cancelled",true));return};if(uri.authority!="com.android.externalstorage.documents"){invoke.reject("请先将备份保存到本机，再导入");return};invoke.resolve(JSObject().put("bytes",Base64.encodeToString(read(uri,180*1024*1024),Base64.NO_WRAP)))}catch(_:Exception){fail(invoke)}}
  private fun encryptionKey():SecretKey {val store=KeyStore.getInstance("AndroidKeyStore");store.load(null);val alias="LexiLensApi";if(!store.containsAlias(alias)){val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey()};return store.getKey(alias,null) as SecretKey}
  @Command fun setKey(invoke:Invoke){try{val args=invoke.parseArgs(KeyArgs::class.java);if(args.key.isBlank()){prefs.edit().remove("keyCipher").remove("keyIv").commit();invoke.resolve();return};val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,encryptionKey());val bytes=args.key.trim().toByteArray(Charsets.UTF_8);val encrypted=cipher.doFinal(bytes);bytes.fill(0);if(!prefs.edit().putString("keyCipher",Base64.encodeToString(encrypted,Base64.NO_WRAP)).putString("keyIv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).commit())throw IllegalStateException();invoke.resolve()}catch(_:Exception){fail(invoke)}}
  @Command fun getKey(invoke:Invoke){try{val encrypted=prefs.getString("keyCipher",null)?:throw IllegalStateException();val iv=Base64.decode(prefs.getString("keyIv",null),Base64.NO_WRAP);val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,encryptionKey(),GCMParameterSpec(128,iv));val bytes=cipher.doFinal(Base64.decode(encrypted,Base64.NO_WRAP));invoke.resolve(JSObject().put("key",String(bytes,Charsets.UTF_8)));bytes.fill(0)}catch(_:Exception){invoke.reject("请在本机设置个人Key")}}
  @Command fun speak(invoke:Invoke){val args=invoke.parseArgs(SpeechArgs::class.java);if(args.text.length>500){invoke.reject("仅支持单词或短句发音");return};if(args.text.isEmpty()){tts?.stop();invoke.resolve();return};if(tts==null){speechInit=invoke;tts=TextToSpeech(activity){status->ready=status==TextToSpeech.SUCCESS;val pending=speechInit;speechInit=null;if(pending!=null){if(ready)say(pending,args.text)else pending.reject("语音引擎初始化失败")}}}else if(ready)say(invoke,args.text)else invoke.reject("语音引擎正在初始化，请重试")}
  private fun say(invoke:Invoke,text:String){try{val voice=tts?.voices?.firstOrNull{it.locale.language=="en"&&!it.isNetworkConnectionRequired};if(voice==null){invoke.reject("未找到本机英语声音，请在系统中安装离线英语语音包");return};tts!!.voice=voice;if(tts!!.speak(text,TextToSpeech.QUEUE_FLUSH,null,UUID.randomUUID().toString())==TextToSpeech.ERROR)invoke.reject("无法开始播放")else invoke.resolve()}catch(_:Exception){fail(invoke)}}
  @Command fun capture(invoke:Invoke){try{val directory=File(activity.cacheDir,"camera");directory.mkdirs();cameraFile=File(directory,"${UUID.randomUUID()}.jpg");val uri=FileProvider.getUriForFile(activity,activity.packageName+".lexilens.camera",cameraFile!!);val intent=Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT,uri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivityForResult(invoke,intent,"cameraResult")}catch(_:Exception){invoke.reject("拍照不可用，可改用图片导入")}}
  @ActivityCallback fun cameraResult(invoke:Invoke,result:ActivityResult){try{if(result.resultCode!=Activity.RESULT_OK){invoke.resolve(JSObject().put("cancelled",true));return};val file=cameraFile?:throw IllegalStateException();if(file.length()>32*1024*1024)throw IllegalArgumentException();invoke.resolve(JSObject().put("bytes",Base64.encodeToString(file.readBytes(),Base64.NO_WRAP)));file.delete();cameraFile=null}catch(_:Exception){invoke.reject("照片返回失败，可从系统相册重新导入")}}
}
