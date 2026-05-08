# Solidity Contract Surface

Three Solidity contracts plus one auto-generated Noir verifier. Solidity 0.8.28, OpenZeppelin Contracts v5.2.0.

## `AttestationManager.sol`

Thin wrapper over EAS that the rest of the system reads through. Owns the operator role and the three EAS schema UIDs.

```solidity
interface IAttestationManager {
    function SCHEMA_LAWYER() external view returns (bytes32);
    function SCHEMA_CLIENT() external view returns (bytes32);
    function SCHEMA_ARBITER() external view returns (bytes32);

    function hasCapability(address subject, bytes32 schemaId) external view returns (bool);

    // Operator-only, MUST be invoked only from the platform's onboarding code path
    // after the credential presentation has succeeded. The contract does not verify
    // the credential itself — the privilege boundary is enforced by the operator
    // not having a way to issue this from the admin UI without a presentation.
    function attestVerifiedLawyer(
        address subject,
        string calldata jurisdiction,
        string calldata barAdmissionNumber,
        uint64 admittedAt,
        uint64 validUntil
    ) external;

    function attestVerifiedClient(
        address subject,
        string calldata countryOfResidence,
        bool ageOver18
    ) external;

    // Operator-only, granted only to wallets that already hold verified_lawyer.
    function attestVerifiedArbiter(address subject, string calldata note) external;

    function revokeCapability(address subject, bytes32 schemaId) external;
}
```

**Modifiers**:
- `onlyOperator` — `require(msg.sender == operator, "not operator")`.
- `onlyLawyerHolder(address)` — used by `attestVerifiedArbiter` to require the subject already has `verified_lawyer`. Encodes FR-007 at the contract level.

**Events**: `Attested(address subject, bytes32 schemaId, bytes32 attestationUid)`, `Revoked(address subject, bytes32 schemaId)`.

## `LegalEngagementEscrow.sol`

The core contract. Holds milestone funds, enforces the asymmetric mechanism, anchors transcripts.

```solidity
uint64 constant LAWYER_DISPUTE_COOLDOWN = 30 days;

interface ILegalEngagementEscrow {
    enum EngagementState { Active, Closed }
    enum MilestoneState { Proposed, Funded, Delivered, Released, Disputed, Claimed, Resolved, Refunded }

    struct Milestone {
        uint256 amount;
        MilestoneState state;
        uint64 deliveredAt;
        address arbiter;
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

    // ========== Engagement lifecycle ==========

    /// @notice Open a new engagement and fund its first milestone in a single tx.
    /// @dev Reverts unless:
    ///      - msg.sender holds verified_client (via AttestationManager.hasCapability)
    ///      - lawyer holds verified_lawyer
    ///      - the conflict-of-interest non-membership proof verifies against
    ///        lawyerConflictRoot[lawyer]
    ///      - msg.value == amount
    /// @return engagementId the freshly minted engagement id
    function openEngagementAndFundFirstMilestone(
        address lawyer,
        bytes32 matterRef,
        uint256 amount,
        bytes calldata zkConflictProof,
        bytes32 zkNullifier,
        bytes32 initialTranscriptRoot
    ) external payable returns (uint256 engagementId);

    // ========== Milestone iteration (after the first) ==========

    /// @notice Propose a follow-up milestone within an active engagement. No funds move.
    /// @dev Either party may call. Records the proposed amount.
    function proposeMilestone(uint256 engagementId, uint256 amount) external returns (uint256 milestoneIndex);

    /// @notice Client funds a previously proposed milestone.
    /// @dev Reverts if the proposing side wasn't the lawyer (per spec FR-011d, follow-up
    ///      proposals can come from either party but client-side acceptance is funding it).
    function fundMilestone(uint256 engagementId, uint256 milestoneIndex) external payable;

    /// @notice Lawyer marks a funded milestone as delivered. Records deliveredAt = block.timestamp.
    function markDelivered(uint256 engagementId, uint256 milestoneIndex) external;

    /// @notice Client releases a delivered milestone. Funds move to the lawyer.
    function releaseMilestone(uint256 engagementId, uint256 milestoneIndex) external;

    /// @notice Either party requests a refund of a funded-but-undelivered milestone.
    ///         Funds return to the client. The milestone moves to Refunded.
    function refundUndeliveredMilestone(uint256 engagementId, uint256 milestoneIndex) external;

    // ========== Asymmetric dispute mechanism ==========

    /// @notice Client disputes a Funded or Delivered milestone. Immediate; no cooldown.
    /// @dev require(msg.sender == engagement.client)
    function disputeMilestone(uint256 engagementId, uint256 milestoneIndex) external;

    /// @notice Lawyer escalates a Delivered milestone after cooldown.
    /// @dev require(msg.sender == engagement.lawyer)
    /// @dev require(milestone.state == Delivered)
    /// @dev require(block.timestamp >= milestone.deliveredAt + LAWYER_DISPUTE_COOLDOWN)
    function escalateMilestone(uint256 engagementId, uint256 milestoneIndex) external;

    // ========== Arbiter resolution (first-claim) ==========

    /// @notice Any verified-arbiter wallet may claim a Disputed milestone.
    /// @dev require(milestone.state == Disputed && milestone.arbiter == address(0))
    /// @dev require(attestationManager.hasCapability(msg.sender, SCHEMA_ARBITER))
    function claimDispute(uint256 engagementId, uint256 milestoneIndex) external;

    /// @notice The claiming arbiter resolves with a split.
    /// @dev require(milestone.state == Claimed && msg.sender == milestone.arbiter)
    /// @dev require(amountToLawyer + amountToClient == milestone.amount)
    function resolveDispute(
        uint256 engagementId,
        uint256 milestoneIndex,
        uint256 amountToLawyer,
        uint256 amountToClient
    ) external;

    // ========== Transcript anchoring ==========

    /// @notice Anchors the latest off-chain transcript root.
    /// @dev Called automatically inside fund/deliver/release/dispute/claim/resolve/refund/close.
    /// @dev Also callable explicitly by either party between milestone events if they want
    ///      to make message history at a given point tamper-evident; this provides the
    ///      "either party may seal a chunk of conversation" production-trajectory hook.
    function anchorTranscript(uint256 engagementId, bytes32 newRoot) external;

    // ========== Engagement closure ==========

    /// @notice Either party closes the engagement. Reverts unless every milestone is in
    ///         {Released, Resolved, Refunded}.
    function closeEngagement(uint256 engagementId) external;

    // ========== Conflict-of-interest commitment management ==========

    /// @notice Lawyer publishes a Pedersen-hashed root over their current client set.
    function setConflictRoot(bytes32 root) external; // onlyVerifiedLawyer

    function lawyerConflictRoot(address lawyer) external view returns (bytes32);

    // ========== Getters ==========

    function getEngagement(uint256 engagementId) external view returns (Engagement memory);
    function getMilestone(uint256 engagementId, uint256 milestoneIndex) external view returns (Milestone memory);
}
```

### Modifier composition

| Modifier | Constraint | Spec/Constitution ref |
|---|---|---|
| `onlyVerifiedClient` | `attestationManager.hasCapability(msg.sender, SCHEMA_CLIENT)` | FR-001, FR-005, Inv-3 |
| `onlyVerifiedLawyer` | `attestationManager.hasCapability(msg.sender, SCHEMA_LAWYER)` | same |
| `onlyVerifiedArbiter` | `attestationManager.hasCapability(msg.sender, SCHEMA_ARBITER)` | same |
| `onlyEngagementClient(id)` | `msg.sender == engagement.client` | FR-016, FR-022a |
| `onlyEngagementLawyer(id)` | `msg.sender == engagement.lawyer` | FR-014, FR-017 |
| `onlyEngagementParty(id)` | client OR lawyer | FR-022a, FR-022b, anchorTranscript |
| `onlyClaimingArbiter(id, idx)` | `msg.sender == milestone.arbiter` | FR-019a |
| `cooldownElapsed(id, idx)` | `block.timestamp >= milestone.deliveredAt + LAWYER_DISPUTE_COOLDOWN` | FR-017, Inv-6 |

### Invariants tested in `forge test`

- `clientDispute` cannot be reverted by any time-based predicate.
- `lawyerEscalate` reverts at `block.timestamp == milestone.deliveredAt + LAWYER_DISPUTE_COOLDOWN - 1` and succeeds at `+ 0`.
- A non-claiming arbiter wallet cannot resolve a claimed dispute (even another verified-arbiter).
- `resolveDispute` cannot mint or burn wei: `amountToLawyer + amountToClient == milestone.amount` is required.
- The operator cannot resolve a dispute (lacks `verified_arbiter`).
- A milestone refund returns exactly `milestone.amount` to the client and zero elsewhere.
- `closeEngagement` reverts if any milestone is not in a terminal state.
- After `closeEngagement`, no further function on that engagement succeeds.

## `IZKConflictVerifier.sol` (auto-generated)

```solidity
interface IZKConflictVerifier {
    /// @notice verifies a non-membership proof: nullifier ∉ commitmentSet(root)
    /// @return true iff the proof is valid
    function verifyProof(
        bytes calldata proof,
        bytes32 commitmentRoot,
        bytes32 nullifier
    ) external view returns (bool);
}
```

The `bb` codegen produces this verifier from the Noir circuit at `circuits/src/main.nr`. `LegalEngagementEscrow.openEngagementAndFundFirstMilestone` calls `verifier.verifyProof(zkConflictProof, lawyerConflictRoot[lawyer], zkNullifier)`.

## Deployment script (Foundry)

`contracts/script/Deploy.s.sol` (sketch — Phase 2 produces the actual code):

1. Deploy `AttestationManager` with `operator = msg.sender`.
2. Register the three EAS schemas via the platform's known EAS instance (`SchemaRegistry.register`). On Anvil, also deploy a local copy of EAS first; on Base Sepolia, use the canonical address.
3. Deploy `IZKConflictVerifier` (the bb-generated contract).
4. Deploy `LegalEngagementEscrow(attestationManager, verifier)`.
5. Print all addresses + EAS UIDs as JSON for `lib/chain/addresses.ts` to consume.
