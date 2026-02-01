// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/**
 * @title MockSemaphore
 * @notice A mock implementation of ISemaphore for testing WitnessRegistry
 */
contract MockSemaphore is ISemaphore {
    uint256 private _groupCounter;
    mapping(uint256 => address) public groupAdmins;
    mapping(uint256 => uint256[]) public groupMembers;
    mapping(uint256 => mapping(uint256 => bool)) public nullifiers;

    function groupCounter() external view returns (uint256) {
        return _groupCounter;
    }

    function createGroup() external returns (uint256) {
        _groupCounter++;
        groupAdmins[_groupCounter] = msg.sender;
        return _groupCounter;
    }

    function createGroup(address admin) external returns (uint256) {
        _groupCounter++;
        groupAdmins[_groupCounter] = admin;
        return _groupCounter;
    }

    function createGroup(address admin, uint256 /* merkleTreeDuration */) external returns (uint256) {
        _groupCounter++;
        groupAdmins[_groupCounter] = admin;
        return _groupCounter;
    }

    function updateGroupAdmin(uint256 /* groupId */, address /* newAdmin */) external pure {
        // Mock: no-op
    }

    function acceptGroupAdmin(uint256 /* groupId */) external pure {
        // Mock: no-op
    }

    function updateGroupMerkleTreeDuration(uint256 /* groupId */, uint256 /* newMerkleTreeDuration */) external pure {
        // Mock: no-op
    }

    function addMember(uint256 groupId, uint256 identityCommitment) external {
        groupMembers[groupId].push(identityCommitment);
    }

    function addMembers(uint256 groupId, uint256[] calldata identityCommitments) external {
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            groupMembers[groupId].push(identityCommitments[i]);
        }
    }

    function updateMember(
        uint256 /* groupId */,
        uint256 /* oldIdentityCommitment */,
        uint256 /* newIdentityCommitment */,
        uint256[] calldata /* merkleProofSiblings */
    ) external pure {
        // Mock: no-op
    }

    function removeMember(
        uint256 /* groupId */,
        uint256 /* identityCommitment */,
        uint256[] calldata /* merkleProofSiblings */
    ) external pure {
        // Mock: no-op
    }

    function validateProof(uint256 groupId, SemaphoreProof calldata proof) external {
        // Mock: just check nullifier hasn't been used
        if (nullifiers[groupId][proof.nullifier]) {
            revert Semaphore__YouAreUsingTheSameNullifierTwice();
        }
        nullifiers[groupId][proof.nullifier] = true;

        emit ProofValidated(
            groupId,
            proof.merkleTreeDepth,
            proof.merkleTreeRoot,
            proof.nullifier,
            proof.message,
            proof.scope,
            proof.points
        );
    }

    function verifyProof(uint256 groupId, SemaphoreProof calldata proof) external view returns (bool) {
        // Mock: return true if nullifier not used
        return !nullifiers[groupId][proof.nullifier];
    }

    // Helper for tests: get member count
    function getMemberCount(uint256 groupId) external view returns (uint256) {
        return groupMembers[groupId].length;
    }
}
