// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Verifier interface for the conflict-of-interest non-membership proof.
///         The Phase 2 stub returns true unconditionally; Phase 6 (US4) replaces
///         it with the bb-generated UltraHonk verifier.
interface IZKConflictVerifier {
    function verifyProof(bytes calldata proof, bytes32 commitmentRoot, bytes32 nullifier)
        external
        view
        returns (bool);
}
