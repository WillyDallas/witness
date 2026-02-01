# Planning Agent Context: Milestone 6 — Playback Updates

## Your Task

Write a detailed implementation plan for **Milestone 6: Playback Updates** from the Phase 8 streaming video capture plan.

## Context to Read First

Read these files in order:

1. **The high-level plan** (what you're implementing):
   - `docs/plans/Current/2026-02-02-phase-8-streaming-video-capture.md`
   - Focus on "Verification & Playback" section and "Milestone 6" success criteria

2. **Existing content detail UI**:
   - `witness-pwa/src/ui/contentDetail.js`
   - Current download/decrypt flow

3. **Data chunking design** (verification flow):
   - `docs/research/video-storage-and-transport/data-chunking-transport-design.md`
   - Section: "Verification Flow"

4. **Manifest structure**:
   - Same doc, Section 5: "Manifest Structure"
   - `VideoManifest` and `ChunkMetadata` interfaces

5. **Existing decryption code**:
   - `witness-pwa/src/lib/storage.js` — key unwrapping
   - Current content decryption patterns

## Before Writing the Plan

**Use context7 to verify patterns**:

1. Search for `Blob concatenate javascript` to understand:
   - Combining multiple Blobs into one
   - Memory considerations for large files

2. Search for `video element blob URL` to understand:
   - `URL.createObjectURL()` for playback
   - Cleanup with `URL.revokeObjectURL()`

3. Search for `HKDF Web Crypto` to understand:
   - Deriving per-chunk keys from session key
   - Key derivation for decryption

## Playback Strategy

**For hackathon scope: Download All → Concatenate → Play**

```
1. Fetch manifest from IPFS (manifestCid from chain)
2. Verify manifest.merkleRoot matches on-chain root
3. For each chunk in manifest.chunks:
   a. Fetch encrypted chunk from IPFS (chunk.cid)
   b. Verify SHA256(encrypted) === chunk.encryptedHash
   c. Unwrap session key using groupSecret
   d. Derive chunkKey = HKDF(sessionKey, chunk.index)
   e. Decrypt: raw = AES-GCM-decrypt(chunkKey, chunk.iv, encrypted)
   f. Verify SHA256(raw) === chunk.plaintextHash
4. Concatenate all raw chunks → single Blob
5. Create object URL, set as <video> src
6. Play
```

## What the Plan Should Cover

Use the `superpowers:writing-plans` skill format:

### Content Detail Updates
- Show chunk count and total duration
- Show per-chunk verification status
- Progress indicator during download/decrypt

### Download Flow
- Parallel vs sequential chunk downloads
- Progress tracking (X of Y chunks)
- Error handling (retry individual chunks)

### Decryption Flow
- Unwrap session key (once per session)
- Derive chunk keys (HKDF)
- Decrypt each chunk
- Verify plaintext hash matches

### Verification UI
- Show merkle root verification status
- Show per-chunk hash verification
- Overall verification badge

### Playback
- Concatenate decrypted Blobs
- Create object URL
- Video player controls
- Cleanup on unmount

### Memory Considerations
- For hackathon: load all into memory (fine for <5 min videos)
- Note for future: streaming playback for long videos

## Test Cases

- Record 5-chunk video on Device A
- Open content detail on Device B (same group)
- Verify shows "5 chunks, ~50 seconds"
- Verify merkle root validation passes
- Download and decrypt all chunks
- Verify video plays without corruption
- Verify no gaps between chunks
- Test with different group (should fail to decrypt)

## Success Criteria

From Milestone 6:
- Update content detail for chunked content
- Download → decrypt → concatenate → play
- **Test**: Record on Device A, play on Device B

## Output Location

Write the detailed implementation plan to:
`docs/plans/Current/2026-02-02-milestone-6-playback-plan.md`

## Important Notes

- This completes the full loop: record → upload → anchor → download → verify → play
- Attestation system should work on completed recordings after this
- Keep playback simple — MSE streaming is post-hackathon
- Test cross-device to verify group key sharing works
