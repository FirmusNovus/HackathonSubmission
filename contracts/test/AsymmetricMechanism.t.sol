// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";

/// @notice Encodes Constitution principle III + invariant 6: the client
///         disputes immediately; the lawyer waits 30 days post-delivery.
contract AsymmetricMechanismTest is BaseTest {
    function test_clientCanDisputeFundedWithoutCooldown() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(client);
        escrow.disputeProposal(engagementId, 0, keccak256("post-dispute-root"));
        LegalEngagementEscrow.Proposal memory p = escrow.getProposal(engagementId, 0);
        assertEq(uint256(p.state), uint256(LegalEngagementEscrow.ProposalState.Disputed));
    }

    function test_clientCanDisputeDeliveredWithoutCooldown() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);
        vm.prank(client);
        escrow.disputeProposal(engagementId, 0, keccak256("post-dispute-root"));
        assertEq(
            uint256(escrow.getProposal(engagementId, 0).state),
            uint256(LegalEngagementEscrow.ProposalState.Disputed)
        );
    }

    function test_lawyerEscalateRevertsBeforeCooldown() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        // Just below the boundary: 30 days minus 1 second.
        vm.warp(block.timestamp + 30 days - 1);
        vm.prank(lawyer);
        vm.expectRevert();
        escrow.escalateProposal(engagementId, 0, keccak256("post-escalate-root"));
    }

    function test_lawyerEscalateSucceedsAtCooldownExpiry() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        vm.warp(block.timestamp + 30 days);
        vm.prank(lawyer);
        escrow.escalateProposal(engagementId, 0, keccak256("post-escalate-root"));
        assertEq(
            uint256(escrow.getProposal(engagementId, 0).state),
            uint256(LegalEngagementEscrow.ProposalState.Disputed)
        );
    }

    function test_lawyerCannotEscalateFunded() public {
        uint256 engagementId = _openPaid(0.1 ether);
        // Without markDelivered, the proposal is still Funded.
        vm.warp(block.timestamp + 365 days);
        vm.prank(lawyer);
        vm.expectRevert();
        escrow.escalateProposal(engagementId, 0, keccak256("root"));
    }
}
