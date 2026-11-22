import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { recognizeText } from '../../modules/doc-engine';
import type { DocumentDetail } from '../types/models';
import { updatePageOcr } from '../storage/database';
import { EmptyStateIllustration } from './EmptyStateIllustration';
import { COLORS, SHADOWS } from '../theme/colors';

interface OcrModalProps {
  visible: boolean;
  document: DocumentDetail | null;
  pageIndex: number;
  onClose: () => void;
  onSaved: () => void;
}

export function OcrModal({
  visible,
  document,
  pageIndex,
  onClose,
  onSaved,
}: OcrModalProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [viewTab, setViewTab] = useState<'blocks' | 'full'>('blocks');
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [loading, setLoading] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null);

  const currentPage = document?.pages[pageIndex] ?? null;

  const derivedBlocks = useMemo(() => {
    if (blocks.length > 0) return blocks;
    const trimmed = text.trim();
    if (!trimmed) return [];
    const split = trimmed
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);
    return split.length > 0 ? split : [trimmed];
  }, [blocks, text]);

  useEffect(() => {
    if (visible && document && currentPage) {
      setCopiedAll(false);
      setCopiedBlockIndex(null);
      setScope('page');
      setViewTab('blocks');
      if (currentPage.ocrText.trim()) {
        setText(currentPage.ocrText);
        setBlocks([]);
      } else {
        setText('');
        setBlocks([]);
        runOcrForCurrentPage();
      }
    }
  }, [visible, document?.id, pageIndex]);

  const runOcrForCurrentPage = async () => {
    if (!document || !currentPage) return;
    try {
      setLoading(true);
      setScope('page');
      setStatusLabel(`Analizando página ${pageIndex + 1} (offline)...`);
      const res = await recognizeText(currentPage.imageUri);
      const recognized = res.text.trim();
      const extractedBlocks = res.blocks.map((b) => b.text.trim()).filter(Boolean);
      setText(recognized);
      setBlocks(extractedBlocks);
      updatePageOcr(document.id, currentPage.id, recognized);
      onSaved();
    } catch (err) {
      Alert.alert(
        'Error de OCR',
        err instanceof Error ? err.message : 'No se pudo extraer el texto.'
      );
    } finally {
      setLoading(false);
      setStatusLabel('');
    }
  };

  const runOcrForAllPages = async () => {
    if (!document || document.pages.length === 0) return;
    try {
      setLoading(true);
      setScope('all');
      const parts: string[] = [];
      const allBlocks: string[] = [];
      for (let i = 0; i < document.pages.length; i++) {
        const p = document.pages[i];
        setStatusLabel(`Analizando página ${i + 1} de ${document.pages.length}...`);
        const res = await recognizeText(p.imageUri);
        const pageText = res.text.trim();
        updatePageOcr(document.id, p.id, pageText);
        if (pageText) {
          parts.push(`--- Página ${i + 1} ---\n${pageText}`);
          allBlocks.push(`Pág. ${i + 1}\n${pageText}`);
        }
      }
      setText(parts.join('\n\n'));
      setBlocks(allBlocks);
      onSaved();
    } catch (err) {
      Alert.alert(
        'Error de OCR',
        err instanceof Error ? err.message : 'No se pudo extraer el texto de todas las páginas.'
      );
    } finally {
      setLoading(false);
      setStatusLabel('');
    }
  };

  const handleCopyAll = async () => {
    if (!text.trim()) return;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopyBlock = async (blockText: string, idx: number) => {
    await Clipboard.setStringAsync(blockText);
    Haptics.selectionAsync().catch(() => {});
    setCopiedBlockIndex(idx);
    setTimeout(() => {
      setCopiedBlockIndex((curr) => (curr === idx ? null : curr));
    }, 1600);
  };

  const handleCloseAndSave = () => {
    if (document && currentPage && scope === 'page') {
      const cleaned = text.trim();
      if (cleaned !== currentPage.ocrText.trim()) {
        updatePageOcr(document.id, currentPage.id, cleaned);
        onSaved();
      }
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCloseAndSave}>
      <Pressable style={styles.backdrop} onPress={handleCloseAndSave}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(20, insets.bottom + 10) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {scope === 'all'
                  ? `Texto detectado (${document?.pages.length ?? 0} págs)`
                  : `Texto detectado (Pág. ${pageIndex + 1})`}
              </Text>
            </View>

            <TouchableOpacity style={styles.closeCircle} onPress={handleCloseAndSave} hitSlop={8}>
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Segmented Control */}
          <View style={styles.segmentTrack}>
            <TouchableOpacity
              style={[styles.segmentBtn, viewTab === 'full' && styles.segmentBtnActive]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setViewTab('full');
              }}
            >
              <Text
                style={[styles.segmentText, viewTab === 'full' && styles.segmentTextActive]}
              >
                Texto completo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, viewTab === 'blocks' && styles.segmentBtnActive]}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setViewTab('blocks');
              }}
            >
              <Text
                style={[styles.segmentText, viewTab === 'blocks' && styles.segmentTextActive]}
              >
                Por bloques ({derivedBlocks.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Multi-page quick pill */}
          {(document?.pages.length ?? 0) > 1 && !loading && (
            <TouchableOpacity style={styles.allPagesBanner} onPress={runOcrForAllPages}>
              <Ionicons name="documents-outline" size={14} color={COLORS.primary} />
              <Text style={styles.allPagesBannerText}>
                Extraer texto de las {document?.pages.length} páginas
              </Text>
            </TouchableOpacity>
          )}

          {/* Body */}
          <View style={styles.body}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>{statusLabel || 'Reconociendo texto...'}</Text>
                <Text style={styles.loadingSub}>Procesamiento 100% local en el dispositivo</Text>
              </View>
            ) : viewTab === 'blocks' ? (
              derivedBlocks.length > 0 ? (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.blocksList}
                >
                  {derivedBlocks.map((block, idx) => {
                    const isCopied = copiedBlockIndex === idx;
                    return (
                      <View key={idx} style={styles.blockCard}>
                        <Text selectable style={styles.blockText}>
                          {block}
                        </Text>
                        <TouchableOpacity
                          style={styles.blockCopyBtn}
                          onPress={() => handleCopyBlock(block, idx)}
                          hitSlop={10}
                        >
                          <Ionicons
                            name={isCopied ? 'checkmark' : 'copy-outline'}
                            size={16}
                            color={isCopied ? COLORS.success : COLORS.textSecondary}
                          />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={styles.emptyOcrBox}>
                  <EmptyStateIllustration variant="ocr" size={96} />
                  <Text style={styles.emptyOcrTitle}>Sin texto detectado</Text>
                  <Text style={styles.emptyOcrSub}>Toca Re-analizar para intentar</Text>
                </View>
              )
            ) : (
              <TextInput
                value={text}
                onChangeText={(val) => {
                  setText(val);
                  setBlocks([]);
                }}
                multiline
                textAlignVertical="top"
                placeholder="No se detectó texto en esta página. Toca Re-analizar o escribe aquí..."
                placeholderTextColor={COLORS.textMuted}
                style={styles.fullTextArea}
              />
            )}
          </View>

          {/* Footer Actions */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, loading && { opacity: 0.5 }]}
              onPress={runOcrForCurrentPage}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.outlineBtnText}>Re-analizar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.navyBtn,
                copiedAll && { backgroundColor: COLORS.success },
                (!text.trim() || loading) && { opacity: 0.45 },
              ]}
              onPress={handleCopyAll}
              disabled={!text.trim() || loading}
              activeOpacity={0.88}
            >
              <Ionicons
                name={copiedAll ? 'checkmark-circle' : 'clipboard-outline'}
                size={17}
                color="#FFFFFF"
              />
              <Text style={styles.navyBtnText}>
                {copiedAll ? '¡Copiado!' : 'Copiar todo'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
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
    height: '84%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.navy,
    letterSpacing: -0.3,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 999,
    padding: 4,
    marginBottom: 12,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: COLORS.surface,
    ...SHADOWS.segment,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  segmentTextActive: {
    color: COLORS.navy,
    fontWeight: '700',
  },
  allPagesBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  allPagesBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  body: {
    flex: 1,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.navy,
    marginTop: 4,
  },
  loadingSub: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  blocksList: {
    gap: 10,
    paddingBottom: 12,
  },
  blockCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    ...SHADOWS.card,
  },
  blockText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },
  blockCopyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyOcrBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyOcrTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.navy,
  },
  emptyOcrSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  fullTextArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.text,
    marginBottom: 12,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
  },
  outlineBtn: {
    flex: 1,
    height: 48,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLORS.navy,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.navy,
  },
  navyBtn: {
    flex: 1.15,
    height: 48,
    borderRadius: 999,
    backgroundColor: COLORS.navy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  navyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
