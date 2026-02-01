// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WitnessRegistry
 * @notice On-chain registry for Witness Protocol users, groups, and content commitments
 * @dev Minimal on-chain footprint - heavy data lives on IPFS
 */
contract WitnessRegistry {
    // ============================================
    // STRUCTS
    // ============================================

    struct Group {
        address creator;
        uint64 createdAt;
        bool active;
    }

    struct ContentCommitment {
        bytes32 merkleRoot;
        string manifestCID;
        address uploader;
        uint64 timestamp;
    }

    // ============================================
    // STATE VARIABLES
    // ============================================

    // User registration
    mapping(address => bool) public registered;
    mapping(address => uint64) public registeredAt;

    // Group management
    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(address => bool)) public groupMembers;
    mapping(bytes32 => address[]) internal _groupMemberList;

    // Content commitments
    mapping(bytes32 => ContentCommitment) public content;
    mapping(bytes32 => bytes32[]) public contentGroups; // contentId => groupIds
    mapping(bytes32 => bytes32[]) public groupContent; // groupId => contentIds
    mapping(address => bytes32[]) public userContent; // user => contentIds

    // ============================================
    // EVENTS
    // ============================================

    event UserRegistered(address indexed user, uint64 timestamp);
    event GroupCreated(bytes32 indexed groupId, address indexed creator, uint64 timestamp);
    event GroupJoined(bytes32 indexed groupId, address indexed member, uint64 timestamp);
    event ContentCommitted(
        bytes32 indexed contentId,
        address indexed uploader,
        bytes32 merkleRoot,
        string manifestCID,
        uint64 timestamp
    );

    // ============================================
    // ERRORS
    // ============================================

    error AlreadyRegistered();
    error NotRegistered();
    error GroupAlreadyExists();
    error GroupDoesNotExist();
    error AlreadyMember();
    error NotMember();
    error ContentAlreadyExists();
    error EmptyManifestCID();
    error NoGroupsSpecified();
}
