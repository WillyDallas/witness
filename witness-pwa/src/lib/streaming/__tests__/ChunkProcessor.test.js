/**
 * ChunkProcessor Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkProcessor } from '../ChunkProcessor.js';

// Mock the ipfs module
vi.mock('../../ipfs.js', () => ({
  uploadEncryptedData: vi.fn().mockResolvedValue({ cid: 'QmTestCid123', size: 1024 }),
}));

describe('ChunkProcessor', () => {
  let processor;
  let mockSessionKey;

  beforeEach(async () => {
    // Generate a real session key for testing
    mockSessionKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    processor = new ChunkProcessor(mockSessionKey);
  });

  it('should hash raw blob', async () => {
    const blob = new Blob(['test video data'], { type: 'video/webm' });
    const hash = await processor.hashBlob(blob);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should derive chunk key from session key and index', async () => {
    const chunkKey = await processor.deriveChunkKey(0);

    expect(chunkKey).toBeDefined();
    expect(chunkKey.type).toBe('secret');
    expect(chunkKey.algorithm.name).toBe('AES-GCM');
  });

  it('should derive different keys for different indices', async () => {
    const key0 = await processor.deriveChunkKey(0);
    const key1 = await processor.deriveChunkKey(1);

    // Export keys to compare (they should be different)
    const raw0 = await crypto.subtle.exportKey('raw', key0);
    const raw1 = await crypto.subtle.exportKey('raw', key1);

    expect(new Uint8Array(raw0)).not.toEqual(new Uint8Array(raw1));
  });

  it('should encrypt blob and return metadata', async () => {
    const blob = new Blob(['test video data'], { type: 'video/webm' });

    const result = await processor.encryptChunk(blob, 0);

    expect(result.encryptedData).toBeInstanceOf(Uint8Array);
    expect(result.iv).toHaveLength(16); // 12 bytes = 16 base64 chars (with padding)
    expect(result.plaintextHash).toHaveLength(64);
    expect(result.encryptedHash).toHaveLength(64);
  });

  it('should process full chunk pipeline', async () => {
    const blob = new Blob(['test video data for full pipeline'], { type: 'video/webm' });
    const capturedAt = Date.now();

    const result = await processor.processChunk(blob, 0, capturedAt);

    expect(result.cid).toBe('QmTestCid123');
    expect(result.plaintextHash).toHaveLength(64);
    expect(result.encryptedHash).toHaveLength(64);
    expect(result.iv).toBeDefined();
    expect(result.size).toBeGreaterThan(0);
    expect(result.capturedAt).toBe(capturedAt);
    expect(result.chunkIndex).toBe(0);
  });

  it('should allow decryption round-trip', async () => {
    const originalData = 'test video content for round trip';
    const blob = new Blob([originalData], { type: 'video/webm' });

    const encrypted = await processor.encryptChunk(blob, 0);
    const decrypted = await processor.decryptChunk(
      encrypted.encryptedData,
      encrypted.iv,
      0
    );

    const decryptedText = new TextDecoder().decode(decrypted);
    expect(decryptedText).toBe(originalData);
  });
});
