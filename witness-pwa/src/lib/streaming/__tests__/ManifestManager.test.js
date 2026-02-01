/**
 * ManifestManager Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManifestManager } from '../ManifestManager.js';

// Mock ipfs module
vi.mock('../../ipfs.js', () => ({
  uploadManifest: vi.fn().mockResolvedValue({ cid: 'QmManifestCid' }),
}));

describe('ManifestManager', () => {
  let manager;

  beforeEach(() => {
    manager = new ManifestManager({
      sessionId: 'test-session-123',
      uploader: '0x1234567890123456789012345678901234567890',
      groupIds: ['0xgroup1', '0xgroup2'],
    });
  });

  it('should initialize with empty chunks', () => {
    expect(manager.getChunkCount()).toBe(0);
    expect(manager.getManifest().chunks).toHaveLength(0);
  });

  it('should add chunk metadata', () => {
    manager.addChunk({
      index: 0,
      cid: 'QmChunk0',
      size: 1024,
      duration: 10000,
      plaintextHash: 'a'.repeat(64),
      encryptedHash: 'b'.repeat(64),
      iv: 'dGVzdGl2MTIz',
      capturedAt: Date.now(),
      uploadedAt: Date.now(),
    });

    expect(manager.getChunkCount()).toBe(1);
    expect(manager.getManifest().chunks[0].cid).toBe('QmChunk0');
  });

  it('should update merkle root when set', () => {
    manager.setMerkleRoot('c'.repeat(64));
    expect(manager.getManifest().merkleRoot).toBe('c'.repeat(64));
  });

  it('should upload manifest and return CID', async () => {
    manager.addChunk({
      index: 0,
      cid: 'QmChunk0',
      size: 1024,
      duration: 10000,
      plaintextHash: 'a'.repeat(64),
      encryptedHash: 'b'.repeat(64),
      iv: 'dGVzdGl2MTIz',
      capturedAt: Date.now(),
      uploadedAt: Date.now(),
    });
    manager.setMerkleRoot('c'.repeat(64));

    const { cid } = await manager.uploadManifest();

    expect(cid).toBe('QmManifestCid');
    expect(manager.getLatestCid()).toBe('QmManifestCid');
  });

  it('should include access list in manifest', () => {
    manager.setAccessList({
      '0xgroup1': { wrappedKey: 'wrapped1', iv: 'iv1' },
      '0xgroup2': { wrappedKey: 'wrapped2', iv: 'iv2' },
    });

    const manifest = manager.getManifest();
    expect(manifest.accessList['0xgroup1']).toBeDefined();
    expect(manifest.accessList['0xgroup2']).toBeDefined();
  });

  it('should track status changes', () => {
    expect(manager.getManifest().status).toBe('recording');

    manager.setStatus('complete');
    expect(manager.getManifest().status).toBe('complete');
  });

  it('should serialize for storage', () => {
    manager.addChunk({
      index: 0,
      cid: 'QmChunk0',
      size: 1024,
      duration: 10000,
      plaintextHash: 'a'.repeat(64),
      encryptedHash: 'b'.repeat(64),
      iv: 'dGVzdGl2MTIz',
      capturedAt: Date.now(),
      uploadedAt: Date.now(),
    });

    const json = manager.toJSON();
    expect(typeof json).toBe('string');

    const parsed = JSON.parse(json);
    expect(parsed.chunks).toHaveLength(1);
  });
});
