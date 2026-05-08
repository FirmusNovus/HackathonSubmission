// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IZKConflictVerifier} from "./interfaces/IZKConflictVerifier.sol";

/// @notice Stand-in verifier shipped with the MVP. Always returns true.
///
/// TODO(production): replace with the bb-generated UltraHonk verifier produced
/// from circuits/src/main.nr. The production swap is a single-file
/// redeployment plus LegalEngagementEscrow.setZKVerifier(...) call from the
/// operator key. The IZKConflictVerifier ABI is preserved so callers above do
/// not change.
contract StubZKConflictVerifier is IZKConflictVerifier {
    function verifyProof(bytes calldata, bytes32, bytes32) external pure returns (bool) {
        return true;
    }
}
