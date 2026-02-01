# Phase 6: Content Discovery & Decryption Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to discover, download, decrypt, and view content shared with their groups, with Merkle proof verification.

**Architecture:** Query on-chain indexes for content IDs, fetch manifests from IPFS, unwrap content keys using group secrets, download and decrypt chunks, verify integrity against on-chain Merkle root. Provide a content browser UI with group filtering and detail views.

**Tech Stack:** Pinata SDK (IPFS downloads), Web Crypto API (AES-256-GCM decryption, key unwrapping), existing contract.js (on-chain queries), existing encryption.js (unwrapContentKey, decrypt)

---

## Documentation Verification (Context7 Research)

**Verified against Pinata SDK** (`/pinatacloud/docs` - 1187 snippets, Benchmark 72.8):

| Feature | Verification | Source |
|---------|--------------|--------|
| Download by CID | `await pinata.gateways.public.get(cid)` returns `{ data, contentType }` | Context7 examples |
| Convert to URL | `await pinata.gateways.public.convert(cid)` returns gateway URL | Context7 examples |
| Direct URL pattern | `https://${gateway}/ipfs/${cid}` | Context7 examples |

**Key Implementation Notes:**
- `gateways.public.get(cid)` returns an object with `data` and `contentType` properties
- For binary data (encrypted chunks), `data` will be the raw content
- For JSON (manifests), `data` will be the parsed object
- Gateway URLs can be constructed manually without SDK call

---

## Prerequisites

- Phase 5 complete (content upload to IPFS + on-chain commit)
- Pinata SDK configured in `.env`
- At least one group with uploaded content for testing

## Current State Analysis

**Already Implemented (from Phase 5 plan):**
- `ipfs.js`: `uploadEncryptedData()`, `uploadManifest()`, `downloadContent()`, `getGatewayUrl()`
- `merkle.js`: `computeMerkleRoot()`, `hashContent()`
- `content.js`: `uploadContent()` (upload flow only)
- `contract.js`: `getContent()`, `getUserContent()`, `getGroupContent()`
- `encryption.js`: `unwrapContentKey()`, `decrypt()`, `hexToBytes()`
- `storage.js`: `getGroupSecrets()`, `getGroupSecret()`

**Missing (this phase):**
- Content discovery service (aggregate from user + all groups)
- Download and decrypt flow
- Merkle verification utility
- Content list UI component
- Content detail view modal
- Group filter tabs

---

### Task 1: Extend IPFS Service with Better Download Handling

**Files:**
- Modify: `witness-pwa/src/lib/ipfs.js`

**Step 1: Update downloadContent to handle different response types**

The current `downloadContent` function needs to better handle the Pinata SDK response structure. Replace the `downloadContent` function:

```javascript
/**
 * Download content from IPFS
 * @param {string} cid - Content ID to download
 * @returns {Promise<ArrayBuffer|object>} Raw bytes for binary, parsed object for JSON
 */
export async function downloadContent(cid) {
  const sdk = getPinata();

  try {
    const response = await sdk.gateways.public.get(cid);
    console.log('[ipfs] Downloaded:', cid.slice(0, 12) + '...');

    // Pinata SDK returns { data, contentType }
    if (response && response.data !== undefined) {
      return response.data;
    }

    // Fallback: response might be the data directly
    if (response instanceof ArrayBuffer) {
      return response;
    }

    if (response instanceof Blob) {
      return await response.arrayBuffer();
    }

    // Object response (JSON manifests)
    if (typeof response === 'object') {
      return response;
    }

    throw new Error('Unexpected response type from gateway');
  } catch (err) {
    console.error('[ipfs] Download failed:', err);
    throw new Error('Failed to download from IPFS: ' + err.message);
  }
}

/**
 * Download manifest JSON from IPFS
 * @param {string} cid - Manifest CID
 * @returns {Promise<object>} Parsed manifest object
 */
export async function downloadManifest(cid) {
  const data = await downloadContent(cid);

  // If already parsed as object, return directly
  if (typeof data === 'object' && data !== null && !(data instanceof ArrayBuffer)) {
    return data;
  }

  // If ArrayBuffer, parse as JSON
  if (data instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(data);
    return JSON.parse(text);
  }

  throw new Error('Unexpected manifest data type');
}

/**
 * Download encrypted binary content from IPFS
 * @param {string} cid - Content CID
 * @returns {Promise<Uint8Array>} Encrypted bytes
 */
export async function downloadEncryptedContent(cid) {
  const data = await downloadContent(cid);

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (data instanceof Uint8Array) {
    return data;
  }

  // If it's a Blob or other type, try to get ArrayBuffer
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  throw new Error('Unexpected encrypted content data type');
}
```

**Step 2: Verify the changes compile**

```bash
cd witness-pwa && npm run dev
```

Open browser, check no import errors in console.

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/ipfs.js
git commit -m "feat(ipfs): add downloadManifest and downloadEncryptedContent helpers"
```

---

### Task 2: Create Content Discovery Service

**Files:**
- Create: `witness-pwa/src/lib/contentDiscovery.js`

**Step 1: Write the content discovery service**

```javascript
/**
 * Content Discovery Service for Witness Protocol
 * Aggregates content from user uploads and group memberships
 */

import { getAuthState } from './authState.js';
import { getUserContent, getGroupContent, getContent } from './contract.js';
import { getGroupSecrets } from './storage.js';
import { downloadManifest } from './ipfs.js';

/**
 * @typedef {Object} ContentItem
 * @property {string} contentId - On-chain content ID
 * @property {string} merkleRoot - On-chain Merkle root
 * @property {string} manifestCID - IPFS CID of manifest
 * @property {string} uploader - Uploader address
 * @property {number} timestamp - Unix timestamp
 * @property {string[]} groupIds - Groups this content is shared with (that user has access to)
 * @property {object|null} manifest - Cached manifest (if fetched)
 */

/**
 * @typedef {Object} DiscoveredContent
 * @property {ContentItem[]} all - All content user has access to
 * @property {ContentItem[]} personal - Content uploaded by current user
 * @property {Record<string, ContentItem[]>} byGroup - Content organized by group ID
 */

// Local cache for discovered content
let contentCache = {
  items: {},        // contentId -> ContentItem
  lastRefresh: 0,
};

const CACHE_TTL = 60000; // 1 minute cache

/**
 * Discover all content the user has access to
 * @param {boolean} forceRefresh - Force refresh even if cached
 * @returns {Promise<DiscoveredContent>}
 */
export async function discoverContent(forceRefresh = false) {
  const { smartAccountAddress, encryptionKey } = getAuthState();

  if (!smartAccountAddress || !encryptionKey) {
    return { all: [], personal: [], byGroup: {} };
  }

  // Check cache
  const now = Date.now();
  if (!forceRefresh && (now - contentCache.lastRefresh) < CACHE_TTL) {
    return organizeContent(Object.values(contentCache.items), smartAccountAddress);
  }

  console.log('[discovery] Refreshing content...');

  try {
    // Get user's groups
    const groupSecrets = await getGroupSecrets(encryptionKey);
    const groupIds = Object.keys(groupSecrets);

    // Collect all content IDs (deduplicated)
    const contentIds = new Set();

    // 1. Get user's own content
    const userContentIds = await getUserContent(smartAccountAddress);
    userContentIds.forEach(id => contentIds.add(id));

    // 2. Get content from each group
    const groupContentMap = {};
    for (const groupId of groupIds) {
      const groupContentIds = await getGroupContent(groupId);
      groupContentMap[groupId] = groupContentIds;
      groupContentIds.forEach(id => contentIds.add(id));
    }

    // 3. Fetch on-chain details for each content
    const items = {};
    for (const contentId of contentIds) {
      try {
        const onChainData = await getContent(contentId);

        // Skip if no data (content doesn't exist)
        if (!onChainData.manifestCID) continue;

        // Determine which groups this content belongs to (that user has access to)
        const accessibleGroups = groupIds.filter(gid =>
          groupContentMap[gid]?.includes(contentId)
        );

        items[contentId] = {
          contentId,
          merkleRoot: onChainData.merkleRoot,
          manifestCID: onChainData.manifestCID,
          uploader: onChainData.uploader,
          timestamp: Number(onChainData.timestamp),
          groupIds: accessibleGroups,
          manifest: null,
        };
      } catch (err) {
        console.warn('[discovery] Failed to fetch content:', contentId.slice(0, 18), err.message);
      }
    }

    // Update cache
    contentCache.items = items;
    contentCache.lastRefresh = now;

    console.log('[discovery] Found', Object.keys(items).length, 'content items');

    return organizeContent(Object.values(items), smartAccountAddress);
  } catch (err) {
    console.error('[discovery] Error discovering content:', err);
    throw err;
  }
}

/**
 * Organize content into categories
 * @param {ContentItem[]} items - All content items
 * @param {string} userAddress - Current user's address
 * @returns {DiscoveredContent}
 */
function organizeContent(items, userAddress) {
  const normalized = userAddress.toLowerCase();

  // Sort by timestamp descending (newest first)
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);

  // Personal content (uploaded by user)
  const personal = sorted.filter(item =>
    item.uploader.toLowerCase() === normalized
  );

  // Organize by group
  const byGroup = {};
  for (const item of sorted) {
    for (const groupId of item.groupIds) {
      if (!byGroup[groupId]) {
        byGroup[groupId] = [];
      }
      byGroup[groupId].push(item);
    }
  }

  return {
    all: sorted,
    personal,
    byGroup,
  };
}

/**
 * Get a single content item with manifest
 * @param {string} contentId - Content ID to fetch
 * @returns {Promise<ContentItem|null>}
 */
export async function getContentItem(contentId) {
  // Check cache first
  if (contentCache.items[contentId]) {
    const item = contentCache.items[contentId];

    // Fetch manifest if not cached
    if (!item.manifest) {
      try {
        item.manifest = await downloadManifest(item.manifestCID);
      } catch (err) {
        console.warn('[discovery] Failed to fetch manifest:', err.message);
      }
    }

    return item;
  }

  // Fetch from chain
  try {
    const onChainData = await getContent(contentId);
    if (!onChainData.manifestCID) return null;

    const manifest = await downloadManifest(onChainData.manifestCID);

    const item = {
      contentId,
      merkleRoot: onChainData.merkleRoot,
      manifestCID: onChainData.manifestCID,
      uploader: onChainData.uploader,
      timestamp: Number(onChainData.timestamp),
      groupIds: Object.keys(manifest.accessList || {}),
      manifest,
    };

    // Cache it
    contentCache.items[contentId] = item;

    return item;
  } catch (err) {
    console.error('[discovery] Failed to get content item:', err);
    return null;
  }
}

/**
 * Clear the content cache
 */
export function clearContentCache() {
  contentCache.items = {};
  contentCache.lastRefresh = 0;
}

/**
 * Get group names for display
 * @param {string[]} groupIds - Group IDs
 * @returns {Promise<Record<string, string>>} Map of groupId to name
 */
export async function getGroupNames(groupIds) {
  const { encryptionKey } = getAuthState();
  if (!encryptionKey) return {};

  const secrets = await getGroupSecrets(encryptionKey);
  const names = {};

  for (const groupId of groupIds) {
    const stored = secrets[groupId];
    names[groupId] = stored?.name || groupId.slice(0, 10) + '...';
  }

  return names;
}
```

**Step 2: Verify service loads**

```bash
cd witness-pwa && npm run dev
```

In browser console:
```javascript
import { discoverContent } from './src/lib/contentDiscovery.js';
console.log('Discovery service loaded:', typeof discoverContent === 'function');
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/contentDiscovery.js
git commit -m "feat(discovery): add content discovery service for aggregating accessible content"
```

---

### Task 3: Create Content Decryption Service

**Files:**
- Create: `witness-pwa/src/lib/contentDecrypt.js`

**Step 1: Write the content decryption service**

```javascript
/**
 * Content Decryption Service for Witness Protocol
 * Downloads encrypted content from IPFS and decrypts using group secrets
 */

import { getAuthState } from './authState.js';
import { getGroupSecrets } from './storage.js';
import { downloadEncryptedContent, downloadManifest } from './ipfs.js';
import { unwrapContentKey, decrypt, hexToBytes } from './encryption.js';
import { computeMerkleRoot, hashContent } from './merkle.js';

/**
 * @typedef {Object} DecryptedContent
 * @property {Uint8Array} data - Decrypted content bytes
 * @property {string} contentId - Content ID
 * @property {boolean} verified - Whether Merkle proof verified
 * @property {object} manifest - Full manifest
 */

/**
 * @typedef {Object} DecryptProgress
 * @property {'fetching_manifest'|'fetching_content'|'decrypting'|'verifying'|'done'|'error'} step
 * @property {number} progress - 0-100
 * @property {string} message
 */

/**
 * Download and decrypt content
 * @param {string} contentId - Content ID to decrypt
 * @param {string} manifestCID - IPFS CID of manifest
 * @param {string} onChainMerkleRoot - Merkle root from on-chain (for verification)
 * @param {function(DecryptProgress): void} onProgress - Progress callback
 * @returns {Promise<DecryptedContent>}
 */
export async function downloadAndDecrypt(contentId, manifestCID, onChainMerkleRoot, onProgress = () => {}) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  try {
    // Step 1: Fetch manifest
    onProgress({ step: 'fetching_manifest', progress: 10, message: 'Fetching manifest...' });

    const manifest = await downloadManifest(manifestCID);
    console.log('[decrypt] Manifest loaded:', manifest.contentId?.slice(0, 18));

    // Step 2: Find a group secret we have access to
    onProgress({ step: 'fetching_content', progress: 20, message: 'Finding access key...' });

    const groupSecrets = await getGroupSecrets(encryptionKey);
    const accessList = manifest.accessList || {};

    let contentKey = null;
    let accessGroupId = null;

    for (const groupId of Object.keys(accessList)) {
      const secretData = groupSecrets[groupId];
      if (secretData) {
        try {
          const groupSecret = hexToBytes(secretData.secretHex);
          const wrapped = accessList[groupId];
          const wrapIv = hexToBytes(wrapped.iv);
          const wrappedKeyBytes = hexToBytes(wrapped.wrappedKey);

          contentKey = await unwrapContentKey(wrapIv, wrappedKeyBytes.buffer, groupSecret);
          accessGroupId = groupId;
          console.log('[decrypt] Unwrapped key using group:', groupId.slice(0, 18));
          break;
        } catch (err) {
          console.warn('[decrypt] Failed to unwrap with group:', groupId.slice(0, 18), err.message);
        }
      }
    }

    if (!contentKey) {
      throw new Error('No access: you are not a member of any group this content is shared with');
    }

    // Step 3: Download encrypted chunks
    onProgress({ step: 'fetching_content', progress: 40, message: 'Downloading encrypted content...' });

    const chunks = manifest.chunks || [];
    if (chunks.length === 0) {
      throw new Error('No content chunks in manifest');
    }

    // For now, we support single-chunk content (Phase 5 uploads)
    // Multi-chunk support would iterate and concatenate
    const chunk = chunks[0];
    const encryptedData = await downloadEncryptedContent(chunk.cid);

    console.log('[decrypt] Downloaded encrypted content:', encryptedData.length, 'bytes');

    // Step 4: Verify Merkle root
    onProgress({ step: 'verifying', progress: 60, message: 'Verifying integrity...' });

    const chunkHash = await hashContent(encryptedData);
    const computedRoot = await computeMerkleRoot([chunkHash]);

    // Compare with on-chain root (remove 0x prefix if present)
    const cleanOnChainRoot = onChainMerkleRoot.startsWith('0x')
      ? onChainMerkleRoot.slice(2)
      : onChainMerkleRoot;
    const cleanComputedRoot = computedRoot.startsWith('0x')
      ? computedRoot.slice(2)
      : computedRoot;

    const verified = cleanComputedRoot.toLowerCase() === cleanOnChainRoot.toLowerCase();

    if (!verified) {
      console.warn('[decrypt] Merkle root mismatch!');
      console.warn('[decrypt] On-chain:', cleanOnChainRoot);
      console.warn('[decrypt] Computed:', cleanComputedRoot);
    } else {
      console.log('[decrypt] Merkle root verified ✓');
    }

    // Step 5: Decrypt content
    onProgress({ step: 'decrypting', progress: 80, message: 'Decrypting content...' });

    const encryptionIv = hexToBytes(manifest.encryption.iv);
    const decryptedBuffer = await decrypt(encryptionIv, encryptedData.buffer, contentKey);
    const decryptedData = new Uint8Array(decryptedBuffer);

    console.log('[decrypt] Decrypted:', decryptedData.length, 'bytes');

    // Done!
    onProgress({ step: 'done', progress: 100, message: 'Content ready' });

    return {
      data: decryptedData,
      contentId,
      verified,
      manifest,
    };
  } catch (err) {
    onProgress({ step: 'error', progress: 0, message: err.message });
    throw err;
  }
}

/**
 * Check if user has access to decrypt content
 * @param {object} manifest - Content manifest
 * @returns {Promise<boolean>}
 */
export async function canDecrypt(manifest) {
  const { encryptionKey } = getAuthState();
  if (!encryptionKey) return false;

  const groupSecrets = await getGroupSecrets(encryptionKey);
  const accessList = manifest.accessList || {};

  for (const groupId of Object.keys(accessList)) {
    if (groupSecrets[groupId]) {
      return true;
    }
  }

  return false;
}

/**
 * Convert decrypted bytes to a data URL for display
 * @param {Uint8Array} data - Decrypted content bytes
 * @param {string} mimeType - MIME type (e.g., 'text/plain', 'video/webm')
 * @returns {string} Data URL
 */
export function toDataUrl(data, mimeType = 'application/octet-stream') {
  const blob = new Blob([data], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Try to determine content type from manifest or data
 * @param {object} manifest - Content manifest
 * @param {Uint8Array} data - Decrypted data
 * @returns {string} MIME type
 */
export function detectContentType(manifest, data) {
  // Check manifest metadata
  if (manifest.metadata?.mimeType) {
    return manifest.metadata.mimeType;
  }

  // Try to detect from data
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return 'image/png';
  }

  // JPEG signature: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return 'image/jpeg';
  }

  // WebM signature: 1A 45 DF A3
  if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) {
    return 'video/webm';
  }

  // MP4/MOV: starts with ftyp
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return 'video/mp4';
  }

  // Default to text for test content
  try {
    new TextDecoder().decode(data.slice(0, 100));
    return 'text/plain';
  } catch {
    return 'application/octet-stream';
  }
}
```

**Step 2: Verify service loads**

```bash
cd witness-pwa && npm run dev
```

In browser console:
```javascript
import { downloadAndDecrypt } from './src/lib/contentDecrypt.js';
console.log('Decrypt service loaded:', typeof downloadAndDecrypt === 'function');
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/contentDecrypt.js
git commit -m "feat(decrypt): add content decryption service with Merkle verification"
```

---

### Task 4: Create Content List UI Component

**Files:**
- Create: `witness-pwa/src/ui/contentBrowser.js`

**Step 1: Write the content browser modal**

```javascript
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
```

**Step 2: Verify modal creates**

```bash
cd witness-pwa && npm run dev
```

In browser console:
```javascript
import { showContentBrowser } from './src/ui/contentBrowser.js';
showContentBrowser();
```

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/contentBrowser.js
git commit -m "feat(ui): add content browser modal with group filtering"
```

---

### Task 5: Create Content Detail View

**Files:**
- Create: `witness-pwa/src/ui/contentDetail.js`

**Step 1: Write the content detail modal**

```javascript
/**
 * Content Detail View for Witness Protocol
 * Shows content with decryption and verification
 */

import { getAuthState } from '../lib/authState.js';
import { getContentItem, getGroupNames } from '../lib/contentDiscovery.js';
import { downloadAndDecrypt, toDataUrl, detectContentType } from '../lib/contentDecrypt.js';

let modal = null;
let currentItem = null;
let decryptedUrl = null;

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'content-detail-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content content-detail-modal">
      <div class="modal-header">
        <button class="modal-back" id="content-detail-back">← Back</button>
        <h2>Evidence Detail</h2>
        <div style="width: 60px;"></div>
      </div>

      <div class="modal-body">
        <!-- Content Preview -->
        <div id="content-preview" class="content-preview">
          <div id="preview-loading" class="preview-loading">
            <div class="spinner"></div>
            <p id="preview-status">Loading...</p>
          </div>
          <div id="preview-content" class="preview-content hidden"></div>
          <div id="preview-error" class="preview-error hidden"></div>
        </div>

        <!-- Metadata -->
        <div id="content-metadata" class="content-metadata">
          <div class="metadata-row">
            <span class="metadata-label">Uploaded</span>
            <span id="meta-date" class="metadata-value">-</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">By</span>
            <span id="meta-uploader" class="metadata-value">-</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">Shared with</span>
            <span id="meta-groups" class="metadata-value">-</span>
          </div>
        </div>

        <!-- Verification Status -->
        <div id="verification-status" class="verification-status">
          <div class="verification-header">Verification</div>
          <div id="verification-details" class="verification-details">
            <div class="verification-row" id="verify-merkle">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">Merkle proof</span>
            </div>
            <div class="verification-row" id="verify-chain">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">On-chain record</span>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="content-actions">
          <a id="basescan-link" href="#" target="_blank" class="btn btn-secondary btn-full">
            View on Basescan 🔗
          </a>
        </div>
      </div>
    </div>
  `;
  return div;
}

/**
 * Format date for display
 */
function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Update verification UI
 */
function updateVerification(merkleValid, onChain) {
  const merkleEl = document.getElementById('verify-merkle');
  const chainEl = document.getElementById('verify-chain');

  merkleEl.innerHTML = `
    <span class="verify-icon">${merkleValid ? '✅' : '❌'}</span>
    <span class="verify-text">Merkle proof ${merkleValid ? 'valid' : 'INVALID'}</span>
  `;

  chainEl.innerHTML = `
    <span class="verify-icon">${onChain ? '✅' : '⏳'}</span>
    <span class="verify-text">On-chain since block ${onChain || 'unknown'}</span>
  `;
}

/**
 * Render content preview based on type
 */
function renderPreview(data, mimeType) {
  const previewEl = document.getElementById('preview-content');

  // Clean up previous URL
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
  }

  if (mimeType.startsWith('text/')) {
    // Text content
    const text = new TextDecoder().decode(data);
    previewEl.innerHTML = `<pre class="text-preview">${escapeHtml(text)}</pre>`;
  } else if (mimeType.startsWith('image/')) {
    // Image content
    decryptedUrl = toDataUrl(data, mimeType);
    previewEl.innerHTML = `<img src="${decryptedUrl}" class="image-preview" alt="Decrypted content" />`;
  } else if (mimeType.startsWith('video/')) {
    // Video content
    decryptedUrl = toDataUrl(data, mimeType);
    previewEl.innerHTML = `
      <video controls class="video-preview">
        <source src="${decryptedUrl}" type="${mimeType}" />
        Your browser does not support video playback.
      </video>
    `;
  } else {
    // Unknown type - show download option
    decryptedUrl = toDataUrl(data, mimeType);
    previewEl.innerHTML = `
      <div class="binary-preview">
        <p>Binary content (${data.length} bytes)</p>
        <a href="${decryptedUrl}" download="decrypted-content" class="btn btn-primary">
          Download
        </a>
      </div>
    `;
  }

  previewEl.classList.remove('hidden');
}

/**
 * Load and display content
 */
async function loadContent(item) {
  const loadingEl = document.getElementById('preview-loading');
  const statusEl = document.getElementById('preview-status');
  const contentEl = document.getElementById('preview-content');
  const errorEl = document.getElementById('preview-error');

  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  // Update metadata immediately
  const { smartAccountAddress } = getAuthState();
  const isOwn = item.uploader.toLowerCase() === smartAccountAddress?.toLowerCase();

  document.getElementById('meta-date').textContent = formatDate(item.timestamp);
  document.getElementById('meta-uploader').textContent = isOwn
    ? 'You'
    : item.uploader.slice(0, 6) + '...' + item.uploader.slice(-4);

  // Get group names
  const names = await getGroupNames(item.groupIds);
  const groupDisplay = item.groupIds.map(gid => names[gid] || gid.slice(0, 8)).join(', ');
  document.getElementById('meta-groups').textContent = groupDisplay || 'None';

  // Set basescan link (we don't have tx hash, so link to address)
  // In a real app, you'd store the tx hash and link to it
  document.getElementById('basescan-link').href =
    `https://sepolia.basescan.org/address/${item.uploader}`;

  // Decrypt content
  try {
    const result = await downloadAndDecrypt(
      item.contentId,
      item.manifestCID,
      item.merkleRoot,
      (progress) => {
        statusEl.textContent = progress.message;
      }
    );

    // Update verification status
    updateVerification(result.verified, 'confirmed');

    // Detect content type and render
    const mimeType = detectContentType(result.manifest, result.data);
    renderPreview(result.data, mimeType);

    loadingEl.classList.add('hidden');
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');

    // Mark verification as failed
    updateVerification(false, null);
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
 * Show the content detail modal
 * @param {object} item - Content item from discovery
 */
export function showContentDetail(item) {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    document.getElementById('content-detail-back').addEventListener('click', hideContentDetail);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideContentDetail();
    });
  }

  currentItem = item;

  // Reset state
  document.getElementById('preview-loading').classList.remove('hidden');
  document.getElementById('preview-content').classList.add('hidden');
  document.getElementById('preview-error').classList.add('hidden');
  document.getElementById('preview-status').textContent = 'Loading...';
  document.getElementById('verify-merkle').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">Merkle proof</span>
  `;
  document.getElementById('verify-chain').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">On-chain record</span>
  `;

  modal.classList.remove('hidden');
  loadContent(item);
}

/**
 * Hide the content detail modal
 */
export function hideContentDetail() {
  if (modal) {
    modal.classList.add('hidden');
  }

  // Clean up URL
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
  }
}
```

**Step 2: Verify modal creates**

In browser console:
```javascript
import { showContentDetail } from './src/ui/contentDetail.js';
console.log('Content detail loaded:', typeof showContentDetail === 'function');
```

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/contentDetail.js
git commit -m "feat(ui): add content detail view with decryption and verification"
```

---

### Task 6: Add CSS Styles for Content Browser

**Files:**
- Modify: `witness-pwa/styles.css`

**Step 1: Add content browser styles**

Append to the end of `witness-pwa/styles.css`:

```css
/* ============================================
   Content Browser
============================================ */

.content-browser-modal {
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.content-browser-modal .modal-body {
  flex: 1;
  overflow-y: auto;
  padding-top: 0;
}

/* Filter Tabs */
.filter-tabs {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 1rem;
  -webkit-overflow-scrolling: touch;
}

.filter-tab {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  color: var(--text-light);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.filter-tab:hover {
  background: var(--bg-surface-hover);
}

.filter-tab.active {
  background: var(--red-accent);
  border-color: var(--red-accent);
  color: white;
}

/* Loading State */
.content-loading {
  text-align: center;
  padding: 3rem 1rem;
}

.content-loading p {
  color: var(--text-muted);
  margin-top: 1rem;
}

/* Content List */
.content-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.content-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-surface);
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.content-item:hover {
  background: var(--bg-surface-hover);
}

.content-item-icon {
  font-size: 1.5rem;
}

.content-item-info {
  flex: 1;
  min-width: 0;
}

.content-item-date {
  font-weight: 500;
  color: var(--text-light);
}

.content-item-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

.content-item-groups {
  color: var(--red-accent);
}

.content-item-arrow {
  color: var(--text-muted);
  font-size: 1.5rem;
}

/* Empty State */
.content-empty {
  text-align: center;
  padding: 3rem 1rem;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.content-empty p {
  color: var(--text-muted);
  margin: 0.5rem 0;
}

/* ============================================
   Content Detail View
============================================ */

.content-detail-modal {
  max-width: 500px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.content-detail-modal .modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-back {
  background: none;
  border: none;
  color: var(--red-accent);
  font-size: 1rem;
  cursor: pointer;
  padding: 0.5rem;
}

.content-detail-modal .modal-body {
  flex: 1;
  overflow-y: auto;
}

/* Content Preview */
.content-preview {
  background: var(--bg-surface);
  border-radius: 12px;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
  overflow: hidden;
}

.preview-loading {
  text-align: center;
  padding: 2rem;
}

.preview-loading p {
  color: var(--text-muted);
  margin-top: 0.5rem;
  font-size: 0.9rem;
}

.preview-content {
  width: 100%;
}

.text-preview {
  padding: 1rem;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--text-light);
  max-height: 300px;
  overflow-y: auto;
}

.image-preview {
  width: 100%;
  height: auto;
  display: block;
}

.video-preview {
  width: 100%;
  display: block;
  max-height: 300px;
}

.binary-preview {
  text-align: center;
  padding: 2rem;
}

.binary-preview p {
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.preview-error {
  color: var(--error-color);
  padding: 2rem;
  text-align: center;
}

/* Metadata */
.content-metadata {
  background: var(--bg-surface);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.metadata-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
}

.metadata-row:last-child {
  border-bottom: none;
}

.metadata-label {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.metadata-value {
  color: var(--text-light);
  font-size: 0.9rem;
  text-align: right;
}

/* Verification Status */
.verification-status {
  background: var(--bg-surface);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.verification-header {
  font-weight: 500;
  color: var(--text-light);
  margin-bottom: 0.75rem;
}

.verification-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.verify-icon {
  font-size: 1.1rem;
}

.verify-text {
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Content Actions */
.content-actions {
  margin-top: 1rem;
}

/* Spinner */
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--red-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

**Step 2: Verify styles**

```bash
cd witness-pwa && npm run dev
```

Open browser, test content browser modal styling.

**Step 3: Commit**

```bash
git add witness-pwa/styles.css
git commit -m "style: add content browser and detail view styles"
```

---

### Task 7: Wire Up Content Browser in Drawer

**Files:**
- Modify: `witness-pwa/index.html`
- Modify: `witness-pwa/src/main.js`

**Step 1: Add content browser button to drawer**

In `witness-pwa/index.html`, find the drawer-footer section and add an evidence button:

```html
<div class="drawer-footer">
    <button id="evidence-btn" class="btn btn-link">
        📁 Evidence
    </button>
    <button id="upload-btn-drawer" class="btn btn-link">
        📤 Upload Content
    </button>
    <button id="groups-btn" class="btn btn-link">
        👥 My Groups
    </button>
    <button id="encryption-test-btn" class="btn btn-link">
        🔐 Encryption Test
    </button>
    <button id="logout-btn" class="btn btn-link btn-logout">
        Sign Out
    </button>
</div>
```

**Step 2: Wire up the evidence button in main.js**

In `witness-pwa/src/main.js`, add the import at the top with other imports:

```javascript
import { showContentBrowser } from './ui/contentBrowser.js';
```

Then add the event listener after the groups button handler:

```javascript
// Evidence button handler
const evidenceBtn = document.getElementById('evidence-btn');
if (evidenceBtn) {
  evidenceBtn.addEventListener('click', () => {
    closeDrawer();
    showContentBrowser();
  });
}
```

**Step 3: Verify integration**

1. Run `npm run dev`
2. Login with Privy
3. Open the drawer
4. Tap "📁 Evidence"
5. Verify content browser modal opens

**Step 4: Commit**

```bash
git add witness-pwa/index.html witness-pwa/src/main.js
git commit -m "feat: wire up evidence browser in drawer"
```

---

### Task 8: Integration Test - Full Discovery & Decryption Flow

**Files:** None (manual testing)

**Prerequisites:**
- Phase 5 complete (at least one content uploaded)
- Pinata configured
- At least one group with uploaded content

**Step 1: Test content discovery**

1. Clear browser data
2. Run `npm run dev`
3. Login with email
4. Create a group (if none)
5. Upload test content via "📤 Upload Content"
6. Open "📁 Evidence"
7. Verify content appears in list

**Step 2: Test group filtering**

1. Create second group
2. Upload content to second group
3. Open Evidence browser
4. Click group filter tabs
5. Verify filtering works correctly

**Step 3: Test decryption**

1. Click on a content item
2. Watch progress messages
3. Verify decrypted content displays
4. Verify "Merkle proof valid" shows ✅
5. For text content, verify text displays correctly

**Step 4: Test verification**

In browser console, verify Merkle root matches:
```javascript
import { getContent } from './src/lib/contract.js';
const content = await getContent('YOUR_CONTENT_ID');
console.log('On-chain merkle root:', content.merkleRoot);
```

**Step 5: Document any issues found**

If issues found, create tasks to fix them before proceeding.

---

### Task 9: Build and Deploy

**Files:** None (commands only)

**Step 1: Build for production**

```bash
cd witness-pwa && npm run build
```

Verify no build errors.

**Step 2: Test production build locally**

```bash
npm run preview
```

Open http://localhost:4173, verify:
- Content browser opens
- Content loads
- Decryption works
- Verification shows

**Step 3: Deploy to production**

```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

**Step 4: Verify production deployment**

1. Open https://witness.squirrlabs.xyz
2. Login
3. Upload test content (if none)
4. Open Evidence browser
5. Verify content decrypts correctly

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: phase 6 complete - content discovery and decryption"
```

---

## Acceptance Criteria Checklist

- [ ] List shows all content user has access to (personal + group)
- [ ] Can filter by "All", "My Uploads", and individual groups
- [ ] Tapping content item opens detail view
- [ ] Content fetches from IPFS correctly
- [ ] Content decrypts using appropriate group secret
- [ ] Merkle proof verification works and shows status
- [ ] Shows which groups content is shared with
- [ ] Shows uploader address (or "You" if current user)
- [ ] Shows upload timestamp
- [ ] Link to Basescan works
- [ ] Text content renders correctly
- [ ] Production deployment verified

---

## Notes

**Existing Infrastructure Leveraged:**
- `contract.js` had `getContent()`, `getUserContent()`, `getGroupContent()`
- `encryption.js` had `unwrapContentKey()`, `decrypt()`, `hexToBytes()`
- `storage.js` had `getGroupSecrets()`, `getGroupSecret()`
- `ipfs.js` had basic `downloadContent()` (extended in this phase)
- `merkle.js` had `computeMerkleRoot()`, `hashContent()`

**What This Phase Added:**
- Extended IPFS service with manifest and binary download helpers
- Content discovery service (aggregates from user + groups)
- Content decryption service (unwrap key, decrypt, verify)
- Content browser UI with filtering
- Content detail view with preview

**Video/Media Support:**
- Decryption service detects content type from magic bytes
- Video preview uses HTML5 `<video>` element
- Image preview uses `<img>` element
- Text preview uses `<pre>` element
- Unknown types offer download link

**Security Considerations:**
- Content key unwrapped client-side using group secret
- Merkle root verified against on-chain commitment
- Object URLs cleaned up to prevent memory leaks
- HTML escaped in all user-facing content

**Future Enhancements (Phase 8+):**
- Multi-chunk content support
- Streaming decryption for large files
- Offline caching of decrypted content
- Download to device option
