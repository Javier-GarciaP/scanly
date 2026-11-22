import { Platform } from 'react-native';

export const COLORS = {
  bg: '#F8FAFC',
  canvas: '#E2E8F0',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  navy: '#0F172A',
  navySoft: '#1E293B',
  primary: '#2563EB',
  primaryLight: '#EFF6FF',
  primaryBorder: '#BFDBFE',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  borderSubtle: '#EEF2F6',
  success: '#10B981',
  successBg: '#ECFDF5',
  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  danger: '#EF4444',
  dangerBg: '#FEF2F2',
  overlay: 'rgba(15, 23, 42, 0.48)',
};

export const SHADOWS = {
  card: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }),
  page: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 18,
    },
    android: {
      elevation: 6,
    },
    default: {},
  }),
  fab: Platform.select({
    ios: {
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 14,
    },
    android: {
      elevation: 7,
    },
    default: {},
  }),
  fabSoft: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
    },
    android: {
      elevation: 4,
    },
    default: {},
  }),
  segment: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }),
};

export const FOLDER_COLORS = [
  '#2563EB',
  '#10B981',
  '#F59E0B',
  '#7C3AED',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#475569',
];
