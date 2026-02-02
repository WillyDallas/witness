# Witness Protocol - Speaker Notes

**Total time:** 3 minutes (demo) + 2 minutes (Q&A)

---

## Slide 1: The Problem (10 seconds)

**What you say:**
> "Maria is documenting abuse. She records video evidence on her phone. Her abuser finds it, deletes everything. Cloud backups? He has her password. It's gone."

**Emotion:** Tension — real people face real danger.

**Tip:** Let this land. Don't rush.

---

## Slide 2: The Solution (10 seconds)

**What you say:**
> "What if evidence couldn't be deleted? What if trusted people could vouch for it — without revealing who they are?"

> "That's Witness Protocol: encrypted, decentralized, anonymously verified evidence."

**Emotion:** Hope — technology can protect them.

---

## Slide 3: How It Works (20-30 seconds)

**What you say:**
> "Here's the flow: You record video. Each chunk is immediately encrypted with AES-256 and uploaded to IPFS. A merkle root anchors everything on-chain with a timestamp."

> "If your phone is seized mid-recording — the evidence is already safe."

> "Trusted contacts can decrypt and view your evidence. And they can *attest* — anonymously vouch that they've seen it using Semaphore zero-knowledge proofs."

**Key technical points (if asked):**
- Privy for wallet auth (gasless UX)
- Base Sepolia for on-chain proofs
- IPFS + Pinata for decentralized storage
- Semaphore V4 for ZK attestations

---

## Slide 4: Live Demo (2 minutes)

**What you show:**
1. **Login** — Email auth creates embedded wallet (5 sec)
2. **Start recording** — Show chunked upload happening in real-time
3. **Share with trusted contact** — QR code exchange
4. **View as trusted contact** — Decrypt and watch
5. **Attest** — One-tap anonymous vouch

**What you say during demo:**
> "Let me show you... I'm recording. Watch the chunks upload in real-time."
>
> "Now I'll share with a trusted contact..." [show QR flow]
>
> "They can see my evidence and vouch for it. But nobody knows *who* vouched — only *how many*."

**If something fails:** Have backup screenshots ready. Say "The live network is temperamental — let me show you what that looks like."

---

## Slide 5: The Close (10 seconds)

**What you say:**
> "Censorship-resistant evidence for journalists protecting sources, activists documenting injustice, and survivors whose evidence can't be deleted."

> "This is Witness Protocol. Thank you."

**Emotion:** Inspiration — this matters.

---

## Q&A Prep (Common Questions)

**"What happens if I lose my phone?"**
> Encryption keys are derived from your wallet signature. As long as you can recover your wallet, you can recover your keys.

**"Why blockchain?"**
> Immutable timestamps. Nobody can claim the evidence was fabricated yesterday. The merkle root proves when it was created.

**"Why ZK proofs for attestation?"**
> Privacy. In domestic abuse cases, revealing that someone vouched could put them at risk. We want attestation *count* without attestor *identity*.

**"What about video deepfakes?"**
> Great question. Future versions could integrate provenance attestation at capture time. Right now, we're solving the *deletion* problem.

**"Is this usable now?"**
> It's a hackathon prototype, but the core loop works: capture, encrypt, store, share, attest. We're deployed at witness.squirrlylabs.xyz.

---

## One-Liner (Pick One)

- "Evidence that can't be deleted, can't be altered, can be verified anonymously."
- "Encrypted. Decentralized. Anonymously verified."
- "Your evidence, unstoppable."
