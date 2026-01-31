# Complete technical stack for building Witness Protocol with Expo

**Development Build is mandatory** for this evidence capture app. Expo Go's limitations with camera, audio, and location native modules make it unsuitable for production-ready evidence capture. The good news: expo-camera records video with embedded audio natively—no separate audio recording library needed. With Expo SDK 54 (current stable), you get the New Architecture by default, expo-video replacing deprecated expo-av, and full TypeScript support out of the box.

## Executive summary: recommended stack

The core capture layer requires **7 Expo packages** plus UI/state management. Total client-side development time estimate: **4-6 weeks** for an MVP with video+audio+GPS capture, file management, and basic UI.

| Layer | Library | Version | Purpose |
|-------|---------|---------|---------|
| Camera/Video | expo-camera | ~17.0.10 | Video recording with embedded audio |
| Location | expo-location | ~19.0.8 | GPS tracking during capture |
| File Storage | expo-file-system | ~19.0.21 | Local file management |
| Media Library | expo-media-library | ~18.2.1 | Save to camera roll |
| Screen Wake | expo-keep-awake | ~15.0.8 | Prevent sleep during recording |
| Dev Client | expo-dev-client | Latest | Required for native module access |
| Navigation | expo-router | Bundled | File-based routing |
| UI Framework | React Native Paper | 5.x | Material Design 3 components |
| State | Zustand + MMKV | 4.x / 3.x | Persistent state management |
| Animations | react-native-reanimated | ~3.17.x | Recording indicators, transitions |

---

## Project initialization and M2 Mac setup

### Development environment checklist

Before creating the project, verify your M2 Mac environment:

```bash
# Verify Node.js (18+ required)
node --version

# Install EAS CLI globally
npm install -g eas-cli

# Verify Xcode (16.1+ required for SDK 52+)
xcode-select -p
xcodebuild -version

# Install CocoaPods (if not present)
brew install cocoapods

# Install Watchman for file watching
brew install watchman
```

Apple Silicon (M2) is fully supported with no Rosetta required. EAS Build now offers M4 Pro workers for faster cloud builds—configure via `resourceClass: "m-medium"` in eas.json.

### Creating the project with TypeScript

```bash
# Create new Expo project (TypeScript included by default)
npx create-expo-app@latest witness-protocol

cd witness-protocol

# Install dev client first (enables development builds)
npx expo install expo-dev-client

# Install capture layer packages
npx expo install expo-camera expo-location expo-file-system expo-media-library expo-keep-awake

# Install UI and state management
npx expo install react-native-paper react-native-safe-area-context
npm install zustand react-native-mmkv
```

### Project structure recommendation

```
witness-protocol/
├── app/                          # Expo Router (file-based routing)
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Tab navigator
│   │   ├── index.tsx             # Home/Dashboard
│   │   ├── capture.tsx           # Evidence capture screen
│   │   └── recordings.tsx        # Saved recordings list
│   ├── _layout.tsx               # Root layout
│   └── recording/[id].tsx        # Recording detail view
├── components/
│   ├── capture/
│   │   ├── CameraPreview.tsx
│   │   ├── RecordingControls.tsx
│   │   └── GPSOverlay.tsx
│   └── ui/
├── hooks/
│   ├── useRecording.ts           # Recording state logic
│   ├── useLocationTracking.ts    # GPS tracking hook
│   └── usePermissions.ts         # Unified permission handling
├── store/
│   ├── recordingStore.ts         # Zustand store
│   └── storage.ts                # MMKV setup
├── utils/
│   ├── fileManager.ts            # File operations
│   └── metadata.ts               # GPS/timestamp handling
├── app.json
├── eas.json
└── tsconfig.json
```

---

## Video and camera capture with expo-camera

The **CameraView component** from expo-camera handles both video and audio capture. Setting `mode="video"` and `mute={false}` (default) records video with embedded audio—eliminating the need for expo-av audio recording.

### Camera configuration options

| Property | Recommended Value | Purpose |
|----------|-------------------|---------|
| `mode` | `"video"` | Enable video recording |
| `facing` | `"back"` (default) | Primary evidence capture |
| `mute` | `false` (default) | Include audio in video |
| `videoQuality` | `"1080p"` | Balance quality/file size |
| `videoStabilizationMode` | `"auto"` | Reduce shake in handheld recording |
| `enableTorch` | User-controlled | Low-light situations |

Video quality options available: `"2160p"` (4K), `"1080p"`, `"720p"`, `"480p"` (Android only), `"4:3"`. For evidence capture, **1080p provides the optimal balance** of quality and storage efficiency.

### Complete recording implementation

```tsx
import { useState, useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

interface RecordingMetadata {
  startTime: string;
  startLocation: Location.LocationObjectCoords | null;
  locationTrack: Location.LocationObject[];
}

export function EvidenceCaptureScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [isRecording, setIsRecording] = useState(false);
  const [metadata, setMetadata] = useState<RecordingMetadata | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const startRecording = async () => {
    if (!cameraRef.current) return;

    // Prevent screen sleep
    activateKeepAwake('evidence-recording');
    setIsRecording(true);

    // Get initial GPS position
    const initialLocation = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const recordingMetadata: RecordingMetadata = {
      startTime: new Date().toISOString(),
      startLocation: initialLocation.coords,
      locationTrack: [initialLocation],
    };
    setMetadata(recordingMetadata);

    // Start continuous GPS tracking
    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
      (location) => {
        setMetadata(prev => prev ? {
          ...prev,
          locationTrack: [...prev.locationTrack, location]
        } : null);
      }
    );

    try {
      // recordAsync captures BOTH video and audio
      const video = await cameraRef.current.recordAsync({
        maxDuration: 300,        // 5 minutes max
        maxFileSize: 500_000_000, // 500MB max
        codec: 'avc1',           // H.264 for compatibility (iOS only)
      });

      await saveEvidence(video.uri, recordingMetadata);
    } catch (error) {
      console.error('Recording failed:', error);
    }
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
    locationSubscription.current?.remove();
    deactivateKeepAwake('evidence-recording');
    setIsRecording(false);
  };

  const saveEvidence = async (videoUri: string, meta: RecordingMetadata) => {
    const timestamp = Date.now();
    const filename = `evidence_${timestamp}.mp4`;
    const metaFilename = `evidence_${timestamp}_meta.json`;

    // Copy from cache to documents directory
    await FileSystem.copyAsync({
      from: videoUri,
      to: FileSystem.documentDirectory + filename,
    });

    // Save GPS metadata alongside video
    await FileSystem.writeAsStringAsync(
      FileSystem.documentDirectory + metaFilename,
      JSON.stringify({
        ...meta,
        endTime: new Date().toISOString(),
        filename,
      })
    );
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="video"
        mute={false}
        videoQuality="1080p"
        videoStabilizationMode="auto"
      />
      {/* Recording controls rendered on top */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
});
```

### Critical limitation: camera switching stops recording

Calling `setFacing()` to flip between front/back cameras **immediately terminates any active recording**. Design the UI to disable camera switching during recording, or warn users that flipping will create a new recording segment.

### iOS-specific video codecs

On iOS, specify `codec` in `recordAsync()` options:
- **`avc1`** (H.264): Maximum compatibility, recommended for evidence
- **`hvc1`** (HEVC/H.265): 40% smaller files, requires iOS 11+ playback
- **`apcn`** (ProRes 422): Professional quality, very large files

---

## GPS location tracking with expo-location

For evidence capture, **foreground-only tracking is sufficient**—the app will be active during recording. This means you don't need expo-task-manager or background location permissions, simplifying both implementation and user permission flows.

### Accuracy modes for evidence capture

| Mode | Precision | Battery Impact | Use Case |
|------|-----------|----------------|----------|
| `Accuracy.Lowest` | ~3 km | Minimal | City-level only |
| `Accuracy.Low` | ~1 km | Very Low | Regional tracking |
| `Accuracy.Balanced` | ~100 m | Moderate | General use |
| `Accuracy.High` | ~10 m | Higher | **Evidence capture** |
| `Accuracy.Highest` | Best device capability | High | Precise tracking |
| `Accuracy.BestForNavigation` | Maximum + sensor fusion | Maximum | Turn-by-turn |

**Recommended for evidence: `Accuracy.High`** provides ~10m precision with reasonable battery consumption. `BestForNavigation` adds unnecessary battery drain for stationary or slow-moving recording scenarios.

### Location tracking hook

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';

interface LocationPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export function useLocationTracking() {
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [locationHistory, setLocationHistory] = useState<LocationPoint[]>([]);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const startTracking = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return false;

    const initial = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const point = extractLocationPoint(initial);
    setCurrentLocation(point);
    setLocationHistory([point]);

    subscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,   // Every 5 seconds
        distanceInterval: 5,  // Or every 5 meters moved
      },
      (location) => {
        const newPoint = extractLocationPoint(location);
        setCurrentLocation(newPoint);
        setLocationHistory(prev => [...prev, newPoint]);
      }
    );

    setIsTracking(true);
    return true;
  }, []);

  const stopTracking = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setIsTracking(false);
  }, []);

  useEffect(() => {
    return () => subscriptionRef.current?.remove();
  }, []);

  return { isTracking, currentLocation, locationHistory, startTracking, stopTracking };
}

function extractLocationPoint(loc: Location.LocationObject): LocationPoint {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    altitude: loc.coords.altitude,
    accuracy: loc.coords.accuracy,
    speed: loc.coords.speed,
    heading: loc.coords.heading,
    timestamp: loc.timestamp,
  };
}
```

### Expo Go vs Development Build for location

| Feature | Expo Go | Development Build |
|---------|---------|-------------------|
| Foreground location | ✅ Full support | ✅ Full support |
| watchPositionAsync | ✅ Works | ✅ Works |
| Background location | ❌ Not available | ✅ Requires config |
| expo-task-manager | ❌ Android unavailable | ✅ Full support |

For Witness Protocol's foreground-only use case, Expo Go works during development. Switch to Development Build for production testing and release.

---

## File management and storage strategy

### expo-file-system directory structure

```
/documents/                          # Persistent, survives app updates
├── recordings/
│   ├── 2026-01-30/
│   │   ├── evidence_1706640000000.mp4
│   │   ├── evidence_1706640000000_meta.json
│   │   └── evidence_1706643600000.mp4
│   └── 2026-01-31/
├── exports/                         # Prepared for sharing
└── thumbnails/

/cache/                              # Can be purged by system
├── temp/
│   └── recording_in_progress.mp4   # Active recording location
└── processing/
```

iOS has no hard storage limits—constrained only by device capacity. However, implement cleanup strategies for large video files to prevent filling user storage.

### File manager utility

```tsx
import { File, Directory, Paths } from 'expo-file-system';

const RECORDINGS_DIR = new Directory(Paths.document, 'recordings');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function initializeStorage() {
  if (!RECORDINGS_DIR.exists) {
    RECORDINGS_DIR.create();
  }
}

export async function saveRecording(tempUri: string, metadata: object) {
  const timestamp = Date.now();
  const dateFolder = new Date().toISOString().split('T')[0];
  
  const dayDir = new Directory(RECORDINGS_DIR, dateFolder);
  if (!dayDir.exists) {
    dayDir.create();
  }

  const videoFile = new File(Paths.cache, tempUri.split('/').pop()!);
  const destVideo = new File(dayDir, `evidence_${timestamp}.mp4`);
  const destMeta = new File(dayDir, `evidence_${timestamp}_meta.json`);

  videoFile.move(dayDir);
  destMeta.write(JSON.stringify(metadata, null, 2));

  return { videoPath: destVideo.uri, metaPath: destMeta.uri };
}

export async function cleanupOldCache() {
  const cacheDir = new Directory(Paths.cache, 'temp');
  if (!cacheDir.exists) return;

  const now = Date.now();
  for (const item of cacheDir.list()) {
    if (item instanceof File && item.modificationTime) {
      if (now - item.modificationTime > CACHE_MAX_AGE_MS) {
        item.delete();
      }
    }
  }
}
```

### Saving to camera roll with expo-media-library

```tsx
import * as MediaLibrary from 'expo-media-library';

export async function saveToGallery(videoUri: string, albumName = 'Witness Protocol') {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') return null;

  const asset = await MediaLibrary.createAssetAsync(videoUri);
  const album = await MediaLibrary.getAlbumAsync(albumName);

  if (album) {
    await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
  } else {
    await MediaLibrary.createAlbumAsync(albumName, asset, false);
  }

  return asset;
}
```

---

## State management with Zustand and MMKV

MMKV is **~30x faster than AsyncStorage** and supports synchronous operations. Combined with Zustand's minimal boilerplate, this creates an efficient persistence layer.

### MMKV storage setup

```tsx
// store/storage.ts
import { MMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';

export const storage = new MMKV({
  id: 'witness-protocol-storage',
  encryptionKey: 'your-secure-encryption-key', // Optional
});

export const mmkvStorage: StateStorage = {
  setItem: (key, value) => storage.set(key, value),
  getItem: (key) => storage.getString(key) ?? null,
  removeItem: (key) => storage.delete(key),
};
```

### Recording store with persistence

```tsx
// store/recordingStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './storage';

interface Recording {
  id: string;
  filename: string;
  videoPath: string;
  metaPath: string;
  duration: number;
  createdAt: number;
  location: { lat: number; lng: number } | null;
}

interface RecordingState {
  recordings: Recording[];
  isRecording: boolean;
  addRecording: (recording: Omit<Recording, 'id' | 'createdAt'>) => void;
  removeRecording: (id: string) => void;
  setRecording: (value: boolean) => void;
}

export const useRecordingStore = create<RecordingState>()(
  persist(
    (set) => ({
      recordings: [],
      isRecording: false,

      addRecording: (recording) =>
        set((state) => ({
          recordings: [
            ...state.recordings,
            { ...recording, id: Date.now().toString(), createdAt: Date.now() },
          ],
        })),

      removeRecording: (id) =>
        set((state) => ({
          recordings: state.recordings.filter((r) => r.id !== id),
        })),

      setRecording: (value) => set({ isRecording: value }),
    }),
    {
      name: 'recordings',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
```

---

## UI libraries and navigation setup

### React Native Paper configuration

React Native Paper provides Material Design 3 components ideal for rapid prototyping—pre-built FABs for recording, cards for evidence display, and excellent accessibility.

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { PaperProvider, MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#dc2626',      // Red for recording emphasis
    secondary: '#1d4ed8',
    error: '#ef4444',
  },
};

const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#f87171',
    secondary: '#60a5fa',
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={colorScheme === 'dark' ? darkTheme : lightTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
```

### Recording indicator with Reanimated

```tsx
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

export function RecordingIndicator({ isRecording }: { isRecording: boolean }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (isRecording) {
      opacity.value = withRepeat(withTiming(0.3, { duration: 500 }), -1, true);
    } else {
      opacity.value = 1;
    }
  }, [isRecording]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!isRecording) return null;

  return (
    <Animated.View style={[styles.indicator, animatedStyle]}>
      <View style={styles.redDot} />
      <Text style={styles.text}>REC</Text>
    </Animated.View>
  );
}
```

---

## Permissions handling (SDK 52+)

The `expo-permissions` package is **deprecated**. Use module-specific permission methods instead.

### Unified permissions hook

```tsx
// hooks/usePermissions.ts
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { Linking, Alert } from 'react-native';

export function usePermissions() {
  const [cameraPermission, requestCamera] = Camera.useCameraPermissions();
  const [micPermission, requestMic] = Camera.useMicrophonePermissions();

  const requestAllPermissions = async () => {
    const camera = await requestCamera();
    const mic = await requestMic();
    const location = await Location.requestForegroundPermissionsAsync();
    const media = await MediaLibrary.requestPermissionsAsync();

    const allGranted =
      camera.granted &&
      mic.granted &&
      location.status === 'granted' &&
      media.status === 'granted';

    if (!allGranted) {
      Alert.alert(
        'Permissions Required',
        'Witness Protocol needs camera, microphone, location, and photo library access to capture evidence.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
    }

    return allGranted;
  };

  return {
    cameraGranted: cameraPermission?.granted ?? false,
    micGranted: micPermission?.granted ?? false,
    requestAllPermissions,
  };
}
```

### app.json permissions configuration

```json
{
  "expo": {
    "name": "Witness Protocol",
    "slug": "witness-protocol",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.yourcompany.witnessprotocol",
      "supportsTablet": false,
      "infoPlist": {
        "NSCameraUsageDescription": "Witness Protocol uses the camera to capture video evidence.",
        "NSMicrophoneUsageDescription": "Witness Protocol uses the microphone to record audio with video evidence.",
        "NSLocationWhenInUseUsageDescription": "Witness Protocol tags evidence with your location for verification.",
        "NSPhotoLibraryAddUsageDescription": "Witness Protocol saves captured evidence to your photo library."
      }
    },
    "android": {
      "package": "com.yourcompany.witnessprotocol",
      "permissions": [
        "CAMERA",
        "RECORD_AUDIO",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION"
      ]
    },
    "plugins": [
      [
        "expo-camera",
        {
          "cameraPermission": "Allow Witness Protocol to capture video evidence",
          "microphonePermission": "Allow Witness Protocol to record audio evidence",
          "recordAudioAndroid": true
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "Allow Witness Protocol to geotag evidence"
        }
      ],
      [
        "expo-media-library",
        {
          "savePhotosPermission": "Allow Witness Protocol to save evidence to your library",
          "isAccessMediaLocationEnabled": true
        }
      ]
    ]
  }
}
```

---

## EAS Build and iOS testing workflow

### eas.json configuration

```json
{
  "cli": {
    "version": ">= 10.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "resourceClass": "m-medium",
        "simulator": false
      }
    },
    "ios-simulator": {
      "extends": "development",
      "ios": {
        "simulator": true
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "resourceClass": "m-medium"
      }
    },
    "production": {
      "autoIncrement": "version"
    }
  }
}
```

### iOS testing workflow from M2 Mac

**Initial setup (one-time):**

```bash
# 1. Login to Expo
eas login

# 2. Configure EAS for project
eas build:configure

# 3. Register your iPhone 12
eas device:create
# Follow prompts to add device UDID

# 4. Build development client for physical device
eas build --profile development --platform ios
# This takes 10-20 minutes on EAS servers
```

**Daily development:**

```bash
# Start dev server with development client mode
npx expo start --dev-client

# Scan QR code with iPhone camera
# App loads in your development build (not Expo Go)
```

**When to rebuild the development client:**
- Adding new native packages (e.g., `expo-camera`)
- Changing permissions in app.json
- Updating Expo SDK version
- Modifying any iOS/Android native configuration

### Simulator limitations for evidence capture

| Feature | iOS Simulator | Android Emulator | Physical Device |
|---------|---------------|------------------|-----------------|
| Camera capture | ❌ No | ✅ Yes (webcam) | ✅ Required |
| Audio recording | ❌ No | ✅ Yes (host mic) | ✅ Required |
| GPS location | ✅ Simulated | ✅ Simulated | ✅ Real GPS |
| UI testing | ✅ Yes | ✅ Yes | ✅ Yes |
| Performance testing | ❌ Inaccurate | ❌ Inaccurate | ✅ Required |

**For Witness Protocol: physical iPhone testing is mandatory** for camera and audio features. Use simulator only for UI/navigation development.

---

## PWA fallback considerations

Expo supports web export, but **native features degrade significantly**:

| Feature | Native App | PWA/Web |
|---------|------------|---------|
| Camera capture | ✅ Full | ⚠️ Limited (desktop Chrome only reliable) |
| Audio recording | ✅ Full | ⚠️ Browser-dependent, encoding issues |
| GPS location | ✅ Full | ✅ Works via Geolocation API |
| File system | ✅ Full | ⚠️ Limited to IndexedDB |
| Offline capability | ✅ Full | ⚠️ Requires manual service worker |
| Background tasks | ✅ Configurable | ❌ Not available |

**Recommendation: Treat PWA as emergency fallback only.** The evidence capture use case requires reliable camera/audio—native apps deliver this consistently while mobile web browsers have documented issues with expo-camera (particularly Chrome on Android).

If PWA support is needed, implement feature detection:

```tsx
import { Platform } from 'react-native';

function CaptureScreen() {
  if (Platform.OS === 'web') {
    return <WebFallbackUI />;  // Show "Download app for full features"
  }
  return <NativeCaptureUI />;
}
```

---

## Development time estimates

| Component | Estimated Time | Notes |
|-----------|----------------|-------|
| Project setup & config | 4-8 hours | EAS, permissions, TypeScript |
| Camera capture screen | 16-24 hours | Recording, preview, controls |
| GPS tracking integration | 8-12 hours | Hook, overlay, metadata |
| File management | 12-16 hours | Storage, cleanup, organization |
| State management | 8-12 hours | Zustand, persistence, sync |
| UI/navigation | 16-24 hours | Screens, components, animations |
| Permissions flow | 8-12 hours | Requests, denial handling |
| Testing & debugging | 16-24 hours | Physical device, edge cases |
| **Total MVP** | **4-6 weeks** | Single developer |

---

## Known limitations and workarounds

**No chunked/streaming recording:** expo-camera's `recordAsync` produces a single file. Workaround: use `maxDuration` to auto-stop and restart recording at intervals (brief gaps between chunks).

**Camera flip stops recording:** Cannot switch front/back during active recording. Workaround: disable flip button during recording, or implement segmented recording that creates new file on flip.

**expo-av deprecation:** `expo-av` is deprecated in SDK 52, removed in SDK 55. For audio-only recording, use `expo-audio`. For video playback, use `expo-video`.

**Expo Go limitations:** Background location and TaskManager don't work in Expo Go on Android. Use Development Build for production-like testing.

**iOS audio session conflicts:** Recording video can interrupt other audio apps. This is expected iOS behavior—document it for users.

---

## Reference repositories and documentation

- **Expo Camera docs:** https://docs.expo.dev/versions/latest/sdk/camera/
- **Expo Location docs:** https://docs.expo.dev/versions/latest/sdk/location/
- **Expo File System docs:** https://docs.expo.dev/versions/latest/sdk/file-system/
- **EAS Build guide:** https://docs.expo.dev/develop/development-builds/create-a-build/
- **Expo SDK 52 changelog:** https://expo.dev/changelog/2024-11-12-sdk-52
- **React Native Paper:** https://callstack.github.io/react-native-paper/
- **Zustand:** https://github.com/pmndrs/zustand
- **MMKV:** https://github.com/mrousavy/react-native-mmkv

For similar implementations, search GitHub for "expo camera recording" and "react native evidence capture" to find community examples of video recording apps with GPS integration.