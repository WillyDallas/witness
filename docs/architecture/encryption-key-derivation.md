# Encryption & Key Derivation Architecture

This document describes how Witness Protocol derives encryption keys and protects content.

## Overview

Witness Protocol uses a hierarchical key system:

1. **Personal Encryption Key**: Derived deterministically from wallet signature
2. **Group Secrets**: Random 32-byte secrets shared via QR codes
3. **Content Keys**: Random per-content keys, wrapped for each group

## Key Derivation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        KEY HIERARCHY                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    WALLET (Privy Embedded EOA)                   │   │
│  │                              │                                   │   │
│  │              EIP-712 Typed Signature                             │   │
│  │                              │                                   │   │
│  │                              ▼                                   │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │              HKDF (SHA-256)                                │  │   │
│  │  │   salt: "witness-protocol-v1"                              │  │   │
│  │  │   info: "encryption-key"                                   │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  │                              │                                   │   │
│  │                              ▼                                   │   │
│  │           PERSONAL ENCRYPTION KEY (AES-256-GCM)                  │   │
│  │           - Encrypts local storage items                         │   │
│  │           - Encrypts Semaphore identity                          │   │
│  │           - Encrypts group secrets                               │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      GROUP SECRETS                               │   │
│  │                                                                  │   │
│  │   groupSecret = crypto.getRandomValues(32 bytes)                 │   │
│  │   groupId = SHA-256(groupSecret)                                 │   │
│  │                                                                  │   │
│  │   - Shared via QR code                                           │   │
│  │   - Stored encrypted with personal key                          │   │
│  │   - Used to wrap content keys                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      CONTENT KEYS                                │   │
│  │                                                                  │   │
│  │   contentKey = crypto.getRandomValues(32 bytes)                  │   │
│  │                                                                  │   │
│  │   - Random per piece of content                                  │   │
│  │   - Encrypts the actual content (video/audio/data)               │   │
│  │   - Wrapped separately for each group with access                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Personal Encryption Key

### EIP-712 Signature Request

We use a typed data signature for deterministic key derivation:

```javascript
// encryption.js

const KEY_DERIVATION_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 84532,
  verifyingContract: '0x0000000000000000000000000000000000000000'
};

const KEY_DERIVATION_TYPES = {
  KeyDerivation: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'version', type: 'uint256' }
  ]
};

const typedData = {
  domain: KEY_DERIVATION_DOMAIN,
  types: KEY_DERIVATION_TYPES,
  primaryType: 'KeyDerivation',
  message: {
    purpose: 'Derive encryption key for secure storage',
    application: 'witness-protocol',
    version: 1
  }
};

const signature = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [walletAddress, JSON.stringify(typedData)]
});
```

### HKDF Derivation

```javascript
// encryption.js

async function deriveEncryptionKey(signature) {
  // Convert signature to bytes
  const signatureBytes = hexToBytes(signature);

  // Import as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    signatureBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Derive AES-256-GCM key
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new TextEncoder().encode('witness-protocol-v1'),
      info: new TextEncoder().encode('encryption-key'),
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt']
  );

  return encryptionKey;
}
```

### Session Caching

The derived key is cached in memory during the session to avoid repeated signature requests:

```javascript
// authState.js

let authState = {
  encryptionKey: null,  // CryptoKey object
  eoaAddress: null,
  smartAccountAddress: null
};

export function setAuthState(state) {
  authState = { ...authState, ...state };
}

export function getAuthState() {
  return authState;
}
```

## Secure Storage

### Encryption

```javascript
// storage.js

export async function setSecureItem(key, value, encryptionKey) {
  const plaintext = JSON.stringify(value);
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt with AES-256-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    data
  );

  // Store IV + ciphertext as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  localStorage.setItem(key, bytesToBase64(combined));
}
```

### Decryption

```javascript
// storage.js

export async function getSecureItem(key, encryptionKey) {
  const stored = localStorage.getItem(key);
  if (!stored) return null;

  const combined = base64ToBytes(stored);

  // Extract IV (first 12 bytes)
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}
```

## Group Secrets

### Generation

```javascript
// encryption.js

export function generateGroupSecret() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function deriveGroupId(groupSecret) {
  const hash = await crypto.subtle.digest('SHA-256', groupSecret);
  return '0x' + bytesToHex(new Uint8Array(hash));
}
```

### QR Code Sharing

Group secrets are shared via QR codes containing:

```javascript
const inviteData = {
  groupId: '0x1234...',
  groupSecret: '0xabcd...',  // Hex-encoded 32 bytes
  groupName: 'Family Safety',
  chainId: 84532,
  registryAddress: '0x5678...'
};
```

### Storage

Group secrets are stored encrypted with the personal key:

```javascript
// storage.js

export async function setGroupSecret(groupId, groupData, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey) || {};
  secrets[groupId] = groupData;
  await setSecureItem(STORAGE_KEYS.GROUP_SECRETS, secrets, encryptionKey);
}
```

## Content Encryption

### Key Generation

```javascript
// encryption.js

export function generateContentKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}
```

### Content Encryption

```javascript
// encryption.js

export async function encryptContent(data, contentKey) {
  // Import content key
  const key = await crypto.subtle.importKey(
    'raw',
    contentKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return {
    iv: bytesToHex(iv),
    ciphertext: new Uint8Array(ciphertext)
  };
}
```

### Key Wrapping

For multi-group access, the content key is wrapped separately for each group:

```javascript
// encryption.js

export async function wrapContentKey(contentKey, groupSecret) {
  // Import group secret as wrapping key
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    groupSecret,
    { name: 'AES-GCM' },
    false,
    ['wrapKey']
  );

  // Import content key
  const keyToWrap = await crypto.subtle.importKey(
    'raw',
    contentKey,
    { name: 'AES-GCM' },
    true, // extractable for wrapping
    ['encrypt', 'decrypt']
  );

  // Generate IV for wrapping
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Wrap the key
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    keyToWrap,
    wrappingKey,
    { name: 'AES-GCM', iv }
  );

  return {
    iv: bytesToHex(iv),
    wrappedKey: bytesToHex(new Uint8Array(wrappedKey))
  };
}
```

### Key Unwrapping

```javascript
// encryption.js

export async function unwrapContentKey(iv, wrappedKey, groupSecret) {
  // Import group secret as unwrapping key
  const unwrappingKey = await crypto.subtle.importKey(
    'raw',
    groupSecret,
    { name: 'AES-GCM' },
    false,
    ['unwrapKey']
  );

  // Unwrap the content key
  const contentKey = await crypto.subtle.unwrapKey(
    'raw',
    hexToBytes(wrappedKey),
    unwrappingKey,
    { name: 'AES-GCM', iv: hexToBytes(iv) },
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  return contentKey;
}
```

## Security Properties

| Property | Implementation |
|----------|----------------|
| **Deterministic Recovery** | Personal key derived from wallet signature - same wallet = same key |
| **Forward Secrecy** | Content keys are random per-content, not derived from personal key |
| **Group Isolation** | Each group has independent secret; leaving group = losing access |
| **Key Wrapping** | Content key wrapped separately for each group; adding groups doesn't require re-encryption |
| **Authenticated Encryption** | AES-256-GCM provides confidentiality + integrity |
| **Secure Storage** | All secrets encrypted at rest with personal key |

## Cryptographic Algorithms

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| Key Derivation | HKDF-SHA-256 | salt="witness-protocol-v1" |
| Symmetric Encryption | AES-256-GCM | 256-bit key, 96-bit IV |
| Key Wrapping | AES-GCM-WRAP | 256-bit key, 96-bit IV |
| Hashing | SHA-256 | For group ID derivation |

## Files

| File | Purpose |
|------|---------|
| `witness-pwa/src/lib/encryption.js` | Core encryption functions |
| `witness-pwa/src/lib/storage.js` | Encrypted localStorage |
| `witness-pwa/src/lib/authState.js` | Session key caching |
