param([ValidateSet('windows','android','android-init','test')][string]$Target='test',[switch]$Release)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if(Test-Path '.tools/cargo/bin'){
  $env:CARGO_HOME=Join-Path $projectRoot '.tools/cargo'
  $env:RUSTUP_HOME=Join-Path $projectRoot '.tools/rustup'
  $env:PATH="$env:CARGO_HOME\bin;$env:PATH"
}
if(Test-Path '.tools/jdk'){
  $jdkDirectory=Get-ChildItem '.tools/jdk' -Directory | Select-Object -First 1
  if($jdkDirectory){$env:JAVA_HOME=$jdkDirectory.FullName;$env:PATH="$env:JAVA_HOME\bin;$env:PATH"}
}
if(Test-Path '.tools/android-sdk'){
  $env:ANDROID_HOME=Join-Path $projectRoot '.tools/android-sdk'
  $ndkDirectory=Get-ChildItem "$env:ANDROID_HOME/ndk" -Directory | Select-Object -First 1
  if($ndkDirectory){$env:NDK_HOME=$ndkDirectory.FullName}
}
$env:GRADLE_USER_HOME=Join-Path $projectRoot '.tools/gradle'
$env:CARGO_BUILD_JOBS='2'
function Run-Checked([scriptblock]$Operation){& $Operation;if($LASTEXITCODE -ne 0){throw "Command failed with exit code $LASTEXITCODE"}}
if($Target -eq 'test'){
  Run-Checked {npm run build}
  Run-Checked {npm test}
  Run-Checked {cargo test --locked --manifest-path src-tauri/Cargo.toml}
}elseif($Target -eq 'windows'){
  $cliArgs=@('run','tauri','--','build','--bundles','nsis')
  if(!$Release){$cliArgs+='--debug'}
  Run-Checked {npm @cliArgs}
}else{
  if($Target -eq 'android-init' -or !(Test-Path 'src-tauri/gen/android/gradlew.bat')){Run-Checked {npm run tauri -- android init --ci}}
  # App-private credentials and databases must not enter Android cloud backup.
  $manifestPath=Join-Path $projectRoot 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'
  $manifest=Get-Content -LiteralPath $manifestPath -Raw
  if($manifest -notmatch 'android:allowBackup='){$manifest=$manifest.Replace('<application',"<application`n        android:allowBackup=`"false`"`n        android:fullBackupContent=`"false`"")}
  Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding utf8
  if($Target -eq 'android'){
    $cliArgs=@('run','tauri','--','android','build','--target','aarch64','--apk')
    if(!$Release){$cliArgs+='--debug'}
    Run-Checked {npm @cliArgs}
  }
}
