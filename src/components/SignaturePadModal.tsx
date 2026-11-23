import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  renderSignaturePng,
  type StrokePoint,
  type StyledStroke,
} from '../../modules/doc-engine';
import {
  deleteSignatureRecord,
  getSignatureOutputPath,
  getSignatures,
  saveSignatureRecord,
} from '../storage/database';
import type { SignatureRecord } from '../types/models';
import { EmptyStateIllustration } from './EmptyStateIllustration';
import { useSafeBottom } from '../hooks/useSafeBottom';
import { COLORS, SHADOWS } from '../theme/colors';

interface SignaturePadModalProps {
  visible: boolean;
  initialTab?: 'saved' | 'new';
  onClose: () => void;
  onCreated: (signature: SignatureRecord) => void;
  onChanged?: () => void;
}

const INK_COLORS = [
  { label: 'Marino', value: '#0F172A' },
  { label: 'Azul', value: '#1D4ED8' },
  { label: 'Negro', value: '#111827' },
];

const STROKE_WIDTHS = [
  { label: 'Fino', value: 3 },
  { label: 'Medio', value: 5.5 },
  { label: 'Grueso', value: 8.5 },
];

function strokeToSvgPath(points: StrokePoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${(p.x + 0.5).toFixed(1)} ${(p.y + 0.5).toFixed(1)}`;
  }
  // Catmull-Rom: the curve passes through every sampled point, so the ink keeps its shape.
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function SignaturePadModal({
  visible,
  initialTab = 'new',
  onClose,
  onCreated,
  onChanged,
}: SignaturePadModalProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = useSafeBottom();
  const [activeTab, setActiveTab] = useState<'saved' | 'new'>(initialTab);
  const [savedSignatures, setSavedSignatures] = useState<SignatureRecord[]>([]);

  const [name, setName] = useState('');
  const [inkColor, setInkColor] = useState(INK_COLORS[0].value);
  const [strokeWidth, setStrokeWidth] = useState(STROKE_WIDTHS[1].value);
  const [strokes, setStrokes] = useState<StyledStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<StrokePoint[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 240 });
  const [saving, setSaving] = useState(false);

  const currentStrokeRef = useRef<StrokePoint[]>([]);
  const styleRef = useRef({ color: inkColor, width: strokeWidth });
  styleRef.current = { color: inkColor, width: strokeWidth };
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  const loadSaved = () => {
    const list = getSignatures();
    setSavedSignatures(list);
    return list;
  };

  useEffect(() => {
    if (visible) {
      const list = loadSaved();
      if (initialTab === 'saved' && list.length === 0) {
        setActiveTab('new');
      } else {
        setActiveTab(initialTab);
      }
    }
  }, [visible, initialTab]);

  const clampPoint = (x: number, y: number): StrokePoint => ({
    x: Math.max(0, Math.min(canvasSizeRef.current.width, x)),
    y: Math.max(0, Math.min(canvasSizeRef.current.height, y)),
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          setDrawing(true);
          const { locationX, locationY } = evt.nativeEvent;
          const pt = clampPoint(locationX, locationY);
          currentStrokeRef.current = [pt];
          setCurrentStroke([pt]);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const pt = clampPoint(locationX, locationY);
          const prev = currentStrokeRef.current[currentStrokeRef.current.length - 1];
          if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 1.5) {
            return;
          }
          currentStrokeRef.current = [...currentStrokeRef.current, pt];
          setCurrentStroke(currentStrokeRef.current);
        },
        onPanResponderRelease: () => {
          setDrawing(false);
          if (currentStrokeRef.current.length > 0) {
            const finished: StyledStroke = {
              points: currentStrokeRef.current,
              color: styleRef.current.color,
              width: styleRef.current.width,
            };
            setStrokes((prev) => [...prev, finished]);
          }
          currentStrokeRef.current = [];
          setCurrentStroke([]);
        },
        onPanResponderTerminate: () => {
          setDrawing(false);
          if (currentStrokeRef.current.length > 0) {
            const finished: StyledStroke = {
              points: currentStrokeRef.current,
              color: styleRef.current.color,
              width: styleRef.current.width,
            };
            setStrokes((prev) => [...prev, finished]);
          }
          currentStrokeRef.current = [];
          setCurrentStroke([]);
        },
      }),
    []
  );

  const handleClear = () => {
    Haptics.selectionAsync().catch(() => {});
    setStrokes([]);
    setCurrentStroke([]);
    currentStrokeRef.current = [];
  };

  const handleUndo = () => {
    Haptics.selectionAsync().catch(() => {});
    setStrokes((prev) => prev.slice(0, -1));
  };

  const handleDeleteSaved = (sig: SignatureRecord) => {
    Alert.alert(
      'Eliminar firma',
      `¿Quieres eliminar "${sig.name}"? También se quitará de los documentos donde esté colocada.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            deleteSignatureRecord(sig.id);
            loadSaved();
            onChanged?.();
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleSave = async () => {
    if (strokes.length === 0) {
      Alert.alert('Firma vacía', 'Dibuja tu firma en el recuadro antes de guardar.');
      return;
    }
    try {
      setSaving(true);
      const outputPath = getSignatureOutputPath();
      const savedUri = await renderSignaturePng({
        strokes,
        width: Math.round(canvasSize.width),
        height: Math.round(canvasSize.height),
        strokeColor: inkColor,
        strokeWidth,
        outputPath,
      });
      const defaultName = `Firma ${savedSignatures.length + 1}`;
      const record = saveSignatureRecord(name.trim() || defaultName, savedUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      handleClear();
      setName('');
      loadSaved();
      onCreated(record);
      onChanged?.();
      onClose();
    } catch (err) {
      Alert.alert(
        'No se pudo guardar',
        err instanceof Error ? err.message : 'Ocurrió un error al renderizar la firma.'
      );
    } finally {
      setSaving(false);
    }
  };

  const canSave = activeTab === 'new' && strokes.length > 0 && !saving;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBackBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={22} color={COLORS.navy} />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Mis Firmas</Text>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            style={styles.headerSaveBtn}
            hitSlop={10}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Text
                numberOfLines={1}
                style={[styles.headerSaveText, !canSave && styles.headerSaveTextDisabled]}
              >
                Guardar
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Underline Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'saved' && styles.tabItemActive]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setActiveTab('saved');
            }}
          >
            <Text numberOfLines={1} style={[styles.tabText, activeTab === 'saved' && styles.tabTextActive]}>
              Guardadas ({savedSignatures.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'new' && styles.tabItemActive]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setActiveTab('new');
            }}
          >
            <Text numberOfLines={1} style={[styles.tabText, activeTab === 'new' && styles.tabTextActive]}>
              Nueva firma
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'saved' ? (
          <ScrollView
            contentContainerStyle={[
              styles.savedList,
              { paddingBottom: Math.max(24, safeBottom + 16) },
            ]}
          >
            {savedSignatures.length === 0 ? (
              <View style={styles.emptySaved}>
                <EmptyStateIllustration variant="signatures" size={112} />
                <Text style={styles.emptySavedTitle}>Sin firmas</Text>
                <Text style={styles.emptySavedSub}>Dibuja una para reutilizarla</Text>
                <TouchableOpacity
                  style={styles.emptySavedBtn}
                  onPress={() => setActiveTab('new')}
                >
                  <Text numberOfLines={1} style={styles.emptySavedBtnText}>
                    Nueva firma
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              savedSignatures.map((sig) => (
                <View key={sig.id} style={styles.savedCard}>
                  <View style={styles.savedPreviewBox}>
                    <Image
                      source={{ uri: sig.imageUri }}
                      style={styles.savedPreviewImg}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={styles.savedMetaRow}>
                    <View>
                      <Text style={styles.savedName}>{sig.name}</Text>
                      <Text style={styles.savedDate}>
                        {new Date(sig.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.savedDeleteBtn}
                      onPress={() => handleDeleteSaved(sig)}
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        ) : (
          <ScrollView
            scrollEnabled={!drawing}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.body,
              { paddingBottom: Math.max(20, safeBottom + 14) },
            ]}
          >
            {/* Clean Signature Drawing Canvas */}
            <View
              style={styles.canvasCard}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width > 0 && height > 0) {
                  setCanvasSize({ width, height });
                }
              }}
              {...panResponder.panHandlers}
            >
              <Svg style={StyleSheet.absoluteFill}>
                <Line
                  x1={24}
                  y1={canvasSize.height - 52}
                  x2={Math.max(25, canvasSize.width - 24)}
                  y2={canvasSize.height - 52}
                  stroke="#CBD5E1"
                  strokeWidth={1.2}
                  strokeDasharray="6 5"
                />
                {strokes.map((s, idx) => (
                  <Path
                    key={idx}
                    d={strokeToSvgPath(s.points)}
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                ))}
                {currentStroke.length > 0 && (
                  <Path
                    d={strokeToSvgPath(currentStroke)}
                    stroke={inkColor}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </Svg>

              {strokes.length === 0 && currentStroke.length === 0 && (
                <View style={styles.canvasHintWrap} pointerEvents="none">
                  <Text style={styles.canvasHintText}>Dibuja tu firma aquí</Text>
                </View>
              )}
            </View>

            {/* Optional Name Pill */}
            <View style={styles.nameRow}>
              <Ionicons name="pricetag-outline" size={15} color={COLORS.textMuted} />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={`Etiqueta opcional (ej. Firma ${savedSignatures.length + 1})`}
                placeholderTextColor={COLORS.textMuted}
                style={styles.nameInput}
                maxLength={32}
              />
            </View>

            {/* Controls Panel */}
            <View style={styles.controlsPanel}>
              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Tinta</Text>
                <View style={styles.swatchesRow}>
                  {INK_COLORS.map((c) => {
                    const selected = inkColor === c.value;
                    return (
                      <TouchableOpacity
                        key={c.value}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setInkColor(c.value);
                        }}
                        style={[styles.swatchOuter, selected && styles.swatchOuterActive]}
                      >
                        <View style={[styles.swatchDot, { backgroundColor: c.value }]} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.controlRow}>
                <Text style={styles.controlLabel}>Grosor</Text>
                <View style={styles.widthTrack}>
                  {STROKE_WIDTHS.map((w) => {
                    const selected = strokeWidth === w.value;
                    return (
                      <TouchableOpacity
                        key={w.value}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setStrokeWidth(w.value);
                        }}
                        style={[styles.widthPill, selected && styles.widthPillActive]}
                      >
                        <Text
                          style={[styles.widthPillText, selected && styles.widthPillTextActive]}
                        >
                          {w.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Bottom Actions */}
            <View style={styles.bottomActions}>
              <TouchableOpacity
                style={[styles.pillActionBtn, strokes.length === 0 && { opacity: 0.45 }]}
                onPress={handleUndo}
                disabled={strokes.length === 0}
              >
                <Ionicons name="arrow-undo-outline" size={17} color={COLORS.navy} />
                <Text numberOfLines={1} style={styles.pillActionText}>
                  Deshacer
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pillActionBtn, strokes.length === 0 && { opacity: 0.45 }]}
                onPress={handleClear}
                disabled={strokes.length === 0}
              >
                <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                <Text numberOfLines={1} style={[styles.pillActionText, { color: COLORS.danger }]}>
                  Limpiar
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.navy,
    letterSpacing: -0.2,
  },
  headerSaveBtn: {
    minWidth: 68,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  headerSaveTextDisabled: {
    color: COLORS.textMuted,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.navy,
    fontWeight: '700',
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  canvasCard: {
    height: 240,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    position: 'relative',
    ...SHADOWS.card,
  },
  canvasHintWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasHintText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  nameInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 0,
  },
  controlsPanel: {
    marginTop: 18,
    gap: 16,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  swatchesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  swatchOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchOuterActive: {
    borderColor: COLORS.primary,
  },
  swatchDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  widthTrack: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  widthPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
  },
  widthPillActive: {
    backgroundColor: COLORS.surface,
    ...SHADOWS.segment,
  },
  widthPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  widthPillTextActive: {
    color: COLORS.navy,
    fontWeight: '700',
  },
  bottomActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  pillActionBtn: {
    flex: 1,
    height: 46,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    ...SHADOWS.card,
  },
  pillActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.navy,
  },
  savedList: {
    padding: 18,
    gap: 12,
  },
  savedCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 10,
    ...SHADOWS.card,
  },
  savedPreviewBox: {
    height: 92,
    borderRadius: 12,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  savedPreviewImg: {
    width: '100%',
    height: '100%',
  },
  savedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  savedName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.navy,
  },
  savedDate: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  savedDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySaved: {
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: 28,
    gap: 10,
  },
  emptySavedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.navy,
  },
  emptySavedSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptySavedBtn: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.navy,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
  },
  emptySavedBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
