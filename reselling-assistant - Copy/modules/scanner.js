import { t } from './i18n.js';

let detector = null;
let stream = null;
let isScanning = false;

export async function initScanner() {
  if (!('BarcodeDetector' in window)) {
    console.warn('BarcodeDetector API is not supported in this browser.');
    return false;
  }
  
  const formats = await BarcodeDetector.getSupportedFormats();
  if (formats.length === 0) return false;
  
  detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  return true;
}

export async function startScanning(videoEl, canvasEl, onDetected) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' } 
    });
    videoEl.srcObject = stream;
    videoEl.hidden = false;
    await videoEl.play();
    
    isScanning = true;
    scanFrame(videoEl, canvasEl, onDetected);
    return true;
  } catch (err) {
    console.error('Error starting scanner:', err);
    return false;
  }
}

export function stopScanning(videoEl) {
  isScanning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.srcObject = null;
    videoEl.hidden = true;
  }
}

async function scanFrame(videoEl, canvasEl, onDetected) {
  if (!isScanning) return;

  try {
    const barcodes = await detector.detect(videoEl);
    if (barcodes.length > 0) {
      const ean = barcodes[0].rawValue;
      onDetected(ean);
      stopScanning(videoEl);
      return;
    }
  } catch (err) {
    console.error('Detection error:', err);
  }

  requestAnimationFrame(() => scanFrame(videoEl, canvasEl, onDetected));
}
