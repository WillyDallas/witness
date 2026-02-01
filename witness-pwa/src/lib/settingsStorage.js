/**
 * Settings Storage Module
 * Manages persistent user settings including default recording groups
 */

const SETTINGS_KEY = 'witness_user_settings';

/**
 * Get all user settings
 * @returns {Object} Settings object with defaults
 */
export function getSettings() {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    const settings = data ? JSON.parse(data) : {};
    return {
      defaultGroupIds: settings.defaultGroupIds || [],
      ...settings
    };
  } catch {
    return { defaultGroupIds: [] };
  }
}

/**
 * Update user settings (partial update)
 * @param {Object} updates - Settings to update
 */
export function updateSettings(updates) {
  const current = getSettings();
  const merged = { ...current, ...updates };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
}

/**
 * Get default group IDs for recording
 * @returns {string[]} Array of group IDs
 */
export function getDefaultGroupIds() {
  return getSettings().defaultGroupIds;
}

/**
 * Set default group IDs for recording
 * @param {string[]} groupIds - Array of group IDs
 */
export function setDefaultGroupIds(groupIds) {
  updateSettings({ defaultGroupIds: groupIds });
}

/**
 * Check if user has configured default groups
 * @returns {boolean}
 */
export function hasDefaultGroups() {
  return getDefaultGroupIds().length > 0;
}
