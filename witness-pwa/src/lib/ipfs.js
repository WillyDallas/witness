/**
 * IPFS Service for Witness Protocol
 * Handles file uploads and downloads via Pinata
 */

import { PinataSDK } from 'pinata';

// Initialize Pinata SDK
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY;

let pinata = null;

/**
 * Get or initialize Pinata SDK instance
 * @returns {PinataSDK}
 */
function getPinata() {
  if (!pinata) {
    if (!PINATA_JWT) {
      throw new Error('VITE_PINATA_JWT not configured');
    }
    if (!PINATA_GATEWAY) {
      throw new Error('VITE_PINATA_GATEWAY not configured');
    }

    pinata = new PinataSDK({
      pinataJwt: PINATA_JWT,
      pinataGateway: PINATA_GATEWAY,
    });
  }
  return pinata;
}

/**
 * Upload encrypted data to IPFS
 * @param {Uint8Array} encryptedData - Encrypted bytes to upload
 * @param {string} filename - Filename for the upload
 * @returns {Promise<{cid: string, size: number}>}
 */
export async function uploadEncryptedData(encryptedData, filename) {
  const sdk = getPinata();

  // Create a File object from the encrypted bytes
  const file = new File([encryptedData], filename, {
    type: 'application/octet-stream',
  });

  try {
    const result = await sdk.upload.public.file(file);
    console.log('[ipfs] Uploaded:', filename, '→', result.cid);

    return {
      cid: result.cid,
      size: result.size,
    };
  } catch (err) {
    console.error('[ipfs] Upload failed:', err);
    throw new Error('Failed to upload to IPFS: ' + err.message);
  }
}

/**
 * Upload JSON manifest to IPFS
 * @param {object} manifest - Manifest object
 * @returns {Promise<{cid: string}>}
 */
export async function uploadManifest(manifest) {
  const sdk = getPinata();

  try {
    const result = await sdk.upload.public.json(manifest);
    console.log('[ipfs] Manifest uploaded:', result.cid);

    return {
      cid: result.cid,
    };
  } catch (err) {
    console.error('[ipfs] Manifest upload failed:', err);
    throw new Error('Failed to upload manifest: ' + err.message);
  }
}

/**
 * Download content from IPFS
 * @param {string} cid - Content ID to download
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadContent(cid) {
  const sdk = getPinata();

  try {
    const response = await sdk.gateways.public.get(cid);

    // Response could be various types - handle accordingly
    if (response instanceof ArrayBuffer) {
      return response;
    }

    if (response instanceof Blob) {
      return await response.arrayBuffer();
    }

    // If it's JSON (for manifests), return as-is
    if (typeof response === 'object') {
      return response;
    }

    throw new Error('Unexpected response type from gateway');
  } catch (err) {
    console.error('[ipfs] Download failed:', err);
    throw new Error('Failed to download from IPFS: ' + err.message);
  }
}

/**
 * Get gateway URL for a CID
 * @param {string} cid - Content ID
 * @returns {string} Full gateway URL
 */
export function getGatewayUrl(cid) {
  return `https://${PINATA_GATEWAY}/ipfs/${cid}`;
}

/**
 * Check if IPFS is configured
 * @returns {boolean}
 */
export function isConfigured() {
  return Boolean(PINATA_JWT && PINATA_GATEWAY);
}
