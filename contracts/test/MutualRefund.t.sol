// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";

contract MutualRefundTest is BaseTest {
    function test_refundRequiresBothSignatures() public {
        uint256 engagementId = _openPaid(0.5 ether);
        bytes32 nonce = keccak256("refund-nonce-1");
        bytes memory clientSig = _signMutualRefund(engagementId, 0, nonce, clientPk);
        bytes memory lawyerSig = _signMutualRefund(engagementId, 0, nonce, lawyerPk);

        uint256 clientBefore = client.balance;
        vm.prank(client);
        escrow.mutualRefundProposal(engagementId, 0, nonce, clientSig, lawyerSig);
        assertEq(client.balance, clientBefore + 0.5 ether);
    }

    function test_refundFailsWithMismatchedSignature() public {
        uint256 engagementId = _openPaid(0.1 ether);
        bytes32 nonce = keccak256("refund-nonce-2");
        bytes memory clientSig = _signMutualRefund(engagementId, 0, nonce, clientPk);
        // Stranger signing in place of lawyer.
        bytes memory badSig = _signMutualRefund(engagementId, 0, nonce, strangerPk);

        vm.prank(client);
        vm.expectRevert();
        escrow.mutualRefundProposal(engagementId, 0, nonce, clientSig, badSig);
    }

    function test_refundOfDeliveredReverts() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);
        bytes32 nonce = keccak256("refund-nonce-3");
        bytes memory clientSig = _signMutualRefund(engagementId, 0, nonce, clientPk);
        bytes memory lawyerSig = _signMutualRefund(engagementId, 0, nonce, lawyerPk);

        vm.prank(client);
        vm.expectRevert();
        escrow.mutualRefundProposal(engagementId, 0, nonce, clientSig, lawyerSig);
    }

    function test_replayRefundNonceFails() public {
        uint256 engagementId = _openPaid(0.1 ether);
        bytes32 nonce = keccak256("refund-nonce-4");
        bytes memory clientSig = _signMutualRefund(engagementId, 0, nonce, clientPk);
        bytes memory lawyerSig = _signMutualRefund(engagementId, 0, nonce, lawyerPk);
        vm.prank(client);
        escrow.mutualRefundProposal(engagementId, 0, nonce, clientSig, lawyerSig);

        // Replay against a fresh proposal must fail because the nonce is consumed.
        uint256 amount = 0.2 ether;
        bytes memory offerSig = _signProposalOffer(engagementId, amount, keccak256("items"), nonce);
        vm.prank(client);
        vm.expectRevert();
        escrow.fundProposal{value: amount}(engagementId, amount, keccak256("items"), nonce, offerSig);
    }
}
