// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IAttestationManager} from "./interfaces/IAttestationManager.sol";
import {IZKConflictVerifier} from "./interfaces/IZKConflictVerifier.sol";

/// @title LegalEngagementEscrow (V2 — gas-reduced surface, operator-as-arbiter)
/// @notice The trust anchor for Lex Nova's asymmetric mechanism. The 2026-05-07
///         redesign moves milestone creation, delivery attestation, and refund
///         consent off chain — only ETH-moving actions and the cooldown anchor
///         remain on chain. The asymmetric dispute mechanism (Constitution
///         principle III + invariant 6) is preserved: the lawyer's escalation
///         cooldown is still contract-enforced via `markDelivered`'s timestamp.
///
///         The 2026-05-08 amendment (Constitution v2.0.0) collapses the
///         arbiter role into the operator address for the v3 demo scope:
///         `resolveDispute` gates on `msg.sender == operator`. The separated
///         arbiter pool (verified-arbiter capability, per-dispute assignment,
///         operator-as-arbiter forbidden) is explicit production trajectory.
///
///         Off-chain artifacts (committed via the engagement transcript root):
///         - MilestoneOffer: lawyer- or client-signed `{engagementId, amount,
///           note, nonce}`. Verified by the platform API before the client
///           submits `fundMilestone` calldata; the contract trusts the funded
///           amount and binds it to the new milestone atomically.
///         - DeliveryAttestation: lawyer-signed `{engagementId, milestoneIndex,
///           deliveredAt, message?}` posted into the chat. UX hint and
///           arbiter evidence; the contract does not consume it.
///         - MutualRefundAuthorization: both-parties-signed `{engagementId,
///           milestoneIndex}` over EIP-712 typed data; the contract verifies
///           both sigs in `mutualRefundMilestone`.
contract LegalEngagementEscrow is ReentrancyGuard, EIP712 {
    IAttestationManager public immutable attestationManager;
    IZKConflictVerifier public zkVerifier;
    address public immutable operator;

    uint64 public constant LAWYER_DISPUTE_COOLDOWN = 30 days;

    /// @dev EIP-712 typed-data hash for {MutualRefundAuthorization}. The
    ///      domain separator (chainId + verifyingContract) makes a sig from
    ///      one engagement unusable on a different one. Replay across
    ///      milestones in the same engagement is prevented by the on-chain
    ///      Funded → Refunded transition (single-shot).
    bytes32 private constant MUTUAL_REFUND_TYPEHASH =
        keccak256("MutualRefundAuthorization(uint256 engagementId,uint256 milestoneIndex)");

    enum EngagementState {
        None,
        Active,
        Closed
    }

    /// @dev V2 drops `Proposed` (no on-chain proposal step) and `Claimed`
    ///      (no first-claim mechanism) from the V1 enum. New milestones land
    ///      directly in `Funded` via `fundMilestone` /
    ///      `openEngagementAndFundFirstMilestone`.
    enum MilestoneState {
        None,
        Funded,
        Delivered,
        Released,
        Disputed,
        Resolved,
        Refunded
    }

    struct Milestone {
        uint256 amount;
        MilestoneState state;
        uint64 deliveredAt;
        uint256 amountToLawyer;
        uint256 amountToClient;
    }

    struct Engagement {
        address client;
        address lawyer;
        bytes32 matterRef;
        EngagementState state;
        bytes32 transcriptRoot;
        uint256 milestoneCount;
    }

    uint256 public nextEngagementId;
    mapping(uint256 => Engagement) private _engagements;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;
    mapping(address => bytes32) public lawyerConflictRoot;
    mapping(bytes32 => bool) public usedNullifiers;

    error NotEngagementClient();
    error NotEngagementLawyer();
    error NotEngagementParty();
    error NotVerifiedClient();
    error NotVerifiedLawyer();
    error CooldownNotElapsed(uint64 unlockAt);
    error InvalidMilestoneState();
    error InvalidEngagementState();
    error ConflictProofFailed();
    error NullifierAlreadyUsed();
    error InvalidSplit();
    error EthAmountMismatch();
    error EngagementNotClean();
    error TransferFailed();
    error OnlyOperator();
    error InvalidRefundSignature();

    event EngagementOpened(
        uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef
    );
    /// @dev V1 emitted MilestoneProposed + MilestoneFunded as separate events
    ///      racing through the indexer. V2 has only MilestoneFunded and
    ///      includes the amount inline so the indexer can populate state in
    ///      one log.
    event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount);
    event MilestoneDelivered(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint64 deliveredAt);
    event MilestoneReleased(uint256 indexed engagementId, uint256 indexed milestoneIndex);
    event MilestoneDisputed(uint256 indexed engagementId, uint256 indexed milestoneIndex, address by);
    event MilestoneResolved(
        uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 toLawyer, uint256 toClient
    );
    event MilestoneMutuallyRefunded(uint256 indexed engagementId, uint256 indexed milestoneIndex);
    event TranscriptAnchored(uint256 indexed engagementId, bytes32 root, uint256 blockNumber);
    event EngagementClosed(uint256 indexed engagementId);
    event ConflictRootSet(address indexed lawyer, bytes32 root);
    event ZKVerifierUpdated(address indexed previous, address indexed next);

    constructor(IAttestationManager _attestationManager, IZKConflictVerifier _zkVerifier, address _operator)
        EIP712("LexNovaEscrow", "1")
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

    modifier onlyVerifiedLawyer() {
        if (!attestationManager.hasCapability(msg.sender, attestationManager.SCHEMA_LAWYER())) {
            revert NotVerifiedLawyer();
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

    // ============================================================
    // Open + fund first milestone (atomic — single tx)
    // ============================================================

    function openEngagementAndFundFirstMilestone(
        address lawyer,
        bytes32 matterRef,
        uint256 amount,
        bytes calldata zkConflictProof,
        bytes32 zkNullifier,
        bytes32 initialTranscriptRoot
    ) external payable onlyVerifiedClient nonReentrant returns (uint256 engagementId) {
        if (!attestationManager.hasCapability(lawyer, attestationManager.SCHEMA_LAWYER())) {
            revert NotVerifiedLawyer();
        }
        if (msg.value != amount) revert EthAmountMismatch();
        if (usedNullifiers[zkNullifier]) revert NullifierAlreadyUsed();
        if (!zkVerifier.verifyProof(zkConflictProof, lawyerConflictRoot[lawyer], zkNullifier)) {
            revert ConflictProofFailed();
        }
        usedNullifiers[zkNullifier] = true;

        unchecked {
            engagementId = ++nextEngagementId;
        }
        _engagements[engagementId] = Engagement({
            client: msg.sender,
            lawyer: lawyer,
            matterRef: matterRef,
            state: EngagementState.Active,
            transcriptRoot: initialTranscriptRoot,
            milestoneCount: 1
        });
        _milestones[engagementId][0] = Milestone({
            amount: amount,
            state: MilestoneState.Funded,
            deliveredAt: 0,
            amountToLawyer: 0,
            amountToClient: 0
        });

        emit EngagementOpened(engagementId, msg.sender, lawyer, matterRef);
        emit MilestoneFunded(engagementId, 0, amount);
        emit TranscriptAnchored(engagementId, initialTranscriptRoot, block.number);
    }

    // ============================================================
    // Follow-up milestones — atomic create + fund (no propose step)
    // ============================================================

    /// @notice Client funds a new milestone in a single tx. The amount is
    ///         agreed off-chain via a signed `MilestoneOffer` exchanged in
    ///         the engagement transcript; the platform API verifies that
    ///         signature before submitting calldata. The contract binds the
    ///         funded amount to the new milestone index and returns it.
    function fundMilestone(uint256 engagementId, uint256 amount)
        external
        payable
        onlyEngagementClient(engagementId)
        nonReentrant
        returns (uint256 milestoneIndex)
    {
        Engagement storage e = _engagements[engagementId];
        if (e.state != EngagementState.Active) revert InvalidEngagementState();
        if (msg.value != amount) revert EthAmountMismatch();

        milestoneIndex = e.milestoneCount;
        unchecked {
            e.milestoneCount = milestoneIndex + 1;
        }
        _milestones[engagementId][milestoneIndex] = Milestone({
            amount: amount,
            state: MilestoneState.Funded,
            deliveredAt: 0,
            amountToLawyer: 0,
            amountToClient: 0
        });
        emit MilestoneFunded(engagementId, milestoneIndex, amount);
    }

    // ============================================================
    // markDelivered — optional, only used to start the cooldown clock
    // ============================================================

    /// @notice Optional: lawyer-only flag that timestamps the milestone as
    ///         delivered on chain. The happy path does NOT require this —
    ///         `releaseMilestone` accepts both `Funded` and `Delivered`. Its
    ///         sole purpose is to start the lawyer-side dispute cooldown
    ///         (see `escalateMilestone`); the lawyer calls this only when
    ///         they need to enable later escalation against an unresponsive
    ///         client.
    function markDelivered(uint256 engagementId, uint256 milestoneIndex)
        external
        onlyEngagementLawyer(engagementId)
    {
        Milestone storage m = _milestones[engagementId][milestoneIndex];
        if (m.state != MilestoneState.Funded) revert InvalidMilestoneState();
        m.state = MilestoneState.Delivered;
        m.deliveredAt = uint64(block.timestamp);
        emit MilestoneDelivered(engagementId, milestoneIndex, m.deliveredAt);
    }

    // ============================================================
    // Release — accepts Funded OR Delivered (V2 change)
    // ============================================================

    /// @notice Client releases the parked amount to the lawyer. V2 drops the
    ///         "must be Delivered" gate from V1 — the client can release as
    ///         soon as they're satisfied, without requiring the lawyer to
    ///         have called `markDelivered` first. This is the action that
    ///         eliminates the lawyer's tx in the happy path.
    function releaseMilestone(uint256 engagementId, uint256 milestoneIndex)
        external
        onlyEngagementClient(engagementId)
        nonReentrant
    {
        Milestone storage m = _milestones[engagementId][milestoneIndex];
        if (m.state != MilestoneState.Funded && m.state != MilestoneState.Delivered) {
            revert InvalidMilestoneState();
        }
        m.state = MilestoneState.Released;
        m.amountToLawyer = m.amount;
        emit MilestoneReleased(engagementId, milestoneIndex);
        _send(_engagements[engagementId].lawyer, m.amount);
    }

    // ============================================================
    // Mutual refund — both parties' EIP-712 sigs required
    // ============================================================

    /// @notice Refunds a Funded milestone to the client when both parties have
    ///         signed off-chain. V1's unilateral `refundUndeliveredMilestone`
    ///         is gone — the lawyer can no longer rage-yank a deposit, and
    ///         the client can no longer cancel work the lawyer has
    ///         (off-chain) attested as delivered. If the parties can't agree,
    ///         the path is `disputeMilestone` → arbiter resolution.
    function mutualRefundMilestone(
        uint256 engagementId,
        uint256 milestoneIndex,
        bytes calldata clientSignature,
        bytes calldata lawyerSignature
    ) external onlyEngagementParty(engagementId) nonReentrant {
        Milestone storage m = _milestones[engagementId][milestoneIndex];
        if (m.state != MilestoneState.Funded) revert InvalidMilestoneState();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(MUTUAL_REFUND_TYPEHASH, engagementId, milestoneIndex))
        );

        Engagement storage e = _engagements[engagementId];
        address recoveredClient = ECDSA.recover(digest, clientSignature);
        address recoveredLawyer = ECDSA.recover(digest, lawyerSignature);
        if (recoveredClient != e.client || recoveredLawyer != e.lawyer) {
            revert InvalidRefundSignature();
        }

        m.state = MilestoneState.Refunded;
        m.amountToClient = m.amount;
        emit MilestoneMutuallyRefunded(engagementId, milestoneIndex);
        _send(e.client, m.amount);
    }

    // ============================================================
    // Asymmetric dispute mechanism (constitution principle III + inv 6)
    // ============================================================

    /// @notice Client may dispute a Funded or Delivered milestone immediately.
    ///         No cooldown — that's the asymmetry. The fresh transcript root
    ///         is anchored atomically so the assigned arbiter sees the latest
    ///         message history at the moment the dispute opens.
    function disputeMilestone(uint256 engagementId, uint256 milestoneIndex, bytes32 transcriptRoot)
        external
        onlyEngagementClient(engagementId)
    {
        Milestone storage m = _milestones[engagementId][milestoneIndex];
        if (m.state != MilestoneState.Funded && m.state != MilestoneState.Delivered) {
            revert InvalidMilestoneState();
        }
        m.state = MilestoneState.Disputed;
        Engagement storage e = _engagements[engagementId];
        e.transcriptRoot = transcriptRoot;
        emit MilestoneDisputed(engagementId, milestoneIndex, msg.sender);
        emit TranscriptAnchored(engagementId, transcriptRoot, block.number);
    }

    /// @notice Lawyer may only escalate a Delivered milestone after the
    ///         30-day cooldown has elapsed since `markDelivered`. Cooldown is
    ///         contract-enforced (Inv 6). Anchors the transcript on the same
    ///         tx so the arbiter has a fresh root.
    function escalateMilestone(uint256 engagementId, uint256 milestoneIndex, bytes32 transcriptRoot)
        external
        onlyEngagementLawyer(engagementId)
    {
        Milestone storage m = _milestones[engagementId][milestoneIndex];
        if (m.state != MilestoneState.Delivered) revert InvalidMilestoneState();
        uint64 unlockAt = m.deliveredAt + LAWYER_DISPUTE_COOLDOWN;
        if (block.timestamp < unlockAt) revert CooldownNotElapsed(unlockAt);
        m.state = MilestoneState.Disputed;
        Engagement storage e = _engagements[engagementId];
        e.transcriptRoot = transcriptRoot;
        emit MilestoneDisputed(engagementId, milestoneIndex, msg.sender);
        emit TranscriptAnchored(engagementId, transcriptRoot, block.number);
    }

    // ============================================================
    // Dispute resolution — operator-as-arbiter for v3
    // ============================================================

    /// @notice The operator address resolves the dispute by specifying how
    ///         the parked amount is split between the lawyer and the client.
    ///         Constitution v2.0.0 (Session 2026-05-08) merged the arbiter
    ///         role into the operator for the v3 demo scope. Production
    ///         trajectory reintroduces a separated arbiter pool with
    ///         per-dispute assignment; the parties' dispute/escalate APIs
    ///         do not change between v3 and the production model.
    function resolveDispute(
        uint256 engagementId,
        uint256 milestoneIndex,
        uint256 amountToLawyer,
        uint256 amountToClient
    ) external nonReentrant onlyOperator {
        Milestone storage m = _milestones[engagementId][milestoneIndex];
        if (m.state != MilestoneState.Disputed) revert InvalidMilestoneState();
        if (amountToLawyer + amountToClient != m.amount) revert InvalidSplit();
        m.state = MilestoneState.Resolved;
        m.amountToLawyer = amountToLawyer;
        m.amountToClient = amountToClient;
        emit MilestoneResolved(engagementId, milestoneIndex, amountToLawyer, amountToClient);
        if (amountToLawyer > 0) _send(_engagements[engagementId].lawyer, amountToLawyer);
        if (amountToClient > 0) _send(_engagements[engagementId].client, amountToClient);
    }

    // ============================================================
    // Transcript anchoring — manual; lazy in practice (FR-025)
    // ============================================================

    /// @notice Standalone anchor entry point. V2 only invokes this from
    ///         `closeEngagement`, `disputeMilestone`, `escalateMilestone`
    ///         (atomically); kept callable so a party can manually anchor
    ///         in unusual flows without paying for an unrelated state-change
    ///         tx alongside it.
    function anchorTranscript(uint256 engagementId, bytes32 newRoot) external onlyEngagementParty(engagementId) {
        Engagement storage e = _engagements[engagementId];
        if (e.state != EngagementState.Active) revert InvalidEngagementState();
        e.transcriptRoot = newRoot;
        emit TranscriptAnchored(engagementId, newRoot, block.number);
    }

    // ============================================================
    // Engagement closure — only when clean; anchors final root
    // ============================================================

    function closeEngagement(uint256 engagementId, bytes32 finalTranscriptRoot)
        external
        onlyEngagementParty(engagementId)
    {
        Engagement storage e = _engagements[engagementId];
        if (e.state != EngagementState.Active) revert InvalidEngagementState();
        uint256 count = e.milestoneCount;
        for (uint256 i = 0; i < count; i++) {
            MilestoneState s = _milestones[engagementId][i].state;
            if (s != MilestoneState.Released && s != MilestoneState.Resolved && s != MilestoneState.Refunded) {
                revert EngagementNotClean();
            }
        }
        e.state = EngagementState.Closed;
        e.transcriptRoot = finalTranscriptRoot;
        emit TranscriptAnchored(engagementId, finalTranscriptRoot, block.number);
        emit EngagementClosed(engagementId);
    }

    // ============================================================
    // Conflict commitments
    // ============================================================

    function setConflictRoot(bytes32 root) external onlyVerifiedLawyer {
        lawyerConflictRoot[msg.sender] = root;
        emit ConflictRootSet(msg.sender, root);
    }

    // ============================================================
    // Operator-only ZK verifier swap (Phase 6 stub→real)
    // ============================================================

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

    function getMilestone(uint256 engagementId, uint256 milestoneIndex) external view returns (Milestone memory) {
        return _milestones[engagementId][milestoneIndex];
    }

    /// @notice Exposes the EIP-712 typehash for off-chain signers building
    ///         a `MutualRefundAuthorization`. The digest they sign is
    ///         `_hashTypedDataV4(keccak256(abi.encode(typehash, engId, msIdx)))`.
    function MUTUAL_REFUND_AUTHORIZATION_TYPEHASH() external pure returns (bytes32) {
        return MUTUAL_REFUND_TYPEHASH;
    }

    /// @notice Exposes the EIP-712 domain separator so off-chain wallets can
    ///         build the typed-data digest without calling `eth_chainId` and
    ///         re-deriving it.
    function eip712DomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ============================================================
    // Internal
    // ============================================================

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
