/**
 * SessionManager Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../SessionManager.js';

// Mock dependencies
vi.mock('../../ipfs.js', () => ({
  uploadEncryptedData: vi.fn().mockResolvedValue({ cid: 'QmChunkCid', size: 1024 }),
  uploadManifest: vi.fn().mockResolvedValue({ cid: 'QmManifestCid' }),
}));

vi.mock('../../contract.js', () => ({
  updateSession: vi.fn().mockResolvedValue('0xtxhash'),
  waitForTransaction: vi.fn().mockResolvedValue({ status: 'success' }),
}));

vi.mock('../streamingDb.js', () => {
  const mockDb = {
    pendingUploads: {
      add: vi.fn().mockResolvedValue(1),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(1),
    },
    sessions: {
      add: vi.fn().mockResolvedValue('session-id'),
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(1),
    },
  };
  return { db: mockDb, default: mockDb };
});

describe('SessionManager', () => {
  let manager;
  let mockSessionKey;

  beforeEach(async () => {
    mockSessionKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  });

  it('should start a session', async () => {
    manager = await SessionManager.create({
      groupIds: ['0xgroup1'],
      uploader: '0x1234567890123456789012345678901234567890',
      sessionKey: mockSessionKey,
    });

    expect(manager.sessionId).toBeDefined();
    expect(manager.isActive()).toBe(true);
  });

  it('should process chunks', async () => {
    manager = await SessionManager.create({
      groupIds: ['0xgroup1'],
      uploader: '0x1234567890123456789012345678901234567890',
      sessionKey: mockSessionKey,
    });

    const blob = new Blob(['test chunk data'], { type: 'video/webm' });
    const result = await manager.processChunk(blob);

    expect(result.chunkIndex).toBe(0);
    expect(result.cid).toBe('QmChunkCid');
  });

  it('should update merkle root after each chunk', async () => {
    manager = await SessionManager.create({
      groupIds: ['0xgroup1'],
      uploader: '0x1234567890123456789012345678901234567890',
      sessionKey: mockSessionKey,
    });

    await manager.processChunk(new Blob(['chunk 0']));
    const root1 = manager.getMerkleRoot();

    await manager.processChunk(new Blob(['chunk 1']));
    const root2 = manager.getMerkleRoot();

    expect(root1).not.toBe(null);
    expect(root2).not.toBe(null);
    expect(root1).not.toEqual(root2);
  });

  it('should end session and mark complete', async () => {
    manager = await SessionManager.create({
      groupIds: ['0xgroup1'],
      uploader: '0x1234567890123456789012345678901234567890',
      sessionKey: mockSessionKey,
    });

    await manager.processChunk(new Blob(['chunk 0']));
    await manager.endSession();

    expect(manager.isActive()).toBe(false);
    expect(manager.getStatus()).toBe('complete');
  });

  it('should track chunk count', async () => {
    manager = await SessionManager.create({
      groupIds: ['0xgroup1'],
      uploader: '0x1234567890123456789012345678901234567890',
      sessionKey: mockSessionKey,
    });

    expect(manager.getChunkCount()).toBe(0);

    await manager.processChunk(new Blob(['chunk 0']));
    expect(manager.getChunkCount()).toBe(1);

    await manager.processChunk(new Blob(['chunk 1']));
    expect(manager.getChunkCount()).toBe(2);
  });
});
