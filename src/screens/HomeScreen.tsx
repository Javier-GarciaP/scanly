import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { scanDocument } from '../../modules/doc-engine';
import {
  createDocument,
  createFolder,
  deleteDocument,
  deleteFolder,
  formatDefaultDocTitle,
  moveDocumentToFolder,
  renameDocument,
  updateFolder,
} from '../storage/database';
import type { DocumentRecord, Folder } from '../types/models';
import { FolderModal } from '../components/FolderModal';
import { RenameModal } from '../components/RenameModal';
import { MoveFolderModal } from '../components/MoveFolderModal';
import { SignaturePadModal } from '../components/SignaturePadModal';
import { CropDocumentModal } from '../components/CropDocumentModal';
import { ScanlyLogo } from '../components/ScanlyLogo';
import { EmptyStateIllustration } from '../components/EmptyStateIllustration';
import { useSafeBottom } from '../hooks/useSafeBottom';
import { COLORS, SHADOWS } from '../theme/colors';

type FilterValue = 'ALL' | 'SIGNED' | 'PROTECTED' | 'UNASSIGNED' | string;

interface HomeScreenProps {
  folders: Folder[];
  documents: DocumentRecord[];
  activeFolder: FilterValue;
  searchQuery: string;
  onChangeFolder: (folder: FilterValue) => void;
  onChangeSearch: (query: string) => void;
  onRefresh: () => void;
  onOpenDocument: (documentId: string) => void;
}

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatRelativeDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDoc = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDoc) / 86400000);

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
}

export function HomeScreen({
  folders,
  documents,
  activeFolder,
  searchQuery,
  onChangeFolder,
  onChangeSearch,
  onRefresh,
  onOpenDocument,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = useSafeBottom();
  const [scanning, setScanning] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchFocused, setSearchFocused] = useState(false);

  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);

  const [optionsDoc, setOptionsDoc] = useState<DocumentRecord | null>(null);
  const [renamingDoc, setRenamingDoc] = useState<DocumentRecord | null>(null);
  const [movingDoc, setMovingDoc] = useState<DocumentRecord | null>(null);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [pendingCropUris, setPendingCropUris] = useState<string[] | null>(null);

  const targetFolderForNewScan = useMemo(() => {
    if (
      activeFolder === 'ALL' ||
      activeFolder === 'SIGNED' ||
      activeFolder === 'PROTECTED' ||
      activeFolder === 'UNASSIGNED'
    ) {
      return null;
    }
    return activeFolder;
  }, [activeFolder]);

  const sectionLabel = useMemo(() => {
    if (searchQuery.trim()) return `RESULTADOS (${documents.length})`;
    if (activeFolder === 'ALL') return `RECIENTES (${documents.length})`;
    if (activeFolder === 'SIGNED') return `FIRMADOS (${documents.length})`;
    if (activeFolder === 'PROTECTED') return `PROTEGIDOS (${documents.length})`;
    if (activeFolder === 'UNASSIGNED') return `SIN CARPETA (${documents.length})`;
    const match = folders.find((f) => f.id === activeFolder);
    return `${(match?.name ?? 'CARPETA').toUpperCase()} (${documents.length})`;
  }, [activeFolder, documents.length, folders, searchQuery]);

  const handleSelectFilter = (next: FilterValue) => {
    Haptics.selectionAsync().catch(() => {});
    onChangeFolder(next);
  };

  const handleToggleViewMode = () => {
    Haptics.selectionAsync().catch(() => {});
    setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'));
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
      setPendingCropUris(camRes.assets.map((a) => a.uri));
    }
  };

  const handleScanNew = async () => {
    try {
      setScanning(true);
      const res = await scanDocument({ pageLimit: 30, galleryImportAllowed: true });
      if (res.cancelled || res.pageUris.length === 0) {
        return;
      }
      const docId = createDocument(formatDefaultDocTitle(), res.pageUris, targetFolderForNewScan);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onRefresh();
      onOpenDocument(docId);
    } catch {
      try {
        await launchCameraFallback();
      } catch (fallbackErr) {
        Alert.alert(
          'No se pudo abrir la cámara',
          fallbackErr instanceof Error
            ? fallbackErr.message
            : 'Verifica los permisos de cámara e intenta de nuevo.'
        );
      }
    } finally {
      setScanning(false);
    }
  };

  const handleImportGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.95,
      });
      if (result.canceled || result.assets.length === 0) return;

      // Abrir detector de bordes y recorte de perspectiva para cada imagen seleccionada
      setPendingCropUris(result.assets.map((asset) => asset.uri));
    } catch (err) {
      Alert.alert(
        'Error al importar',
        err instanceof Error ? err.message : 'No se pudieron importar las imágenes.'
      );
    }
  };

  const handleDocOptions = (doc: DocumentRecord) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOptionsDoc(doc);
  };

  const confirmDeleteDoc = (doc: DocumentRecord) => {
    Alert.alert(
      'Eliminar documento',
      `Se eliminarán "${doc.title}" y todas sus hojas (${doc.pageCount}).`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            deleteDocument(doc.id);
            onRefresh();
          },
        },
      ],
      { cancelable: true }
    );
  };

  const renderGridCard = ({ item }: { item: DocumentRecord }) => {
    const hasOcr = item.ocrText.trim().length > 0;
    const isSigned = item.signatureCount > 0;

    return (
      <TouchableOpacity
        style={styles.gridCard}
        activeOpacity={0.86}
        onPress={() => onOpenDocument(item.id)}
        onLongPress={() => handleDocOptions(item)}
      >
        <View style={styles.gridThumbWrap}>
          {item.coverUri ? (
            <Image source={{ uri: item.coverUri }} style={styles.thumbImg} resizeMode="cover" />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <Ionicons name="document-text-outline" size={30} color={COLORS.textMuted} />
            </View>
          )}

          <View style={styles.gridPageBadge}>
            <Text style={styles.gridPageBadgeText}>{item.pageCount} pág</Text>
          </View>

          {item.folderName && (
            <View style={styles.gridFolderDotWrap}>
              <View
                style={[
                  styles.gridFolderDot,
                  { backgroundColor: item.folderColor || COLORS.primary },
                ]}
              />
            </View>
          )}
        </View>

        <View style={styles.gridCardBody}>
          <View style={styles.gridTitleRow}>
            <Text numberOfLines={1} style={styles.gridDocTitle}>
              {item.title}
            </Text>
            <TouchableOpacity
              onPress={() => handleDocOptions(item)}
              hitSlop={10}
              style={styles.gridMoreBtn}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.gridMetaRow}>
            <Text numberOfLines={1} style={styles.gridMetaText}>
              {formatRelativeDate(item.updatedAt)}
              {hasOcr ? ' · OCR' : ''}
              {isSigned ? ' · Firmado' : ''}
            </Text>
            <View style={styles.gridMetaIcons}>
              {isSigned && <Ionicons name="pencil" size={11} color={COLORS.primary} />}
              {item.isPasswordProtected && (
                <Ionicons name="lock-closed" size={12} color={COLORS.warning} />
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderListCard = ({ item }: { item: DocumentRecord }) => {
    const hasOcr = item.ocrText.trim().length > 0;
    const isSigned = item.signatureCount > 0;

    return (
      <TouchableOpacity
        style={styles.listCard}
        activeOpacity={0.85}
        onPress={() => onOpenDocument(item.id)}
        onLongPress={() => handleDocOptions(item)}
      >
        <View style={styles.listThumbWrap}>
          {item.coverUri ? (
            <Image source={{ uri: item.coverUri }} style={styles.thumbImg} resizeMode="cover" />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <Ionicons name="document-outline" size={24} color={COLORS.textMuted} />
            </View>
          )}
          <View style={styles.listPageBadge}>
            <Text style={styles.listPageBadgeText}>{item.pageCount} pág</Text>
          </View>
        </View>

        <View style={styles.listInfo}>
          <Text numberOfLines={1} style={styles.listDocTitle}>
            {item.title}
          </Text>
          <Text style={styles.listDocDate}>{formatRelativeDate(item.updatedAt)}</Text>

          <View style={styles.badgesRow}>
            {item.folderName && (
              <View style={styles.metaPill}>
                <View
                  style={[
                    styles.metaDot,
                    { backgroundColor: item.folderColor || COLORS.primary },
                  ]}
                />
                <Text numberOfLines={1} style={styles.metaPillText}>
                  {item.folderName}
                </Text>
              </View>
            )}

            {hasOcr && (
              <View style={[styles.metaPill, { backgroundColor: COLORS.successBg }]}>
                <Text style={[styles.metaPillText, { color: COLORS.success }]}>OCR</Text>
              </View>
            )}

            {isSigned && (
              <View style={[styles.metaPill, { backgroundColor: COLORS.primaryLight }]}>
                <Ionicons name="pencil" size={10} color={COLORS.primary} />
                <Text style={[styles.metaPillText, { color: COLORS.primary }]}>Firmado</Text>
              </View>
            )}

            {item.isPasswordProtected && (
              <View style={[styles.metaPill, { backgroundColor: COLORS.warningBg }]}>
                <Ionicons name="lock-closed" size={10} color={COLORS.warning} />
                <Text style={[styles.metaPillText, { color: COLORS.warning }]}>PDF</Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.listMoreBtn}
          onPress={() => handleDocOptions(item)}
          hitSlop={10}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Brand Header */}
      <View style={styles.header}>
        <View style={styles.brandLockup}>
          <ScanlyLogo size={30} />
          <Text style={styles.brandTitle}>Scanly</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={handleToggleViewMode}
            accessibilityLabel={viewMode === 'grid' ? 'Ver como lista' : 'Ver como cuadrícula'}
          >
            <Ionicons
              name={viewMode === 'grid' ? 'list-outline' : 'grid-outline'}
              size={18}
              color={COLORS.navy}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setSignaturePadOpen(true)}
            accessibilityLabel="Mis firmas"
          >
            <Ionicons name="create-outline" size={19} color={COLORS.navy} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}>
        <Ionicons name="search-outline" size={17} color={COLORS.textMuted} />
        <TextInput
          value={searchQuery}
          onChangeText={onChangeSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Buscar documentos o texto OCR"
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => onChangeSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter & Folder Chips */}
      <View style={styles.chipsBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          <TouchableOpacity
            style={[styles.chip, activeFolder === 'ALL' && styles.chipActive]}
            onPress={() => handleSelectFilter('ALL')}
          >
            <Text style={[styles.chipText, activeFolder === 'ALL' && styles.chipTextActive]}>
              Todos
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.chip, activeFolder === 'SIGNED' && styles.chipActive]}
            onPress={() => handleSelectFilter('SIGNED')}
          >
            <Text style={[styles.chipText, activeFolder === 'SIGNED' && styles.chipTextActive]}>
              Firmados
            </Text>
          </TouchableOpacity>

          {folders.map((folder) => {
            const selected = activeFolder === folder.id;
            return (
              <TouchableOpacity
                key={folder.id}
                style={[styles.chip, selected && styles.chipActive]}
                onPress={() => handleSelectFilter(folder.id)}
                onLongPress={() => {
                  setEditingFolder(folder);
                  setFolderModalVisible(true);
                }}
              >
                <View
                  style={[
                    styles.folderDot,
                    { backgroundColor: selected ? '#FFFFFF' : folder.color },
                  ]}
                />
                <Text numberOfLines={1} style={[styles.chipText, selected && styles.chipTextActive]}>
                  {folder.name}
                </Text>
                {(folder.documentCount ?? 0) > 0 && (
                  <Text style={[styles.chipCount, selected && styles.chipCountActive]}>
                    {folder.documentCount}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={styles.addFolderChip}
            onPress={() => {
              setEditingFolder(null);
              setFolderModalVisible(true);
            }}
          >
            <Ionicons name="add" size={15} color={COLORS.primary} />
            <Text style={styles.addFolderText}>Carpeta</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Documents Grid / List */}
      <FlatList
        key={viewMode}
        data={documents}
        numColumns={viewMode === 'grid' ? 2 : 1}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          documents.length === 0 && styles.listContentEmpty,
          { paddingBottom: 122 + safeBottom },
        ]}
        ListHeaderComponent={
          documents.length > 0 ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{sectionLabel}</Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <EmptyStateIllustration
              variant={
                searchQuery.trim()
                  ? 'search'
                  : activeFolder === 'ALL'
                  ? 'vault'
                  : 'filter'
              }
              size={118}
            />
            <Text style={styles.emptyTitle}>
              {searchQuery.trim()
                ? 'Sin resultados'
                : activeFolder === 'ALL'
                ? 'Sin documentos'
                : 'Sin elementos'}
            </Text>
            <Text style={styles.emptyDesc}>
              {searchQuery.trim()
                ? 'Prueba con otro término'
                : activeFolder === 'ALL'
                ? 'Escanea o importa para comenzar'
                : 'Nada guardado en esta vista'}
            </Text>
          </View>
        }
        renderItem={viewMode === 'grid' ? renderGridCard : renderListCard}
      />

      {/* Bottom Floating Action Cluster */}
      <View style={[styles.fabCluster, { bottom: 18 + safeBottom }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.galleryFab}
          onPress={handleImportGallery}
          disabled={scanning}
          activeOpacity={0.85}
          accessibilityLabel="Importar desde galería"
        >
          <Ionicons name="images-outline" size={22} color={COLORS.navy} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.scanFab}
          onPress={handleScanNew}
          disabled={scanning}
          activeOpacity={0.9}
        >
          {scanning ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="camera-outline" size={21} color="#FFFFFF" />
              <Text style={styles.scanFabText}>Escanear</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Document Options Bottom Sheet (replaces 4-button Android Alert) */}
      <Modal
        visible={optionsDoc !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsDoc(null)}
      >
        <Pressable style={styles.optionsBackdrop} onPress={() => setOptionsDoc(null)}>
          <Pressable
            style={[styles.optionsSheet, { paddingBottom: Math.max(22, safeBottom + 12) }]}
            onPress={() => {}}
          >
            <View style={styles.optionsHandle} />
            <Text numberOfLines={1} style={styles.optionsTitle}>
              {optionsDoc?.title ?? ''}
            </Text>
            <Text style={styles.optionsSubtitle}>
              {optionsDoc
                ? `${optionsDoc.pageCount} ${optionsDoc.pageCount === 1 ? 'página' : 'páginas'}`
                : ''}
            </Text>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                const target = optionsDoc;
                setOptionsDoc(null);
                if (target) setRenamingDoc(target);
              }}
            >
              <View style={styles.optionIconBox}>
                <Ionicons name="pencil-outline" size={18} color={COLORS.navy} />
              </View>
              <Text style={styles.optionRowText}>Renombrar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                const target = optionsDoc;
                setOptionsDoc(null);
                if (target) setMovingDoc(target);
              }}
            >
              <View style={styles.optionIconBox}>
                <Ionicons name="folder-outline" size={18} color={COLORS.navy} />
              </View>
              <Text style={styles.optionRowText}>Mover a carpeta</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                const target = optionsDoc;
                setOptionsDoc(null);
                if (target) confirmDeleteDoc(target);
              }}
            >
              <View style={[styles.optionIconBox, { backgroundColor: COLORS.dangerBg }]}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </View>
              <Text style={[styles.optionRowText, { color: COLORS.danger }]}>
                Eliminar documento
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionCancelBtn}
              onPress={() => setOptionsDoc(null)}
            >
              <Text style={styles.optionCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sheet Cropper Modal for gallery imports & camera fallback */}
      <CropDocumentModal
        visible={pendingCropUris !== null && pendingCropUris.length > 0}
        imageUris={pendingCropUris ?? []}
        title="Recortar hoja"
        onCancel={() => setPendingCropUris(null)}
        onComplete={(croppedUris) => {
          setPendingCropUris(null);
          if (croppedUris.length === 0) return;
          const docId = createDocument(
            formatDefaultDocTitle(),
            croppedUris,
            targetFolderForNewScan
          );
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          onRefresh();
          onOpenDocument(docId);
        }}
      />

      {/* Modals */}
      <FolderModal
        visible={folderModalVisible}
        mode={editingFolder ? 'edit' : 'create'}
        initialName={editingFolder?.name}
        initialColor={editingFolder?.color}
        onClose={() => {
          setFolderModalVisible(false);
          setEditingFolder(null);
        }}
        onSave={(name, color) => {
          if (editingFolder) {
            updateFolder(editingFolder.id, name, color);
          } else {
            createFolder(name, color);
          }
          onRefresh();
        }}
        onDelete={
          editingFolder
            ? () => {
                Alert.alert(
                  'Eliminar carpeta',
                  `Los documentos dentro de "${editingFolder.name}" no se borrarán, pasarán a "Sin carpeta".`,
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Eliminar',
                      style: 'destructive',
                      onPress: () => {
                        deleteFolder(editingFolder.id);
                        if (activeFolder === editingFolder.id) {
                          onChangeFolder('ALL');
                        }
                        setFolderModalVisible(false);
                        setEditingFolder(null);
                        onRefresh();
                      },
                    },
                  ],
                  { cancelable: true }
                );
              }
            : undefined
        }
      />

      <RenameModal
        visible={renamingDoc !== null}
        initialValue={renamingDoc?.title ?? ''}
        onClose={() => setRenamingDoc(null)}
        onSave={(newTitle) => {
          if (renamingDoc) {
            renameDocument(renamingDoc.id, newTitle);
            onRefresh();
          }
        }}
      />

      <MoveFolderModal
        visible={movingDoc !== null}
        folders={folders}
        currentFolderId={movingDoc?.folderId ?? null}
        onClose={() => setMovingDoc(null)}
        onSelect={(folderId) => {
          if (movingDoc) {
            moveDocumentToFolder(movingDoc.id, folderId);
            onRefresh();
          }
        }}
      />

      <SignaturePadModal
        visible={signaturePadOpen}
        initialTab="saved"
        onClose={() => setSignaturePadOpen(false)}
        onCreated={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }}
        onChanged={onRefresh}
      />
    </View>
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
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.navy,
    letterSpacing: -0.6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 18,
    paddingHorizontal: 14,
    height: 42,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  searchWrapFocused: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primaryBorder,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 0,
  },
  chipsBar: {
    marginTop: 14,
    marginBottom: 4,
  },
  chipsContent: {
    paddingHorizontal: 18,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 15,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.navy,
    borderColor: COLORS.navy,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  chipCount: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  chipCountActive: {
    color: 'rgba(255,255,255,0.75)',
  },
  folderDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  addFolderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryBorder,
    backgroundColor: COLORS.surface,
  },
  addFolderText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 10,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.9,
  },
  listContent: {
    paddingHorizontal: 18,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  gridRow: {
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  gridCard: {
    flex: 1,
    maxWidth: '48.4%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 9,
    ...SHADOWS.card,
  },
  gridThumbWrap: {
    width: '100%',
    aspectRatio: 0.9,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceMuted,
    position: 'relative',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridPageBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    backgroundColor: 'rgba(15, 23, 42, 0.84)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  gridPageBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  gridFolderDotWrap: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridFolderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gridCardBody: {
    paddingTop: 9,
    paddingHorizontal: 2,
    gap: 3,
  },
  gridTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  gridDocTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  gridMoreBtn: {
    paddingLeft: 4,
  },
  gridMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  gridMetaText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  gridMetaIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    gap: 12,
    marginBottom: 10,
    ...SHADOWS.card,
  },
  listThumbWrap: {
    width: 60,
    height: 78,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceMuted,
    position: 'relative',
  },
  listPageBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.84)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  listPageBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  listInfo: {
    flex: 1,
    gap: 3,
  },
  listDocTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  listDocDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 3,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surfaceMuted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  metaDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  listMoreBtn: {
    padding: 6,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.navy,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginTop: 6,
  },
  emptyDesc: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  fabCluster: {
    position: 'absolute',
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  galleryFab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.fabSoft,
  },
  scanFab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    height: 52,
    paddingHorizontal: 22,
    borderRadius: 26,
    minWidth: 144,
    ...SHADOWS.fab,
  },
  scanFabText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  // Document Options Sheet
  optionsBackdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  optionsSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  optionsHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  optionsTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.navy,
  },
  optionsSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
    marginBottom: 14,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  optionIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionRowText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.navy,
  },
  optionCancelBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
});
