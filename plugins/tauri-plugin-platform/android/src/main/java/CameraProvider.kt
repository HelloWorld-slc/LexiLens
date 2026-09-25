package io.lexilens.platform

import androidx.core.content.FileProvider

// A distinct provider avoids merging camera-only grants into Tauri's file provider.
class CameraProvider : FileProvider()
