# Conflict-of-interest circuit (production trajectory)

This Noir circuit is a placeholder. The MVP deploys
`contracts/src/StubZKConflictVerifier.sol`, which returns `true`
unconditionally. Production replaces the stub with a `bb`-generated
UltraHonk verifier built from this circuit and binds it via
`LegalEngagementEscrow.setZKVerifier(...)` from the operator key.
