import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../lib/authState.js', () => ({
    getAuthState: vi.fn(() => ({ encryptionKey: 'mock-key' }))
}));

vi.mock('../../lib/groups.js', () => ({
    getMyGroups: vi.fn(() => Promise.resolve([
        { groupId: 'group1', name: 'Family', isCreator: true },
        { groupId: 'group2', name: 'Work', isCreator: false }
    ]))
}));

describe('recordingGroupSelect', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        // Reset module state between tests
        vi.resetModules();
    });

    it('should export showRecordingGroupSelect function', async () => {
        const { showRecordingGroupSelect } = await import('../recordingGroupSelect.js');
        expect(typeof showRecordingGroupSelect).toBe('function');
    });

    it('should render group checkboxes', async () => {
        const { showRecordingGroupSelect } = await import('../recordingGroupSelect.js');

        await showRecordingGroupSelect();

        const checkboxes = document.querySelectorAll('.group-check-input');
        expect(checkboxes.length).toBe(2);
    });

    it('should call onConfirm with selected group IDs', async () => {
        const { showRecordingGroupSelect } = await import('../recordingGroupSelect.js');
        const onConfirm = vi.fn();

        await showRecordingGroupSelect(onConfirm);

        // Select first group and dispatch change event to enable the start button
        const checkbox = document.querySelector('.group-check-input');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));

        // Click start button
        const startBtn = document.getElementById('start-recording-btn');
        startBtn.click();

        expect(onConfirm).toHaveBeenCalledWith(['group1']);
    });
});
