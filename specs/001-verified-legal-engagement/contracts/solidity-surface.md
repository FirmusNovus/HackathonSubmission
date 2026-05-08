# Solidity Contract Surface

Three Solidity contracts plus one production-trajectory Noir verifier.
Solidity 0.8.28, OpenZeppelin Contracts v5.2.0.

## `AttestationManager.sol`

Thin wrapper over EAS that the rest of the system reads through. Owns
the operator role and the two EAS schema UIDs (`verified_lawyer`,
`verified_client`).

```solidity
interface IAttestationManager {
    function SCHEMA_LAWYER() external view returns (bytes32);
    function SCHEMA_CLIENT() external view returns (bytes32);

    function hasCapability(address subject, bytes32 schemaId) external view returns (bool);

    // Operator-only. MUST be invoked only from the platform's onboarding code path
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

    function revokeCapability(address subject, bytes32 schemaId) external;
}
```

**Modifiers**:

- `onlyOperator` — `require(msg.sender == operator, "not operator")`.

**Events**:
`Attested(address subject, bytes32 schemaId, bytes32 attestationUid)`,
`Revoked(address subject, bytes32 schemaId)`.

## `LegalEngagementEscrow.sol`

The core contract. Holds consultation + proposal funds, enforces the
asymmetric mechanism, anchors transcripts.

```solidity
uint64 constant LAWYER_DISPUTE_COOLDOWN = 30 days;

interface ILegalEngagementEscrow {
    enum EngagementState { Active, Closed }
    enum ProposalState { Issued, Funded, Delivered, Released, Disputed, Resolved, Refunded }

    struct Proposal {
        uint256 amount;
        ProposalState state;
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
        uint256 proposalCount;
        bool consultationPaid;
    }

    // ========== Engagement lifecycle ==========

    /// @notice Open a free engagement (no escrow funded).
    /// @dev Reverts unless:
    ///      - msg.sender holds verified_client (via AttestationManager.hasCapability)
    ///      - lawyer holds verified_lawyer
    ///      - the conflict-of-interest non-membership proof verifies (StubZKConflictVerifier returns true in the MVP)
    function openFreeEngagement(
        address lawyer,
        bytes32 matterRef,
        bytes calldata zkConflictProof,
        bytes32 zkNullifier,
        bytes32 initialTranscriptRoot
    ) external returns (uint256 engagementId);

    /// @notice Open a paid engagement and fund its first proposal (the consultation).
    /// @dev Same gates as openFreeEngagement, plus msg.value == amount.
    function openPaidEngagementAndFundConsultation(
        address lawyer,
        bytes32 matterRef,
        uint256 amount,
        bytes calldata zkConflictProof,
        bytes32 zkNullifier,
        bytes32 initialTranscriptRoot
    ) external payable returns (uint256 engagementId);

    // ========== Proposal lifecycle ==========

    /// @notice Client funds a lawyer-signed proposal.
    /// @dev The proposal artifact (engagementId, proposalIndex, amount, lineItemsHash, deliverablesHash, nonce, signer)
    ///      is carried in calldata; the contract verifies the lawyer's ECDSA signature against engagement.lawyer.
    function fundProposal(
        uint256 engagementId,
        uint256 amount,
        bytes32 lineItemsHash,
        bytes32 deliverablesHash,
        bytes32 nonce,
        bytes calldata lawyerSignature
    ) external payable returns (uint256 proposalIndex);

    /// @notice Lawyer marks a funded proposal as delivered. Records deliveredAt = block.timestamp.
    function markDelivered(uint256 engagementId, uint256 proposalIndex) external;

    /// @notice Client releases a funded or delivered proposal. Funds move to the lawyer.
    /// @dev NOT gated on Delivered. Client may release any time after fund.
    function releaseProposal(uint256 engagementId, uint256 proposalIndex) external;

    /// @notice Mutual refund of a Funded-undelivered proposal. Both signatures verified on chain.
    function mutualRefundProposal(
        uint256 engagementId,
        uint256 proposalIndex,
        bytes32 nonce,
        bytes calldata clientSignature,
        bytes calldata lawyerSignature
    ) external;

    // ========== Asymmetric dispute mechanism ==========

    /// @notice Client disputes a Funded or Delivered proposal. Immediate; no cooldown.
    /// @dev require(msg.sender == engagement.client)
    function disputeProposal(uint256 engagementId, uint256 proposalIndex) external;

    /// @notice Lawyer escalates a Delivered proposal after cooldown.
    /// @dev require(msg.sender == engagement.lawyer)
    /// @dev require(proposal.state == Delivered)
    /// @dev require(block.timestamp >= proposal.deliveredAt + LAWYER_DISPUTE_COOLDOWN)
    function escalateProposal(uint256 engagementId, uint256 proposalIndex) external;

    // ========== Operator dispute resolution (MVP) ==========

    /// @notice Operator resolves a disputed proposal with a split.
    /// @dev require(msg.sender == operator)
    /// @dev require(proposal.state == Disputed)
    /// @dev require(amountToLawyer + amountToClient == proposal.amount)
    function resolveDispute(
        uint256 engagementId,
        uint256 proposalIndex,
        uint256 amountToLawyer,
        uint256 amountToClient
    ) external;

    // ========== Transcript anchoring ==========

    /// @notice Anchors the latest off-chain transcript root.
    /// @dev Called automatically inside fund/deliver/release/dispute/resolve/refund/close.
    /// @dev Also callable explicitly by either party between events ("seal current state").
    function anchorTranscript(uint256 engagementId, bytes32 newRoot) external;

    // ========== Engagement closure ==========

    /// @notice Either party closes the engagement. Reverts unless every proposal is in a terminal state
    ///         {Released, Resolved, Refunded}.
    function closeEngagement(uint256 engagementId, bytes32 finalTranscriptRoot) external;

    // ========== Conflict-of-interest (production trajectory) ==========

    /// @notice Lawyer publishes a Pedersen-hashed root over their current client set.
    function setConflictRoot(bytes32 root) external; // onlyVerifiedLawyer
    function lawyerConflictRoot(address lawyer) external view returns (bytes32);

    // ========== Getters ==========

    function getEngagement(uint256 engagementId) external view returns (Engagement memory);
    function getProposal(uint256 engagementId, uint256 proposalIndex) external view returns (Proposal memory);
}
```

### Modifier composition

| Modifier | Constraint | Spec ref |
|---|---|---|
| `onlyVerifiedClient` | `attestationManager.hasCapability(msg.sender, SCHEMA_CLIENT)` | FR-001, FR-005, Inv-3 |
| `onlyVerifiedLawyer` | `attestationManager.hasCapability(msg.sender, SCHEMA_LAWYER)` | same |
| `onlyEngagementClient(id)` | `msg.sender == engagement.client` | FR-024 |
| `onlyEngagementLawyer(id)` | `msg.sender == engagement.lawyer` | FR-020, FR-025 |
| `onlyEngagementParty(id)` | client OR lawyer | `closeEngagement`, `anchorTranscript` |
| `onlyOperator` | `msg.sender == operator` | FR-027 |
| `cooldownElapsed(id, idx)` | `block.timestamp >= proposal.deliveredAt + LAWYER_DISPUTE_COOLDOWN` | FR-025, Inv-6 |

### Invariants tested in `forge test`

- `disputeProposal` cannot be reverted by any time-based predicate
  (client side has no cooldown).
- `escalateProposal` reverts at
  `block.timestamp == proposal.deliveredAt + LAWYER_DISPUTE_COOLDOWN - 1`
  and succeeds at `+ 0`.
- The operator cannot resolve a non-Disputed proposal.
- Non-operator callers cannot resolve.
- `resolveDispute` cannot mint or burn wei:
  `amountToLawyer + amountToClient == proposal.amount` is required.
- A proposal refund returns exactly `proposal.amount` to the client
  and zero elsewhere.
- `mutualRefundProposal` reverts unless BOTH signatures verify and
  the proposal state is Funded (not Delivered).
- `closeEngagement` reverts if any proposal is not in a terminal
  state.
- After `closeEngagement`, no further function on that engagement
  succeeds.
- The two consultation entry points (free / paid) produce
  semantically equivalent engagements except for `consultationPaid`
  and the presence/absence of a proposal at index 0.
- A second `releaseProposal` call on an already-Released proposal
  reverts (idempotency at the API layer is the platform's job;
  contract is unconditionally strict).
- Concurrent state transitions: when two transactions race to
  transition the same proposal, the contract's `require` checks
  reject the second; no platform server-side lock is required (FR-058).

## `IZKConflictVerifier.sol` (interface)

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

## `StubZKConflictVerifier.sol` (MVP)

```solidity
contract StubZKConflictVerifier is IZKConflictVerifier {
    /// @inheritdoc IZKConflictVerifier
    /// @dev Production trajectory replaces this with the bb-generated verifier
    /// from circuits/src/main.nr. The interface boundary is preserved across
    /// the swap; consumers do not change.
    function verifyProof(bytes calldata, bytes32, bytes32) external pure returns (bool) {
        return true; // TODO(production): swap to real verifier
    }
}
```

## Deployment script (Foundry)

`contracts/script/Deploy.s.sol` (sketch — Phase 2 produces the actual
code):

1. Deploy `AttestationManager` with `operator = msg.sender`.
2. Register the two EAS schemas via the platform's known EAS instance
   (`SchemaRegistry.register`). On Anvil, also deploy a local copy of
   EAS first; on Base Sepolia, use the canonical address.
3. Deploy `StubZKConflictVerifier`.
4. Deploy `LegalEngagementEscrow(attestationManager, verifier, operator)`.
5. Print all addresses + EAS UIDs as JSON for
   `apps/platform/lib/chain/addresses.ts` to consume.
