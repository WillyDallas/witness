/**
 * Integration Test: Full Pipeline
 * Feed 5 mock blobs through ChunkProcessor → MerkleTreeService → verify
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkProcessor } from '../ChunkProcessor.js';
import { MerkleTreeService } from '../MerkleTreeService.js';
import { ManifestManager } from '../ManifestManager.js';

// Mock IPFS
vi.mock('../../ipfs.js', () => ({
  uploadEncryptedData: vi.fn().mockImplementation((data, filename) => ({
    cid: `Qm${filename.replace('.enc', '')}${Math.random().toString(36).slice(2, 10)}`,
    size: data.length,
  })),
  uploadManifest: vi.fn().mockResolvedValue({ cid: 'QmManifest' }),
}));

describe('Streaming Pipeline Integration', () => {
  let sessionKey;
  let processor;
  let merkleTree;
  let manifestManager;

  beforeEach(async () => {
    // Generate session key
    sessionKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    processor = new ChunkProcessor(sessionKey);
    merkleTree = new MerkleTreeService();
    manifestManager = new ManifestManager({
      sessionId: 'test-integration-session',
      uploader: '0x1234567890123456789012345678901234567890',
      groupIds: ['0xgroup1'],
    });
  });

  it('should process 5 blobs through full pipeline', async () => {
    const blobs = Array.from({ length: 5 }, (_, i) =>
      new Blob([`Video chunk ${i} data content - ${Date.now()}`], { type: 'video/webm' })
    );

    const results = [];

    for (let i = 0; i < blobs.length; i++) {
      const capturedAt = Date.now() + i * 10000;

      // 1. Process chunk
      const chunkMeta = await processor.processChunk(blobs[i], i, capturedAt);
      expect(chunkMeta.cid).toBeDefined();
      expect(chunkMeta.plaintextHash).toHaveLength(64);

      // 2. Update merkle tree
      const leaf = await merkleTree.computeLeaf({
        chunkIndex: i,
        plaintextHash: chunkMeta.plaintextHash,
        encryptedHash: chunkMeta.encryptedHash,
        capturedAt,
      });
      merkleTree.insert(leaf);

      // 3. Update manifest
      manifestManager.addChunk({
        index: i,
        cid: chunkMeta.cid,
        size: chunkMeta.size,
        duration: 10000,
        plaintextHash: chunkMeta.plaintextHash,
        encryptedHash: chunkMeta.encryptedHash,
        iv: chunkMeta.iv,
        capturedAt,
        uploadedAt: Date.now(),
      });
      manifestManager.setMerkleRoot(merkleTree.getRoot());

      results.push({
        chunkIndex: i,
        cid: chunkMeta.cid,
        merkleRoot: merkleTree.getRoot(),
      });
    }

    // Verify results
    expect(results).toHaveLength(5);
    expect(manifestManager.getChunkCount()).toBe(5);

    // Verify all roots are unique (tree grew with each chunk)
    const uniqueRoots = new Set(results.map(r => r.merkleRoot));
    expect(uniqueRoots.size).toBe(5);

    // Verify merkle proofs work
    for (let i = 0; i < 5; i++) {
      const proof = merkleTree.getProof(i);
      expect(proof.leaf).toBeDefined();
      expect(proof.root).toBe(merkleTree.getRoot());
    }

    // Verify manifest structure
    const manifest = manifestManager.getManifest();
    expect(manifest.chunks).toHaveLength(5);
    expect(manifest.merkleRoot).toBe(merkleTree.getRoot());
  });

  it('should allow decryption of all chunks', async () => {
    const originalData = ['chunk0', 'chunk1', 'chunk2', 'chunk3', 'chunk4'];

    for (let i = 0; i < originalData.length; i++) {
      const blob = new Blob([originalData[i]], { type: 'video/webm' });
      const encrypted = await processor.encryptChunk(blob, i);

      const decrypted = await processor.decryptChunk(
        encrypted.encryptedData,
        encrypted.iv,
        i
      );

      const decryptedText = new TextDecoder().decode(decrypted);
      expect(decryptedText).toBe(originalData[i]);
    }
  });
});
