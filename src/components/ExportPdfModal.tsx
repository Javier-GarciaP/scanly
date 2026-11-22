import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import {
  generatePdf,
  saveToDownloads,
  type PageSizeOption,
  type SignatureOverlayInput,
} from '../../modules/doc-engine';
import { getPdfOutputPath, renameDocument, updateDocumentPdf } from '../storage/database';
import type { DocumentDetail } from '../types/models';
import { COLORS, SHADOWS } from '../theme/colors';

interface ExportPdfModalProps {
  visible: boolean;
  document: DocumentDetail | null;
  onClose: () => void;
  onExported: () => void;
}

const PAGE_SIZES: { label: string; value: PageSizeOption }[] = [
  { label: 'A4', value: 'A4' },
  { label: 'Carta', value: 'LETTER' },
  { label: 'Ajustar', value: 'FIT' },
];

export function ExportPdfModal({
  visible,
  document,
  onClose,
  onExported,
}: ExportPdfModalProps) {
  const insets = useSafeAreaInsets();
  const [fileName, setFileName] = useState('');
  const [pageSize, setPageSize] = useState<PageSizeOption>('A4');
  const [protectPdf, setProtectPdf] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busyAction, setBusyAction] = useState<'share' | 'download' | 'preview' | null>(null);

  useEffect(() => {
    if (visible && document) {
      setFileName(document.title.replace(/\.pdf$/i, ''));
      setProtectPdf(document.isPasswordProtected);
      setPassword('');
      setShowPassword(false);
      setBusyAction(null);
    }
  }, [visible, document?.id, document?.title]);

  const totalSignatures =
    document?.pages.reduce((sum, p) => sum + p.signatures.length, 0) ?? 0;
  const pageCount = document?.pages.length ?? 0;

  const cleanExportName = () => {
    const trimmed = fileName.trim().replace(/\.pdf$/i, '');
    return trimmed || document?.title || 'Documento';
  };

  const buildPdfNow = async (): Promise<{ uri: string; name: string } | null> => {
    if (!document || document.pages.length === 0) {
      Alert.alert('Sin páginas', 'Agrega al menos una página antes de exportar.');
      return null;
    }

    if (protectPdf && password.trim().length < 4) {
      Alert.alert(
        'Contraseña muy corta',
        'Escribe una contraseña de al menos 4 caracteres para cifrar el PDF.'
      );
      return null;
    }

    const finalTitle = cleanExportName();
    if (finalTitle !== document.title) {
      renameDocument(document.id, finalTitle);
    }

    const signatures: SignatureOverlayInput[] = [];
    document.pages.forEach((p, idx) => {
      p.signatures.forEach((s) => {
        signatures.push({
          pageIndex: idx,
          imageUri: s.imageUri,
          xRatio: s.xRatio,
          yRatio: s.yRatio,
          widthRatio: s.widthRatio,
        });
      });
    });

    const outputPath = getPdfOutputPath(document.id, finalTitle);
    const result = await generatePdf({
      imageUris: document.pages.map((p) => p.imageUri),
      outputPath,
      password: protectPdf ? password.trim() : undefined,
      pageSize,
      signatures,
    });

    updateDocumentPdf(document.id, result.uri, protectPdf);
    onExported();
    return { uri: result.uri, name: finalTitle };
  };

  const handleSaveDownloads = async () => {
    if (!document) return;
    try {
      setBusyAction('download');
      const built = await buildPdfNow();
      if (!built) return;

      const res = await saveToDownloads(built.uri, `${built.name}.pdf`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'PDF guardado',
        `Se guardó sin marcas de agua en:\n${res.savedPath}`,
        [{ text: 'Listo', onPress: onClose }]
      );
    } catch (err) {
      Alert.alert(
        'Error al guardar',
        err instanceof Error ? err.message : 'No se pudo guardar en Descargas.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleShare = async () => {
    try {
      setBusyAction('share');
      const built = await buildPdfNow();
      if (!built) return;

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Compartir no disponible', 'Usa "Guardar en Descargas" en este dispositivo.');
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      await Sharing.shareAsync(built.uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Compartir ${built.name}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (err) {
      Alert.alert(
        'Error al exportar',
        err instanceof Error ? err.message : 'No se pudo generar el PDF.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handlePreview = async () => {
    try {
      setBusyAction('preview');
      const built = await buildPdfNow();
      if (!built) return;
      const pdfFile = new File(built.uri);
      await File.preview(pdfFile, {
        mimeType: 'application/pdf',
        title: `${built.name}.pdf`,
      });
    } catch (err) {
      Alert.alert(
        'No se pudo abrir',
        err instanceof Error
          ? err.message
          : 'Asegúrate de tener un lector de PDF instalado o usa Compartir.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 14) }]}
            onPress={() => {}}
          >
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Exportar PDF</Text>
              <TouchableOpacity style={styles.closeCircle} onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Filename Field */}
            <Text style={styles.fieldLabel}>Nombre del archivo</Text>
            <View style={styles.fileInputWrap}>
              <TextInput
                value={fileName}
                onChangeText={setFileName}
                placeholder="Nombre del documento"
                placeholderTextColor={COLORS.textMuted}
                style={styles.fileInput}
                maxLength={70}
              />
              <View style={styles.pdfExtPill}>
                <Text style={styles.pdfExtText}>.pdf</Text>
              </View>
            </View>

            {/* Page Size Segmented Control */}
            <Text style={styles.fieldLabel}>Tamaño de página</Text>
            <View style={styles.segmentTrack}>
              {PAGE_SIZES.map((item) => {
                const selected = pageSize === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[styles.segmentBtn, selected && styles.segmentBtnActive]}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setPageSize(item.value);
                    }}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        selected && styles.segmentTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Security Card */}
            <View style={styles.securityCard}>
              <View style={styles.securityTopRow}>
                <View style={styles.securityTitleRow}>
                  <Ionicons
                    name={protectPdf ? 'lock-closed' : 'lock-open-outline'}
                    size={19}
                    color={protectPdf ? COLORS.warning : COLORS.textSecondary}
                  />
                  <Text style={styles.securityTitle}>Proteger con contraseña</Text>
                </View>

                <Switch
                  value={protectPdf}
                  onValueChange={(v) => {
                    Haptics.selectionAsync().catch(() => {});
                    setProtectPdf(v);
                  }}
                  trackColor={{ false: '#CBD5E1', true: COLORS.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {protectPdf && (
                <View style={styles.passwordWrap}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Contraseña (mín. 4 caracteres)"
                    placeholderTextColor={COLORS.textMuted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    style={styles.passwordInput}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeBtn}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                      size={19}
                      color={COLORS.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.securityFootnote}>
                <Ionicons
                  name="shield-checkmark"
                  size={15}
                  color={protectPdf ? COLORS.success : COLORS.textMuted}
                />
                <Text
                  style={[
                    styles.securityFootnoteText,
                    protectPdf && { color: COLORS.success },
                  ]}
                >
                  Cifrado estándar AES 128-bit
                </Text>
              </View>
            </View>

            {/* Summary Row */}
            <Text style={styles.summaryText}>
              {pageCount} {pageCount === 1 ? 'página' : 'páginas'}
              {totalSignatures > 0
                ? ` · ${totalSignatures} ${totalSignatures === 1 ? 'firma aplicada' : 'firmas aplicadas'}`
                : ''}{' '}
              · Sin marca de agua
            </Text>

            {/* Stacked Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.primaryNavyBtn}
                onPress={handleSaveDownloads}
                disabled={busyAction !== null}
                activeOpacity={0.88}
              >
                {busyAction === 'download' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.primaryNavyBtnText}>Guardar en Descargas</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryOutlineBtn}
                onPress={handleShare}
                disabled={busyAction !== null}
                activeOpacity={0.85}
              >
                {busyAction === 'share' ? (
                  <ActivityIndicator color={COLORS.navy} />
                ) : (
                  <>
                    <Ionicons name="share-social-outline" size={19} color={COLORS.navy} />
                    <Text style={styles.secondaryOutlineBtnText}>Compartir PDF</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.previewLinkBtn}
                onPress={handlePreview}
                disabled={busyAction !== null}
              >
                {busyAction === 'preview' ? (
                  <ActivityIndicator size="small" color={COLORS.textSecondary} />
                ) : (
                  <>
                    <Ionicons name="open-outline" size={15} color={COLORS.textSecondary} />
                    <Text style={styles.previewLinkText}>Abrir vista previa del PDF</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.navy,
    letterSpacing: -0.4,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 7,
  },
  fileInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingLeft: 14,
    paddingRight: 8,
    height: 46,
    marginBottom: 16,
  },
  fileInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.navy,
    paddingVertical: 0,
  },
  pdfExtPill: {
    backgroundColor: COLORS.surfaceMuted,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  pdfExtText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: COLORS.surface,
    ...SHADOWS.segment,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  segmentTextActive: {
    color: COLORS.navy,
    fontWeight: '700',
  },
  securityCard: {
    backgroundColor: COLORS.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  securityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  securityTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securityTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.navy,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    height: 44,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.navy,
  },
  eyeBtn: {
    paddingHorizontal: 12,
  },
  securityFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  securityFootnoteText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
  },
  actions: {
    gap: 10,
  },
  primaryNavyBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: COLORS.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryNavyBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryOutlineBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryOutlineBtnText: {
    color: COLORS.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  previewLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  previewLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});
