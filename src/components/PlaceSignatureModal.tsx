import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { PageRecord, SignatureRecord } from '../types/models';
import { deleteSignatureRecord, getSignatures } from '../storage/database';
import { SignaturePadModal } from './SignaturePadModal';
import { EmptyStateIllustration } from './EmptyStateIllustration';
import { useSafeBottom } from '../hooks/useSafeBottom';
import { COLORS, SHADOWS } from '../theme/colors';

interface PlaceSignatureModalProps {
  visible: boolean;
  page: PageRecord | null;
  onClose: () => void;
  onApply: (placement: {
    signatureId: string;
    imageUri: string;
    xRatio: number;
    yRatio: number;
    widthRatio: number;
  }) => void;
  onClearPageSignatures: () => void;
}

export function PlaceSignatureModal({
  visible,
  page,
  onClose,
  onApply,
  onClearPageSignatures,
}: PlaceSignatureModalProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = useSafeBottom();
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [selectedSig, setSelectedSig] = useState<SignatureRecord | null>(null);
  const [padVisible, setPadVisible] = useState(false);

  const [xRatio, setXRatio] = useState(0.55);
  const [yRatio, setYRatio] = useState(0.75);
  const [widthRatio, setWidthRatio] = useState(0.32);
  const [isInteracting, setIsInteracting] = useState(false);

  const [pageAspect, setPageAspect] = useState(0.707);
  const [sigAspectMap, setSigAspectMap] = useState<Record<string, number>>({});

  const previewSize = useMemo(() => {
    const maxW = 280;
    const maxH = 360;
    const boxRatio = maxW / maxH;
    if (pageAspect > boxRatio) {
      return { width: maxW, height: maxW / Math.max(0.15, pageAspect) };
    }
    return { width: maxH * pageAspect, height: maxH };
  }, [pageAspect]);

  const selectedSigAspect = selectedSig ? sigAspectMap[selectedSig.imageUri] ?? 0.46 : 0.46;

  const stateRef = useRef({ xRatio, yRatio, widthRatio });
  stateRef.current = { xRatio, yRatio, widthRatio };

  const previewRef = useRef(previewSize);
  previewRef.current = previewSize;

  const aspectRef = useRef(selectedSigAspect);
  aspectRef.current = selectedSigAspect;

  const dragStartRef = useRef({ x: 0.55, y: 0.75, w: 0.32 });

  const loadSignatures = () => {
    const list = getSignatures();
    setSignatures(list);
    setSelectedSig((curr) => {
      if (curr && list.some((s) => s.id === curr.id)) return curr;
      return list[0] ?? null;
    });
  };

  useEffect(() => {
    if (visible) {
      loadSignatures();
      setXRatio(0.55);
      setYRatio(0.75);
      setWidthRatio(0.32);
      setIsInteracting(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !page?.imageUri) return;
    let active = true;
    Image.getSize(
      page.imageUri,
      (w, h) => {
        if (active && w > 0 && h > 0) setPageAspect(w / h);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [visible, page?.imageUri]);

  useEffect(() => {
    if (!visible) return;
    const uris = new Set<string>();
    if (selectedSig?.imageUri) uris.add(selectedSig.imageUri);
    page?.signatures.forEach((s) => uris.add(s.imageUri));
    uris.forEach((uri) => {
      if (sigAspectMap[uri]) return;
      Image.getSize(
        uri,
        (w, h) => {
          if (w > 0 && h > 0) {
            setSigAspectMap((prev) => ({ ...prev, [uri]: h / w }));
          }
        },
        () => {}
      );
    });
  }, [visible, selectedSig?.imageUri, page?.signatures]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          setIsInteracting(true);
          dragStartRef.current = {
            x: stateRef.current.xRatio,
            y: stateRef.current.yRatio,
            w: stateRef.current.widthRatio,
          };
        },
        onPanResponderMove: (_, gesture) => {
          const w = Math.max(1, previewRef.current.width);
          const h = Math.max(1, previewRef.current.height);
          const dx = gesture.dx / w;
          const dy = gesture.dy / h;
          const sigHRatio = (dragStartRef.current.w * w * aspectRef.current) / h;
          const maxX = Math.max(0.01, 0.99 - dragStartRef.current.w);
          const maxY = Math.max(0.01, 0.99 - sigHRatio);
          setXRatio(Math.max(0, Math.min(maxX, dragStartRef.current.x + dx)));
          setYRatio(Math.max(0, Math.min(maxY, dragStartRef.current.y + dy)));
        },
        onPanResponderRelease: () => setIsInteracting(false),
        onPanResponderTerminate: () => setIsInteracting(false),
      }),
    []
  );

  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          setIsInteracting(true);
          dragStartRef.current = {
            x: stateRef.current.xRatio,
            y: stateRef.current.yRatio,
            w: stateRef.current.widthRatio,
          };
        },
        onPanResponderMove: (_, gesture) => {
          const w = Math.max(1, previewRef.current.width);
          const dw = gesture.dx / w;
          const next = Math.max(
            0.12,
            Math.min(0.85, Math.min(0.99 - dragStartRef.current.x, dragStartRef.current.w + dw))
          );
          setWidthRatio(next);
        },
        onPanResponderRelease: () => setIsInteracting(false),
        onPanResponderTerminate: () => setIsInteracting(false),
      }),
    []
  );

  const handleDeleteSig = (sig: SignatureRecord) => {
    Alert.alert(
      'Eliminar firma',
      `¿Deseas borrar "${sig.name}"? También se quitará de los documentos donde esté aplicada.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            deleteSignatureRecord(sig.id);
            loadSignatures();
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleApply = () => {
    if (!selectedSig) {
      Alert.alert('Sin firma', 'Crea o selecciona una firma primero.');
      return;
    }
    onApply({
      signatureId: selectedSig.id,
      imageUri: selectedSig.imageUri,
      xRatio,
      yRatio,
      widthRatio,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color={COLORS.navy} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Colocar firma</Text>
          <TouchableOpacity
            onPress={handleApply}
            disabled={!selectedSig}
            style={[styles.applyBtn, !selectedSig && { opacity: 0.4 }]}
          >
            <Text numberOfLines={1} style={styles.applyBtnText}>
              Aplicar
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          scrollEnabled={!isInteracting}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(30, safeBottom + 16) },
          ]}
        >
          {page && (
            <View style={styles.previewSection}>
              <Text style={styles.sectionHint}>
                Arrastra la firma o usa la esquina azul para cambiar su tamaño
              </Text>
              <View style={styles.canvasBackdrop}>
                <View
                  style={[
                    styles.pageFrame,
                    { width: previewSize.width, height: previewSize.height },
                  ]}
                >
                  <Image
                    source={{ uri: page.imageUri }}
                    style={[StyleSheet.absoluteFill, { borderRadius: 6 }]}
                    resizeMode="stretch"
                  />

                  {page.signatures.map((existing) => {
                    const ratio = sigAspectMap[existing.imageUri] ?? 0.46;
                    const existingW = existing.widthRatio * previewSize.width;
                    return (
                      <Image
                        key={existing.id}
                        source={{ uri: existing.imageUri }}
                        style={{
                          position: 'absolute',
                          left: existing.xRatio * previewSize.width,
                          top: existing.yRatio * previewSize.height,
                          width: existingW,
                          height: existingW * ratio,
                          opacity: 0.85,
                        }}
                        resizeMode="stretch"
                      />
                    );
                  })}

                  {selectedSig && (
                    <View
                      style={[
                        styles.draggableSig,
                        {
                          left: xRatio * previewSize.width,
                          top: yRatio * previewSize.height,
                          width: widthRatio * previewSize.width,
                          height: widthRatio * previewSize.width * selectedSigAspect,
                        },
                      ]}
                    >
                      <View {...panResponder.panHandlers} style={{ flex: 1 }}>
                        <Image
                          source={{ uri: selectedSig.imageUri }}
                          style={styles.sigImg}
                          resizeMode="stretch"
                        />
                      </View>
                      <View {...resizeResponder.panHandlers} style={styles.resizeDot} />
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.adjustBar}>
                <TouchableOpacity
                  style={styles.adjustChip}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setWidthRatio((w) => Math.max(0.12, w - 0.05));
                  }}
                >
                  <Ionicons name="remove" size={16} color={COLORS.navy} />
                  <Text numberOfLines={1} style={styles.adjustText}>
                    Más chica
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.adjustChip}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setWidthRatio((w) => Math.min(0.8, w + 0.05));
                  }}
                >
                  <Ionicons name="add" size={16} color={COLORS.navy} />
                  <Text numberOfLines={1} style={styles.adjustText}>
                    Más grande
                  </Text>
                </TouchableOpacity>

                {page.signatures.length > 0 && (
                  <TouchableOpacity
                    style={[
                      styles.adjustChip,
                      { backgroundColor: COLORS.dangerBg, borderColor: '#FECACA' },
                    ]}
                    onPress={() => {
                      onClearPageSignatures();
                      onClose();
                    }}
                  >
                    <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                    <Text style={[styles.adjustText, { color: COLORS.danger }]}>Quitar</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <View style={styles.sigListHeader}>
            <Text style={styles.sectionTitle}>Tus firmas ({signatures.length})</Text>
            <TouchableOpacity style={styles.newSigBtn} onPress={() => setPadVisible(true)}>
              <Ionicons name="add" size={16} color="#FFFFFF" />
              <Text numberOfLines={1} style={styles.newSigText}>
                Nueva firma
              </Text>
            </TouchableOpacity>
          </View>

          {signatures.length === 0 ? (
            <TouchableOpacity style={styles.emptySigBox} onPress={() => setPadVisible(true)}>
              <EmptyStateIllustration variant="signatures" size={76} />
              <Text style={styles.emptySigTitle}>Sin firmas guardadas</Text>
              <Text style={styles.emptySigSub}>Toca para dibujar una</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sigRow}
            >
              {signatures.map((sig) => {
                const active = selectedSig?.id === sig.id;
                return (
                  <TouchableOpacity
                    key={sig.id}
                    style={[styles.sigCard, active && styles.sigCardActive]}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setSelectedSig(sig);
                    }}
                    onLongPress={() => handleDeleteSig(sig)}
                  >
                    <Image
                      source={{ uri: sig.imageUri }}
                      style={styles.sigThumb}
                      resizeMode="contain"
                    />
                    <Text numberOfLines={1} style={styles.sigName}>
                      {sig.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </ScrollView>

        <SignaturePadModal
          visible={padVisible}
          initialTab="new"
          onClose={() => setPadVisible(false)}
          onCreated={(created) => {
            loadSignatures();
            setSelectedSig(created);
          }}
          onChanged={loadSignatures}
        />
      </View>
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
  },
  headerBtn: {
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
  },
  applyBtn: {
    backgroundColor: COLORS.navy,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  applyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  scrollContent: {
    padding: 16,
  },
  previewSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 10,
    textAlign: 'center',
  },
  canvasBackdrop: {
    width: '100%',
    backgroundColor: COLORS.canvas,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageFrame: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'visible',
    position: 'relative',
    ...SHADOWS.page,
  },
  draggableSig: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    borderRadius: 6,
  },
  sigImg: {
    width: '100%',
    height: '100%',
  },
  resizeDot: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    ...SHADOWS.card,
  },
  adjustBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  adjustChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    ...SHADOWS.card,
  },
  adjustText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.navy,
  },
  sigListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.navy,
  },
  newSigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
  },
  newSigText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptySigBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryBorder,
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    gap: 6,
  },
  emptySigTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.navy,
  },
  emptySigSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  sigRow: {
    gap: 10,
    paddingVertical: 4,
  },
  sigCard: {
    width: 136,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    padding: 10,
    alignItems: 'center',
    ...SHADOWS.card,
  },
  sigCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  sigThumb: {
    width: 112,
    height: 48,
    marginBottom: 6,
  },
  sigName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.navy,
  },
});
