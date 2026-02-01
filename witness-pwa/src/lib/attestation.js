/**
 * Attestation Service for Witness Protocol
 * Generates ZK proofs and submits anonymous attestations
 */

import { Group } from '@semaphore-protocol/group';
import { generateProof } from '@semaphore-protocol/proof';
import { getStoredIdentity } from './identity.js';
import { getAuthState } from './authState.js';
import {
  attestToContent as contractAttestToContent,
  getAttestationCount,
  waitForTransaction,
  getSemaphoreGroupId,
  getSemaphoreGroupMembers,
} from './contract.js';
import { getItem, setItem } from './storage.js';

// Local attestation tracking
const LOCAL_ATTESTATIONS_KEY = 'witness_local_attestations';

/**
 * Get local attestation records
 * @returns {Object} Map of contentId => attestation data
 */
function getLocalAttestations() {
  return getItem(LOCAL_ATTESTATIONS_KEY) || {};
}

/**
 * Record local attestation
 * @param {string} contentId - Content ID attested to
 * @param {string} groupId - Group ID used for attestation
 */
function recordLocalAttestation(contentId, groupId) {
  const attestations = getLocalAttestations();
  attestations[contentId] = {
    groupId,
    attestedAt: new Date().toISOString(),
  };
  setItem(LOCAL_ATTESTATIONS_KEY, attestations);
}

/**
 * Check if user has locally recorded an attestation
 * (On-chain check is impossible since attestations are anonymous)
 * @param {string} contentId - Content ID
 * @returns {boolean} Whether user has attested
 */
export function hasLocallyAttested(contentId) {
  const attestations = getLocalAttestations();
  return !!attestations[contentId];
}

/**
 * Build a Group object from on-chain members
 * Fetches all identity commitments from Semaphore events to match on-chain merkle tree
 * @param {string} witnessGroupId - Witness group ID (bytes32 hex)
 * @returns {Promise<Group>} Semaphore Group object with correct merkle tree
 */
async function buildGroupFromChain(witnessGroupId) {
  // Get the Semaphore group ID for this Witness group
  const semGroupId = await getSemaphoreGroupId(witnessGroupId);
  console.log('[attestation] Semaphore group ID:', semGroupId.toString());

  // Fetch all members from on-chain events (now returns object with commitments and root)
  const { commitments, onChainRoot } = await getSemaphoreGroupMembers(semGroupId);

  if (commitments.length === 0) {
    throw new Error('No members found in Semaphore group');
  }

  // Build Group with all members in correct order
  const group = new Group(commitments);
  console.log('[attestation] Built group with', commitments.length, 'members');
  console.log('[attestation] Local merkle root:', group.root.toString().slice(0, 20) + '...');
  console.log('[attestation] On-chain root:    ', onChainRoot?.toString().slice(0, 20) + '...');

  // DIAGNOSTIC: Check if roots match
  if (onChainRoot && group.root.toString() !== onChainRoot.toString()) {
    console.error('[attestation] ⚠️ MERKLE ROOT MISMATCH!');
    console.error('[attestation] Local:    ', group.root.toString());
    console.error('[attestation] On-chain: ', onChainRoot.toString());
  } else {
    console.log('[attestation] ✓ Merkle roots match');
  }

  return group;
}

/**
 * @typedef {Object} AttestationProgress
 * @property {'loading'|'proving'|'submitting'|'confirming'|'done'|'error'} step
 * @property {string} message
 */

/**
 * Generate proof and submit attestation
 * @param {string} contentId - Content ID to attest to (bytes32 hex)
 * @param {string} groupId - Group ID to attest through (bytes32 hex)
 * @param {function(AttestationProgress): void} onProgress - Progress callback
 * @returns {Promise<{txHash: string, newCount: number}>}
 */
export async function submitAttestation(contentId, groupId, onProgress = () => {}) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  try {
    // Step 1: Load identity
    onProgress({ step: 'loading', message: 'Loading identity...' });

    const identity = await getStoredIdentity(encryptionKey);
    if (!identity) {
      throw new Error('Semaphore identity not found. Please rejoin a group to create identity.');
    }

    // Step 2: Build group from on-chain data
    onProgress({ step: 'loading', message: 'Fetching group members...' });
    const group = await buildGroupFromChain(groupId);

    // Verify user's identity is in the group
    const memberIndex = group.indexOf(identity.commitment);
    if (memberIndex === -1) {
      throw new Error('Your identity is not registered in this group. Please rejoin the group.');
    }
    console.log('[attestation] User is member at index:', memberIndex);

    // Step 3: Generate ZK proof
    onProgress({ step: 'proving', message: 'Generating zero-knowledge proof...' });

    // scope = contentId ensures unique nullifier per content
    // message = contentId (what we're attesting to)
    const scope = BigInt(contentId);
    const message = BigInt(contentId);

    console.log('[attestation] Generating proof for content:', contentId.slice(0, 12) + '...');
    console.log('[attestation] Proof params - scope:', scope.toString().slice(0, 20) + '...');
    console.log('[attestation] Proof params - message:', message.toString().slice(0, 20) + '...');
    const proof = await generateProof(identity, group, message, scope);
    console.log('[attestation] Proof generated:');
    console.log('[attestation]   merkleTreeDepth:', proof.merkleTreeDepth);
    console.log('[attestation]   merkleTreeRoot:', proof.merkleTreeRoot.toString().slice(0, 20) + '...');
    console.log('[attestation]   nullifier:', proof.nullifier.toString().slice(0, 20) + '...');
    console.log('[attestation]   message:', proof.message.toString().slice(0, 20) + '...');
    console.log('[attestation]   scope:', proof.scope.toString().slice(0, 20) + '...');
    console.log('[attestation]   points length:', proof.points?.length);

    // Step 4: Submit to contract
    onProgress({ step: 'submitting', message: 'Submitting attestation...' });

    const txHash = await contractAttestToContent(contentId, groupId, proof);

    // Step 5: Wait for confirmation
    onProgress({ step: 'confirming', message: 'Waiting for confirmation...' });

    await waitForTransaction(txHash);

    // Step 6: Record locally and get new count
    recordLocalAttestation(contentId, groupId);
    const newCount = await getAttestationCount(contentId);

    onProgress({ step: 'done', message: 'Attestation submitted!' });

    console.log('[attestation] Complete! New count:', newCount);

    return { txHash, newCount };
  } catch (err) {
    console.error('[attestation] Failed:', err);
    onProgress({ step: 'error', message: err.message });
    throw err;
  }
}

/**
 * Fetch attestation count from chain
 * @param {string} contentId - Content ID
 * @returns {Promise<number>} Attestation count
 */
export async function fetchAttestationCount(contentId) {
  return getAttestationCount(contentId);
}

/**
 * Clear local attestation records (for logout)
 */
export function clearLocalAttestations() {
  localStorage.removeItem(LOCAL_ATTESTATIONS_KEY);
}
