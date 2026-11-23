import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Folder } from '../types/models';
import { useSafeBottom } from '../hooks/useSafeBottom';
import { COLORS } from '../theme/colors';

interface MoveFolderModalProps {
  visible: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  onClose: () => void;
  onSelect: (folderId: string | null) => void;
}

export function MoveFolderModal({
  visible,
  folders,
  currentFolderId,
  onClose,
  onSelect,
}: MoveFolderModalProps) {
  const safeBottom = useSafeBottom();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(22, safeBottom + 12) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Mover a carpeta</Text>
            <TouchableOpacity style={styles.closeCircle} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.row, currentFolderId === null && styles.rowActive]}
              onPress={() => {
                onSelect(null);
                onClose();
              }}
            >
              <View style={styles.rowLeft}>
                <View style={styles.folderIconBox}>
                  <Ionicons name="folder-open-outline" size={18} color={COLORS.textSecondary} />
                </View>
                <Text style={styles.rowText}>Sin carpeta</Text>
              </View>
              {currentFolderId === null && (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              )}
            </TouchableOpacity>

            {folders.map((folder) => {
              const active = currentFolderId === folder.id;
              return (
                <TouchableOpacity
                  key={folder.id}
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => {
                    onSelect(folder.id);
                    onClose();
                  }}
                >
                  <View style={styles.rowLeft}>
                    <View style={[styles.folderIconBox, { backgroundColor: `${folder.color}18` }]}>
                      <Ionicons name="folder" size={18} color={folder.color} />
                    </View>
                    <Text style={styles.rowText}>{folder.name}</Text>
                  </View>
                  {active && (
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.navy,
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  rowActive: {
    backgroundColor: COLORS.primaryLight,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  folderIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.navy,
  },
});
