/**
 * QR Code utilities for Witness Protocol
 * Handles QR code generation for group invites
 */

import QRCode from 'qrcode';

/**
 * Generate QR code as data URL
 * @param {object} data - Data to encode (will be JSON stringified)
 * @param {object} options - QR code options
 * @returns {Promise<string>} Data URL (base64 PNG)
 */
export async function generateQRDataURL(data, options = {}) {
  const jsonStr = JSON.stringify(data);

  const defaultOptions = {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  };

  const qrOptions = { ...defaultOptions, ...options };

  try {
    const dataUrl = await QRCode.toDataURL(jsonStr, qrOptions);
    return dataUrl;
  } catch (err) {
    console.error('[qrcode] Generation failed:', err);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Generate QR code to a canvas element
 * @param {HTMLCanvasElement} canvas - Canvas element to draw on
 * @param {object} data - Data to encode
 * @param {object} options - QR code options
 */
export async function generateQRToCanvas(canvas, data, options = {}) {
  const jsonStr = JSON.stringify(data);

  const defaultOptions = {
    errorCorrectionLevel: 'M',
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  };

  const qrOptions = { ...defaultOptions, ...options };

  try {
    await QRCode.toCanvas(canvas, jsonStr, qrOptions);
  } catch (err) {
    console.error('[qrcode] Canvas generation failed:', err);
    throw new Error('Failed to generate QR code');
  }
}
