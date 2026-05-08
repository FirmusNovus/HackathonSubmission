// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {SchemaRegistry} from "@eas/SchemaRegistry.sol";
import {EAS} from "@eas/EAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {IEAS} from "@eas/IEAS.sol";

import {AttestationManager} from "../src/AttestationManager.sol";
import {StubZKConflictVerifier} from "../src/StubZKConflictVerifier.sol";
import {LegalEngagementEscrow} from "../src/LegalEngagementEscrow.sol";
import {IZKConflictVerifier} from "../src/interfaces/IZKConflictVerifier.sol";
import {IAttestationManager} from "../src/interfaces/IAttestationManager.sol";

/// @notice Shared fixture: deploys EAS + manager + verifier + escrow,
///         attests both parties, and exposes helpers to fund / deliver /
///         release proposals from the right msg.sender for the test to use.
abstract contract BaseTest is Test {
    SchemaRegistry internal registry;
    EAS internal eas;
    AttestationManager internal am;
    StubZKConflictVerifier internal verifier;
    LegalEngagementEscrow internal escrow;

    address internal operator;
    uint256 internal operatorPk = uint256(keccak256("operator"));
    address internal client;
    uint256 internal clientPk = uint256(keccak256("client"));
    address internal lawyer;
    uint256 internal lawyerPk = uint256(keccak256("lawyer"));
    address internal stranger;
    uint256 internal strangerPk = uint256(keccak256("stranger"));

    bytes32 internal constant DUMMY_PROOF = bytes32(uint256(0xC0FFEE));
    bytes32 internal constant DUMMY_NULLIFIER_PREFIX = bytes32(uint256(0xDEAD0000));

    uint64 internal nullifierCounter;

    function setUp() public virtual {
        operator = vm.addr(operatorPk);
        client = vm.addr(clientPk);
        lawyer = vm.addr(lawyerPk);
        stranger = vm.addr(strangerPk);

        vm.deal(client, 100 ether);
        vm.deal(lawyer, 1 ether);
        vm.deal(operator, 1 ether);

        vm.startPrank(operator);
        registry = new SchemaRegistry();
        eas = new EAS(ISchemaRegistry(address(registry)));
        am = new AttestationManager(IEAS(address(eas)), ISchemaRegistry(address(registry)), operator);
        verifier = new StubZKConflictVerifier();
        escrow = new LegalEngagementEscrow(
            IAttestationManager(address(am)), IZKConflictVerifier(address(verifier)), operator
        );
        am.attestVerifiedClient(client, "DE", true);
        am.attestVerifiedLawyer(lawyer, "DE", "RAK-Muenchen-1234", uint64(block.timestamp), 0);
        vm.stopPrank();
    }

    function _nextNullifier() internal returns (bytes32) {
        nullifierCounter += 1;
        return keccak256(abi.encodePacked("nullifier", nullifierCounter));
    }

    function _openPaid(uint256 amount) internal returns (uint256 engagementId) {
        bytes memory proof = abi.encodePacked(DUMMY_PROOF);
        vm.prank(client);
        engagementId = escrow.openPaidEngagementAndFundConsultation{value: amount}(
            lawyer,
            keccak256("matter"),
            amount,
            proof,
            _nextNullifier(),
            keccak256("initial-root")
        );
    }

    function _openFree() internal returns (uint256 engagementId) {
        bytes memory proof = abi.encodePacked(DUMMY_PROOF);
        vm.prank(client);
        engagementId = escrow.openFreeEngagement(
            lawyer, keccak256("matter"), proof, _nextNullifier(), keccak256("initial-root")
        );
    }

    function _signProposalOffer(uint256 engagementId, uint256 amount, bytes32 itemsHash, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typeHash = escrow.PROPOSAL_OFFER_TYPEHASH_VIEW();
        bytes32 structHash = keccak256(abi.encode(typeHash, engagementId, amount, itemsHash, nonce));
        bytes32 digest = _toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(lawyerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signMutualRefund(uint256 engagementId, uint256 proposalIndex, bytes32 nonce, uint256 signerPk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typeHash = escrow.MUTUAL_REFUND_AUTHORIZATION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(typeHash, engagementId, proposalIndex, nonce));
        bytes32 digest = _toTypedDataHash(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _toTypedDataHash(bytes32 structHash) internal view returns (bytes32) {
        bytes32 sep = escrow.eip712DomainSeparator();
        return keccak256(abi.encodePacked("\x19\x01", sep, structHash));
    }
}
