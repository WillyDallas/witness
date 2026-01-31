# Primus zkTLS Integration Reference

**Purpose**: Reference document for integrating Primus zkTLS into Witness Protocol. Captures research from brainstorming session for future implementation.

**Status**: Research complete, integration planned for post-MVP or as time allows.

---

## What is Primus zkTLS?

Primus (formerly PADO) creates **cryptographic proofs that data came from a specific HTTPS endpoint**. When you make an API request through their system, they generate a zero-knowledge proof that the response originated from that exact server—not fabricated.

**Core value for Witness Protocol**: Instead of "trust the app captured this GPS/timestamp", you get "here's a cryptographic proof this data came from Google's location API / a trusted time server."

---

## Official Resources

| Resource | URL |
|----------|-----|
| Documentation | https://docs.primuslabs.xyz |
| Developer Hub | https://docs.primuslabs.xyz/build/overview |
| Demo Repository | https://github.com/primus-labs/zktls-demo |
| AlphaNet App | https://app.primuslabs.xyz |
| Whitepaper (zkTLS) | Referenced in docs under "QuickSilver" |

---

## SDK Packages

### Web (JavaScript)

```bash
npm install @primuslabs/network-js-sdk
```

```javascript
import { PrimusNetwork } from "@primuslabs/network-js-sdk"
```

**Requirements**: Node.js 18+

### React Native

```bash
npm install @primuslabs/zktls-reactnative-core-sdk
```

**Version**: ^0.1.0 (as of Jan 2026)

**Requirements**: React Native 0.79+, React 19+

### Backend (Node.js)

```bash
npm install @primuslabs/network-core-sdk
```

Used for server-side signing of attestation requests.

---

## Integration Patterns

### Pattern 1: DApp Integration (Browser Extension)

User has Primus browser extension installed. SDK triggers extension to generate proofs.

**Pros**: Decentralized, no server needed
**Cons**: Requires extension install, not suitable for mobile PWA

### Pattern 2: Backend Integration (Server Signs)

Your server holds App Secret, signs attestation requests. Client SDK executes proofs.

**Pros**: Works without extension, mobile-friendly
**Cons**: Requires backend server, centralized signing

**For Witness Protocol**: Backend integration is the path for mobile/PWA.

---

## Demo Repository Structure

```
github.com/primus-labs/zktls-demo/
├── test-example/                    # Basic testing
├── production-example/              # Production setup (client + server)
│   ├── server/index.js             # Signs attestation requests
│   └── client/src/primus.js        # Web client
├── reactnative-core-sdk-example/   # React Native integration
├── core-sdk-example/               # Backend SDK
├── network-sdk-example/            # Network SDK variant
├── cex-example/                    # Centralized exchange demo
└── twitch-subscription-demo/       # Streaming service verification
```

---

## React Native Example (Key Code)

From `reactnative-core-sdk-example/App.tsx`:

```typescript
import { PrimusCoreSdk } from '@primuslabs/zktls-reactnative-core-sdk';

// Initialize
const result = await PrimusCoreSdk.init(appId, appSecret, env);
// env: 'production' or 'test'

// Create attestation request
const attestationRequest = {
    url: 'https://api.example.com/data',
    method: 'GET',
    header: { 'Content-Type': 'application/json' },
    body: '',
    parsePath: '$.dataField',  // JSON path to extract
    keyName: 'dataField'
};

// Sign the request
const signedRequest = await PrimusCoreSdk.sign(attestationRequest);

// Execute attestation (generates zkTLS proof)
const attestation = await PrimusCoreSdk.attest(signedRequest, 'proxytls');

// Verify the attestation
const verified = await PrimusCoreSdk.verify(attestation);
```

---

## Attestation Structure

When verification completes, Primus returns:

```json
{
    "attestor": "0x...",
    "taskId": "unique-task-id",
    "attestation": {
        "recipient": "0xUserWalletAddress",
        "request": {
            "url": "https://api.example.com/data",
            "method": "GET",
            "header": "...",
            "body": ""
        },
        "response": {
            "keyName": "dataField",
            "parsePath": "$.dataField",
            "data": "{\"dataField\": \"actual-value\"}",
            "attConditions": "..."
        },
        "timestamp": 1706640000,
        "additionParams": "..."
    }
}
```

**Key fields**:
- `data`: The actual response data that was verified
- `parsePath`: JSON path used to extract the verified field
- `timestamp`: When the attestation was created
- `attestor`: The Primus node that generated the proof

---

## Witness Protocol Use Cases

### 1. Verified Timestamp

**API**: WorldTimeAPI or similar trusted time source

```javascript
const attestationRequest = {
    url: 'https://worldtimeapi.org/api/ip',
    method: 'GET',
    header: {},
    body: '',
    parsePath: '$.utc_datetime',
    keyName: 'utc_datetime'
};
```

**Result**: Proof that timestamp came from WorldTimeAPI, not device clock.

### 2. Verified Location

**API**: Google Geolocation API (requires API key)

```javascript
const attestationRequest = {
    url: 'https://www.googleapis.com/geolocation/v1/geolocate?key=API_KEY',
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        // WiFi access points, cell towers, etc.
        wifiAccessPoints: [...]
    }),
    parsePath: '$.location',
    keyName: 'location'
};
```

**Result**: Proof that location came from Google's servers based on network signals.

**Challenge**: Need to capture WiFi/cell data on device, which may require native APIs (not available in PWA).

### 3. Device Attestation

**API**: Google Play Integrity / Apple DeviceCheck

This is more complex—requires native SDK integration to get the initial attestation token, then zkTLS can verify it came from Google/Apple.

---

## Setup Requirements

### 1. Register on Primus Developer Hub

1. Go to https://app.primuslabs.xyz (AlphaNet)
2. Connect wallet
3. Install Primus browser extension (for setup)
4. Create a project to get **App ID** and **App Secret**

### 2. Create Attestation Template (Optional)

Primus Marketplace has pre-built templates for common APIs. You can also create custom templates for specific endpoints.

### 3. AlphaNet Testing

- Network: Base chain (for fees)
- Deposit: ~0.000035 ETH per attestation
- Refunds: Automatic if attestation fails

---

## Integration Timeline Estimate

| Component | Time | Complexity |
|-----------|------|------------|
| Account setup + API keys | 30 min | Low |
| Backend signing server | 2-3 hours | Medium |
| Timestamp verification | 2 hours | Low |
| Location verification | 4-6 hours | Medium-High |
| Device attestation | 6-8 hours | High |
| **Total (timestamp only)** | **4-5 hours** | - |
| **Total (full integration)** | **12-16 hours** | - |

---

## Recommended Integration Path

### Phase 1: Timestamp Only (MVP+)

1. Set up Primus account, get App ID/Secret
2. Deploy simple signing server (Node.js, can run on same VPS)
3. On each chunk upload, get zkTLS proof of timestamp
4. Include proof in chunk metadata

This adds ~4 hours but gives immediate credibility boost.

### Phase 2: Location Verification (Post-MVP)

Requires more work due to:
- Need native access to WiFi/cell tower data
- Google Geolocation API has usage costs
- More complex proof generation

### Phase 3: Device Attestation (Future)

Requires:
- Expo/React Native (not PWA)
- Native SDK integration
- More complex verification flow

---

## Code Snippets for Future Implementation

### Signing Server (Node.js)

```javascript
// server/index.js
const express = require('express');
const { PrimusCoreSdk } = require('@primuslabs/network-core-sdk');

const app = express();
app.use(express.json());

const APP_ID = process.env.PRIMUS_APP_ID;
const APP_SECRET = process.env.PRIMUS_APP_SECRET;

app.post('/sign-attestation', async (req, res) => {
    try {
        const { attestationRequest } = req.body;
        const signed = await PrimusCoreSdk.sign(
            attestationRequest,
            APP_ID,
            APP_SECRET
        );
        res.json({ signed });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3001);
```

### Client Integration

```javascript
// In app.js - future addition

async function getVerifiedTimestamp() {
    // 1. Create attestation request
    const attestationRequest = {
        url: 'https://worldtimeapi.org/api/ip',
        method: 'GET',
        header: {},
        body: '',
        parsePath: '$.utc_datetime',
        keyName: 'utc_datetime'
    };

    // 2. Get signed request from our server
    const signResponse = await fetch('/api/sign-attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attestationRequest })
    });
    const { signed } = await signResponse.json();

    // 3. Execute attestation (client-side)
    const attestation = await PrimusNetwork.attest(signed);

    // 4. Return verified timestamp with proof
    return {
        timestamp: attestation.data.utc_datetime,
        proof: attestation
    };
}
```

---

## Contact & Support

- **Telegram**: Referenced in docs
- **Discord**: Referenced in docs
- **Hackathon sponsor**: Direct contact available

Since Primus is a hackathon sponsor, reaching out directly for:
- Fast App ID/Secret provisioning
- AlphaNet ETH for testing
- Technical support on integration

---

## Open Questions

1. **PWA limitations**: Can we use the JS SDK in a PWA, or does it require the browser extension?
2. **Mobile browser support**: Does zkTLS work in iOS Safari / Chrome Android?
3. **Location API alternatives**: Are there location APIs that don't require native WiFi/cell access?
4. **Offline handling**: What happens if zkTLS fails during recording? Fallback to unverified data?

These should be clarified with Primus team before deep integration.
