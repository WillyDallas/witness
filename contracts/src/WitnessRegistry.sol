// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/**
 * @title WitnessRegistry
 * @notice On-chain registry for Witness Protocol with anonymous attestations
 * @dev Integrates Semaphore for ZK group membership proofs
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

    struct Session {
        address creator;
        bytes32 merkleRoot;
        string manifestCid;
        uint256 chunkCount;
        uint64 createdAt;
        uint64 updatedAt;
    }

    // ============================================
    // STATE VARIABLES
    // ============================================

    // Semaphore contract reference
    ISemaphore public semaphore;

    // User registration
    mapping(address => bool) public registered;
    mapping(address => uint64) public registeredAt;

    // Group management
    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(address => bool)) public groupMembers;
    mapping(bytes32 => address[]) internal _groupMemberList;

    // Semaphore group mapping (witnessGroupId => semaphoreGroupId)
    mapping(bytes32 => uint256) public semaphoreGroupId;

    // Content commitments
    mapping(bytes32 => ContentCommitment) public content;
    mapping(bytes32 => bytes32[]) public contentGroups;
    mapping(bytes32 => bytes32[]) public groupContent;
    mapping(address => bytes32[]) public userContent;

    // Session management (streaming video)
    mapping(bytes32 => Session) public sessions;
    mapping(bytes32 => bytes32[]) public sessionGroups;

    // Attestations
    mapping(bytes32 => uint256) public attestationCount; // contentId => count
    mapping(uint256 => bool) public nullifierUsed; // nullifier => used

    // ============================================
    // EVENTS
    // ============================================

    event UserRegistered(address indexed user, uint64 timestamp);
    event GroupCreated(bytes32 indexed groupId, address indexed creator, uint256 semaphoreGroupId, uint64 timestamp);
    event GroupJoined(bytes32 indexed groupId, address indexed member, uint256 identityCommitment, uint64 timestamp);
    event ContentCommitted(
        bytes32 indexed contentId,
        address indexed uploader,
        bytes32 merkleRoot,
        string manifestCID,
        uint64 timestamp
    );
    event AttestationCreated(
        bytes32 indexed contentId,
        bytes32 indexed groupId,
        uint256 newCount,
        uint64 timestamp
    );
    event SessionUpdated(
        bytes32 indexed sessionId,
        address indexed uploader,
        bytes32 merkleRoot,
        string manifestCid,
        uint256 chunkCount,
        bytes32[] groupIds,
        uint256 timestamp
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
    error ContentNotInGroup();
    error NullifierAlreadyUsed();
    error InvalidProof();
    error NotSessionCreator();
    error ZeroChunkCount();

    // ============================================
    // CONSTRUCTOR
    // ============================================

    /**
     * @notice Initialize with Semaphore contract address
     * @param _semaphore Address of deployed Semaphore contract
     */
    constructor(address _semaphore) {
        semaphore = ISemaphore(_semaphore);
    }

    // ============================================
    // USER REGISTRATION
    // ============================================

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
     * @notice Create a new group with parallel Semaphore group
     * @param groupId The keccak256 hash of the group secret
     * @param identityCommitment Creator's Semaphore identity commitment
     */
    function createGroup(bytes32 groupId, uint256 identityCommitment) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt != 0) revert GroupAlreadyExists();

        // Create Witness group
        groups[groupId] = Group({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            active: true
        });

        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        // Create parallel Semaphore group (WitnessRegistry becomes admin)
        // Capture returned group ID - Semaphore assigns IDs sequentially
        uint256 semGroupId = semaphore.createGroup();
        semaphoreGroupId[groupId] = semGroupId;

        // Add creator to Semaphore group
        semaphore.addMember(semGroupId, identityCommitment);

        emit GroupCreated(groupId, msg.sender, semGroupId, uint64(block.timestamp));
    }

    /**
     * @notice Join an existing group with identity commitment
     * @param groupId The group to join
     * @param identityCommitment Joiner's Semaphore identity commitment
     */
    function joinGroup(bytes32 groupId, uint256 identityCommitment) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt == 0) revert GroupDoesNotExist();
        if (groupMembers[groupId][msg.sender]) revert AlreadyMember();

        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        // Add to Semaphore group
        uint256 semGroupId = semaphoreGroupId[groupId];
        semaphore.addMember(semGroupId, identityCommitment);

        emit GroupJoined(groupId, msg.sender, identityCommitment, uint64(block.timestamp));
    }

    function getGroupMemberCount(bytes32 groupId) external view returns (uint256) {
        return _groupMemberList[groupId].length;
    }

    // ============================================
    // CONTENT COMMITMENT
    // ============================================

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

        for (uint256 i = 0; i < groupIds.length; i++) {
            if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
        }

        content[contentId] = ContentCommitment({
            merkleRoot: merkleRoot,
            manifestCID: manifestCID,
            uploader: msg.sender,
            timestamp: uint64(block.timestamp)
        });

        for (uint256 i = 0; i < groupIds.length; i++) {
            contentGroups[contentId].push(groupIds[i]);
            groupContent[groupIds[i]].push(contentId);
        }

        userContent[msg.sender].push(contentId);

        emit ContentCommitted(contentId, msg.sender, merkleRoot, manifestCID, uint64(block.timestamp));
    }

    // ============================================
    // SESSION MANAGEMENT (Streaming Video)
    // ============================================

    /**
     * @notice Create or update a streaming session
     * @param sessionId Unique identifier for the session
     * @param merkleRoot Current merkle root of all chunks
     * @param manifestCid IPFS CID of the current manifest
     * @param chunkCount Number of chunks uploaded so far
     * @param groupIds Groups that can access this session
     */
    function updateSession(
        bytes32 sessionId,
        bytes32 merkleRoot,
        string calldata manifestCid,
        uint256 chunkCount,
        bytes32[] calldata groupIds
    ) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (bytes(manifestCid).length == 0) revert EmptyManifestCID();
        if (groupIds.length == 0) revert NoGroupsSpecified();
        if (chunkCount == 0) revert ZeroChunkCount();

        // Validate caller is member of all groups
        for (uint256 i = 0; i < groupIds.length; i++) {
            if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
        }

        Session storage session = sessions[sessionId];

        if (session.createdAt == 0) {
            // New session
            session.creator = msg.sender;
            session.createdAt = uint64(block.timestamp);

            // Store group associations (only on creation)
            for (uint256 i = 0; i < groupIds.length; i++) {
                sessionGroups[sessionId].push(groupIds[i]);
            }
        } else {
            // Existing session - only creator can update
            if (session.creator != msg.sender) revert NotSessionCreator();
        }

        // Update mutable fields
        session.merkleRoot = merkleRoot;
        session.manifestCid = manifestCid;
        session.chunkCount = chunkCount;
        session.updatedAt = uint64(block.timestamp);

        emit SessionUpdated(
            sessionId,
            msg.sender,
            merkleRoot,
            manifestCid,
            chunkCount,
            groupIds,
            block.timestamp
        );
    }

    // ============================================
    // ATTESTATIONS (Anonymous via Semaphore)
    // ============================================

    /**
     * @notice Attest to content anonymously using ZK proof
     * @param contentId The content being attested to
     * @param groupId The group through which user is attesting
     * @param proof The Semaphore proof (includes nullifier)
     */
    function attestToContent(
        bytes32 contentId,
        bytes32 groupId,
        ISemaphore.SemaphoreProof calldata proof
    ) external {
        // Verify content is shared with this group
        // Check both contentGroups (regular content) and sessionGroups (streaming sessions)
        bool inGroup = false;

        // Check regular content groups
        bytes32[] memory groups_ = contentGroups[contentId];
        for (uint256 i = 0; i < groups_.length; i++) {
            if (groups_[i] == groupId) {
                inGroup = true;
                break;
            }
        }

        // Also check session groups (for streaming content)
        if (!inGroup) {
            bytes32[] memory sessionGroups_ = sessionGroups[contentId];
            for (uint256 i = 0; i < sessionGroups_.length; i++) {
                if (sessionGroups_[i] == groupId) {
                    inGroup = true;
                    break;
                }
            }
        }

        if (!inGroup) revert ContentNotInGroup();

        // Check nullifier not used (prevents double attestation)
        if (nullifierUsed[proof.nullifier]) revert NullifierAlreadyUsed();

        // Verify ZK proof via Semaphore
        uint256 semGroupId = semaphoreGroupId[groupId];
        semaphore.validateProof(semGroupId, proof);

        // Record attestation
        nullifierUsed[proof.nullifier] = true;
        attestationCount[contentId]++;

        emit AttestationCreated(contentId, groupId, attestationCount[contentId], uint64(block.timestamp));
    }

    /**
     * @notice Get attestation count for content
     * @param contentId The content ID
     * @return Number of attestations
     */
    function getAttestationCount(bytes32 contentId) external view returns (uint256) {
        return attestationCount[contentId];
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    function getUserContent(address user) external view returns (bytes32[] memory) {
        return userContent[user];
    }

    function getGroupContent(bytes32 groupId) external view returns (bytes32[] memory) {
        return groupContent[groupId];
    }

    function getContentGroups(bytes32 contentId) external view returns (bytes32[] memory) {
        return contentGroups[contentId];
    }

    function getSessionGroups(bytes32 sessionId) external view returns (bytes32[] memory) {
        return sessionGroups[sessionId];
    }

    function isSessionInGroup(bytes32 sessionId, bytes32 groupId) external view returns (bool) {
        bytes32[] memory groups_ = sessionGroups[sessionId];
        for (uint256 i = 0; i < groups_.length; i++) {
            if (groups_[i] == groupId) {
                return true;
            }
        }
        return false;
    }
}
