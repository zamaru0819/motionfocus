import { useState, useCallback, useRef, useEffect } from 'react';
import { MotionPoint, ProcessorState, VideoDimensions } from '../types';

export function useVideoProcessor() {
  const stateRef = useRef<ProcessorState>({
    isProcessing: false,
    progress: 0,
    motionTrail: [],
    focusPoint: null,
    focusPointColor: 'white',
    isZoomed: false,
    isFlashDetected: false,
  });

  const lastFrameRef = useRef<Uint8ClampedArray | null>(null);
  const focusHistoryRef = useRef<{ x: number; y: number; time: number }[]>([]);
  const canvasAnalysisRef = useRef<HTMLCanvasElement | null>(null);

  const processFrame = useCallback((videoElement: HTMLVideoElement) => {
    if (!canvasAnalysisRef.current) {
      canvasAnalysisRef.current = document.createElement('canvas');
    }
    const canvas = canvasAnalysisRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const analysisWidth = 160;
    const analysisHeight = 90;
    if (canvas.width !== analysisWidth) {
      canvas.width = analysisWidth;
      canvas.height = analysisHeight;
    }

    ctx.drawImage(videoElement, 0, 0, analysisWidth, analysisHeight);
    const frameData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
    const pixels = frameData.data;

    let motionCount = 0;
    let sumX = 0;
    let sumY = 0;
    let totalBrightness = 0;

    // Optimized: Process every 8th pixel (2nd in each row/col roughly)
    for (let i = 0; i < pixels.length; i += 8) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const brightness = (r + g + b) / 3;
      totalBrightness += brightness;

      if (lastFrameRef.current) {
        const lastPixels = lastFrameRef.current;
        const diff = Math.abs(r - lastPixels[i]) +
                     Math.abs(g - lastPixels[i + 1]) +
                     Math.abs(b - lastPixels[i + 2]);
        
        if (diff > 50) {
          const pixelIndex = i / 4;
          const x = pixelIndex % analysisWidth;
          const y = Math.floor(pixelIndex / analysisWidth);
          sumX += x;
          sumY += y;
          motionCount++;
        }
      }
    }

    const avgBrightness = totalBrightness / (pixels.length / 8);
    const isFlashDetected = avgBrightness > 220;

    lastFrameRef.current = new Uint8ClampedArray(pixels);

    if (motionCount > 5 && !isFlashDetected) {
      const avgX = (sumX / motionCount) / analysisWidth;
      const avgY = (sumY / motionCount) / analysisHeight;
      
      const newPoint = { x: avgX, y: avgY, time: Date.now() };
      focusHistoryRef.current.push(newPoint);
      const now = Date.now();
      focusHistoryRef.current = focusHistoryRef.current.filter(p => now - p.time < 1500);

      const fx = Math.min(analysisWidth-1, Math.max(0, Math.floor(avgX * analysisWidth)));
      const fy = Math.min(analysisHeight-1, Math.max(0, Math.floor(avgY * analysisHeight)));
      const idx = (fy * analysisWidth + fx) * 4;
      const pointBrightness = (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3;
      const contrastColor = pointBrightness > 128 ? 'black' : 'white';

      if (focusHistoryRef.current.length > 20) {
        stateRef.current = {
          ...stateRef.current,
          focusPoint: { x: avgX, y: avgY },
          focusPointColor: contrastColor as 'white' | 'black',
          isZoomed: false, // Force disabled
          isFlashDetected,
          motionTrail: [...stateRef.current.motionTrail.slice(-5), { x: avgX, y: avgY, intensity: motionCount / (analysisWidth * analysisHeight) }]
        };
      } else {
        stateRef.current = {
          ...stateRef.current,
          focusPoint: { x: avgX, y: avgY },
          focusPointColor: contrastColor as 'white' | 'black',
          isZoomed: false,
          isFlashDetected,
          motionTrail: [...stateRef.current.motionTrail.slice(-5), { x: avgX, y: avgY, intensity: motionCount / (analysisWidth * analysisHeight) }]
        };
      }
    } else {
      stateRef.current = { 
        ...stateRef.current, 
        isZoomed: false, 
        isFlashDetected,
        focusPoint: isFlashDetected ? null : stateRef.current.focusPoint 
      };
    }
  }, []);

  return {
    stateRef,
    processFrame
  };
}
