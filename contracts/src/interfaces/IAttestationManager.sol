// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAttestationManager {
    function SCHEMA_LAWYER() external view returns (bytes32);
    function SCHEMA_CLIENT() external view returns (bytes32);

    function hasCapability(address subject, bytes32 schemaId) external view returns (bool);

    function attestVerifiedLawyer(
        address subject,
        string calldata jurisdiction,
        string calldata barAdmissionNumber,
        uint64 admittedAt,
        uint64 validUntil
    ) external returns (bytes32 uid);

    function attestVerifiedClient(address subject, string calldata countryOfResidence, bool ageOver18)
        external
        returns (bytes32 uid);

    function revokeCapability(address subject, bytes32 schemaId) external;
}
