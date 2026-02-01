/**
 * MerkleTreeService Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MerkleTreeService } from '../MerkleTreeService.js';

describe('MerkleTreeService', () => {
  let tree;

  beforeEach(() => {
    tree = new MerkleTreeService();
  });

  it('should have null root when empty', () => {
    expect(tree.getRoot()).toBeNull();
  });

  it('should compute root after single insert', async () => {
    const leaf = await tree.computeLeaf({
      chunkIndex: 0,
      plaintextHash: 'a'.repeat(64),
      encryptedHash: 'b'.repeat(64),
      capturedAt: 1706900000000,
    });

    tree.insert(leaf);
    const root = tree.getRoot();

    expect(root).not.toBeNull();
    expect(root).toHaveLength(64); // 32 bytes as hex
  });

  it('should change root with each insert', async () => {
    const leaf1 = await tree.computeLeaf({
      chunkIndex: 0,
      plaintextHash: 'a'.repeat(64),
      encryptedHash: 'b'.repeat(64),
      capturedAt: 1706900000000,
    });
    tree.insert(leaf1);
    const root1 = tree.getRoot();

    const leaf2 = await tree.computeLeaf({
      chunkIndex: 1,
      plaintextHash: 'c'.repeat(64),
      encryptedHash: 'd'.repeat(64),
      capturedAt: 1706900010000,
    });
    tree.insert(leaf2);
    const root2 = tree.getRoot();

    expect(root2).not.toEqual(root1);
  });

  it('should generate valid proof for leaf', async () => {
    // Insert 5 leaves
    for (let i = 0; i < 5; i++) {
      const leaf = await tree.computeLeaf({
        chunkIndex: i,
        plaintextHash: `${i}`.repeat(64).slice(0, 64),
        encryptedHash: `${i + 10}`.repeat(64).slice(0, 64),
        capturedAt: 1706900000000 + i * 10000,
      });
      tree.insert(leaf);
    }

    const root = tree.getRoot();
    const proof = tree.getProof(2);

    expect(proof).toBeDefined();
    expect(proof.leaf).toBeDefined();
    expect(proof.siblings).toBeInstanceOf(Array);
    expect(proof.root).toEqual(root);
  });

  it('should verify valid proof', async () => {
    for (let i = 0; i < 5; i++) {
      const leaf = await tree.computeLeaf({
        chunkIndex: i,
        plaintextHash: `${i}`.repeat(64).slice(0, 64),
        encryptedHash: `${i + 10}`.repeat(64).slice(0, 64),
        capturedAt: 1706900000000 + i * 10000,
      });
      tree.insert(leaf);
    }

    const proof = tree.getProof(2);
    const isValid = await tree.verifyProof(proof);

    expect(isValid).toBe(true);
  });

  it('should return leaves as bytes32 hex', async () => {
    const leaf = await tree.computeLeaf({
      chunkIndex: 0,
      plaintextHash: 'a'.repeat(64),
      encryptedHash: 'b'.repeat(64),
      capturedAt: 1706900000000,
    });

    expect(leaf).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return root as bytes32 hex (no 0x prefix)', () => {
    // The contract expects bytes32 with 0x prefix, but we store without
    // and add prefix when calling contract
    tree.insert('a'.repeat(64));
    const root = tree.getRoot();

    expect(root).not.toMatch(/^0x/);
    expect(root).toHaveLength(64);
  });
});
