/**
 * Smart Account module for Witness Protocol
 * Wraps Privy EOA into Kernel smart account with Pimlico paymaster
 */
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { sepolia } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';

// Cached clients
let publicClient = null;
let pimlicoClient = null;
let smartAccountClient = null;

/**
 * Get the Pimlico bundler/paymaster URL
 * @returns {string}
 */
function getPimlicoUrl() {
  const apiKey = import.meta.env.VITE_PIMLICO_API_KEY;
  if (!apiKey) {
    throw new Error('Missing VITE_PIMLICO_API_KEY in .env');
  }
  return `https://api.pimlico.io/v2/11155111/rpc?apikey=${apiKey}`;
}

/**
 * Initialize public client for Sepolia
 * @returns {object} Viem public client
 */
export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(),
    });
  }
  return publicClient;
}

/**
 * Initialize Pimlico client for bundler/paymaster operations
 * @returns {object} Pimlico client
 */
export function getPimlicoClient() {
  if (!pimlicoClient) {
    pimlicoClient = createPimlicoClient({
      transport: http(getPimlicoUrl()),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });
  }
  return pimlicoClient;
}

/**
 * Create a viem WalletClient from Privy's EIP-1193 provider
 * This acts as the "owner" for the Kernel smart account
 * @param {object} provider - Privy embedded wallet EIP-1193 provider
 * @param {string} address - EOA address
 * @returns {object} Viem WalletClient
 */
function createOwnerFromProvider(provider, address) {
  return createWalletClient({
    account: address,
    chain: sepolia,
    transport: custom(provider),
  });
}

/**
 * Create Kernel smart account from Privy EOA provider
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} address - EOA address
 * @returns {Promise<object>} Kernel smart account
 */
export async function createKernelAccount(provider, address) {
  const client = getPublicClient();

  // Create owner from Privy provider
  const owner = createOwnerFromProvider(provider, address);

  // Create Kernel smart account with the owner
  const kernelAccount = await toKernelSmartAccount({
    client,
    owners: [owner],
    version: '0.3.1',
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  });

  return kernelAccount;
}

/**
 * Create smart account client with Pimlico paymaster
 * @param {object} kernelAccount - Kernel smart account
 * @returns {object} Smart account client ready for gasless transactions
 */
export function createGaslessClient(kernelAccount) {
  const pimlico = getPimlicoClient();

  smartAccountClient = createSmartAccountClient({
    account: kernelAccount,
    chain: sepolia,
    bundlerTransport: http(getPimlicoUrl()),
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => {
        const gasPrice = await pimlico.getUserOperationGasPrice();
        return gasPrice.fast;
      },
    },
  });

  return smartAccountClient;
}

/**
 * Get the smart account address (counterfactual - may not be deployed yet)
 * @param {object} kernelAccount - Kernel smart account
 * @returns {string} Smart account address
 */
export function getSmartAccountAddress(kernelAccount) {
  return kernelAccount.address;
}

/**
 * Get the current smart account client
 * @returns {object|null}
 */
export function getSmartAccountClient() {
  return smartAccountClient;
}

/**
 * Full initialization: EOA → Kernel → Gasless Client
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} address - EOA address
 * @returns {Promise<{kernelAccount: object, client: object, address: string}>}
 */
export async function initializeSmartAccount(provider, address) {
  const kernelAccount = await createKernelAccount(provider, address);
  const client = createGaslessClient(kernelAccount);
  const smartAddress = getSmartAccountAddress(kernelAccount);

  return { kernelAccount, client, address: smartAddress };
}
