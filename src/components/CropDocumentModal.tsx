import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import {
  cropDocumentPerspective,
  detectDocumentCorners,
  type DocumentFilterOption,
  type NormalizedCorner,
} from '../../modules/doc-engine';
import { useSafeBottom } from '../hooks/useSafeBottom';
import { COLORS, SHADOWS } from '../theme/colors';

type Quad = [NormalizedCorner, NormalizedCorner, NormalizedCorner, NormalizedCorner];

const FULL_QUAD: Quad = [
  { x: 0.02, y: 0.02 },
  { x: 0.98, y: 0.02 },
  { x: 0.98, y: 0.98 },
  { x: 0.02, y: 0.98 },
];

const DEFAULT_INSET_QUAD: Quad = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

// No inset: keeps an already cropped page exactly as it is.
const ORIGINAL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const CORNER_HIT_RADIUS = 22;
const EDGE_HIT_RADIUS = 18;

function deleteFileQuiet(uri: string | null) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // Already gone or not a file.
  }
}

const FILTERS: { label: string; value: DocumentFilterOption }[] = [
  { label: 'Original', value: 'original' },
  { label: 'Documento', value: 'document' },
  { label: 'Gris', value: 'grayscale' },
  { label: 'B/N', value: 'bw' },
];

interface CropDocumentModalProps {
  visible: boolean;
  imageUris: string[];
  title?: string;
  /** Filter selected when the sheet opens. Use "original" when re-cropping an already filtered page. */
  initialFilter?: DocumentFilterOption;
  /** Skip auto detection and start with the full frame (used when re-cropping an already cropped page). */
  autoDetect?: boolean;
  onCancel: () => void;
  onComplete: (croppedUris: string[]) => void;
}

export function CropDocumentModal({
  visible,
  imageUris,
  title = 'Recortar hoja',
  initialFilter = 'document',
  autoDetect = true,
  onCancel,
  onComplete,
}: CropDocumentModalProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = useSafeBottom();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const [corners, setCorners] = useState<Quad>(autoDetect ? DEFAULT_INSET_QUAD : ORIGINAL_QUAD);
  const [detectedAuto, setDetectedAuto] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState<DocumentFilterOption>(initialFilter);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    uri: string;
    forUri: string;
    filter: DocumentFilterOption;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [stageSize, setStageSize] = useState({ width: 300, height: 420 });
  const [imgAspect, setImgAspect] = useState(0.75);

  const cornersRef = useRef<Quad>(corners);
  cornersRef.current = corners;

  const activeHandleRef = useRef<{ kind: 'corner' | 'edge'; index: number } | null>(null);
  const dragStartCornersRef = useRef<Quad>(corners);
  const previewReqRef = useRef(0);
  const previewFileRef = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    previewReqRef.current += 1;
    const previous = previewFileRef.current;
    previewFileRef.current = null;
    setPreview(null);
    setPreviewing(false);
    deleteFileQuiet(previous);
  }, []);

  // Renders the selected filter on the full image so the handles keep their position.
  const requestPreview = useCallback(async (uri: string, next: DocumentFilterOption) => {
    const req = ++previewReqRef.current;
    if (next === 'original') {
      const previous = previewFileRef.current;
      previewFileRef.current = null;
      setPreview(null);
      setPreviewing(false);
      deleteFileQuiet(previous);
      return;
    }
    const outFile = new File(Paths.cache, `scanly_crop_preview_${Date.now()}_${req}.jpg`);
    setPreviewing(true);
    try {
      const res = await cropDocumentPerspective({
        imageUri: uri,
        corners: ORIGINAL_QUAD,
        filter: next,
        outputPath: outFile.uri,
      });
      if (previewReqRef.current !== req) {
        deleteFileQuiet(res.uri);
        return;
      }
      const previous = previewFileRef.current;
      previewFileRef.current = res.uri;
      setPreview({ uri: res.uri, forUri: uri, filter: next });
      deleteFileQuiet(previous);
    } catch {
      if (previewReqRef.current === req) setPreview(null);
    } finally {
      if (previewReqRef.current === req) setPreviewing(false);
    }
  }, []);

  const currentUri = imageUris[currentIndex] ?? null;
  const totalCount = imageUris.length;
  const activePreviewUri =
    preview && preview.forUri === currentUri && preview.filter === filter ? preview.uri : null;

  // Calcular rectángulo exacto que ocupa la imagen dentro del escenario (contain)
  const imageRect = useMemo(() => {
    const sw = Math.max(1, stageSize.width);
    const sh = Math.max(1, stageSize.height);
    const stageRatio = sw / sh;
    let drawW: number;
    let drawH: number;
    if (imgAspect > stageRatio) {
      drawW = sw;
      drawH = sw / Math.max(0.1, imgAspect);
    } else {
      drawH = sh;
      drawW = sh * imgAspect;
    }
    return {
      left: (sw - drawW) / 2,
      top: (sh - drawH) / 2,
      width: drawW,
      height: drawH,
    };
  }, [stageSize.width, stageSize.height, imgAspect]);

  const imageRectRef = useRef(imageRect);
  imageRectRef.current = imageRect;

  const runAutoDetect = useCallback(async (uri: string) => {
    setDetecting(true);
    try {
      const res = await detectDocumentCorners(uri);
      if (res.width > 0 && res.height > 0) {
        setImgAspect(res.width / res.height);
      }
      if (res.corners && res.corners.length === 4) {
        setCorners(res.corners);
        setDetectedAuto(res.detected);
      } else {
        setCorners(DEFAULT_INSET_QUAD);
        setDetectedAuto(false);
      }
    } catch {
      Image.getSize(
        uri,
        (w, h) => {
          if (w > 0 && h > 0) setImgAspect(w / h);
        },
        () => {}
      );
      setCorners(DEFAULT_INSET_QUAD);
      setDetectedAuto(false);
    } finally {
      setDetecting(false);
    }
  }, []);

  const imagesKey = useMemo(() => imageUris.join('|'), [imageUris]);

  useEffect(() => {
    if (visible && imagesKey.length > 0) {
      setCurrentIndex(0);
      setResults([]);
      setFilter(initialFilter);
      setProcessing(false);
    }
  }, [visible, imagesKey, initialFilter]);

  useEffect(() => {
    if (!visible || !currentUri) return;
    if (!autoDetect) {
      setCorners(ORIGINAL_QUAD);
      setDetectedAuto(false);
      setDetecting(false);
      Image.getSize(
        currentUri,
        (w, h) => {
          if (w > 0 && h > 0) setImgAspect(w / h);
        },
        () => {}
      );
      return;
    }
    runAutoDetect(currentUri);
  }, [visible, currentUri, autoDetect, runAutoDetect]);

  useEffect(() => () => deleteFileQuiet(previewFileRef.current), []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const rect = imageRectRef.current;
          const curr = cornersRef.current;
          const screenCorners = curr.map((c) => ({
            x: rect.left + c.x * rect.width,
            y: rect.top + c.y * rect.height,
          }));
          const screenMids = screenCorners.map((pt, i) => {
            const next = screenCorners[(i + 1) % 4];
            return { x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 };
          });

          let best: { kind: 'corner' | 'edge'; index: number } | null = null;
          let bestDist = CORNER_HIT_RADIUS;
          for (let i = 0; i < 4; i++) {
            const dist = Math.hypot(locationX - screenCorners[i].x, locationY - screenCorners[i].y);
            if (dist < bestDist) {
              bestDist = dist;
              best = { kind: 'corner', index: i };
            }
          }
          if (!best) {
            bestDist = EDGE_HIT_RADIUS;
            for (let i = 0; i < 4; i++) {
              const dist = Math.hypot(locationX - screenMids[i].x, locationY - screenMids[i].y);
              if (dist < bestDist) {
                bestDist = dist;
                best = { kind: 'edge', index: i };
              }
            }
          }

          if (best) {
            activeHandleRef.current = best;
            dragStartCornersRef.current = curr.map((c) => ({ ...c })) as Quad;
            setActiveHandle(best.kind === 'corner' ? `c${best.index}` : `e${best.index}`);
            Haptics.selectionAsync().catch(() => {});
          } else {
            activeHandleRef.current = null;
            setActiveHandle(null);
          }
        },
        onPanResponderMove: (_, gesture) => {
          const active = activeHandleRef.current;
          if (!active) return;
          const rect = imageRectRef.current;
          const start = dragStartCornersRef.current;
          const dx = gesture.dx / Math.max(1, rect.width);
          const dy = gesture.dy / Math.max(1, rect.height);
          const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

          if (active.kind === 'corner') {
            const i = active.index;
            const copy = [...start] as Quad;
            copy[i] = {
              x: clamp01(start[i].x + dx),
              y: clamp01(start[i].y + dy),
            };
            cornersRef.current = copy;
            setCorners(copy);
            return;
          }

          // Edge handle: move both corners together so the side stays parallel.
          const i = active.index;
          const j = (i + 1) % 4;
          const a = start[i];
          const b = start[j];
          const shiftX = Math.max(-Math.min(a.x, b.x), Math.min(1 - Math.max(a.x, b.x), dx));
          const shiftY = Math.max(-Math.min(a.y, b.y), Math.min(1 - Math.max(a.y, b.y), dy));
          const copy = [...start] as Quad;
          copy[i] = { x: a.x + shiftX, y: a.y + shiftY };
          copy[j] = { x: b.x + shiftX, y: b.y + shiftY };
          cornersRef.current = copy;
          setCorners(copy);
        },
        onPanResponderRelease: () => {
          activeHandleRef.current = null;
          setActiveHandle(null);
        },
        onPanResponderTerminate: () => {
          activeHandleRef.current = null;
          setActiveHandle(null);
        },
      }),
    []
  );

  const handleClose = () => {
    clearPreview();
    onCancel();
  };

  const advanceWithUri = (finalUri: string) => {
    clearPreview();
    const nextResults = [...results, finalUri];
    if (currentIndex + 1 < totalCount) {
      setResults(nextResults);
      setCurrentIndex(currentIndex + 1);
    } else {
      onComplete(nextResults);
    }
  };

  const handleApplyCrop = async () => {
    if (!currentUri || processing) return;
    try {
      setProcessing(true);
      const res = await cropDocumentPerspective({
        imageUri: currentUri,
        corners: cornersRef.current,
        filter,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      advanceWithUri(res.uri);
    } catch (err) {
      Alert.alert(
        'Error al recortar',
        err instanceof Error ? err.message : 'No se pudo aplicar el recorte a la hoja.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleUseOriginal = async () => {
    if (!currentUri || processing) return;
    try {
      setProcessing(true);
      const res = await cropDocumentPerspective({
        imageUri: currentUri,
        corners: ORIGINAL_QUAD,
        filter: 'original',
      });
      advanceWithUri(res.uri);
    } catch {
      advanceWithUri(currentUri);
    } finally {
      setProcessing(false);
    }
  };

  const screenCorners = useMemo(
    () =>
      corners.map((c) => ({
        x: imageRect.left + c.x * imageRect.width,
        y: imageRect.top + c.y * imageRect.height,
      })),
    [corners, imageRect]
  );

  const screenMids = useMemo(
    () =>
      screenCorners.map((pt, i) => {
        const next = screenCorners[(i + 1) % 4];
        return { x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 };
      }),
    [screenCorners]
  );

  const polygonPoints = useMemo(
    () => screenCorners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    [screenCorners]
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Top Bar */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            disabled={processing}
            style={styles.headerIconBtn}
            hitSlop={10}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {title}
            </Text>
            <Text numberOfLines={2} style={styles.headerSub}>
              {totalCount > 1
                ? `Imagen ${currentIndex + 1} de ${totalCount}`
                : detecting
                ? 'Detectando bordes de la hoja...'
                : detectedAuto
                ? 'Bordes detectados · Ajusta esquinas o lados'
                : 'Arrastra las esquinas o las líneas de los lados'}
            </Text>
          </View>

          <TouchableOpacity
            onPress={handleUseOriginal}
            disabled={processing || detecting}
            style={styles.skipBtn}
            hitSlop={8}
          >
            <Text style={styles.skipBtnText} numberOfLines={1}>
              Sin recorte
            </Text>
          </TouchableOpacity>
        </View>

        {/* Interactive Image + Quad Stage */}
        <View
          style={styles.stage}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setStageSize({ width, height });
            }
          }}
          {...panResponder.panHandlers}
        >
          {currentUri && (
            <Image
              source={{ uri: activePreviewUri ?? currentUri }}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: imageRect.left,
                top: imageRect.top,
                width: imageRect.width,
                height: imageRect.height,
              }}
              resizeMode="stretch"
            />
          )}

          {/* SVG Polygon, Corner & Edge Handles */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg style={StyleSheet.absoluteFill}>
              <Polygon
                points={polygonPoints}
                fill="rgba(37, 99, 235, 0.16)"
                stroke="#3B82F6"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              {screenCorners.map((pt, i) => {
                const next = screenCorners[(i + 1) % 4];
                return (
                  <Line
                    key={`edge-line-${i}`}
                    x1={pt.x}
                    y1={pt.y}
                    x2={next.x}
                    y2={next.y}
                    stroke="#60A5FA"
                    strokeWidth={1.5}
                  />
                );
              })}
              {screenMids.map((pt, i) => {
                const isActive = activeHandle === `e${i}`;
                const a = screenCorners[i];
                const b = screenCorners[(i + 1) % 4];
                const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const half = isActive ? 14 : 11;
                const ux = ((b.x - a.x) / len) * half;
                const uy = ((b.y - a.y) / len) * half;
                return (
                  <React.Fragment key={`edge-handle-${i}`}>
                    <Line
                      x1={pt.x - ux}
                      y1={pt.y - uy}
                      x2={pt.x + ux}
                      y2={pt.y + uy}
                      stroke="#FFFFFF"
                      strokeWidth={isActive ? 8 : 7}
                      strokeLinecap="round"
                    />
                    <Line
                      x1={pt.x - ux}
                      y1={pt.y - uy}
                      x2={pt.x + ux}
                      y2={pt.y + uy}
                      stroke={COLORS.primary}
                      strokeWidth={isActive ? 4 : 3}
                      strokeLinecap="round"
                    />
                  </React.Fragment>
                );
              })}
              {screenCorners.map((pt, i) => {
                const isActive = activeHandle === `c${i}`;
                return (
                  <Circle
                    key={`corner-handle-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={isActive ? 12 : 10}
                    fill="#FFFFFF"
                    stroke={COLORS.primary}
                    strokeWidth={isActive ? 4 : 3}
                  />
                );
              })}
            </Svg>
          </View>

          {(detecting || previewing) && (
            <View style={styles.detectOverlay} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.detectOverlayText}>
                {detecting ? 'Escaneando bordes...' : 'Aplicando filtro...'}
              </Text>
            </View>
          )}
        </View>

        {/* Bottom Controls */}
        <View style={[styles.footer, { paddingBottom: Math.max(16, safeBottom + 10) }]}>
          {/* Filter Pills */}
          <View style={styles.filterRow}>
            {FILTERS.map((f) => {
              const selected = filter === f.value;
              return (
                <TouchableOpacity
                  key={f.value}
                  style={[styles.filterPill, selected && styles.filterPillActive]}
                  onPress={() => {
                    const alreadyPreviewed =
                      preview?.forUri === currentUri && preview.filter === f.value;
                    if (filter === f.value && alreadyPreviewed) return;
                    Haptics.selectionAsync().catch(() => {});
                    setFilter(f.value);
                    if (currentUri) requestPreview(currentUri, f.value);
                  }}
                  disabled={processing}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[styles.filterText, selected && styles.filterTextActive]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Quick Corner Helpers + Primary Confirm */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => {
                if (currentUri) {
                  Haptics.selectionAsync().catch(() => {});
                  runAutoDetect(currentUri);
                }
              }}
              disabled={processing || detecting}
            >
              <Ionicons name="scan-outline" size={18} color="#E2E8F0" />
              <Text numberOfLines={1} style={styles.toolBtnText}>
                Auto
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolBtn}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setCorners(FULL_QUAD);
              }}
              disabled={processing || detecting}
            >
              <Ionicons name="expand-outline" size={18} color="#E2E8F0" />
              <Text numberOfLines={1} style={styles.toolBtnText}>
                Completa
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.applyBtn, (processing || detecting) && { opacity: 0.6 }]}
              onPress={handleApplyCrop}
              disabled={processing || detecting}
              activeOpacity={0.9}
            >
              {processing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={19} color="#FFFFFF" />
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.applyBtnText}>
                    {currentIndex + 1 < totalCount ? 'Siguiente' : 'Aplicar recorte'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.16)',
    gap: 10,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
    textAlign: 'center',
  },
  skipBtn: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  skipBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  stage: {
    flex: 1,
    margin: 16,
    position: 'relative',
  },
  detectOverlay: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  detectOverlayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footer: {
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.16)',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  filterPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterPillActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.24)',
    borderColor: '#3B82F6',
  },
  filterText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  filterTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toolBtn: {
    flexShrink: 0,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  toolBtnText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  applyBtn: {
    flex: 1,
    minWidth: 0,
    height: 46,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    ...SHADOWS.fab,
  },
  applyBtnText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
