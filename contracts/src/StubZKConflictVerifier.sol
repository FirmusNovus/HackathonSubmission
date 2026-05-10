// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IZKConflictVerifier} from "./interfaces/IZKConflictVerifier.sol";

/// @notice Stand-in verifier used during Phases 2-5. Always returns true.
///         Phase 6 (US4) deploys the bb-generated real verifier and updates
///         LegalEngagementEscrow to point at it.
contract StubZKConflictVerifier is IZKConflictVerifier {
    function verifyProof(bytes calldata, bytes32, bytes32) external pure returns (bool) {
        return true;
    }
}
