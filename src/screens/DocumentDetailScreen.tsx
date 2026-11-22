import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { scanDocument } from '../../modules/doc-engine';
import {
  addPagesToDocument,
  addSignatureToPage,
  clearPageSignatures,
  copyImageToPermanentStorage,
  deleteDocument,
  deletePage,
  deletePageSignature,
  getDocumentDetail,
  moveDocumentToFolder,
  renameDocument,
  reorderPages,
  updatePageSignature,
} from '../storage/database';
import type { DocumentDetail, Folder, PageSignaturePlacement } from '../types/models';
import { RenameModal } from '../components/RenameModal';
import { MoveFolderModal } from '../components/MoveFolderModal';
import { OcrModal } from '../components/OcrModal';
import { PlaceSignatureModal } from '../components/PlaceSignatureModal';
import { ExportPdfModal } from '../components/ExportPdfModal';
import { EmptyStateIllustration } from '../components/EmptyStateIllustration';
import { COLORS, SHADOWS } from '../theme/colors';

interface DocumentDetailScreenProps {
  documentId: string;
  folders: Folder[];
  onBack: () => void;
  onDataChanged: () => void;
}

interface InteractiveSignatureProps {
  sig: PageSignaturePlacement;
  selected: boolean;
  boxWidth: number;
  boxHeight: number;
  onSelect: () => void;
  onDelete: () => void;
  onCommit: (xRatio: number, yRatio: number, widthRatio: number) => void;
}

function InteractiveSignatureOverlay({
  sig,
  selected,
  boxWidth,
  boxHeight,
  onSelect,
  onDelete,
  onCommit,
}: InteractiveSignatureProps) {
  const [xRatio, setXRatio] = useState(sig.xRatio);
  const [yRatio, setYRatio] = useState(sig.yRatio);
  const [widthRatio, setWidthRatio] = useState(sig.widthRatio);

  const stateRef = useRef({ xRatio, yRatio, widthRatio });
  stateRef.current = { xRatio, yRatio, widthRatio };

  const startRef = useRef({ x: sig.xRatio, y: sig.yRatio, w: sig.widthRatio });
  const boxRef = useRef({ width: boxWidth, height: boxHeight });
  boxRef.current = { width: boxWidth, height: boxHeight };

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    setXRatio(sig.xRatio);
    setYRatio(sig.yRatio);
    setWidthRatio(sig.widthRatio);
  }, [sig.id, sig.xRatio, sig.yRatio, sig.widthRatio]);

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          onSelectRef.current();
          startRef.current = {
            x: stateRef.current.xRatio,
            y: stateRef.current.yRatio,
            w: stateRef.current.widthRatio,
          };
        },
        onPanResponderMove: (_, g) => {
          const w = Math.max(1, boxRef.current.width);
          const h = Math.max(1, boxRef.current.height);
          const nextX = Math.max(0.01, Math.min(0.96 - startRef.current.w, startRef.current.x + g.dx / w));
          const nextY = Math.max(0.01, Math.min(0.9, startRef.current.y + g.dy / h));
          setXRatio(nextX);
          setYRatio(nextY);
        },
        onPanResponderRelease: () => {
          const { xRatio: nx, yRatio: ny, widthRatio: nw } = stateRef.current;
          if (
            Math.abs(nx - startRef.current.x) > 0.002 ||
            Math.abs(ny - startRef.current.y) > 0.002
          ) {
            Haptics.selectionAsync().catch(() => {});
            onCommitRef.current(nx, ny, nw);
          }
        },
      }),
    []
  );

  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          onSelectRef.current();
          startRef.current = {
            x: stateRef.current.xRatio,
            y: stateRef.current.yRatio,
            w: stateRef.current.widthRatio,
          };
        },
        onPanResponderMove: (_, g) => {
          const w = Math.max(1, boxRef.current.width);
          const nextW = Math.max(
            0.14,
            Math.min(0.82, Math.min(0.98 - startRef.current.x, startRef.current.w + g.dx / w))
          );
          setWidthRatio(nextW);
        },
        onPanResponderRelease: () => {
          const { xRatio: nx, yRatio: ny, widthRatio: nw } = stateRef.current;
          Haptics.selectionAsync().catch(() => {});
          onCommitRef.current(nx, ny, nw);
        },
      }),
    []
  );

  const sigW = widthRatio * boxWidth;
  const sigH = sigW * 0.46;

  return (
    <View
      style={[
        styles.sigOverlayWrap,
        selected && styles.sigOverlaySelected,
        {
          left: xRatio * boxWidth,
          top: yRatio * boxHeight,
          width: sigW,
          height: sigH,
        },
      ]}
    >
      <View {...dragResponder.panHandlers} style={styles.sigDragArea}>
        <Image source={{ uri: sig.imageUri }} style={styles.sigImage} resizeMode="contain" />
      </View>

      {selected && (
        <>
          <TouchableOpacity
            style={styles.sigDeleteHandle}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onDelete();
            }}
            hitSlop={10}
          >
            <Ionicons name="close" size={12} color="#FFFFFF" />
          </TouchableOpacity>

          <View {...resizeResponder.panHandlers} style={styles.sigResizeHandle} />
        </>
      )}
    </View>
  );
}

export function DocumentDetailScreen({
  documentId,
  folders,
  onBack,
  onDataChanged,
}: DocumentDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const [doc, setDoc] = useState<DocumentDetail | null>(() => getDocumentDetail(documentId));
  const [activeIndex, setActiveIndex] = useState(0);
  const [addingPages, setAddingPages] = useState(false);
  const [previewBox, setPreviewBox] = useState({ width: 280, height: 390 });
  const [selectedSigId, setSelectedSigId] = useState<string | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const reloadDoc = () => {
    const fresh = getDocumentDetail(documentId);
    setDoc(fresh);
    if (fresh && activeIndex >= fresh.pages.length) {
      setActiveIndex(Math.max(0, fresh.pages.length - 1));
    }
    onDataChanged();
  };

  useEffect(() => {
    reloadDoc();
  }, [documentId]);

  useEffect(() => {
    setSelectedSigId(null);
  }, [activeIndex]);

  if (!doc) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <Text style={{ color: COLORS.textSecondary, marginBottom: 14, fontSize: 15 }}>
          Documento no encontrado.
        </Text>
        <TouchableOpacity style={styles.pdfPill} onPress={onBack}>
          <Text style={styles.pdfPillText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentPage = doc.pages[activeIndex] ?? null;
  const pageHasOcr = Boolean(currentPage?.ocrText.trim());
  const pageHasSignatures = (currentPage?.signatures.length ?? 0) > 0;

  const handleMovePage = (direction: -1 | 1) => {
    const target = activeIndex + direction;
    if (target < 0 || target >= doc.pages.length) return;
    const ids = doc.pages.map((p) => p.id);
    const [moved] = ids.splice(activeIndex, 1);
    ids.splice(target, 0, moved);
    reorderPages(doc.id, ids);
    setActiveIndex(target);
    Haptics.selectionAsync().catch(() => {});
    reloadDoc();
  };

  const handleDeleteCurrentPage = () => {
    if (!currentPage) return;
    if (doc.pages.length === 1) {
      Alert.alert(
        'Última página',
        'Si eliminas la única página, se eliminará el documento completo. ¿Continuar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar documento',
            style: 'destructive',
            onPress: () => {
              deleteDocument(doc.id);
              onDataChanged();
              onBack();
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      'Eliminar página',
      `¿Quieres eliminar la página ${activeIndex + 1} de este documento?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            deletePage(doc.id, currentPage.id);
            reloadDoc();
          },
        },
      ]
    );
  };

  const handleAddPagesPrompt = () => {
    Alert.alert('Añadir páginas', '¿Cómo quieres agregar nuevas páginas?', [
      {
        text: 'Escanear con cámara',
        onPress: async () => {
          try {
            setAddingPages(true);
            const res = await scanDocument({ pageLimit: 20, galleryImportAllowed: true });
            if (!res.cancelled && res.pageUris.length > 0) {
              addPagesToDocument(doc.id, res.pageUris);
              reloadDoc();
              setActiveIndex(doc.pages.length);
            }
          } catch (err) {
            Alert.alert(
              'Error al escanear',
              err instanceof Error ? err.message : 'No se pudieron escanear nuevas páginas.'
            );
          } finally {
            setAddingPages(false);
          }
        },
      },
      {
        text: 'Importar de galería',
        onPress: async () => {
          try {
            const res = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsMultipleSelection: true,
              quality: 0.92,
            });
            if (!res.canceled && res.assets.length > 0) {
              const uris = res.assets.map((a) => copyImageToPermanentStorage(a.uri));
              addPagesToDocument(doc.id, uris);
              reloadDoc();
              setActiveIndex(doc.pages.length);
            }
          } catch (err) {
            Alert.alert(
              'Error al importar',
              err instanceof Error ? err.message : 'No se pudieron importar las fotos.'
            );
          }
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={COLORS.navy} />
        </TouchableOpacity>

        <View style={styles.titleCenterBlock}>
          <TouchableOpacity
            style={styles.titleTapRow}
            onPress={() => setRenameOpen(true)}
            activeOpacity={0.7}
          >
            <Text numberOfLines={1} style={styles.titleText}>
              {doc.title}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setMoveOpen(true)} style={styles.folderSubRow}>
            <View
              style={[
                styles.folderDot,
                { backgroundColor: doc.folderColor || COLORS.textMuted },
              ]}
            />
            <Text numberOfLines={1} style={styles.folderSubText}>
              {doc.folderName || 'Sin carpeta'}
            </Text>
            {doc.isPasswordProtected && (
              <Ionicons name="lock-closed" size={11} color={COLORS.warning} />
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.pdfPill}
          onPress={() => setExportOpen(true)}
          activeOpacity={0.86}
        >
          <Text style={styles.pdfPillText}>PDF</Text>
          <Ionicons
            name="arrow-up-outline"
            size={14}
            color="#FFFFFF"
            style={{ transform: [{ rotate: '45deg' }] }}
          />
        </TouchableOpacity>
      </View>

      {/* Studio Document Canvas */}
      <Pressable style={styles.canvasArea} onPress={() => setSelectedSigId(null)}>
        {currentPage ? (
          <>
            <View
              style={styles.pageSheet}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width > 0 && height > 0) {
                  setPreviewBox({ width, height });
                }
              }}
            >
              <Image
                source={{ uri: currentPage.imageUri }}
                style={[StyleSheet.absoluteFill, { borderRadius: 6 }]}
                resizeMode="contain"
              />

              {currentPage.signatures.map((sig) => (
                <InteractiveSignatureOverlay
                  key={sig.id}
                  sig={sig}
                  selected={selectedSigId === sig.id}
                  boxWidth={previewBox.width}
                  boxHeight={previewBox.height}
                  onSelect={() => setSelectedSigId(sig.id)}
                  onDelete={() => {
                    deletePageSignature(doc.id, sig.id);
                    setSelectedSigId(null);
                    reloadDoc();
                  }}
                  onCommit={(xRatio, yRatio, widthRatio) => {
                    updatePageSignature({
                      documentId: doc.id,
                      placementId: sig.id,
                      xRatio,
                      yRatio,
                      widthRatio,
                    });
                    reloadDoc();
                  }}
                />
              ))}
            </View>

            {/* Caption & Subtle Page Reorder Controls */}
            <View style={styles.pageCaptionRow}>
              {doc.pages.length > 1 ? (
                <TouchableOpacity
                  style={[styles.reorderBtn, activeIndex === 0 && styles.reorderBtnDisabled]}
                  onPress={() => handleMovePage(-1)}
                  disabled={activeIndex === 0}
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-back"
                    size={15}
                    color={activeIndex === 0 ? COLORS.textMuted : COLORS.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}

              <Text style={styles.pageCaptionText}>
                Página {activeIndex + 1} de {doc.pages.length}
              </Text>

              {doc.pages.length > 1 ? (
                <TouchableOpacity
                  style={[
                    styles.reorderBtn,
                    activeIndex >= doc.pages.length - 1 && styles.reorderBtnDisabled,
                  ]}
                  onPress={() => handleMovePage(1)}
                  disabled={activeIndex >= doc.pages.length - 1}
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={15}
                    color={
                      activeIndex >= doc.pages.length - 1
                        ? COLORS.textMuted
                        : COLORS.textSecondary
                    }
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <EmptyStateIllustration variant="vault" size={96} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.navy }}>Sin páginas</Text>
          </View>
        )}
      </Pressable>

      {/* Filmstrip (Page Thumbnails) */}
      <View style={styles.filmstripWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filmstripContent}
        >
          {doc.pages.map((page, index) => {
            const selected = index === activeIndex;
            const hasSigs = page.signatures.length > 0;
            return (
              <TouchableOpacity
                key={page.id}
                style={[styles.thumbCard, selected && styles.thumbCardActive]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setActiveIndex(index);
                }}
                activeOpacity={0.85}
              >
                <Image
                  source={{ uri: page.imageUri }}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
                {hasSigs && (
                  <View style={styles.thumbSigDot}>
                    <Ionicons name="pencil" size={8} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={styles.addThumbCard}
            onPress={handleAddPagesPrompt}
            disabled={addingPages}
            activeOpacity={0.8}
          >
            {addingPages ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="add" size={24} color={COLORS.textMuted} />
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Bottom 4-Action Toolbar */}
      <View style={[styles.toolbar, { paddingBottom: Math.max(12, insets.bottom) }]}>
        <TouchableOpacity
          style={styles.toolItem}
          onPress={handleAddPagesPrompt}
          disabled={addingPages}
        >
          <Ionicons name="add" size={23} color={COLORS.navy} />
          <Text style={styles.toolLabel}>Añadir</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolItem} onPress={() => setOcrOpen(true)}>
          <View style={styles.toolIconWrap}>
            <Ionicons
              name="scan-outline"
              size={22}
              color={pageHasOcr ? COLORS.primary : COLORS.navy}
            />
            {pageHasOcr && <View style={styles.ocrReadyDot} />}
          </View>
          <Text style={[styles.toolLabel, pageHasOcr && { color: COLORS.primary }]}>OCR</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolItem} onPress={() => setSignOpen(true)}>
          <Ionicons
            name="pencil-outline"
            size={21}
            color={pageHasSignatures ? COLORS.primary : COLORS.navy}
          />
          <Text style={[styles.toolLabel, pageHasSignatures && { color: COLORS.primary }]}>
            Firmar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolItem} onPress={handleDeleteCurrentPage}>
          <Ionicons name="trash-outline" size={21} color={COLORS.navy} />
          <Text style={styles.toolLabel}>Eliminar</Text>
        </TouchableOpacity>
      </View>

      {/* Modals */}
      <RenameModal
        visible={renameOpen}
        initialValue={doc.title}
        onClose={() => setRenameOpen(false)}
        onSave={(newTitle) => {
          renameDocument(doc.id, newTitle);
          reloadDoc();
        }}
      />

      <MoveFolderModal
        visible={moveOpen}
        folders={folders}
        currentFolderId={doc.folderId}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          moveDocumentToFolder(doc.id, folderId);
          reloadDoc();
        }}
      />

      <OcrModal
        visible={ocrOpen}
        document={doc}
        pageIndex={activeIndex}
        onClose={() => setOcrOpen(false)}
        onSaved={reloadDoc}
      />

      <PlaceSignatureModal
        visible={signOpen}
        page={currentPage}
        onClose={() => setSignOpen(false)}
        onApply={(placement) => {
          if (!currentPage) return;
          const added = addSignatureToPage({
            documentId: doc.id,
            pageId: currentPage.id,
            ...placement,
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          reloadDoc();
          setSelectedSigId(added.id);
        }}
        onClearPageSignatures={() => {
          if (!currentPage) return;
          clearPageSignatures(doc.id, currentPage.id);
          setSelectedSigId(null);
          reloadDoc();
        }}
      />

      <ExportPdfModal
        visible={exportOpen}
        document={doc}
        onClose={() => setExportOpen(false)}
        onExported={reloadDoc}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCenterBlock: {
    flex: 1,
    alignItems: 'center',
  },
  titleTapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
  },
  titleText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.navy,
    letterSpacing: -0.2,
  },
  folderSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  folderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  folderSubText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  pdfPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.navy,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pdfPillText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  canvasArea: {
    flex: 1,
    backgroundColor: COLORS.canvas,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageSheet: {
    width: '100%',
    flex: 1,
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'visible',
    position: 'relative',
    ...SHADOWS.page,
  },
  sigOverlayWrap: {
    position: 'absolute',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  sigOverlaySelected: {
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(37, 99, 235, 0.06)',
  },
  sigDragArea: {
    width: '100%',
    height: '100%',
    padding: 3,
  },
  sigImage: {
    width: '100%',
    height: '100%',
  },
  sigDeleteHandle: {
    position: 'absolute',
    top: -10,
    left: -10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...SHADOWS.card,
  },
  sigResizeHandle: {
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
  pageCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  pageCaptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  reorderBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderBtnDisabled: {
    opacity: 0.4,
  },
  filmstripWrap: {
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 11,
  },
  filmstripContent: {
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  thumbCard: {
    width: 54,
    height: 70,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    position: 'relative',
  },
  thumbCardActive: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    ...SHADOWS.card,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbSigDot: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addThumbCard: {
    width: 54,
    height: 70,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 10,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  toolItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 68,
    paddingVertical: 2,
  },
  toolIconWrap: {
    position: 'relative',
  },
  ocrReadyDot: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.success,
    borderWidth: 1.5,
    borderColor: COLORS.surface,
  },
  toolLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.navy,
  },
});
