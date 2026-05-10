// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";

contract LegalEngagementEscrowTest is Base {
    bytes32 private constant MUTUAL_REFUND_TYPEHASH =
        keccak256("MutualRefundAuthorization(uint256 engagementId,uint256 milestoneIndex)");

    function _mutualRefundDigest(uint256 engagementId, uint256 milestoneIndex) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(MUTUAL_REFUND_TYPEHASH, engagementId, milestoneIndex));
        return keccak256(abi.encodePacked("\x19\x01", escrow.eip712DomainSeparator(), structHash));
    }

    function _signRefund(uint256 privKey, uint256 engagementId, uint256 milestoneIndex)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, _mutualRefundDigest(engagementId, milestoneIndex));
        return abi.encodePacked(r, s, v);
    }

    // ============================================================
    // Open + fund + release happy path (V2: no markDelivered required)
    // ============================================================

    function test_happyPath_releaseFromFundedSendsFundsToLawyer() public {
        uint256 lawyerBefore = lawyer.balance;
        uint256 engagementId = _openEngagement(1 ether);

        // V2: client releases directly from Funded — no markDelivered tx in
        // the happy path.
        vm.prank(client);
        escrow.releaseMilestone(engagementId, 0);

        assertEq(lawyer.balance - lawyerBefore, 1 ether);
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Released)
        );
    }

    function test_happyPath_releaseFromDeliveredAlsoWorks() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        vm.prank(client);
        escrow.releaseMilestone(engagementId, 0);

        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Released)
        );
    }

    function test_revertWhen_amountMismatch() public {
        bytes32 nullifier = keccak256("n");
        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.EthAmountMismatch.selector);
        escrow.openEngagementAndFundFirstMilestone{value: 0.5 ether}(
            lawyer, bytes32(uint256(1)), 1 ether, hex"", nullifier, bytes32(0)
        );
    }

    function test_revertWhen_nullifierReused() public {
        bytes32 matterRef = bytes32(uint256(1));
        bytes32 nullifier = keccak256("reused");
        vm.prank(client);
        escrow.openEngagementAndFundFirstMilestone{value: 1 ether}(
            lawyer, matterRef, 1 ether, hex"", nullifier, bytes32(0)
        );

        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.NullifierAlreadyUsed.selector);
        escrow.openEngagementAndFundFirstMilestone{value: 1 ether}(
            lawyer, bytes32(uint256(2)), 1 ether, hex"", nullifier, bytes32(0)
        );
    }

    function test_revertWhen_clientNotVerified() public {
        bytes32 nullifier = keccak256("nv");
        vm.prank(nobody);
        vm.expectRevert(LegalEngagementEscrow.NotVerifiedClient.selector);
        escrow.openEngagementAndFundFirstMilestone{value: 1 ether}(
            lawyer, bytes32(uint256(1)), 1 ether, hex"", nullifier, bytes32(0)
        );
    }

    function test_revertWhen_lawyerNotVerified() public {
        bytes32 nullifier = keccak256("nl");
        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.NotVerifiedLawyer.selector);
        escrow.openEngagementAndFundFirstMilestone{value: 1 ether}(
            nobody, bytes32(uint256(1)), 1 ether, hex"", nullifier, bytes32(0)
        );
    }

    // ============================================================
    // Follow-up milestones — atomic create+fund (no propose step)
    // ============================================================

    function test_fundMilestone_atomicCreateAndFund_returnsNextIndex() public {
        uint256 engagementId = _openEngagement(1 ether);

        // _fundFollowUp pranks(client) internally; no outer prank.
        uint256 idx = _fundFollowUp(engagementId, 0.3 ether);
        assertEq(idx, 1);

        LegalEngagementEscrow.Milestone memory m = escrow.getMilestone(engagementId, 1);
        assertEq(m.amount, 0.3 ether);
        assertEq(uint256(m.state), uint256(LegalEngagementEscrow.MilestoneState.Funded));
    }

    function _fundFollowUp(uint256 engagementId, uint256 amount) internal returns (uint256 milestoneIndex) {
        vm.prank(client);
        milestoneIndex = escrow.fundMilestone{value: amount}(engagementId, amount);
    }

    function test_revertWhen_followUpFundedByNonClient() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        vm.expectRevert(LegalEngagementEscrow.NotEngagementClient.selector);
        escrow.fundMilestone{value: 0.1 ether}(engagementId, 0.1 ether);
    }

    function test_revertWhen_followUpAmountMismatch() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.EthAmountMismatch.selector);
        escrow.fundMilestone{value: 0.05 ether}(engagementId, 0.1 ether);
    }

    // ============================================================
    // Asymmetric dispute: client immediate, lawyer cooldown
    // ============================================================

    function test_clientCanDispute_funded_immediately() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        escrow.disputeMilestone(engagementId, 0, bytes32(uint256(0xdead)));
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Disputed)
        );
        assertEq(escrow.getEngagement(engagementId).transcriptRoot, bytes32(uint256(0xdead)));
    }

    function test_clientCanDispute_delivered_immediately() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        vm.prank(client);
        escrow.disputeMilestone(engagementId, 0, bytes32(uint256(0xbeef)));
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Disputed)
        );
    }

    function test_lawyerEscalate_revertsAt_cooldownMinusOne() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        vm.warp(block.timestamp + escrow.LAWYER_DISPUTE_COOLDOWN() - 1);

        uint64 expectedUnlock = uint64(block.timestamp + 1);
        vm.prank(lawyer);
        vm.expectRevert(abi.encodeWithSelector(LegalEngagementEscrow.CooldownNotElapsed.selector, expectedUnlock));
        escrow.escalateMilestone(engagementId, 0, bytes32(0));
    }

    function test_lawyerEscalate_succeedsAt_cooldownExact() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        vm.warp(block.timestamp + escrow.LAWYER_DISPUTE_COOLDOWN());

        vm.prank(lawyer);
        escrow.escalateMilestone(engagementId, 0, bytes32(uint256(0xfeed)));
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Disputed)
        );
        assertEq(escrow.getEngagement(engagementId).transcriptRoot, bytes32(uint256(0xfeed)));
    }

    // ============================================================
    // resolveDispute — operator-as-arbiter (Constitution v2.0.0)
    // ============================================================

    function test_resolve_byOperator_movesFundsToBothPartiesExactly() public {
        uint256 lawyerBefore = lawyer.balance;
        uint256 clientBefore = client.balance;

        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);
        vm.prank(client);
        escrow.disputeMilestone(engagementId, 0, bytes32(0));

        vm.prank(operator);
        escrow.resolveDispute(engagementId, 0, 0.6 ether, 0.4 ether);

        assertEq(lawyer.balance - lawyerBefore, 0.6 ether);
        // client funded 1 ether, got 0.4 back = -0.6 net
        assertEq(clientBefore - client.balance, 0.6 ether);
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Resolved)
        );
    }

    function test_revertWhen_nonOperatorResolves() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        escrow.disputeMilestone(engagementId, 0, bytes32(0));

        // The lawyer is a party but not the operator.
        vm.prank(lawyer);
        vm.expectRevert(LegalEngagementEscrow.OnlyOperator.selector);
        escrow.resolveDispute(engagementId, 0, 0.5 ether, 0.5 ether);

        // The client likewise.
        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.OnlyOperator.selector);
        escrow.resolveDispute(engagementId, 0, 0.5 ether, 0.5 ether);

        // A capability-less third party.
        vm.prank(nobody);
        vm.expectRevert(LegalEngagementEscrow.OnlyOperator.selector);
        escrow.resolveDispute(engagementId, 0, 0.5 ether, 0.5 ether);
    }

    function test_resolve_revertsWhen_milestoneNotDisputed() public {
        uint256 engagementId = _openEngagement(1 ether);
        // Funded, not Disputed.
        vm.prank(operator);
        vm.expectRevert(LegalEngagementEscrow.InvalidMilestoneState.selector);
        escrow.resolveDispute(engagementId, 0, 0.5 ether, 0.5 ether);
    }

    function test_resolve_splitMustEqualAmount_exactly() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        escrow.disputeMilestone(engagementId, 0, bytes32(0));

        vm.prank(operator);
        vm.expectRevert(LegalEngagementEscrow.InvalidSplit.selector);
        escrow.resolveDispute(engagementId, 0, 0.5 ether, 0.5 ether - 1);

        vm.prank(operator);
        vm.expectRevert(LegalEngagementEscrow.InvalidSplit.selector);
        escrow.resolveDispute(engagementId, 0, 0.5 ether + 1, 0.5 ether);
    }

    // ============================================================
    // Mutual refund — both EIP-712 sigs required
    // ============================================================

    function test_mutualRefund_bothSigs_returnsFundsToClient() public {
        uint256 clientBefore = client.balance;
        uint256 engagementId = _openEngagement(1 ether);
        // 1 ether locked; clientBefore - 1 ether right now.

        bytes memory clientSig = _signRefund(clientPrivKey, engagementId, 0);
        bytes memory lawyerSig = _signRefund(lawyerPrivKey, engagementId, 0);

        vm.prank(client);
        escrow.mutualRefundMilestone(engagementId, 0, clientSig, lawyerSig);

        assertEq(client.balance, clientBefore);
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Refunded)
        );
    }

    function test_mutualRefund_callableByLawyerToo() public {
        uint256 engagementId = _openEngagement(1 ether);
        bytes memory clientSig = _signRefund(clientPrivKey, engagementId, 0);
        bytes memory lawyerSig = _signRefund(lawyerPrivKey, engagementId, 0);

        // Lawyer triggers the on-chain call carrying both sigs.
        vm.prank(lawyer);
        escrow.mutualRefundMilestone(engagementId, 0, clientSig, lawyerSig);
        assertEq(
            uint256(escrow.getMilestone(engagementId, 0).state),
            uint256(LegalEngagementEscrow.MilestoneState.Refunded)
        );
    }

    function test_revertWhen_mutualRefundMissingClientSig() public {
        uint256 engagementId = _openEngagement(1 ether);
        // Both sigs come from the lawyer's privkey → recoveredClient will not
        // match the engagement client.
        bytes memory lawyerSig = _signRefund(lawyerPrivKey, engagementId, 0);

        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.InvalidRefundSignature.selector);
        escrow.mutualRefundMilestone(engagementId, 0, lawyerSig, lawyerSig);
    }

    function test_revertWhen_mutualRefundOnDeliveredMilestone() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(lawyer);
        escrow.markDelivered(engagementId, 0);

        bytes memory clientSig = _signRefund(clientPrivKey, engagementId, 0);
        bytes memory lawyerSig = _signRefund(lawyerPrivKey, engagementId, 0);

        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.InvalidMilestoneState.selector);
        escrow.mutualRefundMilestone(engagementId, 0, clientSig, lawyerSig);
    }

    function test_revertWhen_mutualRefundReplay() public {
        uint256 engagementId = _openEngagement(1 ether);
        bytes memory clientSig = _signRefund(clientPrivKey, engagementId, 0);
        bytes memory lawyerSig = _signRefund(lawyerPrivKey, engagementId, 0);

        vm.prank(client);
        escrow.mutualRefundMilestone(engagementId, 0, clientSig, lawyerSig);

        // Replay against the same Refunded milestone fails on state, not sig
        // — but either way the parked funds can't be moved twice.
        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.InvalidMilestoneState.selector);
        escrow.mutualRefundMilestone(engagementId, 0, clientSig, lawyerSig);
    }

    // ============================================================
    // Closure: only when clean; final root anchored on close
    // ============================================================

    function test_closeEngagement_revertsWith_nonTerminalMilestone() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.EngagementNotClean.selector);
        escrow.closeEngagement(engagementId, bytes32(uint256(0xfade)));
    }

    function test_closeEngagement_succeedsWhenAllTerminal_anchorsFinalRoot() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        escrow.releaseMilestone(engagementId, 0);

        vm.prank(client);
        escrow.closeEngagement(engagementId, bytes32(uint256(0xfade)));
        LegalEngagementEscrow.Engagement memory e = escrow.getEngagement(engagementId);
        assertEq(uint256(e.state), uint256(LegalEngagementEscrow.EngagementState.Closed));
        assertEq(e.transcriptRoot, bytes32(uint256(0xfade)));
    }

    function test_revertWhen_postCloseAction() public {
        uint256 engagementId = _openEngagement(1 ether);
        vm.prank(client);
        escrow.releaseMilestone(engagementId, 0);
        vm.prank(client);
        escrow.closeEngagement(engagementId, bytes32(uint256(99)));

        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.InvalidEngagementState.selector);
        escrow.anchorTranscript(engagementId, bytes32(uint256(99)));

        vm.prank(client);
        vm.expectRevert(LegalEngagementEscrow.InvalidEngagementState.selector);
        escrow.fundMilestone{value: 0.1 ether}(engagementId, 0.1 ether);
    }
}
