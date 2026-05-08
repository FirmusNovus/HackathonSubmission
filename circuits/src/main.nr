// Production-trajectory only. The MVP deploys StubZKConflictVerifier.sol
// and never invokes this circuit. Owner spec: 001-verified-legal-engagement.

fn main(commitment_root: pub Field, nullifier: pub Field, secret: Field, leaf: Field) {
    // Placeholder. Production circuit proves non-membership of `leaf` in the
    // committed conflict set whose root is `commitment_root`, and emits the
    // domain-separated nullifier `nullifier = poseidon(secret, commitment_root)`
    // to prevent reuse across engagements.
    assert(commitment_root != 0);
    assert(nullifier != 0);
    assert(secret != 0);
    assert(leaf != 0);
}
