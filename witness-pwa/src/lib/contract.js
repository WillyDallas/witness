/**
 * Contract interaction service for Witness Protocol
 * Uses the smart account client for gasless transactions
 */
import { getContract, encodeFunctionData, parseAbiItem } from 'viem';
import { getPublicClient, getSmartAccountClient } from './smartAccount.js';
import WitnessRegistryABI from './abi/WitnessRegistry.json';

// Contract addresses from environment
const REGISTRY_ADDRESS = import.meta.env.VITE_WITNESS_REGISTRY_ADDRESS;
const SEMAPHORE_ADDRESS = import.meta.env.VITE_SEMAPHORE_ADDRESS;

if (!REGISTRY_ADDRESS) {
  console.warn('[contract] VITE_WITNESS_REGISTRY_ADDRESS not set');
}

/**
 * Get a read-only contract instance
 * @returns {object} Viem contract instance for reads
 */
export function getRegistryContract() {
  const publicClient = getPublicClient();

  return getContract({
    address: REGISTRY_ADDRESS,
    abi: WitnessRegistryABI,
    client: publicClient,
  });
}

// ============================================
// READ FUNCTIONS (No gas required)
// ============================================

/**
 * Check if an address is registered
 * @param {string} address - Address to check
 * @returns {Promise<boolean>}
 */
export async function isRegistered(address) {
  const contract = getRegistryContract();
  return contract.read.registered([address]);
}

/**
 * Get registration timestamp for an address
 * @param {string} address - Address to check
 * @returns {Promise<bigint>} Unix timestamp or 0
 */
export async function getRegisteredAt(address) {
  const contract = getRegistryContract();
  return contract.read.registeredAt([address]);
}

/**
 * Check if address is member of a group
 * @param {string} groupId - Group ID (bytes32 hex)
 * @param {string} address - Address to check
 * @returns {Promise<boolean>}
 */
export async function isGroupMember(groupId, address) {
  const contract = getRegistryContract();
  return contract.read.groupMembers([groupId, address]);
}

/**
 * Get group details
 * @param {string} groupId - Group ID (bytes32 hex)
 * @returns {Promise<{creator: string, createdAt: bigint, active: boolean}>}
 */
export async function getGroup(groupId) {
  const contract = getRegistryContract();
  const [creator, createdAt, active] = await contract.read.groups([groupId]);
  return { creator, createdAt, active };
}

/**
 * Get content commitment details
 * @param {string} contentId - Content ID (bytes32 hex)
 * @returns {Promise<{merkleRoot: string, manifestCID: string, uploader: string, timestamp: bigint}>}
 */
export async function getContent(contentId) {
  const contract = getRegistryContract();
  const [merkleRoot, manifestCID, uploader, timestamp] = await contract.read.content([contentId]);
  return { merkleRoot, manifestCID, uploader, timestamp };
}

/**
 * Get all content IDs for a user
 * @param {string} address - User address
 * @returns {Promise<string[]>} Array of content IDs
 */
export async function getUserContent(address) {
  const contract = getRegistryContract();
  return contract.read.getUserContent([address]);
}

/**
 * Get all content IDs for a group
 * @param {string} groupId - Group ID
 * @returns {Promise<string[]>} Array of content IDs
 */
export async function getGroupContent(groupId) {
  const contract = getRegistryContract();
  return contract.read.getGroupContent([groupId]);
}

/**
 * Get attestation count for content
 * @param {string} contentId - Content ID (bytes32 hex)
 * @returns {Promise<number>} Attestation count
 */
export async function getAttestationCount(contentId) {
  const contract = getRegistryContract();
  const count = await contract.read.attestationCount([contentId]);
  return Number(count);
}

/**
 * Get Semaphore group ID for a Witness group
 * @param {string} groupId - Witness group ID (bytes32 hex)
 * @returns {Promise<bigint>} Semaphore group ID
 */
export async function getSemaphoreGroupId(groupId) {
  const contract = getRegistryContract();
  return contract.read.semaphoreGroupId([groupId]);
}

/**
 * Get session details from on-chain
 * @param {string} sessionId - Session ID (bytes32 hex)
 * @returns {Promise<{creator: string, merkleRoot: string, manifestCid: string, chunkCount: bigint, createdAt: bigint, updatedAt: bigint}>}
 */
export async function getSession(sessionId) {
  const contract = getRegistryContract();
  const [creator, merkleRoot, manifestCid, chunkCount, createdAt, updatedAt] = await contract.read.sessions([sessionId]);
  return { creator, merkleRoot, manifestCid, chunkCount, createdAt, updatedAt };
}

/**
 * Get groups a session is shared with
 * @param {string} sessionId - Session ID (bytes32 hex)
 * @returns {Promise<string[]>} Array of group IDs
 */
export async function getSessionGroups(sessionId) {
  const contract = getRegistryContract();
  return contract.read.getSessionGroups([sessionId]);
}

/**
 * Check if a nullifier has been used
 * @param {bigint} nullifier - The nullifier to check
 * @returns {Promise<boolean>} Whether nullifier is used
 */
export async function isNullifierUsed(nullifier) {
  const contract = getRegistryContract();
  return contract.read.nullifierUsed([nullifier]);
}

// Starting block for log queries - Base Sepolia recent history
// Using a block from ~2 weeks ago to avoid expensive full-chain queries
const LOG_START_BLOCK = 35000000n;

/**
 * Fetch all identity commitments for a Semaphore group
 * Queries MemberAdded events from the Semaphore contract
 * @param {bigint|number} semaphoreGroupId - Semaphore group ID
 * @returns {Promise<{commitments: bigint[], onChainRoot: bigint}>} Commitments and current merkle root
 */
export async function getSemaphoreGroupMembers(semaphoreGroupId) {
  const publicClient = getPublicClient();

  // MemberAdded event: event MemberAdded(uint256 indexed groupId, uint256 index, uint256 identityCommitment, uint256 merkleTreeRoot)
  const memberAddedEvent = parseAbiItem(
    'event MemberAdded(uint256 indexed groupId, uint256 index, uint256 identityCommitment, uint256 merkleTreeRoot)'
  );

  const logs = await publicClient.getLogs({
    address: SEMAPHORE_ADDRESS,
    event: memberAddedEvent,
    args: { groupId: BigInt(semaphoreGroupId) },
    fromBlock: LOG_START_BLOCK,
    toBlock: 'latest',
  });

  // Sort by index to ensure correct order
  const sorted = logs.sort((a, b) => Number(a.args.index) - Number(b.args.index));
  const commitments = sorted.map(log => log.args.identityCommitment);

  // Get the on-chain merkle root from the last event (current state)
  const onChainRoot = sorted.length > 0 ? sorted[sorted.length - 1].args.merkleTreeRoot : null;

  console.log(`[contract] Fetched ${commitments.length} members for Semaphore group ${semaphoreGroupId}`);
  console.log(`[contract] On-chain merkle root: ${onChainRoot?.toString().slice(0, 20)}...`);

  return { commitments, onChainRoot };
}

/**
 * @typedef {Object} SessionData
 * @property {string} sessionId - Session ID (bytes32 hex)
 * @property {string} creator - Creator address
 * @property {string} merkleRoot - Current merkle root (bytes32 hex)
 * @property {string} manifestCid - IPFS CID of latest manifest
 * @property {number} chunkCount - Number of chunks
 * @property {string[]} groupIds - Groups this session is shared with
 * @property {number} updatedAt - Last update timestamp (from event)
 */

/**
 * Fetch sessions for a user by querying SessionUpdated events
 * Deduplicates by sessionId, keeping the most recent update
 * @param {string} address - User address to query sessions for
 * @returns {Promise<SessionData[]>} Array of session data
 */
export async function getUserSessions(address) {
  const publicClient = getPublicClient();

  // SessionUpdated event signature from ABI
  const sessionUpdatedEvent = parseAbiItem(
    'event SessionUpdated(bytes32 indexed sessionId, address indexed uploader, bytes32 merkleRoot, string manifestCid, uint256 chunkCount, bytes32[] groupIds, uint256 timestamp)'
  );

  const logs = await publicClient.getLogs({
    address: REGISTRY_ADDRESS,
    event: sessionUpdatedEvent,
    args: { uploader: address },
    fromBlock: LOG_START_BLOCK,
    toBlock: 'latest',
  });

  // Deduplicate by sessionId (keep latest based on block/log position)
  const sessions = {};
  for (const log of logs) {
    const sessionId = log.args.sessionId;
    // Each new log supersedes previous - they're ordered chronologically
    sessions[sessionId] = {
      sessionId,
      creator: log.args.uploader,
      merkleRoot: log.args.merkleRoot,
      manifestCid: log.args.manifestCid,
      chunkCount: Number(log.args.chunkCount),
      groupIds: log.args.groupIds,
      updatedAt: Number(log.args.timestamp),
    };
  }

  console.log(`[contract] Found ${Object.keys(sessions).length} sessions for ${address.slice(0, 10)}...`);

  return Object.values(sessions);
}

/**
 * Fetch sessions shared with a specific group
 * @param {string} groupId - Group ID to query
 * @returns {Promise<SessionData[]>} Array of session data shared with this group
 */
export async function getGroupSessions(groupId) {
  const publicClient = getPublicClient();

  // Query all SessionUpdated events (no uploader filter)
  const sessionUpdatedEvent = parseAbiItem(
    'event SessionUpdated(bytes32 indexed sessionId, address indexed uploader, bytes32 merkleRoot, string manifestCid, uint256 chunkCount, bytes32[] groupIds, uint256 timestamp)'
  );

  const logs = await publicClient.getLogs({
    address: REGISTRY_ADDRESS,
    event: sessionUpdatedEvent,
    fromBlock: LOG_START_BLOCK,
    toBlock: 'latest',
  });

  // Deduplicate and filter by groupId membership
  const sessions = {};
  for (const log of logs) {
    const sessionGroupIds = log.args.groupIds || [];
    // Check if this session is shared with the target group
    if (!sessionGroupIds.includes(groupId)) continue;

    const sessionId = log.args.sessionId;
    sessions[sessionId] = {
      sessionId,
      creator: log.args.uploader,
      merkleRoot: log.args.merkleRoot,
      manifestCid: log.args.manifestCid,
      chunkCount: Number(log.args.chunkCount),
      groupIds: sessionGroupIds,
      updatedAt: Number(log.args.timestamp),
    };
  }

  console.log(`[contract] Found ${Object.keys(sessions).length} sessions for group ${groupId.slice(0, 10)}...`);

  return Object.values(sessions);
}

// ============================================
// WRITE FUNCTIONS (Gasless via Smart Account)
// ============================================

/**
 * Register the current user on-chain
 * @returns {Promise<string>} Transaction hash
 */
export async function register() {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized. Call initializeSmartAccount first.');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'register',
      args: [],
    }),
  });

  console.log('[contract] Registration tx:', hash);
  return hash;
}

/**
 * Create a new group with Semaphore integration
 * @param {string} groupId - Group ID (keccak256 of group secret)
 * @param {bigint} identityCommitment - Creator's Semaphore identity commitment
 * @returns {Promise<string>} Transaction hash
 */
export async function createGroup(groupId, identityCommitment) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'createGroup',
      args: [groupId, identityCommitment],
    }),
  });

  console.log('[contract] Create group tx:', hash);
  return hash;
}

/**
 * Join an existing group with identity commitment
 * @param {string} groupId - Group ID to join
 * @param {bigint} identityCommitment - Joiner's Semaphore identity commitment
 * @returns {Promise<string>} Transaction hash
 */
export async function joinGroup(groupId, identityCommitment) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'joinGroup',
      args: [groupId, identityCommitment],
    }),
  });

  console.log('[contract] Join group tx:', hash);
  return hash;
}

/**
 * Commit content to the registry
 * @param {string} contentId - Unique content identifier
 * @param {string} merkleRoot - Merkle root of content chunks
 * @param {string} manifestCID - IPFS CID of manifest
 * @param {string[]} groupIds - Groups to share with
 * @returns {Promise<string>} Transaction hash
 */
export async function commitContent(contentId, merkleRoot, manifestCID, groupIds) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'commitContent',
      args: [contentId, merkleRoot, manifestCID, groupIds],
    }),
  });

  console.log('[contract] Commit content tx:', hash);
  return hash;
}

/**
 * Update session with new chunk data (streaming upload)
 * @param {string} sessionId - Session ID (bytes32 hex)
 * @param {string} merkleRoot - Current merkle root (bytes32 hex)
 * @param {string} manifestCid - IPFS CID of manifest
 * @param {bigint} chunkCount - Number of chunks
 * @param {string[]} groupIds - Group IDs for access control
 * @returns {Promise<string>} Transaction hash
 */
export async function updateSession(sessionId, merkleRoot, manifestCid, chunkCount, groupIds) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'updateSession',
      args: [sessionId, merkleRoot, manifestCid, chunkCount, groupIds],
    }),
  });

  console.log('[contract] Update session tx:', hash);
  return hash;
}

/**
 * Submit anonymous attestation to content
 * @param {string} contentId - Content ID to attest to
 * @param {string} groupId - Group ID through which attesting
 * @param {object} proof - Semaphore proof object
 * @returns {Promise<string>} Transaction hash
 */
export async function attestToContent(contentId, groupId, proof) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  // Format proof for contract
  const formattedProof = {
    merkleTreeDepth: proof.merkleTreeDepth,
    merkleTreeRoot: proof.merkleTreeRoot,
    nullifier: proof.nullifier,
    message: proof.message,
    scope: proof.scope,
    points: proof.points,
  };

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'attestToContent',
      args: [contentId, groupId, formattedProof],
    }),
  });

  console.log('[contract] Attestation tx:', hash);
  return hash;
}

/**
 * Wait for a transaction to be confirmed
 * @param {string} hash - Transaction hash
 * @returns {Promise<object>} Transaction receipt
 */
export async function waitForTransaction(hash) {
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('[contract] Tx confirmed in block:', receipt.blockNumber);
  return receipt;
}
