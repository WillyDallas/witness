import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock CaptureService
const mockCaptureService = {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    getStream: vi.fn(() => ({ getTracks: () => [] })),
    isRecording: vi.fn(() => false)
};

// Mock SessionManager
const mockSessionManager = {
    sessionId: 'session-123',
    endSession: vi.fn(() => Promise.resolve()),
    getChunkCount: vi.fn(() => 0),
    getStatus: vi.fn(() => 'recording'),
    isActive: vi.fn(() => true)
};

vi.mock('../../lib/streaming/SessionManager.js', () => ({
    SessionManager: {
        create: vi.fn(() => Promise.resolve(mockSessionManager))
    },
    createWiredCapture: vi.fn(() => Promise.resolve(mockCaptureService))
}));

vi.mock('../../lib/authState.js', () => ({
    getAuthState: vi.fn(() => ({ encryptionKey: 'mock-key' })),
    getAddress: vi.fn(() => '0x1234567890123456789012345678901234567890'),
    getEncryptionKey: vi.fn(() => ({ type: 'secret' }))
}));

describe('recordingScreen', () => {
    beforeEach(() => {
        // Set up DOM
        document.body.innerHTML = `
            <div id="recording-screen" class="hidden">
                <video id="recording-preview"></video>
                <span id="recording-time">0:00</span>
                <span id="chunk-count">0</span>
                <div id="chunk-status" class="chunk-status"><span class="chunk-icon">✓</span></div>
                <button id="stop-recording-btn"></button>
            </div>
            <div id="recording-summary" class="hidden">
                <h3 id="summary-title"></h3>
                <p id="summary-details"></p>
                <button id="view-recording-btn"></button>
                <button id="dismiss-summary-btn"></button>
            </div>
        `;
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should export startRecordingScreen function', async () => {
        const { startRecordingScreen } = await import('../recordingScreen.js');
        expect(typeof startRecordingScreen).toBe('function');
    });

    it('should show recording screen when started', async () => {
        const { startRecordingScreen } = await import('../recordingScreen.js');

        await startRecordingScreen(['group1']);

        const screen = document.getElementById('recording-screen');
        expect(screen.classList.contains('hidden')).toBe(false);
    });

    it('should format time correctly', async () => {
        const { formatTime } = await import('../recordingScreen.js');

        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(65)).toBe('1:05');
        expect(formatTime(3661)).toBe('61:01');
    });
});
