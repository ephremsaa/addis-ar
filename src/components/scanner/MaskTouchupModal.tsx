import React, { useRef, useState, useEffect } from 'react';
import { X, Check, RotateCcw, Paintbrush, Eraser, ZoomIn, ZoomOut, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScanPhoto } from '@/lib/scanner/types';
import { applyBrushEdit } from '@/lib/scanner/background-segmenter';

interface MaskTouchupModalProps {
  photo: ScanPhoto;
  onSave: (updatedPhoto: ScanPhoto) => void;
  onClose: () => void;
}

export function MaskTouchupModal({
  photo,
  onSave,
  onClose,
}: MaskTouchupModalProps) {
  const [mode, setMode] = useState<'restore' | 'erase'>('restore');
  const [brushRadius, setBrushRadius] = useState<number>(18);
  const [currentMask, setCurrentMask] = useState<string>(
    photo.maskDataUrl || photo.dataUrl
  );
  const [currentTrans, setCurrentTrans] = useState<string>(
    photo.transparentDataUrl || photo.dataUrl
  );
  const [viewStyle, setViewStyle] = useState<'cutout' | 'mask' | 'original'>('cutout');
  const [zoom, setZoom] = useState<number>(1);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [history, setHistory] = useState<Array<{ mask: string; trans: string }>>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokePoints = useRef<Array<{ x: number; y: number }>>([]);

  // Load and render current state onto the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src =
      viewStyle === 'original'
        ? photo.dataUrl
        : viewStyle === 'mask'
          ? currentMask
          : currentTrans;

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (viewStyle === 'cutout') {
        // Draw checkerboard background for transparent inspection
        drawCheckerboard(ctx, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);
    };
  }, [currentMask, currentTrans, viewStyle]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (viewStyle === 'original') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setIsDrawing(true);
    strokePoints.current = [{ x, y }];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || viewStyle === 'original') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    strokePoints.current.push({ x, y });
  };

  const handlePointerUp = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (strokePoints.current.length === 0) return;

    // Save previous state to history
    setHistory((prev) => [...prev, { mask: currentMask, trans: currentTrans }]);

    try {
      const result = await applyBrushEdit(
        photo.dataUrl,
        currentMask,
        strokePoints.current,
        mode,
        brushRadius
      );
      setCurrentMask(result.maskDataUrl);
      setCurrentTrans(result.transparentDataUrl);
    } catch (err) {
      console.error('Failed to apply brush edit:', err);
    } finally {
      strokePoints.current = [];
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setCurrentMask(prev.mask);
    setCurrentTrans(prev.trans);
    setHistory((s) => s.slice(0, -1));
  };

  const handleReset = () => {
    if (photo.maskDataUrl && photo.transparentDataUrl) {
      setCurrentMask(photo.maskDataUrl);
      setCurrentTrans(photo.transparentDataUrl);
      setHistory([]);
    }
  };

  const handleApply = () => {
    onSave({
      ...photo,
      maskDataUrl: currentMask,
      transparentDataUrl: currentTrans,
      isSegmented: true,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] bg-card border border-border rounded-2xl overflow-hidden shadow-2xl">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/90">
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Paintbrush className="w-4 h-4 text-primary" />
              Touch Up Background Mask
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Restore accidentally removed parts or erase remaining background.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-muted/30 border-b border-border/50 text-xs flex-wrap gap-2">
          {/* Tool Selector */}
          <div className="flex items-center gap-1 bg-background/60 p-1 rounded-lg border border-border/40">
            <Button
              size="sm"
              variant={mode === 'restore' ? 'default' : 'ghost'}
              className="h-7 text-xs gap-1.5"
              onClick={() => {
                setMode('restore');
                if (viewStyle === 'original') setViewStyle('cutout');
              }}
            >
              <Paintbrush className="w-3.5 h-3.5 text-emerald-400" />
              Restore (Keep)
            </Button>
            <Button
              size="sm"
              variant={mode === 'erase' ? 'default' : 'ghost'}
              className="h-7 text-xs gap-1.5"
              onClick={() => {
                setMode('erase');
                if (viewStyle === 'original') setViewStyle('cutout');
              }}
            >
              <Eraser className="w-3.5 h-3.5 text-rose-400" />
              Erase (Background)
            </Button>
          </div>

          {/* Brush Size Slider */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Size:</span>
            <input
              type="range"
              min="4"
              max="60"
              value={brushRadius}
              onChange={(e) => setBrushRadius(Number(e.target.value))}
              className="w-24 accent-primary"
            />
            <span className="text-[11px] font-mono text-muted-foreground w-6">
              {brushRadius}px
            </span>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-background/60 p-1 rounded-lg border border-border/40">
            <Button
              size="sm"
              variant={viewStyle === 'cutout' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setViewStyle('cutout')}
            >
              Cutout
            </Button>
            <Button
              size="sm"
              variant={viewStyle === 'mask' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setViewStyle('mask')}
            >
              B&W Mask
            </Button>
            <Button
              size="sm"
              variant={viewStyle === 'original' ? 'secondary' : 'ghost'}
              className="h-7 text-xs gap-1"
              onClick={() => setViewStyle('original')}
            >
              <Eye className="w-3 h-3" /> Original
            </Button>
          </div>

          {/* Undo and Zoom */}
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleUndo}
              disabled={history.length === 0}
              title="Undo stroke"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Canvas Workspace Area */}
        <div className="relative flex-1 overflow-auto bg-neutral-950 p-6 flex items-center justify-center min-h-[380px]">
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            className="transition-transform duration-100 ease-out shadow-2xl rounded-lg overflow-hidden border border-border/30"
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`max-h-[60vh] max-w-full touch-none select-none ${
                viewStyle !== 'original' ? 'cursor-crosshair' : 'cursor-default'
              }`}
            />
          </div>
        </div>

        {/* Modal Bottom Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-card/90">
          <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs">
            Reset to Original Mask
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply} className="text-xs gap-1.5 font-semibold">
              <Check className="w-3.5 h-3.5" /> Apply Mask
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const size = 16;
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#27272a';
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
}
