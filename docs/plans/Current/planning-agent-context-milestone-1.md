# Handoff: Phase 8 Milestone 1 Implementation Planning

## Your Task

Write a detailed implementation plan for **Milestone 1: Contract Update** from the Phase 8 streaming video capture plan.

## Context to Read First

Read these files in order:

1. **The high-level plan** (what you're implementing):
   - `docs/plans/Current/2026-02-02-phase-8-streaming-video-capture.md`
   - Focus on the "Contract Updates" section and "Milestone 1" success criteria

2. **Current contract implementation** (what exists today):
   - `contracts/src/WitnessRegistry.sol`
   - Understand existing functions: `commitContent()`, group management, attestations

3. **Contract tests** (testing patterns):
   - `contracts/test/WitnessRegistry.t.sol`
   - Note the testing style, mock setup, and assertion patterns

4. **Deployment script** (how contracts are deployed):
   - `contracts/script/DeployWitnessRegistry.s.sol`

5. **Data chunking design** (technical context):
   - `docs/research/video-storage-and-transport/data-chunking-transport-design.md`
   - Section 7: "On-Chain Interface" has the proposed function signature

## Before Writing the Plan

**Use context7 to verify Solidity patterns**:

1. Search for `foundry testing` to confirm current best practices for:
   - Event testing
   - Access control testing
   - State update verification

2. Search for `solidity events` patterns for:
   - Indexed vs non-indexed parameters
   - Event emission in state-changing functions

3. Search for `ERC-4337 smart account` to understand:
   - How Pimlico paymaster transactions interact with contracts
   - Any considerations for `msg.sender` with smart accounts

## What the Plan Should Cover

The plan should use the `superpowers:writing-plans` skill format and include:

### Contract Changes
- New `updateSession()` function
- New `SessionUpdated` event
- Storage: `mapping(bytes32 => Session)` for session state
- How it relates to existing `commitContent()` (replace? parallel?)

### Test Cases
- Create session with first chunk
- Update session with subsequent chunks
- Verify merkle root overwrites correctly
- Verify manifest CID updates
- Verify `isContentInGroup()` works for attestation eligibility
- Access control: only session creator can update
- Edge cases: empty groupIds, zero chunkCount

### Deployment
- Update deployment script
- Verify on Basescan
- Update ABI in `witness-pwa/src/lib/abi/WitnessRegistry.json`

### Success Criteria
From Milestone 1:
- Deploy updated contract to Base Sepolia
- Call `updateSession()` 3 times with incrementing chunk counts
- Verify on-chain: final merkle root and manifest CID match last call
- Verify events: `SessionUpdated` emitted for each call
- Verify `isContentInGroup()` works for attestation eligibility

## Output Location

Write the detailed implementation plan to:
`docs/plans/Current/2026-02-02-milestone-1-contract-update-plan.md`

## Important Notes

- This is a hackathon project — no backward compatibility concerns
- The contract is already deployed; this will be a fresh deployment with new address
- After deployment, update the frontend ABI and contract address
- Use Foundry for all contract work (not Hardhat)
