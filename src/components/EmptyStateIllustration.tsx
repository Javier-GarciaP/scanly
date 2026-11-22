import React from 'react';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export type EmptyVariant = 'vault' | 'search' | 'filter' | 'signatures' | 'ocr';

interface EmptyStateIllustrationProps {
  variant: EmptyVariant;
  size?: number;
}

export function EmptyStateIllustration({
  variant,
  size = 112,
}: EmptyStateIllustrationProps) {
  if (variant === 'signatures') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Rect x={14} y={24} width={92} height={72} rx={18} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={1.5} />
        <Line
          x1={28}
          y1={74}
          x2={92}
          y2={74}
          stroke="#CBD5E1"
          strokeWidth={1.4}
          strokeDasharray="4 4"
        />
        <Path
          d="M 32 68 C 39 45, 48 44, 51 62 C 53 71, 61 52, 68 58 C 74 63, 79 56, 87 57"
          fill="none"
          stroke="#0F172A"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={88} cy={57} r={3.5} fill="#2563EB" />
      </Svg>
    );
  }

  if (variant === 'search') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Rect x={22} y={18} width={62} height={80} rx={12} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={1.5} />
        <Rect x={34} y={36} width={28} height={5} rx={2.5} fill="#E2E8F0" />
        <Rect x={34} y={48} width={38} height={5} rx={2.5} fill="#EEF2F6" />
        <Rect x={34} y={60} width={24} height={5} rx={2.5} fill="#EEF2F6" />
        <Circle cx={74} cy={72} r={19} fill="#F8FAFC" stroke="#0F172A" strokeWidth={2.2} />
        <Line x1={88} y1={86} x2={99} y2={97} stroke="#2563EB" strokeWidth={3.2} strokeLinecap="round" />
      </Svg>
    );
  }

  if (variant === 'filter') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Rect x={28} y={20} width={64} height={80} rx={14} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={1.5} />
        <Rect x={42} y={42} width={36} height={5} rx={2.5} fill="#CBD5E1" />
        <Rect x={42} y={54} width={26} height={5} rx={2.5} fill="#E2E8F0" />
        <Circle cx={86} cy={30} r={8} fill="#EFF6FF" stroke="#2563EB" strokeWidth={1.8} />
        <Circle cx={86} cy={30} r={2.5} fill="#2563EB" />
      </Svg>
    );
  }

  if (variant === 'ocr') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Rect x={26} y={18} width={68} height={84} rx={14} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={1.5} />
        <Rect x={40} y={36} width={40} height={5} rx={2.5} fill="#CBD5E1" />
        <Rect x={40} y={48} width={32} height={5} rx={2.5} fill="#E2E8F0" />
        <Rect x={20} y={60} width={80} height={4} rx={2} fill="#2563EB" />
        <Rect x={40} y={74} width={36} height={5} rx={2.5} fill="#EEF2F6" />
      </Svg>
    );
  }

  // Default: 'vault' — minimalist architectural scanner frame + layered sheet + cobalt scan line
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128">
      <Defs>
        <LinearGradient id="emptySweep" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#2563EB" stopOpacity={0.14} />
          <Stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {/* Subtle ambient sheet back layer */}
      <Rect
        x={41}
        y={22}
        width={52}
        height={68}
        rx={11}
        fill="#F1F5F9"
        stroke="#E2E8F0"
        strokeWidth={1.2}
      />

      {/* Minimalist corner brackets */}
      <Path
        d="M 22 40 L 22 28 Q 22 22 28 22 L 40 22"
        fill="none"
        stroke="#94A3B8"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <Path
        d="M 88 22 L 100 22 Q 106 22 106 28 L 106 40"
        fill="none"
        stroke="#94A3B8"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <Path
        d="M 22 88 L 22 100 Q 22 106 28 106 L 40 106"
        fill="none"
        stroke="#94A3B8"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <Path
        d="M 88 106 L 100 106 Q 106 106 106 100 L 106 88"
        fill="none"
        stroke="#94A3B8"
        strokeWidth={2.4}
        strokeLinecap="round"
      />

      {/* Primary white document silhouette */}
      <Path
        d="M 42 30 L 72 30 L 88 46 L 88 92 Q 88 98 82 98 L 42 98 Q 36 98 36 92 L 36 36 Q 36 30 42 30 Z"
        fill="#FFFFFF"
        stroke="#CBD5E1"
        strokeWidth={1.5}
      />
      <Path d="M 72 30 L 88 46 L 76 46 Q 72 46 72 42 Z" fill="#E2E8F0" />

      {/* Minimal doc lines */}
      <Rect x={46} y={47} width={18} height={4} rx={2} fill="#CBD5E1" />
      <Rect x={46} y={56} width={30} height={4} rx={2} fill="#E2E8F0" />

      {/* Cobalt scan wash & crisp beam */}
      <Rect x={37} y={68} width={50} height={24} fill="url(#emptySweep)" />
      <Rect x={28} y={66} width={72} height={4.5} rx={2.25} fill="#2563EB" />
    </Svg>
  );
}
