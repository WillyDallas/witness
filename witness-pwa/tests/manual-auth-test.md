# Identity & Wallet Integration Test Checklist

Run through this checklist to verify the auth flow works correctly.

## Prerequisites
- [ ] `.env` file created with valid Privy and Pimlico API keys
- [ ] `npm install` completed in `witness-pwa/`
- [ ] Dev server running: `npm run dev`

## Fresh Login Flow

### 1. Initial Load
- [ ] Login modal appears (not camera)
- [ ] "Witness Protocol" title displayed
- [ ] Email input field focused or visible
- [ ] No console errors

### 2. Email Entry
- [ ] Enter valid email address
- [ ] Click "Continue"
- [ ] "Sending..." state appears briefly
- [ ] Transitions to code entry step
- [ ] Email displayed in code entry step
- [ ] Verification email received (check inbox/spam)

### 3. Code Verification
- [ ] Enter 6-digit code
- [ ] Click "Verify"
- [ ] "Verifying..." state appears
- [ ] Transitions to loading state

### 4. Wallet Setup
- [ ] "Creating your wallet..." message appears
- [ ] "Setting up gasless transactions..." message appears
- [ ] "Securing your encryption keys..." message appears
- [ ] EIP-712 signature prompt appears in browser
- [ ] Signature prompt shows "Witness Protocol" domain
- [ ] Signature prompt shows purpose: "Derive master encryption key..."

### 5. Post-Login State
- [ ] Login modal disappears
- [ ] Wallet indicator appears (top-right)
- [ ] Address shows truncated (0x1234...5678)
- [ ] Green dot next to address
- [ ] Camera preview initializes
- [ ] Record button becomes enabled

## Session Restore Flow

### 6. Page Refresh
- [ ] Refresh the page (F5 or Cmd+R)
- [ ] "Checking session..." loading state appears briefly
- [ ] Auto-restores session (no email entry needed)
- [ ] Signature prompt appears for key re-derivation
- [ ] Camera initializes after signature

## Logout Flow

### 7. Logout
- [ ] Open recordings drawer
- [ ] "Sign Out" button visible at bottom
- [ ] Click "Sign Out"
- [ ] Login modal reappears
- [ ] Camera stops
- [ ] Wallet indicator hidden

## Error Handling

### 8. Invalid Email
- [ ] Enter invalid email (no @ sign)
- [ ] Click "Continue"
- [ ] Error message: "Please enter a valid email address"

### 9. Invalid Code
- [ ] Complete email step with valid email
- [ ] Enter wrong code (e.g., 000000)
- [ ] Click "Verify"
- [ ] Error message appears
- [ ] Can retry with correct code

### 10. Back Navigation
- [ ] On code entry step, click "Use a different email"
- [ ] Returns to email entry step
- [ ] Can enter new email

## Console Checks

### 11. No Errors
- [ ] Open browser DevTools Console
- [ ] No red errors related to Privy, viem, permissionless
- [ ] No uncaught exceptions

### 12. Smart Account Address
- [ ] In console, run: `window.witnessAuth` (if exposed)
- [ ] Or check Network tab for Pimlico API calls
- [ ] Verify smart account address is deterministic (same on refresh)

---

## Test Results

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| 1. Initial Load | | |
| 2. Email Entry | | |
| 3. Code Verification | | |
| 4. Wallet Setup | | |
| 5. Post-Login State | | |
| 6. Page Refresh | | |
| 7. Logout | | |
| 8. Invalid Email | | |
| 9. Invalid Code | | |
| 10. Back Navigation | | |
| 11. No Errors | | |
| 12. Smart Account Address | | |

**Tested by:** _______________
**Date:** _______________
**Browser/Device:** _______________
