import React from 'react';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

interface ScanlyLogoProps {
  size?: number;
}

export function ScanlyLogo({ size = 30 }: ScanlyLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <LinearGradient id="scanlyBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#172542" />
          <Stop offset="60%" stopColor="#0F172A" />
          <Stop offset="100%" stopColor="#090E1A" />
        </LinearGradient>
        <LinearGradient id="scanlyBeam" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#2563EB" />
          <Stop offset="50%" stopColor="#3B82F6" />
          <Stop offset="100%" stopColor="#2563EB" />
        </LinearGradient>
      </Defs>

      <Rect width={1024} height={1024} rx={240} fill="url(#scanlyBg)" />

      {/* Viewfinder corner brackets */}
      <Path
        d="M 212 344 L 212 256 Q 212 212 256 212 L 344 212"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.94}
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 680 212 L 768 212 Q 812 212 812 256 L 812 344"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.94}
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 212 680 L 212 768 Q 212 812 256 812 L 344 812"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.94}
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 680 812 L 768 812 Q 812 812 812 768 L 812 680"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.94}
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Document silhouette */}
      <Path
        d="M 378 286 L 578 286 L 680 388 L 680 704 Q 680 738 646 738 L 378 738 Q 344 738 344 704 L 344 320 Q 344 286 378 286 Z"
        fill="#FFFFFF"
      />
      <Path
        d="M 578 286 L 680 388 L 606 388 Q 578 388 578 360 Z"
        fill="#CBD5E1"
      />

      {/* Cobalt scan beam */}
      <Rect x={248} y={512} width={528} height={54} rx={27} fill="url(#scanlyBeam)" />
    </Svg>
  );
}
