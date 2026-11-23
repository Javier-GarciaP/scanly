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
  deleteDocument,
  deletePage,
  deletePageSignature,
  getDocumentDetail,
  moveDocumentToFolder,
  renameDocument,
  reorderPages,
  replacePageImage,
  updatePageSignature,
} from '../storage/database';
import type { DocumentDetail, Folder, PageSignaturePlacement } from '../types/models';
import { RenameModal } from '../components/RenameModal';
import { MoveFolderModal } from '../components/MoveFolderModal';
import { OcrModal } from '../components/OcrModal';
import { PlaceSignatureModal } from '../components/PlaceSignatureModal';
import { ExportPdfModal } from '../components/ExportPdfModal';
import { CropDocumentModal } from '../components/CropDocumentModal';
import { EmptyStateIllustration } from '../components/EmptyStateIllustration';
import { useSafeBottom } from '../hooks/useSafeBottom';
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
  const [sigAspect, setSigAspect] = useState(0.46); // height / width

  const stateRef = useRef({ xRatio, yRatio, widthRatio });
  stateRef.current = { xRatio, yRatio, widthRatio };

  const startRef = useRef({ x: sig.xRatio, y: sig.yRatio, w: sig.widthRatio });
  const boxRef = useRef({ width: boxWidth, height: boxHeight });
  boxRef.current = { width: boxWidth, height: boxHeight };

  const aspectRef = useRef(sigAspect);
  aspectRef.current = sigAspect;

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    setXRatio(sig.xRatio);
    setYRatio(sig.yRatio);
    setWidthRatio(sig.widthRatio);
  }, [sig.id, sig.xRatio, sig.yRatio, sig.widthRatio]);

  useEffect(() => {
    let active = true;
    Image.getSize(
      sig.imageUri,
      (w, h) => {
        if (active && w > 0 && h > 0) {
          setSigAspect(h / w);
        }
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [sig.imageUri]);

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
          const sigHRatio = (startRef.current.w * w * aspectRef.current) / h;
          const maxX = Math.max(0.01, 0.99 - startRef.current.w);
          const maxY = Math.max(0.01, 0.99 - sigHRatio);
          const nextX = Math.max(0, Math.min(maxX, startRef.current.x + g.dx / w));
          const nextY = Math.max(0, Math.min(maxY, startRef.current.y + g.dy / h));
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
            0.12,
            Math.min(0.85, Math.min(0.99 - startRef.current.x, startRef.current.w + g.dx / w))
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
  const sigH = sigW * sigAspect;

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
        <Image source={{ uri: sig.imageUri }} style={styles.sigImage} resizeMode="stretch" />
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
  const safeBottom = useSafeBottom();
  const [doc, setDoc] = useState<DocumentDetail | null>(() => getDocumentDetail(documentId));
  const [activeIndex, setActiveIndex] = useState(0);
  const [addingPages, setAddingPages] = useState(false);

  const [canvasBox, setCanvasBox] = useState({ width: 300, height: 420 });
  const [pageAspect, setPageAspect] = useState(0.707); // width / height (A4 default)
  const [selectedSigId, setSelectedSigId] = useState<string | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [cropMode, setCropMode] = useState<
    { type: 'add'; uris: string[] } | { type: 'replace'; pageId: string; uri: string } | null
  >(null);

  const filmstripRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const reloadDoc = () => {
    const fresh = getDocumentDetail(documentId);
    setDoc(fresh);
    if (fresh && activeIndex >= fresh.pages.length) {
      setActiveIndex(Math.max(0, fresh.pages.length - 1));
    }
    onDataChanged();
    return fresh;
  };

  useEffect(() => {
    reloadDoc();
  }, [documentId]);

  useEffect(() => {
    setSelectedSigId(null);
  }, [activeIndex]);

  const currentPage = doc?.pages[activeIndex] ?? null;

  useEffect(() => {
    if (!currentPage?.imageUri) return;
    let active = true;
    Image.getSize(
      currentPage.imageUri,
      (w, h) => {
        if (active && w > 0 && h > 0) {
          setPageAspect(w / h);
        }
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [currentPage?.imageUri]);

  // Dimensiones exactas de la hoja en pantalla para que coincida 1:1 con el PDF
  const sheetSize = useMemo(() => {
    const availW = Math.max(120, Math.min(380, canvasBox.width));
    const availH = Math.max(160, canvasBox.height);
    const boxRatio = availW / availH;
    if (pageAspect > boxRatio) {
      return { width: availW, height: availW / Math.max(0.15, pageAspect) };
    }
    return { width: availH * pageAspect, height: availH };
  }, [canvasBox.width, canvasBox.height, pageAspect]);

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
        ],
        { cancelable: true }
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
      ],
      { cancelable: true }
    );
  };

  const appendPagesAndSelect = (uris: string[]) => {
    if (uris.length === 0) return;
    const prevCount = doc.pages.length;
    addPagesToDocument(doc.id, uris);
    const fresh = reloadDoc();
    const targetIdx = fresh ? Math.min(prevCount, fresh.pages.length - 1) : prevCount;
    setActiveIndex(Math.max(0, targetIdx));
    setTimeout(() => {
      filmstripRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const launchCameraFallback = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permiso de cámara requerido',
        'Activa el permiso de cámara para Scanly en los ajustes de tu teléfono.'
      );
      return;
    }
    const camRes = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.95,
    });
    if (!camRes.canceled && camRes.assets.length > 0) {
      setCropMode({ type: 'add', uris: camRes.assets.map((a) => a.uri) });
    }
  };

  const handleAddPagesPrompt = () => {
    Alert.alert(
      'Añadir páginas',
      '¿Cómo quieres agregar nuevas páginas?',
      [
        {
          text: 'Escanear con cámara',
          onPress: async () => {
            try {
              setAddingPages(true);
              const res = await scanDocument({ pageLimit: 20, galleryImportAllowed: true });
              if (!res.cancelled && res.pageUris.length > 0) {
                appendPagesAndSelect(res.pageUris);
              }
            } catch {
              try {
                await launchCameraFallback();
              } catch (fallbackErr) {
                Alert.alert(
                  'Error al abrir la cámara',
                  fallbackErr instanceof Error
                    ? fallbackErr.message
                    : 'No se pudieron escanear nuevas páginas.'
                );
              }
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
                quality: 0.95,
              });
              if (!res.canceled && res.assets.length > 0) {
                setCropMode({ type: 'add', uris: res.assets.map((a) => a.uri) });
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
      ],
      { cancelable: true }
    );
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
              style={styles.canvasMeasureWrap}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width > 0 && height > 0) {
                  setCanvasBox({ width, height });
                }
              }}
            >
              <View
                style={[
                  styles.pageSheet,
                  {
                    width: sheetSize.width,
                    height: sheetSize.height,
                  },
                ]}
              >
                <Image
                  source={{ uri: currentPage.imageUri }}
                  style={[StyleSheet.absoluteFill, { borderRadius: 6 }]}
                  resizeMode="stretch"
                />

                {currentPage.signatures.map((sig) => (
                  <InteractiveSignatureOverlay
                    key={sig.id}
                    sig={sig}
                    selected={selectedSigId === sig.id}
                    boxWidth={sheetSize.width}
                    boxHeight={sheetSize.height}
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
          ref={filmstripRef}
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

      {/* Bottom 5-Action Toolbar */}
      <View style={[styles.toolbar, { paddingBottom: Math.max(14, safeBottom + 6) }]}>
        <TouchableOpacity
          style={styles.toolItem}
          onPress={handleAddPagesPrompt}
          disabled={addingPages}
        >
          <Ionicons name="add" size={22} color={COLORS.navy} />
          <Text style={styles.toolLabel}>Añadir</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolItem}
          onPress={() => {
            if (currentPage) {
              setCropMode({
                type: 'replace',
                pageId: currentPage.id,
                uri: currentPage.imageUri,
              });
            }
          }}
          disabled={!currentPage}
        >
          <Ionicons name="crop-outline" size={21} color={COLORS.navy} />
          <Text style={styles.toolLabel}>Recortar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolItem} onPress={() => setOcrOpen(true)}>
          <View style={styles.toolIconWrap}>
            <Ionicons
              name="scan-outline"
              size={21}
              color={pageHasOcr ? COLORS.primary : COLORS.navy}
            />
            {pageHasOcr && <View style={styles.ocrReadyDot} />}
          </View>
          <Text style={[styles.toolLabel, pageHasOcr && { color: COLORS.primary }]}>OCR</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolItem} onPress={() => setSignOpen(true)}>
          <Ionicons
            name="pencil-outline"
            size={20}
            color={pageHasSignatures ? COLORS.primary : COLORS.navy}
          />
          <Text style={[styles.toolLabel, pageHasSignatures && { color: COLORS.primary }]}>
            Firmar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toolItem} onPress={handleDeleteCurrentPage}>
          <Ionicons name="trash-outline" size={20} color={COLORS.navy} />
          <Text style={styles.toolLabel}>Eliminar</Text>
        </TouchableOpacity>
      </View>

      {/* Sheet Cropper Modal (for added gallery images OR re-cropping current page) */}
      <CropDocumentModal
        visible={cropMode !== null}
        imageUris={
          cropMode?.type === 'add'
            ? cropMode.uris
            : cropMode?.type === 'replace'
            ? [cropMode.uri]
            : []
        }
        title={cropMode?.type === 'replace' ? 'Ajustar recorte' : 'Recortar hoja'}
        initialFilter={cropMode?.type === 'replace' ? 'original' : 'document'}
        autoDetect={cropMode?.type !== 'replace'}
        onCancel={() => setCropMode(null)}
        onComplete={(croppedUris) => {
          const mode = cropMode;
          setCropMode(null);
          if (!mode || croppedUris.length === 0) return;
          if (mode.type === 'add') {
            appendPagesAndSelect(croppedUris);
          } else {
            replacePageImage(doc.id, mode.pageId, croppedUris[0]);
            reloadDoc();
          }
        }}
      />

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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasMeasureWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageSheet: {
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
    marginTop: 10,
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
    paddingVertical: 10,
  },
  filmstripContent: {
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  thumbCard: {
    width: 52,
    height: 68,
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
    width: 52,
    height: 68,
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
    paddingHorizontal: 6,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  toolItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 58,
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
