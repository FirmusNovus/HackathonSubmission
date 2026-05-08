// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEAS, AttestationRequest, AttestationRequestData, RevocationRequest, RevocationRequestData, Attestation} from "@eas/IEAS.sol";
import {ISchemaRegistry} from "@eas/ISchemaRegistry.sol";
import {ISchemaResolver} from "@eas/resolver/ISchemaResolver.sol";

import {IAttestationManager} from "./interfaces/IAttestationManager.sol";

/// @title AttestationManager
/// @notice Thin wrapper around EAS that owns the platform's two capability
///         schemas and exposes a stable hasCapability() read used by
///         LegalEngagementEscrow to gate every state-changing action. The
///         platform operator is the only attester; other parties cannot forge
///         capabilities. Operator address is fixed at deploy time.
contract AttestationManager is IAttestationManager {
    IEAS public immutable eas;
    ISchemaRegistry public immutable schemaRegistry;
    address public immutable operator;

    bytes32 public immutable SCHEMA_LAWYER;
    bytes32 public immutable SCHEMA_CLIENT;

    /// @dev Cache of the latest attestation UID per (subject, schema) so
    ///      hasCapability is one storage read followed by one EAS read.
    mapping(address => mapping(bytes32 => bytes32)) private _latestAttestation;

    error NotOperator();
    error NoSuchAttestation();

    event Attested(address indexed subject, bytes32 indexed schemaId, bytes32 attestationUid);
    event Revoked(address indexed subject, bytes32 indexed schemaId);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IEAS _eas, ISchemaRegistry _schemaRegistry, address _operator) {
        eas = _eas;
        schemaRegistry = _schemaRegistry;
        operator = _operator;

        SCHEMA_LAWYER = _schemaRegistry.register(
            "string jurisdiction,string barAdmissionNumber,uint64 admittedAt,uint64 validUntil",
            ISchemaResolver(address(0)),
            true
        );
        SCHEMA_CLIENT = _schemaRegistry.register(
            "string countryOfResidence,bool ageOver18", ISchemaResolver(address(0)), true
        );
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

    function getLatestAttestationUid(address subject, bytes32 schemaId) external view returns (bytes32) {
        return _latestAttestation[subject][schemaId];
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
