// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {AttestationManager} from "../src/AttestationManager.sol";

contract AttestationManagerTest is Base {
    function test_hasCapability_lawyer() public view {
        assertTrue(manager.hasCapability(lawyer, manager.SCHEMA_LAWYER()));
    }

    function test_hasCapability_client() public view {
        assertTrue(manager.hasCapability(client, manager.SCHEMA_CLIENT()));
    }

    function test_hasCapability_arbiter() public view {
        assertTrue(manager.hasCapability(arbiter, manager.SCHEMA_ARBITER()));
    }

    function test_revertWhen_nonOperator_attestsLawyer() public {
        vm.prank(nobody);
        vm.expectRevert(AttestationManager.NotOperator.selector);
        manager.attestVerifiedLawyer(nobody, "X", "Y", 0, 0);
    }

    function test_revertWhen_nonOperator_revokes() public {
        bytes32 schema = manager.SCHEMA_LAWYER();
        vm.prank(nobody);
        vm.expectRevert(AttestationManager.NotOperator.selector);
        manager.revokeCapability(lawyer, schema);
    }

    function test_revertWhen_grantingArbiter_toNonLawyer() public {
        vm.prank(operator);
        vm.expectRevert(AttestationManager.NotLawyerHolder.selector);
        manager.attestVerifiedArbiter(client, "promote-non-lawyer");
    }

    function test_revoke_clearsCapability() public {
        bytes32 schemaLawyer = manager.SCHEMA_LAWYER();
        assertTrue(manager.hasCapability(lawyer, schemaLawyer));

        vm.prank(operator);
        manager.revokeCapability(lawyer, schemaLawyer);

        assertFalse(manager.hasCapability(lawyer, schemaLawyer));
    }

    function test_revertWhen_revokingMissingAttestation() public {
        bytes32 schema = manager.SCHEMA_LAWYER();
        vm.prank(operator);
        vm.expectRevert(AttestationManager.NoSuchAttestation.selector);
        manager.revokeCapability(nobody, schema);
    }

    function test_reattestation_overwritesPrevious() public {
        bytes32 schemaLawyer = manager.SCHEMA_LAWYER();
        vm.prank(operator);
        manager.attestVerifiedLawyer(lawyer, "DE", "RAK-Hamburg-2020-99999", uint64(block.timestamp), uint64(block.timestamp + 730 days));
        // still has the capability under the new attestation
        assertTrue(manager.hasCapability(lawyer, schemaLawyer));
    }

    function test_capabilityExpiresAtAttestationExpiry() public {
        // lawyer was attested for 365 days
        vm.warp(block.timestamp + 366 days);
        assertFalse(manager.hasCapability(lawyer, manager.SCHEMA_LAWYER()));
    }
}
