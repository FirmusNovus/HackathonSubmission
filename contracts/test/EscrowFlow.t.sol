// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";

contract EscrowFlowTest is BaseTest {
    function test_fullProposalLifecycle() public {
        uint256 amount = 1 ether;
        uint256 engagementId = _openPaid(amount);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        uint256 lawyerBefore = lawyer.balance;
        vm.prank(client);
        escrow.releaseProposal(engagementId, 0);

        assertEq(lawyer.balance, lawyerBefore + amount);
        LegalEngagementEscrow.Proposal memory p = escrow.getProposal(engagementId, 0);
        assertEq(uint256(p.state), uint256(LegalEngagementEscrow.ProposalState.Released));
        assertEq(p.amountToLawyer, amount);
    }

    function test_releaseFundedWithoutDelivered() public {
        uint256 amount = 0.5 ether;
        uint256 engagementId = _openPaid(amount);

        uint256 lawyerBefore = lawyer.balance;
        vm.prank(client);
        escrow.releaseProposal(engagementId, 0);
        assertEq(lawyer.balance, lawyerBefore + amount);
    }

    function test_doubleReleaseReverts() public {
        uint256 engagementId = _openPaid(0.2 ether);
        vm.prank(client);
        escrow.releaseProposal(engagementId, 0);
        vm.prank(client);
        vm.expectRevert();
        escrow.releaseProposal(engagementId, 0);
    }

    function test_closeEngagementRequiresAllProposalsTerminal() public {
        uint256 engagementId = _openPaid(0.1 ether);
        // Active (Funded) proposal — close must revert.
        vm.prank(client);
        vm.expectRevert();
        escrow.closeEngagement(engagementId, keccak256("final"));

        vm.prank(client);
        escrow.releaseProposal(engagementId, 0);

        vm.prank(client);
        escrow.closeEngagement(engagementId, keccak256("final"));
        LegalEngagementEscrow.Engagement memory e = escrow.getEngagement(engagementId);
        assertEq(uint256(e.state), uint256(LegalEngagementEscrow.EngagementState.Closed));
    }

    function test_followUpProposalLifecycle() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(client);
        escrow.releaseProposal(engagementId, 0);

        uint256 amount = 0.5 ether;
        bytes32 itemsHash = keccak256("items");
        bytes32 nonce = keccak256("nonce-1");
        bytes memory sig = _signProposalOffer(engagementId, amount, itemsHash, nonce);

        vm.prank(client);
        uint256 idx = escrow.fundProposal{value: amount}(engagementId, amount, itemsHash, nonce, sig);
        assertEq(idx, 1);

        vm.prank(lawyer);
        escrow.markDelivered(engagementId, idx);
        uint256 lawyerBefore = lawyer.balance;
        vm.prank(client);
        escrow.releaseProposal(engagementId, idx);
        assertEq(lawyer.balance, lawyerBefore + amount);
    }

    function test_freeEngagementHasNoConsultationProposal() public {
        uint256 engagementId = _openFree();
        LegalEngagementEscrow.Engagement memory e = escrow.getEngagement(engagementId);
        assertEq(e.proposalCount, 0);
        assertEq(e.consultationPaid, false);
    }
}
