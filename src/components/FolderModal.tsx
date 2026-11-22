import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FOLDER_COLORS } from '../theme/colors';

interface FolderModalProps {
  visible: boolean;
  initialName?: string;
  initialColor?: string;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSave: (name: string, color: string) => void;
  onDelete?: () => void;
}

export function FolderModal({
  visible,
  initialName = '',
  initialColor = FOLDER_COLORS[0],
  mode,
  onClose,
  onSave,
  onDelete,
}: FolderModalProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setColor(initialColor || FOLDER_COLORS[0]);
    }
  }, [visible, initialName, initialColor]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, color);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {mode === 'create' ? 'Nueva carpeta' : 'Editar carpeta'}
            </Text>
            <TouchableOpacity style={styles.closeCircle} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ej. Contratos, Impuestos, Estudios..."
            placeholderTextColor={COLORS.textMuted}
            style={styles.input}
            autoFocus
            maxLength={32}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          <Text style={styles.label}>Color de etiqueta</Text>
          <View style={styles.colorGrid}>
            {FOLDER_COLORS.map((swatch) => {
              const selected = swatch === color;
              return (
                <TouchableOpacity
                  key={swatch}
                  style={[
                    styles.swatch,
                    { backgroundColor: swatch },
                    selected && styles.swatchSelected,
                  ]}
                  onPress={() => setColor(swatch)}
                >
                  {selected && <Ionicons name="checkmark" size={17} color="#FFFFFF" />}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actions}>
            {mode === 'edit' && onDelete ? (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
                <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
                <Text style={styles.deleteText}>Eliminar</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}

            <View style={styles.rightActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, !name.trim() && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!name.trim()}
              >
                <Text style={styles.saveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
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
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 20,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
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
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 7,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: COLORS.navy,
    backgroundColor: COLORS.bg,
    marginBottom: 16,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 22,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 2.5,
    borderColor: COLORS.navy,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.dangerBg,
  },
  deleteText: {
    color: COLORS.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceMuted,
  },
  cancelText: {
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: COLORS.navy,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
