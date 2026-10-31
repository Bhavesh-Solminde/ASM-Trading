import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { router, useIsFocused } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryClient } from "@/api/queries";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { cameraFacing, captureHintKey, captureTitleKey, cameraMounted, guideBox, permissionView, scrimRects, shutterEnabled, torchAvailable, type Size } from "./capture-model";
import type { Compressed } from "./compress";
import { compressForUpload } from "./compress-native";
import type { KycDocKind } from "./kyc-flow";
import { submitPhoto } from "./submit-photo";
import { uploadKycDocument } from "./upload";

interface Shot {
  uri: string;
  width: number;
  height: number;
}

const BLACK = "#000000";
const SCRIM = "rgba(0,0,0,0.62)";
const GUIDE_BORDER = "rgba(255,255,255,0.88)";

function closeScreen() {
  if (router.canGoBack()) router.back();
  else router.replace("/account/verify");
}

/** Close (44pt), the title, and room for the torch: the title is centred between two 44pt slots. */
function TopRow({ title, top, aside }: { title: string; top: number; aside?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, zIndex: 2 }}>
      <Pressable testID="kyc-close" accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={closeScreen} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={22} color="#ffffff" strokeWidth={2} />
      </Pressable>
      <Txt accessibilityRole="header" size={17} weight={600} color="#ffffff" numberOfLines={2} style={{ flex: 1, textAlign: "center" }}>
        {title}
      </Txt>
      <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>{aside}</View>
    </View>
  );
}

/** One of the four saffron corner brackets of the card guide: 26pt, 4pt line, rounded on the outer corner. */
function Bracket({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const top = corner === "tl" || corner === "tr";
  const left = corner === "tl" || corner === "bl";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 26,
        height: 26,
        [top ? "top" : "bottom"]: -4,
        [left ? "left" : "right"]: -4,
        borderColor: color.saffron,
        [top ? "borderTopWidth" : "borderBottomWidth"]: 4,
        [left ? "borderLeftWidth" : "borderRightWidth"]: 4,
        [`border${top ? "Top" : "Bottom"}${left ? "Left" : "Right"}Radius`]: 12,
      }}
    />
  );
}

/**
 * The KYC camera (N-KycCamera): a full-screen black screen. Permission through expo-camera's hook; denied shows
 * "Allow camera" while Android can still ask, else "Open settings" (Settings and back re-reads the permission). The
 * gallery is always offered. The back camera is for documents, the front one for the selfie; the torch is for
 * documents. The camera mounts only while this screen is focused and not previewing, so it is released the moment the
 * user leaves or has a photo. "Use photo" compresses, uploads (one tap at a time, Retry on failure), refetches the
 * profile and goes back to Verify. No audio is requested.
 */
export function CaptureScreen({ kind }: { kind: KycDocKind }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [perm, requestPermission, refreshPermission] = useCameraPermissions();
  const view = permissionView(perm);
  const camera = useRef<CameraView>(null);
  const [area, setArea] = useState<Size | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The compressed file of the current photo, kept so a Retry after a failed upload does not encode again.
  const compressed = useRef<Compressed | null>(null);
  const inFlight = useRef(false);
  const cameraOn = cameraMounted({ view, focused, hasShot: shot !== null });

  // `cameraReady` belongs to one mount of the CameraView: when it unmounts (blur, a photo to preview, permission
  // lost) the next mount starts not-ready, so a quick tap after refocus cannot call takePictureAsync too early.
  useEffect(() => {
    if (!cameraOn) setCameraReady(false);
  }, [cameraOn]);

  // Coming back from the system Settings screen (where the user may have allowed the camera) re-reads the permission.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const keep = (next: Shot | null) => {
    compressed.current = null;
    setError(null);
    setShot(next);
  };

  const take = async () => {
    if (!shutterEnabled({ mounted: cameraOn, ready: cameraReady, capturing }) || !camera.current) return;
    setCapturing(true);
    try {
      const p = await camera.current.takePictureAsync({ quality: 1, skipProcessing: false, exif: false });
      keep({ uri: p.uri, width: p.width, height: p.height });
    } catch {
      toast(t("common.genericError"), "down");
    } finally {
      setCapturing(false);
    }
  };

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsEditing: false });
      const asset = res.canceled ? undefined : res.assets[0];
      if (asset) keep({ uri: asset.uri, width: asset.width, height: asset.height });
    } catch {
      toast(t("common.genericError"), "down");
    }
  };

  const sendPhoto = async () => {
    if (!shot || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const out = await submitPhoto({
      cached: compressed.current,
      compress: () => compressForUpload(shot.uri, shot.width, shot.height),
      upload: (uri) => uploadKycDocument(kind, uri),
      t,
    });
    compressed.current = out.compressed;
    if (out.status === "done") {
      // Stay busy while leaving, so a tap on the way out cannot upload twice; Verify reads the new photo from the profile.
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      closeScreen();
      return;
    }
    setError(out.message);
    inFlight.current = false;
    setBusy(false);
  };

  const title = t(captureTitleKey(kind));
  const topInset = insets.top + 8;

  // Photo taken or picked: show it, with Use photo / Retake.
  if (shot) {
    return (
      <View style={{ flex: 1, backgroundColor: BLACK }}>
        <TopRow title={title} top={topInset} />
        <View style={{ flex: 1, paddingTop: topInset + 52 }}>
          <Image testID="kyc-preview" accessibilityIgnoresInvertColors source={{ uri: shot.uri }} resizeMode="contain" style={{ flex: 1 }} />
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 + insets.bottom, gap: 10 }}>
          {busy ? (
            <Txt testID="kyc-uploading" size={14} color={color.cameraInk} style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
              {t("kyc.uploading")}
            </Txt>
          ) : null}
          {error ? (
            <Txt testID="kyc-upload-error" size={14} color={color.downText} style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
              {error}
            </Txt>
          ) : null}
          <Button testID="kyc-use-photo" kind="light" label={error ? t("common.retry") : t("kyc.usePhoto")} busy={busy} onPress={() => void sendPhoto()} />
          <Button testID="kyc-retake" kind="secondary" label={t("kyc.retake")} disabled={busy} onPress={() => keep(null)} />
        </View>
      </View>
    );
  }

  // No permission yet: ask, or point to Settings after a permanent denial. The gallery stays available.
  if (view === "ask" || view === "settings") {
    return (
      <View style={{ flex: 1, backgroundColor: BLACK }}>
        <TopRow title={title} top={topInset} />
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20, gap: 16 }}>
          <Txt size={16} color={color.cameraInk} style={{ textAlign: "center" }}>
            {t("kyc.cameraNeeded")}
          </Txt>
          {view === "ask" ? (
            <Button testID="kyc-allow-camera" kind="light" label={t("kyc.allowCamera")} onPress={() => void requestPermission()} />
          ) : (
            <Button testID="kyc-open-settings" kind="light" label={t("kyc.openSettings")} onPress={() => void Linking.openSettings()} />
          )}
          <Button testID="kyc-gallery" kind="secondary" label={t("kyc.useGallery")} onPress={() => void pickFromGallery()} />
        </View>
        <View style={{ height: 28 + insets.bottom }} />
      </View>
    );
  }

  const box = area ? guideBox(kind, area) : null;
  const shutterOn = shutterEnabled({ mounted: cameraOn, ready: cameraReady, capturing });
  return (
    <View style={{ flex: 1, backgroundColor: BLACK }}>
      <View style={{ flex: 1, backgroundColor: "#0b0d10" }} onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        {cameraOn ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={cameraFacing(kind)}
            enableTorch={torchAvailable(kind) && torch}
            autofocus="on"
            onCameraReady={() => setCameraReady(true)}
            onMountError={() => toast(t("common.genericError"), "down")}
          />
        ) : null}
        {area && box ? (
          <>
            {box.shape === "card"
              ? scrimRects(box, area).map((r, i) => <View key={i} pointerEvents="none" style={{ position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height, backgroundColor: SCRIM }} />)
              : null}
            <View
              pointerEvents="none"
              style={{ position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height, borderRadius: box.radius, borderWidth: 2, borderColor: GUIDE_BORDER }}
            >
              {box.shape === "card" ? (
                <>
                  <Bracket corner="tl" />
                  <Bracket corner="tr" />
                  <Bracket corner="bl" />
                  <Bracket corner="br" />
                </>
              ) : null}
            </View>
            <Txt pointerEvents="none" size={16} color={color.cameraInk} style={{ position: "absolute", left: 28, right: 28, top: box.y + box.height + 24, textAlign: "center" }}>
              {t(captureHintKey(kind))}
            </Txt>
          </>
        ) : null}
        <TopRow
          title={title}
          top={topInset}
          aside={
            torchAvailable(kind) ? (
              <Pressable
                testID="kyc-torch"
                accessibilityRole="button"
                accessibilityLabel={t("kyc.torch")}
                accessibilityState={{ selected: torch }}
                onPress={() => setTorch((v) => !v)}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="flashlight" size={22} color={torch ? color.saffron : "#ffffff"} />
              </Pressable>
            ) : null
          }
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingTop: 20, paddingBottom: 34 + insets.bottom, backgroundColor: BLACK }}>
        <Pressable
          testID="kyc-gallery"
          accessibilityRole="button"
          accessibilityLabel={t("kyc.gallery")}
          onPress={() => void pickFromGallery()}
          style={{ width: 64, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 4 }}
        >
          <Icon name="image" size={24} color={color.ink2} />
          <Txt size={13} color={color.ink2} numberOfLines={1}>
            {t("kyc.gallery")}
          </Txt>
        </Pressable>
        <Pressable
          testID="kyc-capture"
          accessibilityRole="button"
          accessibilityLabel={t("kyc.capture")}
          accessibilityState={{ disabled: !shutterOn, busy: capturing }}
          disabled={!shutterOn}
          onPress={() => void take()}
          style={{ width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: "#ffffff", padding: 5, opacity: shutterOn ? 1 : 0.5 }}
        >
          <View style={{ flex: 1, borderRadius: 30, backgroundColor: "#ffffff" }} />
        </Pressable>
        <View style={{ width: 64 }} />
      </View>
    </View>
  );
}
