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

    // ============================================
    // USER REGISTRATION
    // ============================================

    /**
     * @notice Register the caller as a Witness Protocol user
     * @dev Emits UserRegistered event
     */
    function register() external {
        if (registered[msg.sender]) revert AlreadyRegistered();

        registered[msg.sender] = true;
        registeredAt[msg.sender] = uint64(block.timestamp);

        emit UserRegistered(msg.sender, uint64(block.timestamp));
    }

    // ============================================
    // GROUP MANAGEMENT
    // ============================================

    /**
     * @notice Create a new group
     * @param groupId The keccak256 hash of the group secret
     * @dev Caller must be registered. Creator is automatically added as member.
     */
    function createGroup(bytes32 groupId) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt != 0) revert GroupAlreadyExists();

        groups[groupId] = Group({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            active: true
        });

        // Creator is automatically a member
        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        emit GroupCreated(groupId, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Join an existing group
     * @param groupId The group to join
     * @dev Caller must be registered and group must exist
     */
    function joinGroup(bytes32 groupId) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt == 0) revert GroupDoesNotExist();
        if (groupMembers[groupId][msg.sender]) revert AlreadyMember();

        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        emit GroupJoined(groupId, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Get the number of members in a group
     * @param groupId The group to query
     * @return The number of members
     */
    function getGroupMemberCount(bytes32 groupId) external view returns (uint256) {
        return _groupMemberList[groupId].length;
    }

    // ============================================
    // CONTENT COMMITMENT
    // ============================================

    /**
     * @notice Commit content to the registry
     * @param contentId Unique identifier for the content
     * @param merkleRoot Merkle root of content chunks
     * @param manifestCID IPFS CID of the content manifest
     * @param groupIds Groups to share this content with
     * @dev Caller must be registered and member of all specified groups
     */
    function commitContent(
        bytes32 contentId,
        bytes32 merkleRoot,
        string calldata manifestCID,
        bytes32[] calldata groupIds
    ) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (content[contentId].timestamp != 0) revert ContentAlreadyExists();
        if (bytes(manifestCID).length == 0) revert EmptyManifestCID();
        if (groupIds.length == 0) revert NoGroupsSpecified();

        // Verify caller is member of all groups
        for (uint256 i = 0; i < groupIds.length; i++) {
            if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
        }

        // Store content commitment
        content[contentId] = ContentCommitment({
            merkleRoot: merkleRoot,
            manifestCID: manifestCID,
            uploader: msg.sender,
            timestamp: uint64(block.timestamp)
        });

        // Index content under each group
        for (uint256 i = 0; i < groupIds.length; i++) {
            contentGroups[contentId].push(groupIds[i]);
            groupContent[groupIds[i]].push(contentId);
        }

        // Index under user
        userContent[msg.sender].push(contentId);

        emit ContentCommitted(contentId, msg.sender, merkleRoot, manifestCID, uint64(block.timestamp));
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Get all content IDs for a user
     * @param user The user address
     * @return Array of content IDs
     */
    function getUserContent(address user) external view returns (bytes32[] memory) {
        return userContent[user];
    }

    /**
     * @notice Get all content IDs for a group
     * @param groupId The group ID
     * @return Array of content IDs
     */
    function getGroupContent(bytes32 groupId) external view returns (bytes32[] memory) {
        return groupContent[groupId];
    }

    /**
     * @notice Get all groups a content is shared with
     * @param contentId The content ID
     * @return Array of group IDs
     */
    function getContentGroups(bytes32 contentId) external view returns (bytes32[] memory) {
        return contentGroups[contentId];
    }
}
