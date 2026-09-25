# LexiLens Android platform bridge

Internal Rust-to-Kotlin bridge for local Storage Access Framework directories,
Android Keystore credentials, offline English speech, and system camera capture.
There are no JavaScript plugin commands. The application backend controls all calls.

The chosen directory contains immutable images and exported backups. The live
SQLite database belongs in app-private storage. Android cloud backup is disabled
by `scripts/build.ps1`; a complete manual backup is needed before uninstalling.

Local directories are restricted to the system external-storage document provider.
The application does not request broad filesystem or direct camera permissions.
Unavailable voices, revoked directory grants, cancelled capture and read/write
failures are returned as errors, not simulated successes.
