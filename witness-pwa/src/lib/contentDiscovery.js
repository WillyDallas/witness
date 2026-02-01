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
