// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";

contract ResolveSplitTest is BaseTest {
    function test_resolveRequiresExactSum() public {
        uint256 engagementId = _openPaid(1 ether);
        vm.prank(client);
        escrow.disputeProposal(engagementId, 0, keccak256("r"));

        vm.prank(operator);
        vm.expectRevert();
        escrow.resolveDispute(engagementId, 0, 0.6 ether, 0.5 ether); // sums to 1.1

        vm.prank(operator);
        vm.expectRevert();
        escrow.resolveDispute(engagementId, 0, 0.5 ether, 0.4 ether); // sums to 0.9

        uint256 lawyerBefore = lawyer.balance;
        uint256 clientBefore = client.balance;
        vm.prank(operator);
        escrow.resolveDispute(engagementId, 0, 0.7 ether, 0.3 ether);
        assertEq(lawyer.balance, lawyerBefore + 0.7 ether);
        assertEq(client.balance, clientBefore + 0.3 ether);
    }

    function test_resolveAllToOneSide() public {
        uint256 engagementId = _openPaid(0.4 ether);
        vm.prank(client);
        escrow.disputeProposal(engagementId, 0, keccak256("r"));
        uint256 lawyerBefore = lawyer.balance;
        vm.prank(operator);
        escrow.resolveDispute(engagementId, 0, 0.4 ether, 0);
        assertEq(lawyer.balance, lawyerBefore + 0.4 ether);
    }
}
