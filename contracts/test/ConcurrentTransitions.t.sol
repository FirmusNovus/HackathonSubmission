// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";

/// @notice FR-058: chain-as-arbiter — when two transactions race the same
///         proposal, the first wins, the second reverts. Foundry simulates
///         this serially: we observe both transitions through the contract
///         state machine and the second-tx revert.
contract ConcurrentTransitionsTest is BaseTest {
    function test_releaseAndDisputeRace_firstWins() public {
        uint256 engagementId = _openPaid(0.3 ether);
        vm.prank(client);
        escrow.releaseProposal(engagementId, 0);
        // Second tx — client tries to dispute already-released proposal.
        vm.prank(client);
        vm.expectRevert();
        escrow.disputeProposal(engagementId, 0, keccak256("r"));
    }

    function test_disputeBlocksRelease() public {
        uint256 engagementId = _openPaid(0.3 ether);
        vm.prank(client);
        escrow.disputeProposal(engagementId, 0, keccak256("r"));
        vm.prank(client);
        vm.expectRevert();
        escrow.releaseProposal(engagementId, 0);
    }

    function test_doubleMarkDeliveredReverts() public {
        uint256 engagementId = _openPaid(0.3 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);
        vm.prank(lawyer);
        vm.expectRevert();
        escrow.markDelivered(engagementId, 0);
    }
}
