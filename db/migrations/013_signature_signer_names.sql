-- Capture the name used for consent alongside the immutable content sent for signature.
CREATE TABLE signature_signer_names (
  signer_id uuid PRIMARY KEY REFERENCES signature_signers(id),
  name text NOT NULL CHECK (length(trim(name)) > 0)
);
GRANT SELECT, INSERT ON signature_signer_names TO openwarp_app;
