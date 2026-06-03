import { SubtitleChunk, VideoDimensions } from '../types';

/**
 * Splits a long text into chunks that fit on screen and time.
 * Logic:
 * - Calculate total reading time vs video length.
 * - Aspect ratio check: wider screens can fit more text per line.
 * - Generate sub-text (simplified translation/pairing for demo).
 */
export function distributeSubtitles(
  korText: string,
  engText: string,
  duration: number,
  dimensions: VideoDimensions
): SubtitleChunk[] {
  if (!korText || duration <= 0) return [];

  // Split by newlines or sentences to keep semantic meanings together
  const korLines = korText.split(/\n+/).filter(l => l.trim().length > 0);
  const engLines = engText ? engText.split(/\n+/).filter(l => l.trim().length > 0) : [];
  
  const totalChunks = korLines.length;
  const chunks: SubtitleChunk[] = [];

  // Calculate weights for each chunk based on text density
  const weights: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < totalChunks; i++) {
    const mainText = korLines[i];
    const subText = engLines[i] || '';
    // Weight calculation: main characters + 0.5 of subText characters + constant minimum base
    const weight = mainText.length + (subText.length * 0.5) + 3.0;
    weights.push(weight);
    totalWeight += weight;
  }

  // Minimum guaranteed display time per chunk (e.g., 1.2s)
  const minGuaranteed = 1.2;
  const totalMinGuaranteed = totalChunks * minGuaranteed;

  let currentStart = 0;

  for (let i = 0; i < totalChunks; i++) {
    const mainText = korLines[i];
    const subText = engLines[i] || '';
    const weight = weights[i];

    let chunkDuration = minGuaranteed;

    if (totalMinGuaranteed >= duration) {
      // If the video is too short to guarantee 1.2s each, divide equally
      chunkDuration = duration / totalChunks;
    } else {
      // Allocate leftover duration based on weight ratio
      const leftOver = duration - totalMinGuaranteed;
      chunkDuration = minGuaranteed + (leftOver * (weight / totalWeight));
    }

    const start = currentStart;
    const end = currentStart + chunkDuration;

    chunks.push({
      text: mainText,
      subText: subText,
      start: parseFloat(start.toFixed(1)),
      end: parseFloat(end.toFixed(1)),
    });

    currentStart = end;
  }

  // Ensure the very last chunk ends exactly at duration to avoid missing/overrun time
  if (chunks.length > 0) {
    chunks[chunks.length - 1].end = parseFloat(duration.toFixed(1));
  }

  return chunks;
}

/**
 * Automatically redistributes active subtitle chunks times to 100% align with video duration, 
 * factoring in density-weight of text so longer subtitles get proportionally more screen time.
 */
export function redistributeSubtitleChunks(
  chunks: SubtitleChunk[],
  duration: number
): SubtitleChunk[] {
  if (!chunks || chunks.length === 0 || duration <= 0) return chunks;

  const totalChunks = chunks.length;
  const weights: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i];
    // Strip markdown formatting tags to measure raw characters accurately
    const rawText = chunk.text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    const rawSub = chunk.subText ? chunk.subText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') : '';
    const weight = rawText.length + (rawSub.length * 0.5) + 3.0;
    weights.push(weight);
    totalWeight += weight;
  }

  const minGuaranteed = 1.2;
  const totalMinGuaranteed = totalChunks * minGuaranteed;

  const updatedChunks = [...chunks];
  let currentStart = 0;

  for (let i = 0; i < totalChunks; i++) {
    const weight = weights[i];
    let chunkDuration = minGuaranteed;

    if (totalMinGuaranteed >= duration) {
      chunkDuration = duration / totalChunks;
    } else {
      const leftOver = duration - totalMinGuaranteed;
      chunkDuration = minGuaranteed + (leftOver * (weight / totalWeight));
    }

    const start = currentStart;
    const end = currentStart + chunkDuration;

    updatedChunks[i] = {
      ...updatedChunks[i],
      start: parseFloat(start.toFixed(1)),
      end: parseFloat(end.toFixed(1))
    };

    currentStart = end;
  }

  // Align exact end boundary
  if (updatedChunks.length > 0) {
    updatedChunks[updatedChunks.length - 1].end = parseFloat(duration.toFixed(1));
  }

  return updatedChunks;
}

