#!/usr/bin/env bash
# Builds a debug APK. Needs JDK 17+ and the Android SDK (ANDROID_HOME set, or installed via Android Studio).
set -e
cd "$(dirname "$0")/android"
chmod +x gradlew
./gradlew assembleDebug
echo
echo "APK: $(pwd)/app/build/outputs/apk/debug/app-debug.apk"
