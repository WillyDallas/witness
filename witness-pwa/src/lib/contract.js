/**
 * Contract interaction service for Witness Protocol
 * Uses the smart account client for gasless transactions
 */
import { getContract, encodeFunctionData } from 'viem';
import { getPublicClient, getSmartAccountClient } from './smartAccount.js';
import WitnessRegistryABI from './abi/WitnessRegistry.json';

// Contract address from environment
const REGISTRY_ADDRESS = import.meta.env.VITE_WITNESS_REGISTRY_ADDRESS;

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
 * Create a new group
 * @param {string} groupId - Group ID (keccak256 of group secret)
 * @returns {Promise<string>} Transaction hash
 */
export async function createGroup(groupId) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'createGroup',
      args: [groupId],
    }),
  });

  console.log('[contract] Create group tx:', hash);
  return hash;
}

/**
 * Join an existing group
 * @param {string} groupId - Group ID to join
 * @returns {Promise<string>} Transaction hash
 */
export async function joinGroup(groupId) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'joinGroup',
      args: [groupId],
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
