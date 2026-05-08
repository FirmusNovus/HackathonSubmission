// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Verifier interface for the conflict-of-interest non-membership proof.
///         The MVP ships StubZKConflictVerifier returning true unconditionally;
///         production replaces with a bb-generated UltraHonk verifier.
interface IZKConflictVerifier {
    function verifyProof(bytes calldata proof, bytes32 commitmentRoot, bytes32 nullifier)
        external
        view
        returns (bool);
}
