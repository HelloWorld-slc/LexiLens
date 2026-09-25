param([ValidateSet('windows','android','android-init','test')][string]$Target='test',[switch]$Release,[uri]$GradleProxy)
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
  # Keep local Cargo symbols for debugging, but do not ship them in the test APK.
  $appBuildPath=Join-Path $projectRoot 'src-tauri/gen/android/app/build.gradle.kts'
  $appBuild=Get-Content -LiteralPath $appBuildPath -Raw
  foreach($abi in @('arm64-v8a','armeabi-v7a','x86','x86_64')){
    $appBuild=$appBuild.Replace("jniLibs.keepDebugSymbols.add(`"*/$abi/*.so`")",'')
  }
  Set-Content -LiteralPath $appBuildPath -Value $appBuild -Encoding utf8
  if($Target -eq 'android'){
    $cliArgs=@('run','tauri','--','android','build','--target','aarch64','--apk')
    if(!$Release){$cliArgs+='--debug'}
    New-Item -ItemType Directory -Force '.local' | Out-Null
    & npm @cliArgs 2>&1 | Tee-Object -FilePath '.local/android-build.log'
    $buildExit=$LASTEXITCODE
    if($buildExit -ne 0){
      $buildLog=Get-Content '.local/android-build.log' -Raw
      if($buildLog -notmatch 'Creation symbolic link is not allowed for this system'){throw "Android build failed ($buildExit); see .local/android-build.log"}
      # Only this specific post-compilation failure permits a copy fallback.
      # Compiler failures never package a stale library.
      $profile=if($Release){'release'}else{'debug'}
      $profileTitle=if($Release){'Release'}else{'Debug'}
      $libPath="src-tauri/target/aarch64-linux-android/$profile/liblexilens_lib.so"
      if(!(Test-Path -LiteralPath $libPath)){throw 'Compiled Android library is missing'}
      $jniDirectory='src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a'
      New-Item -ItemType Directory -Force $jniDirectory | Out-Null
      Copy-Item -LiteralPath $libPath -Destination "$jniDirectory/liblexilens_lib.so" -Force
      $strip=Join-Path $env:NDK_HOME 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'
      Run-Checked {& $strip --strip-debug "$jniDirectory/liblexilens_lib.so"}
      # Tauri's symlink failure happens before its resource-copy phase.
      $assets='src-tauri/gen/android/app/src/main/assets'
      New-Item -ItemType Directory -Force "$assets/third_party","$assets/docs" | Out-Null
      Copy-Item -LiteralPath 'LICENSE','THIRD_PARTY_NOTICES.md' -Destination $assets -Force
      Copy-Item -LiteralPath 'third_party/licenses' -Destination "$assets/third_party" -Recurse -Force
      Copy-Item -LiteralPath 'docs/ANDROID_DEPENDENCIES.md' -Destination "$assets/docs" -Force
      # Regenerate the output archive so an older large .so leaves no ZIP free space.
      $apkOutput="src-tauri/gen/android/app/build/outputs/apk/arm64/$profile/app-arm64-$profile.apk"
      if(Test-Path -LiteralPath $apkOutput){Remove-Item -LiteralPath $apkOutput -Force}
      $gradleArgs=@('-p','src-tauri/gen/android',"assembleArm64$profileTitle",'-x',"rustBuildArm64$profileTitle",'--no-daemon','--max-workers=2','--console=plain')
      if($GradleProxy){
        if($GradleProxy.UserInfo){throw 'Do not put proxy credentials on the command line'}
        $gradleArgs=@("-Dhttps.proxyHost=$($GradleProxy.Host)","-Dhttps.proxyPort=$($GradleProxy.Port)","-Dhttp.proxyHost=$($GradleProxy.Host)","-Dhttp.proxyPort=$($GradleProxy.Port)")+$gradleArgs
      }
      $localGradle=Get-ChildItem '.tools/gradle-runtime' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
      $gradle=if($localGradle){Join-Path $localGradle.FullName 'bin/gradle.bat'}else{'./src-tauri/gen/android/gradlew.bat'}
      Run-Checked {& $gradle @gradleArgs}
    }
  }
}
