/**
 * Groups Service for Witness Protocol
 * Orchestrates group creation, joining, and invite management
 */

import { generateGroupSecret, deriveGroupId, bytesToHex, hexToBytes } from './encryption.js';
import { createGroup as contractCreateGroup, joinGroup as contractJoinGroup, waitForTransaction, isGroupMember, getGroup } from './contract.js';
import { setGroupSecret, getGroupSecrets, getGroupSecret } from './storage.js';
import { getAuthState } from './authState.js';

// Chain configuration
const CHAIN_ID = import.meta.env.VITE_CHAIN_ID || 84532;
const REGISTRY_ADDRESS = import.meta.env.VITE_WITNESS_REGISTRY_ADDRESS;

/**
 * @typedef {Object} GroupInvite
 * @property {string} groupId - Group ID (bytes32 hex)
 * @property {string} groupSecret - Group secret as hex string
 * @property {string} groupName - Human-readable group name
 * @property {number} chainId - Chain ID for verification
 * @property {string} registryAddress - Contract address for verification
 * @property {number} version - Invite format version
 */

/**
 * Create a new group
 * @param {string} name - Human-readable group name
 * @returns {Promise<{groupId: string, txHash: string}>}
 */
export async function createNewGroup(name) {
  const { encryptionKey, smartAccountAddress } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated - encryption key required');
  }

  if (!smartAccountAddress) {
    throw new Error('Smart account not initialized');
  }

  // Generate random group secret
  const secret = generateGroupSecret();
  const groupId = await deriveGroupId(secret);

  console.log('[groups] Creating group:', name, groupId.slice(0, 18) + '...');

  // Submit on-chain transaction
  const txHash = await contractCreateGroup(groupId);
  console.log('[groups] Waiting for confirmation...');

  // Wait for confirmation
  await waitForTransaction(txHash);

  // Store secret locally (encrypted)
  await setGroupSecret(groupId, secret, name, true, encryptionKey);

  console.log('[groups] Group created successfully');

  return { groupId, txHash };
}

/**
 * Join an existing group from invite
 * @param {GroupInvite} invite - Parsed invite data
 * @returns {Promise<{txHash: string}>}
 */
export async function joinGroupFromInvite(invite) {
  const { encryptionKey, smartAccountAddress } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated - encryption key required');
  }

  if (!smartAccountAddress) {
    throw new Error('Smart account not initialized');
  }

  // Validate invite
  if (invite.chainId !== Number(CHAIN_ID)) {
    throw new Error(`Wrong network. Expected chain ${CHAIN_ID}, got ${invite.chainId}`);
  }

  if (invite.registryAddress.toLowerCase() !== REGISTRY_ADDRESS.toLowerCase()) {
    throw new Error('Invalid registry address in invite');
  }

  // Check if already a member
  const alreadyMember = await isGroupMember(invite.groupId, smartAccountAddress);
  if (alreadyMember) {
    throw new Error('You are already a member of this group');
  }

  // Verify group exists on-chain
  const group = await getGroup(invite.groupId);
  if (!group.active) {
    throw new Error('Group does not exist or is inactive');
  }

  console.log('[groups] Joining group:', invite.groupName);

  // Submit on-chain transaction
  const txHash = await contractJoinGroup(invite.groupId);
  console.log('[groups] Waiting for confirmation...');

  // Wait for confirmation
  await waitForTransaction(txHash);

  // Store secret locally (encrypted)
  const secretBytes = hexToBytes(invite.groupSecret);
  await setGroupSecret(invite.groupId, secretBytes, invite.groupName, false, encryptionKey);

  console.log('[groups] Joined group successfully');

  return { txHash };
}

/**
 * Generate invite data for a group
 * @param {string} groupId - Group ID to generate invite for
 * @returns {Promise<GroupInvite>}
 */
export async function generateInviteData(groupId) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  // Get stored group data
  const secrets = await getGroupSecrets(encryptionKey);
  const groupData = secrets[groupId];

  if (!groupData) {
    throw new Error('Group not found in local storage');
  }

  if (!groupData.isCreator) {
    // For now, only creators can share. Could expand later.
    console.warn('[groups] Non-creator sharing group invite');
  }

  return {
    groupId: groupData.groupId,
    groupSecret: groupData.secretHex,
    groupName: groupData.name,
    chainId: Number(CHAIN_ID),
    registryAddress: REGISTRY_ADDRESS,
    version: 1,
  };
}

/**
 * Parse QR code data into GroupInvite
 * @param {string} qrData - Raw QR code string (JSON)
 * @returns {GroupInvite}
 */
export function parseInviteQR(qrData) {
  try {
    const invite = JSON.parse(qrData);

    // Validate required fields
    if (!invite.groupId || !invite.groupSecret || !invite.groupName) {
      throw new Error('Invalid invite: missing required fields');
    }

    if (!invite.chainId || !invite.registryAddress) {
      throw new Error('Invalid invite: missing network info');
    }

    // Validate groupId format (bytes32 hex)
    if (!/^0x[a-fA-F0-9]{64}$/.test(invite.groupId)) {
      throw new Error('Invalid invite: malformed groupId');
    }

    // Validate groupSecret format (64 hex chars)
    if (!/^[a-fA-F0-9]{64}$/.test(invite.groupSecret)) {
      throw new Error('Invalid invite: malformed groupSecret');
    }

    return invite;
  } catch (err) {
    if (err.message.startsWith('Invalid invite')) {
      throw err;
    }
    throw new Error('Invalid QR code: not a valid group invite');
  }
}

/**
 * Get all groups the user is a member of
 * @returns {Promise<Array<{groupId: string, name: string, isCreator: boolean, createdAt: string}>>}
 */
export async function getMyGroups() {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    return [];
  }

  const secrets = await getGroupSecrets(encryptionKey);
  return Object.values(secrets).map(s => ({
    groupId: s.groupId,
    name: s.name,
    isCreator: s.isCreator,
    createdAt: s.createdAt,
  }));
}
