// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {EAS} from "@eas/EAS.sol";
import {SchemaRegistry} from "@eas/SchemaRegistry.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";

import {AttestationManager} from "../src/AttestationManager.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";
import {StubZKConflictVerifier} from "../src/StubZKConflictVerifier.sol";

/// @notice Shared deployment + persona setup for every test in this suite.
contract Base is Test {
    SchemaRegistry internal schemaRegistry;
    EAS internal eas;
    AttestationManager internal manager;
    StubZKConflictVerifier internal stubVerifier;
    LegalEngagementEscrow internal escrow;

    address internal operator = makeAddr("operator");
    // V2 mutual-refund tests need to ECDSA-sign the EIP-712 digest, so client
    // and lawyer are created with known private keys.
    address internal client;
    uint256 internal clientPrivKey;
    address internal lawyer;
    uint256 internal lawyerPrivKey;
    address internal arbiter = makeAddr("arbiter");
    address internal otherArbiter = makeAddr("otherArbiter");
    address internal nobody = makeAddr("nobody");

    function setUp() public virtual {
        (client, clientPrivKey) = makeAddrAndKey("client");
        (lawyer, lawyerPrivKey) = makeAddrAndKey("lawyer");

        schemaRegistry = new SchemaRegistry();
        eas = new EAS(ISchemaRegistry(address(schemaRegistry)));
        stubVerifier = new StubZKConflictVerifier();

        vm.prank(operator);
        manager = new AttestationManager(eas, schemaRegistry, operator);

        escrow = new LegalEngagementEscrow(manager, stubVerifier, operator);

        // Attest the personas. arbiter holds BOTH verified_lawyer AND verified_arbiter
        // because per spec the arbiter must already be a verified lawyer.
        vm.startPrank(operator);
        manager.attestVerifiedLawyer(
            lawyer, "DE", "RAK-Muenchen-2018-04321", uint64(block.timestamp), uint64(block.timestamp + 365 days)
        );
        manager.attestVerifiedClient(client, "ES", true);
        manager.attestVerifiedLawyer(
            arbiter, "CZ", unicode"ČAK ev. č. 14302", uint64(block.timestamp), uint64(block.timestamp + 365 days)
        );
        manager.attestVerifiedArbiter(arbiter, "promoted-test");
        // otherArbiter is also a lawyer + arbiter — used in tests that need a
        // second capability-holding wallet (e.g., reassignment scenarios).
        manager.attestVerifiedLawyer(
            otherArbiter, "DE", "RAK-Berlin-2010-01987", uint64(block.timestamp), uint64(block.timestamp + 365 days)
        );
        manager.attestVerifiedArbiter(otherArbiter, "promoted-test-2");
        vm.stopPrank();

        vm.deal(client, 100 ether);
        vm.deal(lawyer, 1 ether);
        vm.deal(arbiter, 1 ether);
        vm.deal(otherArbiter, 1 ether);
        vm.deal(nobody, 100 ether);
    }

    function _openEngagement(uint256 amount) internal returns (uint256 engagementId) {
        bytes32 matterRef = keccak256(abi.encodePacked("test-matter", amount));
        bytes32 nullifier = keccak256(abi.encodePacked("nullifier", amount, block.timestamp));
        vm.prank(client);
        engagementId = escrow.openEngagementAndFundFirstMilestone{value: amount}(
            lawyer, matterRef, amount, hex"00", nullifier, bytes32(uint256(1))
        );
    }
}
