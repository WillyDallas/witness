/**
 * UploadQueue
 * Persistent queue for chunk uploads with retry logic
 * Never blocks - returns immediately, processes asynchronously
 */
import { db } from './streamingDb.js';

/**
 * @typedef {Object} UploadTask
 * @property {string} sessionId - Recording session ID
 * @property {number} chunkIndex - Chunk index in session
 * @property {Blob} blob - Raw video blob
 * @property {number} capturedAt - Capture timestamp
 */

/**
 * @typedef {Object} QueueStatus
 * @property {number} pending - Tasks waiting to process
 * @property {number} processing - Currently processing
 * @property {number} failed - Failed after max retries
 * @property {boolean} isProcessing - Whether queue is actively processing
 */

export class UploadQueue {
  /**
   * @param {Function} processor - Async function to process a task
   * @param {Object} options - Queue options
   * @param {number} [options.maxRetries=5] - Max retry attempts
   * @param {number} [options.baseDelay=1000] - Base delay for exponential backoff (ms)
   * @param {number} [options.maxDelay=30000] - Max delay between retries (ms)
   */
  constructor(processor, options = {}) {
    this.processor = processor;
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelay = options.baseDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 30000;

    this._running = false;
    this._processing = false;
    this._listeners = new Map();
    this._currentTaskId = null;
  }

  /**
   * Add task to queue (never blocks)
   * @param {UploadTask} task - Task to enqueue
   * @returns {Promise<number>} Task ID
   */
  async enqueue(task) {
    const record = {
      sessionId: task.sessionId,
      chunkIndex: task.chunkIndex,
      status: 'pending',
      rawBlob: task.blob,
      capturedAt: task.capturedAt,
      retryCount: 0,
    };

    const id = await db.pendingUploads.add(record);
    console.log(`[UploadQueue] Enqueued task ${id} for chunk ${task.chunkIndex}`);

    // Trigger processing if running
    if (this._running && !this._processing) {
      this._processNext();
    }

    return id;
  }

  /**
   * Start queue processing
   */
  start() {
    this._running = true;
    console.log('[UploadQueue] Started');
    this._processNext();
  }

  /**
   * Stop queue processing (current task will complete)
   */
  stop() {
    this._running = false;
    console.log('[UploadQueue] Stopped');
  }

  /**
   * Pause processing (alias for stop)
   */
  pause() {
    this.stop();
  }

  /**
   * Resume processing (alias for start)
   */
  resume() {
    this.start();
  }

  /**
   * Check if queue is running
   * @returns {boolean}
   */
  isRunning() {
    return this._running;
  }

  /**
   * Get queue status
   * @returns {Promise<QueueStatus>}
   */
  async getStatus() {
    const pending = await db.pendingUploads
      .where('status')
      .equals('pending')
      .toArray();

    const failed = await db.pendingUploads
      .where('status')
      .equals('failed')
      .toArray();

    return {
      pending: pending.length,
      processing: this._processing ? 1 : 0,
      failed: failed.length,
      isProcessing: this._processing,
    };
  }

  /**
   * Get pending tasks for a session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>}
   */
  async getSessionTasks(sessionId) {
    return db.pendingUploads
      .where('sessionId')
      .equals(sessionId)
      .toArray();
  }

  /**
   * Register event listener
   * @param {'complete'|'error'|'retry'} event - Event type
   * @param {Function} callback - Event handler
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   * @param {'complete'|'error'|'retry'} event - Event type
   * @param {Function} callback - Event handler to remove
   */
  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Process next pending task
   * @private
   */
  async _processNext() {
    if (!this._running || this._processing) return;

    // Get oldest pending task
    const tasks = await db.pendingUploads
      .where('status')
      .equals('pending')
      .toArray();

    if (tasks.length === 0) return;

    // Sort by chunk index to maintain order
    tasks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const task = tasks[0];

    this._processing = true;
    this._currentTaskId = task.id;

    try {
      // Update status
      await db.pendingUploads.update(task.id, { status: 'uploading' });

      // Process the task
      const result = await this.processor({
        sessionId: task.sessionId,
        chunkIndex: task.chunkIndex,
        blob: task.rawBlob,
        capturedAt: task.capturedAt,
      });

      // Mark as complete
      await db.pendingUploads.update(task.id, {
        status: 'uploaded',
        cid: result.cid,
        plaintextHash: result.plaintextHash,
        encryptedHash: result.encryptedHash,
        iv: result.iv,
        uploadedAt: Date.now(),
        rawBlob: null, // Clear blob to save space
      });

      this._emitComplete({ id: task.id, ...result });
      console.log(`[UploadQueue] Completed task ${task.id}`);

    } catch (error) {
      console.error(`[UploadQueue] Task ${task.id} failed:`, error.message);
      await this._handleError(task, error);
    } finally {
      this._processing = false;
      this._currentTaskId = null;

      // Process next if still running
      if (this._running) {
        setTimeout(() => this._processNext(), 100);
      }
    }
  }

  /**
   * Handle task error with retry logic
   * @private
   */
  async _handleError(task, error) {
    const newRetryCount = task.retryCount + 1;

    if (newRetryCount >= this.maxRetries) {
      // Max retries exceeded
      await db.pendingUploads.update(task.id, {
        status: 'failed',
        retryCount: newRetryCount,
        lastError: error.message,
      });
      this._emitError({ id: task.id, error, retries: newRetryCount });
      console.error(`[UploadQueue] Task ${task.id} failed permanently after ${newRetryCount} retries`);
    } else {
      // Schedule retry with exponential backoff
      const delay = Math.min(
        this.baseDelay * Math.pow(2, newRetryCount - 1),
        this.maxDelay
      );

      await db.pendingUploads.update(task.id, {
        status: 'pending',
        retryCount: newRetryCount,
        lastError: error.message,
      });

      this._emit('retry', { id: task.id, retryCount: newRetryCount, delay });
      console.log(`[UploadQueue] Task ${task.id} will retry in ${delay}ms (attempt ${newRetryCount})`);

      // Schedule next processing after delay
      setTimeout(() => {
        if (this._running) this._processNext();
      }, delay);
    }
  }

  /**
   * Emit event to listeners
   * @private
   */
  _emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`[UploadQueue] Event listener error:`, e);
        }
      });
    }
  }

  /** @private */
  _emitComplete(data) {
    this._emit('complete', data);
  }

  /** @private */
  _emitError(data) {
    this._emit('error', data);
  }
}

export default UploadQueue;
