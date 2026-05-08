// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEAS, AttestationRequest, AttestationRequestData, RevocationRequest, RevocationRequestData, Attestation} from "@eas/IEAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {ISchemaResolver} from "@eas/resolver/ISchemaResolver.sol";

import {IAttestationManager} from "./interfaces/IAttestationManager.sol";

/// @title AttestationManager
/// @notice Thin wrapper over EAS that owns the three Lex Nova capability schemas
///         and exposes a stable hasCapability() read used by LegalEngagementEscrow
///         to gate every state-changing action. The platform operator is the only
///         attester; other parties cannot forge capabilities.
contract AttestationManager is IAttestationManager {
    IEAS public immutable eas;
    ISchemaRegistry public immutable schemaRegistry;
    address public immutable operator;

    bytes32 public immutable SCHEMA_LAWYER;
    bytes32 public immutable SCHEMA_CLIENT;
    bytes32 public immutable SCHEMA_ARBITER;

    /// @dev O(1) lookup of the latest attestation UID per (subject, schema) so
    ///      hasCapability is a single SLOAD plus an EAS read. Cleared on revoke.
    mapping(address => mapping(bytes32 => bytes32)) private _latestAttestation;

    error NotOperator();
    error NotLawyerHolder();
    error NoSuchAttestation();

    event Attested(address indexed subject, bytes32 indexed schemaId, bytes32 attestationUid);
    event Revoked(address indexed subject, bytes32 indexed schemaId);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Used by attestVerifiedArbiter — encodes FR-007 at the contract
    ///         level so the operator literally cannot grant arbiter to a wallet
    ///         that isn't already a verified lawyer.
    modifier onlyLawyerHolder(address subject) {
        if (!hasCapability(subject, SCHEMA_LAWYER)) revert NotLawyerHolder();
        _;
    }

    constructor(IEAS _eas, ISchemaRegistry _schemaRegistry, address _operator) {
        eas = _eas;
        schemaRegistry = _schemaRegistry;
        operator = _operator;

        // Schema mirrors the actual data shape a bar association attests to:
        // country-level jurisdiction, the formal admission registry number,
        // the lawyer's admission date, and this credential's validity window.
        // Practice area is intentionally NOT here — bar associations don't
        // certify what areas a lawyer specialises in.
        SCHEMA_LAWYER = _schemaRegistry.register(
            "string jurisdiction,string barAdmissionNumber,uint64 admittedAt,uint64 validUntil",
            ISchemaResolver(address(0)),
            true
        );
        SCHEMA_CLIENT = _schemaRegistry.register(
            "string countryOfResidence,bool ageOver18", ISchemaResolver(address(0)), true
        );
        SCHEMA_ARBITER = _schemaRegistry.register("string note", ISchemaResolver(address(0)), true);
    }

    function attestVerifiedLawyer(
        address subject,
        string calldata jurisdiction,
        string calldata barAdmissionNumber,
        uint64 admittedAt,
        uint64 validUntil
    ) external onlyOperator returns (bytes32 uid) {
        bytes memory data = abi.encode(jurisdiction, barAdmissionNumber, admittedAt, validUntil);
        uid = _attest(SCHEMA_LAWYER, subject, data, validUntil);
        _latestAttestation[subject][SCHEMA_LAWYER] = uid;
        emit Attested(subject, SCHEMA_LAWYER, uid);
    }

    function attestVerifiedClient(address subject, string calldata countryOfResidence, bool ageOver18)
        external
        onlyOperator
        returns (bytes32 uid)
    {
        bytes memory data = abi.encode(countryOfResidence, ageOver18);
        uid = _attest(SCHEMA_CLIENT, subject, data, 0);
        _latestAttestation[subject][SCHEMA_CLIENT] = uid;
        emit Attested(subject, SCHEMA_CLIENT, uid);
    }

    function attestVerifiedArbiter(address subject, string calldata note)
        external
        onlyOperator
        onlyLawyerHolder(subject)
        returns (bytes32 uid)
    {
        bytes memory data = abi.encode(note);
        uid = _attest(SCHEMA_ARBITER, subject, data, 0);
        _latestAttestation[subject][SCHEMA_ARBITER] = uid;
        emit Attested(subject, SCHEMA_ARBITER, uid);
    }

    function revokeCapability(address subject, bytes32 schemaId) external onlyOperator {
        bytes32 uid = _latestAttestation[subject][schemaId];
        if (uid == bytes32(0)) revert NoSuchAttestation();
        eas.revoke(RevocationRequest({schema: schemaId, data: RevocationRequestData({uid: uid, value: 0})}));
        _latestAttestation[subject][schemaId] = bytes32(0);
        emit Revoked(subject, schemaId);
    }

    function hasCapability(address subject, bytes32 schemaId) public view returns (bool) {
        bytes32 uid = _latestAttestation[subject][schemaId];
        if (uid == bytes32(0)) return false;
        Attestation memory a = eas.getAttestation(uid);
        if (a.uid == bytes32(0)) return false;
        if (a.revocationTime != 0) return false;
        if (a.expirationTime != 0 && a.expirationTime < block.timestamp) return false;
        return true;
    }

    function _attest(bytes32 schema, address recipient, bytes memory data, uint64 expirationTime)
        private
        returns (bytes32)
    {
        return eas.attest(
            AttestationRequest({
                schema: schema,
                data: AttestationRequestData({
                    recipient: recipient,
                    expirationTime: expirationTime,
                    revocable: true,
                    refUID: bytes32(0),
                    data: data,
                    value: 0
                })
            })
        );
    }
}
