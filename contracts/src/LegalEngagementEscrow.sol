// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IAttestationManager} from "./interfaces/IAttestationManager.sol";
import {IZKConflictVerifier} from "./interfaces/IZKConflictVerifier.sol";

/// @title LegalEngagementEscrow
/// @notice Escrow + dispute mechanism for verified-pseudonymous legal
///         engagements. Implements:
///
///         - Asymmetric dispute mechanism (Constitution III, Inv 6):
///           clients dispute Funded or Delivered without cooldown; lawyers
///           may only escalate Delivered after 30 days, contract-enforced.
///         - Dual consultation model (FREE vs PAID): FREE engagements open
///           with no on-chain proposal; PAID engagements open atomically
///           with proposal index 0 funded.
///         - Lawyer-signed follow-up proposals: the lawyer signs an
///           EIP-712-typed offer artifact off-chain (binding amount, line
///           items + deliverables hash, nonce); the client funds via
///           fundProposal, the contract verifies the signature on chain.
///         - Mutual refund: both parties' EIP-712 sigs required to refund a
///           Funded proposal; never unilateral.
///         - Operator-as-arbiter resolveDispute with sum-equality require.
///         - Per-engagement Merkle transcript anchored on every funds-touching
///           event (Constitution Inv 5).
contract LegalEngagementEscrow is ReentrancyGuard, EIP712 {
    IAttestationManager public immutable attestationManager;
    IZKConflictVerifier public zkVerifier;
    address public immutable operator;

    uint64 public constant LAWYER_DISPUTE_COOLDOWN = 30 days;

    bytes32 private constant MUTUAL_REFUND_TYPEHASH =
        keccak256("MutualRefundAuthorization(uint256 engagementId,uint256 proposalIndex,bytes32 nonce)");

    bytes32 private constant PROPOSAL_OFFER_TYPEHASH =
        keccak256("ProposalOffer(uint256 engagementId,uint256 totalWei,bytes32 itemsHash,bytes32 nonce)");

    enum EngagementState {
        None,
        Active,
        Closed
    }

    enum ProposalState {
        None,
        Funded,
        Delivered,
        Released,
        Disputed,
        Resolved,
        Refunded
    }

    struct Engagement {
        address client;
        address lawyer;
        bytes32 matterRef;
        EngagementState state;
        bytes32 transcriptRoot;
        uint256 proposalCount;
        bool consultationPaid;
    }

    struct Proposal {
        uint256 amount;
        ProposalState state;
        uint64 deliveredAt;
        uint256 amountToLawyer;
        uint256 amountToClient;
    }

    uint256 public nextEngagementId;
    mapping(uint256 => Engagement) private _engagements;
    mapping(uint256 => mapping(uint256 => Proposal)) private _proposals;

    /// @dev Tracks consumed proposal-offer nonces so a single signed offer
    ///      cannot fund two proposals.
    mapping(bytes32 => bool) public consumedProposalNonces;

    mapping(address => bytes32) public lawyerConflictRoot;
    mapping(bytes32 => bool) public usedConflictNullifiers;

    error NotEngagementClient();
    error NotEngagementLawyer();
    error NotEngagementParty();
    error NotVerifiedClient();
    error NotVerifiedLawyer();
    error CooldownNotElapsed(uint64 unlockAt);
    error InvalidProposalState();
    error InvalidEngagementState();
    error ConflictProofFailed();
    error NullifierAlreadyUsed();
    error InvalidSplit();
    error EthAmountMismatch();
    error EngagementNotClean();
    error TransferFailed();
    error OnlyOperator();
    error InvalidRefundSignature();
    error InvalidOfferSignature();
    error NonceAlreadyUsed();

    event EngagementOpened(
        uint256 indexed engagementId,
        address indexed client,
        address indexed lawyer,
        bytes32 matterRef,
        bool consultationPaid
    );
    event ProposalFunded(uint256 indexed engagementId, uint256 indexed proposalIndex, uint256 amount);
    event ProposalDelivered(uint256 indexed engagementId, uint256 indexed proposalIndex, uint64 deliveredAt);
    event ProposalReleased(uint256 indexed engagementId, uint256 indexed proposalIndex);
    event ProposalDisputed(uint256 indexed engagementId, uint256 indexed proposalIndex, address by);
    event ProposalResolved(
        uint256 indexed engagementId, uint256 indexed proposalIndex, uint256 toLawyer, uint256 toClient
    );
    event ProposalRefunded(uint256 indexed engagementId, uint256 indexed proposalIndex);
    event TranscriptAnchored(uint256 indexed engagementId, bytes32 root, uint64 atBlock);
    event EngagementClosed(uint256 indexed engagementId);
    event ConflictRootSet(address indexed lawyer, bytes32 root);
    event ZKVerifierUpdated(address indexed previous, address indexed next);

    constructor(IAttestationManager _attestationManager, IZKConflictVerifier _zkVerifier, address _operator)
        EIP712("FirmusNovusEscrow", "1")
    {
        attestationManager = _attestationManager;
        zkVerifier = _zkVerifier;
        operator = _operator;
    }

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyVerifiedClient() {
        if (!attestationManager.hasCapability(msg.sender, attestationManager.SCHEMA_CLIENT())) {
            revert NotVerifiedClient();
        }
        _;
    }

    modifier onlyEngagementClient(uint256 engagementId) {
        if (_engagements[engagementId].client != msg.sender) revert NotEngagementClient();
        _;
    }

    modifier onlyEngagementLawyer(uint256 engagementId) {
        if (_engagements[engagementId].lawyer != msg.sender) revert NotEngagementLawyer();
        _;
    }

    modifier onlyEngagementParty(uint256 engagementId) {
        Engagement storage e = _engagements[engagementId];
        if (e.client != msg.sender && e.lawyer != msg.sender) revert NotEngagementParty();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    modifier cooldownElapsed(uint256 engagementId, uint256 proposalIndex) {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        uint64 unlockAt = p.deliveredAt + LAWYER_DISPUTE_COOLDOWN;
        if (block.timestamp < unlockAt) revert CooldownNotElapsed(unlockAt);
        _;
    }

    // ============================================================
    // Open free engagement (FR-013 — no on-chain funds at consultation)
    // ============================================================

    function openFreeEngagement(
        address lawyer,
        bytes32 matterRef,
        bytes calldata zkConflictProof,
        bytes32 zkNullifier,
        bytes32 initialTranscriptRoot
    ) external onlyVerifiedClient returns (uint256 engagementId) {
        _checkLawyerVerified(lawyer);
        _consumeConflictProof(lawyer, zkConflictProof, zkNullifier);

        unchecked {
            engagementId = ++nextEngagementId;
        }
        _engagements[engagementId] = Engagement({
            client: msg.sender,
            lawyer: lawyer,
            matterRef: matterRef,
            state: EngagementState.Active,
            transcriptRoot: initialTranscriptRoot,
            proposalCount: 0,
            consultationPaid: false
        });

        emit EngagementOpened(engagementId, msg.sender, lawyer, matterRef, false);
        emit TranscriptAnchored(engagementId, initialTranscriptRoot, uint64(block.number));
    }

    // ============================================================
    // Open paid engagement + fund consultation (FR-013 — atomic)
    // ============================================================

    function openPaidEngagementAndFundConsultation(
        address lawyer,
        bytes32 matterRef,
        uint256 amount,
        bytes calldata zkConflictProof,
        bytes32 zkNullifier,
        bytes32 initialTranscriptRoot
    ) external payable onlyVerifiedClient nonReentrant returns (uint256 engagementId) {
        _checkLawyerVerified(lawyer);
        if (msg.value != amount) revert EthAmountMismatch();
        _consumeConflictProof(lawyer, zkConflictProof, zkNullifier);

        unchecked {
            engagementId = ++nextEngagementId;
        }
        _engagements[engagementId] = Engagement({
            client: msg.sender,
            lawyer: lawyer,
            matterRef: matterRef,
            state: EngagementState.Active,
            transcriptRoot: initialTranscriptRoot,
            proposalCount: 1,
            consultationPaid: true
        });
        _proposals[engagementId][0] = Proposal({
            amount: amount,
            state: ProposalState.Funded,
            deliveredAt: 0,
            amountToLawyer: 0,
            amountToClient: 0
        });

        emit EngagementOpened(engagementId, msg.sender, lawyer, matterRef, true);
        emit ProposalFunded(engagementId, 0, amount);
        emit TranscriptAnchored(engagementId, initialTranscriptRoot, uint64(block.number));
    }

    // ============================================================
    // Fund follow-up proposal (verifies lawyer's EIP-712 offer signature)
    // ============================================================

    /// @notice Client funds a new proposal in a single tx. The amount,
    ///         line-items hash, and a nonce are bound into a signed offer the
    ///         lawyer issued off-chain. The contract verifies the signature
    ///         on chain — the platform API cannot fabricate or alter the
    ///         offer terms.
    function fundProposal(
        uint256 engagementId,
        uint256 amount,
        bytes32 itemsHash,
        bytes32 nonce,
        bytes calldata lawyerOfferSignature
    ) external payable onlyEngagementClient(engagementId) nonReentrant returns (uint256 proposalIndex) {
        Engagement storage e = _engagements[engagementId];
        if (e.state != EngagementState.Active) revert InvalidEngagementState();
        if (msg.value != amount) revert EthAmountMismatch();
        if (consumedProposalNonces[nonce]) revert NonceAlreadyUsed();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(PROPOSAL_OFFER_TYPEHASH, engagementId, amount, itemsHash, nonce))
        );
        address signer = ECDSA.recover(digest, lawyerOfferSignature);
        if (signer != e.lawyer) revert InvalidOfferSignature();
        consumedProposalNonces[nonce] = true;

        proposalIndex = e.proposalCount;
        unchecked {
            e.proposalCount = proposalIndex + 1;
        }
        _proposals[engagementId][proposalIndex] = Proposal({
            amount: amount,
            state: ProposalState.Funded,
            deliveredAt: 0,
            amountToLawyer: 0,
            amountToClient: 0
        });
        emit ProposalFunded(engagementId, proposalIndex, amount);
    }

    // ============================================================
    // markDelivered — optional, lawyer-only; starts the cooldown clock
    // ============================================================

    function markDelivered(uint256 engagementId, uint256 proposalIndex)
        external
        onlyEngagementLawyer(engagementId)
    {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        if (p.state != ProposalState.Funded) revert InvalidProposalState();
        p.state = ProposalState.Delivered;
        p.deliveredAt = uint64(block.timestamp);
        emit ProposalDelivered(engagementId, proposalIndex, p.deliveredAt);
    }

    // ============================================================
    // Release — accepts Funded or Delivered (V2 happy path)
    // ============================================================

    function releaseProposal(uint256 engagementId, uint256 proposalIndex)
        external
        onlyEngagementClient(engagementId)
        nonReentrant
    {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        if (p.state != ProposalState.Funded && p.state != ProposalState.Delivered) {
            revert InvalidProposalState();
        }
        p.state = ProposalState.Released;
        p.amountToLawyer = p.amount;
        emit ProposalReleased(engagementId, proposalIndex);
        _send(_engagements[engagementId].lawyer, p.amount);
    }

    // ============================================================
    // Mutual refund — both parties' EIP-712 sigs required
    // ============================================================

    function mutualRefundProposal(
        uint256 engagementId,
        uint256 proposalIndex,
        bytes32 nonce,
        bytes calldata clientSignature,
        bytes calldata lawyerSignature
    ) external onlyEngagementParty(engagementId) nonReentrant {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        if (p.state != ProposalState.Funded) revert InvalidProposalState();
        if (consumedProposalNonces[nonce]) revert NonceAlreadyUsed();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(MUTUAL_REFUND_TYPEHASH, engagementId, proposalIndex, nonce))
        );
        Engagement storage e = _engagements[engagementId];
        address recoveredClient = ECDSA.recover(digest, clientSignature);
        address recoveredLawyer = ECDSA.recover(digest, lawyerSignature);
        if (recoveredClient != e.client || recoveredLawyer != e.lawyer) {
            revert InvalidRefundSignature();
        }
        consumedProposalNonces[nonce] = true;

        p.state = ProposalState.Refunded;
        p.amountToClient = p.amount;
        emit ProposalRefunded(engagementId, proposalIndex);
        _send(e.client, p.amount);
    }

    // ============================================================
    // Asymmetric dispute mechanism (Constitution III, Inv 6)
    // ============================================================

    function disputeProposal(uint256 engagementId, uint256 proposalIndex, bytes32 transcriptRoot)
        external
        onlyEngagementClient(engagementId)
    {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        if (p.state != ProposalState.Funded && p.state != ProposalState.Delivered) {
            revert InvalidProposalState();
        }
        p.state = ProposalState.Disputed;
        Engagement storage e = _engagements[engagementId];
        e.transcriptRoot = transcriptRoot;
        emit ProposalDisputed(engagementId, proposalIndex, msg.sender);
        emit TranscriptAnchored(engagementId, transcriptRoot, uint64(block.number));
    }

    function escalateProposal(uint256 engagementId, uint256 proposalIndex, bytes32 transcriptRoot)
        external
        onlyEngagementLawyer(engagementId)
        cooldownElapsed(engagementId, proposalIndex)
    {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        if (p.state != ProposalState.Delivered) revert InvalidProposalState();
        p.state = ProposalState.Disputed;
        Engagement storage e = _engagements[engagementId];
        e.transcriptRoot = transcriptRoot;
        emit ProposalDisputed(engagementId, proposalIndex, msg.sender);
        emit TranscriptAnchored(engagementId, transcriptRoot, uint64(block.number));
    }

    // ============================================================
    // Resolve dispute — operator-as-arbiter; sum-equality required
    // ============================================================

    function resolveDispute(
        uint256 engagementId,
        uint256 proposalIndex,
        uint256 amountToLawyer,
        uint256 amountToClient
    ) external nonReentrant onlyOperator {
        Proposal storage p = _proposals[engagementId][proposalIndex];
        if (p.state != ProposalState.Disputed) revert InvalidProposalState();
        if (amountToLawyer + amountToClient != p.amount) revert InvalidSplit();
        p.state = ProposalState.Resolved;
        p.amountToLawyer = amountToLawyer;
        p.amountToClient = amountToClient;
        emit ProposalResolved(engagementId, proposalIndex, amountToLawyer, amountToClient);
        if (amountToLawyer > 0) _send(_engagements[engagementId].lawyer, amountToLawyer);
        if (amountToClient > 0) _send(_engagements[engagementId].client, amountToClient);
    }

    // ============================================================
    // Transcript anchoring + close
    // ============================================================

    function anchorTranscript(uint256 engagementId, bytes32 newRoot)
        external
        onlyEngagementParty(engagementId)
    {
        Engagement storage e = _engagements[engagementId];
        if (e.state != EngagementState.Active) revert InvalidEngagementState();
        e.transcriptRoot = newRoot;
        emit TranscriptAnchored(engagementId, newRoot, uint64(block.number));
    }

    function closeEngagement(uint256 engagementId, bytes32 finalTranscriptRoot)
        external
        onlyEngagementParty(engagementId)
    {
        Engagement storage e = _engagements[engagementId];
        if (e.state != EngagementState.Active) revert InvalidEngagementState();
        uint256 count = e.proposalCount;
        for (uint256 i = 0; i < count; i++) {
            ProposalState s = _proposals[engagementId][i].state;
            if (s != ProposalState.Released && s != ProposalState.Resolved && s != ProposalState.Refunded) {
                revert EngagementNotClean();
            }
        }
        e.state = EngagementState.Closed;
        e.transcriptRoot = finalTranscriptRoot;
        emit TranscriptAnchored(engagementId, finalTranscriptRoot, uint64(block.number));
        emit EngagementClosed(engagementId);
    }

    // ============================================================
    // Conflict commitments + ZK verifier swap
    // ============================================================

    function setConflictRoot(bytes32 root) external {
        if (!attestationManager.hasCapability(msg.sender, attestationManager.SCHEMA_LAWYER())) {
            revert NotVerifiedLawyer();
        }
        lawyerConflictRoot[msg.sender] = root;
        emit ConflictRootSet(msg.sender, root);
    }

    function setZKVerifier(IZKConflictVerifier next) external onlyOperator {
        address prev = address(zkVerifier);
        zkVerifier = next;
        emit ZKVerifierUpdated(prev, address(next));
    }

    // ============================================================
    // Views
    // ============================================================

    function getEngagement(uint256 engagementId) external view returns (Engagement memory) {
        return _engagements[engagementId];
    }

    function getProposal(uint256 engagementId, uint256 proposalIndex) external view returns (Proposal memory) {
        return _proposals[engagementId][proposalIndex];
    }

    function MUTUAL_REFUND_AUTHORIZATION_TYPEHASH() external pure returns (bytes32) {
        return MUTUAL_REFUND_TYPEHASH;
    }

    function PROPOSAL_OFFER_TYPEHASH_VIEW() external pure returns (bytes32) {
        return PROPOSAL_OFFER_TYPEHASH;
    }

    function eip712DomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============================================================
    // Internal
    // ============================================================

    function _checkLawyerVerified(address lawyer) private view {
        if (!attestationManager.hasCapability(lawyer, attestationManager.SCHEMA_LAWYER())) {
            revert NotVerifiedLawyer();
        }
    }

    function _consumeConflictProof(address lawyer, bytes calldata proof, bytes32 nullifier) private {
        if (usedConflictNullifiers[nullifier]) revert NullifierAlreadyUsed();
        if (!zkVerifier.verifyProof(proof, lawyerConflictRoot[lawyer], nullifier)) {
            revert ConflictProofFailed();
        }
        usedConflictNullifiers[nullifier] = true;
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
