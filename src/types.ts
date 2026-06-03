export interface MotionPoint {
  x: number;
  y: number;
  intensity: number;
}

export interface SubtitleChunk {
  text: string;
  subText: string;
  start: number;
  end: number;
}

export interface VideoDimensions {
  width: number;
  height: number;
}

export interface ProcessorState {
  isProcessing: boolean;
  progress: number;
  motionTrail: MotionPoint[];
  focusPoint: { x: number; y: number } | null;
  focusPointColor: 'white' | 'black';
  isZoomed: boolean;
  isFlashDetected: boolean;
}

export interface SubtitleSettings {
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  yPosition: number; // Vertical position of the subtitle in percentage (0 to 100)
  letterSpacing?: number; // Main subtitle letter-spacing in px
  subLetterSpacing?: number; // Sub subtitle letter-spacing in px
  subFontFamily?: string; // Sub subtitle font family
  subFontSize?: number; // Sub subtitle font size in px
}
