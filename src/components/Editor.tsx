import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, Play, Pause, Upload, Type, Eye, Focus, MousePointer2, Settings, Plus, Trash2, Sliders, Sparkles, Palette, Bold, Italic, Clock, Copy, Check, FileText } from 'lucide-react';
import { useVideoProcessor } from '../hooks/useVideoProcessor';
import { SubtitleChunk, VideoDimensions, SubtitleSettings } from '../types';
import { distributeSubtitles, redistributeSubtitleChunks } from '../lib/subtitleUtils';

export interface TextSegment {
  text: string;
  color: string | null;
  bold: boolean;
  italic: boolean;
  animation: 'wave' | 'bounce' | 'shake' | 'glitch' | null;
}

export function parseStyledText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    
    // Add text before the match
    if (matchIndex > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, matchIndex),
        color: null,
        bold: false,
        italic: false,
        animation: null
      });
    }

    const content = match[1];
    const stylesStr = match[2];
    
    let color: string | null = null;
    let bold = false;
    let italic = false;
    let animation: 'wave' | 'bounce' | 'shake' | 'glitch' | null = null;

    const parts = stylesStr.split(',').map(s => s.trim());
    for (const part of parts) {
      const partLower = part.toLowerCase();
      if (partLower === 'bold' || partLower === 'b') {
        bold = true;
      } else if (partLower === 'italic' || partLower === 'i') {
        italic = true;
      } else if (partLower === 'wave') {
        animation = 'wave';
      } else if (partLower === 'bounce') {
        animation = 'bounce';
      } else if (partLower === 'shake') {
        animation = 'shake';
      } else if (partLower === 'glitch') {
        animation = 'glitch';
      } else if (part.startsWith('color:') || part.startsWith('#')) {
        if (part.startsWith('#')) {
          color = part;
        } else {
          color = part.substring(6).trim();
        }
      }
    }

    segments.push({
      text: content,
      color,
      bold,
      italic,
      animation
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      color: null,
      bold: false,
      italic: false,
      animation: null
    });
  }

  return segments;
}

export function measureStyledSegmentsWidth(
  ctx: CanvasRenderingContext2D,
  segments: TextSegment[],
  fontFamily: string,
  baseSize: number,
  isDefaultBold: boolean,
  spacing: number = 0
): number {
  let totalWidth = 0;
  for (const seg of segments) {
    const fontStyle = seg.italic ? 'italic' : '';
    const fontWeight = (seg.bold || isDefaultBold) ? 'bold' : '';
    ctx.font = `${fontStyle} ${fontWeight} ${baseSize}px '${fontFamily}', sans-serif`;
    
    for (let i = 0; i < seg.text.length; i++) {
      totalWidth += ctx.measureText(seg.text[i]).width;
      if (i < seg.text.length - 1) {
        totalWidth += spacing;
      }
    }
    if (segments.length > 1 && seg !== segments[segments.length - 1]) {
      totalWidth += spacing;
    }
  }
  return totalWidth;
}

export interface StyleProps {
  bold: boolean;
  italic: boolean;
  color: string | null;
  animation: 'wave' | 'bounce' | 'shake' | 'glitch' | null;
}

export function parseStyleString(stylesStr: string): StyleProps {
  const props: StyleProps = { bold: false, italic: false, color: null, animation: null };
  const parts = stylesStr.split(',').map(s => s.trim());
  for (const part of parts) {
    const partLower = part.toLowerCase();
    if (partLower === 'bold' || partLower === 'b') {
      props.bold = true;
    } else if (partLower === 'italic' || partLower === 'i') {
      props.italic = true;
    } else if (partLower === 'wave') {
      props.animation = 'wave';
    } else if (partLower === 'bounce') {
      props.animation = 'bounce';
    } else if (partLower === 'shake') {
      props.animation = 'shake';
    } else if (partLower === 'glitch') {
      props.animation = 'glitch';
    } else if (part.startsWith('#')) {
      props.color = part;
    } else if (part.startsWith('color:')) {
      props.color = part.substring(6).trim();
    }
  }
  return props;
}

export function serializeStyleProps(props: StyleProps): string {
  const parts: string[] = [];
  if (props.color) parts.push(props.color);
  if (props.bold) parts.push('bold');
  if (props.italic) parts.push('italic');
  if (props.animation) parts.push(props.animation);
  return parts.join(',');
}

export function stripStyles(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

export function getSurroundingStyledBlock(text: string, start: number, end: number) {
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchEnd = regex.lastIndex;
    // Overlaps selection range or cursor sits inside
    if (start >= matchStart && end <= matchEnd) {
      return {
        start: matchStart,
        end: matchEnd,
        matchText: match[0],
        innerText: match[1],
        styleText: match[2]
      };
    }
  }
  return null;
}

export default function Editor() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [savedVideoName, setSavedVideoName] = useState<string>(() => localStorage.getItem('motion_focus_video_name') || '');
  const [subtitleText, setSubtitleText] = useState(() => localStorage.getItem('motion_focus_text') || '');
  const [chunks, setChunks] = useState<SubtitleChunk[]>(() => {
    const saved = localStorage.getItem('motion_focus_chunks');
    return saved ? JSON.parse(saved) : [];
  });
  const [settings, setSettings] = useState<SubtitleSettings>(() => {
    const saved = localStorage.getItem('motion_focus_settings');
    const defaultSettings = {
      fontSize: 24,
      fontFamily: 'Inter',
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.5,
      yPosition: 85,
      letterSpacing: 0,
      subLetterSpacing: 0,
      subFontFamily: 'JetBrains Mono',
      subFontSize: 16,
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultSettings, ...parsed };
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });
  const [customFontName, setCustomFontName] = useState<string>(() => localStorage.getItem('motion_focus_font') || '');
  const [isRecording, setIsRecording] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isSavingProcessing, setIsSavingProcessing] = useState(false);
  const [savingStatus, setSavingStatus] = useState('');
  const [copiedClean, setCopiedClean] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [isBatchSubOpen, setIsBatchSubOpen] = useState(false);
  const [batchSubText, setBatchSubText] = useState('');

  const openBatchSubModal = () => {
    // Populate with each chunk's subText separated by newline
    const text = chunks.map(c => c.subText).join('\n');
    setBatchSubText(text);
    setIsBatchSubOpen(true);
  };

  const handleApplyBatchSubtitles = () => {
    const lines = batchSubText.split('\n');
    setChunks(prev => {
      return prev.map((chunk, idx) => {
        if (idx < lines.length) {
          return { ...chunk, subText: lines[idx].trim() };
        }
        return chunk;
      });
    });
    alert(`Successfully applied batch subtitles to ${Math.min(chunks.length, lines.length)} slots based on sequential order.`);
    setIsBatchSubOpen(false);
  };

  const copyMergedSubtitles = async (clean: boolean, delimiter: '\n' | ' ') => {
    const textToCopy = chunks
      .map(c => {
        const txt = c.subText.trim();
        return clean ? txt.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') : txt;
      })
      .filter(t => t.length > 0)
      .join(delimiter);

    if (!textToCopy) {
      alert('There are no sub-text entries to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      if (clean) {
        setCopiedClean(true);
        setTimeout(() => setCopiedClean(false), 2000);
      } else {
        setCopiedRaw(true);
        setTimeout(() => setCopiedRaw(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
      try {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = textToCopy;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        document.execCommand('copy');
        document.body.removeChild(tempTextArea);
        if (clean) {
          setCopiedClean(true);
          setTimeout(() => setCopiedClean(false), 2000);
        } else {
          setCopiedRaw(true);
          setTimeout(() => setCopiedRaw(false), 2000);
        }
      } catch (fallbackErr) {
        alert('Copy failed. Please copy the text manually.');
      }
    }
  };

  const saveVideoFile = async (blob: Blob) => {
    const isMp4 = blob.type.includes('mp4');
    const extension = isMp4 ? 'mp4' : 'webm';
    const filename = `motion-focus-${Date.now()}.${extension}`;

    // Use dynamic import to check native Capacitor platforms safely
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        setSavingStatus('스마트폰 갤러리에 저장하는 중...');
        setIsSavingProcessing(true);
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Media } = await import('@capacitor-community/media');

        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64Data = reader.result as string;
            const rawBase64 = base64Data.split(',')[1];

            // 1. Write the file to local cache first
            const savedFile = await Filesystem.writeFile({
              path: filename,
              data: rawBase64,
              directory: Directory.Cache,
            });

            // 2. Direct permission check before saving
            const mediaAny = Media as any;
            const status = await mediaAny.checkPermissions();
            const isGranted = status.publicStorage === 'granted' || status.publicStorage13Plus === 'granted';
            
            if (!isGranted) {
              const reqStatus = await mediaAny.requestPermissions();
              const isReqGranted = reqStatus.publicStorage === 'granted' || reqStatus.publicStorage13Plus === 'granted';
              if (!isReqGranted) {
                throw new Error('갤러리 보관함 쓰기 권한이 거부되었습니다.');
              }
            }

            // Get or create album identifier for Android / iOS
            let albumIdentifier: string | undefined;
            try {
              const { albums } = await mediaAny.getAlbums();
              let existingAlbum = albums.find((a: any) => a.name === 'MotionFocus');
              if (!existingAlbum) {
                await mediaAny.createAlbum({ name: 'MotionFocus' });
                const { albums: updatedAlbums } = await mediaAny.getAlbums();
                existingAlbum = updatedAlbums.find((a: any) => a.name === 'MotionFocus');
              }
              albumIdentifier = existingAlbum?.identifier;
            } catch (err) {
              console.warn('Could not retrieve or create specific album MotionFocus, saving directly to gallery/camera roll.', err);
            }

            // 3. Save to native device gallery/album
            await mediaAny.saveVideo({
              path: savedFile.uri,
              albumIdentifier: albumIdentifier,
              fileName: `motion-focus-${Date.now()}`
            });

            alert('성공: 비디오가 스마트폰 갤러리 MotionFocus 앨범에 안전하게 저장되었습니다!');
          } catch (e: any) {
            console.error('Error saving file natively:', e);
            alert(`갤러리 저장 실패: ${e?.message || e}`);
          } finally {
            setSavingStatus('');
            setIsSavingProcessing(false);
          }
        };
        reader.readAsDataURL(blob);
        return;
      }
    } catch (e) {
      console.log('Not in Capacitor environment, falling back to browser download.');
    }

    // Standard web browser fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const [currentTime, setCurrentTime] = useState(0);
  const [dimensions, setDimensions] = useState<VideoDimensions>({ width: 0, height: 0 });
  const [activeChunkIdx, setActiveChunkIdx] = useState<number | null>(null);
  const [activeField, setActiveField] = useState<'text' | 'subText' | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { stateRef, processFrame } = useVideoProcessor();
  const [uiProcessorState, setUiProcessorState] = useState(stateRef.current);
  
  // Native Platform: Request gallery permission when the app starts
  useEffect(() => {
    const initAppPermissions = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
          const { Media } = await import('@capacitor-community/media');
          const mediaAny = Media as any;
          const status = await mediaAny.checkPermissions();
          if (status.publicStorage !== 'granted' && status.publicStorage13Plus !== 'granted') {
            await mediaAny.requestPermissions();
          }
        }
      } catch (err) {
        console.warn('Failed to check/request gallery permission on startup:', err);
      }
    };
    initAppPermissions();
  }, []);

  // Persistence: Auto-save to localStorage
  useEffect(() => {
    localStorage.setItem('motion_focus_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('motion_focus_chunks', JSON.stringify(chunks));
  }, [chunks]);

  useEffect(() => {
    localStorage.setItem('motion_focus_text', subtitleText);
  }, [subtitleText]);

  // Use Refs for render loop access to avoid dependencies restarts
  const chunksRefShared = useRef(chunks);
  const settingsRefShared = useRef(settings);

  useEffect(() => {
    chunksRefShared.current = chunks;
  }, [chunks]);

  useEffect(() => {
    settingsRefShared.current = settings;
  }, [settings]);

  // Interpolated values for smooth spring-like movement
  const smoothZoom = useRef(1);
  const smoothX = useRef(0.5);
  const smoothY = useRef(0.5);
  const smoothFocusX = useRef(0.5);
  const smoothFocusY = useRef(0.5);
  // Spring physics values
  const zoomVel = useRef(0);
  const xVel = useRef(0);
  const yVel = useRef(0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setSavedVideoName(file.name);
      localStorage.setItem('motion_focus_video_name', file.name);
      setIsRecording(false);
      // Reset smooth values on new file
      smoothZoom.current = 1;
      smoothX.current = 0.5;
      smoothY.current = 0.5;
    }
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith('.ttf')) {
      const fontName = `CustomFont_${Math.random().toString(36).substr(2, 9)}`;
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          const fontFace = new FontFace(fontName, arrayBuffer);
          const loadedFont = await fontFace.load();
          document.fonts.add(loadedFont);
          setCustomFontName(fontName);
          localStorage.setItem('motion_focus_font', fontName);
          
          // Save font data as base64 if possible
          const uint8 = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          const base64 = btoa(binary);
          try {
            localStorage.setItem('motion_focus_font_data', base64);
          } catch (e) {
            console.warn('Font too large for localStorage, will need re-upload on refresh');
          }

          setSettings(prev => ({ ...prev, fontFamily: fontName }));
        } catch (error) {
          console.error('Failed to load font:', error);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleVideoLoad = async () => {
    if (videoRef.current) {
      let { videoWidth, videoHeight } = videoRef.current;
      
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
          // Cap canvas width/height to maximum 1280px to prevent Android WebView Renderer crash
          const maxDimension = 1280;
          if (videoWidth > maxDimension || videoHeight > maxDimension) {
            const scale = Math.min(maxDimension / videoWidth, maxDimension / videoHeight);
            videoWidth = Math.round(videoWidth * scale);
            videoHeight = Math.round(videoHeight * scale);
            console.log(`[Native Platform] Capping rendering canvas to ${videoWidth}x${videoHeight} to guarantee stability`);
          }
        }
      } catch (err) {
        console.warn('Capacitor check inside handleVideoLoad failed:', err);
      }
      
      setDimensions({ width: videoWidth, height: videoHeight });
    }
  };

  const handleSplitSubtitles = () => {
    if (videoRef.current) {
      const newChunks = distributeSubtitles(subtitleText, '', videoRef.current.duration, dimensions);
      setChunks(newChunks);
    }
  };

  const handleAutoRedistribute = () => {
    if (videoRef.current && chunks.length > 0) {
      const updated = redistributeSubtitleChunks(chunks, videoRef.current.duration);
      setChunks(updated);
    }
  };

  const updateChunk = (index: number, field: keyof SubtitleChunk, value: string | number) => {
    setChunks(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const removeChunk = (index: number) => {
    setChunks(prev => prev.filter((_, i) => i !== index));
  };

  const applyFormat = (chunkIdx: number, field: 'text' | 'subText', format: string) => {
    const inputEl = document.getElementById(`chunk-${field}-${chunkIdx}`) as HTMLInputElement;
    if (!inputEl) return;

    let start = inputEl.selectionStart ?? 0;
    let end = inputEl.selectionEnd ?? 0;
    const originalText = field === 'text' ? chunks[chunkIdx].text : chunks[chunkIdx].subText;
    
    // Check if the current selection is within or is an entire styled block
    const surroundingBlock = getSurroundingStyledBlock(originalText, start, end);
    
    let targetText = '';
    let formatted = '';
    
    if (surroundingBlock) {
      // Expand selection to include the entire styled block
      start = surroundingBlock.start;
      end = surroundingBlock.end;
      
      const innerText = surroundingBlock.innerText;
      const currentProps = parseStyleString(surroundingBlock.styleText);
      
      // Modify existing style properties
      if (format === 'bold') {
        currentProps.bold = !currentProps.bold;
      } else if (format === 'italic') {
        currentProps.italic = !currentProps.italic;
      } else if (['wave', 'bounce', 'shake', 'glitch'].includes(format)) {
        // Toggle animation
        if (currentProps.animation === format) {
          currentProps.animation = null;
        } else {
          currentProps.animation = format as any;
        }
      } else {
        // Must be a color preset: 'red', 'yellow', 'blue', 'green'
        let targetColor = '';
        if (format === 'red') targetColor = '#ef4444';
        else if (format === 'yellow') targetColor = '#eab308';
        else if (format === 'blue') targetColor = '#3b82f6';
        else if (format === 'green') targetColor = '#22c55e';
        
        if (currentProps.color === targetColor) {
          // Toggle off color
          currentProps.color = null;
        } else {
          // Set color and ensure bold as it looks better with highlight
          currentProps.color = targetColor;
          currentProps.bold = true;
        }
      }
      
      const serialized = serializeStyleProps(currentProps);
      if (serialized) {
        formatted = `[${innerText}](${serialized})`;
      } else {
        formatted = innerText; // Style was completely toggled off, make it plain text!
      }
      targetText = innerText;
    } else {
      // No surrounding styled block: apply new style
      let selectedText = originalText.substring(start, end);
      if (!selectedText) {
        selectedText = 'text'; // Fallback if no selection
      }
      
      // To prevent nesting, strip any markdown style tags from the selection
      const cleanText = stripStyles(selectedText);
      
      // Determine new formatting
      if (format === 'bold') {
        formatted = `[${cleanText}](bold)`;
      } else if (format === 'italic') {
        formatted = `[${cleanText}](italic)`;
      } else if (['wave', 'bounce', 'shake', 'glitch'].includes(format)) {
        formatted = `[${cleanText}](${format})`;
      } else {
        // Color preset
        let targetColor = '';
        if (format === 'red') targetColor = '#ef4444';
        else if (format === 'yellow') targetColor = '#eab308';
        else if (format === 'blue') targetColor = '#3b82f6';
        else if (format === 'green') targetColor = '#22c55e';
        
        formatted = `[${cleanText}](${targetColor},bold)`;
      }
      targetText = cleanText;
    }

    const newText = originalText.substring(0, start) + formatted + originalText.substring(end);
    updateChunk(chunkIdx, field, newText);

    // Refocus and place selection nicely in the input
    setTimeout(() => {
      inputEl.focus();
      const offset = formatted.indexOf(targetText);
      if (offset !== -1) {
        inputEl.setSelectionRange(start + offset, start + offset + targetText.length);
      }
    }, 15);
  };

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
      setIsRecording(false);
      videoRef.current?.pause();
    }
  }, []);

  const startRecording = async () => {
    if (!canvasRef.current || !videoRef.current) return;
    
    let isNative = false;
    try {
      const { Capacitor } = await import('@capacitor/core');
      isNative = Capacitor.isNativePlatform();
    } catch (_) {}

    // On mobile native, cap tracking / export capture stream to 30 FPS.
    // High-framerate rendering via captureStream demands extremely high CPU & GPU cycles in WebView, causing OOM crashes.
    const frameRate = isNative ? 30 : 60;
    const stream = canvasRef.current.captureStream(frameRate);
    
    // Choose the best codec dynamically to ensure the highest resolution and encoding quality
    const mimeTypes = [
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=h264',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    
    let selectedMimeType = '';
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        selectedMimeType = type;
        break;
      }
    }

    // Heavy bitrates (like 14Mbps) can prompt hardware encoder throttling & process terminations under Android System Out-Of-Memory rules.
    // 4Mbps is excellent and provides outstanding, sharp visual export quality for mobile screens.
    const bitrate = isNative ? 4000000 : 14000000;
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: bitrate,
      bitsPerSecond: bitrate
    };

    if (selectedMimeType) {
      options.mimeType = selectedMimeType;
    }

    const recorder = new MediaRecorder(stream, options);
    
    chunksRef.current = [];
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    recorder.onstop = async () => {
      const mime = selectedMimeType || 'video/webm';
      const recordedBlob = new Blob(chunksRef.current, { type: mime });
      
      // Save natively or download via browser - FFmpeg completely removed
      await saveVideoFile(recordedBlob);
    };
    
    recorder.start();
    recorderRef.current = recorder;
    setIsRecording(true);
    videoRef.current.currentTime = 0;
    videoRef.current.play();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const handleEnded = () => {
        if (isRecording) {
          stopRecording();
        }
      };
      video.addEventListener('ended', handleEnded);
      return () => video.removeEventListener('ended', handleEnded);
    }
  }, [isRecording, stopRecording]);

  // Reload saved font on mount
  useEffect(() => {
    const savedFontName = localStorage.getItem('motion_focus_font');
    const savedFontData = localStorage.getItem('motion_focus_font_data');
    if (savedFontName && savedFontData) {
      try {
        const binary = atob(savedFontData);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          array[i] = binary.charCodeAt(i);
        }
        const fontFace = new FontFace(savedFontName, array.buffer);
        fontFace.load().then(loadedFont => {
          document.fonts.add(loadedFont);
        }).catch(err => console.error('Failed to reload font from storage:', err));
      } catch (err) {
        console.error('Error decoding saved font data:', err);
      }
    }
  }, []);

  // Main Render Loop
  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext('2d', { 
      alpha: false, 
      colorSpace: 'srgb' // Prevent color shifts on P3 displays
    });
    
    let lastUiUpdate = 0;

    const render = (now_timestamp: number) => {
      if (!canvas || !video || !ctx) {
        animationId = requestAnimationFrame(render);
        return;
      }

      if (!video.paused && !video.ended) {
        processFrame(video);
        
        // Lower frequency UI update
        if (now_timestamp - lastUiUpdate > 200) {
           setCurrentTime(video.currentTime);
           setUiProcessorState({ ...stateRef.current }); // Sync UI state
           lastUiUpdate = now_timestamp;
        }
      }

      const state = stateRef.current;
      const chunks = chunksRefShared.current;
      const settings = settingsRefShared.current;

      // Smooth Brush Interpolation
      if (state.focusPoint) {
        const followSpeed = 0.35;
        smoothFocusX.current += (state.focusPoint.x - smoothFocusX.current) * followSpeed;
        smoothFocusY.current += (state.focusPoint.y - smoothFocusY.current) * followSpeed;
      }

      // 2. Clear Canvas
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 3. Constant Zoom (Zoom removed per user request)
      const targetZoom = 1;
      const targetX = 0.5;
      const targetY = 0.5;

      const frictionZoom = 0.85;
      const frictionPan = 0.98;
      const tensionZoom = 0.05;
      const tensionPan = 0.01; 

      zoomVel.current = zoomVel.current * frictionZoom + (targetZoom - smoothZoom.current) * tensionZoom;
      smoothZoom.current += zoomVel.current;

      xVel.current = xVel.current * frictionPan + (targetX - smoothX.current) * tensionPan;
      smoothX.current += xVel.current;

      yVel.current = yVel.current * frictionPan + (targetY - smoothY.current) * tensionPan;
      smoothY.current += yVel.current;

      // 4. Draw Main Video
      const zoom = smoothZoom.current;
      const drawWidth = canvas.width * zoom;
      const drawHeight = canvas.height * zoom;
      
      const offsetX = (canvas.width / 2) - (smoothX.current * drawWidth);
      const offsetY = (canvas.height / 2) - (smoothY.current * drawHeight);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

      // 6. Draw Brush Afterimage / Motion Trail (Clean Line)
      if (state.motionTrail.length > 1 && !state.isFlashDetected) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        state.motionTrail.forEach((point, i) => {
          const pX = offsetX + point.x * drawWidth;
          const pY = offsetY + point.y * drawHeight;
          if (i === 0) ctx.moveTo(pX, pY);
          else ctx.lineTo(pX, pY);
        });
        ctx.strokeStyle = state.focusPointColor === 'white' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }

      // 6. Draw Primary Brush Cursor (Smooth movement)
      if (state.focusPoint && !state.isFlashDetected) {
         const cursorX = offsetX + smoothFocusX.current * drawWidth;
         const cursorY = offsetY + smoothFocusY.current * drawHeight;
         
         ctx.save();
         ctx.strokeStyle = state.focusPointColor === 'white' ? '#fff' : '#000';
         ctx.lineWidth = 2;
         
         const pulse = Math.sin(Date.now() / 150) * 1.5;
         ctx.beginPath();
         ctx.arc(cursorX, cursorY, 11 + pulse, 0, Math.PI * 2);
         ctx.stroke();
         
         // Inner point for precision
         ctx.fillStyle = ctx.strokeStyle;
         ctx.beginPath();
         ctx.arc(cursorX, cursorY, 2, 0, Math.PI * 2);
         ctx.fill();
         ctx.restore();
      }

      // 7. Draw Subtitles
      const currentChunk = chunks.find(c => video.currentTime >= c.start && video.currentTime <= c.end);
      if (currentChunk) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        const baseSize = settings.fontSize;
        const subSize = settings.subFontSize ?? Math.floor(baseSize * 0.7);
        const padding = 16;
        const lineSpacing = 8;
        const bottomOffset = 40;

        const drawStyledLine = (
          inputText: string,
          yPos: number,
          fontName: string,
          baseFontSize: number,
          defaultColor: string,
          isDefaultBold: boolean,
          spacing: number = 0
        ) => {
          const segments = parseStyledText(inputText);
          const totalWidth = measureStyledSegmentsWidth(ctx, segments, fontName, baseFontSize, isDefaultBold, spacing);
          let currentX = (canvas.width / 2) - (totalWidth / 2);

          ctx.save();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';

          for (const seg of segments) {
            const fontStyle = seg.italic ? 'italic' : '';
            const fontWeight = (seg.bold || isDefaultBold) ? 'bold' : '';
            ctx.font = `${fontStyle} ${fontWeight} ${baseFontSize}px '${fontName}', sans-serif`;
            ctx.fillStyle = seg.color || defaultColor;

            for (let i = 0; i < seg.text.length; i++) {
              const char = seg.text[i];
              const charWidth = ctx.measureText(char).width;
              let dx = 0;
              let dy = 0;

              const time = performance.now();
              if (seg.animation === 'wave') {
                dy = Math.sin((time / 150) + i * 0.4) * (baseFontSize * 0.18);
              } else if (seg.animation === 'bounce') {
                const bounceVal = Math.sin((time / 200));
                dy = bounceVal < 0 ? bounceVal * (baseFontSize * 0.25) : 0;
              } else if (seg.animation === 'shake') {
                dx = (Math.sin(time * 0.08 + i) * 1.5) + (Math.random() * 0.8 - 0.4);
                dy = (Math.cos(time * 0.08 + i) * 1.5) + (Math.random() * 0.8 - 0.4);
              } else if (seg.animation === 'glitch') {
                const isGlitchFrame = Math.random() < 0.25;
                if (isGlitchFrame) {
                  const shiftX = Math.random() * 4 - 2;
                  const shiftY = Math.random() * 2 - 1;
                  ctx.save();
                  ctx.fillStyle = 'rgba(0, 255, 255, 0.85)';
                  ctx.fillText(char, currentX + shiftX, yPos + shiftY);
                  ctx.fillStyle = 'rgba(255, 0, 255, 0.85)';
                  ctx.fillText(char, currentX - shiftX, yPos - shiftY);
                  ctx.restore();
                }
              }

              ctx.fillText(char, currentX + dx, yPos + dy);
              currentX += charWidth;
              if (i < seg.text.length - 1) {
                currentX += spacing;
              }
            }
            if (segments.length > 1 && seg !== segments[segments.length - 1]) {
              currentX += spacing;
            }
          }
          ctx.restore();
        };
        
        const segmentsMain = parseStyledText(currentChunk.text);
        const mainMetricsWidth = measureStyledSegmentsWidth(ctx, segmentsMain, settings.fontFamily, baseSize, true, settings.letterSpacing ?? 0);
        
        let subMetricsWidth = 0;
        let segmentsSub: TextSegment[] = [];
        if (currentChunk.subText) {
          segmentsSub = parseStyledText(currentChunk.subText);
          subMetricsWidth = measureStyledSegmentsWidth(ctx, segmentsSub, settings.subFontFamily ?? 'JetBrains Mono', subSize, false, settings.subLetterSpacing ?? 0);
        }
        
        const maxWidth = Math.max(mainMetricsWidth, subMetricsWidth);
        const totalTextHeight = currentChunk.subText ? (baseSize + subSize + lineSpacing) : baseSize;
        
        const yPosPercent = settings.yPosition ?? 85;
        const yBaseline = canvas.height * (yPosPercent / 100);
        
        if (settings.backgroundOpacity > 0) {
          ctx.fillStyle = `rgba(${hexToRgb(settings.backgroundColor)}, ${settings.backgroundOpacity})`;
          const bgWidth = maxWidth + (padding * 2);
          const bgHeight = totalTextHeight + (padding * 2);
          const bgX = (canvas.width / 2) - (bgWidth / 2);
          const bgY = yBaseline - totalTextHeight - padding;
          
          ctx.beginPath();
          ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 10);
          ctx.fill();
        }

        ctx.shadowBlur = 0;
        if (currentChunk.subText) {
          drawStyledLine(currentChunk.subText, yBaseline, settings.subFontFamily ?? 'JetBrains Mono', subSize, 'rgba(255, 255, 255, 0.9)', false, settings.subLetterSpacing ?? 0);
          drawStyledLine(currentChunk.text, yBaseline - subSize - lineSpacing, settings.fontFamily, baseSize, settings.color, true, settings.letterSpacing ?? 0);
        } else {
          drawStyledLine(currentChunk.text, yBaseline, settings.fontFamily, baseSize, settings.color, true, settings.letterSpacing ?? 0);
        }
      }

      if (isRecording && video.duration) {
         setExportProgress((video.currentTime / video.duration) * 100);
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [isRecording]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row gap-6 p-6 max-w-7xl mx-auto items-stretch">
      {/* Control Panel */}
      <div className="w-full md:w-96 flex flex-col gap-4 bg-[#111] p-6 rounded-2xl border border-white/5 order-2 md:order-1 h-fit md:max-h-screen overflow-y-auto custom-scrollbar">
        <label className="group flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-red-500/50 hover:bg-red-500/5 transition-all">
          <Upload className="w-6 h-6 text-white/30 group-hover:text-red-500 mb-1.5" />
          <span className="text-xs text-white/70 font-semibold group-hover:text-white">
            {videoUrl ? '비디오 변경 (Change Video)' : '비디오 파일 선택 (Select Video)'}
          </span>
          <span className="text-[10px] text-white/40 mt-0.5 group-hover:text-white/60">
            {videoUrl ? '기존 영상 대처' : '영상 업로드'}
          </span>
          <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
        </label>

        {/* Auto-Save & Status Tracker */}
        <div className="text-[10px] leading-relaxed text-white/60 bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-white/80 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            <span className="font-sans">실시간 자동 저장 활성화 (Auto-Save Active)</span>
          </div>
          {savedVideoName && (
            <div className="mt-1 pt-1.5 border-t border-white/5 text-[9px] text-white/50 flex flex-col gap-0.5">
              <span className="text-white/30 truncate">최근 작업 비디오:</span>
              <span className="font-mono text-red-400 break-all bg-black/30 px-1.5 py-0.5 rounded border border-white/5">{savedVideoName}</span>
              <span className="text-white/30 mt-0.5 text-[8px] leading-normal">
                * 브라우저 보안 규정(Sandboxing)으로 인해, 페이지 접속 시 위 영상 파일만 다시 한 번 선택해 주시면 작성하셨던 모든 내용이 그대로 복원됩니다.
              </span>
            </div>
          )}
        </div>

        {/* Global Split Controls */}
        <div className="p-4 bg-white/5 rounded-xl flex flex-col gap-3">
          <div className="flex items-center justify-between text-[10px] font-bold text-white/30 uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <Sliders className="w-3 h-3" />
              <span>Subtitle Style</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4">
               <span className="text-[10px] text-white/40 w-12">Size</span>
               <input 
                 type="range" min="12" max="72" 
                 value={settings.fontSize} 
                 onChange={(e) => setSettings({...settings, fontSize: parseInt(e.target.value)})}
                 className="flex-1 accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
               />
               <span className="text-xs font-mono text-white/50 w-8">{settings.fontSize}</span>
            </div>

            <div className="flex items-center gap-4">
               <span className="text-[10px] text-white/40 w-12">Sub Size</span>
               <input 
                 type="range" min="8" max="64" 
                 value={settings.subFontSize ?? Math.floor(settings.fontSize * 0.7)} 
                 onChange={(e) => setSettings({...settings, subFontSize: parseInt(e.target.value)})}
                 className="flex-1 accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
               />
               <span className="text-xs font-mono text-white/50 w-8">{settings.subFontSize ?? Math.floor(settings.fontSize * 0.7)}</span>
            </div>

            <div className="flex items-center gap-4">
               <span className="text-[10px] text-white/40 w-12">Opacity</span>
               <input 
                 type="range" min="0" max="1" step="0.1"
                 value={settings.backgroundOpacity} 
                 onChange={(e) => setSettings({...settings, backgroundOpacity: parseFloat(e.target.value)})}
                 className="flex-1 accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
               />
               <span className="text-xs font-mono text-white/50 w-8">{settings.backgroundOpacity}</span>
            </div>

            <div className="flex items-center gap-4">
               <span className="text-[10px] text-white/40 w-12">Y Pos</span>
               <input 
                 type="range" min="5" max="95" step="1"
                 value={settings.yPosition ?? 85} 
                 onChange={(e) => setSettings({...settings, yPosition: parseInt(e.target.value)})}
                 className="flex-1 accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
               />
               <span className="text-xs font-mono text-white/50 w-8">{settings.yPosition ?? 85}%</span>
            </div>

            <div className="flex items-center gap-4">
               <span className="text-[10px] text-white/40 w-12">BG Color</span>
               <input 
                 type="color" 
                 value={settings.backgroundColor} 
                 onChange={(e) => setSettings({...settings, backgroundColor: e.target.value})}
                 className="h-6 w-12 bg-transparent border-none cursor-pointer"
               />
            </div>

            {/* Font Family Selectors */}
            <div className="flex flex-col gap-1 bg-white/5 p-2.5 rounded-lg border border-white/5">
              <span className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Font Family</span>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-white/50">Main Title</span>
                  <select
                    value={settings.fontFamily}
                    onChange={(e) => setSettings({...settings, fontFamily: e.target.value})}
                    className="w-full bg-[#111] border border-white/10 rounded-md p-1.5 text-[11px] text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="Inter">Inter</option>
                    <option value="Space Grotesk">Space Grotesk</option>
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Playfair Display">Playfair Display</option>
                    <option value="Outfit">Outfit</option>
                    {customFontName && <option value={customFontName}>Loaded File</option>}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-white/50">Sub Title</span>
                  <select
                    value={settings.subFontFamily ?? 'JetBrains Mono'}
                    onChange={(e) => setSettings({...settings, subFontFamily: e.target.value})}
                    className="w-full bg-[#111] border border-white/10 rounded-md p-1.5 text-[11px] text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Inter">Inter</option>
                    <option value="Space Grotesk">Space Grotesk</option>
                    <option value="Playfair Display">Playfair Display</option>
                    <option value="Outfit">Outfit</option>
                    {customFontName && <option value={customFontName}>Loaded File</option>}
                  </select>
                </div>
              </div>
            </div>

            {/* Letter Spacing Multi-Sliders */}
            <div className="flex flex-col gap-2 bg-white/5 p-2.5 rounded-lg border border-white/5">
              <span className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Letter Spacing (자간)</span>
              
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-white/50 w-8">Main</span>
                <input 
                  type="range" min="-10" max="25" step="1"
                  value={settings.letterSpacing ?? 0} 
                  onChange={(e) => setSettings({...settings, letterSpacing: parseInt(e.target.value)})}
                  className="flex-1 accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                />
                <span className="text-[10px] font-mono text-white/50 w-8 text-right">{(settings.letterSpacing ?? 0) >= 0 ? `+${settings.letterSpacing ?? 0}` : settings.letterSpacing}px</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[9px] text-white/50 w-8">Sub</span>
                <input 
                  type="range" min="-10" max="25" step="1"
                  value={settings.subLetterSpacing ?? 0} 
                  onChange={(e) => setSettings({...settings, subLetterSpacing: parseInt(e.target.value)})}
                  className="flex-1 accent-red-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                />
                <span className="text-[10px] font-mono text-white/50 w-8 text-right">{(settings.subLetterSpacing ?? 0) >= 0 ? `+${settings.subLetterSpacing ?? 0}` : settings.subLetterSpacing}px</span>
              </div>
            </div>
            
            <label className="flex items-center gap-2 bg-white/5 hover:bg-white/10 p-2 rounded-lg cursor-pointer transition-colors border border-white/5">
              <Plus className="w-3 h-3 text-white/40" />
              <span className="text-[11px] text-white/60 truncate flex-1">
                {customFontName ? "Font Loaded" : "Upload .TTF Font"}
              </span>
              <input type="file" accept=".ttf" className="hidden" onChange={handleFontUpload} />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs font-medium text-white/40 uppercase tracking-widest mb-1">
              <div className="flex items-center gap-2">
                <Type className="w-3 h-3" />
                <span>Bulk Input</span>
              </div>
              <motion.span 
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 4 }}
                className="text-[9px] lowercase text-green-500/50"
              >
                Auto-saved
              </motion.span>
              <button 
                onClick={handleSplitSubtitles}
                className="text-[10px] bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white px-2 py-0.5 rounded-full transition-colors"
                disabled={!videoUrl}
              >
                Split & Apply
              </button>
            </div>
            <textarea
              className="w-full h-32 bg-white/5 rounded-xl p-3 text-[11px] border border-white/10 focus:border-red-500/50 outline-none resize-none placeholder:text-white/20 custom-scrollbar"
              placeholder="Enter Korean content (Line by line)..."
              value={subtitleText}
              onChange={(e) => setSubtitleText(e.target.value)}
            />
          </div>

          {/* Combined English Subtitles Review & Copy */}
          <div className="bg-white/5 rounded-xl p-3.5 border border-white/10 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 overflow-hidden">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white/85 min-w-0 flex-1">
                <FileText className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span className="truncate">영문 서브자막 실시간 합본 검토</span>
              </div>
              <span className="text-[10px] font-mono bg-red-500/10 border border-red-500/15 px-2.5 py-0.5 rounded-full text-red-400 font-medium whitespace-nowrap shrink-0">
                {chunks.filter(c => c.subText.trim()).length} / {chunks.length} 완료
              </span>
            </div>

            <div className="text-[11px] leading-relaxed text-white/70 bg-black/40 border border-white/5 rounded-lg p-3 max-h-36 overflow-y-auto custom-scrollbar select-text font-sans">
              {chunks.map(c => c.subText.trim()).filter(Boolean).length > 0 ? (
                <div className="space-y-1.5">
                  {chunks.map((c, idx) => {
                    const trimmed = c.subText.trim();
                    if (!trimmed) return null;
                    const cleanTxt = trimmed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
                    return (
                      <div key={idx} className="flex gap-2.5 group/merge hover:bg-white/5 p-1 rounded transition-colors items-start">
                        <span className="text-[9px] font-mono text-white/20 select-none w-5 pt-0.5 text-right shrink-0">#{idx + 1}</span>
                        <span className="flex-1 text-white/80">{cleanTxt}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-white/30 italic text-[10px] block text-center py-2">No sub-subtitles yet. Enter sub-texts in the subtitle list or click "Batch Edit" to add or modify multiple lines of subtitles at once.</span>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => copyMergedSubtitles(true, ' ')}
                className="flex items-center justify-center gap-1.5 text-[10px] bg-white/5 hover:bg-white/10 text-white/85 hover:text-white px-2 py-2 rounded-lg border border-white/5 transition-colors font-medium active:scale-95 text-center whitespace-nowrap"
                title="Combines all sub-subtitles into a single paragraph with space spacing"
              >
                {copiedClean ? <Check className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5 text-white/50" />}
                <span>Copy Paragraph</span>
              </button>
              <button
                type="button"
                onClick={() => copyMergedSubtitles(true, '\n')}
                className="flex items-center justify-center gap-1.5 text-[10px] bg-white/5 hover:bg-white/10 text-white/85 hover:text-white px-2 py-2 rounded-lg border border-white/5 transition-colors font-medium active:scale-95 text-center whitespace-nowrap"
                title="Copies all sub-subtitles line-by-line"
              >
                {copiedClean ? <Check className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5 text-white/50" />}
                <span>Copy Lines (\n)</span>
              </button>
              <button
                type="button"
                onClick={() => copyMergedSubtitles(false, ' ')}
                className="flex items-center justify-center gap-1.5 text-[10px] bg-white/5 hover:bg-white/10 text-white/60 hover:text-white px-2 py-2 rounded-lg border border-white/5 transition-colors font-medium active:scale-95 text-center whitespace-nowrap"
                title="Copies sub-subtitles with style codes [word](style...)"
              >
                {copiedRaw ? <Check className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
                <span>Copy Styles</span>
              </button>
              <button
                type="button"
                onClick={openBatchSubModal}
                className="flex items-center justify-center gap-1.5 text-[10px] bg-red-500 hover:bg-red-650 text-white px-2 py-2 rounded-lg transition-colors font-semibold active:scale-95 shadow-sm text-center whitespace-nowrap"
                title="Open editor to edit multiple sub-subtitles at once"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>Batch Edit</span>
              </button>
            </div>

            {isBatchSubOpen && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-black/40 border border-white/5 rounded-lg p-3 flex flex-col gap-2 mt-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-bold text-red-400 whitespace-nowrap">Batch Edit</span>
                    <span className="text-[9px] text-white/30 whitespace-nowrap">(Max {chunks.length} lines)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsBatchSubOpen(false);
                      setBatchSubText('');
                    }}
                    className="text-[9px] text-white/40 hover:text-white"
                  >
                    Close
                  </button>
                </div>
                
                <textarea
                  className="w-full h-36 bg-black/40 rounded-lg p-2.5 text-[10px] font-mono border border-white/10 focus:border-red-500/50 outline-none resize-y placeholder:text-white/20 custom-scrollbar text-white leading-relaxed"
                  placeholder={`Paste your subtitles here, with each line representing a subtitle slot.\n\n[Example]\nFirst subtitle line\nSecond subtitle line\nThird subtitle line...`}
                  value={batchSubText}
                  onChange={(e) => setBatchSubText(e.target.value)}
                />
                
                <div className="flex items-center justify-between gap-2.5">
                  <span className="text-[9px] text-white/40 leading-tight">
                    Lines: {batchSubText.split('\n').filter(line => line.trim().length > 0).length} / Slots: {chunks.length}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchSubOpen(false);
                        setBatchSubText('');
                      }}
                      className="text-[10px] text-white/60 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded transition-colors whitespace-nowrap"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyBatchSubtitles}
                      className="text-[10px] text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded transition-colors font-semibold shadow-md shadow-red-950/20 whitespace-nowrap"
                    >
                      Apply All
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Subtitle List */}
          <div className="flex flex-col gap-2 mt-4">
            <div className="flex items-center justify-between text-xs font-medium text-white/40 uppercase tracking-widest px-1">
              <div className="flex items-center gap-1.5">
                <span>List View</span>
                <span className="text-[10px] text-white/20">({chunks.length})</span>
              </div>
              {chunks.length > 0 && (
                <button
                  onClick={handleAutoRedistribute}
                  disabled={!videoUrl}
                  className="flex items-center gap-1 text-[9px] bg-red-400/10 hover:bg-red-400/20 text-red-100 hover:text-white px-2.5 py-1 rounded-full border border-red-500/20 active:scale-95 transition-all cursor-pointer font-bold"
                  title="영상 길이에 따라 모든 자막의 지속시간을 글자수에 비례해 자동 분배합니다"
                >
                  <Clock className="w-2.5 h-2.5" />
                  <span>시간 자동 분배</span>
                </button>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {chunks.map((chunk, idx) => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={idx} 
                  className="bg-white/5 p-3 rounded-lg border border-white/5 flex flex-col gap-2 relative group-item"
                >
                  <div className="flex items-center justify-between gap-2">
                     <span className="text-[10px] font-mono text-white/20 italic">#{idx + 1}</span>
                     <button onClick={() => removeChunk(idx)} className="text-white/10 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3 h-3" />
                     </button>
                  </div>
                  <input 
                    id={`chunk-text-${idx}`}
                    className="bg-transparent text-[11px] outline-none border-b border-white/5 focus:border-red-500/30 pb-1 w-full"
                    value={chunk.text}
                    onChange={(e) => updateChunk(idx, 'text', e.target.value)}
                    onFocus={() => { setActiveChunkIdx(idx); setActiveField('text'); }}
                  />
                  <input 
                    id={`chunk-subText-${idx}`}
                    className="bg-transparent text-[10px] text-white/40 outline-none w-full"
                    value={chunk.subText}
                    onChange={(e) => updateChunk(idx, 'subText', e.target.value)}
                    placeholder="Sub-text..."
                    onFocus={() => { setActiveChunkIdx(idx); setActiveField('subText'); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const next = (e.currentTarget.parentElement?.nextElementSibling as HTMLElement)?.querySelector('input[id^="chunk-text-"]') as HTMLInputElement;
                        next?.focus();
                      }
                    }}
                  />

                  {/* Dynamic Duration Timeline Controls */}
                  <div className="flex items-center justify-between gap-1 mt-1 pt-1.5 border-t border-white/5 text-[10px] text-white/40">
                    <div className="flex items-center gap-1">
                      <span>시작:</span>
                      <input 
                        type="number" 
                        step="0.1" 
                        min="0"
                        max={videoRef.current?.duration || 3600}
                        className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] text-white/80 w-12 font-mono"
                        value={chunk.start}
                        onChange={(e) => updateChunk(idx, 'start', parseFloat(e.target.value) || 0)}
                      />
                      <span>초</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>끝:</span>
                      <input 
                        type="number" 
                        step="0.1" 
                        min="0"
                        max={videoRef.current?.duration || 3600}
                        className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] text-white/80 w-12 font-mono"
                        value={chunk.end}
                        onChange={(e) => updateChunk(idx, 'end', parseFloat(e.target.value) || 0)}
                      />
                      <span>초</span>
                    </div>
                    <button 
                      type="button"
                      title="Set to Current Time"
                      onClick={() => {
                        if (videoRef.current) {
                          const time = parseFloat(videoRef.current.currentTime.toFixed(1));
                          // Set start time to current time, and keep duration same if possible
                          const duration = chunk.end - chunk.start;
                          updateChunk(idx, 'start', time);
                          updateChunk(idx, 'end', parseFloat((time + (duration > 0 ? duration : 2)).toFixed(1)));
                        }
                      }}
                      className="px-1.5 py-0.5 bg-white/5 hover:bg-white/10 rounded text-[9px] text-white/60 hover:text-white transition-colors border border-white/5"
                    >
                      현재위치
                    </button>
                    <div className="flex items-center gap-0.5 text-[9px] font-mono text-white/30 truncate">
                      <span>지속:</span>
                      <span className="text-red-400 font-bold">{(chunk.end - chunk.start).toFixed(1)}s</span>
                    </div>
                  </div>

                  {/* Styling & Animation Tool Bar */}
                  {activeChunkIdx === idx && activeField && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-1 flex flex-col gap-1.5 p-2 bg-black/40 rounded-lg border border-white/5 overflow-hidden"
                    >
                      <div className="flex items-center justify-between text-[9px] font-bold text-white/40 uppercase tracking-wider">
                        <span>{activeField === 'text' ? 'Main Text' : 'Sub Text'} Highlight Style</span>
                        <span className="text-[8px] text-red-400 capitalize">select text to style</span>
                      </div>
                      
                      {/* Format Trigger Buttons */}
                      <div className="flex flex-wrap gap-1 items-center">
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'bold'); }}
                          className="p-1 px-1.5 bg-white/5 hover:bg-white/10 active:scale-95 rounded text-[10px] text-white/80 font-bold flex items-center justify-center border border-white/5"
                          title="Bold"
                        >
                          <Bold className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'italic'); }}
                          className="p-1 px-1.5 bg-white/5 hover:bg-white/10 active:scale-95 rounded text-[10px] text-white/80 italic flex items-center justify-center border border-white/5"
                          title="Italic"
                        >
                          <Italic className="w-3 h-3" />
                        </button>
                        
                        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />
                        
                        {/* Highlights (Colors) */}
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'red'); }}
                          className="w-3.5 h-3.5 rounded-full bg-[#ef4444] border border-white/20 active:scale-95 transition-transform"
                          title="Red"
                        />
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'yellow'); }}
                          className="w-3.5 h-3.5 rounded-full bg-[#eab308] border border-white/20 active:scale-95 transition-transform"
                          title="Yellow"
                        />
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'blue'); }}
                          className="w-3.5 h-3.5 rounded-full bg-[#3b82f6] border border-white/20 active:scale-95 transition-transform"
                          title="Blue"
                        />
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'green'); }}
                          className="w-3.5 h-3.5 rounded-full bg-[#22c55e] border border-white/20 active:scale-95 transition-transform"
                          title="Green"
                        />

                        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />
                        
                        {/* Special Animation Effects */}
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'wave'); }}
                          className="p-1 px-1.5 bg-red-500/10 hover:bg-red-500/20 active:scale-95 text-red-400 hover:text-red-300 rounded text-[9px] font-medium flex items-center gap-0.5 border border-red-500/20"
                          title="Wave animation"
                        >
                          <Sparkles className="w-2 w-2" />
                          <span>Wave</span>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'bounce'); }}
                          className="p-1 px-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 active:scale-95 text-yellow-400 hover:text-yellow-300 rounded text-[9px] font-medium flex items-center gap-0.5 border border-yellow-500/20"
                          title="Bounce animation"
                        >
                          <span>Bounce</span>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'shake'); }}
                          className="p-1 px-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 active:scale-95 text-cyan-400 hover:text-cyan-300 rounded text-[9px] font-medium flex items-center gap-0.5 border border-cyan-500/20"
                          title="Shake animation"
                        >
                          <span>Shake</span>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applyFormat(idx, activeField, 'glitch'); }}
                          className="p-1 px-1.5 bg-purple-500/10 hover:bg-purple-500/20 active:scale-95 text-purple-400 hover:text-purple-300 rounded text-[9px] font-medium flex items-center gap-0.5 border border-purple-500/20"
                          title="Glitch pixel splits"
                        >
                          <span>Glitch</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ))}
              {videoUrl && (
                <button 
                  onClick={() => setChunks([...chunks, { text: 'New Line', subText: '', start: chunks.length ? chunks[chunks.length-1].end : 0, end: (chunks.length ? chunks[chunks.length-1].end : 0) + 2 }])}
                  className="p-2 border border-dashed border-white/10 rounded-lg flex items-center justify-center text-white/20 hover:text-white/40 hover:bg-white/5 transition-all"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 relative z-10">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!videoFile}
            className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 font-semibold transition-all ${
              isRecording 
                ? 'bg-white text-black hover:bg-white/90' 
                : 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-30 disabled:grayscale'
            }`}
          >
            {isRecording ? <Pause className="w-4 h-4 fill-current" /> : <Download className="w-4 h-4" />}
            {isRecording ? 'Stop Recording' : 'Process & Export'}
          </button>
          
          <p className="text-[10px] text-white/30 text-center px-4 leading-relaxed">
            Exports as WEBM. Brush trail highlights movement centers.
          </p>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 min-h-[400px] bg-[#111] rounded-2xl border border-white/5 overflow-hidden flex flex-col order-1 md:order-2 self-start md:sticky md:top-6">
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#151515]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold tracking-tighter uppercase italic">Preview</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono text-white/30 lowercase">
             <div className="flex items-center gap-1">
               <Focus className="w-3 h-3" />
               <span>Tracking motion...</span>
             </div>
             <div>{Math.floor(currentTime)}s / {videoRef.current?.duration ? Math.floor(videoRef.current.duration) : 0}s</div>
          </div>
        </div>

        <div className="flex-1 relative flex items-center justify-center bg-black group">
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            onLoadedMetadata={handleVideoLoad}
            className="hidden"
            muted
          />
          
          <canvas
            ref={canvasRef}
            width={dimensions.width || 1280}
            height={dimensions.height || 720}
            className="max-w-full max-h-full object-contain shadow-2xl"
          />

          {!videoUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20 gap-3">
              <Eye className="w-12 h-12 opacity-50" />
              <p className="text-sm font-medium">Waiting for video input...</p>
            </div>
          )}

          {videoUrl && !isRecording && (
            <button
               onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()}
               className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40"
            >
               <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
                 <Play className="w-6 h-6 text-white fill-current" />
               </div>
            </button>
          )}

          <AnimatePresence>
            {(isRecording || isSavingProcessing) && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-[#0a0a0a]/90 backdrop-blur-xl flex flex-col items-center justify-center z-50 text-center px-6"
              >
                {isSavingProcessing ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
                    <div className="flex flex-col gap-1.5">
                      <span className="text-lg font-bold text-white tracking-tight">스마트폰 갤러리에 저장 중</span>
                      <span className="text-xs text-white/50 font-mono animate-pulse">{savingStatus || '미디어 데이터 처리 중...'}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="relative w-48 h-48 flex items-center justify-center">
                       <svg className="w-full h-full transform -rotate-90">
                         <circle 
                           cx="96" cy="96" r="80" 
                           fill="none" stroke="currentColor" strokeWidth="2" 
                           className="text-white/5" 
                         />
                         <motion.circle 
                           cx="96" cy="96" r="80" 
                           fill="none" stroke="currentColor" strokeWidth="4" 
                           className="text-red-500"
                           strokeDasharray="502"
                           animate={{ strokeDashoffset: 502 - (502 * exportProgress) / 100 }}
                         />
                       </svg>
                       <div className="absolute flex flex-col items-center">
                         <span className="text-3xl font-bold font-mono">{Math.floor(exportProgress)}%</span>
                         <span className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Exporting</span>
                       </div>
                    </div>
                    <p className="mt-8 text-sm text-white/50 animate-pulse">Encoding video frames... Please wait.</p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Dynamic Status Bar */}
        <div className="p-4 bg-[#151515] grid grid-cols-3 gap-4 border-t border-white/5">
           <StatusItem 
             icon={<MousePointer2 className="w-3 h-3" />} 
             label="Brush Activity" 
             value={uiProcessorState.focusPoint ? `${Math.round(uiProcessorState.focusPoint.x * 100)}%, ${Math.round(uiProcessorState.focusPoint.y * 100)}%` : 'No motion'}
           />
           <StatusItem 
             icon={<Download className="w-3 h-3" />} 
             label="Aspect Ratio" 
             value={dimensions.width ? `${dimensions.width}:${dimensions.height}` : '-'}
           />
           <StatusItem 
             icon={<Type className="w-3 h-3" />} 
             label="Subtitle Chunks" 
             value={`${chunks.length}`}
           />
        </div>
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
    "0, 0, 0";
}

function StatusItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] text-white/30">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xs font-medium text-white/80">{value}</div>
    </div>
  );
}
