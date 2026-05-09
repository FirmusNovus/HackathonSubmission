// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {EAS} from "@eas/EAS.sol";
import {SchemaRegistry} from "@eas/SchemaRegistry.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {IEAS} from "@eas/IEAS.sol";

import {AttestationManager} from "../src/AttestationManager.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";
import {StubZKConflictVerifier} from "../src/StubZKConflictVerifier.sol";

/// @notice Deploys the Lex Nova MVP stack and writes the resulting addresses +
///         schema UIDs to `apps/platform/lib/chain/deployed-addresses.json`
///         for the platform app to load. On anvil (chainid 31337) deploys a
///         fresh EAS + SchemaRegistry. Base Sepolia path is wired up but
///         stubbed — Phase 8 (T095) fills in the canonical addresses.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("OPERATOR_PRIVATE_KEY");
        address operator = vm.addr(pk);

        vm.startBroadcast(pk);

        ISchemaRegistry schemaRegistry;
        IEAS eas;

        if (block.chainid == 31337) {
            SchemaRegistry sr = new SchemaRegistry();
            EAS easImpl = new EAS(ISchemaRegistry(address(sr)));
            schemaRegistry = ISchemaRegistry(address(sr));
            eas = IEAS(address(easImpl));
        } else if (block.chainid == 84532) {
            // Base Sepolia — Phase 8 fills these in. Reverting for now so we
            // don't accidentally deploy against a misconfigured testnet.
            revert("Base Sepolia: canonical EAS+SchemaRegistry addresses set in Phase 8 (T095)");
        } else {
            revert("Unsupported chainid - extend Deploy.s.sol if you need a new chain");
        }

        StubZKConflictVerifier stubVerifier = new StubZKConflictVerifier();
        AttestationManager manager = new AttestationManager(eas, schemaRegistry, operator);
        LegalEngagementEscrow escrow = new LegalEngagementEscrow(manager, stubVerifier, operator);

        vm.stopBroadcast();

        console.log("AttestationManager      ", address(manager));
        console.log("LegalEngagementEscrow   ", address(escrow));
        console.log("StubZKConflictVerifier  ", address(stubVerifier));
        console.log("EAS                     ", address(eas));
        console.log("SchemaRegistry          ", address(schemaRegistry));
        console.logBytes32(manager.SCHEMA_LAWYER());
        console.logBytes32(manager.SCHEMA_CLIENT());
        console.logBytes32(manager.SCHEMA_ARBITER());

        string memory key = "deployed";
        vm.serializeAddress(key, "ATTESTATION_MANAGER_ADDRESS", address(manager));
        vm.serializeAddress(key, "LEGAL_ENGAGEMENT_ESCROW_ADDRESS", address(escrow));
        vm.serializeAddress(key, "ZK_VERIFIER_ADDRESS", address(stubVerifier));
        vm.serializeAddress(key, "EAS_ADDRESS", address(eas));
        vm.serializeAddress(key, "SCHEMA_REGISTRY_ADDRESS", address(schemaRegistry));
        vm.serializeBytes32(key, "SCHEMA_LAWYER", manager.SCHEMA_LAWYER());
        vm.serializeBytes32(key, "SCHEMA_CLIENT", manager.SCHEMA_CLIENT());
        string memory json = vm.serializeBytes32(key, "SCHEMA_ARBITER", manager.SCHEMA_ARBITER());

        string memory outPath = string.concat(vm.projectRoot(), "/../apps/platform/lib/chain/deployed-addresses.json");
        vm.writeJson(json, outPath);
        console.log("Wrote", outPath);
    }
}
