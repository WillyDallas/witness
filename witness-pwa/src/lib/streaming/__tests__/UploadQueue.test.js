/**
 * UploadQueue Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UploadQueue } from '../UploadQueue.js';

// Mock Dexie for testing
vi.mock('../streamingDb.js', () => {
  const mockDb = {
    pendingUploads: {
      add: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(1),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
  return { db: mockDb, default: mockDb };
});

describe('UploadQueue', () => {
  let queue;
  let mockProcessor;

  beforeEach(() => {
    mockProcessor = vi.fn().mockResolvedValue({ cid: 'QmTest123' });
    queue = new UploadQueue(mockProcessor);
  });

  afterEach(() => {
    queue.stop();
  });

  it('should enqueue task and return immediately', async () => {
    const task = {
      sessionId: 'session-1',
      chunkIndex: 0,
      blob: new Blob(['test']),
      capturedAt: Date.now(),
    };

    const id = await queue.enqueue(task);

    expect(id).toBeDefined();
    expect(typeof id).toBe('number');
  });

  it('should track queue status', async () => {
    const status = await queue.getStatus();

    expect(status).toHaveProperty('pending');
    expect(status).toHaveProperty('processing');
    expect(status).toHaveProperty('failed');
    expect(status).toHaveProperty('isProcessing');
  });

  it('should pause and resume processing', () => {
    queue.start();
    expect(queue.isRunning()).toBe(true);

    queue.pause();
    expect(queue.isRunning()).toBe(false);

    queue.resume();
    expect(queue.isRunning()).toBe(true);
  });

  it('should emit events on task completion', async () => {
    const onComplete = vi.fn();
    queue.on('complete', onComplete);

    // Simulate completion
    queue._emitComplete({ id: 1, cid: 'QmTest' });

    expect(onComplete).toHaveBeenCalledWith({ id: 1, cid: 'QmTest' });
  });

  it('should emit events on task failure', async () => {
    const onError = vi.fn();
    queue.on('error', onError);

    // Simulate error
    queue._emitError({ id: 1, error: new Error('Test error') });

    expect(onError).toHaveBeenCalled();
  });

  it('should respect max retries', () => {
    expect(queue.maxRetries).toBe(5);
  });
});
