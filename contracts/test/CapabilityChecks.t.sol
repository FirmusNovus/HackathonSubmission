// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";

contract CapabilityChecksTest is BaseTest {
    function test_revertsIfClientNotVerified() public {
        bytes32 schema = am.SCHEMA_CLIENT();
        vm.prank(operator);
        am.revokeCapability(client, schema);
        bytes memory proof = abi.encodePacked(DUMMY_PROOF);
        vm.prank(client);
        vm.expectRevert();
        escrow.openPaidEngagementAndFundConsultation{value: 0.1 ether}(
            lawyer, keccak256("m"), 0.1 ether, proof, keccak256("n1"), keccak256("r")
        );
    }

    function test_revertsIfLawyerNotVerified() public {
        bytes32 schema = am.SCHEMA_LAWYER();
        vm.prank(operator);
        am.revokeCapability(lawyer, schema);
        bytes memory proof = abi.encodePacked(DUMMY_PROOF);
        vm.prank(client);
        vm.expectRevert();
        escrow.openPaidEngagementAndFundConsultation{value: 0.1 ether}(
            lawyer, keccak256("m"), 0.1 ether, proof, keccak256("n2"), keccak256("r")
        );
    }

    function test_resolveDisputeRevertsForNonOperator() public {
        uint256 engagementId = _openPaid(0.1 ether);
        vm.prank(client);
        escrow.disputeProposal(engagementId, 0, keccak256("r"));

        vm.prank(client);
        vm.expectRevert();
        escrow.resolveDispute(engagementId, 0, 0.05 ether, 0.05 ether);

        vm.prank(operator);
        escrow.resolveDispute(engagementId, 0, 0.05 ether, 0.05 ether);
    }
}
