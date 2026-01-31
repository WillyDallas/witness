# Implementation Handoff: Identity & Wallet

> **For Claude:** Use `superpowers:executing-plans` skill to implement the plan at `docs/plans/Current/Wallet Creation/2026-02-01-identity-wallet.md`

---

## Context

You are implementing **Phase 1: Identity & Wallet** for Witness Protocol, a privacy-preserving evidence capture PWA. This adds:

- Privy email authentication with embedded wallet
- Kernel smart account (ERC-4337) with Pimlico paymaster
- Deterministic AES-256-GCM encryption key derivation
- Login-gated camera access

## Key Files to Read First

1. **The Plan**: `docs/plans/Current/Wallet Creation/2026-02-01-identity-wallet.md` - Follow this task-by-task
2. **Architecture Context**: `docs/planning/witness-protocol-architecture-v3.md` - Overall system design
3. **Integration Research**: `docs/research/Wallet-creation-paymaster-zkdid/privy-pimlico-zkdid-integration.md` - Technical details on Privy + Pimlico + key derivation
4. **Current PWA**: `witness-pwa/` - Existing pure HTML/JS app to migrate to Vite

## Before Starting: Verify Privy SDK

**IMPORTANT**: Before implementing Task 3 (Privy module), use Context7 to fetch current Privy vanilla JS SDK documentation:

```
Use mcp__plugin_context7_context7__resolve-library-id to find "@privy-io/js-sdk-core"
Then use mcp__plugin_context7_context7__query-docs to get:
1. "How to initialize Privy vanilla JS SDK with iframe for embedded wallet"
2. "Email authentication flow with sendCode and loginWithCode"
3. "Getting embedded wallet provider for signing"
```

The plan was written based on research docs that may be slightly outdated. Context7 will give you the latest API.

**Key things to verify:**
- Import paths for `@privy-io/js-sdk-core` (LocalStorage, getUserEmbeddedEthereumWallet, etc.)
- Iframe setup for embedded wallet secure context
- Provider acquisition for EIP-712 signing

## Tech Stack Decisions (Already Made)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Network | Ethereum Sepolia | Pimlico EntryPoint v0.7 support |
| Smart Wallet | Kernel (ZeroDev) | ERC-7579 module flexibility |
| Build Tool | Vite | Minimal config, hot reload |
| Auth Method | Email only | Simplest to test |
| Login Flow | Gate camera behind auth | Keys ready before recording |
| Key Derivation | Immediate after login | One signature prompt upfront |

## Environment Setup Required

The user needs to create accounts and get API keys:
- **Privy**: https://dashboard.privy.io → Create app → Get App ID + Client ID
- **Pimlico**: https://dashboard.pimlico.io → Create project → Get API Key

These go in `.env` (Task 1 in the plan).

## Execution Instructions

1. **Start with Task 1** (API key setup) - may need user input
2. **Task 2** (Vite setup) - restructures project, run `npm run dev` to verify
3. **Task 3** (Privy module) - **USE CONTEXT7 FIRST** to verify SDK API
4. **Tasks 4-6** (Smart account, encryption, auth state) - follow plan
5. **Tasks 7-8** (UI + integration) - connect everything
6. **Tasks 9-11** (Logout, env example, tests) - polish

After each task, run `npm run dev` and verify in browser before committing.

## Success Criteria

- [ ] Login modal appears on app load
- [ ] Email verification flow works
- [ ] Wallet indicator shows truncated address after login
- [ ] EIP-712 signature prompt appears for key derivation
- [ ] Camera initializes only after authentication
- [ ] Session restores on page refresh
- [ ] Logout returns to login modal

## Watch Out For

1. **Privy iframe timing**: The iframe must be appended to DOM before calling Privy methods
2. **Provider vs Client confusion**: Use Privy's EOA provider for signing, not the smart account client
3. **Signature normalization**: ECDSA signatures need low-s normalization for deterministic keys
4. **Vite env vars**: Must be prefixed with `VITE_` to be exposed to client code

---

**Start by invoking the `superpowers:executing-plans` skill, then use Context7 to verify Privy SDK documentation before Task 3.**
