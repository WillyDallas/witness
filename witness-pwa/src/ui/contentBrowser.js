/**
 * Content Browser UI for Witness Protocol
 * Displays content the user has access to with group filtering
 */

import { getAuthState } from '../lib/authState.js';
import { discoverContent, getGroupNames } from '../lib/contentDiscovery.js';
import { showContentDetail } from './contentDetail.js';

let modal = null;
let currentFilter = 'all'; // 'all', 'personal', or a groupId
let discoveredContent = null;
let groupNames = {};

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'content-browser-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content content-browser-modal">
      <div class="modal-header">
        <h2>Evidence</h2>
        <button class="modal-close" id="content-browser-close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Filter Tabs -->
        <div id="content-filter-tabs" class="filter-tabs">
          <button class="filter-tab active" data-filter="all">All</button>
          <button class="filter-tab" data-filter="personal">My Uploads</button>
          <!-- Group tabs added dynamically -->
        </div>

        <!-- Loading State -->
        <div id="content-loading" class="content-loading">
          <div class="spinner"></div>
          <p>Loading content...</p>
        </div>

        <!-- Content List -->
        <div id="content-list" class="content-list hidden"></div>

        <!-- Empty State -->
        <div id="content-empty" class="content-empty hidden">
          <div class="empty-icon">📭</div>
          <p>No content found</p>
          <p class="muted-small">Upload content or join a group to see shared evidence</p>
        </div>

        <!-- Error State -->
        <p id="content-error" class="error-text hidden"></p>
      </div>
    </div>
  `;
  return div;
}

/**
 * Render filter tabs including groups
 */
function renderFilterTabs() {
  const tabsEl = document.getElementById('content-filter-tabs');

  // Get unique group IDs from content
  const groupIds = new Set();
  if (discoveredContent) {
    for (const item of discoveredContent.all) {
      item.groupIds.forEach(gid => groupIds.add(gid));
    }
  }

  // Build tabs HTML
  let html = `
    <button class="filter-tab ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
    <button class="filter-tab ${currentFilter === 'personal' ? 'active' : ''}" data-filter="personal">My Uploads</button>
  `;

  for (const groupId of groupIds) {
    const name = groupNames[groupId] || groupId.slice(0, 8) + '...';
    const isActive = currentFilter === groupId ? 'active' : '';
    html += `<button class="filter-tab ${isActive}" data-filter="${groupId}">${escapeHtml(name)}</button>`;
  }

  tabsEl.innerHTML = html;

  // Add click handlers
  tabsEl.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter;
      renderFilterTabs();
      renderContentList();
    });
  });
}

/**
 * Get filtered content based on current filter
 */
function getFilteredContent() {
  if (!discoveredContent) return [];

  if (currentFilter === 'all') {
    return discoveredContent.all;
  }

  if (currentFilter === 'personal') {
    return discoveredContent.personal;
  }

  // Group filter
  return discoveredContent.byGroup[currentFilter] || [];
}

/**
 * Render the content list
 */
function renderContentList() {
  const listEl = document.getElementById('content-list');
  const emptyEl = document.getElementById('content-empty');

  const items = getFilteredContent();

  if (items.length === 0) {
    listEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');

  const { smartAccountAddress } = getAuthState();
  const userAddress = smartAccountAddress?.toLowerCase();

  listEl.innerHTML = items.map(item => {
    const date = new Date(item.timestamp * 1000);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isOwn = item.uploader.toLowerCase() === userAddress;
    const uploaderDisplay = isOwn ? 'You' : item.uploader.slice(0, 6) + '...' + item.uploader.slice(-4);

    // Get group names for this item
    const itemGroups = item.groupIds.map(gid => groupNames[gid] || gid.slice(0, 8)).join(', ');

    return `
      <div class="content-item" data-content-id="${item.contentId}">
        <div class="content-item-icon">📹</div>
        <div class="content-item-info">
          <div class="content-item-date">${dateStr}</div>
          <div class="content-item-meta">
            <span class="content-item-groups">${escapeHtml(itemGroups || 'Personal')}</span>
            <span class="content-item-uploader">by ${escapeHtml(uploaderDisplay)}</span>
          </div>
        </div>
        <div class="content-item-arrow">›</div>
      </div>
    `;
  }).join('');

  // Add click handlers
  listEl.querySelectorAll('.content-item').forEach(el => {
    el.addEventListener('click', () => {
      const contentId = el.dataset.contentId;
      const item = items.find(i => i.contentId === contentId);
      if (item) {
        showContentDetail(item);
      }
    });
  });
}

/**
 * Load content
 */
async function loadContent(forceRefresh = false) {
  const loadingEl = document.getElementById('content-loading');
  const listEl = document.getElementById('content-list');
  const emptyEl = document.getElementById('content-empty');
  const errorEl = document.getElementById('content-error');

  loadingEl.classList.remove('hidden');
  listEl.classList.add('hidden');
  emptyEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    discoveredContent = await discoverContent(forceRefresh);

    // Get group names
    const allGroupIds = new Set();
    discoveredContent.all.forEach(item => {
      item.groupIds.forEach(gid => allGroupIds.add(gid));
    });
    groupNames = await getGroupNames([...allGroupIds]);

    loadingEl.classList.add('hidden');
    renderFilterTabs();
    renderContentList();
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = 'Error loading content: ' + err.message;
    errorEl.classList.remove('hidden');
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show the content browser modal
 */
export function showContentBrowser() {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    document.getElementById('content-browser-close').addEventListener('click', hideContentBrowser);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideContentBrowser();
    });
  }

  // Reset state
  currentFilter = 'all';
  discoveredContent = null;

  modal.classList.remove('hidden');
  loadContent(true);
}

/**
 * Hide the content browser modal
 */
export function hideContentBrowser() {
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * Refresh content list (called after new upload)
 */
export function refreshContentBrowser() {
  if (modal && !modal.classList.contains('hidden')) {
    loadContent(true);
  }
}
